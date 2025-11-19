"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle, FileCode, Activity } from 'lucide-react'; 

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
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    
    // On garde une trace de l'état du déploiement pour savoir quand arrêter le polling
    const deploymentStatus = useRef<'QUEUED' | 'BUILDING' | 'READY' | 'ERROR'>('QUEUED');
    // Pour la pagination du polling (timestamp 'since')
    const lastTimestamp = useRef<number>(0);

    useEffect(() => {
        const storedToken = localStorage.getItem('vercel_token');
        if (storedToken) setToken(storedToken);
    }, []);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    const handleSaveToken = (val: string) => {
        setToken(val);
        localStorage.setItem('vercel_token', val);
    };

    const addLog = (message: string, type: LogEntry['type'] = 'system') => {
        const id = Math.random().toString(36).substr(2, 9);
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { id, timestamp, message, type }]);
    };

    // --- LOGIQUE DE FETCHING INSPIRÉE DE LA DOC VERCEL ---
    const fetchEvents = async (deploymentId: string) => {
        try {
            // On demande les événements survenus APRÈS le dernier check (since)
            // direction=forward pour lire chronologiquement
            let url = `https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward&follow=1`;
            if (lastTimestamp.current > 0) {
                url += `&since=${lastTimestamp.current}`;
            }

            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) return;

            const events = await res.json();

            // Si c'est vide, rien à faire
            if (!Array.isArray(events) || events.length === 0) return;

            events.forEach((event: any) => {
                // Mise à jour du curseur de temps
                if (event.created > lastTimestamp.current) {
                    lastTimestamp.current = event.created;
                }

                // 1. GESTION DU TYPE D'ÉVÉNEMENT
                const eventType = event.type; // stdout, stderr, deployment-state, etc.
                const payload = event.payload || {};
                const text = payload.text || event.text || ''; // La doc dit payload.text

                // A. Changement d'état du déploiement
                if (eventType === 'deployment-state') {
                    const newState = payload.info?.readyState || payload.readyState;
                    if (newState) {
                        deploymentStatus.current = newState;
                        addLog(`State changed to: ${newState}`, 'system');
                        
                        if (newState === 'READY') {
                            // Succès final
                            setIsDeploying(false);
                            if (deployUrl) addLog(`Site is live at ${deployUrl}`, 'success');
                        }
                        if (newState === 'ERROR' || newState === 'CANCELED') {
                            setIsDeploying(false);
                            addLog('Deployment stopped due to error.', 'stderr');
                        }
                    }
                }
                
                // B. Logs de build (stdout/stderr)
                else if (text) {
                    // Filtrer les logs inintéressants si besoin
                    let logType: LogEntry['type'] = 'stdout';
                    
                    if (eventType === 'stderr' || text.toLowerCase().includes('error')) {
                        logType = 'stderr';
                    }

                    setLogs(prev => [...prev, {
                        id: event.id || Math.random().toString(),
                        timestamp: new Date(event.created).toLocaleTimeString(),
                        message: text,
                        type: logType
                    }]);
                }
            });

        } catch (e) {
            console.error("Polling error:", e);
        }
    };

    // --- BOUCLE DE POLLING ---
    const startPolling = (deploymentId: string) => {
        deploymentStatus.current = 'BUILDING';
        lastTimestamp.current = 0; // Reset

        const interval = setInterval(async () => {
            // 1. Si le déploiement est fini (succès ou erreur), on arrête
            if (deploymentStatus.current === 'READY' || deploymentStatus.current === 'ERROR' || deploymentStatus.current === 'CANCELED') {
                clearInterval(interval);
                setIsDeploying(false);
                return;
            }

            // 2. On fetch les nouveaux logs
            await fetchEvents(deploymentId);
            
            // 3. Check de sécurité : Vérifier le statut global au cas où on a raté l'événement 'deployment-state'
            try {
                const statusRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const statusData = await statusRes.json();
                
                // Mise à jour de l'URL si dispo
                if (statusData.url && !deployUrl) {
                    setDeployUrl(`https://${statusData.url}`);
                }

                // Si le statut API dit que c'est fini, on force l'arrêt
                if (statusData.readyState === 'READY' || statusData.readyState === 'ERROR') {
                    deploymentStatus.current = statusData.readyState;
                }
            } catch (e) { /* Silence network errors on status check */ }

        }, 1500); // Check toutes les 1.5 secondes
    };

    const handleDeploy = async () => {
        if (!token) {
            addLog('Error: Vercel Token is missing.', 'stderr');
            return;
        }
        
        setIsDeploying(true);
        setLogs([]);
        setDeployUrl(null);
        deploymentStatus.current = 'QUEUED';
        addLog('Initializing deployment...', 'system');

        try {
            // 1. Envoi des fichiers à notre API route
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
                throw new Error(data.error || 'Deployment creation failed');
            }

            addLog('Files uploaded. Waiting for build pipeline...', 'system');
            
            // 2. Démarrage du polling intelligent
            startPolling(data.deploymentId);

        } catch (error: any) {
            addLog(`API Error: ${error.message}`, 'stderr');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[800px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Deploy to Vercel</h2>
                            <p className="text-xs text-gray-500">Live Build Events</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex flex-col gap-6">
                    
                    {/* Token Input */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Vercel Access Token</label>
                        <input 
                            type="password" 
                            value={token}
                            onChange={(e) => handleSaveToken(e.target.value)}
                            placeholder="Paste your token..."
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    {/* Console Logs */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 p-4 font-mono text-xs h-[400px] overflow-y-auto shadow-inner flex flex-col gap-0.5">
                        {logs.length === 0 && (
                            <div className="text-gray-600 italic flex items-center gap-2 p-2">
                                <Terminal size={14} /> Ready...
                            </div>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className="flex gap-3 items-start hover:bg-white/5 px-2 py-0.5 rounded">
                                <span className="text-gray-600 shrink-0 select-none w-[60px] text-[10px] pt-0.5 font-light opacity-50">
                                    {log.timestamp}
                                </span>
                                <span className={`break-all whitespace-pre-wrap ${
                                    log.type === 'stderr' ? 'text-red-400 font-semibold' : // Rouge pour les erreurs
                                    log.type === 'success' ? 'text-green-400' :
                                    log.type === 'system' ? 'text-blue-300' : // Bleu pour les infos système
                                    'text-gray-300' // Gris pour stdout standard
                                }`}>
                                    {log.type === 'stderr' && <AlertCircle size={10} className="inline mr-1.5 -mt-0.5"/>}
                                    {log.type === 'system' && <Activity size={10} className="inline mr-1.5 -mt-0.5"/>}
                                    {log.message}
                                </span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>

                </div>

                {/* Footer */}
                <div className="p-5 border-t border-white/5 bg-[#141414] flex justify-between items-center">
                    <div>
                        {deployUrl && (
                            <a 
                                href={deployUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-xs text-green-400 hover:text-green-300 underline decoration-dotted flex items-center gap-1"
                            >
                                <Check size={12} /> Open Live Deployment
                            </a>
                        )}
                    </div>
                    
                    <button 
                        onClick={handleDeploy}
                        disabled={isDeploying || !token}
                        className={`px-6 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
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
                            <>
                                <FileCode size={16} />
                                Start Deployment
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
              }
