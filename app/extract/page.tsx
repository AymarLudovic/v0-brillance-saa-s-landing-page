"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Type, LayoutTemplate, Square, Code, Globe, Scissors, X, Copy } from "lucide-react";

const PreviewFrame = ({ html, globalCss, isolatedCss, mode }: { html: string; globalCss: string; isolatedCss: string; mode: 'global' | 'isolated' }) => {
  const cssToInject = mode === 'global' ? globalCss : isolatedCss;
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${cssToInject}</style><style>body{background-color:transparent !important;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;font-family:system-ui,sans-serif;overflow:hidden;} ${mode === 'isolated' ? 'body{background-color:#111 !important;color:#fff;}' : ''} nav,header,aside,footer{position:relative !important;width:100% !important;top:auto !important;left:auto !important;} a{pointer-events:none;}</style></head><body>${html}</body></html>`;
  return <iframe srcDoc={srcDoc} className="w-full h-full border-none" title="preview" sandbox="allow-same-origin" />;
};

// --- CORRECTION ICI : AFFICHAGE DES VRAIES DONNÉES ---
const CodeInspector = ({ item, onClose }: any) => {
    const [view, setView] = useState<'html' | 'css' | 'json'>('json');
    const [copied, setCopied] = useState(false);

    // C'est l'objet EXACT que l'IA va recevoir
    const finalData = {
        id: item.id,
        type: item.type,
        classes: item.classes,
        // On nettoie un peu le HTML pour l'affichage (optionnel)
        html: item.html, 
        // LE CSS EST MAINTENANT LÀ, EXTRAIT DU BACKEND
        css: item.isolatedCss 
    };

    const contentToDisplay = view === 'html' ? item.html : view === 'css' ? item.isolatedCss : JSON.stringify(finalData, null, 2);

    const handleCopy = () => {
        navigator.clipboard.writeText(contentToDisplay);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-5xl h-[85vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-white/10 bg-black">
                    <div className="flex gap-2">
                        <button onClick={() => setView('html')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${view === 'html' ? 'bg-blue-600 text-white' : 'bg-neutral-900 text-neutral-400'}`}>HTML</button>
                        <button onClick={() => setView('css')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${view === 'css' ? 'bg-pink-600 text-white' : 'bg-neutral-900 text-neutral-400'}`}>CSS ISOLÉ</button>
                        <button onClick={() => setView('json')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${view === 'json' ? 'bg-green-600 text-white' : 'bg-neutral-900 text-neutral-400'}`}>JSON IA</button>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleCopy} className="flex items-center gap-2 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-xs text-white transition">
                            {copied ? <Check size={14} className="text-green-500"/> : <Copy size={14}/>} {copied ? 'Copié !' : 'Copier'}
                        </button>
                        <button onClick={onClose} className="text-neutral-500 hover:text-white"><X size={24}/></button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-6 bg-[#111] font-mono text-xs text-neutral-300 custom-scrollbar">
                    <pre className={`whitespace-pre-wrap ${view === 'html' ? 'text-blue-300' : view === 'css' ? 'text-pink-300' : 'text-green-300'}`}>
                        {contentToDisplay}
                    </pre>
                </div>
            </div>
        </div>
    )
}

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('buttons');
  const [savedItems, setSavedItems] = useState<any[]>([]);
  const [inspectItem, setInspectItem] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'global' | 'isolated'>('global');

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

  const downloadLibrary = () => {
    const cleanItems = savedItems.map(item => ({
        id: item.id,
        type: item.type,
        classes: item.classes,
        html: item.html,
        css: item.isolatedCss // On s'assure que le CSS est bien dans le téléchargement
    }));
    
    const blob = new Blob([JSON.stringify(cleanItems, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "vibe_dataset_full.json";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const tabs = [
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
      { id: 'inputs', icon: Type, label: 'Inputs' },
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navbars' },
      { id: 'footers', icon: LayoutTemplate, label: 'Footers' },
      { id: 'sections', icon: Square, label: 'Sections' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-purple-500/30">
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-600 rounded-xl flex items-center justify-center font-bold text-lg shadow-lg shadow-purple-900/40">V</div>
                <h1 className="font-bold text-lg">Vibe Extractor <span className="text-neutral-500 text-xs ml-2">Full CSS Extractor</span></h1>
            </div>
            <div className="flex gap-3 w-full md:w-auto items-center">
                {results && (
                    <div className="flex bg-neutral-900 rounded-lg p-1 border border-white/10">
                        <button onClick={() => setViewMode('global')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'global' ? 'bg-neutral-700 text-white shadow' : 'text-neutral-500 hover:text-white'}`}><Globe size={14}/> Site Entier</button>
                        <button onClick={() => setViewMode('isolated')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'isolated' ? 'bg-pink-600 text-white shadow' : 'text-neutral-500 hover:text-white'}`}><Scissors size={14}/> Extrait Seul</button>
                    </div>
                )}
                <div className="h-6 w-px bg-white/10 mx-2 hidden md:block"></div>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="bg-neutral-900 border border-white/10 px-4 py-2 rounded-lg w-full md:w-80 text-sm focus:ring-2 focus:ring-purple-500 outline-none"/>
                <button onClick={runExtraction} disabled={loading || !url} className="bg-white text-black hover:bg-neutral-200 px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2">{loading ? "..." : <Play size={14}/>}</button>
            </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto p-6 flex flex-col xl:flex-row gap-8">
        <div className="flex-1 min-h-[50vh]">
          {results ? (
            <div className="space-y-6">
                <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
                    {tabs.map((tab) => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}>
                            <tab.icon size={14} /> {tab.label} <span className="ml-1 opacity-50 text-xs">{results.data[tab.id]?.length || 0}</span>
                        </button>
                    ))}
                </div>
                <div className={`grid gap-6 ${['navbars', 'footers', 'sections'].includes(activeTab) ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                  {results.data[activeTab]?.map((item: any) => {
                      const isSaved = savedItems.some(i => i.id === item.id);
                      return (
                    <div key={item.id} className={`bg-neutral-900 border ${isSaved ? 'border-green-500' : 'border-white/5'} rounded-xl overflow-hidden flex flex-col group h-80 hover:border-purple-500/50 transition duration-300 relative`}>
                      <div className="absolute top-0 left-0 right-0 p-3 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                          <span className="text-[10px] uppercase font-mono text-white/50 bg-black/50 px-2 py-1 rounded backdrop-blur-md">{item.source}</span>
                          <div className="flex gap-2 pointer-events-auto">
                              <button onClick={() => setInspectItem(item)} className="p-1.5 bg-black/50 hover:bg-blue-600 rounded-md text-white backdrop-blur-md transition" title="Inspecter"><Code size={14}/></button>
                              <button onClick={() => isSaved ? setSavedItems(savedItems.filter(i=>i.id!==item.id)) : setSavedItems([...savedItems, item])} className={`p-1.5 rounded-md text-white backdrop-blur-md transition ${isSaved ? 'bg-green-600' : 'bg-black/50 hover:bg-green-600'}`}>{isSaved ? <Check size={14}/> : <Download size={14}/>}</button>
                          </div>
                      </div>
                      <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                         <PreviewFrame html={item.html} globalCss={results.globalCSS} isolatedCss={item.isolatedCss} mode={viewMode} />
                      </div>
                    </div>
                  )})}
                </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 min-h-[60vh]"><Layers size={64} className="opacity-20 mb-4 text-purple-500" /><p>Prêt.</p></div>
          )}
        </div>
        <div className="w-full xl:w-80 shrink-0">
            <div className="sticky top-24 bg-neutral-900 border border-white/10 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6"><h3 className="font-bold flex items-center gap-2"><Download size={18}/> Dataset</h3><span className="bg-purple-600 text-xs px-2 py-1 rounded-full text-white">{savedItems.length}</span></div>
                <div className="max-h-[60vh] overflow-y-auto space-y-2 mb-4 custom-scrollbar">
                    {savedItems.map((item) => (
                        <div key={item.id} className="bg-black/40 p-2 rounded text-xs border border-white/5 flex gap-2 group justify-between items-center"><span className="truncate flex-1 text-neutral-400">{item.type} <span className="text-neutral-600">#{item.id.split('-')[1]}</span></span><button onClick={() => setSavedItems(savedItems.filter(i=>i.id!==item.id))} className="hover:text-red-500"><Trash size={12}/></button></div>
                    ))}
                </div>
                <button onClick={downloadLibrary} disabled={savedItems.length===0} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 transition">TÉLÉCHARGER</button>
            </div>
        </div>
        {inspectItem && <CodeInspector item={inspectItem} onClose={() => setInspectItem(null)} />}
      </div>
    </div>
  );
           }
