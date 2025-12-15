"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Sidebar as SidebarIcon, AlertTriangle, Loader2 } from "lucide-react";

// --- COMPOSANT IFRAME SIMPLIFIÉ (Plus besoin de CSS global) ---
// C'est ça ta section de vérification : si ça s'affiche bien ici,
// ça veut dire que le CSS inline a fonctionné.
const PreviewFrame = ({ html }: { html: string }) => {
  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
            /* Reset pour centrer la preview */
            body { 
                background: transparent; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                min-height: 100vh;
                margin: 0;
                padding: 20px;
                // On force une font par défaut si elle n'est pas inline
                font-family: system-ui, -apple-system, sans-serif; 
            }
            /* On désactive les interactions */
            * { pointer-events: none; cursor: default !important; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;

  return (
    <iframe
      srcDoc={srcDoc}
      className="w-full h-full border-none bg-neutral-900/50" 
      title="preview"
      sandbox="allow-same-origin"
    />
  );
};

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState("");
  // Ajout de 'sidebars' aux tabs
  const [activeTab, setActiveTab] = useState<'buttons' | 'cards' | 'sidebars'>('buttons');
  const [savedItems, setSavedItems] = useState<any[]>([]);

  const runExtraction = async () => {
    if(!url) return;
    setLoading(true);
    setResults(null);
    setError("");
    
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
            setError(json.error);
        }
    } catch(e) {
        setError("Erreur de connexion au serveur d'extraction.");
    } finally {
        setLoading(false);
    }
  };

  const addToLibrary = (item: any) => {
    // Vérification simplifiée sur l'ID
    if (!savedItems.find((i) => i.id === item.id)) {
      setSavedItems([...savedItems, item]);
    }
  };

  const removeFromLibrary = (id: string) => {
      setSavedItems(savedItems.filter((i) => i.id !== id));
  };

  const downloadLibrary = () => {
    // Le JSON final est propre : que du HTML avec style inline
    const finalData = savedItems.map(({ id, type, source, html }) => ({ id, type, source, html }));
    
    const dataStr = JSON.stringify(finalData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "LIBRAIRIE_CSS_INLINE.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabs = [
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
      { id: 'cards', icon: Layers, label: 'Cards Complexes' },
      { id: 'sidebars', icon: SidebarIcon, label: 'Sidebars' }
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-purple-500/30">
      
      {/* HEADER & INPUT */}
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center font-bold shadow-lg shadow-purple-500/20">V</div>
                <div>
                    <h1 className="font-bold text-xl tracking-tight">Deep Style Extractor</h1>
                    <p className="text-neutral-400 text-xs">Moteur Puppeteer avec CSS Inlining</p>
                </div>
            </div>

            <div className="flex gap-3 w-full md:w-auto relative z-10">
                <div className="relative flex-1">
                    <input 
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://www.awwwards.com/..." 
                        className="bg-neutral-900/80 border border-white/10 px-5 py-3 rounded-xl w-full md:w-[500px] text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition pl-10"
                    />
                    <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={18}/>
                </div>
                <button 
                    onClick={runExtraction} 
                    disabled={loading || !url}
                    className="bg-white text-black hover:bg-neutral-200 px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition disabled:opacity-50 shadow-lg shadow-white/10"
                >
                    {loading ? <><Loader2 className="animate-spin" size={18}/> Scan...</> : <><Play fill="currentColor" size={16}/> LANCER L'EXTRACTION</>}
                </button>
            </div>
        </div>
      </div>

      {error && (
          <div className="max-w-[1800px] mx-auto p-6 pb-0">
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center gap-3">
                <AlertTriangle size={24} />
                {error}
            </div>
          </div>
      )}

      <div className="max-w-[1800px] mx-auto p-6 flex flex-col xl:flex-row gap-8 h-[calc(100vh-100px)]">
        
        {/* ZONE PRINCIPALE (GRID) */}
        <div className="flex-1 flex flex-col min-h-0 bg-neutral-900/30 border border-white/5 rounded-2xl overflow-hidden">
          {results ? (
            <div className="flex flex-col h-full">
                
                {/* Tabs */}
                <div className="flex gap-1 p-2 border-b border-white/5 bg-black/40">
                    {tabs.map((tab) => {
                        const count = results.data[tab.id]?.length || 0;
                        return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-bold transition relative ${
                                activeTab === tab.id 
                                ? 'bg-white/10 text-white shadow-inner' 
                                : 'text-neutral-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            <tab.icon size={16} />
                            {tab.label}
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${count > 0 ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-500'}`}>
                                {count}
                            </span>
                            {activeTab === tab.id && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-[2px] bg-purple-500 rounded-t-full"></div>}
                        </button>
                    )})}
                </div>

                {/* Grille de résultats scrollable */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                    <div className={`grid gap-6 ${activeTab === 'sidebars' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'}`}>
                    {results.data[activeTab]?.map((item: any) => {
                        const isSaved = savedItems.some(i => i.id === item.id);
                        return (
                        <div key={item.id} className={`bg-black border ${isSaved ? 'border-green-500/50' : 'border-white/10'} rounded-xl overflow-hidden flex flex-col group ${activeTab === 'sidebars' ? 'h-[600px]' : 'h-96'} hover:border-purple-500/50 transition duration-300 shadow-2xl`}>
                        
                        {/* Header Item */}
                        <div className="p-3 border-b border-white/5 bg-neutral-950 flex justify-between items-center">
                            <span className="text-[10px] uppercase font-mono text-neutral-500 bg-neutral-900/80 border border-white/5 px-2 py-1 rounded">
                                {item.source}
                            </span>
                            {isSaved && <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold"><Check size={12}/> SAUVEGARDÉ</span>}
                        </div>

                        {/* Preview Iframe (LA PREUVE QUE LE CSS EST INLINE) */}
                        <div className="flex-1 relative bg-neutral-950/50">
                            {/* On passe juste le HTML, s'il s'affiche bien c'est gagné */}
                            <PreviewFrame html={item.html} />
                            
                            {/* Overlay Action */}
                            <div className={`absolute inset-0 bg-black/80 ${isSaved ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'} transition flex items-center justify-center backdrop-blur-sm`}>
                                <button 
                                    onClick={() => addToLibrary(item)}
                                    className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-2xl font-bold transform scale-90 group-hover:scale-100 transition flex items-center gap-3 shadow-2xl shadow-purple-600/30"
                                >
                                    <Check size={20} />
                                    {isSaved ? 'Déjà dans la librairie' : 'Garder ce design'}
                                </button>
                            </div>
                        </div>
                        </div>
                    )})}
                    
                    {results.data[activeTab]?.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-32 text-neutral-500 gap-4">
                            <Layers size={48} className="opacity-20" />
                            <p>Aucun élément complexe de type "{activeTab}" détecté.</p>
                        </div>
                    )}
                    </div>
                </div>

            </div>
          ) : !loading && (
            /* Placeholder vide */
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 space-y-6">
                <div className="w-24 h-24 rounded-3xl bg-neutral-900 flex items-center justify-center border border-white/10 shadow-xl">
                     <Monitor size={40} className="text-purple-500/50" />
                </div>
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-white mb-2">Prêt à extraire le design réel.</h2>
                    <p className="max-w-md mx-auto">Entrez une URL pour lancer un navigateur headless qui va calculer et isoler le CSS de chaque composant.</p>
                </div>
            </div>
          )}
           {loading && (
                <div className="h-full flex flex-col items-center justify-center gap-4 z-20">
                    <Loader2 size={48} className="animate-spin text-purple-500" />
                    <p className="text-neutral-400 animate-pulse">Démarrage du navigateur distant...</p>
                    <p className="text-xs text-neutral-600">Cela peut prendre jusqu'à 30 secondes pour les sites complexes.</p>
                </div>
          )}
        </div>

        {/* SIDEBAR (PANIER) */}
        <div className="w-full xl:w-96 shrink-0 flex flex-col">
            <div className="flex-1 bg-neutral-900/50 border border-white/10 rounded-2xl p-6 flex flex-col overflow-hidden sticky top-24">
                <div className="flex justify-between items-center mb-8">
                    <h3 className="font-bold flex items-center gap-3 text-lg">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center shadow-lg shadow-green-500/20">
                             <Download size={18} className="text-white"/>
                        </div>
                        Dataset Final
                    </h3>
                    <span className="bg-green-600 text-xs font-bold px-3 py-1 rounded-full text-white shadow-lg">{savedItems.length} items</span>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 mb-6 pr-2 custom-scrollbar -mr-2">
                    {savedItems.map((item) => (
                        <div key={item.id} className="bg-black p-3 rounded-xl text-xs border border-white/5 flex gap-3 group hover:border-green-500/30 transition relative overflow-hidden">
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.type === 'buttons' ? 'bg-blue-500' : item.type === 'cards' ? 'bg-purple-500' : 'bg-orange-500'}`}></div>
                            <div className="w-10 h-10 bg-neutral-900 rounded-lg flex items-center justify-center shrink-0 pl-1">
                                {item.type === 'buttons' && <MousePointer2 size={16} className="text-blue-400" />}
                                {item.type === 'cards' && <Layers size={16} className="text-purple-400" />}
                                {item.type === 'sidebars' && <SidebarIcon size={16} className="text-orange-400" />}
                            </div>
                            <div className="overflow-hidden flex-1 py-0.5">
                                <div className="font-bold text-neutral-200 capitalize text-sm mb-1">{item.type}</div>
                                <div className="text-neutral-500 truncate font-mono text-[10px]">Source: {item.source}</div>
                            </div>
                            <button 
                                onClick={() => removeFromLibrary(item.id)} 
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-neutral-600 hover:text-red-500 transition"
                            >
                                <Trash size={16}/>
                            </button>
                        </div>
                    ))}
                    {savedItems.length === 0 && (
                        <div className="border-2 border-dashed border-neutral-800 rounded-xl p-8 text-center flex flex-col items-center gap-3">
                            <Download size={24} className="text-neutral-600" />
                            <p className="text-neutral-500 text-sm font-medium">Votre librairie est vide.</p>
                            <p className="text-neutral-600 text-xs">Ajoutez des composants pour préparer le fichier JSON.</p>
                        </div>
                    )}
                </div>

                <button 
                    onClick={downloadLibrary}
                    disabled={savedItems.length === 0}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xl shadow-green-900/30 text-sm tracking-wider"
                >
                    <Download size={20} />
                    TÉLÉCHARGER LE JSON (CSS INLINE)
                </button>
                {savedItems.length > 0 && (
                    <p className="text-center text-neutral-500 text-xs mt-4">
                        Le fichier contiendra du HTML pur avec tous les styles calculés inclus.
                    </p>
                )}
            </div>
        </div>

      </div>
    </div>
  );
                         }
