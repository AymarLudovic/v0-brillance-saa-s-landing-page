"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, Loader, Check, Terminal, AlertCircle, FileCode } from 'lucide-react'; 

interface VercelDeployModalProps {
    currentProject: any;
    isOpen: boolean;
    onClose: () => void;
}

interface LogEntry {
    id: string; // Unique ID pour éviter doublons
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
    
    // Set pour traquer les IDs d'événements déjà affichés
    const processedEventIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        const storedToken = localStorage.getItem('vercel_token');
        if (storedToken) setToken(storedToken);
    }, []);

    useEffect(() => {
        // Auto-scroll
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    const addLog = (message: string, type: LogEntry['type'] = 'info') => {
        const id = Date.now().toString() + Math.random().toString();
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { id, timestamp, message, type }]);
    };

    const handleSaveToken = (val: string) => {
        setToken(val);
        localStorage.setItem('vercel_token', val);
    };

    // --- RÉCUPÉRATION DES LOGS (SANS FILTRE) ---
    const fetchBuildLogs = async (deploymentId: string) => {
        try {
            // On ne met pas de filtre direction pour tout avoir
            const res = await fetch(`https://api.vercel.com/v2/deployments/${deploymentId}/events`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            if (!res.ok) return;

            const events = await res.json();
            
            events.forEach((event: any) => {
                // Anti-doublon strict via l'ID de l'événement Vercel
                if (processedEventIds.current.has(event.id)) return;
                processedEventIds.current.add(event.id);
                
                const text = event.payload?.text || event.text || '';
                if (!text) return;

                let type: LogEntry['type'] = 'system';
                const lowerText = text.toLowerCase();

                if (event.type === 'error' || lowerText.includes('error') || lowerText.includes('failed')) {
                    type = 'error';
                } else if (lowerText.includes('warn')) {
                    type = 'warning';
                } else if (lowerText.includes('installing') || lowerText.includes('building')) {
                    type = 'info';
                }

                // On ajoute le log tel quel
                const time = new Date(event.created).toLocaleTimeString();
                setLogs(prev => [...prev, { id: event.id, timestamp: time, message: text, type }]);
            });

        } catch (e) {
            console.error("Log fetch error:", e);
        }
    };

    const pollDeploymentStatus = async (deploymentId: string) => {
        const checkStatus = async () => {
            try {
                // 1. Logs
                await fetchBuildLogs(deploymentId);

                // 2. Statut Global
                const res = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                
                if (data.readyState === 'READY') {
                    addLog('Deployment Complete!', 'success');
                    setDeployUrl(`https://${data.url}`);
                    setIsDeploying(false);
                    return true; 
                } 
                else if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
                    // Si erreur, on essaie d'afficher le code d'erreur interne de Vercel
                    const errorDetails = data.error ? `Code: ${data.error.code} - ${data.error.message}` : 'Unknown Error';
                    addLog(`❌ CRITICAL FAILURE: ${errorDetails}`, 'error');
                    setIsDeploying(false);
                    return true; 
                } 
                
                return false; 
            } catch (e) {
                return false;
            }
        };

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
        setLogs([]); 
        processedEventIds.current.clear(); 
        setDeployUrl(null);
        addLog('Initiating deployment sequence...', 'info');

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
                throw new Error(data.error || 'Deployment creation failed');
            }

            addLog('Files uploaded successfully.', 'success');
            addLog('Waiting for build logs...', 'warning');
            
            pollDeploymentStatus(data.deploymentId);

        } catch (error: any) {
            addLog(`API Error: ${error.message}`, 'error');
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-[800px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-black rounded-lg border border-white/10">
                            <Zap size={20} className="text-white" fill="currentColor" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Deploy to Vercel</h2>
                            <p className="text-xs text-gray-500">Live Build Console</p>
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
                            placeholder="Paste your token..."
                            className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-white/30 transition-colors"
                        />
                    </div>

                    {/* Console style logs */}
                    <div className="flex-1 bg-black rounded-lg border border-white/10 p-4 font-mono text-xs h-[400px] overflow-y-auto shadow-inner flex flex-col gap-0.5">
                        {logs.length === 0 && (
                            <div className="text-gray-600 italic flex items-center gap-2 p-2">
                                <Terminal size={14} /> Waiting for command...
                            </div>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className="flex gap-3 items-start hover:bg-white/5 px-2 py-1 rounded">
                                <span className="text-gray-600 shrink-0 select-none w-[60px] text-[10px] pt-0.5 font-light">{log.timestamp}</span>
                                <span className={`break-all whitespace-pre-wrap ${
                                    log.type === 'error' ? 'text-red-500 font-bold' :
                                    log.type === 'success' ? 'text-green-400' :
                                    log.type === 'warning' ? 'text-yellow-400' :
                                    log.type === 'system' ? 'text-gray-400' : 
                                    'text-blue-300'
                                }`}>
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
