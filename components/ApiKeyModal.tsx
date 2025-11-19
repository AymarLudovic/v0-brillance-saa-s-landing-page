import React, { useEffect, useState } from 'react'
import { ShieldSecurity, Lock1 } from 'iconsax-reactjs'
import { X, ArrowUp, Copy } from 'lucide-react'

// --- UTILITAIRES INDEXEDDB ---
const DB_NAME = 'StudioCodeDB';
const STORE_NAME = 'settings';
const DB_VERSION = 1;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

const saveApiKeyToIDB = async (key: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(key, 'gemini_api_key');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getApiKeyFromIDB = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get('gemini_api_key');
    request.onsuccess = () => resolve(request.result ? request.result as string : null);
    request.onerror = () => reject(request.error);
  });
};

// --- COMPOSANT ---
type LogMessage = {
    id: number;
    text: string;
    type: 'success' | 'error' | 'info';
}

export default function ApiKeyModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [isInputMode, setIsInputMode] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [visibleLogs, setVisibleLogs] = useState<LogMessage[]>([])

  const addLog = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now()
    const newLog = { id, text, type }
    setVisibleLogs(prev => [...prev, newLog])
    console.log(`[${type.toUpperCase()}] ${text}`) 
    setTimeout(() => {
        setVisibleLogs(prev => prev.filter(log => log.id !== id))
    }, 10000)
  }

  const handleCopyLog = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  useEffect(() => {
    const checkKey = async () => {
        try {
            let key = await getApiKeyFromIDB();
            if (!key) {
                key = localStorage.getItem("gemini_api_key");
                if (key) {
                    await saveApiKeyToIDB(key);
                }
            }
            if (key) {
                setHasKey(true);
                setIsOpen(false);
                setInputValue(key);
            } else {
                setHasKey(false);
                setIsOpen(true);
            }
        } catch (e) {
            setIsOpen(true);
        }
    };
    checkKey();
  }, [])

  const handleSave = async () => {
    if (!inputValue.trim()) {
        addLog("Erreur : Le champ API Key est vide.", "error");
        return;
    }
    try {
        addLog("Sauvegarde dans IndexedDB...", "info");
        await saveApiKeyToIDB(inputValue.trim());
        
        try {
            localStorage.setItem("gemini_api_key", inputValue.trim());
        } catch (e) {
            console.warn("LocalStorage plein, mais clé sécurisée dans IDB.");
        }
        
        const verify = await getApiKeyFromIDB();
        if (verify === inputValue.trim()) {
            addLog("Succès ! Clé sécurisée. Rechargement...", "success");
            setHasKey(true);
            setTimeout(() => {
                setIsOpen(false); 
                window.location.reload();
            }, 1500); 
        } else {
            throw new Error("Échec vérification IDB");
        }
    } catch (error: any) {
        addLog("Erreur Critique : " + (error.message || error), "error");
    }
  }

  const openModal = () => {
    setIsInputMode(false)
    setIsOpen(true)
  }

  if (!isOpen) {
    return (
      <button 
        onClick={openModal}
        className="fixed bottom-4 right-4 z-40 px-4 py-2 bg-[#1a1a1a] border border-white/10 rounded-lg text-xs text-[#e4e4e4] hover:text-white transition-colors flex items-center gap-2"
      >
        <ShieldSecurity size={16} variant="Bold" />
        Gestion API Key
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      
      <div className="fixed top-10 left-0 right-0 z-[10000] flex flex-col items-center gap-2 pointer-events-auto px-4">
        {visibleLogs.map((log) => (
            <div 
                key={log.id} 
                className={`
                    pl-4 pr-2 py-3 rounded-lg shadow-2xl border border-white/10 backdrop-blur-md text-xs font-mono font-medium animate-in slide-in-from-top-5 fade-in duration-300 max-w-full w-auto flex items-center gap-3
                    ${log.type === 'error' ? 'bg-red-500/90 text-white' : 
                      log.type === 'success' ? 'bg-green-500/90 text-white' : 
                      'bg-blue-500/90 text-white'}
                `}
            >
                <span className="flex-1">
                    {log.type === 'error' && '❌ '}
                    {log.type === 'success' && '✅ '}
                    {log.type === 'info' && 'ℹ️ '}
                    {log.text}
                </span>
                <button 
                    onClick={() => handleCopyLog(log.text)}
                    className="p-2 bg-white/20 hover:bg-white/30 rounded text-white transition-colors"
                >
                    <Copy size={14} />
                </button>
            </div>
        ))}
      </div>

      <div className="relative w-[380px] h-[450px] bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl flex flex-col">
        
        {hasKey && (
          <button 
            onClick={() => setIsOpen(false)}
            className="absolute top-3 right-3 p-1 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-10"
          >
            <X size={16} />
          </button>
        )}

        <div className="flex-1 p-6 flex flex-col relative">
          <div className="flex justify-between items-start bg-[#111] rounded-[12px] mb-6 h-auto p-3 border border-white/5">
            <div>
              <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#000] border border-white/10 text-[10px] font-medium text-[#e4e4e4] mb-2">
                NEW
              </div>
              <h2 className="text-xl font-bold text-white leading-tight">
                Studio Code 1.0
              </h2>
              <p className="text-[11px] text-[#888] mt-1">
                Now more powerful than ever.
              </p>
            </div>
            <img className="h-[80px] object-cover" src="/3dicons-key-front-color.png" alt="Logo images" />
          </div>

          <div className="mb-auto mt-2">
            <p className="text-sm text-[#888] leading-relaxed font-medium">
              Welcome to Studio Code 1.0, the AI-powered software creation platform that lets you generate your biggest web application projects. To get started, please enter your Gemini API key.
            </p>
          </div>

          <div className="mt-6">
            {!isInputMode ? (
              <button 
                onClick={() => setIsInputMode(true)}
                className="w-full h-10 bg-white text-black rounded-[10px] text-sm font-bold hover:bg-gray-200 transition-colors shadow-lg shadow-white/5"
              >
                Set your API key
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full h-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex-1 h-full bg-[#111] rounded-[10px] border border-white/10 flex items-center px-3 gap-2 focus-within:border-white/30 transition-colors">
                    <input 
                        type="password"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="your API Key...."
                        className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]"
                        autoFocus
                    />
                </div>
                <button 
                    onClick={handleSave}
                    className="h-full text-sm px-5 bg-white text-black rounded-[14px] text-xs font-semibold hover:bg-gray-200 transition-colors shrink-0 shadow-lg shadow-white/5"
                >
                    Set
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-col items-center justify-center gap-1 text-center">
                <p className="text-[10px] text-[#666]">
                    You need to enter your Gemini API key. Don't worry, Gemini is free.
                </p>
                <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#888] hover:text-white transition-colors flex items-center gap-1 decoration-dotted underline underline-offset-2"
                >
                    Get your API key here
                    <ArrowUp size={10} className="rotate-45" />
                </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
    }
