import React, { useEffect, useState } from 'react'
import { ShieldSecurity, Lock1 } from 'iconsax-reactjs'
import { X, ArrowUp } from 'lucide-react'

export default function ApiKeyModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [isInputMode, setIsInputMode] = useState(false)
  const [inputValue, setInputValue] = useState("")

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
        console.error("Erreur : Le champ API Key est vide.");
        return;
    }

    try {
        console.log("Tentative d'enregistrement de la clé API...");
        localStorage.setItem("gemini_api_key", inputValue.trim());
        console.log("Clé API enregistrée avec succès dans le localStorage.");
        
        setHasKey(true);
        setIsOpen(false); // Ferme le modal immédiatement pour confirmer visuellement
        
        // Rechargement pour que toute l'app prenne en compte la nouvelle clé
        setTimeout(() => {
            window.location.reload();
        }, 500);
        
    } catch (error) {
        console.error("Erreur lors de la sauvegarde dans le localStorage:", error);
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
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 blur-md opacity-80 animate-pulse" />
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
                    <Lock1 size={16} variant="Bold" className="text-[#666] shrink-0"/>
                    <input 
                        type="password"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="sk-..."
                        className="bg-transparent border-none outline-none text-xs text-white w-full placeholder:text-[#444]"
                        autoFocus
                    />
                </div>
                <button 
                    onClick={handleSave}
                    className="h-full px-5 bg-white text-black rounded-[10px] text-xs font-bold hover:bg-gray-200 transition-colors shrink-0 shadow-lg shadow-white/5"
                >
                    SET
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
