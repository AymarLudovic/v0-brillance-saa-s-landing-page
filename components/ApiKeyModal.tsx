import React, { useEffect, useState } from 'react'
import { ShieldSecurity } from 'iconsax-reactjs'
import { X, ArrowUp, Copy } from 'lucide-react'

// --- INDEXEDDB UTILS ---
const DB_NAME = 'StudioCodeDB';
const STORE_NAME = 'settings';
const DB_VERSION = 3;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    };
  });
};

export const saveApiKeyToIDB = async (key: string, provider: 'gemini' | 'anthropic' = 'gemini') => {
  const db = await initDB();
  const storeKey = provider === 'anthropic' ? 'anthropic_api_key' : 'gemini_api_key';
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(key, storeKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const getApiKeyFromIDB = async (provider: 'gemini' | 'anthropic' = 'gemini'): Promise<string | null> => {
  const db = await initDB();
  const storeKey = provider === 'anthropic' ? 'anthropic_api_key' : 'gemini_api_key';
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(storeKey);
    req.onsuccess = () => resolve(req.result ? req.result as string : null);
    req.onerror = () => reject(req.error);
  });
};

// --- COMPONENT ---
type LogMessage = { id: number; text: string; type: 'success' | 'error' | 'info' }

interface ApiKeyModalProps {
  provider?: 'gemini' | 'anthropic';
  onKeySaved?: () => void;
}

const PROVIDER_META = {
  gemini: {
    badge: 'GOOGLE', title: 'Gemini API Key', subtitle: 'Now more powerful than ever.',
    description: 'Enter your Google Gemini API key to use Gemini models.',
    placeholder: 'AIza...', getKeyUrl: 'https://aistudio.google.com/app/apikey',
    getKeyLabel: 'Get your Gemini key here',
    logo: <img className="h-[80px] object-cover" src="/3dicons-key-front-color.png" alt="Gemini" />,
  },
  anthropic: {
    badge: 'ANTHROPIC', title: 'Anthropic API Key', subtitle: 'Claude — Opus & Sonnet.',
    description: 'Enter your Anthropic API key to use Claude Opus 4.6, Sonnet 4.6 and other Claude models.',
    placeholder: 'sk-ant-...', getKeyUrl: 'https://console.anthropic.com/settings/keys',
    getKeyLabel: 'Get your Anthropic key here',
    logo: (
      <div className="h-[80px] w-[80px] flex items-center justify-center">
        <img
          src="https://claude.ai/favicon.ico" alt="Claude"
          className="h-[60px] w-[60px] rounded-xl"
          onError={(e) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement('div'), { style: 'width:60px;height:60px;background:#C96442;border-radius:12px' })); }}
        />
      </div>
    ),
  },
};

export default function ApiKeyModal({ provider = 'gemini', onKeySaved }: ApiKeyModalProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [hasKey, setHasKey] = useState(false)
  const [isInputMode, setIsInputMode] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [visibleLogs, setVisibleLogs] = useState<LogMessage[]>([])
  const meta = PROVIDER_META[provider];

  const addLog = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setVisibleLogs(prev => [...prev, { id, text, type }]);
    setTimeout(() => setVisibleLogs(prev => prev.filter(l => l.id !== id)), 10000);
  }
  const handleCopyLog = (text: string) => navigator.clipboard.writeText(text);

  useEffect(() => {
    const checkKey = async () => {
      try {
        let key = await getApiKeyFromIDB(provider);
        if (!key && provider === 'gemini') {
          key = localStorage.getItem("gemini_api_key");
          if (key) await saveApiKeyToIDB(key, 'gemini');
        }
        if (key) { setHasKey(true); setIsOpen(false); setInputValue(key); onKeySaved?.(); }
        else { setHasKey(false); }
      } catch (e) { console.error("Erreur init Key:", e); }
    };
    checkKey();
  }, [provider]);

  const handleSave = async () => {
    if (!inputValue.trim()) { addLog("Erreur : Le champ API Key est vide.", "error"); return; }
    try {
      addLog("Sauvegarde sécurisée...", "info");
      await saveApiKeyToIDB(inputValue.trim(), provider);
      if (provider === 'gemini') { try { localStorage.setItem("gemini_api_key", inputValue.trim()); } catch {} }
      const verify = await getApiKeyFromIDB(provider);
      if (verify === inputValue.trim()) {
        addLog("Succès ! Clé validée. Rechargement...", "success");
        setHasKey(true);
        onKeySaved?.();
        setTimeout(() => { setIsOpen(false); onKeySaved?.(); window.location.reload(); }, 1500);
      } else { throw new Error("Échec vérification DB"); }
    } catch (error: any) { addLog("Erreur Critique : " + (error.message || error), "error"); }
  }

  const openModal = () => { setIsInputMode(false); setIsOpen(true); }

  if (!isOpen) {
    return (
      <button onClick={openModal} className="hidden bottom-4 right-4 z-40 px-4 py-2 bg-[#1a1a1a] border border-white/10 rounded-lg text-xs text-[#e4e4e4] hover:text-white transition-colors flex items-center gap-2">
        <ShieldSecurity size={16} variant="Bold" />
        {provider === 'anthropic' ? 'Anthropic API Key' : 'Gemini API Key'}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="fixed top-10 left-0 right-0 z-[10000] flex flex-col items-center gap-2 pointer-events-auto px-4">
        {visibleLogs.map((log) => (
          <div key={log.id} className={`pl-4 pr-2 py-3 rounded-lg shadow-2xl border border-white/10 backdrop-blur-md text-xs font-mono font-medium animate-in slide-in-from-top-5 fade-in duration-300 max-w-full w-auto flex items-center gap-3 ${log.type === 'error' ? 'bg-red-500/90 text-white' : log.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-blue-500/90 text-white'}`}>
            <span className="flex-1">{log.type === 'error' && '❌ '}{log.type === 'success' && '✅ '}{log.type === 'info' && 'ℹ️ '}{log.text}</span>
            <button onClick={() => handleCopyLog(log.text)} className="p-2 bg-white/20 hover:bg-white/30 rounded text-white transition-colors"><Copy size={14} /></button>
          </div>
        ))}
      </div>

      <div className="relative w-[380px] h-[450px] bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col">
        <button onClick={() => setIsOpen(false)} className="absolute top-3 right-3 p-1 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-10"><X size={16} /></button>
        <div className="flex-1 p-6 flex flex-col relative">
          <div className="flex justify-between items-start bg-[#111] rounded-[12px] mb-6 h-auto p-3 border border-white/5">
            <div>
              <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#000] border border-white/10 text-[10px] font-medium text-[#e4e4e4] mb-2">{meta.badge}</div>
              <h2 className="text-xl font-bold text-white leading-tight">{meta.title}</h2>
              <p className="text-[11px] text-[#888] mt-1">{meta.subtitle}</p>
            </div>
            {meta.logo}
          </div>
          <div className="mb-auto mt-2">
            <p className="text-sm text-[#888] leading-relaxed font-medium">{meta.description}</p>
          </div>
          <div className="mt-6">
            {!isInputMode ? (
              <button onClick={() => setIsInputMode(true)} className="w-full h-10 bg-white text-black rounded-[10px] text-sm font-bold hover:bg-gray-200 transition-colors shadow-lg shadow-white/5">Set your API key</button>
            ) : (
              <div className="flex items-center gap-2 w-full h-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-1 h-full bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3 gap-2 focus-within:border-white/30 transition-colors">
                  <input type="password" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={meta.placeholder} className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }} />
                </div>
                <button onClick={handleSave} className="h-full text-sm px-5 bg-white text-black rounded-[14px] text-xs font-semibold hover:bg-gray-200 transition-colors shrink-0 shadow-lg shadow-white/5">Set</button>
              </div>
            )}
            <div className="mt-4 flex flex-col items-center justify-center gap-1 text-center">
              <p className="text-[10px] text-[#666]">Your key is stored locally in your browser. Never sent anywhere.</p>
              <a href={meta.getKeyUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#888] hover:text-white transition-colors flex items-center gap-1 decoration-dotted underline underline-offset-2">{meta.getKeyLabel}<ArrowUp size={10} className="rotate-45" /></a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
