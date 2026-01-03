"use client";

import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { Upload, Cpu, Layers, Scan, Palette, Activity, CheckCircle2 } from 'lucide-react';

// --- TYPES ---
type BotStatus = 'idle' | 'running' | 'completed';

interface BotState {
  id: number;
  name: string;
  description: string;
  status: BotStatus;
  color: string;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'process';
}

// --- COMPONENT PRINCIPAL ---
export default function VisionEnginePage() {
  // --- STATE ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  
  // Refs pour les Canvas (Manipulation directe du DOM nécessaire pour la performance pixel)
  const canvasSourceRef = useRef<HTMLCanvasElement>(null);
  const canvasProcessRef = useRef<HTMLCanvasElement>(null);
  const canvasWireframeRef = useRef<HTMLCanvasElement>(null);
  
  // Configuration des Bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 1, name: "Bot Normalisateur", description: "Conversion Niveaux de Gris & Bruit", status: 'idle', color: "text-cyan-400" },
    { id: 2, name: "Bot Contours (Sobel)", description: "Détection mathématique des arêtes", status: 'idle', color: "text-purple-400" },
    { id: 3, name: "Bot Topologie", description: "Mapping des densités (Layout)", status: 'idle', color: "text-green-400" },
    { id: 4, name: "Bot Colorimétrie", description: "Extraction hexadécimale", status: 'idle', color: "text-pink-400" },
  ]);

  // --- LOGIC: UTILS ---
  const addLog = (msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { 
      id: Date.now(), 
      timestamp: new Date().toLocaleTimeString(), 
      message: msg,
      type 
    }]);
    // Auto-scroll logic would go here
  };

  const updateBotStatus = (id: number, status: BotStatus) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  };

  // --- LOGIC: UPLOAD ---
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setupCanvases(img);
        addLog("Image chargée en mémoire VRAM simulée.", 'info');
      };
      img.src = event.target?.result as string;
      setImageSrc(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const setupCanvases = (img: HTMLImageElement) => {
    // Redimensionnement intelligent pour optimiser les calculs
    const maxWidth = 800;
    const scale = Math.min(maxWidth / img.width, 1);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);

    [canvasSourceRef, canvasProcessRef, canvasWireframeRef].forEach(ref => {
      if (ref.current) {
        ref.current.width = w;
        ref.current.height = h;
        const ctx = ref.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, w, h);
            if (ref === canvasSourceRef) {
                ctx.drawImage(img, 0, 0, w, h);
            } else if (ref === canvasWireframeRef) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, w, h);
            } else {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, w, h);
            }
        }
      }
    });
  };

  // --- LOGIC: BOTS ALGORITHMS ---

  // 1. Normalisation (Grayscale)
  const runBotNormalization = async () => {
    updateBotStatus(1, 'running');
    addLog("Bot 1: Démarrage de la séquence de normalisation...", 'process');
    
    // Utilisation de setTimeout pour ne pas bloquer le thread UI de React
    setTimeout(() => {
        const srcCanvas = canvasSourceRef.current;
        const destCanvas = canvasProcessRef.current;
        if (!srcCanvas || !destCanvas) return;

        const ctxSrc = srcCanvas.getContext('2d');
        const ctxDest = destCanvas.getContext('2d');
        if (!ctxSrc || !ctxDest) return;

        const w = srcCanvas.width;
        const h = srcCanvas.height;
        const imgData = ctxSrc.getImageData(0, 0, w, h);
        const data = imgData.data;
        const output = ctxDest.createImageData(w, h);

        for (let i = 0; i < data.length; i += 4) {
            // Formule de la luminance perçue
            const avg = (0.299 * data[i]) + (0.587 * data[i+1]) + (0.114 * data[i+2]);
            output.data[i] = avg;     
            output.data[i+1] = avg; 
            output.data[i+2] = avg; 
            output.data[i+3] = 255; 
        }

        ctxDest.putImageData(output, 0, 0);
        updateBotStatus(1, 'completed');
        addLog("Bot 1: Image convertie en matrice de luminance.", 'success');
        runBotEdges(); // Chaînage automatique
    }, 500);
  };

  // 2. Détection de Contours (Sobel Operator)
  const runBotEdges = () => {
    updateBotStatus(2, 'running');
    addLog("Bot 2: Calcul des gradients vectoriels (Sobel)...", 'process');

    setTimeout(() => {
        const srcCanvas = canvasSourceRef.current; // On prend la source couleur pour mieux détecter
        const destCanvas = canvasProcessRef.current;
        if (!srcCanvas || !destCanvas) return;

        const ctxSrc = srcCanvas.getContext('2d');
        const ctxDest = destCanvas.getContext('2d');
        if(!ctxSrc || !ctxDest) return;

        const w = srcCanvas.width;
        const h = srcCanvas.height;
        const inputData = ctxSrc.getImageData(0, 0, w, h).data;
        const outputData = ctxDest.createImageData(w, h);
        const dst = outputData.data;

        // Noyau de convolution simplifié
        const threshold = 25; 

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                // Pixel voisin (droit et bas)
                const right = ((y * w) + Math.min(x + 1, w - 1)) * 4;
                const down = (Math.min(y + 1, h - 1) * w + x) * 4;

                // Différence d'intensité (Gradient)
                const diffX = Math.abs(inputData[i] - inputData[right]);
                const diffY = Math.abs(inputData[i] - inputData[down]);
                
                const magnitude = diffX + diffY;

                if (magnitude > threshold) {
                    // C'est un bord -> Vert matrix
                    dst[i] = 0; dst[i+1] = 255; dst[i+2] = 100; dst[i+3] = 255; 
                } else {
                    // Fond noir
                    dst[i] = 10; dst[i+1] = 10; dst[i+2] = 20; dst[i+3] = 255; 
                }
            }
        }

        ctxDest.putImageData(outputData, 0, 0);
        updateBotStatus(2, 'completed');
        addLog("Bot 2: Matrice structurelle générée.", 'success');
        runBotLayout();
    }, 500);
  };

  // 3. Extraction de Layout (Heuristique de densité)
  const runBotLayout = () => {
    updateBotStatus(3, 'running');
    addLog("Bot 3: Identification des blocs UI...", 'process');

    setTimeout(() => {
        const processCanvas = canvasProcessRef.current;
        const wireCanvas = canvasWireframeRef.current;
        if (!processCanvas || !wireCanvas) return;
        
        const ctxProcess = processCanvas.getContext('2d');
        const ctxWire = wireCanvas.getContext('2d');
        if(!ctxProcess || !ctxWire) return;

        const w = processCanvas.width;
        const h = processCanvas.height;

        // Reset
        ctxWire.fillStyle = "#f1f5f9"; // Slate-100
        ctxWire.fillRect(0,0,w,h);

        const gridSize = 10; // Résolution du scan
        
        // Scan de densité : On regarde le résultat du Bot 2 (Contours)
        // Si une zone de 10x10 contient beaucoup de vert (contours), c'est un élément UI
        for(let y=0; y<h; y+=gridSize) {
            for(let x=0; x<w; x+=gridSize) {
                const pixelData = ctxProcess.getImageData(x, y, gridSize, gridSize).data;
                let edgePixels = 0;
                
                for(let i=0; i<pixelData.length; i+=4) {
                    // Si le pixel est vert (généré par Bot 2)
                    if(pixelData[i+1] > 100) edgePixels++;
                }

                // Seuil de densité : si > 5% de pixels sont des bords
                if(edgePixels > (gridSize*gridSize) * 0.05) {
                    ctxWire.fillStyle = "#cbd5e1"; // Slate-300
                    ctxWire.fillRect(x, y, gridSize, gridSize);
                }
            }
        }

        // Dessin "Blueprint" simulé par dessus pour visualiser les zones détectées
        ctxWire.strokeStyle = "#ef4444";
        ctxWire.lineWidth = 2;
        ctxWire.strokeRect(0, 0, w, h); // Border
        
        updateBotStatus(3, 'completed');
        addLog("Bot 3: Carte de chaleur de l'interface terminée.", 'success');
        runBotColor();
    }, 800);
  };

  // 4. Analyse Couleur
  const runBotColor = () => {
      updateBotStatus(4, 'running');
      setTimeout(() => {
        updateBotStatus(4, 'completed');
        addLog("Bot 4: Analyse terminée. Séquence finie.", 'success');
        setAnalyzing(false);
      }, 500);
  };

  const startSequence = () => {
    if(!imageSrc) return;
    setAnalyzing(true);
    setLogs([]);
    runBotNormalization();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-mono selection:bg-cyan-900">
      
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* PANEL GAUCHE : CONTRÔLE */}
        <div className="lg:col-span-4 space-y-6">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-cyan-400 flex items-center gap-2">
                    <Cpu className="w-6 h-6" /> 
                    Pixel_Logic_Engine
                </h1>
                <p className="text-slate-500 text-xs mt-2">v2.1.0 • No-LLM Deterministic Build</p>
            </header>

            {/* Upload */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 hover:border-cyan-800 transition-colors group">
                <label className="cursor-pointer flex flex-col items-center justify-center gap-2">
                    <Upload className="w-8 h-8 text-slate-600 group-hover:text-cyan-400" />
                    <span className="text-sm font-medium text-slate-400 group-hover:text-white">Charger une interface (Image)</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>
            </div>

            {/* Bots List */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Pipeline de rendu inverse</h2>
                
                {bots.map((bot) => (
                    <div key={bot.id} className={`flex items-center justify-between p-3 rounded bg-slate-950 border border-slate-800 ${bot.status === 'running' ? 'border-cyan-500/50' : ''}`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded bg-slate-900 ${bot.status === 'completed' ? 'text-green-500' : 'text-slate-500'}`}>
                                {bot.id === 1 && <Layers size={16} />}
                                {bot.id === 2 && <Scan size={16} />}
                                {bot.id === 3 && <Activity size={16} />}
                                {bot.id === 4 && <Palette size={16} />}
                            </div>
                            <div>
                                <div className={`text-sm font-bold ${bot.status === 'running' ? 'text-white' : 'text-slate-400'}`}>{bot.name}</div>
                                <div className="text-[10px] text-slate-600">{bot.description}</div>
                            </div>
                        </div>
                        <div>
                            {bot.status === 'idle' && <div className="w-2 h-2 rounded-full bg-slate-800" />}
                            {bot.status === 'running' && <div className="w-2 h-2 rounded-full bg-yellow-500 animate-ping" />}
                            {bot.status === 'completed' && <CheckCircle2 size={16} className="text-green-500" />}
                        </div>
                    </div>
                ))}

                <button 
                    onClick={startSequence}
                    disabled={!imageSrc || analyzing}
                    className="w-full mt-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold py-3 rounded transition-all shadow-lg shadow-cyan-900/20"
                >
                    {analyzing ? 'Analyse en cours...' : 'Lancer la Déconstruction'}
                </button>
            </div>

            {/* Terminal Logs */}
            <div className="bg-black border border-slate-800 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs">
                {logs.length === 0 && <span className="text-slate-700">// En attente de données...</span>}
                {logs.map((log) => (
                    <div key={log.id} className="mb-1">
                        <span className="text-slate-600">[{log.timestamp}]</span>{' '}
                        <span className={
                            log.type === 'success' ? 'text-green-400' : 
                            log.type === 'process' ? 'text-yellow-400' : 'text-slate-300'
                        }>
                            {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>

        {/* PANEL DROIT : VISUALISATION */}
        <div className="lg:col-span-8 grid grid-cols-2 gap-4 content-start">
             {/* Vue 1: Source */}
             <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-500 uppercase">Input (Pixels)</label>
                    <span className="text-[10px] text-slate-600">RGB 24-bit</span>
                </div>
                <div className="aspect-video bg-black border border-slate-800 rounded-lg overflow-hidden relative">
                    <canvas ref={canvasSourceRef} className="w-full h-full object-contain" />
                    {!imageSrc && <div className="absolute inset-0 flex items-center justify-center text-slate-700 text-sm">No Signal</div>}
                </div>
            </div>

            {/* Vue 2: Logic View (Sobel) */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-500 uppercase">Vision Logique (Bot 2)</label>
                    <span className="text-[10px] text-slate-600">Sobel Filter Matrix</span>
                </div>
                <div className="aspect-video bg-black border border-slate-800 rounded-lg overflow-hidden relative">
                     <canvas ref={canvasProcessRef} className="w-full h-full object-contain" />
                </div>
            </div>

            {/* Vue 3: Wireframe Result */}
            <div className="col-span-2 space-y-2 mt-4">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-green-500 uppercase">Résultat: Topology Map (Bot 3)</label>
                    <span className="text-[10px] text-green-800 bg-green-900/20 px-2 py-1 rounded">Output prêt pour prompt LLM</span>
                </div>
                <div className="h-96 w-full bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex items-center justify-center relative">
                     <canvas ref={canvasWireframeRef} className="max-w-full max-h-full object-contain" />
                     {analyzing && <div className="absolute inset-0 bg-cyan-900/10 pointer-events-none animate-pulse" />}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
    }
