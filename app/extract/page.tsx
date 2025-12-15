"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Sidebar as SidebarIcon, AlertCircle } from "lucide-react";

// --- COMPOSANT IFRAME ISOLÉ ---
const PreviewFrame = ({ html, css }: { html: string; css: string }) => {
  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        ${css} 
        <style>
            /* Reset pour centrer et isoler */
            body { 
                background: transparent; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                min-height: 100vh;
                margin: 0;
                padding: 40px; /* Plus d'espace pour les sidebars */
                font-family: system-ui, sans-serif; 
                overflow: hidden; /* Cache les scrollbars moches */
            }
            /* Désactive les liens */
            a { pointer-events: none; }
            /* Force les sidebars à ne pas être fixed pour la preview */
            aside, .sidebar, nav { position: relative !important; height: auto !important; }
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
      sandbox="allow-same-origin"
    />
  );
};

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'buttons' | 'cards' | 'navbars' | 'sidebars'>('buttons');
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

  const removeFromLibrary = (id: string) => {
      setSavedItems(savedItems.filter((i) => i.id !== id));
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

  const tabs = [
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navbars' },
      { id: 'sidebars', icon: SidebarIcon, label: 'Sidebars' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-indigo-500/30">
      
      {/* HEADER */}
      <div className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-500/20">V</div>
                <h1 className="font-bold text-lg tracking-tight">Vibe Extractor <span className="text-neutral-500 text-xs font-normal ml-2">Cheerio Engine</span></h1>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
                <input 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://linear.app" 
                    className="bg-neutral-900 border border-white/10 px-4 py-2 rounded-lg w-full md:w-80 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition"
                />
                <button 
                    onClick={runExtraction} 
                    disabled={loading || !url}
                    className="bg-white text-black hover:bg-neutral-200 px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition disabled:opacity-50"
                >
                    {loading ? "..." : <><Play size={14}/> GO</>}
                </button>
            </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto p-6 flex flex-col xl:flex-row gap-8">
        
        {/* RESULTATS */}
        <div className="flex-1 min-h-[50vh]">
          {results ? (
            <div className="space-y-6">
                
                {/* Tabs */}
                <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition ${
                                activeTab === tab.id 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
                                : 'bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-800'
                            }`}
                        >
                            <tab.icon size={16} />
                            {tab.label} 
                            <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-black/20' : 'bg-black/40'}`}>
                                {results.data[tab.id]?.length || 0}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Grille */}
                <div className={`grid gap-6 ${activeTab === 'sidebars' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                  {results.data[activeTab]?.map((item: any) => {
                      const isSaved = savedItems.some(i => i.id === item.id);
                      return (
                    <div key={item.id} className={`bg-neutral-900 border ${isSaved ? 'border-green-500/50' : 'border-white/5'} rounded-xl overflow-hidden flex flex-col group ${activeTab === 'sidebars' ? 'h-[500px]' : 'h-80'} hover:border-indigo-500/50 transition duration-300`}>
                      
                      <div className="p-3 border-b border-white/5 bg-black flex justify-between items-center">
                          <span className="text-[10px] uppercase font-mono text-neutral-500 bg-neutral-800 px-2 py-1 rounded border border-white/5">
                             {item.source}
                          </span>
                           {isSaved && <Check size={14} className="text-green-500" />}
                      </div>

                      <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                         <PreviewFrame html={item.html} css={results.globalCSS} />
                         
                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-sm">
                            <button 
                                onClick={() => addToLibrary(item)}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold transform scale-95 group-hover:scale-100 transition flex items-center gap-2 shadow-xl"
                            >
                                {isSaved ? 'Déjà ajouté' : 'Garder ce design'}
                            </button>
                         </div>
                      </div>
                    </div>
                  )})}
                  
                  {results.data[activeTab]?.length === 0 && (
                      <div className="col-span-full flex flex-col items-center py-20 text-neutral-500 gap-4">
                          <AlertCircle size={40} className="opacity-20"/>
                          <p>Aucun élément "{activeTab}" détecté avec les critères stricts.</p>
                      </div>
                  )}
                </div>

            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-4 min-h-[60vh]">
                <div className="p-8 rounded-full bg-neutral-900/50 border border-white/5">
                    <Layers size={48} className="opacity-40 text-indigo-500" />
                </div>
                <p>Prêt à extraire : Boutons, Cards, Navbars et Sidebars.</p>
            </div>
          )}
        </div>

        {/* CART SIDEBAR */}
        <div className="w-full xl:w-80 shrink-0">
            <div className="sticky top-24 bg-neutral-900 border border-white/10 rounded-xl p-6 flex flex-col max-h-[80vh]">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2">
                        <Download size={18} className="text-indigo-400"/> 
                        Dataset
                    </h3>
                    <span className="bg-indigo-600 text-xs px-2 py-1 rounded-full text-white font-bold">{savedItems.length}</span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2 custom-scrollbar">
                    {savedItems.map((item) => (
                        <div key={item.id} className="bg-black/40 p-3 rounded-lg text-xs border border-white/5 flex gap-3 group hover:border-white/10 transition">
                            <div className="w-8 h-8 bg-neutral-800 rounded flex items-center justify-center shrink-0">
                                {item.type === 'buttons' && <MousePointer2 size={14} className="text-blue-400"/>}
                                {item.type === 'cards' && <Layers size={14} className="text-orange-400"/>}
                                {item.type === 'sidebars' && <SidebarIcon size={14} className="text-purple-400"/>}
                                {item.type === 'navbars' && <Monitor size={14} className="text-green-400"/>}
                            </div>
                            <div className="overflow-hidden flex-1 py-0.5">
                                <div className="font-bold text-neutral-300 capitalize">{item.type}</div>
                                <div className="text-neutral-600 truncate text-[10px]">{item.id}</div>
                            </div>
                            <button 
                                onClick={() => removeFromLibrary(item.id)} 
                                className="text-neutral-600 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                            >
                                <Trash size={14}/>
                            </button>
                        </div>
                    ))}
                </div>

                <button 
                    onClick={downloadLibrary}
                    disabled={savedItems.length === 0}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl flex justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-900/20"
                >
                    TÉLÉCHARGER JSON
                </button>
            </div>
        </div>

      </div>
    </div>
  );
         }
