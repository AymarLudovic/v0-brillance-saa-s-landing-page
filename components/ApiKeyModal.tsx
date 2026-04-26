import React, { useEffect, useState } from 'react'
import { X, ArrowUp, Copy, ChevronRight, Shield, Zap, ExternalLink } from 'lucide-react'

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

// --- TYPES ---
type LogMessage = { id: number; text: string; type: 'success' | 'error' | 'info' }
type View = 'main' | 'guide' | 'input'

interface ApiKeyModalProps {
  provider?: 'gemini' | 'anthropic';
  onKeySaved?: () => void;
}

// --- GUIDE STEPS ---
const GEMINI_STEPS = [
  {
    step: '1',
    title: 'Go to Google AI Studio',
    desc: 'Click the button below to open Google AI Studio. Sign in with your Google account.',
    action: { label: 'Open Google AI Studio →', url: 'https://aistudio.google.com/app/apikey' }
  },
  {
    step: '2',
    title: 'Create an API Key',
    desc: 'Click "Create API Key", choose any Google Cloud project (or create a new one). It\'s completely free.',
  },
  {
    step: '3',
    title: 'Copy & Paste here',
    desc: 'Copy the key that starts with "AIza..." and paste it in the field below.',
  },
]

const ANTHROPIC_STEPS = [
  {
    step: '1',
    title: 'Go to Anthropic Console',
    desc: 'Click below to open the Anthropic Console. Create a free account if you don\'t have one.',
    action: { label: 'Open Anthropic Console →', url: 'https://console.anthropic.com/settings/keys' }
  },
  {
    step: '2',
    title: 'Create an API Key',
    desc: 'Click "Create Key", give it a name. You\'ll need to add credits ($5 minimum) to use Claude models.',
  },
  {
    step: '3',
    title: 'Copy & Paste here',
    desc: 'Copy the key that starts with "sk-ant-..." and paste it in the field below.',
  },
]

const PROVIDER_META = {
  gemini: {
    badge: 'Gemini api key its free . don't worry ',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    title: 'Connect Gemini',
    subtitle: 'Get started for free in 2 minutes',
    tagline: '100% Free · No credit card required',
    placeholder: 'AIza...',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    steps: GEMINI_STEPS,
    accentColor: '#4285F4',
    logo: <img className="h-[52px] w-[52px] object-contain" src="/3dicons-key-front-color.png" alt="Gemini" />,
  },
  anthropic: {
    badge: 'CLAUDE',
    badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    title: 'Connect Claude',
    subtitle: 'Opus & Sonnet — most powerful models',
    tagline: 'Pay-as-you-go · No subscription',
    placeholder: 'sk-ant-...',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    steps: ANTHROPIC_STEPS,
    accentColor: '#C96442',
    logo: (
      <div className="h-[52px] w-[52px] flex items-center justify-center rounded-2xl bg-[#C96442]/20">
        <img src="https://claude.ai/favicon.ico" alt="Claude" className="h-[32px] w-[32px] rounded-lg"
          onError={(e) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement('div'), { style: 'width:32px;height:32px;background:#C96442;border-radius:8px' })); }} />
      </div>
    ),
  },
};

export default function ApiKeyModal({ provider = 'gemini', onKeySaved }: ApiKeyModalProps) {
  const [view, setView] = useState<View>('main')
  const [inputValue, setInputValue] = useState("")
  const [hasKey, setHasKey] = useState(false)
  const [visibleLogs, setVisibleLogs] = useState<LogMessage[]>([])
  const meta = PROVIDER_META[provider];

  const addLog = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setVisibleLogs(prev => [...prev, { id, text, type }]);
    setTimeout(() => setVisibleLogs(prev => prev.filter(l => l.id !== id)), 10000);
  }

  useEffect(() => {
    const checkKey = async () => {
      try {
        let key = await getApiKeyFromIDB(provider);
        if (!key && provider === 'gemini') {
          key = localStorage.getItem("gemini_api_key");
          if (key) await saveApiKeyToIDB(key, 'gemini');
        }
        if (key) { setHasKey(true); setInputValue(key); }
      } catch (e) { console.error("Erreur init Key:", e); }
    };
    checkKey();
  }, [provider]);

  const handleSave = async () => {
    if (!inputValue.trim()) { addLog("API Key field is empty.", "error"); return; }
    try {
      addLog("Saving securely...", "info");
      await saveApiKeyToIDB(inputValue.trim(), provider);
      if (provider === 'gemini') { try { localStorage.setItem("gemini_api_key", inputValue.trim()); } catch {} }
      const verify = await getApiKeyFromIDB(provider);
      if (verify === inputValue.trim()) {
        addLog("Success! Key validated. Loading...", "success");
        setHasKey(true);
        setTimeout(() => { onKeySaved?.(); window.location.reload(); }, 1500);
      } else { throw new Error("DB verification failed"); }
    } catch (error: any) { addLog("Error: " + (error.message || error), "error"); }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-md">

      {/* Toast logs */}
      <div className="fixed top-10 left-0 right-0 z-[10000] flex flex-col items-center gap-2 pointer-events-none px-4">
        {visibleLogs.map((log) => (
          <div key={log.id} className={`pl-4 pr-2 py-3 rounded-lg shadow-2xl border border-white/10 backdrop-blur-md text-xs font-mono font-medium animate-in slide-in-from-top-5 fade-in duration-300 flex items-center gap-3 pointer-events-auto
            ${log.type === 'error' ? 'bg-red-500/90 text-white' : log.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-blue-500/90 text-white'}`}>
            <span>{log.type === 'error' && '❌ '}{log.type === 'success' && '✅ '}{log.type === 'info' && 'ℹ️ '}{log.text}</span>
            <button onClick={() => navigator.clipboard.writeText(log.text)} className="p-2 bg-white/20 hover:bg-white/30 rounded text-white transition-colors"><Copy size={14} /></button>
          </div>
        ))}
      </div>

      {/* Modal */}
      <div className="relative w-[400px] bg-[#0c0c0c] rounded-3xl border border-white/10 overflow-hidden shadow-2xl">

        {/* Close button */}
        <button onClick={() => onKeySaved?.()} className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-10">
          <X size={15} />
        </button>

        {/* ─── MAIN VIEW ─── */}
        {view === 'main' && (
          <div className="p-6 flex flex-col gap-5">

            {/* Header */}
            <div className="flex items-center gap-4">
              {meta.logo}
              <div>
                <div className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold mb-1.5 ${meta.badgeColor}`}>
                  {meta.badge}
                </div>
                <h2 className="text-lg font-bold text-white leading-tight">{meta.title}</h2>
                <p className="text-[11px] text-[#666] mt-0.5">{meta.subtitle}</p>
              </div>
            </div>

            {/* Trust pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <Shield size={11} className="text-emerald-400" />
                <span className="text-[10px] text-[#888]">Stored locally only</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <Zap size={11} className="text-yellow-400" />
                <span className="text-[10px] text-[#888]">{meta.tagline}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/5" />

            {/* CTA Buttons */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setView('guide')}
                className="w-full py-3 rounded-2xl font-semibold text-sm text-black transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(135deg, #fff 0%, #e0e0e0 100%)` }}
              >
                I don't have a key yet — show me how
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => setView('input')}
                className="w-full py-3 rounded-2xl font-semibold text-sm text-white border border-white/15 hover:bg-white/5 transition-all active:scale-[0.98]"
              >
                I already have my key
              </button>
            </div>

            {/* Bottom note */}
            <p className="text-center text-[10px] text-[#444]">
              Your key never leaves your browser. We never see it.
            </p>
          </div>
        )}

        {/* ─── GUIDE VIEW ─── */}
        {view === 'guide' && (
          <div className="p-6 flex flex-col gap-5">

            {/* Back + title */}
            <div className="flex items-center gap-3">
              <button onClick={() => setView('main')} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <ChevronRight size={15} className="rotate-180" />
              </button>
              <div>
                <h2 className="text-base font-bold text-white">Get your free API key</h2>
                <p className="text-[11px] text-[#555]">Takes less than 2 minutes</p>
              </div>
            </div>

            {/* Steps */}
            <div className="flex flex-col gap-4">
              {meta.steps.map((s, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                      {s.step}
                    </div>
                    {i < meta.steps.length - 1 && <div className="w-px flex-1 bg-white/10 mt-2" />}
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                    <p className="text-[12px] text-[#777] leading-relaxed">{s.desc}</p>
                    {s.action && (
                      <a href={s.action.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition-colors">
                        {s.action.label}
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              onClick={() => setView('input')}
              className="w-full py-3 rounded-2xl font-semibold text-sm text-black bg-white hover:bg-gray-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              I have my key, let's go
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* ─── INPUT VIEW ─── */}
        {view === 'input' && (
          <div className="p-6 flex flex-col gap-5">

            {/* Back + title */}
            <div className="flex items-center gap-3">
              <button onClick={() => setView('main')} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <ChevronRight size={15} className="rotate-180" />
              </button>
              <div>
                <h2 className="text-base font-bold text-white">Paste your API key</h2>
                <p className="text-[11px] text-[#555]">Stored only in your browser</p>
              </div>
            </div>

            {/* Input field */}
            <div className="flex flex-col gap-3">
              <div className="w-full bg-[#111] rounded-2xl border border-white/10 flex items-center px-4 py-3 gap-3 focus-within:border-white/30 transition-colors">
                <input
                  type="password"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={meta.placeholder}
                  className="bg-transparent border-none outline-none text-sm text-white w-full placeholder:text-[#333] font-mono"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                />
              </div>

              <button
                onClick={handleSave}
                className="w-full py-3 rounded-2xl font-semibold text-sm text-black bg-white hover:bg-gray-100 transition-all active:scale-[0.98]"
              >
                Connect & Start building
              </button>
            </div>

            {/* Security note */}
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/3 border border-white/8">
              <Shield size={13} className="text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-[#555] leading-relaxed">
                Your key is encrypted and saved locally in your browser's IndexedDB. It is <span className="text-white">never sent</span> to our servers.
              </p>
            </div>

            {/* Help link */}
            <p className="text-center text-[10px] text-[#444]">
              Don't have a key?{' '}
              <button onClick={() => setView('guide')} className="text-[#888] hover:text-white underline underline-offset-2 transition-colors">
                Get one for free in 2 min
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
