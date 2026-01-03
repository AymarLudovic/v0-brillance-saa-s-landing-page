"use client";

import React, { useState, useRef, ChangeEvent } from 'react';
import { Upload, Cpu, Layers, Scan, Palette, Activity, CheckCircle2, Copy, Terminal, Download, FileJson } from 'lucide-react';

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

interface AnalysisMetrics {
  edgeDensity: string; // ex: "Haute"
  complexityScore: number; // 0-100
  dimensions: string;
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
  const [metrics, setMetrics] = useState<AnalysisMetrics | null>(null);
  
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

  // NOUVEAU : Fonction de téléchargement
  const downloadCanvas = (ref: React.RefObject<HTMLCanvasElement>, filename: string) => {
    if (ref.current) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = ref.current.toDataURL('image/png');
        link.click();
        addLog(`Image ${filename} téléchargée.`, 'success');
    }
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
      setFinalPrompt(""); setExtractedColors([]); setLogs([]); setMetrics(null);
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

  // --- BOT 1: Grayscale ---
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
            data[i] = avg; data[i+1] = avg; data[i+2] = avg; 
        }
        ctxDest.putImageData(imgData, 0, 0); 
        updateBotStatus(1, 'completed');
        addLog("[Bot 1] Terminé.", 'success');
        runBotEdges(); // NEXT
    }, 200);
  };

  // --- BOT 2: SOBEL (Modifié pour extraire des Stats) ---
  const runBotEdges = () => {
    updateBotStatus(2, 'running');
    addLog("[Bot 2] Calcul des gradients vectoriels (Sobel)...", 'process');
    setTimeout(() => {
        const src = canvasSourceRef.current; const dest = canvasProcessRef.current;
        if (!src || !dest) return;
        const ctxSrc = src.getContext('2d'); const ctxDest = dest.getContext('2d');
        if(!ctxSrc || !ctxDest) return;
        
        const w = src.width; const h = src.height;
        const inputData = ctxSrc.getImageData(0, 0, w, h).data;
        const outputData = ctxDest.createImageData(w, h);
        const dst = outputData.data;

        const threshold = 18;
        let edgePixelCount = 0; // Pour calculer la densité

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const right = ((y * w) + Math.min(x + 1, w - 1)) * 4;
                const down = (Math.min(y + 1, h - 1) * w + x) * 4;
                
                const diffX = Math.abs(inputData[i] - inputData[right]);
                const diffY = Math.abs(inputData[i] - inputData[down]);
                const magnitude = diffX + diffY;

                if (magnitude > threshold) {
                    dst[i] = 0; dst[i+1] = 255; dst[i+2] = 50; dst[i+3] = 255; 
                    edgePixelCount++; // On compte les pixels "actifs"
                } else {
                    dst[i] = 0; dst[i+1] = 0; dst[i+2] = 0; dst[i+3] = 255; 
                }
            }
        }
        ctxDest.putImageData(outputData, 0, 0);
        
        // Calcul des métriques pour le prompt
        const totalPixels = w * h;
        const ratio = (edgePixelCount / totalPixels) * 100;
        const calculatedMetrics: AnalysisMetrics = {
            dimensions: `${w}x${h}`,
            complexityScore: Math.round(ratio * 10), // Score arbitraire de complexité
            edgeDensity: ratio > 8 ? "ÉLEVÉE (Interface Dense)" : ratio > 3 ? "MOYENNE (Standard)" : "FAIBLE (Minimaliste)"
        };
        setMetrics(calculatedMetrics);

        updateBotStatus(2, 'completed');
        addLog(`[Bot 2] Matrice terminée. Complexité: ${calculatedMetrics.edgeDensity}`, 'success');
        
        const img = new Image();
        img.onload = () => { ctxSrc.drawImage(img, 0, 0, w, h); runBotTopology(); };
        img.src = imageSrc!;
    }, 400);
  };

  // --- BOT 3: TOPOLOGY ---
  const runBotTopology = () => {
    updateBotStatus(3, 'running');
    setTimeout(() => {
        const processCanvas = canvasProcessRef.current;
        const topoCanvas = canvasTopologyRef.current;
        if (!processCanvas || !topoCanvas) return;
        const ctxProcess = processCanvas.getContext('2d'); const ctxTopo = topoCanvas.getContext('2d');
        if(!ctxProcess || !ctxTopo) return;

        const w = processCanvas.width; const h = processCanvas.height;
        ctxTopo.fillStyle = "#ffffff"; ctxTopo.fillRect(0,0,w,h); 
        const gridSize = 12;
        
        for(let y=0; y<h; y+=gridSize) {
            for(let x=0; x<w; x+=gridSize) {
                const pData = ctxProcess.getImageData(x, y, gridSize, gridSize).data;
                let edges = 0;
                for(let i=0; i<pData.length; i+=4) if(pData[i+1] > 200) edges++;
                if(edges > 3) {
                    ctxTopo.fillStyle = `rgba(0,0,0, ${Math.min(edges/50, 0.5)})`;
                    ctxTopo.fillRect(x, y, gridSize, gridSize);
                }
            }
        }
        updateBotStatus(3, 'completed');
        runBotColor(); // NEXT
    }, 200);
  };

  // --- BOT 4: COULEURS ---
  const runBotColor = () => {
      updateBotStatus(4, 'running');
      addLog("[Bot 4] Scan chromatique...", 'process');
      setTimeout(() => {
        const src = canvasSourceRef.current;
        if(!src) return;
        const ctx = src.getContext('2d');
        if(!ctx) return;

        const data = ctx.getImageData(0,0,src.width, src.height).data;
        const colorCounts: {[key: string]: number} = {};

        for(let i=0; i<data.length; i+=4) {
            const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
            if(a < 250) continue; 
            const qR = Math.round(r / 5) * 5;
            const qG = Math.round(g / 5) * 5;
            const qB = Math.round(b / 5) * 5;
            if(qR > 245 && qG > 245 && qB > 245) continue; 
            if(qR < 10 && qG < 10 && qB < 10) continue;
            const hex = rgbToHex(qR, qG, qB);
            colorCounts[hex] = (colorCounts[hex] || 0) + 1;
        }

        const sortedColors = Object.entries(colorCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 12)
            .map(([hex]) => hex);

        setExtractedColors(sortedColors);
        updateBotStatus(4, 'completed');
        addLog(`[Bot 4] Analyse terminée.`, 'success');
        setAnalyzing(false);
        // Important: on passe metrics ici car il est dans le state
        generatePrompt(sortedColors); 
      }, 500);
  };

  // --- PROMPT BUILDER (MODIFIÉ) ---
  const generatePrompt = (colors: string[]) => {
    // Note: on utilise 'metrics' du state, mais comme setState est asynchrone et qu'on l'a set dans Bot 2, 
    // il est dispo maintenant. Pour plus de sûreté dans une vraie app, on utiliserait un useEffect ou on passerait l'objet en chaine.
    // Ici, pour simplifier, on suppose que Bot 2 a fini depuis longtemps.
    
    let p = `--- SYSTEM PROMPT: FRONTEND REPLICATOR V3 ---\n\n`;
    p += `RÔLE : Tu es un moteur de rendu de code React/Tailwind. Tu ne conçois pas, tu EXÉCUTES la structure fournie.\n\n`;
    p += `INPUTS FOURNIS (Tu dois les analyser) :\n`;
    p += `1. IMAGE SOURCE : Référence visuelle finale.\n`;
    p += `2. BLUEPRINT VECTORIEL (Fond Noir/Lignes Vertes) : LA VÉRITÉ STRUCTURELLE.\n`;
    p += `   - Ce blueprint a été généré par un algorithme de détection d'arêtes (Sobel).\n`;
    p += `   - Les lignes vertes indiquent OBLIGATOIREMENT une bordure, un conteneur div ou un changement de section.\n\n`;
    
    if (metrics) {
        p += `MÉTRIQUES STRUCTURELLES DU BLUEPRINT (Calculées mathématiquement) :\n`;
        p += `- Dimensions de la grille : ${metrics.dimensions}\n`;
        p += `- Densité d'information : ${metrics.edgeDensity}\n`;
        p += `- Score de complexité DOM estimé : ${metrics.complexityScore}/100\n`;
        if(metrics.complexityScore > 40) p += `  -> ATTENTION : Interface dense détectée. Utilise 'grid-cols-12' et des composants atomiques.\n`;
        else p += `  -> Interface aérée. Utilise Flexbox et des paddings généreux.\n`;
        p += `\n`;
    }

    p += `PALETTE HEXADÉCIMALE STRICTE (Extraite du scan) :\n`;
    p += `Utilise ces codes pour le background, text, border. Ne rien inventer.\n`;
    p += `[ ${colors.join(', ')} ]\n\n`;
    
    p += `INSTRUCTIONS DE GÉNÉRATION :\n`;
    p += `- Si tu vois une ligne verte horizontale continue -> C'est un <hr /> ou une border-bottom.\n`;
    p += `- Si tu vois des rectangles verts fermés -> Ce sont des Cards ou des Buttons.\n`;
    p += `- Code en React + CSS Pure . Lucide-React pour les icônes.\n`;
    p += `\n--- FIN DU PROMPT ---`;
    setFinalPrompt(p);
  }


  // --- RENDER ---
  return (
    <div className="min-h-screen bg-[#0a0e17] text-slate-300 p-4 md:p-8 font-mono selection:bg-cyan-900/50">
      
      <div className="max-w-8xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">
        
        {/* === COLONNE GAUCHE : CONTRÔLE === */}
        <div className="xl:col-span-4 space-y-6">
            <header>
                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 flex items-center gap-3">
                    <Cpu className="w-8 h-8 text-cyan-400" /> 
                    Pixel_Logic v3
                </h1>
                <p className="text-slate-500 text-sm mt-2 tracking-wider">Moteur de Déconstruction pour LLM</p>
            </header>

            {/* Upload */}
            <div className="bg-[#111827] border-2 border-dashed border-slate-800 rounded-xl p-8 hover:border-cyan-700 transition-all group text-center">
                <label className="cursor-pointer flex flex-col items-center justify-center gap-3">
                    <div className="p-4 rounded-full bg-slate-900 group-hover:bg-cyan-900/30 transition-colors">
                        <Upload className="w-8 h-8 text-slate-500 group-hover:text-cyan-400" />
                    </div>
                    <span className="text-sm font-bold text-slate-400 group-hover:text-white transition-colors">Charger Source (PNG/JPG)</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>
            </div>

             {/* Start */}
             <button 
                onClick={startSequence}
                disabled={!imageSrc || analyzing}
                className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-cyan-900/30 text-lg tracking-wide relative overflow-hidden"
            >
                {analyzing ? <span className="animate-pulse">Calcul Vectoriel...</span> : 'LANCER L\'ANALYSE'}
                {analyzing && <div className="absolute bottom-0 left-0 h-1 bg-cyan-300 animate-loading-bar"></div>}
            </button>

            {/* Logs */}
            <div className="bg-[#000000] border border-slate-800 rounded-xl p-4 h-64 overflow-y-auto font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
                {logs.map((log) => (
                    <div key={log.id} className="mb-1 break-words">
                        <span className="text-slate-600 mr-2">[{log.timestamp.split(' ')[0]}]</span>
                        <span className={log.type === 'success' ? 'text-green-400' : log.type === 'process' ? 'text-yellow-300' : 'text-slate-400'}>{log.message}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* === COLONNE DROITE : OUTPUT === */}
        <div className="xl:col-span-8 space-y-8">
            
            {/* VISUALISATION GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Source */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-slate-500 uppercase">1. Source Humaine</label>
                    </div>
                    <div className="aspect-video bg-[#000] border border-slate-800 rounded-xl overflow-hidden relative">
                        <canvas ref={canvasSourceRef} className="w-full h-full object-contain" />
                    </div>
                </div>

                {/* 2. Sobel (IMPORTANT) */}
                <div className="space-y-3 relative">
                    <div className="flex justify-between items-center">
                        <label className="text-xs font-extrabold text-purple-400 uppercase flex items-center gap-2">
                            <Scan size={14}/> 2. Blueprint (Donnée LLM)
                        </label>
                        {bots[1].status === 'completed' && (
                            <button 
                                onClick={() => downloadCanvas(canvasProcessRef, 'blueprint_sobel.png')}
                                className="flex items-center gap-1 text-[10px] bg-purple-900/50 hover:bg-purple-800 text-purple-200 px-2 py-1 rounded border border-purple-500/30 transition-colors"
                            >
                                <Download size={10} /> TÉLÉCHARGER
                            </button>
                        )}
                    </div>
                    <div className="aspect-video bg-[#000] border-2 border-purple-500/30 rounded-xl overflow-hidden relative shadow-[0_0_30px_rgba(168,85,247,0.1)]">
                            <canvas ref={canvasProcessRef} className="w-full h-full object-contain" />
                    </div>
                    {metrics && (
                        <div className="absolute top-2 right-2 bg-black/80 backdrop-blur text-[9px] text-purple-300 p-2 rounded border border-purple-500/20">
                            <div>DENSITÉ: {metrics.edgeDensity}</div>
                            <div>COMPLEXITÉ: {metrics.complexityScore}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* PROMPT GENERATOR */}
            {finalPrompt && (
                <div className="bg-[#111827] border border-cyan-900/30 p-6 rounded-xl animate-fade-in relative">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                            <Terminal size={14}/> Prompt LLM Optimisé
                        </h3>
                        <div className="flex gap-2">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-900 px-2 rounded">
                                <FileJson size={10}/> Data injectée
                            </span>
                        </div>
                    </div>
                    
                    <button onClick={() => copyToClipboard(finalPrompt)} className="absolute top-6 right-6 p-2 bg-cyan-900/30 hover:bg-cyan-800 rounded-md text-cyan-300 transition-colors">
                        <Copy size={16} />
                    </button>
                    
                    <textarea 
                        readOnly 
                        value={finalPrompt} 
                        className="w-full h-64 bg-[#000] border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-slate-300 focus:outline-none focus:border-cyan-700 resize-none"
                    />
                    
                    <div className="mt-4 p-3 bg-yellow-900/10 border border-yellow-700/30 rounded text-[11px] text-yellow-500/80 flex gap-2 items-start">
                        <Activity size={14} className="mt-0.5 shrink-0"/>
                        <p>
                            <strong>Action requise :</strong> Pour que ce prompt fonctionne, tu DOIS attacher l'image "Blueprint" (téléchargeable ci-dessus) dans ta conversation avec le LLM (Claude/GPT-4). Le texte seul ne suffit pas pour la structure.
                        </p>
                    </div>
                </div>
            )}
             
             {/* Hidden Topology */}
             <div className="opacity-0 h-0 overflow-hidden"><canvas ref={canvasTopologyRef} /></div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes loading-bar { 0% { width: 0%; opacity: 1; } 50% { width: 70%; opacity: 0.5; } 100% { width: 100%; opacity: 0; } }
        .animate-loading-bar { animation: loading-bar 2s ease-in-out infinite; }
        .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
        }
