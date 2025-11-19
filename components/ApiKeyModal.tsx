import React, { useEffect, useState } from 'react'
import { Hierarchy, Message, ShieldSecurity, Flash, Edit, Lock1 } from 'iconsax-reactjs'
import { X } from 'lucide-react'

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
    if (!inputValue.trim()) return
    localStorage.setItem("gemini_api_key", inputValue.trim())
    setHasKey(true)
    setIsOpen(false)
    window.location.reload() 
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
      <div className="relative w-[380px] h-[450px] bg-[#000] rounded-3xl border border-black/10 overflow-hidden shadow-2xl flex flex-col">
        
        {hasKey && (
          <button 
            onClick={() => setIsOpen(false)}
            className="absolute top-3 right-3 p-1 rounded-full bg-black/20 hover:bg-white/10 text-gray-400 hover:text-white transition-colors z-10"
          >
            <X size={16} />
          </button>
        )}

        <div className="flex-1 p-6 flex flex-col relative">
          
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-[#111] border border-black/5 text-[10px] font-medium text-[#e4e4e4] mb-2">
                NEW
              </div>
              <h2 className="text-2xl font-bold text-white leading-tight">
                Vibe Code 2.0
              </h2>
              <p className="text-xs text-[#e4e4e4] mt-1">
                Now more powerful than ever.
              </p>
            </div>
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 blur-md opacity-80 animate-pulse" />
          </div>

          <div className="space-y-3 mb-auto">
            <FeatureItem icon={<Hierarchy size={16} variant="Bold" />} title="Workspaces" desc="Your subscription is now tied to a workspace." />
            <FeatureItem icon={<Message size={16} variant="Bold" />} title="Chat Mode" desc="Toggle below the chat to plan your next step." />
            <FeatureItem icon={<ShieldSecurity size={16} variant="Bold" />} title="Security Checks" desc="Run checks when publishing to find vulnerabilities." />
            <FeatureItem icon={<Flash size={16} variant="Bold" />} title="Smarter and Faster AI" desc="Get smarter and faster AI with Lovable." />
            <FeatureItem icon={<Edit size={16} variant="Bold" />} title="Edit Visually Or In Code" desc="Edit your project visually or in code." />
          </div>

          <div className="mt-4">
            {!isInputMode ? (
              <button 
                onClick={() => setIsInputMode(true)}
                className="w-full h-10 bg-white text-black rounded-[10px] text-sm font-semibold hover:bg-gray-200 transition-colors"
              >
                Set your API key
              </button>
            ) : (
              <div className="flex items-center gap-2 w-full h-10">
                <div className="flex-1 h-full bg-[#1a1a1a] rounded-full border border-white/10 flex items-center px-3 gap-2">
                    <Lock1 size={16} variant="Bold" className="text-[#e4e4e4] shrink-0"/>
                    <input 
                        type="password"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="sk-..."
                        className="bg-[#111] border-none outline-none text-xs text-white w-full placeholder:text-[#e4e4e4]"
                    />
                </div>
                <button 
                    onClick={handleSave}
                    className="h-full px-5 bg-white text-black rounded-[10px] text-xs font-bold hover:bg-gray-200 transition-colors shrink-0"
                >
                    SET
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function FeatureItem({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-[#e4e4e4] shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-[11px] font-medium text-[#e4e4e4] leading-none mb-0.5">{title}</h3>
        <p className="text-[9px] text-[#e4e4e4] leading-tight">{desc}</p>
      </div>
    </div>
  )
        }
