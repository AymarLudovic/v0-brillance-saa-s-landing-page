"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Loader2, 
  Check, 
  Info, 
  ChevronRight, 
  Globe, 
  ShieldCheck, 
  Terminal,
  ExternalLink
} from 'lucide-react'; 

// --- UTILITAIRES INDEXEDDB (Tes utilitaires inchangés) ---
const DB_NAME = 'StudioCodeDB';
const DB_VERSION = 2; 

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
  });
};

const saveVercelTokenToIDB = async (token: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const request = store.put(token, 'vercel_access_token');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getVercelTokenFromIDB = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('vercel_access_token');
    request.onsuccess = () => resolve(request.result ? request.result as string : null);
    request.onerror = () => reject(request.error);
  });
};

// --- TYPES ---
interface VercelDeployModalProps {
    currentProject: any;
    isOpen: boolean;
    onClose: () => void;
}

interface LogEntry {
    id: string;
    timestamp: string;
    message: string;
    type: 'stdout' | 'stderr' | 'system';
}

export default function VercelDeployModal({ currentProject, isOpen, onClose }: VercelDeployModalProps) {
    // États
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const [subdomain, setSubdomain] = useState('');
    const [showLogs, setShowLogs] = useState(false); // Pour toggle l'affichage des logs
    
    // Refs
    const logsEndRef = useRef<HTMLDivElement>(null);
    const processedLogIds = useRef<Set<string>>(new Set());
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

    // Initialisation
    useEffect(() => {
        const loadToken = async () => {
            try {
                const savedToken = await getVercelTokenFromIDB();
                if (savedToken) setToken(savedToken);
            } catch (e) { console.error(e); }
        };
        
        if (isOpen) {
            loadToken();
            // Nettoyer le nom du projet pour le sous-domaine par défaut
            const cleanName = currentProject?.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'my-app';
            setSubdomain(cleanName);
            setDeployStatus('idle');
            setLogs([]);
            setDeployUrl(null);
        }
        
        return () => stopPolling();
    }, [isOpen, currentProject]);

    // Scroll logs
    useEffect(() => {
        if (showLogs) {
            logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs, showLogs]);

    const handleSaveToken = async (val: string) => {
        setToken(val);
        await saveVercelTokenToIDB(val);
    };

    const stopPolling = () => {
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
    };

    const addLog = (message: string, type: LogEntry['type'] = 'system') => {
        const id = Math.random().toString(36).substr(2, 9);
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { id, timestamp, message, type }]);
    };

    // --- LOGIQUE API (Identique à ton code mais adaptée au nouveau flow) ---
    const fetchLogsViaSDK = async (deploymentId: string) => {
        try {
            const res = await fetch('/api/deploy/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deploymentId, token })
            });
            if (!res.ok) return;
            const { logs: sdkLogs } = await res.json();

            if (Array.isArray(sdkLogs)) {
                sdkLogs.forEach((event: any) => {
                    const eventId = event.payload?.id || event.id;
                    if (processedLogIds.current.has(eventId)) return;
                    processedLogIds.current.add(eventId);

                    const payload = event.payload || {};
                    const text = payload.text || event.text || ''; 
                    
                    if (event.type === 'deployment-state') {
                        const state = payload.info?.readyState;
                        if (state) {
                            addLog(`[status] ${state}`, 'system');
                            if (state === 'READY') {
                                stopPolling();
                                setIsDeploying(false);
                                setDeployStatus('success');
                                checkFinalStatus(deploymentId); 
                            }
                            if (state === 'ERROR' || state === 'CANCELED') {
                                stopPolling();
                                setIsDeploying(false);
                                setDeployStatus('error');
                                addLog('❌ deployment failed', 'stderr');
                            }
                        }
                        return;
                    }
                    if (!text) return;
                    let type: LogEntry['type'] = 'stdout';
                    if (event.type === 'stderr' || text.toLowerCase().includes('error')) type = 'stderr';

                    setLogs(prev => [...prev, {
                        id: eventId,
                        timestamp: new Date(event.created).toLocaleTimeString(),
                        message: text,
                        type: type
                    }]);
                });
            }
        } catch (e) { console.error(e); }
    };

    const checkFinalStatus = async (deploymentId: string) => {
        try {
            const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            
            // Construction de l'URL de production propre
            // Vercel mappe automatiquement <project-name>.vercel.app à la dernière prod
            if (data.url) {
                 // On préfère l'URL basée sur le nom du projet pour faire "pro"
                 const prodUrl = `https://${subdomain}.vercel.app`;
                 setDeployUrl(prodUrl);
                 addLog(`🚀 code successfully deployed to: ${prodUrl}`, 'system');
            }
        } catch(e) {}
    };

    const handleDeploy = async () => {
        if (!token) return;
        setIsDeploying(true);
        setDeployStatus('deploying');
        setLogs([]);
        setDeployUrl(null);
        setShowLogs(true); // On montre les logs au début
        processedLogIds.current.clear();
        addLog('starting deployment via SDK...', 'system');

        try {
            const response = await fetch('/api/deploy/vercel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName: subdomain, // On utilise le nom édité par l'utilisateur
                    files: currentProject.files,
                    token: token
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed');
            
            addLog(`project uploaded (id: ${data.deploymentId}). fetching logs...`, 'system');
            pollingInterval.current = setInterval(() => fetchLogsViaSDK(data.deploymentId), 1500);
        } catch (error: any) {
            addLog(`error: ${error.message}`, 'stderr');
            setIsDeploying(false);
            setDeployStatus('error');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] bg-black/20 backdrop-blur-sm animate-in fade-in duration-200">
            
            {/* Main Modal Container - Style "Lovable" */}
            <div className="w-[480px] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col font-sans animate-in zoom-in-95 duration-200">
                
                {/* Close Button (Hidden but usable if needed) */}
                <div className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity">
                    <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                        <X size={14} className="text-gray-600"/>
                    </button>
                </div>

                {/* --- CONTENT START --- */}
                <div className="p-6 pb-4">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">Publish your app</h2>

                    {/* Published URL Section */}
                    <div className="mb-5">
                        <div className="flex items-center gap-1.5 mb-2">
                            <label className="text-[13px] font-semibold text-gray-900">Published URL</label>
                            <Info size={13} className="text-gray-400" />
                        </div>
                        
                        <p className="text-[13px] text-gray-500 mb-2.5">
                            Enter your URL, or leave empty to auto-generate.
                        </p>

                        <div className="flex items-center w-full h-10 px-3 bg-white border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all">
                            {/* Editable Subdomain */}
                            <input 
                                type="text" 
                                value={subdomain}
                                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                placeholder="project-name"
                                disabled={isDeploying || deployStatus === 'success'}
                                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder:text-gray-300 min-w-0"
                            />
                            {/* Fixed Suffix */}
                            <span className="text-sm text-gray-400 font-medium select-none truncate">
                                .vercel.app
                            </span>
                        </div>

                        {/* Token Input (Only if needed) - Intégré subtilement */}
                        {!token && (
                            <div className="mt-2 animate-in fade-in slide-in-from-top-1">
                                <input 
                                    type="password"
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="Paste your Vercel Token here..."
                                    className="w-full h-9 px-3 bg-red-50 border border-red-200 rounded-lg text-xs text-gray-700 focus:outline-none focus:border-red-400 placeholder:text-red-300"
                                />
                                <p className="text-[10px] text-red-400 mt-1 ml-1">Token required to publish.</p>
                            </div>
                        )}

                        <button className="mt-3 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-medium rounded-md border border-gray-200 transition-colors">
                            Add custom domain
                        </button>
                    </div>

                    {/* Visibility Section */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-gray-900">Who can visit the URL?</span>
                            <Info size={13} className="text-gray-400" />
                        </div>
                        <div className="relative">
                            <select disabled className="appearance-none bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium py-1.5 pl-3 pr-8 rounded-lg cursor-pointer focus:outline-none">
                                <option>Anyone</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                <ChevronRight size={14} className="rotate-90" />
                            </div>
                        </div>
                    </div>

                    {/* Website Info Collapsible */}
                    <button 
                        onClick={() => setShowLogs(!showLogs)}
                        className="w-full flex items-center justify-between py-3 border-t border-gray-100 group"
                    >
                        <span className="text-[13px] font-semibold text-gray-900">
                            {isDeploying ? 'Deployment Logs' : 'Website info'}
                        </span>
                        <ChevronRight 
                            size={16} 
                            className={`text-gray-400 transition-transform duration-200 ${showLogs ? 'rotate-90' : ''}`} 
                        />
                    </button>

                    {/* LOGS VIEW (Inside Website Info) */}
                    {showLogs && (
                        <div className="bg-[#111] rounded-lg p-3 mb-4 h-[150px] overflow-y-auto custom-scrollbar border border-gray-200 shadow-inner">
                            {logs.length === 0 && (
                                <p className="text-gray-500 text-xs font-mono">Ready to deploy...</p>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="font-mono text-[10px] mb-1 flex items-start gap-2 break-all">
                                    <span className="text-gray-600 shrink-0">{log.timestamp}</span>
                                    <span className={`${
                                        log.type === 'stderr' ? 'text-red-400' :
                                        log.type === 'system' ? 'text-blue-400' : 'text-gray-300'
                                    }`}>
                                        {log.type === 'system' ? '> ' : ''}{log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50/50 p-4 border-t border-gray-100 flex items-center justify-between gap-3">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2.5 text-[13px] font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition-all shadow-sm flex-1 flex items-center justify-center gap-2"
                    >
                        {deployStatus === 'success' ? 'Close' : 'Review security'}
                    </button>

                    {deployStatus === 'success' ? (
                         <a 
                            href={deployUrl || '#'} 
                            target="_blank"
                            className="px-4 py-2.5 text-[13px] font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-all shadow-sm flex-[2] flex items-center justify-center gap-2"
                         >
                            Visit Website <ExternalLink size={14} />
                         </a>
                    ) : (
                        <button 
                            onClick={handleDeploy}
                            disabled={isDeploying || !token || !subdomain}
                            className={`px-4 py-2.5 text-[13px] font-semibold text-white rounded-lg transition-all shadow-md flex-[2] flex items-center justify-center gap-2 ${
                                isDeploying || !token 
                                ? 'bg-blue-400 cursor-not-allowed' 
                                : 'bg-[#2563eb] hover:bg-blue-700 hover:shadow-lg hover:-translate-y-0.5'
                            }`}
                        >
                            {isDeploying ? (
                                <><Loader2 size={16} className="animate-spin" /> Deploying...</>
                            ) : (
                                'Publish'
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
        }
