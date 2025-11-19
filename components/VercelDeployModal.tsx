"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle } from 'lucide-react'; 

interface VercelDeployModalProps {
    currentProject: any;
    isOpen: boolean;
    onClose: () => void;
}

interface LogEntry {
    timestamp: string;
    message: string;
    type: 'info' | 'error' | 'success' | 'warning' | 'system';
}

export default function VercelDeployModal({ currentProject, isOpen, onClose }: VercelDeployModalProps) {
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    
    const processedEventIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        const storedToken = localStorage.getItem('vercel_token');
        if (storedToken) setToken(storedToken);
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const addLog = (message: string, type: LogEntry['type'] = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        // Évite les doublons exacts consécutifs
        setLogs(prev => {
            const last = prev[prev.length - 1];
            if (last && last.message === message) return prev;
            return [...prev, { timestamp, message, type }];
        });
    };

    const handleSaveToken = (val: string) => {
        setToken(val);
        localStorage.setItem('vercel_token', val);
    };

    // --- RÉCUPÉRATION DES LOGS STREAMÉS ---
    const fetchBuildLogs = async (deploymentId: string) => {
        try {
            const res = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            if (!res.ok) return;

            const events = await res.json();
            
            events.forEach((event: any) => {
                if (processedEventIds.current.has(event.id)) return;
                processedEventIds.current.add(event.id);
                
                let type: LogEntry['type'] = 'system';
                const text = event.payload?.text || event.text || '';
                
                if (!text) return;

                if (event.type === 'error' || text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
                    type = 'error';
                } else if (text.toLowerCase().includes('warn')) {
                    type = 'warning';
                } else if (text.includes('Running build') || text.includes('Installing')) {
                    type = 'info';
                }

                // Nettoyage du timestamp
                const time = new Date(event.created).toLocaleTimeString();
                setLogs(prev => [...prev, { timestamp: time, message: text, type }]);
            });

        } catch (e) {
            console.error("Log fetch error:", e);
        }
    };

    // --- POLLING DU STATUT (AVEC GESTION D'ERREUR DÉTAILLÉE) ---
    const pollDeploymentStatus = async (deploymentId: string) => {
        const checkStatus = async () => {
            try {
                // 1. Récupérer les logs
                await fetchBuildLogs(deploymentId);

                // 2. Vérifier le statut
                const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                
                // CAS 1 : SUCCÈS
                if (data.readyState === 'READY') {
                    addLog('Build pipeline completed.', 'success');
                    addLog(`URL: https://${data.url}`, 'success');
                    setDeployUrl(`https://${data.url}`);
                    setIsDeploying(false);
                    return true; 
                } 
                // CAS 2 : ERREUR (C'est ici que l'on capture le détail manquant)
                else if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
                    
                    // On cherche le message d'erreur précis fourni par Vercel
                    const errorMsg = data.error?.message || data.error?.code || 'Unknown build error';
                    
                    addLog(`❌ STOPPED: ${data.readyState}`, 'error');
                    addLog(`Reason: ${errorMsg}`, 'error'); // <--- AFFICHE LA VRAIE RAISON
                    
                    setIsDeploying(false);
                    return true; 
                } 
                
                return false; 
            } catch (e) {
                return false;
            }
        };

        // Intervalle de 2.5 secondes
        const interval = setInterval(async () => {
            const finished = await checkStatus();
            if (finished) clearInterval(interval);
        }, 2500);
    };

    const handleDeploy = async () => {
        if (!token) {
            addLog('Error: Vercel Token is missing.', 'error');
            return;
        }
        
        setIsDeploying(true);
        setLogs([]); 
        processedEventIds.current.clear(); 
        setDeployUrl(null);
        addLog('Initializing deployment...', 'info');

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

            if (!response.ok) throw new Error(data.error || 'Deployment creation failed');

            addLog('Files uploaded. Queued for build...', 'info');
            
            pollDeploymentStatus(data.deploymentId);

        } catch (error: any) {
            addLog(`Error: ${error.message}`, 'error');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[700px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Deploy to Vercel</h2>
                            <p className="text-xs text-gray-500">Live Build Logs</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Vercel Access Token</label>
                        <input 
                            type="password" 
                            value={token}
                            onChange={(e) => handleSaveToken(e.target.value)}
                            placeholder="Paste your token (ey...)"
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-gray-700"
                        />
                    </div>

                    <div className="flex-1 bg-black rounded-lg border border-white/10 p-4 font-mono text-xs h-[350px] overflow-y-auto shadow-inner flex flex-col gap-1">
                        {logs.length === 0 && (
                            <div className="text-gray-700 italic flex items-center gap-2">
                                <Terminal size={12} /> Ready to deploy...
                            </div>
                        )}
                        {logs.map((log, i) => (
                            <div key={i} className="flex gap-3 items-start border-b border-white/5 pb-1 mb-1 last:border-0">
                                <span className="text-gray-600 shrink-0 select-none w-[60px] text-[10px] pt-0.5">{log.timestamp}</span>
                                <span className={`break-all whitespace-pre-wrap ${
                                    log.type === 'error' ? 'text-red-400 font-bold' :
                                    log.type === 'success' ? 'text-green-400' :
                                    log.type === 'warning' ? 'text-yellow-400' :
                                    log.type === 'system' ? 'text-gray-400' : 
                                    'text-blue-300'
                                }`}>
                                    {log.type === 'error' && <AlertCircle size={12} className="inline mr-1 mb-0.5"/>}
                                    {log.message}
                                </span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                <div className="p-5 border-t border-white/5 bg-[#141414] flex justify-between items-center">
                    <div>
                        {deployUrl && (
                            <a 
                                href={deployUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-xs text-green-400 hover:text-green-300 underline decoration-dotted flex items-center gap-1"
                            >
                                <Check size={12} /> Visit Live Site
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
                            'Deploy Project'
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
                }
