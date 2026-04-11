"use client"

import React, { useState, useEffect, useRef } from 'react';
import { X, Loader, Check, ArrowUp } from 'lucide-react';

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
      if (currentProject?.name) {
        setRepoName(currentProject.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
      }
      setLogs([]);
      setRepoUrl(null);
      setPushFailed(false);
      setIsDeploying(false);
    }
    return () => {
      clearSafetyTimeout();
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
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }]);
  };

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

    safetyTimeout.current = setTimeout(() => {
      addLog('⚠️ Délai max dépassé.', 'warning');
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

            if (data.type === 'DONE' || data.type === 'success') {
              if (data.url) addLog(`🚀 Poussé vers GitHub !`, 'success');
              finishPush(true, data.url);
              finished = true;
              break;
            }

            if (data.type === 'error') {
              addLog(`❌ ${data.message}`, 'error');
              finishPush(false);
              finished = true;
              break;
            }

            if (data.message) {
              // Détection URL GitHub dans le message
              const urlMatch = data.message.match(/https:\/\/github\.com\/[^\s]+/);
              if (urlMatch) {
                addLog(data.message, 'success');
                finishPush(true, urlMatch[0]);
                finished = true;
                break;
              }
              // Emoji succès
              if (data.message.includes('🚀') || data.message.toLowerCase().includes('successfully pushed')) {
                finishPush(true, data.url);
                finished = true;
                break;
              }
              // Message d'erreur
              const isErr = data.type === 'error' || (
                data.message.toLowerCase().includes('error') &&
                !data.message.toLowerCase().includes('warn')
              );
              addLog(data.message, isErr ? 'error' : (data.type ?? 'info'));
            }
          } catch (e) { /* ligne non-JSON, ignorer */ }
        }
        buffer = lines[lines.length - 1];
      }

      // Stream fermé sans signal DONE explicite
      if (!finished) {
        const hasSuccess = logs.some(l => l.type === 'success') || repoUrl !== null;
        if (hasSuccess) { finishPush(true); }
        else { addLog('ℹ️ Vérifiez votre dépôt GitHub.', 'warning'); finishPush(false); }
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
    <div className="fixed top-5 right-12 z-[9999] w-[390px] h-auto bg-[#fbfbf9] rounded-[16px] border border-[rgba(55,50,47,0.08)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">

      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-black/5 text-gray-400 hover:text-black transition-colors z-20"
      >
        <X size={14} />
      </button>

      <div className="flex-1 p-1 flex flex-col overflow-y-auto custom-scrollbar">

        {/* Form */}
        <div className="space-y-4 mb-1 shrink-0">
          <div className="space-y-1.5 w-full flex flex-col gap-1">
            <div className="w-full border-b border-[rgba(55,50,47,0.08)] py-[3px]">
              <p className="text-sm font-semibold text-[#212121] ml-1">Push to GitHub</p>
            </div>

            {/* Token */}
            <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center px-3 gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => handleSaveToken(e.target.value)}
                placeholder="Your GitHub access token..."
                className="bg-transparent outline-none text-sm text-[#212121] w-full placeholder:text-[#999]"
              />
              {token && <Check size={16} className="text-black shrink-0" />}
            </div>

            {/* Repo name */}
            <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center px-3 gap-2">
              <input
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="repo-name"
                disabled={isDeploying}
                className="bg-transparent outline-none text-sm text-[#212121] w-full placeholder:text-[#999]"
              />
              <span className="text-[10px] text-[#888] whitespace-nowrap shrink-0">GitHub repo</span>
            </div>

            {/* Branch */}
            <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center px-3 gap-2">
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                disabled={isDeploying}
                className="bg-transparent outline-none text-sm text-[#212121] w-full placeholder:text-[#999]"
              />
              <span className="text-[10px] text-[#888] whitespace-nowrap shrink-0">branch</span>
            </div>

            {/* Commit message */}
            <div className="py-2 bg-transparent border-b w-full rounded-[8px] border-[rgba(55,50,47,0.08)] flex items-center px-3 gap-2">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="commit message"
                disabled={isDeploying}
                className="bg-transparent outline-none text-sm text-[#212121] w-full placeholder:text-[#999]"
              />
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="h-[70px] shrink-0 bg-transparent w-full text-[10px] overflow-y-auto mb-1 custom-scrollbar">
          <div className="space-y-1 p-2">
            {logs.length === 0 && <p className="text-[#888] text-xs font-semibold">Git output...</p>}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                <span className={`shrink-0 ${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-500' : log.type === 'warning' ? 'text-yellow-500' : 'text-blue-500'}`}>•</span>
                <span className={log.type === 'error' ? 'text-orange-400' : log.type === 'success' ? 'text-green-600 font-bold' : 'text-[#212121]'}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Statut échec */}
        {pushFailed && !isDeploying && (
          <div className="mb-1 px-2 py-1.5 bg-red-50 border border-red-100 rounded-lg">
            <p className="text-red-500 text-xs font-semibold">❌ Push échoué — vérifiez votre token et les permissions.</p>
          </div>
        )}

        {/* Boutons */}
        <div className="flex items-center w-full gap-1">
          <button
            onClick={onClose}
            className="h-[30px] w-[50%] rounded-[8px] bg-[#f7f4ed] text-sm"
          >
            cancel
          </button>
          <button
            onClick={handlePushToGitHub}
            disabled={isDeploying || !token || !repoName}
            className={`h-[30px] w-[50%] shrink-0 rounded-[8px] text-sm font-bold transition-all flex items-center justify-center gap-2 ${
              isDeploying ? 'bg-[#1e52f1] text-white cursor-not-allowed' :
              pushFailed ? 'bg-red-500 text-white' :
              'bg-[#1e52f1] text-white'
            }`}
          >
            {isDeploying ? <><Loader size={14} className="animate-spin" /> Pushing...</> :
             pushFailed ? <>↺ Réessayer</> :
             <>Push</>}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-col items-center gap-1 shrink-0 pb-2">
          {repoUrl ? (
            <a href={repoUrl} target="_blank" className="text-[10px] text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4">
              View on GitHub <ArrowUp size={10} className="rotate-45" />
            </a>
          ) : (
            <div className="flex w-full pl-2 pr-2 pt-2 justify-between border-t border-[rgba(55,50,47,0.08)] items-center gap-1">
              <p className="text-[12px] text-[#212121]">Use a token with <span className="font-bold">repo</span> scope.</p>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=StudioCode"
                target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-[#888] hover:text-black transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4"
              >
                Get token <ArrowUp size={10} className="rotate-45" />
              </a>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
