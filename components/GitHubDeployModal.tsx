"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Github, Loader, Check, Terminal, Save, GitBranch, GitCommit, FolderGit2, ArrowRight, RefreshCw } from 'lucide-react'; 

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
        if (!token || !repoName) {
            setLogs(p => [...p, { id: Date.now().toString(), timestamp: '', message: 'Missing token or repo name', type: 'error' }]);
            return;
        }

        setIsDeploying(true);
        setLogs([]);
        setRepoUrl(null);

        try {
            const response = await fetch('/api/deploy/github', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    repoName,
                    branch,
                    commitMessage,
                    files: currentProject.files
                })
            });

            if (!response.body) throw new Error("No response from server");

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
                        
                        if (data.type === 'DONE') {
                            setRepoUrl(data.url);
                            setIsDeploying(false);
                        } else {
                            setLogs(prev => [...prev, {
                                id: Math.random().toString(),
                                timestamp: data.timestamp,
                                message: data.message,
                                type: data.type
                            }]);
                        }
                    } catch (e) {
                        console.error("Error parsing log line:", line);
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
            <div className="relative w-[900px] h-[700px] bg-[#0f0f0f] rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden">
                
                <div className="flex justify-between items-center p-5 border-b border-white/5 bg-[#141414]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                            <Github size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Push to GitHub</h2>
                            <p className="text-xs text-gray-500">Git Plumbing Pipeline</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 p-6 flex gap-6 overflow-hidden">
                    
                    <div className="w-1/3 flex flex-col gap-5 border-r border-white/5 pr-6 overflow-y-auto">
                        
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between">
                                <label className="text-xs font-medium text-gray-400 uppercase">Personal Access Token</label>
                                {token && <span className="text-[10px] text-green-500 flex items-center gap-1"><Check size={10}/> Saved</span>}
                            </div>
                            <div className="relative">
                                <input 
                                    type="password" 
                                    value={token}
                                    onChange={(e) => handleSaveToken(e.target.value)}
                                    placeholder="ghp_..."
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30 transition-colors pr-8"
                                />
                                <Save size={12} className="absolute right-3 top-3 text-gray-600" />
                            </div>
                            <p className="text-[10px] text-gray-600">Requires 'repo' scope.</p>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-medium text-gray-400 uppercase flex items-center gap-1">
                                    <FolderGit2 size={12}/> Repository Name
                                </label>
                                <input 
                                    type="text" 
                                    value={repoName}
                                    onChange={(e) => setRepoName(e.target.value)}
                                    placeholder="my-awesome-project"
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-medium text-gray-400 uppercase flex items-center gap-1">
                                    <GitBranch size={12}/> Branch
                                </label>
                                <input 
                                    type="text" 
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    placeholder="main"
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-medium text-gray-400 uppercase flex items-center gap-1">
                                    <GitCommit size={12}/> Commit Message
                                </label>
                                <input 
                                    type="text" 
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    placeholder="Initial commit"
                                    className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                                />
                            </div>
                        </div>
                        
                        <button 
                            onClick={handlePushToGitHub}
                            disabled={isDeploying || !token || !repoName}
                            className={`mt-auto w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                                isDeploying 
                                ? 'bg-gray-800 text-gray-400 cursor-not-allowed' 
                                : 'bg-white text-black hover:bg-gray-200'
                            }`}
                        >
                            {isDeploying ? (
                                <><Loader size={14} className="animate-spin" /> Pushing...</>
                            ) : (
                                'Push Changes'
                            )}
                        </button>
                    </div>

                    <div className="flex-1 flex flex-col gap-2 bg-black rounded-lg border border-white/10 p-4 font-mono text-xs h-full overflow-hidden shadow-inner">
                         <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-1">
                            <span className="text-gray-500 flex items-center gap-2 uppercase tracking-wider text-[10px]">
                                <Terminal size={12} /> Git Output
                            </span>
                            {isDeploying && <span className="text-green-500 text-[10px] animate-pulse">● Live</span>}
                         </div>

                        <div className="flex-1 overflow-y-auto space-y-1">
                            {logs.length === 0 && (
                                <div className="text-gray-700 italic h-full flex items-center justify-center">
                                    Waiting to push...
                                </div>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-3 items-start">
                                    <span className="text-gray-700 shrink-0 select-none w-[60px] text-[10px] pt-[1px]">{log.timestamp}</span>
                                    <span className={`break-all ${
                                        log.type === 'error' ? 'text-red-400 font-bold' :
                                        log.type === 'success' ? 'text-green-400' :
                                        log.type === 'warning' ? 'text-yellow-400' :
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

                {repoUrl && (
                    <div className="p-4 border-t border-white/5 bg-green-900/20 flex justify-between items-center animate-in slide-in-from-bottom-2">
                        <span className="text-green-400 text-xs flex items-center gap-2">
                            <Check size={14} /> Repository successfully updated!
                        </span>
                        <a 
                            href={repoUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="px-4 py-1.5 bg-green-600 text-white rounded-md text-xs font-bold hover:bg-green-500 flex items-center gap-2 transition-all"
                        >
                            View on GitHub <ArrowRight size={12} />
                        </a>
                    </div>
                )}

            </div>
        </div>
    );
                  }
