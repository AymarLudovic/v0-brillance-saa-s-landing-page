"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

// Types
export type DetectedElement = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

interface VisualAnalyzerProps {
  onAnalysisComplete: (elements: DetectedElement[], imageSrc: string) => void;
  onClose: () => void;
}

export default function VisualAnalyzer({ onAnalysisComplete, onClose }: VisualAnalyzerProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState<DetectedElement[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- OUTILS OPENCV & COULEURS (Même logique que V6) ---
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
      setImageSrc(event.target?.result as string);
      setElements([]);
      setTimeout(() => {
          const img = new Image();
          img.onload = () => drawOriginalImage(img);
          img.src = event.target?.result as string;
      }, 100);
    };
    reader.readAsDataURL(file);
  };

  const drawOriginalImage = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        // Fallback si context null
        return;
    } 
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

    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');
    if (!virtualCtx) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      virtualCtx.drawImage(img, 0, 0);

      try {
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
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
        // @ts-ignore
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // @ts-ignore
        let kernel = cv.Mat.ones(2, 2, cv.CV_8U); 
        // @ts-ignore
        cv.dilate(binary, binary, kernel, new cv.Point(-1, -1), 1);

        // @ts-ignore
        let contours = new cv.MatVector();
        // @ts-ignore
        let hierarchy = new cv.Mat();
        // @ts-ignore
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        const detectedItems: DetectedElement[] = [];
        ctx.strokeStyle = "#FF0000"; 
        ctx.lineWidth = 2;

        // @ts-ignore
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            // @ts-ignore
            let perimeter = cv.arcLength(contour, true);
            // @ts-ignore
            let approx = new cv.Mat();
            // @ts-ignore
            cv.approxPolyDP(contour, approx, 0.01 * perimeter, true);

            // @ts-ignore
            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            if (area > 50 && area < (canvasArea * 0.99)) {
                const color = extractColor(virtualCtx, rect.x, rect.y, rect.width, rect.height);
                detectedItems.push({
                    id: i,
                    x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                    color: color
                });
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            }
            approx.delete();
        }

        detectedItems.sort((a, b) => a.y - b.y);
        setElements(detectedItems);

        // Nettoyage
        src.delete(); gray.delete(); blurred.delete(); binary.delete();
        kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  const handleSendToChat = () => {
    if (elements.length > 0 && imageSrc) {
        onAnalysisComplete(elements, imageSrc);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />
      
      <div className="bg-neutral-900 w-full max-w-4xl h-[80vh] rounded-xl flex flex-col border border-neutral-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-neutral-700 bg-neutral-800">
            <h2 className="text-white font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                Scanner UI
            </h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-white">Fermer ✕</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
            {/* Zone Canvas */}
            <div className="flex-1 bg-black relative flex items-center justify-center overflow-auto p-4">
                <canvas ref={canvasRef} className="max-w-full shadow-lg border border-neutral-800" />
                {!imageSrc && (
                    <div className="text-center">
                         <input type="file" onChange={handleImageUpload} className="hidden" id="fileScan"/>
                         <label htmlFor="fileScan" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded cursor-pointer font-bold transition">
                            Choisir une image
                         </label>
                    </div>
                )}
            </div>

            {/* Sidebar Contrôles */}
            <div className="w-64 bg-neutral-800 border-l border-neutral-700 flex flex-col p-4">
                <div className="mb-4 space-y-2">
                    {imageSrc && (
                        <button 
                            onClick={runDetection} 
                            disabled={!isOpenCvReady}
                            className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded font-bold disabled:opacity-50"
                        >
                            {isProcessing ? 'Analyse...' : '1. Lancer Scan'}
                        </button>
                    )}
                    
                    <button 
                        onClick={handleSendToChat}
                        disabled={elements.length === 0}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-bold disabled:opacity-50"
                    >
                        2. Envoyer au Chat
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto border-t border-neutral-700 pt-4">
                    <p className="text-xs font-bold text-neutral-400 mb-2">ÉLÉMENTS ({elements.length})</p>
                    <div className="space-y-1">
                        {elements.map((el, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-neutral-300 bg-neutral-700/50 p-1 rounded">
                                <div className="w-3 h-3 rounded bg-current" style={{color: el.color}}></div>
                                <span>Box {el.w}x{el.h}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
    }
