"use client";

import { useState } from "react";
import { Download, Play, Check, Trash, Layers, Monitor, MousePointer2, Type, AlertCircle } from "lucide-react";

// --- IFRAME AVEC INJECTION DE CSS GLOBAL ---
const PreviewFrame = ({ html, css }: { html: string; css: string }) => {
  // On construit un mini-site web complet à l'intérieur de l'iframe
  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        
        <style>
          ${css}
        </style>

        <style>
            body { 
                background-color: transparent !important; /* Fond transparent pour voir le contexte */
                background-image: none !important;
                display: flex; 
                align-items: center; 
                justify-content: center; 
                min-height: 100vh;
                margin: 0; 
                padding: 20px;
                overflow: hidden; /* Pas de scrollbars dans la preview */
            }
            
            /* On force les éléments à ne pas être "fixed" (sinon la navbar disparaît en haut) */
            nav, header, aside, .fixed, [style*="fixed"] { 
                position: relative !important; 
                top: auto !important; 
                left: auto !important; 
            }

            /* On désactive les liens */
            a { pointer-events: none; cursor: default; }
        </style>
      </head>
      <body>
        ${html}
      </body>
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
  const [activeTab, setActiveTab] = useState<'buttons' | 'inputs' | 'cards' | 'navbars'>('buttons');
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
        if(json.success) setResults(json);
        else alert("Erreur: " + json.error);
    } catch(e) {
        alert("Erreur serveur");
    } finally {
        setLoading(false);
    }
  };

  const addToLibrary = (item: any) => {
    if (!savedItems.find((i) => i.id === item.id)) {
        // IMPORTANT : On sauvegarde l'item AVEC le CSS global si on veut l'utiliser plus tard
        // Ou alors on garde juste le HTML si on compte faire l'inlining plus tard.
        // Pour l'instant, on sauvegarde tel quel.
        setSavedItems([...savedItems, item]);
    }
  };

  const removeFromLibrary = (id: string) => {
    setSavedItems(savedItems.filter((i) => i.id !== id));
  };

  const downloadLibrary = () => {
    // Lors du téléchargement, on peut structurer le JSON pour inclure le CSS global UNE SEULE FOIS
    // pour ne pas avoir un fichier de 500Mo.
    const output = {
        meta: { source_url: url, date: new Date().toISOString() },
        global_css: results?.globalCSS || "", // Le CSS est stocké ici
        components: savedItems
    };

    const dataStr = JSON.stringify(output, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const urlBlob = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = urlBlob;
    link.download = "design_system_extracted.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabs = [
      { id: 'buttons', icon: MousePointer2, label: 'Boutons' },
      { id: 'inputs', icon: Type, label: 'Inputs' },
      { id: 'cards', icon: Layers, label: 'Cards' },
      { id: 'navbars', icon: Monitor, label: 'Navbars' },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-cyan-500/30">
      
      {/* HEADER */}
      <div className="border-b border-white/10 bg-black/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-cyan-600 rounded-xl flex items-center justify-center font-bold text-lg shadow-lg shadow-cyan-500/20">V</div>
                <h1 className="font-bold text-lg">Vibe Extractor <span className="text-neutral-500 text-xs ml-2">Full CSS Injection</span></h1>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
                <input 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://stripe.com" 
                    className="bg-neutral-900 border border-white/10 px-4 py-2 rounded-lg w-full md:w-80 text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                />
                <button 
                    onClick={runExtraction} 
                    disabled={loading || !url}
                    className="bg-white text-black hover:bg-neutral-200 px-6 py-2 rounded-lg font-bold text-sm flex items-center gap-2"
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
                            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition ${
                                activeTab === tab.id 
                                ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/20' 
                                : 'bg-neutral-900 text-neutral-400 hover:text-white'
                            }`}
                        >
                            <tab.icon size={16} />
                            {tab.label} 
                            <span className="ml-2 text-xs bg-black/20 px-2 py-0.5 rounded-full">
                                {results.data[tab.id]?.length || 0}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Grille */}
                <div className={`grid gap-6 ${activeTab === 'navbars' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
                  {results.data[activeTab]?.map((item: any) => {
                      const isSaved = savedItems.some(i => i.id === item.id);
                      return (
                    <div key={item.id} className={`bg-neutral-900 border ${isSaved ? 'border-green-500' : 'border-white/5'} rounded-xl overflow-hidden flex flex-col group h-72 hover:border-cyan-500/50 transition duration-300`}>
                      
                      <div className="p-2 border-b border-white/5 bg-black flex justify-between items-center text-[10px] text-neutral-500">
                          <span className="uppercase font-mono">{item.source}</span>
                          {isSaved && <Check size={12} className="text-green-500" />}
                      </div>

                      <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')]">
                         {/* ICI : ON PASSE LE HTML ET LE CSS GLOBAL */}
                         <PreviewFrame html={item.html} css={results.globalCSS} />
                         
                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center backdrop-blur-sm">
                            <button 
                                onClick={() => addToLibrary(item)}
                                className="bg-cyan-600 text-white px-5 py-3 rounded-xl font-bold transform scale-95 group-hover:scale-100 transition flex items-center gap-2 shadow-xl"
                            >
                                {isSaved ? 'Ajouté' : 'Ajouter au Dataset'}
                            </button>
                         </div>
                      </div>
                    </div>
                  )})}
                  
                  {results.data[activeTab]?.length === 0 && (
                      <div className="col-span-full flex flex-col items-center py-20 text-neutral-500 gap-4">
                          <AlertCircle size={40} className="opacity-20"/>
                          <p>Aucun élément trouvé.</p>
                      </div>
                  )}
                </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-neutral-600 min-h-[60vh]">
                <Layers size={48} className="opacity-20 mb-4 text-cyan-500" />
                <p>Prêt à cloner le design.</p>
            </div>
          )}
        </div>

        {/* CART */}
        <div className="w-full xl:w-80 shrink-0">
            <div className="sticky top-24 bg-neutral-900 border border-white/10 rounded-xl p-6">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2"><Download size={18} className="text-cyan-400"/> Panier</h3>
                    <span className="bg-cyan-600 text-xs px-2 py-1 rounded-full text-white">{savedItems.length}</span>
                </div>
                
                <div className="max-h-[60vh] overflow-y-auto space-y-2 mb-4 custom-scrollbar">
                    {savedItems.map((item) => (
                        <div key={item.id} className="bg-black/40 p-2 rounded text-xs border border-white/5 flex gap-2 group hover:border-white/10">
                            <div className="w-6 h-6 bg-neutral-800 rounded flex items-center justify-center shrink-0">
                                <Layers size={12} className="text-neutral-400"/>
                            </div>
                            <div className="flex-1 truncate pt-1 text-neutral-300">{item.type}</div>
                            <button onClick={() => removeFromLibrary(item.id)} className="hover:text-red-500 transition"><Trash size={12}/></button>
                        </div>
                    ))}
                </div>

                <button 
                    onClick={downloadLibrary}
                    disabled={savedItems.length === 0}
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 transition shadow-lg shadow-cyan-900/20"
                >
                    TÉLÉCHARGER LE DATASET
                </button>
                <p className="text-[10px] text-neutral-500 text-center mt-3">Le JSON inclura le CSS global pour référence.</p>
            </div>
        </div>

      </div>
    </div>
  );
               }
