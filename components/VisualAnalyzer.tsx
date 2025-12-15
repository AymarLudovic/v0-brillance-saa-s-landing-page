"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

// ... (Tes types DetectedElement restent les mêmes) ...
export type DetectedElement = {
  id: number;
  type: 'CONTAINER' | 'TEXT_BLOCK' | 'BUTTON' | 'IMAGE';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

// --- NOUVEAU : Fonction utilitaire pour redimensionner l'image ---
// C'est ça qui sauve ta mémoire RAM
const resizeImage = (file: File, maxWidth: number = 1280): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Calcul du ratio pour ne pas déformer
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Compression en JPEG qualité 0.8 pour alléger encore
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
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
  
  const originalImgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ... (Tes fonctions rgbToHex, extractColor, onOpenCvLoaded restent les mêmes) ...
  const rgbToHex = (r: number, g: number, b: number) => 
    "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join("");

  const extractColor = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    if (cx < 0 || cy < 0) return "#FFFFFF";
    // Sécurité pour éviter de lire hors du canvas
    if (cx >= ctx.canvas.width || cy >= ctx.canvas.height) return "#000000";
    
    const p = ctx.getImageData(cx, cy, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  };

  const onOpenCvLoaded = () => {
    // @ts-ignore
    cv['onRuntimeInitialized'] = () => setIsOpenCvReady(true);
  };

  // --- MODIFIÉ : Gestionnaire d'upload sécurisé ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        setIsProcessing(true); // Petit feedback visuel immédiat
        
        // 1. On redimensionne AVANT de toucher au State ou au Canvas
        const resizedBase64 = await resizeImage(file, 1024); // Max 1024px suffit largement pour l'IA
        
        setImageSrc(resizedBase64);
        setElements([]);

        // 2. On charge l'image optimisée
        const img = new Image();
        img.onload = () => {
            originalImgRef.current = img;
            drawImageToCanvas(img);
            setIsProcessing(false);
        };
        img.src = resizedBase64;

    } catch (err) {
        console.error("Erreur chargement image", err);
        setIsProcessing(false);
    }
  };

  const drawImageToCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); // Optimisation pour OpenCV
    if (!ctx) return;
    
    // On force la taille du canvas à celle de l'image REDIMENSIONNÉE
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };

  const runDetection = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    // Petit délai pour laisser le UI se mettre à jour avant de figer le thread avec OpenCV
    setTimeout(() => {
        try {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return;

            // Canvas virtuel pour l'analyse couleur
            const virtualCanvas = document.createElement('canvas');
            virtualCanvas.width = canvas.width;
            virtualCanvas.height = canvas.height;
            const virtualCtx = virtualCanvas.getContext('2d', { willReadFrequently: true });
            if (!virtualCtx || !originalImgRef.current) return;
            virtualCtx.drawImage(originalImgRef.current, 0, 0);

            // --- DEBUT OPENCV ---
            // @ts-ignore
            let src = cv.imread(canvas);
            // @ts-ignore
            let gray = new cv.Mat();
            // @ts-ignore
            let blurred = new cv.Mat();
            // @ts-ignore
            let binary = new cv.Mat();
            
            // @ts-ignore
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            // @ts-ignore
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
            // @ts-ignore
            cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

            // Optimisation mémoire : on relâche 'src' et 'gray' dès qu'on n'en a plus besoin si possible
            // Ici on garde tout jusqu'à la fin du try, mais on s'assure de delete

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
            
            ctx.lineWidth = 2;
            ctx.font = "bold 12px Arial";
            ctx.textBaseline = "top";

            // @ts-ignore
            for (let i = 0; i < contours.size(); ++i) {
                let contour = contours.get(i);
                // @ts-ignore
                let rect = cv.boundingRect(contour);
                let area = rect.width * rect.height;
                let canvasArea = canvas.width * canvas.height;

                if (area > 100 && area < (canvasArea * 0.95)) {
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

                    // Dessin
                    ctx.strokeStyle = "#00FF00";
                    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
                    
                    // Fond noir pour texte
                    const label = `#${i}`;
                    ctx.fillStyle = "black";
                    ctx.fillRect(rect.x, rect.y - 14, 30, 14);
                    ctx.fillStyle = "#00FF00";
                    ctx.fillText(label, rect.x + 2, rect.y - 14);
                }
            }

            detectedItems.sort((a, b) => a.y - b.y);
            setElements(detectedItems);

            // --- NETTOYAGE CRITIQUE DE LA MÉMOIRE ---
            src.delete(); gray.delete(); blurred.delete(); binary.delete();
            kernel.delete(); contours.delete(); hierarchy.delete();

        } catch (err) {
            console.error("OpenCV Processing Error:", err);
        } finally {
            setIsProcessing(false);
        }
    }, 100);
  };

  // ... (handleSendToChat et le return JSX restent identiques) ...
  const handleSendToChat = () => {
    if (elements.length > 0 && canvasRef.current && originalImgRef.current) {
        // L'image est déjà légère, donc toDataURL ne crashera pas
        const annotatedMap = canvasRef.current.toDataURL("image/jpeg", 0.8);
        onAnalysisComplete(elements, annotatedMap, originalImgRef.current.src);
    }
  };

  return (
    // ... Ton JSX actuel ...
    // Juste un changement dans l'input file pour le callback
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
        <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />
        <div className="bg-[#0A0A0A] w-full max-w-6xl h-[90vh] rounded-2xl flex flex-col border border-white/10 shadow-2xl overflow-hidden">
             {/* ... Header ... */}
             <div className="flex flex-1 overflow-hidden">
                <div className="flex-1 bg-[#111] relative flex items-center justify-center overflow-auto p-8">
                    <canvas ref={canvasRef} className="max-w-full shadow-2xl border border-white/5" />
                    {!imageSrc && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <input type="file" onChange={handleImageUpload} className="hidden" id="fileScan" accept="image/*" />
                            <label htmlFor="fileScan" className="bg-white text-black px-8 py-4 rounded-full cursor-pointer font-bold hover:scale-105 transition duration-300">
                                Charger l'interface UI
                            </label>
                        </div>
                    )}
                </div>
                {/* ... Sidebar ... */}
                 <div className="w-80 bg-black border-l border-white/10 flex flex-col">
                    {/* Boutons et liste */}
                     <div className="p-4 border-t border-white/10 space-y-3 mt-auto">
                        {imageSrc && (
                            <button 
                                onClick={runDetection} 
                                disabled={!isOpenCvReady || isProcessing}
                                className="w-full bg-neutral-800 hover:bg-neutral-700 text-white py-3 rounded-lg font-mono text-xs border border-white/10 transition"
                            >
                                {isProcessing ? 'ANALYSE EN COURS...' : '1. SCANNER LES ZONES'}
                            </button>
                        )}
                        <button 
                            onClick={handleSendToChat}
                            disabled={elements.length === 0}
                            className="w-full bg-white text-black hover:bg-gray-200 py-3 rounded-lg font-bold text-xs transition disabled:opacity-50"
                        >
                            2. GÉNÉRER LE CODE
                        </button>
                    </div>
                 </div>
             </div>
        </div>
    </div>
  );
        }
