"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Type, Square, Code, Globe, Scissors, Zap, X, Copy, FileCode, FileJson } from "lucide-react";

// --- IFRAME ---
const PreviewFrame = ({ item, mode, globalCss }: { item: any; mode: 'global' | 'isolated' | 'inlined', globalCss: string }) => {
  let content = "";
  const baseStyle = `<style>body{background-color:transparent !important;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;font-family:system-ui,sans-serif;overflow:hidden;} nav,header,aside,footer{position:relative !important;width:100% !important;top:auto !important;left:auto !important;} a{pointer-events:none;}</style>`;
  
  if (mode === 'global') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${globalCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'isolated') {
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${item.isolatedCss}</style>${baseStyle}</head><body>${item.html}</body></html>`;
  } else if (mode === 'inlined') {
      // Pour le mode inline, on utilise le HTML transformé par Juice.
      // On ajoute un style minimal pour le body de la preview, mais le composant lui-même porte son style.
      content = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111;color:#fff;font-family:sans-serif;} *{box-sizing:border-box;} a{pointer-events:none;}</style></head><body>${item.ai_hybrid}</body></html>`;
  }

  return <iframe srcDoc={content} className="w-full h-full border-none" title="preview" sandbox="allow-same-origin" />;
};

// --- INSPECTEUR ---
const CodeInspector = ({ item, onClose }: any) => {
    // Par défaut, on ouvre sur INLINED car c'est ce que tu veux vérifier
    const [view, setView] = useState<'inlined' | 'separated' | 'json'>('inlined');
    const [copied, setCopied] = useState(false);

    // 1. FORMAT INLINED (Le Graal : style="...")
    const inlinedContent = item.ai_hybrid;

    // 2. FORMAT SÉPARÉ (Backup propre)
    const separatedContent = `\n${item.html}\n\n/* CSS */\n${item.isolatedCss}`;

    // 3. JSON
    const jsonContent = JSON.stringify({
        type: item.type,
        // C'est ce champ qui contient le code "prêt à l'emploi" pour l'IA
        html_ready: item.ai_hybrid 
    }, null, 2);

    const contentToDisplay = view === 'inlined' ? inlinedContent : view === 'separated' ? separatedContent : jsonContent;

    const handleCopy = () => {
        navigator.clipboard.writeText(contentToDisplay);
        setCopied(true); setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
            <div className="bg-[#0A0A0A] border border-white/10 w-full max-w-7xl h-[90vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col md:flex-row justify-between items-center p-4 border-b border-white/10 bg-black gap-4">
                    <div className="flex gap-2 bg-neutral-900 p-1 rounded-lg">
                        <button 
                            onClick={() => setView('inlined')} 
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'inlined' ? 'bg-yellow-500 text-black shadow' : 'text-neutral-400 hover:text-white'}`}
                        >
                            <Zap size={14}/> HTML Inliné (IA)
                        </button>
                        <button 
                            onClick={() => setView('separated')} 
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'separated' ? 'bg-blue-600 text-white shadow' : 'text-neutral-400 hover:text-white'}`}
                        >
                            <FileCode size={14}/> HTML + CSS (Clean)
                        </button>
                        <button 
                            onClick={() => setView('json')} 
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition ${view === 'json' ? 'bg-green-600 text-white shadow' : 'text-neutral-400 hover:text-white'}`}
                        >
                            <FileJson size={14}/> JSON Data
                        </button>
                    </div>
                    
                    <div className="flex gap-2">
                        <button onClick={handleCopy} className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-neutral-200 rounded-lg text-xs font-bold transition shadow-lg shadow-white/5">
                            {copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copié' : 'Copier'}
                        </button>
                        <button onClick={onClose} className="p-2 text-neutral-500 hover:text-white hover:bg-white/10 rounded-lg transition"><X size={20}/></button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto bg-[#111] relative custom-scrollbar">
                    <div className="p-6">
                        <pre className={`font-mono text-xs leading-relaxed whitespace-pre-wrap ${
                            view === 'inlined' ? 'text-yellow-100/90' : 
                            view === 'separated' ? 'text-blue-100' : 
                            'text-green-100'
                        }`}>
                            {contentToDisplay}
                        </pre>
                    </div>
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
  
  // Par défaut, on regarde le mode INLINED
  const [viewMode, setViewMode] = useState<'global' | 'isolated' | 'inlined'>('inlined');

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
        // On priorise le format IA
        ai_html: item.ai_hybrid, 
        // Mais on garde aussi le format clean
        html_source: item.html,
        css_source: item.isolatedCss
    }));
    const blob = new Blob([JSON.stringify(cleanItems, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "vibe_dataset_final.json"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const tabs = [
      { id: 'rich_blocks', icon: Square, label: 'Blocks Riches' },
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
      { id: 'inputs', icon: Type, label: 'Inputs' },
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navbars' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-yellow-500/30">
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-yellow-500 rounded-xl flex items-center justify-center font-bold text-lg text-black shadow-lg shadow-yellow-900/40">V</div>
                <h1 className="font-bold text-lg">Vibe Extractor <span className="text-neutral-500 text-xs ml-2">Inliner Ultimate</span></h1>
            </div>
            <div className="flex gap-3 w-full md:w-auto items-center">
                {results && (
                    <div className="flex bg-neutral-900 rounded-lg p-1 border border-white/10">
                        <button onClick={() => setViewMode('global')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'global' ? 'bg-neutral-700 text-white' : 'text-neutral-500'}`}><Globe size={14}/> Site</button>
                        <button onClick={() => setViewMode('isolated')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'isolated' ? 'bg-blue-600 text-white shadow' : 'text-neutral-500'}`}><Scissors size={14}/> Clean</button>
                        <button onClick={() => setViewMode('inlined')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition ${viewMode === 'inlined' ? 'bg-yellow-500 text-black shadow' : 'text-neutral-500'}`}><Zap size={14}/> IA Ready</button>
                    </div>
                )}
                <div className="h-6 w-px bg-white/10 mx-2 hidden md:block"></div>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="bg-neutral-900 border border-white/10 px-4 py-2 rounded-lg w-full md:w-80 text-sm focus:ring-2 focus:ring-yellow-500 outline-none"/>
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
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === tab.id ? 'bg-yellow-600 text-black' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}>
                            <tab.icon size={14} /> {tab.label} <span className="ml-1 opacity-50 text-xs">{results.data[tab.id]?.length || 0}</span>
                        </button>
                    ))}
                </div>
                <div className={`grid gap-6 ${['navbars', 'rich_blocks'].includes(activeTab) ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                  {results.data[activeTab]?.map((item: any) => {
                      const isSaved = savedItems.some(i => i.id === item.id);
                      return (
                    <div key={item.id} className={`bg-neutral-900 border ${isSaved ? 'border-green-500' : 'border-white/5'} rounded-xl overflow-hidden flex flex-col group h-96 hover:border-yellow-500/50 transition duration-300 relative`}>
                      <div className="absolute top-0 left-0 right-0 p-3 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                          <span className="text-[10px] uppercase font-mono text-white/50 bg-black/50 px-2 py-1 rounded backdrop-blur-md">{item.source}</span>
                          <div className="flex gap-2 pointer-events-auto">
                              <button onClick={() => setInspectItem(item)} className="p-1.5 bg-black/50 hover:bg-blue-600 rounded-md text-white backdrop-blur-md transition"><Code size={14}/></button>
                              <button onClick={() => isSaved ? setSavedItems(savedItems.filter(i=>i.id!==item.id)) : setSavedItems([...savedItems, item])} className={`p-1.5 rounded-md text-white backdrop-blur-md transition ${isSaved ? 'bg-green-600' : 'bg-black/50 hover:bg-green-600'}`}>{isSaved ? <Check size={14}/> : <Download size={14}/>}</button>
                          </div>
                      </div>
                      <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                         <PreviewFrame 
                            item={item}
                            globalCss={results.globalCSS} 
                            mode={viewMode} 
                         />
                      </div>
                    </div>
                  )})}
                </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 min-h-[60vh]"><Zap size={64} className="opacity-20 mb-4 text-yellow-500" /><p>Prêt à inliner.</p></div>
          )}
        </div>
        
        <div className="w-full xl:w-80 shrink-0">
             <div className="sticky top-24 bg-neutral-900 border border-white/10 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6"><h3 className="font-bold flex items-center gap-2"><Download size={18}/> Dataset</h3><span className="bg-yellow-600 text-xs px-2 py-1 rounded-full text-black font-bold">{savedItems.length}</span></div>
                <div className="max-h-[60vh] overflow-y-auto space-y-2 mb-4 custom-scrollbar">
                    {savedItems.map((item) => (
                        <div key={item.id} className="bg-black/40 p-2 rounded text-xs border border-white/5 flex gap-2 group justify-between items-center"><span className="truncate flex-1 text-neutral-400">{item.type} <span className="text-neutral-600">#{item.id.split('-')[1]}</span></span><button onClick={() => setSavedItems(savedItems.filter(i=>i.id!==item.id))} className="hover:text-red-500"><Trash size={12}/></button></div>
                    ))}
                </div>
                <button onClick={downloadLibrary} disabled={savedItems.length===0} className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-xl disabled:opacity-50 transition">TÉLÉCHARGER</button>
            </div>
        </div>

        {inspectItem && <CodeInspector item={inspectItem} onClose={() => setInspectItem(null)} />}
      </div>
    </div>
  );
  }
