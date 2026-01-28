"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, ArrowRight, ArrowUp } from 'lucide-react'; 

// --- UTILITAIRES INDEXEDDB ---
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

    useEffect(() => {
        const loadToken = async () => {
            try {
                const savedToken = await getVercelTokenFromIDB();
                if (savedToken) setToken(savedToken);
            } catch (e) { console.error(e); }
        };
        if (isOpen) loadToken();
        return () => stopPolling();
    }, [isOpen]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

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
                                checkFinalStatus(deploymentId); 
                            }
                            if (state === 'ERROR') {
                                stopPolling();
                                setIsDeploying(false);
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
            if (data.url) {
                setDeployUrl(`https://${data.url}`);
                addLog(`🚀 code successfully deployed to vercel!`, 'system');
                setIsDeploying(false);
            }
        } catch(e) {}
    };

    const handleDeploy = async () => {
        if (!token) return;
        setIsDeploying(true);
        setLogs([]);
        setDeployUrl(null);
        processedLogIds.current.clear();
        addLog('starting deployment via SDK...', 'system');

        try {
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
            if (!response.ok) throw new Error(data.error || 'Failed');
            addLog(`project uploaded (id: ${data.deploymentId}). fetching logs...`, 'system');
            pollingInterval.current = setInterval(() => fetchLogsViaSDK(data.deploymentId), 1500);
        } catch (error: any) {
            addLog(`error: ${error.message}`, 'stderr');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        
            
            <div className="fixed top-5 right-12 z-[9999] w-[420px] max-h-[45vh] bg-[#fbfbf9] rounded-1xl border border-white/10 overflow-hidden  flex flex-col animate-in zoom-in-95 duration-300">
                
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1.5 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-20"
                >
                    <X size={18} />
                </button>

                <div className="flex-1 p-6 flex flex-col overflow-y-auto custom-scrollbar">
                    
                    {/* Header */}
                    <div className="hidden justify-between items-start bg-[#111] rounded-[12px] mb-6 p-4 border border-white/5 shrink-0">
                        <div>
                            <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#000] border border-white/10 text-[10px] font-medium text-[#e4e4e4] mb-2 tracking-wider">
                                Vercel SDK
                            </div>
                            <h2 className="text-xl font-bold text-white leading-tight">
                                Vercel Deploy
                            </h2>
                            <p className="text-[11px] text-[#888] mt-1">
                                Go live with the Vercel cloud.
                            </p>
                        </div>
                        <div className="bg-[#0a0a0a] p-1 rounded-2xl border border-white/5 shadow-inner">
                            <img className="h-[70px] w-[70px] object-contain" src="/3dicons-locker-dynamic-premium.png" alt="Icon" />
                        </div>
                    </div>

                    {/* Formulaire */}
                    <div className="space-y-4 mb-6 shrink-0">
                        <div className="space-y-1.5">
                            <label className="text-[24px] font-bold text-[#212121] ml-1">Publish your app</label>
                            <div className="h-8 bg-[#f7f4ed] rounded-[10px] border border-white/10 flex items-center px-3 gap-2 focus-within:border-white/30 transition-colors">
                                <input 
                                    type="password"
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="your Vercel token...."
                                    className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]"
                                />
                                {token && <Check size={14} className="text-green-500" />}
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-[#666] ml-1">Project name</label>
                            <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                                <input 
                                    type="text"
                                    readOnly
                                    value={currentProject?.name?.toLowerCase().replace(/\s+/g, '-')}
                                    className="bg-transparent border-none outline-none text-xs text-[#666] w-full"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Console Output (Hauteur fixée) */}
                    <div className="h-[90px] shrink-0 bg-[#f7f4ed] rounded-[10px] border border-white/5 p-3  text-[10px] overflow-y-auto mb-6 custom-scrollbar">
                        
                        <div className="space-y-1">
                            {logs.length === 0 && (
                                <p className="text-[#333] italic">Ready to deploy...</p>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                                    <span className={`shrink-0 ${
                                        log.type === 'stderr' ? 'text-red-500' :
                                        log.type === 'system' ? 'text-blue-500' : 'text-[#666]'
                                    }`}>•</span>
                                    <span className={log.type === 'stderr' ? 'text-red-400' : 'text-gray-400'}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>

                    {/* Bouton Action */}
                    <div className="flex items-center w-full gap-1">
                      <button 
                        onClick={onClose}
                        className="h-[30px] w-[50%] rounded-[8px] bg-[#f7f4ed]">
                        cancel
                      </button>
                       <button 
                        onClick={handleDeploy}
                        disabled={isDeploying || !token}
                        className={`h-[30px] w-[50%] shrink-0 rounded-[8px] text-sm font-bold transition-all  flex items-center justify-center gap-2 ${
                            isDeploying 
                            ? 'bg-[#1e52f1] text-[#fff] cursor-not-allowed' 
                            : 'bg-[#1e52f1] text-white'
                        }`}
                    >
                        {isDeploying ? (
                            <><Loader size={16} className="animate-spin" /> Deploying...</>
                        ) : (
                            <>Deploy</>
                        )}
                    </button>
                    </div>

                    {/* Footer Links */}
                    <div className="mt-4 flex flex-col items-center gap-1 shrink-0 pb-2">
                        {deployUrl ? (
                            <a 
                                href={deployUrl} 
                                target="_blank" 
                                className="text-[10px] text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
                            >
                                Open website <ArrowUp size={10} className="rotate-45" />
                            </a>
                        ) : (
                            <div className="flex flex-col items-center gap-1">
                                <p className="text-[10px] text-[#444]">
                                    Use a <span className="text-[#666] font-bold">Personal Access Token</span>.
                                </p>
                                <a 
                                    href="https://vercel.com/account/tokens" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-[#888] hover:text-white transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
                                >
                                    Get your Vercel token here
                                    <ArrowUp size={10} className="rotate-45" />
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        
    );
      }
