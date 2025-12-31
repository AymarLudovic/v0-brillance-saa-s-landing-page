"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Github, Loader, Check, Terminal, GitBranch, GitCommit, ArrowRight } from 'lucide-react'; 
import { ArrowUp } from 'lucide-react';

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

const saveGitHubTokenToIDB = async (token: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const request = store.put(token, 'github_access_token');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getGitHubTokenFromIDB = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('github_access_token');
    request.onsuccess = () => resolve(request.result ? request.result as string : null);
    request.onerror = () => reject(request.error);
  });
};

interface GitHubDeployModalProps {
    currentProject: any;
    isOpen: boolean;
    onClose: () => void;
}

interface LogEntry {
    id: string;
    timestamp: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

export default function GitHubDeployModal({ currentProject, isOpen, onClose }: GitHubDeployModalProps) {
    const [token, setToken] = useState('');
    const [repoName, setRepoName] = useState('');
    const [branch, setBranch] = useState('main');
    const [commitMessage, setCommitMessage] = useState('Initial commit from Studio Code');
    
    const [isDeploying, setIsDeploying] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [repoUrl, setRepoUrl] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const loadToken = async () => {
            try {
                const savedToken = await getGitHubTokenFromIDB();
                if (savedToken) setToken(savedToken);
            } catch (e) { console.error(e); }
        };
        
        if (isOpen) {
            loadToken();
            if (currentProject?.name) {
                setRepoName(currentProject.name.toLowerCase().replace(/\s+/g, '-'));
            }
        }
    }, [isOpen, currentProject]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    const handleSaveToken = async (val: string) => {
        setToken(val);
        await saveGitHubTokenToIDB(val);
    };

const handlePushToGitHub = async () => {
        if (!token || !repoName) return;
        setIsDeploying(true);
        setLogs([]);
        setRepoUrl(null);

        try {
            const response = await fetch('/api/deploy/github', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token, repoName, branch, commitMessage,
                    files: currentProject.files
                })
            });

            if (!response.body) throw new Error("No response");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                for (let i = 0; i < lines.length - 1; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    try {
                        const data = JSON.parse(line);
                        
                        // CONDITION DE FIN 1 : Type DONE
                        if (data.type === 'DONE') {
                            setRepoUrl(data.url);
                            setIsDeploying(false);
                        } 
                        
                        // AJOUT : On scanne aussi le message pour arrêter le bouton
                        if (data.message && data.message.includes('🚀')) {
                            setIsDeploying(false);
                            // Si l'URL est dans le message mais pas encore en state
                            if (data.url) setRepoUrl(data.url);
                        }

                        // Mise à jour des logs
                        if (data.type !== 'DONE') {
                            setLogs(prev => [...prev, {
                                id: Math.random().toString(),
                                timestamp: data.timestamp,
                                message: data.message,
                                type: data.type
                            }]);
                        }
                    } catch (e) {
                        console.error("Parse error", e);
                    }
                }
                buffer = lines[lines.length - 1];
            }
        } catch (error: any) {
            setLogs(prev => [...prev, { id: 'err', timestamp: '', message: error.message, type: 'error' }]);
            setIsDeploying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            
            <div className="relative w-[420px] max-h-[95vh] bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
                
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1.5 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-20"
                >
                    <X size={18} />
                </button>

                <div className="flex-1 p-6 flex flex-col overflow-y-auto custom-scrollbar">
                    
                    {/* Header */}
                    <div className="flex justify-between items-start bg-[#111] rounded-[12px] mb-6 p-4 border border-white/5 shrink-0">
                        <div>
                            <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#000] border border-white/10 text-[10px] font-medium text-[#e4e4e4] mb-2 tracking-wider">
                                Git Pipeline
                            </div>
                            <h2 className="text-xl font-bold text-white leading-tight">
                                Push to GitHub
                            </h2>
                            <p className="text-[11px] text-[#888] mt-1">
                                Deploy your code to a repository.
                            </p>
                        </div>
                        <div className="bg-[#0a0a0a] p-1 rounded-2xl border border-white/5 shadow-inner">
                            <img className="h-[70px] w-[70px] object-contain" src="/3dicons-locker-dynamic-premium.png" alt="Locker Icon" />
                        </div>
                    </div>

                    {/* Formulaire */}
                    <div className="space-y-4 mb-6 shrink-0">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-[#666] ml-1">Personal access token</label>
                            <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3 gap-2 focus-within:border-white/30 transition-colors">
                                <input 
                                    type="password"
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="Your GitHub access token...."
                                    className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]"
                                />
                                {token && <Check size={14} className="text-green-500" />}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-[#666] ml-1">Repo name</label>
                                <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                                    <input 
                                        type="text"
                                        value={repoName}
                                        onChange={(e) => setRepoName(e.target.value)}
                                        className="bg-transparent border-none outline-none text-xs text-white w-full"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-[#666] ml-1">Branch</label>
                                <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                                    <input 
                                        type="text"
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                        className="bg-transparent border-none outline-none text-xs text-white w-full"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-[#666] ml-1">Commit message</label>
                            <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                                <input 
                                    type="text"
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Git Output - Fixé en hauteur pour ne pas bouger le modal */}
                    <div className="h-[140px] shrink-0 bg-[#050505] rounded-xl border border-white/5 p-3 font-mono text-[10px] overflow-y-auto mb-6 custom-scrollbar">
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5 text-[#444] tracking-tighter font-bold">
                            <Terminal size={10} /> Git Output
                        </div>
                        <div className="space-y-1">
                            {logs.length === 0 && (
                                <p className="text-[#333] italic">Ready to deploy...</p>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                                    <span className={`shrink-0 ${
                                        log.type === 'error' ? 'text-red-500' :
                                        log.type === 'success' ? 'text-green-500' : 'text-[#666]'
                                    }`}>•</span>
                                    <span className={log.type === 'error' ? 'text-red-400' : 'text-gray-400'}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>

                    {/* Bouton Action */}
                    <button 
                        onClick={handlePushToGitHub}
                        disabled={isDeploying || !token || !repoName}
                        className={`w-full h-11 shrink-0 rounded-[12px] text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                            isDeploying 
                            ? 'bg-[#1a1a1a] text-[#444] cursor-not-allowed' 
                            : 'bg-white text-black hover:bg-gray-200 shadow-white/5'
                        }`}
                    >
                        {isDeploying ? (
                            <><Loader size={16} className="animate-spin" /> Deploying...</>
                        ) : (
                            <>Push changes <ArrowRight size={16} /></>
                        )}
                    </button>

                    {/* Footer Links */}
                    <div className="mt-4 flex flex-col items-center gap-1 shrink-0 pb-2">
                        {repoUrl ? (
                            <a 
                                href={repoUrl} 
                                target="_blank" 
                                className="text-[10px] text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
                            >
                                View repository on GitHub <ArrowUp size={10} className="rotate-45" />
                            </a>
                        ) : (
                            <div className="flex flex-col items-center gap-1">
                                <p className="text-[10px] text-[#444]">
                                    Make sure to check the <span className="text-[#666] font-bold">repo</span> scope.
                                </p>
                                <a 
                                    href="https://github.com/settings/tokens/new?scopes=repo&description=StudioCode" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-[#888] hover:text-white transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
                                >
                                    Get your access token here
                                    <ArrowUp size={10} className="rotate-45" />
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
           }
