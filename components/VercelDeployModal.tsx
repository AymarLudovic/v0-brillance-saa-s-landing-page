"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle, ArrowRight } from 'lucide-react'; 

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
    
    // On utilise un Set pour garantir qu'aucun log n'est affiché en double
    const processedLogIds = useRef<Set<string>>(new Set());
    const pollingInterval = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const storedToken = localStorage.getItem('vercel_token');
        if (storedToken) setToken(storedToken);
        
        return () => stopPolling(); // Cleanup
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleSaveToken = (val: string) => {
        setToken(val);
        localStorage.setItem('vercel_token', val);
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

    // --- C'EST ICI QUE TOUT SE JOUE POUR LES LOGS ---
    const fetchLogsAndStatus = async (deploymentId: string) => {
        try {
            // 1. Récupérer les logs (Events)
            // On demande TOUS les événements sans filtre de temps pour être sûr de ne rien rater au début
            const logsRes = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events?direction=forward`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (logsRes.ok) {
                const events = await logsRes.json();
                
                events.forEach((event: any) => {
                    // Anti-doublon strict
                    if (processedLogIds.current.has(event.id)) return;
                    processedLogIds.current.add(event.id);

                    // Extraction du texte (Vercel met parfois le texte dans payload.text)
                    const text = event.payload?.text || event.text || '';
                    if (!text) return;

                    let type: LogEntry['type'] = 'stdout';
                    const lowerText = text.toLowerCase();

                    // Détection des erreurs pour la coloration rouge
                    if (event.type === 'stderr' || lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('err:')) {
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

            // 2. Vérifier le statut global du déploiement
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
                // On affiche l'erreur critique finale
                const errorCode = statusData.error?.code || 'UNKNOWN_ERROR';
                addLog(`❌ Build Failed: ${errorCode}`, 'stderr');
                setIsDeploying(false);
            }

        } catch (e) {
            console.error("Polling error:", e);
        }
    };

    const handleDeploy = async () => {
        if (!token) {
            addLog('Error: Vercel Token is missing.', 'stderr');
            return;
        }
        
        setIsDeploying(true);
        setLogs([]);
        setDeployUrl(null);
        processedLogIds.current.clear();
        addLog('Uploading project files...', 'system');

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
                throw new Error(data.error || 'Deployment failed');
            }

            addLog('Files uploaded. Waiting for build start...', 'system');

            // Démarrage du polling (toutes les 2 secondes)
            pollingInterval.current = setInterval(() => {
                fetchLogsAndStatus(data.deploymentId);
            }, 2000);

        } catch (error: any) {
            addLog(`Error: ${error.message}`, 'stderr');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[850px] h-[600px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Vercel Deployment</h2>
                            <p className="text-xs text-gray-500">Live Build Logs</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
                    
                    {/* Token Section */}
                    {!isDeploying && !deployUrl && (
                        <div className="flex flex-col gap-2 mb-2">
                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Access Token</label>
                            <input 
                                type="password" 
                                value={token}
                                onChange={(e) => handleSaveToken(e.target.value)}
                                placeholder="ey..."
                                className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    )}

                    {/* Terminal Window */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 flex flex-col overflow-hidden font-mono text-xs shadow-inner">
                        <div className="bg-[#1a1a1a] px-4 py-2 border-b border-white/5 text-gray-500 flex items-center gap-2 text-[10px] uppercase tracking-wider">
                            <Terminal size={12} /> Build Console
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4 space-y-1">
                            {logs.length === 0 && (
                                <div className="text-gray-700 italic">Waiting for command...</div>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-3 items-start group">
                                    <span className="text-gray-700 shrink-0 select-none w-[60px] text-[10px] pt-[2px]">{log.timestamp}</span>
                                    <span className={`break-all whitespace-pre-wrap ${
                                        log.type === 'stderr' ? 'text-red-400 font-bold' :
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
                        {isDeploying ? 'Deployment in progress...' : 'Ready to deploy'}
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
