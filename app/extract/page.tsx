"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2 } from "lucide-react";

// --- COMPOSANT IFRAME ISOLÉ (Pour voir le vrai style Framer/Webflow) ---
const PreviewFrame = ({ html, css }: { html: string; css: string }) => {
  // On injecte le CSS global du site scanné pour que les classes 'framer-XYZ' fonctionnent
  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        ${css} 
        <style>
            /* Reset basique pour la preview */
            body { 
                background: transparent; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                min-height: 100vh;
                margin: 0;
                padding: 20px;
                overflow: hidden;
                font-family: sans-serif; 
            }
            /* On désactive les liens pour pas qu'on quitte l'iframe */
            a { pointer-events: none; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;

  return (
    <iframe
      srcDoc={srcDoc}
      className="w-full h-full border-none bg-white/5" 
      title="preview"
      sandbox="allow-same-origin" // Sécurité
    />
  );
};

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'buttons' | 'cards' | 'navbars'>('buttons');
  const [savedItems, setSavedItems] = useState<any[]>([]);

  const runExtraction = async () => {
    if(!url) return;
    setLoading(true);
    setResults(null);
    try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const json = await res.json();
        if(json.success) {
            setResults(json);
        } else {
            alert("Erreur: " + json.error);
        }
    } catch(e) {
        alert("Erreur de connexion");
    } finally {
        setLoading(false);
    }
  };

  const addToLibrary = (item: any) => {
    if (!savedItems.find((i) => i.html === item.html)) {
      setSavedItems([...savedItems, item]);
    }
  };

  const removeFromLibrary = (idx: number) => {
      setSavedItems(savedItems.filter((_, i) => i !== idx));
  };

  const downloadLibrary = () => {
    const dataStr = JSON.stringify(savedItems, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "design_library_dataset.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      
      {/* HEADER & INPUT */}
      <div className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold">V</div>
                <h1 className="font-bold text-lg tracking-tight">Vibe Extractor <span className="text-neutral-500 text-xs font-normal ml-2">v2.0 (Framer Support)</span></h1>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
                <input 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://framer.com/..." 
                    className="bg-neutral-900 border border-white/10 px-4 py-2 rounded-lg w-full md:w-96 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button 
                    onClick={runExtraction} 
                    disabled={loading || !url}
                    className="bg-white text-black hover:bg-neutral-200 px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition disabled:opacity-50"
                >
                    {loading ? "Scanning..." : <><Play size={14}/> GO</>}
                </button>
            </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto p-6 flex flex-col lg:flex-row gap-8">
        
        {/* ZONE PRINCIPALE (GRID) */}
        <div className="flex-1 min-h-[50vh]">
          {results ? (
            <div className="space-y-6">
                
                {/* Tabs de navigation */}
                <div className="flex gap-2 border-b border-white/10 pb-4">
                    {[
                        { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
                        { id: 'cards', icon: Layers, label: 'Cards' },
                        { id: 'navbars', icon: Monitor, label: 'Navbars' }
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition ${
                                activeTab === tab.id 
                                ? 'bg-blue-600 text-white' 
                                : 'bg-neutral-900 text-neutral-400 hover:text-white'
                            }`}
                        >
                            <tab.icon size={14} />
                            {tab.label} <span className="opacity-50 ml-1">({results.data[tab.id].length})</span>
                        </button>
                    ))}
                </div>

                {/* Grille de résultats */}
                <div className={`grid gap-6 ${activeTab === 'navbars' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                  {results.data[activeTab].map((item: any) => (
                    <div key={item.id} className="bg-neutral-900 border border-white/5 rounded-xl overflow-hidden flex flex-col group h-80 hover:border-blue-500/50 transition duration-300">
                      
                      {/* Header Item */}
                      <div className="p-3 border-b border-white/5 bg-black flex justify-between items-center">
                          <span className="text-[10px] uppercase font-mono text-neutral-500 bg-neutral-800 px-2 py-1 rounded">
                             {item.source}
                          </span>
                          <span className="text-[10px] text-neutral-600 truncate max-w-[150px]">
                              {item.classes.substring(0, 20)}...
                          </span>
                      </div>

                      {/* Preview Iframe */}
                      <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                         <PreviewFrame html={item.html} css={results.globalCSS} />
                         
                         {/* Overlay au survol */}
                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-sm">
                            <button 
                                onClick={() => addToLibrary(item)}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-full font-bold transform scale-90 group-hover:scale-100 transition flex items-center gap-2 shadow-xl"
                            >
                                <Check size={18} /> Garder ce design
                            </button>
                         </div>
                      </div>
                    </div>
                  ))}
                  
                  {results.data[activeTab].length === 0 && (
                      <div className="col-span-full text-center py-20 text-neutral-500">
                          Aucun élément de ce type détecté sur cette page.
                      </div>
                  )}
                </div>

            </div>
          ) : (
            /* Placeholder vide */
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-4 min-h-[60vh]">
                <Layers size={64} className="opacity-20" />
                <p>Entrez une URL pour extraire ses secrets de design.</p>
                <div className="flex gap-2 text-xs">
                    <span className="bg-neutral-900 px-3 py-1 rounded-full">Supporte Framer</span>
                    <span className="bg-neutral-900 px-3 py-1 rounded-full">Supporte Webflow</span>
                    <span className="bg-neutral-900 px-3 py-1 rounded-full">Supporte Tailwind</span>
                </div>
            </div>
          )}
        </div>

        {/* SIDEBAR (CART) */}
        <div className="w-full lg:w-80 shrink-0">
            <div className="sticky top-24 bg-neutral-900 border border-white/10 rounded-xl p-6 flex flex-col max-h-[80vh]">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2">
                        <Download size={18} className="text-green-500"/> 
                        Dataset
                    </h3>
                    <span className="bg-white/10 text-xs px-2 py-1 rounded-full text-white">{savedItems.length}</span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2 custom-scrollbar">
                    {savedItems.map((item, idx) => (
                        <div key={idx} className="bg-black/50 p-3 rounded-lg text-xs border border-white/5 flex gap-3 group">
                            <div className="w-8 h-8 bg-neutral-800 rounded flex items-center justify-center shrink-0">
                                {item.type === 'buttons' && <MousePointer2 size={14} />}
                                {item.type === 'cards' && <Layers size={14} />}
                                {item.type === 'navbars' && <Monitor size={14} />}
                            </div>
                            <div className="overflow-hidden flex-1">
                                <div className="font-bold text-neutral-300 capitalize">{item.type}</div>
                                <div className="text-neutral-600 truncate">{item.classes || "Sans classe"}</div>
                            </div>
                            <button 
                                onClick={() => removeFromLibrary(idx)} 
                                className="text-neutral-600 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                            >
                                <Trash size={14}/>
                            </button>
                        </div>
                    ))}
                    {savedItems.length === 0 && (
                        <p className="text-neutral-600 text-xs text-center py-4 italic">
                            Sélectionnez des composants à gauche pour construire votre librairie.
                        </p>
                    )}
                </div>

                <button 
                    onClick={downloadLibrary}
                    disabled={savedItems.length === 0}
                    className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl flex justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-green-900/20"
                >
                    TÉLÉCHARGER JSON
                </button>
            </div>
        </div>

      </div>
    </div>
  );
  }
