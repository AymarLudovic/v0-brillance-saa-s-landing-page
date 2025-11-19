import React, { useEffect, useState } from 'react'
import { ShieldSecurity, Lock1 } from 'iconsax-reactjs'
import { X, ArrowUp, Copy } from 'lucide-react'

// Type pour nos logs visuels
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
  
  // État pour stocker les logs à afficher
  const [visibleLogs, setVisibleLogs] = useState<LogMessage[]>([])

  // Fonction utilitaire pour ajouter un log visuel
  const addLog = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now()
    const newLog = { id, text, type }
    
    setVisibleLogs(prev => [...prev, newLog])
    console.log(`[${type.toUpperCase()}] ${text}`) 

    // Augmenté à 10 secondes pour te laisser le temps de copier
    setTimeout(() => {
        setVisibleLogs(prev => prev.filter(log => log.id !== id))
    }, 10000)
  }

  const handleCopyLog = (text: string) => {
    navigator.clipboard.writeText(text)
    // Petit feedback visuel optionnel (pas de log pour éviter une boucle)
  }

  useEffect(() => {
    const storedKey = localStorage.getItem("gemini_api_key")
    if (storedKey) {
      setHasKey(true)
      setIsOpen(false)
    } else {
      setHasKey(false)
      setIsOpen(true)
    }
  }, [])

  const handleSave = () => {
    if (!inputValue.trim()) {
        addLog("Erreur : Le champ API Key est vide.", "error");
        return;
    }

    try {
        addLog("Tentative d'enregistrement...", "info");
        
        localStorage.setItem("gemini_api_key", inputValue.trim());
        
        // Vérification immédiate
        const verify = localStorage.getItem("gemini_api_key");
        if (verify === inputValue.trim()) {
            addLog("Succès ! Clé sauvegardée. Rechargement...", "success");
            
            setHasKey(true);
            setTimeout(() => {
                setIsOpen(false); 
                window.location.reload();
            }, 1500); 
        } else {
            addLog("Erreur : La vérification du stockage a échoué.", "error");
        }
        
    } catch (error: any) {
        addLog("Exception : " + (error.message || error), "error");
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
      
      {/* --- SYSTEME DE LOGS VISUELS (Toaster) --- */}
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
                    title="Copier le message"
                >
                    <Copy size={14} />
                </button>
            </div>
        ))}
      </div>
      {/* ------------------------------------------- */}

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
          
          {/* Header */}
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

          {/* Main Content (Welcome Message) */}
          <div className="mb-auto mt-2">
            <p className="text-sm text-[#888] leading-relaxed font-medium">
              Welcome to Studio Code 1.0, the AI-powered software creation platform that lets you generate your biggest web application projects. To get started, please enter your Gemini API key.
            </p>
          </div>

          {/* Input Section */}
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

            {/* Footer / Helper Text */}
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
