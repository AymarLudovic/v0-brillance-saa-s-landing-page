"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal } from 'lucide-react'; 

interface VercelDeployModalProps {
    currentProject: any;
    isOpen: boolean;
    onClose: () => void;
}

interface LogEntry {
    timestamp: string;
    message: string;
    type: 'info' | 'error' | 'success' | 'warning';
}

export default function VercelDeployModal({ currentProject, isOpen, onClose }: VercelDeployModalProps) {
    const [token, setToken] = useState('');
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [deployUrl, setDeployUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    
    // Chargement du token depuis localStorage au montage
    useEffect(() => {
        const storedToken = localStorage.getItem('vercel_token');
        if (storedToken) setToken(storedToken);
    }, []);

    // Scroll automatique vers le bas des logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const addLog = (message: string, type: LogEntry['type'] = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { timestamp, message, type }]);
    };

    const handleSaveToken = (val: string) => {
        setToken(val);
        localStorage.setItem('vercel_token', val);
    };

    // FONCTION POUR SUIVRE L'ÉTAT DU DÉPLOIEMENT (Simule le stream de logs)
    const pollDeploymentStatus = async (deploymentId: string) => {
        const checkStatus = async () => {
            try {
                const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                
                if (data.readyState === 'READY') {
                    addLog('Build completed successfully.', 'success');
                    addLog('Finalizing deployment...', 'info');
                    addLog(`Available at: https://${data.url}`, 'success');
                    setDeployUrl(`https://${data.url}`);
                    setIsDeploying(false);
                    return true; // Stop polling
                } else if (data.readyState === 'ERROR') {
                    addLog('Deployment failed on Vercel side.', 'error');
                    setIsDeploying(false);
                    return true; // Stop polling
                } else if (data.readyState === 'BUILDING') {
                    // Astuce pour simuler de l'activité si on est toujours en building
                    if (Math.random() > 0.7) addLog('Running build command (bun run build)...', 'info');
                } else {
                    addLog(`Current Status: ${data.readyState}`, 'warning');
                }
                return false; // Continue polling
            } catch (e) {
                return false;
            }
        };

        // Boucle de polling toutes les 2 secondes
        const interval = setInterval(async () => {
            const finished = await checkStatus();
            if (finished) clearInterval(interval);
        }, 2000);
    };

    const handleDeploy = async () => {
        if (!token) {
            addLog('Error: Vercel Token is missing.', 'error');
            return;
        }
        
        setIsDeploying(true);
        setLogs([]); // Reset logs
        setDeployUrl(null);
        addLog('Preparing files for upload...', 'info');

        try {
            // 1. Appel à notre route API Next.js
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

            addLog('Project files uploaded to Vercel.', 'success');
            addLog(`Deployment ID: ${data.deploymentId}`, 'info');
            addLog('Waiting for build pipeline...', 'warning');

            // 2. Commencer le suivi (Polling)
            pollDeploymentStatus(data.deploymentId);

        } catch (error: any) {
            addLog(`Error: ${error.message}`, 'error');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[600px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Deploy to Vercel</h2>
                            <p className="text-xs text-gray-500">Production deployment pipeline</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex flex-col gap-6">
                    
                    {/* Token Input (si pas défini ou pour changer) */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Vercel Access Token</label>
                        <input 
                            type="password" 
                            value={token}
                            onChange={(e) => handleSaveToken(e.target.value)}
                            placeholder="Paste your token (ey...)"
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors placeholder:text-gray-700"
                        />
                        <p className="text-[10px] text-gray-600">
                            Settings {'>'} Tokens on Vercel Dashboard. Saved locally.
                        </p>
                    </div>

                    {/* Terminal / Logs Container */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 p-4 font-mono text-xs h-[250px] overflow-y-auto shadow-inner flex flex-col gap-1">
                        {logs.length === 0 && (
                            <div className="text-gray-700 italic flex items-center gap-2">
                                <Terminal size={12} /> Ready to deploy...
                            </div>
                        )}
                        {logs.map((log, i) => (
                            <div key={i} className="flex gap-3 items-start animate-in slide-in-from-left-2 duration-300">
                                <span className="text-gray-600 shrink-0 select-none">[{log.timestamp}]</span>
                                <span className={`break-all ${
                                    log.type === 'error' ? 'text-red-400' :
                                    log.type === 'success' ? 'text-green-400' :
                                    log.type === 'warning' ? 'text-yellow-400' :
                                    'text-gray-300'
                                }`}>
                                    {log.type === 'success' && '✓ '}
                                    {log.type === 'error' && '✕ '}
                                    {log.type === 'warning' && '⚠ '}
                                    {log.message}
                                </span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>

                </div>

                {/* Footer / Actions */}
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
                            <>
                                Deploy Project
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
                    }
