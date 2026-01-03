"use client";

import React, { useState, useRef, ChangeEvent } from 'react';
import { Upload, Cpu, Scan, Activity, Play, Eye, Code, Terminal, Zap } from 'lucide-react';

// --- CONFIGURATION ---
const CONFIG = {
  gridSize: 6, // Plus petit = plus précis (mais plus lourd)
  threshold: 40, // Sensibilité de détection des bords
  colors: {
    bg: '#050505',
    primary: '#00ff41', // Matrix Green
    secondary: 'rgba(0, 255, 65, 0.15)', // Transparent Green
  }
};

export default function WireframeEngine() {
  // --- STATE ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [nodeCount, setNodeCount] = useState(0);

  // Refs
  const canvasSourceRef = useRef<HTMLCanvasElement>(null);
  const canvasSobelRef = useRef<HTMLCanvasElement>(null);

  // --- LOGIC ---
  const addLog = (msg: string) => setLogs(prev => [`> ${msg}`, ...prev]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => { setupCanvases(img); addLog("Source chargée. Prêt pour extraction vectorielle."); };
      img.src = event.target?.result as string;
      setImageSrc(event.target?.result as string);
      setGeneratedCode(""); setNodeCount(0);
    };
    reader.readAsDataURL(file);
  };

  const setupCanvases = (img: HTMLImageElement) => {
    const maxWidth = 800; 
    const scale = Math.min(maxWidth / img.width, 1);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);

    [canvasSourceRef, canvasSobelRef].forEach(ref => {
      if (ref.current) {
        ref.current.width = w; ref.current.height = h;
        const ctx = ref.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, w, h);
            if (ref === canvasSourceRef) ctx.drawImage(img, 0, 0, w, h);
            else { ctx.fillStyle = "#000"; ctx.fillRect(0,0,w,h); }
        }
      }
    });
  };

  // --- ENGINE CORE ---
  const runSequence = async () => {
    if(!imageSrc) return;
    setIsProcessing(true); setLogs([]);
    
    // 1. SOBEL FILTER
    addLog("Phase 1: Sobel Edge Detection...");
    await new Promise(r => setTimeout(r, 100));
    runSobel();
    
    // 2. DOM GENERATION
    addLog("Phase 2: Conversion Vectorielle -> HTML/CSS...");
    await new Promise(r => setTimeout(r, 500));
    runWireframeGenerator();
    
    setIsProcessing(false);
  };

  const runSobel = () => {
    const src = canvasSourceRef.current;
    const dest = canvasSobelRef.current;
    if (!src || !dest) return;
    
    const ctxSrc = src.getContext('2d');
    const ctxDest = dest.getContext('2d');
    if(!ctxSrc || !ctxDest) return;
    
    const w = src.width; const h = src.height;
    const inputData = ctxSrc.getImageData(0, 0, w, h).data;
    const outputData = ctxDest.createImageData(w, h);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            // Grayscale rapide
            const gray = (inputData[i]*0.3 + inputData[i+1]*0.59 + inputData[i+2]*0.11);
            
            // Detection bords (simplifiée pour perf)
            const right = ((y * w) + Math.min(x + 1, w - 1)) * 4;
            const down = (Math.min(y + 1, h - 1) * w + x) * 4;
            const diff = Math.abs(gray - inputData[right]) + Math.abs(gray - inputData[down]); // Comparaison brute canal rouge suffisant souvent

            if (diff > 15) {
                // VERT FLUO INTENSE
                outputData.data[i] = 0; 
                outputData.data[i+1] = 255; 
                outputData.data[i+2] = 65; 
                outputData.data[i+3] = 255; 
            } else {
                outputData.data[i] = 0; outputData.data[i+1] = 0; outputData.data[i+2] = 0; outputData.data[i+3] = 255;
            }
        }
    }
    ctxDest.putImageData(outputData, 0, 0);
  };

  const runWireframeGenerator = () => {
    const sobelCanvas = canvasSobelRef.current;
    if (!sobelCanvas) return;
    const ctx = sobelCanvas.getContext('2d');
    if (!ctx) return;

    const w = sobelCanvas.width;
    const h = sobelCanvas.height;
    const gs = CONFIG.gridSize;
    let divs = "";
    let nodes = 0;

    // SCANNING GRID
    for(let y = 0; y < h; y += gs) {
        for(let x = 0; x < w; x += gs) {
            
            // Analyse de l'énergie dans la case (Combien de vert ?)
            const data = ctx.getImageData(x, y, gs, gs).data;
            let greenEnergy = 0;
            for(let k=0; k<data.length; k+=4) {
                if(data[k+1] > 100) greenEnergy++;
            }

            // SEUILS DE DÉCISION
            if(greenEnergy > 0) {
                const density = greenEnergy / (gs * gs);
                let style = "";
                
                // TYPE 1: TEXTE / CONTENU DENSE (Bloc semi-transparent)
                if(density > 0.3) {
                     style = `background: ${CONFIG.colors.secondary}; box-shadow: 0 0 4px ${CONFIG.colors.secondary};`;
                } 
                // TYPE 2: BORDURE / STRUCTURE (Ligne fine)
                else {
                    // On simule un pixel "allumé"
                    style = `background: ${CONFIG.colors.primary}; box-shadow: 0 0 2px ${CONFIG.colors.primary}; opacity: 0.8;`;
                }

                // Génération du div absolu
                divs += `<div style="position:absolute; left:${x}px; top:${y}px; width:${gs}px; height:${gs}px; ${style}"></div>`;
                nodes++;
            }
        }
    }

    setNodeCount(nodes);
    addLog(`Structure terminée : ${nodes} nœuds DOM injectés.`);

    // LE CODE FINAL (TEMPLATE MATRIX)
    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
    body { background: #000; margin: 0; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: monospace; }
    .scan-container { position: relative; width: ${w}px; height: ${h}px; border: 1px solid #111; }
    /* Effet CRT optionnel */
    .scan-container::after {
        content: " "; display: block; position: absolute; top: 0; left: 0; bottom: 0; right: 0;
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
        z-index: 2; background-size: 100% 2px, 3px 100%; pointer-events: none;
    }
</style>
</head>
<body>
    <div class="scan-container">
        ${divs}
    </div>
</body>
</html>`;
    setGeneratedCode(html);
  };

  return (
    <div className="min-h-screen bg-[#020202] text-green-500 font-mono p-4 selection:bg-green-900 selection:text-white">
      
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-green-900/30 pb-4 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Terminal className="animate-pulse" /> 
          WIREFRAME_ARCHITECT <span className="text-xs bg-green-900/20 px-2 py-1 rounded text-green-400">V5.0</span>
        </h1>
        <div className="flex gap-4 text-xs text-green-700">
            <span>GRID_SIZE: {CONFIG.gridSize}px</span>
            <span>THRESHOLD: {CONFIG.threshold}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">

        {/* --- LEFT: CONTROL & VISUALS --- */}
        <div className="lg:col-span-5 flex flex-col gap-4 h-full">
            
            {/* UPLOAD & ACTION */}
            <div className="flex gap-2">
                <label className="flex-1 bg-green-900/10 border border-green-800/50 hover:bg-green-900/20 hover:border-green-500 cursor-pointer h-16 flex items-center justify-center gap-2 rounded transition-all">
                    <Upload size={18} />
                    <span className="text-xs font-bold">CHARGER SOURCE</span>
                    <input type="file" className="hidden" onChange={handleImageUpload} />
                </label>
                <button 
                    onClick={runSequence}
                    disabled={!imageSrc || isProcessing}
                    className="flex-1 bg-green-600 hover:bg-green-500 text-black font-bold h-16 flex items-center justify-center gap-2 rounded transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                >
                    {isProcessing ? <Activity className="animate-spin" /> : <Play />}
                    <span className="text-xs">EXTRAIRE LE CODE</span>
                </button>
            </div>

            {/* PREVIEWS */}
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-green-900">
                <div className="border border-green-900/30 p-2 rounded bg-black">
                    <div className="flex justify-between mb-1 text-[10px] uppercase text-green-700 font-bold">
                        <span>Input Source</span>
                        <span>RGB</span>
                    </div>
                    <canvas ref={canvasSourceRef} className="w-full h-auto opacity-50 hover:opacity-100 transition-opacity" />
                </div>
                
                <div className="border border-green-500/50 p-2 rounded bg-black relative">
                    <div className="flex justify-between mb-1 text-[10px] uppercase text-green-400 font-bold">
                        <span className="flex items-center gap-1"><Scan size={10}/> Sobel Logic</span>
                        <span>MATRIX_LAYER</span>
                    </div>
                    <canvas ref={canvasSobelRef} className="w-full h-auto" />
                    {isProcessing && <div className="absolute inset-0 bg-green-900/20 animate-pulse"></div>}
                </div>
            </div>

            {/* LOGS */}
            <div className="h-32 bg-black border border-green-900/50 p-3 font-mono text-[10px] overflow-y-auto shadow-[inset_0_0_20px_rgba(0,50,0,0.5)]">
                {logs.map((l, i) => <div key={i} className="opacity-80">{l}</div>)}
                {!logs.length && <span className="text-green-900">// Attente d'instructions...</span>}
            </div>
        </div>

        {/* --- RIGHT: FINAL OUTPUT --- */}
        <div className="lg:col-span-7 flex flex-col h-full bg-[#080808] border border-green-900 rounded-lg overflow-hidden relative shadow-[0_0_50px_rgba(0,255,65,0.05)]">
            <div className="bg-black border-b border-green-900 p-3 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Eye size={16} />
                    <span className="text-xs font-bold tracking-widest text-green-400">RENDU DOM (HTML GÉNÉRÉ)</span>
                </div>
                <div className="text-[10px] text-green-600 bg-green-900/10 px-2 py-1 rounded border border-green-900/30">
                    {nodeCount > 0 ? `${nodeCount} DIVS INJECTÉS` : 'STANDBY'}
                </div>
            </div>

            <div className="flex-1 relative bg-black">
                {generatedCode ? (
                    <iframe 
                        srcDoc={generatedCode}
                        className="w-full h-[380px] border-none"
                        title="Wireframe Output"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-green-900/30 gap-4">
                        <Cpu size={64} strokeWidth={1} />
                        <p className="text-xs uppercase tracking-[0.2em]">En attente du signal Sobel...</p>
                    </div>
                )}
            </div>
            
            {/* Raw Code Snippet */}
            {generatedCode && (
                <div className="h-12 bg-black border-t border-green-900 flex items-center px-4 justify-between">
                     <span className="text-[10px] text-green-700 truncate w-2/3">{`<div style="position:absolute; background:#00ff41...">`}</span>
                     <button 
                        onClick={() => navigator.clipboard.writeText(generatedCode)}
                        className="text-[10px] bg-green-900/20 hover:bg-green-900/50 text-green-400 px-3 py-1 rounded border border-green-800 transition-colors"
                     >
                        COPIER HTML
                     </button>
                </div>
            )}
        </div>

      </div>
    </div>
  );
    }
