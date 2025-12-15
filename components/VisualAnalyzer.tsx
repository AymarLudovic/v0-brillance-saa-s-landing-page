"use client";

import { useState, useRef } from "react";
import Script from "next/script";

// Types
export type DetectedElement = {
  id: number;
  type: 'CONTAINER' | 'TEXT_BLOCK' | 'BUTTON' | 'IMAGE'; // On essaie de deviner le type
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

interface VisualAnalyzerProps {
  onAnalysisComplete: (elements: DetectedElement[], annotatedImageSrc: string, originalImageSrc: string) => void;
  onClose: () => void;
}

export default function VisualAnalyzer({ onAnalysisComplete, onClose }: VisualAnalyzerProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState<DetectedElement[]>([]);
  
  // On garde une ref vers l'image originale pour ne pas l'altérer
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rgbToHex = (r: number, g: number, b: number) => 
    "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join("");

  const extractColor = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    if (cx < 0 || cy < 0) return "#FFFFFF";
    const p = ctx.getImageData(cx, cy, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  };

  const onOpenCvLoaded = () => {
    // @ts-ignore
    cv['onRuntimeInitialized'] = () => setIsOpenCvReady(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      setImageSrc(src);
      setElements([]);
      
      const img = new Image();
      img.onload = () => {
          originalImgRef.current = img;
          drawImageToCanvas(img);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const drawImageToCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };

  const runDetection = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Canvas virtuel pour l'analyse couleur (sans les dessins rouges)
    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');
    if (!virtualCtx || !originalImgRef.current) return;
    virtualCtx.drawImage(originalImgRef.current, 0, 0);

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      // Reset du canvas visible avec l'image propre avant de dessiner
      ctx.drawImage(img, 0, 0); 

      try {
        // @ts-ignore
        let src = cv.imread(canvas);
        // @ts-ignore
        let gray = new cv.Mat();
        // @ts-ignore
        let blurred = new cv.Mat();
        // @ts-ignore
        let binary = new cv.Mat();

        // Pipeline OpenCV standard
        // @ts-ignore
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        // @ts-ignore
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        // @ts-ignore
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Dilatation pour fusionner les lettres en blocs de texte
        // @ts-ignore
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U); 
        // @ts-ignore
        cv.dilate(binary, binary, kernel, new cv.Point(-1, -1), 2);

        // @ts-ignore
        let contours = new cv.MatVector();
        // @ts-ignore
        let hierarchy = new cv.Mat();
        // @ts-ignore
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const detectedItems: DetectedElement[] = [];
        
        // Configuration du style de dessin "DEBUG" pour l'IA
        ctx.lineWidth = 2;
        ctx.font = "bold 14px monospace";
        ctx.textBaseline = "top";

        // @ts-ignore
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            // @ts-ignore
            let rect = cv.boundingRect(contour);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            // Filtrage du bruit
            if (area > 100 && area < (canvasArea * 0.95)) {
                
                // Déduction basique du type pour aider l'IA
                let type: DetectedElement['type'] = 'CONTAINER';
                if (rect.height < 60 && rect.width > 60) type = 'BUTTON'; 
                if (rect.height < 40) type = 'TEXT_BLOCK';
                if (area > canvasArea * 0.4) type = 'IMAGE';

                const color = extractColor(virtualCtx, rect.x, rect.y, rect.width, rect.height);
                
                detectedItems.push({
                    id: i,
                    type,
                    x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                    color: color
                });

                // --- DESSIN DE L'ANCRAGE VISUEL SUR L'IMAGE ---
                // C'est ça qui permet le "Pixel Perfect" : L'IA verra ces boites.
                
                // 1. Boîte néon pour bien contraster
                ctx.strokeStyle = "#00FF00"; // Vert pur
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

                // 2. Étiquette ID (Fond noir, texte vert)
                const label = `#${i} [${type}]`;
                const textWidth = ctx.measureText(label).width;
                
                ctx.fillStyle = "#000000";
                ctx.fillRect(rect.x, rect.y - 20, textWidth + 10, 20);
                
                ctx.fillStyle = "#00FF00";
                ctx.fillText(label, rect.x + 5, rect.y - 18);
            }
        }

        detectedItems.sort((a, b) => a.y - b.y);
        setElements(detectedItems);

        // Nettoyage OpenCV
        src.delete(); gray.delete(); blurred.delete(); binary.delete();
        kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error("OpenCV Error:", err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  const handleSendToChat = () => {
    if (elements.length > 0 && canvasRef.current && originalImgRef.current) {
        // On envoie l'image annotée (celle du canvas) ET l'originale (stockée dans la ref)
        const annotatedMap = canvasRef.current.toDataURL("image/png");
        onAnalysisComplete(elements, annotatedMap, originalImgRef.current.src);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />
      
      <div className="bg-[#0A0A0A] w-full max-w-6xl h-[90vh] rounded-2xl flex flex-col border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-white/10 bg-black">
            <h2 className="text-white font-mono text-sm flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${isOpenCvReady ? 'bg-green-500' : 'bg-red-500'}`}></span>
                SYSTEME DE VISION_V2
            </h2>
            <button onClick={onClose} className="text-neutral-500 hover:text-white transition">Fermer</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
            {/* Zone Canvas Centrale */}
            <div className="flex-1 bg-[#111] relative flex items-center justify-center overflow-auto p-8">
                <canvas ref={canvasRef} className="max-w-full shadow-2xl border border-white/5" />
                {!imageSrc && (
                    <div className="absolute inset-0 flex items-center justify-center">
                         <input type="file" onChange={handleImageUpload} className="hidden" id="fileScan"/>
                         <label htmlFor="fileScan" className="bg-white text-black px-8 py-4 rounded-full cursor-pointer font-bold hover:scale-105 transition duration-300">
                            Charger l'interface UI
                         </label>
                    </div>
                )}
            </div>

            {/* Panel de droite : Données détectées */}
            <div className="w-80 bg-black border-l border-white/10 flex flex-col">
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-white font-bold mb-1">Analyseur de structure</h3>
                    <p className="text-neutral-500 text-xs">OpenCV + Détection de contours</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {elements.map((el) => (
                        <div key={el.id} className="group flex items-center gap-3 text-xs text-neutral-400 hover:bg-white/5 p-2 rounded transition border border-transparent hover:border-white/10">
                            <span className="font-mono text-green-500 font-bold">#{el.id}</span>
                            <div className="flex-1">
                                <div className="flex justify-between mb-1">
                                    <span className="text-white">{el.type}</span>
                                    <span>{el.w}x{el.h}</span>
                                </div>
                                <div className="h-1 w-full bg-neutral-800 rounded overflow-hidden">
                                    <div className="h-full" style={{width: '100%', backgroundColor: el.color}}></div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-4 border-t border-white/10 space-y-3">
                    {imageSrc && (
                        <button 
                            onClick={runDetection} 
                            disabled={!isOpenCvReady}
                            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 rounded-lg font-mono text-xs border border-white/10 transition"
                        >
                            {isProcessing ? 'SCAN EN COURS...' : '1. SCANNER LES ZONES'}
                        </button>
                    )}
                    
                    <button 
                        onClick={handleSendToChat}
                        disabled={elements.length === 0}
                        className="w-full bg-white text-black hover:bg-gray-200 py-3 rounded-lg font-bold text-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        2. GÉNÉRER LE CODE (PIXEL PERFECT)
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
    }
