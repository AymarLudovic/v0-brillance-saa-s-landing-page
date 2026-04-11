"use client";

import React, { useState, useEffect, useRef } from 'react';
import { X, Loader, Check, ArrowUp } from 'lucide-react';

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
  // Callback optionnel — appelé avec le stderr si le déploiement échoue
  // Permet à page.tsx de transmettre l'erreur à sendChat comme un build error
  onDeployError?: (stderr: string) => void;
}

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'stdout' | 'stderr' | 'system' | 'success';
}

// Délai de sécurité max avant de forcer la fin du loading (5 minutes)
const MAX_DEPLOY_WAIT_MS = 5 * 60 * 1000;

export default function VercelDeployModal({ currentProject, isOpen, onClose, onDeployError }: VercelDeployModalProps) {
  const [token, setToken] = useState('');
  const [projectName, setProjectName] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [deployFailed, setDeployFailed] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const processedLogIds = useRef<Set<string>>(new Set());
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const safetyTimeout = useRef<NodeJS.Timeout | null>(null);
  // Accumulate stderr lines for sendChat error forwarding
  const stderrAccumulator = useRef<string[]>([]);

  useEffect(() => {
    const loadToken = async () => {
      try {
        const savedToken = await getVercelTokenFromIDB();
        if (savedToken) setToken(savedToken);
      } catch (e) { console.error(e); }
    };
    if (isOpen) {
      loadToken();
      const cleanName = currentProject?.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'my-project';
      setProjectName(cleanName);
      setLogs([]);
      setDeployUrl(null);
      setDeployFailed(false);
      setIsDeploying(false);
      stderrAccumulator.current = [];
    }
    return () => { stopPolling(); clearSafetyTimeout(); };
  }, [isOpen, currentProject]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleSaveToken = async (val: string) => {
    setToken(val);
    await saveVercelTokenToIDB(val);
  };

  const stopPolling = () => {
    if (pollingInterval.current) { clearInterval(pollingInterval.current); pollingInterval.current = null; }
  };
  const clearSafetyTimeout = () => {
    if (safetyTimeout.current) { clearTimeout(safetyTimeout.current); safetyTimeout.current = null; }
  };

  const addLog = (message: string, type: LogEntry['type'] = 'system') => {
    const id = Math.random().toString(36).substr(2, 9);
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { id, timestamp, message, type }]);
  };

  // ── Fin du déploiement — succès ou échec ──────────────────────────────────
  const finishDeploy = (success: boolean, url?: string) => {
    stopPolling();
    clearSafetyTimeout();
    setIsDeploying(false);
    if (success) {
      setDeployFailed(false);
      if (url) setDeployUrl(url);
      addLog('✅ Déploiement réussi !', 'success');
    } else {
      setDeployFailed(true);
      // Transmettre les erreurs à sendChat via le callback
      const stderr = stderrAccumulator.current.join('\n').trim();
      if (stderr && onDeployError) {
        onDeployError(stderr);
      }
    }
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
        const eventId = event.payload?.id || event.id;
        if (processedLogIds.current.has(eventId)) return;
        processedLogIds.current.add(eventId);

        const payload = event.payload || {};
        const text = payload.text || event.text || '';

        // ── Détection de l'état du déploiement ────────────────────────────
        if (event.type === 'deployment-state') {
          const state = payload.info?.readyState;
          if (state) {
            addLog(`[status] ${state}`, 'system');
            if (state === 'READY') { finishDeploy(true, `https://${projectName}.vercel.app`); return; }
            if (state === 'ERROR' || state === 'CANCELED') {
              addLog('❌ Déploiement échoué', 'stderr');
              finishDeploy(false);
              return;
            }
          }
          return;
        }

        // ── Détection dans le texte des logs ──────────────────────────────
        if (text) {
          if (
            text.includes('Deployment completed') ||
            text.includes('Build Completed') ||
            text.includes('Compiled successfully') ||
            text.includes('Ready')
          ) {
            finishDeploy(true, `https://${projectName}.vercel.app`);
            return;
          }
          // Détecter les vraies erreurs (pas npm warn)
          if (
            (text.includes('ERR!') || text.includes('Error:') || text.includes('Build failed')) &&
            !text.toLowerCase().includes('warn')
          ) {
            stderrAccumulator.current.push(text);
          }

          // Détecter fin par erreur dans le texte
          if (text.includes('Build failed') || text.includes('Deployment failed')) {
            addLog(`❌ ${text}`, 'stderr');
            finishDeploy(false);
            return;
          }

          let logType: LogEntry['type'] = 'stdout';
          if (event.type === 'stderr' && !text.toLowerCase().includes('warn')) logType = 'stderr';
          addLog(text, logType);
        }
      });
    } catch (e) { console.error('Log fetch error:', e); }
  };

  const checkFinalStatus = async (deploymentId: string) => {
    try {
      const res = await fetch(`/api/deploy/status?deploymentId=${deploymentId}&token=${token}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.readyState === 'READY') {
        finishDeploy(true, data.url || `https://${projectName}.vercel.app`);
      } else if (data.readyState === 'ERROR') {
        finishDeploy(false);
      }
    } catch (e) {}
  };

  const handleDeploy = async () => {
    if (!token || !projectName) return;
    setIsDeploying(true);
    setLogs([]);
    setDeployUrl(null);
    setDeployFailed(false);
    stderrAccumulator.current = [];
    processedLogIds.current.clear();
    addLog('Démarrage du déploiement...', 'system');

    // Safety timeout — force la fin après MAX_DEPLOY_WAIT_MS quoi qu'il arrive
    safetyTimeout.current = setTimeout(() => {
      if (pollingInterval.current) {
        addLog('⚠️ Délai dépassé — vérification du statut final...', 'system');
        stopPolling();
        setIsDeploying(false);
      }
    }, MAX_DEPLOY_WAIT_MS);

    try {
      const response = await fetch('/api/deploy/vercel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, files: currentProject.files, token })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Déploiement échoué');
      addLog(`Fichiers uploadés (id: ${data.deploymentId}). Récupération des logs...`, 'system');
      pollingInterval.current = setInterval(() => fetchLogsViaSDK(data.deploymentId), 2000);
    } catch (error: any) {
      addLog(`❌ Erreur: ${error.message}`, 'stderr');
      stderrAccumulator.current.push(error.message);
      finishDeploy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed top-5 right-12 z-[9999] w-[390px] h-auto bg-[#fbfbf9] rounded-[16px] border border-[rgba(55,50,47,0.08)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
      <button onClick={onClose} className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-black/5 text-gray-400 hover:text-black transition-colors z-20">
        <X size={14} />
      </button>

      <div className="flex-1 p-1 flex flex-col overflow-y-auto custom-scrollbar">
        <div className="space-y-4 mb-1 shrink-0">
          <div className="space-y-1.5 w-full flex flex-col gap-1">
            <div className="w-full border-b border-[rgba(55,50,47,0.08)] py-[3px]">
              <p className="text-sm font-semibold text-[#212121] ml-1">Publish your app</p>
            </div>
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

        {/* Console */}
        <div className="h-[70px] shrink-0 bg-transparent w-full border-[rgba(55,50,47,0.08)] text-[10px] overflow-y-auto mb-1 custom-scrollbar">
          <div className="space-y-1 p-2">
            {logs.length === 0 && <p className="text-[#888] text-xs font-semibold">Deployment logs...</p>}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2 animate-in fade-in slide-in-from-left-1">
                <span className={`shrink-0 ${log.type === 'stderr' ? 'text-red-500' : log.type === 'success' ? 'text-green-500' : log.type === 'system' ? 'text-blue-500' : 'text-[#212121]'}`}>•</span>
                <span className={log.type === 'stderr' ? 'text-orange-400' : log.type === 'success' ? 'text-green-600 font-bold' : 'text-[#212121]'}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Statut échec */}
        {deployFailed && (
          <div className="mb-1 px-2 py-1.5 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2">
            <span className="text-red-500 text-xs font-semibold">❌ Déploiement échoué</span>
            {onDeployError && <span className="text-red-400 text-[10px]">Erreur transmise à l'IA</span>}
          </div>
        )}

        {/* Boutons */}
        <div className="flex items-center w-full gap-1">
          <button onClick={onClose} className="h-[30px] w-[50%] rounded-[8px] bg-[#f7f4ed] text-sm">cancel</button>
          <button
            onClick={handleDeploy}
            disabled={isDeploying || !token || !projectName}
            className={`h-[30px] w-[50%] shrink-0 rounded-[8px] text-sm font-bold transition-all flex items-center justify-center gap-2 ${isDeploying ? 'bg-[#1e52f1] text-[#fff] cursor-not-allowed' : deployFailed ? 'bg-red-500 text-white' : 'bg-[#1e52f1] text-white'}`}
          >
            {isDeploying ? <><Loader size={16} className="animate-spin" /> Deploying...</> : deployFailed ? <>↺ Réessayer</> : <>Deploy</>}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-col items-center gap-1 shrink-0 pb-2">
          {deployUrl ? (
            <a href={deployUrl} target="_blank" className="text-[10px] text-green-400 hover:text-green-300 transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4">
              Open website <ArrowUp size={10} className="rotate-45" />
            </a>
          ) : (
            <div className="flex w-full pl-2 pr-2 pt-2 justify-between border-t border-[rgba(55,50,47,0.08)] items-center gap-1">
              <p className="text-[12px] text-[#212121]">Use a <span className="text-[#212121] font-bold">Personal Access Token</span>.</p>
              <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#888] hover:text-white transition-colors flex items-center gap-1 underline decoration-dotted underline-offset-4">
                Get your Vercel token <ArrowUp size={10} className="rotate-45" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
