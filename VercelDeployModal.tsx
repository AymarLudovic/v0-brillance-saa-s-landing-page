"use client";

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, ArrowRight, ArrowUp, Globe } from 'lucide-react'; 

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
    onBuildError?: (stderr: string) => void;
}

interface LogEntry {
    id: string;
    timestamp: string;
    message: string;
    type: 'stdout' | 'stderr' | 'system' | 'success';
}

export default function VercelDeployModal({ currentProject, isOpen, onClose, onBuildError }: VercelDeployModalProps) {
    const [token, setToken] = useState('');
    const [projectName, setProjectName] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    
    const processedLogIds = useRef<Set<string>>(new Set());
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);
    const safetyTimeout = useRef<NodeJS.Timeout | null>(null);
    const errorLines = useRef<string[]>([]); // accumule les lignes d'erreur pour sendChat

    useEffect(() => {
        const loadToken = async () => {
            try {
                const savedToken = await getVercelTokenFromIDB();
                if (savedToken) setToken(savedToken);
            } catch (e) { console.error(e); }
        };
        
        if (isOpen) {
            loadToken();
            // Initialiser le nom du projet proprement
            const cleanName = currentProject?.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'my-project';
            setProjectName(cleanName);
            setLogs([]);
            setDeployUrl(null);
            setIsDeploying(false);
        }
        return () => stopPolling();
    }, [isOpen, currentProject]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleSaveToken = async (val: string) => {
        setToken(val);
        await saveVercelTokenToIDB(val);
    };

    const stopPolling = (success = false) => {
        if (pollingInterval.current) {
            clearInterval(pollingInterval.current);
            pollingInterval.current = null;
        }
        if (safetyTimeout.current) {
            clearTimeout(safetyTimeout.current);
            safetyTimeout.current = null;
        }
        setIsDeploying(false);
        // Si erreur et erreurs accumulées → envoyer à l'IA via onBuildError
        if (!success && errorLines.current.length > 0 && onBuildError) {
            onBuildError(errorLines.current.join('\n'));
            errorLines.current = [];
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

            if (!Array.isArray(sdkLogs)) return;

            sdkLogs.forEach((event: any) => {
                const eventId = event.payload?.id || event.id || Math.random().toString();
                if (processedLogIds.current.has(eventId)) return;
                processedLogIds.current.add(eventId);

                const payload = event.payload || {};
                const text = (payload.text || event.text || '').trim();

                // ── Détection d'état depuis deployment-state ──────────────────
                if (event.type === 'deployment-state') {
                    const state = payload.info?.readyState || payload.readyState;
                    if (state) {
                        addLog(`[status] ${state}`, 'system');
                        if (state === 'READY') {
                            addLog('✅ Déploiement réussi !', 'success');
                            checkFinalStatus(deploymentId);
                            stopPolling(true);
                        } else if (state === 'ERROR' || state === 'CANCELED') {
                            addLog(`❌ Déploiement ${state.toLowerCase()}`, 'stderr');
                            stopPolling(false); // envoie errorLines à l'IA
                        }
                    }
                    return;
                }

                if (!text) return;

                // ── Détection de succès dans le texte ────────────────────────
                if (
                    text.includes('Deployment completed') ||
                    text.includes('Build Completed') ||
                    text.includes('Compiled successfully') ||
                    text.includes('Ready') && text.includes('https://')
                ) {
                    addLog('✅ Build terminé avec succès !', 'success');
                    setDeployUrl(`https://${projectName}.vercel.app`);
                    stopPolling(true);
                    return;
                }

                // ── Détection d'erreur dans le texte ─────────────────────────
                let logType: LogEntry['type'] = 'stdout';
                if (event.type === 'stderr' || text.toLowerCase().includes('error') || text.includes('ERR!')) {
                    // npm warn n'est pas bloquant
                    if (!text.toLowerCase().includes('warn') && !text.toLowerCase().includes('notice')) {
                        logType = 'stderr';
                        errorLines.current.push(text); // accumuler pour onBuildError
                        // Si erreur critique → arrêt immédiat
                        if (text.includes('ERR!') || text.includes('ENOENT') || text.includes('EACCES')) {
                            addLog(text, 'stderr');
                            stopPolling(false);
                            return;
                        }
                    }
                }

                addLog(text, logType);
            });
        } catch(e) {
            console.warn('Polling error:', e);
        }
    };

    const checkFinalStatus = async (deploymentId: string) => {
        try {
            const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.url) {
                // On utilise le nom du projet pour l'URL clean
                setDeployUrl(`https://${projectName}.vercel.app`);
                addLog(`🚀 code successfully deployed to vercel!`, 'system');
                setIsDeploying(false);
            }
        } catch(e) {}
    };

    const handleDeploy = async () => {
        if (!token || !projectName) return;
        setIsDeploying(true);
        setLogs([]);
        setDeployUrl(null);
        processedLogIds.current.clear();
        errorLines.current = [];
        addLog('Starting deployment via Vercel SDK...', 'system');

        // Safety timeout : si le déploiement tourne encore après 8 minutes → arrêt forcé
        safetyTimeout.current = setTimeout(() => {
            addLog('⏱ Timeout — déploiement trop long, arrêt forcé.', 'stderr');
            stopPolling(false);
        }, 8 * 60 * 1000);

        try {
            const response = await fetch('/api/deploy/vercel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName: projectName, // On utilise le nom édité
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
        <div className="fixed top-5 right-12 z-[9999] w-[390px] h-auto bg-[#fbfbf9] rounded-[16px] border border-[rgba(55,50,47,0.08)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            
            {/* Bouton Close (X) que tu voulais rajouter */}
            <button 
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-black/5 text-gray-400 hover:text-black transition-colors z-20"
            >
                <X size={14} />
            </button>

            <div className="flex-1 p-1 flex flex-col overflow-y-auto custom-scrollbar">
                
                {/* Header (Caché comme dans ton code original) */}
                <div className="hidden justify-between items-start bg-[#111] rounded-[12px] mb-6 p-4 border border-white/5 shrink-0">
                    {/* ... Contenu du header caché ... */}
                </div>

                {/* Formulaire */}
                <div className="space-y-4 mb-1 shrink-0">
                    <div className="space-y-1.5 w-full flex flex-col gap-1">
                        <div className="w-full border-b border-[rgba(55,50,47,0.08)] py-[3px]">
                          <p className="text-sm font-semibold text-[#212121] ml-1">Publish your app</p>
                        </div>
                    
                        {/* Champ Token (Inchangé) */}
                        <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center justify-center px-3 gap-2 focus-within:border-[rgba(55,50,47,0.08)] transition-colors">
                            <input 
                                type="password"
                                value={token}
                                onChange={(e) => handleSaveToken(e.target.value)}
                                placeholder="Your vercel token...."
                                className="bg-transparent border-[rgba(55,50,47,0.08)] outline-none text-sm text-[#212121] w-full placeholder:text-[#444]"
                            />
                            {token && <Check size={18} className="text-black" />}
                        </div>

                        {/* --- MODIFICATION 2 : Champ Nom du Projet Éditable --- */}
                        {/* J'ai enlevé la classe 'hidden' et appliqué le style exact du champ token */}
                        <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center justify-center px-3 gap-2 focus-within:border-[rgba(55,50,47,0.08)] transition-colors">
                            <input 
                                type="text"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                placeholder="project-name-here"
                                disabled={isDeploying}
                                className="bg-transparent border-none outline-none text-sm text-[#212121] w-full placeholder:text-[#444]"
                            />
                            <span className="text-[10px] text-[#888] whitespace-nowrap">.vercel.app</span>
                        </div>
                    </div>
                </div>

                {/* Console Output (Inchangé) */}
                <div className="h-[70px] shrink-0 bg-transparent w-full border-[rgba(55,50,47,0.08)] text-[10px] overflow-y-auto mb-1 custom-scrollbar">
                    <div className="space-y-1 p-2">
                        {logs.length === 0 && (
                            <p className="text-[#888] text-xs font-semibold">Deployment logs...</p>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                                <span className={`shrink-0 ${
                                    log.type === 'stderr' ? 'text-red-500' :
                                    log.type === 'success' ? 'text-green-500' : // Couleur verte pour succès
                                    log.type === 'system' ? 'text-blue-500' : 'text-[#212121]'
                                }`}>•</span>
                                <span className={
                                    log.type === 'stderr' ? 'text-orange-400' : 
                                    log.type === 'success' ? 'text-green-600 font-bold' :
                                    'text-[#212121]'
                                }>
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
                    disabled={isDeploying || !token || !projectName}
                    className={`h-[30px] w-[50%] shrink-0 rounded-[8px] text-sm font-bold transition-all flex items-center justify-center gap-2 ${
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
                        <div className="flex w-full pl-2 pr-2 pt-2 justify-between border-t border-[rgba(55,50,47,0.08)] items-center gap-1">
                            <p className="text-[12px] text-[#212121]">
                                Use a <span className="text-[#212121] font-bold">Personal Access Token</span>.
                            </p>
                            <a 
                                href="https://vercel.com/account/tokens" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[12px] text-[#888] hover:text-white transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
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
