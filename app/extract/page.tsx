"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Type, Square, Code, Globe, Scissors, Zap, X, Copy, FileCode, FileJson, Layout, LayoutTemplate, PlusCircle, CheckCircle2 } from "lucide-react";

// --- IFRAME (Preview Visuelle) ---
const PreviewFrame = ({ item, mode, globalCss }: { item: any; mode: 'global' | 'isolated' | 'inlined', globalCss: string }) => {
  let content = "";
  // On force le body à ne pas avoir de margin/padding pour que la preview colle aux bords
  // On ajoute pointer-events: none sur le body pour être sûr que l'iframe ne vole pas le focus du scroll, 
  // sauf si on veut vraiment scroller dedans (ici on veut juste voir).
  const baseStyle = `<style>body{background-color:transparent !important;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;font-family:system-ui,sans-serif;overflow:hidden; pointer-events: none;} nav,header,aside,footer{position:relative !important;width:100% !important;top:auto !important;left:auto !important;} a{pointer-events:none;}</style>`;
  
  if (mode === 'global') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${globalCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'isolated') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${item.isolatedCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'inlined') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;color:#fff;font-family:sans-serif;} *{box-sizing:border-box;} a{pointer-events:none;}</style></head><body>${item.ai_hybrid}</body></html>`;
  }

  return <iframe srcDoc={content} className="w-full h-full border-none pointer-events-none select-none" title="preview" sandbox="allow-same-origin" tabIndex={-1} />;
};

// --- INSPECTEUR (Inchangé) ---
const CodeInspector = ({ item, onClose }: any) => {
    const [view, setView] = useState<'separated' | 'inlined' | 'json'>('separated');
    const [copied, setCopied] = useState(false);

    const htmlClean = item.html;
    const cssClean = item.isolatedCss;
    const inlinedContent = item.ai_hybrid;

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
    };

    const jsonPayload = JSON.stringify({
        type: item.type,
        html: htmlClean,
        css: cssClean,
        html_ai_ready: item.ai_hybrid
    }, null, 2);
    
    const contentToDisplay = view === 'separated' ? htmlClean : view === 'inlined' ? inlinedContent : jsonPayload;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
            <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-7xl h-[90vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col md:flex-row justify-between items-center p-4 border-b border-white/10 bg-black gap-4">
                    <div className="flex gap-2 bg-neutral-900 p-1 rounded-lg">
                        <button onClick={() => setView('separated')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'separated' ? 'bg-blue-600 text-white shadow' : 'text-neutral-400 hover:text-white'}`}><Layout size={14}/> Clean Code</button>
                        <button onClick={() => setView('inlined')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'inlined' ? 'bg-yellow-600 text-black shadow' : 'text-neutral-400 hover:text-white'}`}><Zap size={14}/> IA Ready</button>
                        <button onClick={() => setView('json')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'json' ? 'bg-green-600 text-white shadow' : 'text-neutral-400 hover:text-white'}`}><FileJson size={14}/> JSON</button>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="p-2 text-neutral-500 hover:text-white hover:bg-white/10 rounded-lg transition"><X size={20}/></button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden bg-[#111] relative flex flex-col md:flex-row">
                    {view === 'separated' ? (
                        <>
                            <div className="flex-1 flex flex-col border-r border-white/10 min-h-0">
                                <div className="p-3 bg-black/50 border-b border-white/5 flex justify-between items-center"><span className="text-xs font-bold text-blue-400 flex items-center gap-2"><Code size={14}/> HTML</span><button onClick={() => handleCopy(htmlClean)} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition">Copier</button></div>
                                <div className="flex-1 overflow-auto p-4 custom-scrollbar"><pre className="font-mono text-xs text-blue-100 whitespace-pre-wrap">{htmlClean}</pre></div>
                            </div>
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="p-3 bg-black/50 border-b border-white/5 flex justify-between items-center"><span className="text-xs font-bold text-pink-400 flex items-center gap-2"><FileCode size={14}/> CSS</span><button onClick={() => handleCopy(cssClean)} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition">Copier</button></div>
                                <div className="flex-1 overflow-auto p-4 custom-scrollbar bg-[#151515]"><pre className="font-mono text-xs text-pink-100 whitespace-pre-wrap">{cssClean}</pre></div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                             <div className="p-3 bg-black/50 border-b border-white/5 flex justify-between items-center"><span className="text-xs font-bold text-neutral-400 flex items-center gap-2">{view === 'inlined' ? 'Code Hybride' : 'Données JSON'}</span><button onClick={() => handleCopy(view === 'inlined' ? inlinedContent : jsonPayload)} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition">Tout Copier</button></div>
                            <div className="flex-1 overflow-auto p-6 custom-scrollbar"><pre className={`font-mono text-xs leading-relaxed whitespace-pre-wrap ${view === 'inlined' ? 'text-yellow-100/80' : 'text-green-100'}`}>{view === 'inlined' ? inlinedContent : jsonPayload}</pre></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('rich_blocks');
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [inspectItem, setInspectItem] = useState<any>(null);
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

  const toggleItem = (item: any) => {
    const exists = savedItems.find(i => i.id === item.id);
    if (exists) setSavedItems(savedItems.filter(i => i.id !== item.id));
    else setSavedItems([...savedItems, item]);
  };

  const downloadLibrary = () => {
    const cleanItems = savedItems.map(item => ({
        id: item.id,
        type: item.type,
        ai_code: item.ai_hybrid,
        html_clean: item.html,
        css_clean: item.isolatedCss
    }));
    const blob = new Blob([JSON.stringify(cleanItems, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "vibe_dataset_v3.json"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const tabs = [
      { id: 'rich_blocks', icon: Square, label: 'Blocs Riches' },
      { id: 'sidebars', icon: LayoutTemplate, label: 'Sidebars' }, 
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navbars' },
      { id: 'inputs', icon: Type, label: 'Inputs' },
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      
      {/* HEADER */}
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-2xl">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/50">V</div>
            <h1 className="font-bold text-lg tracking-tight">Extracteur V3 <span className="text-neutral-500 font-normal text-xs ml-2">Action Bar Edition</span></h1>
         </div>

         <div className="flex gap-2 w-full md:w-auto">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="bg-neutral-900 border border-white/10 px-4 py-2 rounded text-sm w-full md:w-80 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"/>
            <button onClick={runExtraction} disabled={loading || !url} className="bg-white text-black px-6 py-2 rounded font-bold text-sm disabled:opacity-50 hover:bg-neutral-200 transition flex items-center gap-2">
                {loading ? "Scan..." : <><Play size={14}/> GO</>}
            </button>
         </div>

         {/* Bouton Panier */}
         <button 
            onClick={downloadLibrary}
            disabled={savedItems.length === 0}
            className={`flex items-center gap-2 px-5 py-2 rounded font-bold text-sm transition shadow-lg ${savedItems.length > 0 ? 'bg-green-600 text-white shadow-green-900/50 hover:bg-green-500' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`}
         >
            <Download size={16}/> 
            Exporter ({savedItems.length})
         </button>
      </div>

      <div className="p-6 max-w-[1800px] mx-auto">
        {results ? (
            <div className="space-y-6">
                
                {/* TOOLBAR: TABS + VIEW MODE */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-white/10 pb-4">
                    <div className="flex gap-2 overflow-x-auto max-w-full pb-2 md:pb-0">
                        {tabs.map((tab) => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-bold whitespace-nowrap transition ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}>
                                <tab.icon size={14} /> {tab.label} <span className="opacity-50 ml-1 bg-black/20 px-1.5 rounded-full text-[10px]">{results.data[tab.id]?.length || 0}</span>
                            </button>
                        ))}
                    </div>
                    
                    <div className="flex bg-neutral-900 rounded-lg p-1 border border-white/10 shrink-0">
                        <button onClick={() => setViewMode('global')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-2 ${viewMode==='global' ? 'bg-neutral-700 text-white shadow' : 'text-neutral-500 hover:text-white'}`}><Globe size={12}/> Site</button>
                        <button onClick={() => setViewMode('isolated')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-2 ${viewMode==='isolated' ? 'bg-blue-600 text-white shadow' : 'text-neutral-500 hover:text-white'}`}><Scissors size={12}/> Clean</button>
                        <button onClick={() => setViewMode('inlined')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-2 ${viewMode==='inlined' ? 'bg-yellow-500 text-black shadow' : 'text-neutral-500 hover:text-white'}`}><Zap size={12}/> IA</button>
                    </div>
                </div>

                {/* GRILLE D'ITEMS */}
                <div className={`grid gap-6 ${['navbars', 'rich_blocks', 'sidebars'].includes(activeTab) ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                    {results.data[activeTab]?.map((item: any) => {
                        const isSelected = savedItems.some(i => i.id === item.id);
                        return (
                            <div 
                                key={item.id} 
                                className={`rounded-xl overflow-hidden border-2 transition relative flex flex-col bg-neutral-900 ${isSelected ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'border-neutral-800 hover:border-blue-500/50'}`}
                            >
                                {/* HEADER: INFO + POIDS */}
                                <div className="px-3 py-2 bg-black border-b border-white/5 flex justify-between items-center text-[10px] text-neutral-500">
                                    <span className="font-mono bg-neutral-800 px-1.5 rounded text-neutral-300">{item.source}</span>
                                    <span>{Math.round(item.isolatedCss.length/1024)}kb</span>
                                </div>

                                {/* PREVIEW AREA */}
                                <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')] min-h-[250px] md:min-h-[350px]">
                                    <PreviewFrame item={item} mode={viewMode} globalCss={results.globalCSS} />
                                </div>
                                
                                {/* FOOTER: ACTIONS BAR (LE CŒUR DUchangement) */}
                                <div className="p-3 bg-neutral-950 border-t border-white/10 flex gap-2">
                                    <button 
                                        onClick={() => toggleItem(item)}
                                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-bold text-xs transition ${
                                            isSelected 
                                            ? 'bg-green-600 text-white hover:bg-green-500 shadow-lg shadow-green-900/20' 
                                            : 'bg-white text-black hover:bg-neutral-200'
                                        }`}
                                    >
                                        {isSelected ? <><CheckCircle2 size={14}/> AJOUTÉ</> : <><PlusCircle size={14}/> AJOUTER</>}
                                    </button>
                                    
                                    <button 
                                        onClick={() => setInspectItem(item)}
                                        className="px-3 py-2 bg-neutral-800 hover:bg-blue-600 text-neutral-300 hover:text-white rounded-lg transition"
                                        title="Voir le code"
                                    >
                                        <Code size={16}/>
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                    {results.data[activeTab]?.length === 0 && (
                        <div className="col-span-full py-20 text-center text-neutral-500 border border-dashed border-neutral-800 rounded-xl">Aucun élément détecté.</div>
                    )}
                </div>
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center h-[60vh] text-neutral-600">
                <div className="p-8 bg-neutral-900 rounded-full mb-6 animate-pulse">
                    <Layers size={64} className="opacity-20 text-blue-500"/>
                </div>
                <h2 className="text-xl font-bold text-neutral-300 mb-2">Extracteur de Design</h2>
                <p className="text-sm">Entrez une URL pour commencer à aspirer des composants.</p>
            </div>
        )}
      </div>

      {inspectItem && <CodeInspector item={inspectItem} onClose={() => setInspectItem(null)} />}
    </div>
  );
  }
