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
  ExternalLink,
  AlertTriangle,
  FileCode,
  Terminal
} from 'lucide-react'; 

// --- UTILITAIRES INDEXEDDB (Inchangés) ---
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
    type: 'stdout' | 'stderr' | 'system' | 'success';
}

export default function VercelDeployModal({ currentProject, isOpen, onClose }: VercelDeployModalProps) {
    // États
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'success' | 'error'>('idle');
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const [projectId, setProjectId] = useState<string | null>(null); // Pour le lien Review Security
    const [subdomain, setSubdomain] = useState('');
    
    // Refs
    const logsEndRef = useRef<HTMLDivElement>(null);
    const processedLogIds = useRef<Set<string>>(new Set());
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);
    const logsContainerRef = useRef<HTMLDivElement>(null);

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
            const cleanName = currentProject?.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'my-app';
            setSubdomain(cleanName);
            setDeployStatus('idle');
            setLogs([]);
            setDeployUrl(null);
            setIsDeploying(false);
        }
        
        return () => stopPolling();
    }, [isOpen, currentProject]);

    // Auto-scroll logs
    useEffect(() => {
        if (logsContainerRef.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [logs]);

    // --- ANALYSE INTELLIGENTE DES LOGS ---
    // C'est ici qu'on détecte la fin même si l'état API traîne
    useEffect(() => {
        if (!isDeploying) return;

        const lastLogs = logs.slice(-5); // Regarder les 5 derniers logs
        const fullText = lastLogs.map(l => l.message).join(' ').toLowerCase();

        // 1. DÉTECTION SUCCÈS
        if (
            fullText.includes('deployment completed') || 
            fullText.includes('build completed') ||
            fullText.includes('compiled successfully')
        ) {
            stopPolling();
            setIsDeploying(false);
            setDeployStatus('success');
            addLog('✅ Site is live!', 'success');
            
            // On reconstruit l'URL finale
            const finalUrl = `https://${subdomain}.vercel.app`;
            setDeployUrl(finalUrl);
        }

        // 2. DÉTECTION ERREUR (Ignorer les warnings)
        // On évite "npm warn"
        const hasError = lastLogs.some(l => 
            (l.type === 'stderr' && !l.message.includes('warn') && !l.message.includes('notice')) ||
            l.message.toLowerCase().includes('err!') ||
            l.message.includes('Command failed')
        );

        if (hasError) {
            stopPolling();
            setIsDeploying(false);
            setDeployStatus('error');
            addLog('❌ Build failed. Check logs above.', 'stderr');
        }

    }, [logs, isDeploying, subdomain]);

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
        const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
        setLogs(prev => [...prev, { id, timestamp, message, type }]);
    };

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
                                // Redondance : si l'event arrive avant le log texte
                                stopPolling();
                                setIsDeploying(false);
                                setDeployStatus('success');
                                checkFinalStatus(deploymentId);
                            }
                            if (state === 'ERROR' || state === 'CANCELED') {
                                stopPolling();
                                setIsDeploying(false);
                                setDeployStatus('error');
                                addLog('❌ deployment failed (API state)', 'stderr');
                            }
                        }
                        return;
                    }

                    if (!text) return;

                    let type: LogEntry['type'] = 'stdout';
                    // Détection fine des erreurs vs warnings
                    if (event.type === 'stderr') {
                        if (text.toLowerCase().includes('warn')) type = 'stdout'; // Traiter les warns comme du texte normal (jaune orange ui)
                        else type = 'stderr';
                    }

                    setLogs(prev => [...prev, {
                        id: eventId,
                        timestamp: new Date(event.created).toLocaleTimeString('en-US', { hour12: false }),
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
            if (data.url) {
                 const prodUrl = `https://${subdomain}.vercel.app`;
                 setDeployUrl(prodUrl);
            }
        } catch(e) {}
    };

    const handleDeploy = async () => {
        if (!token) return;
        setIsDeploying(true);
        setDeployStatus('deploying');
        setLogs([]);
        setDeployUrl(null);
        processedLogIds.current.clear();
        addLog('Initializing Vercel SDK...', 'system');

        try {
            const response = await fetch('/api/deploy/vercel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName: subdomain,
                    files: currentProject.files,
                    token: token
                })
            });
            const data = await response.json();
            
            if (!response.ok) throw new Error(data.error || 'Failed');
            
            if (data.projectId) setProjectId(data.projectId); // Sauvegarde l'ID projet pour le bouton Security

            addLog(`Project linked. Building...`, 'system');
            pollingInterval.current = setInterval(() => fetchLogsViaSDK(data.deploymentId), 2000);
        } catch (error: any) {
            addLog(`Error: ${error.message}`, 'stderr');
            setIsDeploying(false);
            setDeployStatus('error');
        }
    };

    // Fonction pour ouvrir les settings de sécurité Vercel
    const handleReviewSecurity = () => {
        if (subdomain) {
            // URL générique vers les settings du projet sur Vercel
            // Comme on n'a pas le "teamId" facilement ici sans appel API supp, on vise l'URL projet standard
            window.open(`https://vercel.com/dashboard/${subdomain}/settings`, '_blank');
        }
    };

    if (!isOpen) return null;

    return (
        // Positionnement Fixed Top-Right 40px/20px SANS overlay sombre
        <div className="fixed top-[40px] right-[20px] z-[9999] flex flex-col animate-in slide-in-from-right-5 duration-300">
            
            {/* Bouton Close Flottant */}
            <button 
                onClick={onClose}
                className="absolute -top-3 -right-3 z-50 bg-white text-gray-400 hover:text-gray-900 border border-gray-200 rounded-full p-1.5 shadow-sm hover:shadow-md transition-all"
            >
                <X size={16} />
            </button>

            {/* Main Card */}
            <div className="w-[420px] bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 overflow-hidden flex flex-col font-sans">
                
                {/* --- CONTENT START --- */}
                <div className="p-5 pb-2">
                    <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <span className="w-2 h-5 bg-black rounded-full block"></span>
                        Publish to Web
                    </h2>

                    {/* Published URL Input */}
                    <div className="mb-5">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[12px] font-semibold text-gray-700">Domain Configuration</label>
                            {token ? (
                                <span className="text-[10px] text-green-600 flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                                    <Check size={10} /> Token Active
                                </span>
                            ) : (
                                <span className="text-[10px] text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-100">Token missing</span>
                            )}
                        </div>

                        <div className="flex items-center w-full h-10 px-3 bg-gray-50/50 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-black/5 focus-within:border-gray-400 transition-all">
                            <Globe size={14} className="text-gray-400 mr-2 shrink-0" />
                            <input 
                                type="text" 
                                value={subdomain}
                                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                placeholder="project-name"
                                disabled={isDeploying || deployStatus === 'success'}
                                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder:text-gray-400 min-w-0 font-medium"
                            />
                            <span className="text-sm text-gray-400 font-mono select-none pl-1">
                                .vercel.app
                            </span>
                        </div>

                        {/* Token Input (Hidden if present, visible if missing) */}
                        {!token && (
                            <div className="mt-2 animate-in fade-in slide-in-from-top-1">
                                <input 
                                    type="password"
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="Paste Vercel Access Token..."
                                    className="w-full h-8 px-3 bg-white border border-red-200 rounded-md text-xs focus:border-red-400 outline-none"
                                />
                            </div>
                        )}
                    </div>

                    {/* Website Info Section (Favicon & Metadata Manager) */}
                    <div className="mb-4 border border-gray-100 rounded-lg p-3 bg-gray-50/30">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[12px] font-semibold text-gray-700 flex items-center gap-1.5">
                                <FileCode size={12} className="text-blue-500"/> Website Info
                            </span>
                            <span className="text-[10px] text-gray-400">Metadata</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-md bg-white border border-gray-200 flex items-center justify-center shrink-0 shadow-sm">
                                <div className="h-4 w-4 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500" />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-gray-900 truncate">
                                    {currentProject?.name || 'Untitled Project'}
                                </span>
                                <span className="text-[10px] text-gray-500 truncate">
                                    Using Next.js 14 App Router
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Logs Section (Toujours visible) */}
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-1.5 px-1">
                            <span className="text-[11px] font-semibold text-gray-500 flex items-center gap-1">
                                <Terminal size={11} /> Build Logs
                            </span>
                            {isDeploying && <Loader2 size={10} className="animate-spin text-blue-500" />}
                        </div>
                        <div 
                            ref={logsContainerRef}
                            className="bg-[#1a1a1a] rounded-lg p-3 h-[140px] overflow-y-auto custom-scrollbar border border-gray-800 shadow-inner font-mono text-[10px] leading-4"
                        >
                            {logs.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-1">
                                    <Terminal size={16} />
                                    <span>Waiting for deployment...</span>
                                </div>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                                    <span className="text-gray-600 shrink-0 select-none w-[45px] text-right">{log.timestamp}</span>
                                    <span className={`break-all ${
                                        log.type === 'stderr' ? 'text-red-400 font-bold' :
                                        log.type === 'success' ? 'text-green-400 font-bold' :
                                        log.type === 'system' ? 'text-blue-400' : 
                                        log.message.includes('warn') ? 'text-yellow-500' : 'text-gray-300'
                                    }`}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex items-center justify-between gap-3">
                    
                    {/* Review Security Button */}
                    <button 
                        onClick={handleReviewSecurity}
                        disabled={!token}
                        className="px-4 py-2 text-[12px] font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:bg-white rounded-lg transition-all shadow-sm flex items-center gap-2 hover:shadow disabled:opacity-50"
                        title="Open Vercel Project Settings"
                    >
                        <ShieldCheck size={14} />
                        Review Security
                    </button>

                    {/* Action Button */}
                    {deployStatus === 'success' ? (
                         <a 
                            href={deployUrl || '#'} 
                            target="_blank"
                            className="px-5 py-2 text-[12px] font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-all shadow-md hover:shadow-lg flex items-center gap-2 animate-in zoom-in-95"
                         >
                            View Site <ExternalLink size={14} />
                         </a>
                    ) : deployStatus === 'error' ? (
                        <button 
                            onClick={handleDeploy}
                            className="px-5 py-2 text-[12px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-all shadow-md flex items-center gap-2"
                        >
                            Retry
                        </button>
                    ) : (
                        <button 
                            onClick={handleDeploy}
                            disabled={isDeploying || !token || !subdomain}
                            className={`px-5 py-2 text-[12px] font-bold text-white rounded-lg transition-all shadow-md flex items-center gap-2 min-w-[100px] justify-center ${
                                isDeploying || !token 
                                ? 'bg-black/70 cursor-not-allowed' 
                                : 'bg-black hover:bg-gray-800 hover:shadow-lg'
                            }`}
                        >
                          {isDeploying ? (
                                <><Loader2 size={14} className="animate-spin" /> Deploying</>
                            ) : (
                                'Deploy'
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
