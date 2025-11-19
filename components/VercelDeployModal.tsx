"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle, ArrowRight, Save } from 'lucide-react'; 

// ==============================================================================
// 1. UTILITAIRES INDEXEDDB (Pour le Token Vercel)
// ==============================================================================

const DB_NAME = 'StudioCodeDB';
const DB_VERSION = 2; // Doit matcher la version de tes projets/api key

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
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

// ==============================================================================
// 2. COMPOSANT MODAL
// ==============================================================================

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
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    
    const processedLogIds = useRef<Set<string>>(new Set());
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

    // CHARGEMENT DU TOKEN DEPUIS INDEXEDDB
    useEffect(() => {
        const loadToken = async () => {
            try {
                const savedToken = await getVercelTokenFromIDB();
                if (savedToken) setToken(savedToken);
            } catch (e) {
                console.error("Erreur chargement token Vercel:", e);
            }
        };
        if (isOpen) loadToken();
        
        return () => stopPolling();
    }, [isOpen]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleSaveToken = async (val: string) => {
        setToken(val);
        await saveVercelTokenToIDB(val); // Sauvegarde auto dans IDB
    };

    const stopPolling = () => {
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
    };

    // --- FONCTION ADDLOG AMÉLIORÉE (Debug) ---
    const addLog = (message: string, type: LogEntry['type'] = 'system') => {
        const id = Math.random().toString(36).substr(2, 9);
        const timestamp = new Date().toLocaleTimeString();
        
        // Si le message est un objet JSON stringifié ou une erreur, on le formate
        let cleanMessage = message;
        try {
             // Si c'est un objet erreur complexe, on essaie de l'afficher proprement
             if (typeof message === 'object') {
                 cleanMessage = JSON.stringify(message, null, 2);
             }
        } catch (e) {}

        setLogs(prev => [...prev, { id, timestamp, message: cleanMessage, type }]);
        
        // Log aussi dans la console du navigateur pour le vrai debug
        if (type === 'stderr') console.error(`[Vercel] ${cleanMessage}`);
        else console.log(`[Vercel] ${cleanMessage}`);
    };

    const fetchLogsAndStatus = async (deploymentId: string) => {
        try {
            // 1. Fetch LOGS (Events)
            const logsRes = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (logsRes.ok) {
                const events = await logsRes.json();
                events.forEach((event: any) => {
                    if (processedLogIds.current.has(event.id)) return;
                    processedLogIds.current.add(event.id);

                    const text = event.payload?.text || event.text || '';
                    if (!text) return;

                    let type: LogEntry['type'] = 'stdout';
                    const lowerText = text.toLowerCase();

                    if (event.type === 'stderr' || lowerText.includes('error') || lowerText.includes('failed')) {
                        type = 'stderr';
                    }

                    setLogs(prev => [...prev, {
                        id: event.id,
                        timestamp: new Date(event.created).toLocaleTimeString(),
                        message: text,
                        type: type
                    }]);
                });
            }

            // 2. Fetch STATUT GLOBAL (Pour capturer l'erreur UNKNOWN)
            const statusRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const statusData = await statusRes.json();

            if (statusData.readyState === 'READY') {
                stopPolling();
                addLog('Deployment Success!', 'system');
                setDeployUrl(`https://${statusData.url}`);
                setIsDeploying(false);
            } 
            else if (statusData.readyState === 'ERROR' || statusData.readyState === 'CANCELED') {
                stopPolling();
                
                // --- ICI : ON CAPTURE TOUT LE DÉTAIL DE L'ERREUR ---
                // On affiche l'objet erreur complet pour que tu puisses voir le problème
                const fullError = JSON.stringify(statusData.error || statusData, null, 2);
                
                addLog(`❌ BUILD FAILED. Error Details:`, 'stderr');
                addLog(fullError, 'stderr'); // Affiche le JSON brut de l'erreur dans le modal
                
                setIsDeploying(false);
            }

        } catch (e: any) {
            addLog(`Polling Exception: ${e.message}`, 'stderr');
        }
    };

    const handleDeploy = async () => {
        if (!token) {
            addLog('Error: Token missing.', 'stderr');
            return;
        }
        
        setIsDeploying(true);
        setLogs([]);
        setDeployUrl(null);
        processedLogIds.current.clear();
        addLog('Starting deployment...', 'system');

        try {
            // 1. Appel API Interne
            const response = await fetch('/api/deploy/vercel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName: currentProject.name,
                    files: currentProject.files,
                    token: token
                })
            });

            const data = await response.json();

            // Si l'API route renvoie une erreur (ex: 400/500)
            if (!response.ok) {
                addLog(`API Route Error: ${JSON.stringify(data)}`, 'stderr'); // Log l'erreur brute
                throw new Error(data.error || 'Deployment creation failed');
            }

            addLog(`Project uploaded. ID: ${data.deploymentId}`, 'system');
            addLog('Waiting for build logs...', 'system');

            // 2. Polling
            pollingInterval.current = setInterval(() => {
                fetchLogsAndStatus(data.deploymentId);
            }, 2000);

        } catch (error: any) {
            addLog(`Catch Error: ${error.message}`, 'stderr');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[850px] h-[650px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Vercel Deployment</h2>
                            <p className="text-xs text-gray-500">Live Console & Debugger</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
                    
                    {/* Token Section (Caché si on déploie pour gagner de la place, sauf si vide) */}
                    <div className="flex flex-col gap-2 mb-2">
                        <div className="flex justify-between">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Access Token</label>
                            {token && <span className="text-xs text-green-500 flex items-center gap-1"><Check size={10}/> Saved in Database</span>}
                        </div>
                        <div className="relative">
                            <input 
                                type="password" 
                                value={token}
                                onChange={(e) => handleSaveToken(e.target.value)}
                                placeholder="Paste your token..."
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors pr-10"
                            />
                            <Save size={14} className="absolute right-3 top-3.5 text-gray-500" />
                        </div>
                    </div>

                    {/* Terminal Window */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 flex flex-col overflow-hidden font-mono text-xs shadow-inner">
                        <div className="bg-[#1a1a1a] px-4 py-2 border-b border-white/5 text-gray-500 flex items-center gap-2 text-[10px] uppercase tracking-wider justify-between">
                            <div className="flex items-center gap-2"><Terminal size={12} /> Build Output</div>
                            <div className="flex gap-2">
                                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Error</span>
                                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> System</span>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 space-y-1">
                            {logs.length === 0 && (
                                <div className="text-gray-700 italic">Ready to start...</div>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-3 items-start group">
                                    <span className="text-gray-600 shrink-0 select-none w-[60px] text-[10px] pt-[2px]">{log.timestamp}</span>
                                    <span className={`break-all whitespace-pre-wrap ${
                                        log.type === 'stderr' ? 'text-red-400 font-bold bg-red-900/10 p-1 rounded' :
                                        log.type === 'system' ? 'text-blue-400' :
                                        'text-gray-300'
                                    }`}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-5 border-t border-white/5 bg-[#141414] flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                        {isDeploying ? 'Streaming logs...' : 'Idle'}
                    </div>
                    
                    <div className="flex items-center gap-3">
                        {deployUrl && (
                            <a 
                                href={deployUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="px-4 py-2 bg-green-600/10 text-green-400 border border-green-600/20 rounded-lg text-xs font-bold hover:bg-green-600/20 flex items-center gap-2 transition-all"
                            >
                                <Check size={14} /> Visit Website <ArrowRight size={12} />
                            </a>
                        )}

                        <button 
                            onClick={handleDeploy}
                            disabled={isDeploying || !token}
                            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                                isDeploying 
                                ? 'bg-gray-800 text-gray-400 cursor-not-allowed' 
                                : 'bg-white text-black hover:bg-gray-200'
                            }`}
                        >
                            {isDeploying ? (
                                <>
                                    <Loader size={16} className="animate-spin" />
                                    Deploying...
                                </>
                            ) : (
                                'Start Deployment'
                            )}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
          }
