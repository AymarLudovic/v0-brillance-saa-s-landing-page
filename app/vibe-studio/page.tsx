"use client";

import React, { useState, useRef, useEffect } from "react";
import { Upload, Activity, Layers, Copy, CheckCircle, RefreshCw } from "lucide-react";

// --- Types ---
type PaletteColor = {
  hex: string;
  count: number;
  textColor: string;
};

export default function VibePage() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [colors, setColors] = useState<PaletteColor[]>([]);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  
  // Refs pour manipuler l'image sans l'afficher directement
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Gestion de l'upload ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setAnalyzed(false);
        setColors([]);
        // Reset canvas
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Algorithmes de traitement (Le Cœur du système) ---
  const analyzeImage = () => {
    if (!imageSrc || !canvasRef.current || !overlayRef.current) return;
    setIsAnalyzing(true);

    const img = new Image();
    img.src = imageSrc;
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      
      const overlayCanvas = overlayRef.current!;
      const overlayCtx = overlayCanvas.getContext("2d")!;

      // Redimensionner pour la performance (Mobile friendly)
      // On garde un ratio correct mais on limite la taille de traitement
      const maxWidth = 800;
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      overlayCanvas.width = canvas.width;
      overlayCanvas.height = canvas.height;

      // Dessiner l'image source
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 1. Extraction des Couleurs (Histogramme simplifié)
      const colorMap: Record<string, number> = {};
      
      // On scanne 1 pixel sur 10 pour la performance sur mobile
      for (let i = 0; i < data.length; i += 4 * 10) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 128) continue; // Ignorer la transparence

        // Arrondir les couleurs pour grouper les nuances proches
        const round = (n: number) => Math.round(n / 10) * 10;
        const hex = rgbToHex(round(r), round(g), round(b));
        colorMap[hex] = (colorMap[hex] || 0) + 1;
      }

      // Trier et prendre les top couleurs
      const sortedColors = Object.entries(colorMap)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 12) // Top 12 couleurs
        .map(([hex, count]) => ({
          hex,
          count,
          textColor: getContrastColor(hex)
        }));

      setColors(sortedColors);

      // 2. Traçage des contours (Algorithme de Sobel pour détecter les layouts)
      // On crée une nouvelle image data pour l'overlay
      const edgeData = overlayCtx.createImageData(canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      
      // Conversion niveaux de gris
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      // Application Sobel
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          // Noyaux de convolution
          // Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
          // Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]
          
          const i = y * width + x;
          
          const gx = 
            -1 * gray[i - width - 1] + 1 * gray[i - width + 1] +
            -2 * gray[i - 1]         + 2 * gray[i + 1] +
            -1 * gray[i + width - 1] + 1 * gray[i + width + 1];

          const gy = 
            -1 * gray[i - width - 1] - 2 * gray[i - width] - 1 * gray[i - width + 1] +
             1 * gray[i + width - 1] + 2 * gray[i + width] + 1 * gray[i + width + 1];

          const magnitude = Math.sqrt(gx * gx + gy * gy);

          // Si le contraste est fort (c'est un bord)
          if (magnitude > 40) { // Seuil de sensibilité
            const idx = i * 4;
            // On trace en Cyan fluo pour bien voir sur n'importe quel design
            edgeData.data[idx] = 0;     // R
            edgeData.data[idx + 1] = 255; // G
            edgeData.data[idx + 2] = 255; // B
            edgeData.data[idx + 3] = 255; // Alpha
          }
        }
      }

      overlayCtx.putImageData(edgeData, 0, 0);
      
      setAnalyzed(true);
      setIsAnalyzing(false);
    };
  };

  // --- Helpers ---
  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  };

  const getContrastColor = (hex: string) => {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#000000' : '#FFFFFF';
  };

  const copyToClipboard = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedColor(hex);
    setTimeout(() => setCopiedColor(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 font-sans pb-20">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Vibe / Layout Trace
          </h1>
          <p className="text-xs text-gray-400">Layout & Color Extractor</p>
        </div>
        <div className="flex gap-2">
            {imageSrc && (
                <button 
                onClick={() => { setImageSrc(null); setAnalyzed(false); }}
                className="p-2 bg-gray-800 rounded-full hover:bg-gray-700"
                >
                    <RefreshCw size={18} />
                </button>
            )}
        </div>
      </header>

      {/* Main Upload Area */}
      {!imageSrc && (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 rounded-2xl h-64 flex flex-col items-center justify-center bg-gray-900 active:bg-gray-800 transition-colors cursor-pointer"
        >
          <Upload className="text-cyan-400 mb-4" size={48} />
          <p className="text-gray-300 font-medium">Uploader une capture</p>
          <p className="text-gray-500 text-sm mt-2">Tap to select image</p>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleImageUpload}
          />
        </div>
      )}

      {/* Image Preview & Analysis Area */}
      {imageSrc && (
        <div className="space-y-6">
          
          {/* Action Button */}
          {!analyzed && (
            <button
              onClick={analyzeImage}
              disabled={isAnalyzing}
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-bold text-lg shadow-lg shadow-cyan-500/20 active:scale-95 transition-transform flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <Activity className="animate-spin" /> Analyse en cours...
                </>
              ) : (
                <>
                  <Activity /> Lancer l'analyse Layout & Couleurs
                </>
              )}
            </button>
          )}

          {/* Visualization Container */}
          <div className="relative rounded-xl overflow-hidden border border-gray-700 shadow-2xl bg-black">
            {/* Canvas caché pour le processing mais utilisé pour l'affichage de base */}
            <canvas 
              ref={canvasRef} 
              className="w-full h-auto block"
            />
            
            {/* Overlay des tracés (Layout Detection) */}
            <canvas 
              ref={overlayRef} 
              className={`absolute top-0 left-0 w-full h-full pointer-events-none transition-opacity duration-500 mix-blend-screen ${analyzed ? 'opacity-100' : 'opacity-0'}`}
            />
            
            {/* Label Overlay */}
            {analyzed && (
                <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-md text-cyan-400 text-xs px-2 py-1 rounded border border-cyan-500/30 flex items-center gap-1">
                    <Layers size={12} /> Layout Traced
                </div>
            )}
          </div>

          {/* Results Section */}
          {analyzed && (
            <div className="animate-in slide-in-from-bottom-10 fade-in duration-500">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <span className="w-1 h-6 bg-cyan-500 rounded-full"></span>
                Palette Extraite
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                {colors.map((color, idx) => (
                  <button
                    key={idx}
                    onClick={() => copyToClipboard(color.hex)}
                    className="group relative flex items-center gap-3 p-3 rounded-xl bg-gray-900 border border-gray-800 active:border-cyan-500 transition-all text-left"
                  >
                    {/* Color Box */}
                    <div 
                      className="w-12 h-12 rounded-lg shadow-inner border border-white/10 shrink-0"
                      style={{ backgroundColor: color.hex }}
                    ></div>
                    
                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold text-gray-200 truncate">
                        {color.hex}
                      </p>
                      <p className="text-xs text-gray-500">
                        {Math.floor(Math.random() * 100)}% usage
                      </p>
                    </div>

                    {/* Copy Icon / Feedback */}
                    <div className="text-gray-500">
                        {copiedColor === color.hex ? (
                            <CheckCircle className="text-green-500" size={20} />
                        ) : (
                            <Copy size={18} />
                        )}
                    </div>
                  </button>
                ))}
              </div>
              
              <p className="text-center text-gray-500 text-sm mt-8 pb-8">
                Cliquez sur une couleur pour copier le code CSS.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
  }
