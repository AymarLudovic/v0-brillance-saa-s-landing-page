"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle, ArrowRight, Save, RefreshCw } from 'lucide-react'; 

// ==============================================================================
// 1. UTILITAIRES INDEXEDDB
// ==============================================================================

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
    const deploymentIdRef = useRef<string | null>(null);

    // Chargement Token
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

    // Auto-scroll
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
        // Génération d'un ID unique basé sur le contenu et le temps pour éviter les doublons visuels
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toLocaleTimeString();
        
        let cleanMessage = message;
        try {
             if (typeof message === 'object') cleanMessage = JSON.stringify(message, null, 2);
        } catch (e) {}

        setLogs(prev => [...prev, { id, timestamp, message: cleanMessage, type }]);
    };

    // --- CŒUR DU SYSTÈME : FETCH LOGS & STATUS ---
    const fetchLogsAndStatus = async (deploymentId: string) => {
        try {
            // 1. RÉCUPÉRATION DES LOGS (EVENTS)
            // On utilise limit=-1 pour tout avoir, direction=forward
            const logsRes = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward&limit=-1`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (logsRes.ok) {
                const events = await logsRes.json();
                
                events.forEach((event: any) => {
                    // Anti-doublon via l'ID fourni par Vercel
                    if (processedLogIds.current.has(event.id)) return;
                    processedLogIds.current.add(event.id);

                    // Extraction du texte
                    const text = event.payload?.text || event.text || '';
                    if (!text) return;

                    let type: LogEntry['type'] = 'stdout';
                    const lowerText = text.toLowerCase();

                    // Analyse du contenu pour la couleur
                    if (event.type === 'stderr' || lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('err:')) {
                        type = 'stderr';
                    } else if (lowerText.includes('warn')) {
                        type = 'system'; // Orange/Jaune si on veut, ici bleu system
                    }

                    // Ajout au state
                    setLogs(prev => [...prev, {
                        id: event.id,
                        timestamp: new Date(event.created).toLocaleTimeString(),
                        message: text,
                        type: type
                    }]);
                });
            }

            // 2. VÉRIFICATION DU STATUT GLOBAL
            const statusRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const statusData = await statusRes.json();

            // --- CAS : SUCCÈS ---
            if (statusData.readyState === 'READY') {
                stopPolling();
                addLog('Deployment successfully finished!', 'system');
                setDeployUrl(`https://${statusData.url}`);
                setIsDeploying(false);
            } 
            // --- CAS : ERREUR ---
            else if (statusData.readyState === 'ERROR' || statusData.readyState === 'CANCELED') {
                stopPolling();
                
                // On affiche l'erreur Vercel explicite
                const errorCode = statusData.error?.code || 'UNKNOWN';
                const errorMsg = statusData.error?.message || 'Check logs above for details.';
                
                addLog(`❌ BUILD FAILED (${errorCode})`, 'stderr');
                addLog(`Reason: ${errorMsg}`, 'stderr');
                
                setIsDeploying(false);
            }

        } catch (e: any) {
            console.error("Polling error:", e);
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
        addLog('Initializing deployment...', 'system');

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

            if (!response.ok) {
                addLog(`API Route Error: ${JSON.stringify(data)}`, 'stderr');
                throw new Error(data.error || 'Deployment creation failed');
            }

            deploymentIdRef.current = data.deploymentId;
            addLog(`Project uploaded (ID: ${data.deploymentId}).`, 'system');
            addLog('Waiting for build pipeline to start...', 'system');

            // Démarrage du polling (toutes les 2s)
            pollingInterval.current = setInterval(() => {
                if (deploymentIdRef.current) {
                    fetchLogsAndStatus(deploymentIdRef.current);
                }
            }, 2000);

        } catch (error: any) {
            addLog(`Startup Error: ${error.message}`, 'stderr');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[900px] h-[700px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Vercel Deployment</h2>
                            <p className="text-xs text-gray-500">Live Build Logs & Output</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
                    
                    {/* Token Section (Caché si token présent, affichable si besoin) */}
                    {!token ? (
                        <div className="flex flex-col gap-2 mb-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Access Token</label>
                            <div className="relative">
                                <input 
                                    type="password" 
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="Paste your Vercel token..."
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors pr-10"
                                />
                                <Save size={14} className="absolute right-3 top-3.5 text-gray-500" />
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-between items-center bg-[#1a1a1a] px-4 py-2 rounded-lg border border-white/5">
                             <span className="text-xs text-green-500 flex items-center gap-2"><Check size={12}/> Token loaded securely</span>
                             <button onClick={() => setToken('')} className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1"><RefreshCw size={10}/> Change</button>
                        </div>
                    )}

                    {/* Terminal Window */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 flex flex-col overflow-hidden font-mono text-xs shadow-inner">
                        <div className="bg-[#1a1a1a] px-4 py-2 border-b border-white/5 text-gray-500 flex items-center justify-between text-[10px] uppercase tracking-wider">
                            <div className="flex items-center gap-2"><Terminal size={12} /> Console Output</div>
                            {isDeploying && <div className="flex items-center gap-2 text-blue-400 animate-pulse"><Loader size={10} className="animate-spin"/> Live Streaming</div>}
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 space-y-1">
                            {logs.length === 0 && (
                                <div className="text-gray-700 italic h-full flex items-center justify-center">
                                    Ready to deploy...
                                </div>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-3 items-start group hover:bg-white/5 px-2 rounded transition-colors">
                                    <span className="text-gray-600 shrink-0 select-none w-[60px] text-[10px] pt-[2px] opacity-50">{log.timestamp}</span>
                                    <span className={`break-all whitespace-pre-wrap ${
                                        log.type === 'stderr' ? 'text-red-400 font-semibold bg-red-500/10 px-1 rounded' :
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
                        {isDeploying ? 'Building application...' : 'Waiting for action'}
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
