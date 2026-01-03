"use client";

import React, { useState, useRef, ChangeEvent } from 'react';
import { Upload, Cpu, Layers, Scan, Palette, Activity, CheckCircle2, Copy, Terminal } from 'lucide-react';

// --- TYPES ---
type BotStatus = 'idle' | 'running' | 'completed';

interface BotState {
  id: number;
  name: string;
  description: string;
  status: BotStatus;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'process';
}

// --- HELPER: RGB to HEX ---
const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
};

// --- COMPONENT PRINCIPAL ---
export default function VisionEnginePageV2() {
  // --- STATE ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [extractedColors, setExtractedColors] = useState<string[]>([]);
  const [finalPrompt, setFinalPrompt] = useState("");
  
  // Refs Canvas
  const canvasSourceRef = useRef<HTMLCanvasElement>(null);
  const canvasProcessRef = useRef<HTMLCanvasElement>(null); // Bot 2 (Sobel)
  const canvasTopologyRef = useRef<HTMLCanvasElement>(null); // Bot 3 (Map)
  
  // Config Bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 1, name: "Pré-traitement N&B", description: "Normalisation de la luminance", status: 'idle' },
    { id: 2, name: "VISION VECTORIELLE (Sobel)", description: "Extraction prioritaire des arêtes", status: 'idle' },
    { id: 3, name: "Topologie de Densité", description: "Mapping des zones de contenu", status: 'idle' },
    { id: 4, name: "Extraction Couleur Chirurgicale", description: "Scan complet des hexadécimaux", status: 'idle' },
  ]);

  // --- LOGIC: UTILS & LOGS ---
  const addLog = (msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { id: Date.now(), timestamp: new Date().toLocaleTimeString(), message: msg, type }]);
  };

  const updateBotStatus = (id: number, status: BotStatus) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  };

  const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text);
      addLog("Prompt copié dans le presse-papier !", 'success');
  };

  // --- LOGIC: UPLOAD & SETUP ---
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => { setupCanvases(img); addLog("Nouvelle source chargée.", 'info'); };
      img.src = event.target?.result as string;
      setImageSrc(event.target?.result as string);
      setFinalPrompt(""); setExtractedColors([]); setLogs([]);
      setBots(prev => prev.map(b => ({...b, status: 'idle'})));
    };
    reader.readAsDataURL(file);
  };

  const setupCanvases = (img: HTMLImageElement) => {
    const maxWidth = 800; // Limite pour performance
    const scale = Math.min(maxWidth / img.width, 1);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);

    [canvasSourceRef, canvasProcessRef, canvasTopologyRef].forEach(ref => {
      if (ref.current) {
        ref.current.width = w; ref.current.height = h;
        const ctx = ref.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, w, h);
            if (ref === canvasSourceRef) ctx.drawImage(img, 0, 0, w, h);
            else { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, w, h); }
        }
      }
    });
  };

  // --- PIPELINE CORE ---
  const startSequence = () => {
    if(!imageSrc) return;
    setAnalyzing(true); setLogs([]); setExtractedColors([]); setFinalPrompt("");
    // On démarre la chaîne
    runBotNormalization();
  };

  // --- BOT 1: Grayscale (Pré-requis pour Sobel) ---
  const runBotNormalization = () => {
    updateBotStatus(1, 'running');
    addLog("[Bot 1] Conversion en niveaux de gris...", 'process');
    setTimeout(() => {
        const src = canvasSourceRef.current; const dest = canvasProcessRef.current;
        if (!src || !dest) return;
        const ctxSrc = src.getContext('2d'); const ctxDest = dest.getContext('2d');
        if (!ctxSrc || !ctxDest) return;
        
        const imgData = ctxSrc.getImageData(0, 0, src.width, src.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = (0.299 * data[i]) + (0.587 * data[i+1]) + (0.114 * data[i+2]);
            data[i] = avg; data[i+1] = avg; data[i+2] = avg; // On réécrit directement dans le buffer source pour économiser la mémoire
        }
        ctxDest.putImageData(imgData, 0, 0); // Temporaire pour la visu
        updateBotStatus(1, 'completed');
        addLog("[Bot 1] Terminé.", 'success');
        runBotEdges(); // NEXT
    }, 200);
  };

  // --- BOT 2: SOBEL (LE CHEF) ---
  const runBotEdges = () => {
    updateBotStatus(2, 'running');
    addLog("[Bot 2] Calcul des gradients vectoriels (Sobel)...", 'process');
    setTimeout(() => {
        const src = canvasSourceRef.current; const dest = canvasProcessRef.current;
        if (!src || !dest) return;
        const ctxSrc = src.getContext('2d'); const ctxDest = dest.getContext('2d');
        if(!ctxSrc || !ctxDest) return;
        
        // On utilise l'image en niveaux de gris générée par Bot 1 (qui est actuellement dans src grâce à la manip précédente)
        const w = src.width; const h = src.height;
        const inputData = ctxSrc.getImageData(0, 0, w, h).data;
        const outputData = ctxDest.createImageData(w, h);
        const dst = outputData.data;

        const threshold = 18; // Seuil ajusté pour plus de finesse sur les lignes fines

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const right = ((y * w) + Math.min(x + 1, w - 1)) * 4;
                const down = (Math.min(y + 1, h - 1) * w + x) * 4;
                // On regarde juste le canal Rouge car c'est du N&B maintenant
                const diffX = Math.abs(inputData[i] - inputData[right]);
                const diffY = Math.abs(inputData[i] - inputData[down]);
                const magnitude = diffX + diffY;

                if (magnitude > threshold) {
                    // BORDURE DÉTECTÉE -> Vert fluo intense
                    dst[i] = 0; dst[i+1] = 255; dst[i+2] = 50; dst[i+3] = 255; 
                } else {
                    // FOND -> Noir profond
                    dst[i] = 0; dst[i+1] = 0; dst[i+2] = 0; dst[i+3] = 255; 
                }
            }
        }
        ctxDest.putImageData(outputData, 0, 0);
        updateBotStatus(2, 'completed');
        addLog("[Bot 2] Matrice vectorielle générée avec succès.", 'success');
        
        // On recharge l'image couleur originale dans le canvas source pour le Bot Couleur
        const img = new Image();
        img.onload = () => { ctxSrc.drawImage(img, 0, 0, w, h); runBotTopology(); };
        img.src = imageSrc!;
    }, 400);
  };

  // --- BOT 3: TOPOLOGY (Secondaire) ---
  const runBotTopology = () => {
    updateBotStatus(3, 'running');
    // addLog("[Bot 3] Génération de la carte de chaleur...", 'process');
    setTimeout(() => {
        const processCanvas = canvasProcessRef.current; // Input: Résultat du Bot 2
        const topoCanvas = canvasTopologyRef.current;
        if (!processCanvas || !topoCanvas) return;
        const ctxProcess = processCanvas.getContext('2d'); const ctxTopo = topoCanvas.getContext('2d');
        if(!ctxProcess || !ctxTopo) return;

        const w = processCanvas.width; const h = processCanvas.height;
        ctxTopo.fillStyle = "#ffffff"; ctxTopo.fillRect(0,0,w,h); // Reset blanc
        const gridSize = 12; // Blocs un peu plus gros
        
        for(let y=0; y<h; y+=gridSize) {
            for(let x=0; x<w; x+=gridSize) {
                const pData = ctxProcess.getImageData(x, y, gridSize, gridSize).data;
                let edges = 0;
                for(let i=0; i<pData.length; i+=4) if(pData[i+1] > 200) edges++; // Compte les pixels verts
                if(edges > 3) { // Si un peu d'activité
                    ctxTopo.fillStyle = `rgba(0,0,0, ${Math.min(edges/50, 0.5)})`; // Gris selon densité
                    ctxTopo.fillRect(x, y, gridSize, gridSize);
                }
            }
        }
        updateBotStatus(3, 'completed');
        // addLog("[Bot 3] Carte générée.", 'success');
        runBotColor(); // NEXT
    }, 200);
  };

  // --- BOT 4: COULEURS EXACTES (Amélioré) ---
  const runBotColor = () => {
      updateBotStatus(4, 'running');
      addLog("[Bot 4] Scan complet des pixels pour extraction Hexadécimale...", 'process');
      setTimeout(() => {
        const src = canvasSourceRef.current;
        if(!src) return;
        const ctx = src.getContext('2d');
        if(!ctx) return;

        const data = ctx.getImageData(0,0,src.width, src.height).data;
        const colorCounts: {[key: string]: number} = {};

        // Scan de TOUS les pixels (peut être lourd sur très grandes images)
        for(let i=0; i<data.length; i+=4) {
            const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
            if(a < 250) continue; // Ignore la transparence
            // Quantification simple pour regrouper les couleurs très proches (arrondi à 5)
            const qR = Math.round(r / 5) * 5;
            const qG = Math.round(g / 5) * 5;
            const qB = Math.round(b / 5) * 5;
            
            // Ignorer les noirs/blancs purs pour se concentrer sur la marque (optionnel)
            if(qR > 245 && qG > 245 && qB > 245) continue; 
            if(qR < 10 && qG < 10 && qB < 10) continue;

            const hex = rgbToHex(qR, qG, qB);
            colorCounts[hex] = (colorCounts[hex] || 0) + 1;
        }

        // Tri par fréquence et top 12
        const sortedColors = Object.entries(colorCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 12)
            .map(([hex]) => hex);

        setExtractedColors(sortedColors);
        updateBotStatus(4, 'completed');
        addLog(`[Bot 4] Analyse terminée. ${sortedColors.length} couleurs dominantes isolées.`, 'success');
        setAnalyzing(false);
        generatePrompt(sortedColors); // FIN -> Génération du prompt
      }, 500);
  };

  // --- PROMPT BUILDER ---
  const generatePrompt = (colors: string[]) => {
    let p = `--- DÉBUT DU PROMPT TECHNIQUE ---\n\n`;
    p += `CONTEXTE : Tu agis en tant qu'expert en intégration Frontend (React/Tailwind) spécialisé dans la reproduction Pixel Perfect.\n\n`;
    p += `TÂCHE : Reproduire l'interface utilisateur fournie en utilisant les deux images ci-jointes comme source de vérité absolue.\n\n`;
    p += `INSTRUCTIONS D'ANALYSE DES IMAGES :\n`;
    p += `1. IMAGE SOURCE (Couleur) : Sert de référence pour le contenu (textes, icônes) et l'application des couleurs.\n`;
    p += `2. IMAGE "VISION VECTORIELLE" (Fond noir / Lignes Vertes) : C'est ton BLUEPRINT STRUCTUREL.\n`;
    p += `   - ATTENTION : Les lignes vertes fluo sont des impératifs mathématiques. Elles indiquent les bordures réelles, les séparateurs et l'alignement.\n`;
    p += `   - Tu DOIS utiliser ces lignes vertes pour définir tes grilles (CSS Grid) et tes conteneurs Flexbox.\n`;
    p += `   - Si une ligne verte sépare deux éléments, cet espacement doit être respecté au pixel près.\n\n`;
    
    p += `PALETTE DE COULEURS IMPÉRATIVE (Extraite mathématiquement) :\n`;
    p += `Utilise UNIQUEMENT ces codes hexadécimaux pour les fonds, textes, bordures et accents. Ne pas inventer de couleurs.\n`;
    colors.forEach(c => p += `- ${c}\n`);
    
    p += `\nATTENTES SUR LE CODE :\n`;
    p += `- Code React propre, composants fonctionnels.\n`;
    p += `- Utilisation exhaustive de Tailwind CSS pour le style.\n`;
    p += `- Le résultat doit se superposer parfaitement à l'image source.\n`;
    p += `\n--- FIN DU PROMPT ---`;
    setFinalPrompt(p);
  }


  // --- RENDER ---
  return (
    <div className="min-h-screen bg-[#0a0e17] text-slate-300 p-4 md:p-8 font-mono selection:bg-cyan-900/50">
      
      <div className="max-w-8xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* === COLONNE GAUCHE : CONTRÔLE & LOGS === */}
        <div className="xl:col-span-4 space-y-6">
            <header>
                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 flex items-center gap-3">
                    <Cpu className="w-8 h-8 text-cyan-400" /> 
                    Pixel_Logic_Engine v3
                </h1>
                <p className="text-slate-500 text-sm mt-2 tracking-wider">Pipeline Déterministe • Priorité Vision Vectorielle</p>
            </header>

            {/* Upload Zone */}
            <div className="bg-[#111827] border-2 border-dashed border-slate-800 rounded-xl p-8 hover:border-cyan-700 transition-all group text-center">
                <label className="cursor-pointer flex flex-col items-center justify-center gap-3">
                    <div className="p-4 rounded-full bg-slate-900 group-hover:bg-cyan-900/30 transition-colors">
                        <Upload className="w-8 h-8 text-slate-500 group-hover:text-cyan-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-400 group-hover:text-white transition-colors">Charger l'interface source (PNG/JPG)</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>
            </div>

             {/* Start Button */}
             <button 
                onClick={startSequence}
                disabled={!imageSrc || analyzing}
                className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-cyan-900/30 text-lg tracking-wide relative overflow-hidden"
            >
                {analyzing ? <span className="animate-pulse">Analyse en cours...</span> : 'LANCER LA DÉCONSTRUCTION'}
                {analyzing && <div className="absolute bottom-0 left-0 h-1 bg-cyan-300 animate-loading-bar"></div>}
            </button>

            {/* Pipeline Status */}
            <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-4">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2"><Terminal size={14}/> Séquence d'exécution</h2>
                {bots.map((bot) => (
                    <div key={bot.id} className={`flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border ${bot.status === 'running' ? 'border-cyan-500/50 bg-cyan-900/10' : 'border-slate-800/50'} transition-all`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-md ${bot.status === 'completed' ? 'bg-green-900/30 text-green-400' : bot.id === 2 ? 'bg-purple-900/30 text-purple-400' : 'bg-slate-900 text-slate-600'}`}>
                                {bot.id === 1 && <Layers size={18} />}
                                {bot.id === 2 && <Scan size={18} className={bot.status === 'running' ? 'animate-spin-slow' : ''} />}
                                {bot.id === 3 && <Activity size={18} />}
                                {bot.id === 4 && <Palette size={18} />}
                            </div>
                            <div>
                                <div className={`text-sm font-bold ${bot.status !== 'idle' ? 'text-white' : 'text-slate-500'} ${bot.id === 2 && bot.status !== 'idle' ? '!text-purple-300' : ''}`}>{bot.name}</div>
                                <div className="text-[10px] text-slate-600 hidden md:block">{bot.description}</div>
                            </div>
                        </div>
                        {bot.status === 'completed' && <CheckCircle2 size={20} className="text-green-500" />}
                        {bot.status === 'running' && <div className="w-3 h-3 rounded-full bg-cyan-400 animate-ping" />}
                    </div>
                ))}
            </div>

            {/* Logs */}
            <div className="bg-[#000000] border border-slate-800 rounded-xl p-4 h-48 overflow-y-auto font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
                {logs.length === 0 && <span className="text-slate-700 opacity-50">// Ready.</span>}
                {logs.map((log) => (
                    <div key={log.id} className="mb-1 break-words">
                        <span className="text-slate-600 mr-2">[{log.timestamp.split(' ')[0]}]</span>
                        <span className={log.type === 'success' ? 'text-green-400' : log.type === 'process' ? 'text-yellow-300' : 'text-slate-400'}>{log.message}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* === COLONNE DROITE : VISUALISATION === */}
        <div className="xl:col-span-8 space-y-8">
            
            {/* ZONE 1: LES RÉSULTATS VISUELS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Source */}
                <div className="space-y-3">
                    <div className="flex justify-between items-end">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">1. Source (Référence)</label>
                    </div>
                    <div className="aspect-[9/16] md:aspect-video bg-[#000] border border-slate-800 rounded-xl overflow-hidden relative shadow-2xl">
                        <canvas ref={canvasSourceRef} className="w-full h-full object-contain" />
                        {!imageSrc && <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 gap-2"><Scan size={32} opacity={0.5}/><span className="text-xs">Aucun signal</span></div>}
                    </div>
                </div>

                {/* LE CHEF : BOT 2 */}
                <div className="space-y-3 relative">
                    <div className="flex justify-between items-end">
                        <label className="text-sm font-extrabold text-purple-400 uppercase tracking-wider flex items-center gap-2">
                            <Scan size={16}/> 2. Blueprint Vectoriel (Prioritaire)
                        </label>
                        {bots[1].status === 'completed' && <span className="text-[10px] font-bold text-purple-300 bg-purple-900/40 px-2 py-1 rounded-full animate-pulse">OUTPUT MAÎTRE</span>}
                    </div>
                    <div className="aspect-[9/16] md:aspect-video bg-[#000] border-2 border-purple-500/30 rounded-xl overflow-hidden relative shadow-[0_0_30px_rgba(168,85,247,0.1)]">
                            <canvas ref={canvasProcessRef} className="w-full h-full object-contain" />
                            {bots[1].status === 'running' && <div className="absolute inset-0 bg-purple-500/10 animate-pulse pointer-events-none"></div>}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                        * À fournir au LLM. Les lignes vertes sont des impératifs de structure.
                    </p>
                </div>
            </div>

            {/* ZONE 2: DONNÉES EXTRAITES (Couleurs + Prompt) */}
            {finalPrompt && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-fade-in mt-8 pt-8 border-t border-slate-800">
                    
                    {/* Palette */}
                    <div className="md:col-span-4 bg-[#111827] border border-slate-800 p-6 rounded-xl">

    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Palette size={14}/> Palette Exacte</h3>
                         <div className="grid grid-cols-3 gap-3">
                            {extractedColors.map((color, idx) => (
                                <div key={idx} className="flex flex-col items-center gap-2 group cursor-pointer" onClick={() => copyToClipboard(color)}>
                                    <div className="w-10 h-10 rounded-lg shadow-md border border-white/10 group-hover:scale-110 transition-transform" style={{backgroundColor: color}}></div>
                                    <span className="text-[10px] font-mono text-slate-400 group-hover:text-white transition-colors">{color}</span>
                                </div>
                            ))}
                         </div>
                    </div>

                    {/* Prompt Final */}
                    <div className="md:col-span-8 bg-[#111827] border border-cyan-900/30 p-6 rounded-xl relative group">
                        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Terminal size={14}/> Prompt Builder Ready
                        </h3>
                        <button onClick={() => copyToClipboard(finalPrompt)} className="absolute top-6 right-6 p-2 bg-cyan-900/30 hover:bg-cyan-800 rounded-md text-cyan-300 transition-colors" title="Copier le prompt">
                            <Copy size={16} />
                        </button>
                        <textarea 
                            readOnly 
                            value={finalPrompt} 
                            className="w-full h-64 bg-[#000] border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-slate-300 focus:outline-none focus:border-cyan-700 resize-none scrollbar-thin scrollbar-thumb-slate-800"
                        />
                        <p className="text-[10px] text-slate-500 mt-2">
                            Instructions : Copie ce texte. Ouvre ton LLM. Colle le texte. Attache tes DEUX images (Source + Blueprint Vectoriel) et envoie.
                        </p>
                    </div>
                </div>
            )}
             
             {/* Visu secondaire (Topology) - cachée si pas utile */}
             <div className="opacity-40 hover:opacity-100 transition-opacity mt-8">
                <h3 className="text-[10px] uppercase mb-2">Debug: Topologie (Bot 3)</h3>
                <canvas ref={canvasTopologyRef} className="h-24 bg-white rounded border border-slate-700" />
             </div>

        </div>

      </div>
      {/* Ajout de style global pour l'animation de chargement */}
      <style jsx global>{`
        @keyframes loading-bar {
            0% { width: 0%; opacity: 1; }
            50% { width: 70%; opacity: 0.5; }
            100% { width: 100%; opacity: 0; }
        }
        .animate-loading-bar {
            animation: loading-bar 2s ease-in-out infinite;
        }
        .animate-spin-slow {
            animation: spin 3s linear infinite;
        }
        .animate-fade-in {
            animation: fadeIn 0.5s ease-out forwards;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
  }
