"use client";

import React, { useState, useRef, ChangeEvent, useEffect } from 'react';
import { Upload, Cpu, Scan, Layers, Play, Code, Eye, RefreshCw, BoxSelect } from 'lucide-react';

// --- TYPES ---
type BotStatus = 'idle' | 'running' | 'completed';

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'process' | 'error';
}

// --- HELPER: RGB to HEX ---
const rgbToHex = (r: number, g: number, b: number) => 
  "#" + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');

export default function ArchitectEnginePage() {
  // --- STATE ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string>("");
  
  // Refs Canvas
  const canvasSourceRef = useRef<HTMLCanvasElement>(null);
  const canvasSobelRef = useRef<HTMLCanvasElement>(null); // Le plan structurel
  
  // Stats
  const [elementCount, setElementCount] = useState(0);

  // --- LOGS ---
  const addLog = (msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { id: Date.now(), timestamp: new Date().toLocaleTimeString().split(' ')[0], message: msg, type }]);
  };

  // --- 1. UPLOAD ---
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => { 
          setupCanvases(img); 
          addLog("Source initialisée. Moteur prêt.", 'info'); 
      };
      img.src = event.target?.result as string;
      setImageSrc(event.target?.result as string);
      setGeneratedCode(""); setLogs([]); setElementCount(0);
    };
    reader.readAsDataURL(file);
  };

  const setupCanvases = (img: HTMLImageElement) => {
    const maxWidth = 600; // On réduit légèrement pour la performance du scan DOM
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
            else { ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, w, h); }
        }
      }
    });
  };

  // --- SEQUENCE DE CONSTRUCTION ---
  const runArchitectSequence = async () => {
    if(!imageSrc) return;
    setIsProcessing(true);
    setLogs([]);
    setGeneratedCode("");

    try {
        await runSobelScan();
        await runDomAssembler(); // LE NOUVEAU BOT
    } catch (e) {
        addLog("Erreur critique dans la matrice.", 'error');
    } finally {
        setIsProcessing(false);
    }
  };

  // --- BOT 1: SOBEL (Extraction de Structure) ---
  const runSobelScan = () => {
    return new Promise<void>((resolve) => {
        addLog("Bot 1: Extraction des arêtes (Sobel)...", 'process');
        setTimeout(() => {
            const src = canvasSourceRef.current;
            const dest = canvasSobelRef.current;
            if (!src || !dest) return resolve();
            
            const ctxSrc = src.getContext('2d');
            const ctxDest = dest.getContext('2d');
            if(!ctxSrc || !ctxDest) return resolve();
            
            const w = src.width; const h = src.height;
            const inputData = ctxSrc.getImageData(0, 0, w, h).data;
            const outputData = ctxDest.createImageData(w, h);
            
            // Grayscale + Sobel Kernel
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = (y * w + x) * 4;
                    // Simple grayscale pour le calcul
                    const gray = (inputData[idx]*0.3 + inputData[idx+1]*0.59 + inputData[idx+2]*0.11);
                    
                    // Détection simplifiée des bords (Contraste voisin)
                    const rightIdx = ((y * w) + Math.min(x + 1, w - 1)) * 4;
                    const downIdx = (Math.min(y + 1, h - 1) * w + x) * 4;
                    
                    const diff = Math.abs(gray - (inputData[rightIdx]*0.3 + inputData[rightIdx+1]*0.59 + inputData[rightIdx+2]*0.11)) +
                                 Math.abs(gray - (inputData[downIdx]*0.3 + inputData[downIdx+1]*0.59 + inputData[downIdx+2]*0.11));

                    const threshold = 15;
                    if (diff > threshold) {
                        // Bord détecté -> VERT (pour le style Matrix)
                        outputData.data[idx] = 0; 
                        outputData.data[idx+1] = 255; 
                        outputData.data[idx+2] = 0; 
                        outputData.data[idx+3] = 255; 
                    } else {
                        outputData.data[idx] = 0; 
                        outputData.data[idx+1] = 0; 
                        outputData.data[idx+2] = 0; 
                        outputData.data[idx+3] = 255;
                    }
                }
            }
            ctxDest.putImageData(outputData, 0, 0);
            addLog("Bot 1: Matrice structurelle terminée.", 'success');
            resolve();
        }, 100);
    });
  };

  // --- BOT 2: L'ASSEMBLEUR (Le Constructeur HTML) ---
  const runDomAssembler = () => {
    return new Promise<void>((resolve) => {
        addLog("Bot 2: Reconstruction DOM Pixel-par-Pixel...", 'process');
        
        setTimeout(() => {
            const sobelCanvas = canvasSobelRef.current;
            const sourceCanvas = canvasSourceRef.current;
            if (!sobelCanvas || !sourceCanvas) return resolve();

            const ctxSobel = sobelCanvas.getContext('2d');
            const ctxSource = sourceCanvas.getContext('2d');
            if (!ctxSobel || !ctxSource) return resolve();

            const w = sobelCanvas.width;
            const h = sobelCanvas.height;
            const gridSize = 10; // Résolution de la reconstruction (plus petit = plus précis mais plus lourd)
            
            let divs = "";
            let count = 0;

            // On scanne la grille
            for(let y = 0; y < h; y += gridSize) {
                for(let x = 0; x < w; x += gridSize) {
                    
                    // 1. Analyse de la densité dans ce bloc (Sobel)
                    const sobelData = ctxSobel.getImageData(x, y, gridSize, gridSize).data;
                    let edgePixels = 0;
                    for(let i=0; i<sobelData.length; i+=4) {
                        if(sobelData[i+1] > 100) edgePixels++; // Si pixel vert
                    }

                    // Seuil de détection : S'il y a assez de "structure" ici
                    if(edgePixels > 2) {
                        // 2. Échantillonnage de la couleur réelle (Source)
                        const sourceData = ctxSource.getImageData(x, y, gridSize, gridSize).data;
                        // On prend la couleur du pixel central du bloc pour la moyenne
                        const centerIdx = Math.floor(sourceData.length / 2);
                        // Alignement sur canal Rouge (R, G, B, A) -> on recule au début du pixel (modulo 4)
                        const safeIdx = centerIdx - (centerIdx % 4);
                        
                        const r = sourceData[safeIdx];
                        const g = sourceData[safeIdx+1];
                        const b = sourceData[safeIdx+2];
                        const hex = rgbToHex(r, g, b);

                        // 3. Construction du HTML Element
                        // On utilise position: absolute pour une fidélité stricte aux coordonnées
                        divs += `
                        <div style="
                            position: absolute;
                            left: ${x}px;
                            top: ${y}px;
                            width: ${gridSize}px;
                            height: ${gridSize}px;
                            background-color: ${hex};
                            opacity: 0.8;
                            border-radius: 2px;
                            pointer-events: none;
                        "></div>`;
                        count++;
                    }
                }
            }

            // Génération du Wrapper HTML complet
            const fullHtml = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 0; background: #111; overflow: hidden; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .canvas-container { 
      position: relative; 
      width: ${w}px; 
      height: ${h}px; 
      background: #000; 
      box-shadow: 0 0 50px rgba(0,0,0,0.5);
  }
</style>
</head>
<body>
  <div class="canvas-container">
    ${divs}
  </div>
</body>
</html>`;

            setElementCount(count);
            setGeneratedCode(fullHtml);
            addLog(`Bot 2: ${count} éléments DOM injectés aux coordonnées exactes.`, 'success');
            resolve();
        }, 500);
    });
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 p-6 font-mono selection:bg-green-900/50">
      
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-3rem)]">
        
        {/* === GAUCHE : INPUT & PROCESSING === */}
        <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Header */}
            <div className="bg-[#111] border border-slate-800 p-4 rounded-xl flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-green-500 flex items-center gap-2">
                        <Cpu size={20}/> ARCHITECT_ENGINE v4
                    </h1>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Reconstruction Déterministe</p>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-white">{elementCount}</div>
                    <div className="text-[9px] text-slate-500">NODES GÉNÉRÉS</div>
                </div>
            </div>

            {/* Controls */}
            <div className="grid grid-cols-2 gap-2">
                <label className="bg-[#111] border border-dashed border-slate-700 hover:border-green-500 cursor-pointer rounded-lg h-24 flex flex-col items-center justify-center transition-all group">
                    <Upload className="text-slate-500 group-hover:text-green-400 mb-2" size={20}/>
                    <span className="text-[10px] font-bold text-slate-400">INPUT SOURCE</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>

                <button 
                    onClick={runArchitectSequence}
                    disabled={!imageSrc || isProcessing}
                    className="bg-green-900/20 border border-green-800/50 hover:bg-green-900/40 text-green-400 rounded-lg flex flex-col items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                    {isProcessing ? <RefreshCw className="animate-spin mb-2" size={20}/> : <Play className="mb-2" size={20}/>}
                    <span className="text-[10px] font-bold">LANCER LA RECONSTRUCTION</span>
                </button>
            </div>

            {/* Visualisation Pipeline */}
            <div className="flex-1 bg-[#0a0a0a] border border-slate-800 rounded-xl p-4 overflow-y-auto space-y-6 scrollbar-none">
                
                {/* Source */}
                <div className="relative group">
                    <div className="absolute -left-3 top-0 bottom-0 w-1 bg-slate-800"></div>
                    <label className="text-[10px] font-bold text-slate-500 mb-2 block pl-2">STEP 1: SOURCE</label>
                    <div className="aspect-video bg-black rounded border border-slate-800 overflow-hidden">
                        <canvas ref={canvasSourceRef} className="w-full h-full object-contain" />
                    </div>
                </div>

                {/* Sobel */}
                <div className="relative group">
                    <div className="absolute -left-3 top-0 bottom-0 w-1 bg-green-900"></div>
                    <label className="text-[10px] font-bold text-green-600 mb-2 block pl-2 flex items-center gap-2">
                        <Scan size={12}/> STEP 2: BLUEPRINT (SOBEL)
                    </label>
                    <div className="aspect-video bg-black rounded border border-green-900/50 overflow-hidden relative">
                        <canvas ref={canvasSobelRef} className="w-full h-full object-contain opacity-80" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none"></div>
                    </div>
                </div>

                 {/* Console */}
                 <div className="font-mono text-[10px] space-y-1 pt-4 border-t border-slate-900">
                    {logs.map(log => (
                        <div key={log.id} className={`${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-400' : 'text-slate-600'}`}>
                            {`> ${log.message}`}
                        </div>
                    ))}
                    {isProcessing && <div className="text-green-500 animate-pulse">{`> Traitement en cours...`}</div>}
                </div>

            </div>
        </div>

        {/* === DROITE : LIVE PREVIEW (IFRAME) === */}
        <div className="lg:col-span-7 bg-[#111] border border-slate-800 rounded-xl flex flex-col overflow-hidden">
            <div className="bg-[#080808] p-3 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2 text-slate-400">
                    <Eye size={16} />
                    <span className="text-xs font-bold tracking-wider">RENDU FINAL (HTML/CSS INJECTÉ)</span>
                </div>
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                </div>
            </div>

            <div className="flex-1 relative bg-neutral-900 checkerboard-pattern">
                {generatedCode ? (
                    <iframe 
                        title="Rendered Result"
                        srcDoc={generatedCode}
                        className="w-full h-full border-none"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700 gap-4">
                        <BoxSelect size={48} strokeWidth={1} />
                        <p className="text-xs uppercase tracking-widest">En attente de reconstruction...</p>
                    </div>
                )}
            </div>
            
            {/* Raw Code Toggle (Optional) */}
            <div className="h-32 bg-[#050505] border-t border-slate-800 p-4 overflow-hidden relative group">
                 <div className="absolute top-2 right-2 p-1 bg-slate-900 rounded text-slate-500">
                    <Code size={14}/>
                 </div>
                 <pre className="text-[10px] text-slate-600 font-mono overflow-hidden opacity-50 group-hover:opacity-100 transition-opacity">
                    {generatedCode || "// Le code brut apparaîtra ici..."}
                 </pre>
            </div>
        </div>

      </div>

      <style jsx global>{`
        .checkerboard-pattern {
            background-image: linear-gradient(45deg, #111 25%, transparent 25%), 
                              linear-gradient(-45deg, #111 25%, transparent 25%), 
                              linear-gradient(45deg, transparent 75%, #111 75%), 
                              linear-gradient(-45deg, transparent 75%, #111 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        }
      `}</style>
    </div>
  );
  }
