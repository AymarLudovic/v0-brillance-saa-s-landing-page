"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Type, Square, Code, Globe, Scissors, Zap, X, Copy, FileCode, FileJson, Layout } from "lucide-react";

// --- IFRAME (Inchangée pour la propreté) ---
const PreviewFrame = ({ item, mode, globalCss }: { item: any; mode: 'global' | 'isolated' | 'inlined', globalCss: string }) => {
  let content = "";
  const baseStyle = `<style>body{background-color:transparent !important;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;font-family:system-ui,sans-serif;overflow:hidden;} nav,header,aside,footer{position:relative !important;width:100% !important;top:auto !important;left:auto !important;} a{pointer-events:none;}</style>`;
  
  if (mode === 'global') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${globalCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'isolated') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${item.isolatedCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'inlined') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;color:#fff;font-family:sans-serif;} *{box-sizing:border-box;} a{pointer-events:none;}</style></head><body>${item.ai_hybrid}</body></html>`;
  }
  return <iframe srcDoc={content} className="w-full h-full border-none" title="preview" sandbox="allow-same-origin" />;
};

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('rich_blocks');
  
  // LE PANIER
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'global' | 'isolated' | 'inlined'>('isolated');

  const runExtraction = async () => {
    if(!url) return;
    setLoading(true); setResults(null);
    try {
        const res = await fetch("/api/extract", { method: "POST", body: JSON.stringify({ url }) });
        const json = await res.json();
        if(json.success) setResults(json);
        else alert(json.error);
    } catch(e) { alert("Erreur serveur"); } finally { setLoading(false); }
  };

  // --- LOGIQUE DE SÉLECTION CORRIGÉE ---
  const toggleItem = (item: any) => {
      const exists = savedItems.find(i => i.id === item.id);
      if (exists) {
          setSavedItems(savedItems.filter(i => i.id !== item.id));
      } else {
          setSavedItems([...savedItems, item]);
      }
  };

  const downloadLibrary = () => {
    // Structure compatible avec le Design Manager
    const data = {
        meta: { source: url, date: new Date().toISOString() },
        components: savedItems.map(item => ({
            id: item.id,
            type: item.type,
            // On sauvegarde TOUT pour laisser le choix plus tard
            html_clean: item.html,
            css_clean: item.isolatedCss,
            html_inlined: item.ai_hybrid
        }))
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(blob); 
    link.download = `extract_${new URL(url).hostname}.json`; 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
  };

  const tabs = [
      { id: 'rich_blocks', icon: Square, label: 'Blocs' },
      { id: 'sidebars', icon: LayoutTemplate, label: 'Sidebars' },
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navs' },
      { id: 'inputs', icon: Type, label: 'Inputs' },
      { id: 'buttons', icon: MousePointer2, label: 'Btn' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      
      {/* HEADER AVEC PANIER FLOTTANT */}
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex justify-between items-center">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold">E</div>
            <h1 className="font-bold">Extracteur V3</h1>
         </div>

         <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="bg-neutral-900 border border-white/10 px-4 py-2 rounded text-sm w-64 md:w-96 focus:outline-none focus:border-blue-500"/>
            <button onClick={runExtraction} disabled={loading} className="bg-white text-black px-4 py-2 rounded font-bold text-sm disabled:opacity-50">
                {loading ? "Scan..." : "GO"}
            </button>
         </div>

         {/* Bouton Panier */}
         <button 
            onClick={downloadLibrary}
            disabled={savedItems.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded font-bold text-sm transition ${savedItems.length > 0 ? 'bg-green-600 text-white shadow-lg shadow-green-900/50' : 'bg-neutral-800 text-neutral-500'}`}
         >
            <Download size={16}/> 
            Exporter ({savedItems.length})
         </button>
      </div>

      <div className="p-6">
        {results ? (
            <div className="space-y-6">
                {/* TABS */}
                <div className="flex gap-2 border-b border-white/10 pb-4 overflow-x-auto">
                    {tabs.map((tab) => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-bold whitespace-nowrap transition ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}>
                            <tab.icon size={14} /> {tab.label} <span className="opacity-50 ml-1">{results.data[tab.id]?.length || 0}</span>
                        </button>
                    ))}
                </div>

                {/* MODES DE VUE */}
                <div className="flex justify-end gap-2 mb-2">
                    <span className="text-xs text-neutral-500 self-center mr-2">Mode Aperçu :</span>
                    <button onClick={() => setViewMode('global')} className={`px-3 py-1 rounded text-xs border ${viewMode==='global' ? 'border-blue-500 text-blue-400' : 'border-neutral-800 text-neutral-500'}`}>Site</button>
                    <button onClick={() => setViewMode('isolated')} className={`px-3 py-1 rounded text-xs border ${viewMode==='isolated' ? 'border-blue-500 text-blue-400' : 'border-neutral-800 text-neutral-500'}`}>Clean CSS</button>
                    <button onClick={() => setViewMode('inlined')} className={`px-3 py-1 rounded text-xs border ${viewMode==='inlined' ? 'border-yellow-500 text-yellow-400' : 'border-neutral-800 text-neutral-500'}`}>IA Ready</button>
                </div>

                {/* GRILLE */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {results.data[activeTab]?.map((item: any) => {
                        const isSelected = savedItems.some(i => i.id === item.id);
                        return (
                            <div 
                                key={item.id} 
                                onClick={() => toggleItem(item)}
                                className={`h-80 rounded-xl overflow-hidden border-2 cursor-pointer transition relative group ${isSelected ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.2)]' : 'border-neutral-800 hover:border-blue-500'}`}
                            >
                                <div className="absolute inset-0 pointer-events-none z-10 bg-transparent"></div> {/* Overlay click */}
                                <PreviewFrame item={item} mode={viewMode} globalCss={results.globalCSS} />
                                
                                <div className={`absolute top-2 right-2 z-20 w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-green-500 text-black' : 'bg-black/50 text-white border border-white/20'}`}>
                                    {isSelected ? <Check size={14} strokeWidth={3}/> : "+"}
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/80 backdrop-blur text-[10px] text-neutral-400 flex justify-between">
                                    <span>{item.source}</span>
                                    <span>{Math.round(item.isolatedCss.length/1024)}kb CSS</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center h-[50vh] text-neutral-600">
                <Layers size={64} className="opacity-20 mb-4"/>
                <p>Prêt à extraire.</p>
            </div>
        )}
      </div>
    </div>
  );
                                                      }
