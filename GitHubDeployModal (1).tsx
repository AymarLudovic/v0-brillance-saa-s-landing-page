"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Github, Loader, Check, Terminal, ArrowRight, ArrowUp } from 'lucide-react';

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

// Timeout de sécurité : 3 minutes max pour un push GitHub
const MAX_GITHUB_WAIT_MS = 3 * 60 * 1000;

export default function GitHubDeployModal({ currentProject, isOpen, onClose }: GitHubDeployModalProps) {
  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('Initial commit from Studio Code');
  const [isDeploying, setIsDeploying] = useState(false);
  const [pushFailed, setPushFailed] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const safetyTimeout = useRef<NodeJS.Timeout | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    const loadToken = async () => {
      try {
        const savedToken = await getGitHubTokenFromIDB();
        if (savedToken) setToken(savedToken);
      } catch (e) { console.error(e); }
    };
    if (isOpen) {
      loadToken();
      if (currentProject?.name) setRepoName(currentProject.name.toLowerCase().replace(/\s+/g, '-'));
      setLogs([]);
      setRepoUrl(null);
      setPushFailed(false);
    }
    return () => {
      clearSafetyTimeout();
      // Annuler le stream si le modal est fermé pendant un push
      try { readerRef.current?.cancel(); } catch {}
    };
  }, [isOpen, currentProject]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSaveToken = async (val: string) => {
    setToken(val);
    await saveGitHubTokenToIDB(val);
  };

  const clearSafetyTimeout = () => {
    if (safetyTimeout.current) { clearTimeout(safetyTimeout.current); safetyTimeout.current = null; }
  };

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { id: Math.random().toString(), timestamp: new Date().toLocaleTimeString(), message, type }]);
  };

  // ── Fin propre du push ─────────────────────────────────────────────────────
  const finishPush = (success: boolean, url?: string) => {
    clearSafetyTimeout();
    setIsDeploying(false);
    if (success) {
      setPushFailed(false);
      if (url) setRepoUrl(url);
    } else {
      setPushFailed(true);
    }
  };

  const handlePushToGitHub = async () => {
    if (!token || !repoName) return;
    setIsDeploying(true);
    setPushFailed(false);
    setLogs([]);
    setRepoUrl(null);

    // Safety timeout — garantit que le bouton se débloque quoi qu'il arrive
    safetyTimeout.current = setTimeout(() => {
      addLog('⚠️ Délai max dépassé — push potentiellement en cours côté GitHub.', 'warning');
      try { readerRef.current?.cancel(); } catch {}
      finishPush(false);
    }, MAX_GITHUB_WAIT_MS);

    try {
      const response = await fetch('/api/deploy/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, repoName, branch, commitMessage, files: currentProject.files })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error("Pas de réponse du serveur");

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const data = JSON.parse(line);

            // ── Détection de fin par type DONE ──────────────────────────
            if (data.type === 'DONE' || data.type === 'success') {
              finishPush(true, data.url);
              if (data.url) addLog(`🚀 Poussé vers GitHub: ${data.url}`, 'success');
              finished = true;
              break;
            }

            // ── Détection de fin par type error ─────────────────────────
            if (data.type === 'error') {
              addLog(`❌ ${data.message}`, 'error');
              finishPush(false);
              finished = true;
              break;
            }

            // ── Détection dans le message (fallback) ─────────────────────
            if (data.message) {
              // URL GitHub dans le message → succès
              if (data.message.includes('github.com') && data.message.includes('https://')) {
                const urlMatch = data.message.match(/https:\/\/github\.com\/[^\s]+/);
                finishPush(true, urlMatch?.[0]);
                finished = true;
              }
              // Emoji succès
              if (data.message.includes('🚀') || data.message.includes('successfully')) {
                finishPush(true, data.url);
                finished = true;
              }
              // Erreur dans le message
              if (data.type === 'error' || (data.message.toLowerCase().includes('error') && data.type !== 'info')) {
                addLog(data.message, 'error');
                finishPush(false);
                finished = true;
                break;
              }

              addLog(data.message, data.type ?? 'info');
            }
          } catch (e) {
            // Ligne non-JSON — ignorer silencieusement
          }
        }
        buffer = lines[lines.length - 1];
      }

      // Si la boucle s'est terminée sans DONE explicite et pas encore fini
      if (!finished) {
        // Le stream s'est fermé proprement — considérer comme succès si on a des logs positifs
        const hasSuccess = logs.some(l => l.type === 'success') || repoUrl !== null;
        if (!hasSuccess) {
          addLog('ℹ️ Stream terminé — vérifiez votre dépôt GitHub.', 'warning');
          finishPush(false);
        } else {
          finishPush(true);
        }
      }

    } catch (error: any) {
      addLog(`❌ ${error.message}`, 'error');
      finishPush(false);
    } finally {
      readerRef.current = null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-[420px] max-h-[95vh] bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-20">
          <X size={18} />
        </button>

        <div className="flex-1 p-6 flex flex-col overflow-y-auto custom-scrollbar">
          {/* Header */}
          <div className="flex justify-between items-start bg-[#111] rounded-[12px] mb-6 p-4 border border-white/5 shrink-0">
            <div>
              <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#000] border border-white/10 text-[10px] font-medium text-[#e4e4e4] mb-2 tracking-wider">Git Pipeline</div>
              <h2 className="text-xl font-bold text-white leading-tight">Push to GitHub</h2>
              <p className="text-[11px] text-[#888] mt-1">Deploy your code to a repository.</p>
            </div>
            <Github size={40} className="text-white/20 mt-1" />
          </div>

          {/* Form */}
          <div className="space-y-4 mb-6 shrink-0">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#666] ml-1">Personal access token</label>
              <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3 gap-2 focus-within:border-white/30 transition-colors">
                <input type="password" value={token} onChange={(e) => handleSaveToken(e.target.value)} placeholder="Your GitHub access token...." className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]" />
                {token && <Check size={14} className="text-green-500" />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#666] ml-1">Repo name</label>
                <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                  <input type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)} className="bg-transparent border-none outline-none text-xs text-white w-full" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#666] ml-1">Branch</label>
                <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                  <input type="text" value={branch} onChange={(e) => setBranch(e.target.value)} className="bg-transparent border-none outline-none text-xs text-white w-full" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[#666] ml-1">Commit message</label>
              <div className="h-10 bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3">
                <input type="text" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]" />
              </div>
            </div>
          </div>

          {/* Logs */}
          <div className="h-[140px] shrink-0 bg-[#050505] rounded-xl border border-white/5 p-3 font-mono text-[10px] overflow-y-auto mb-6 custom-scrollbar">
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5 text-[#444] tracking-tighter font-bold">
              <Terminal size={10} /> Git Output
            </div>
            <div className="space-y-1">
              {logs.length === 0 && <p className="text-[#333] italic">Ready to deploy...</p>}
              {logs.map((log) => (
                <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                  <span className={`shrink-0 ${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-500' : log.type === 'warning' ? 'text-yellow-500' : 'text-[#666]'}`}>•</span>
                  <span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-gray-400'}>{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* Statut échec */}
          {pushFailed && !isDeploying && (
            <div className="mb-3 px-3 py-2 bg-red-900/20 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-xs font-semibold">❌ Push échoué — vérifiez votre token et les permissions du repo.</p>
            </div>
          )}

          {/* Bouton */}
          <button
            onClick={handlePushToGitHub}
            disabled={isDeploying || !token || !repoName}
            className={`w-full h-11 shrink-0 rounded-[12px] text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
              isDeploying ? 'bg-[#1a1a1a] text-[#444] cursor-not-allowed' :
              pushFailed ? 'bg-red-800 text-white hover:bg-red-700' :
              'bg-white text-black hover:bg-gray-200 shadow-white/5'
            }`}
          >
            {isDeploying ? <><Loader size={16} className="animate-spin" /> Pushing...</> :
             pushFailed ? <>↺ Réessayer</> :
             <>Push changes <ArrowRight size={16} /></>}
          </button>

          {/* Footer */}
          <div className="mt-4 flex flex-col items-center gap-1 shrink-0 pb-2">
            {repoUrl ? (
              <a href={repoUrl} target="_blank" className="text-[10px] text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4">
                View repository on GitHub <ArrowUp size={10} className="rotate-45" />
              </a>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <p className="text-[10px] text-[#444]">Make sure to check the <span className="text-[#666] font-bold">repo</span> scope.</p>
                <a href="https://github.com/settings/tokens/new?scopes=repo&description=StudioCode" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#888] hover:text-white transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4">
                  Get your access token here <ArrowUp size={10} className="rotate-45" />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
