'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Sun, Moon, Copy, RefreshCcw, Layers, Palette, Wand2 } from 'lucide-react';

// --- TYPES ---
interface DetectedZone {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string; // Hex
  textColor?: string; // Calculated contrast color
}

// --- UTILS (Math & Colors) ---

// Convertir RGB en Hex
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Calculer la luminosité pour savoir si le texte doit être noir ou blanc
const getContrastColor = (hex: string) => {
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#FFFFFF';
};

// Distance entre deux couleurs (pour savoir si c'est la "même" zone)
const colorDistance = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
  return Math.sqrt(Math.pow(r2 - r1, 2) + Math.pow(g2 - g1, 2) + Math.pow(b2 - b1, 2));
};

export default function DesignExtractor() {
  // --- STATE ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [zones, setZones] = useState<DetectedZone[]>([]);
  const [uniqueColors, setUniqueColors] = useState<string[]>([]);
  const [showOutlines, setShowOutlines] = useState(true);
  
  // État pour le mode "Coloriage" (quels zones sont remplies)
  const [filledZones, setFilledZones] = useState<Record<number, boolean>>({});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- LOGIQUE DE TRAITEMENT D'IMAGE (ALGORITHME MAISON) ---
  const processImage = useCallback((img: HTMLImageElement) => {
    setIsProcessing(true);
    
    // Délai pour laisser l'UI afficher le loader
    setTimeout(() => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // Redimensionner pour la performance (max 600px de large pour mobile)
      const scale = Math.min(1, 600 / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;

      const detectedZones: DetectedZone[] = [];
      const visited = new Uint8Array(width * height); // 0 = non visité, 1 = visité
      const colorThreshold = 25; // Tolérance de différence de couleur
      const minArea = 400; // Ignorer les trop petits bruits

      // Fonction simplifiée de détection de boîtes (Approximation de Flood Fill)
      // On scanne par grille pour aller plus vite
      const step = 5; 

      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const pos = (y * width + x);
          if (visited[pos]) continue;

          const baseR = data[pos * 4];
          const baseG = data[pos * 4 + 1];
          const baseB = data[pos * 4 + 2];
          
          // Essayer d'étendre un rectangle à partir d'ici
          let maxX = x;
          let maxY = y;
          
          // Extension horizontale simple
          while (maxX < width && !visited[y * width + maxX]) {
             const r = data[(y * width + maxX) * 4];
             const g = data[(y * width + maxX) * 4 + 1];
             const b = data[(y * width + maxX) * 4 + 2];
             if (colorDistance(baseR, baseG, baseB, r, g, b) > colorThreshold) break;
             maxX++;
          }

          // Extension verticale simple (basée sur la largeur trouvée)
          let matches = true;
          while (maxY < height && matches) {
             for (let checkX = x; checkX < maxX; checkX += step) {
                const idx = (maxY * width + checkX) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                if (colorDistance(baseR, baseG, baseB, r, g, b) > colorThreshold) {
                    matches = false;
                    break;
                }
             }
             if (matches) maxY++;
          }

          const w = maxX - x;
          const h = maxY - y;

          // Marquer la zone comme visitée (approximativement)
          for (let vy = y; vy < maxY; vy+= step) {
            for (let vx = x; vx < maxX; vx+= step) {
                visited[vy * width + vx] = 1;
            }
          }

          // Si la zone est assez grande, on la garde
          if (w * h > minArea) {
             const hex = rgbToHex(baseR, baseG, baseB);
             detectedZones.push({
               id: detectedZones.length,
               x: x / scale, // Remettre à l'échelle originale
               y: y / scale,
               width: w / scale,
               height: h / scale,
               color: hex,
               textColor: getContrastColor(hex)
             });
          }
        }
      }

      // Filtrage des zones imbriquées ou trop similaires
      // (Optionnel, ici on garde brut pour l'effet "scan")
      
      setZones(detectedZones);
      
      // Extraire palette unique
      const colors = Array.from(new Set(detectedZones.map(z => z.color)));
      setUniqueColors(colors.slice(0, 12)); // Garder les top couleurs
      
      // Auto-remplir les zones au début pour l'effet "Wow"
      const initialFillState: Record<number, boolean> = {};
      detectedZones.forEach(z => initialFillState[z.id] = true);
      setFilledZones(initialFillState);

      setIsProcessing(false);
    }, 100);
  }, []);

  // --- HANDLERS ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          setImageSrc(event.target?.result as string);
          processImage(img);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert(`Copié : ${text}`); // Simple feedback mobile
  };

  const toggleZoneFill = (id: number) => {
    setFilledZones(prev => ({...prev, [id]: !prev[id]}));
  };

  const toggleAllZones = () => {
    const allFilled = Object.values(filledZones).every(Boolean);
    const newState: Record<number, boolean> = {};
    zones.forEach(z => newState[z.id] = !allFilled);
    setFilledZones(newState);
  };

  // --- RENDER ---

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 text-slate-100' : 'bg-gray-50 text-gray-900'}`}>
      
      {/* HEADER */}
      <header className={`sticky top-0 z-50 px-4 py-4 flex justify-between items-center border-b backdrop-blur-md ${isDarkMode ? 'border-slate-700/50 bg-slate-900/80' : 'border-gray-200 bg-white/80'}`}>
        <div className="flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-indigo-500" />
          <h1 className="text-lg font-bold tracking-tight">Design Extracter</h1>
        </div>
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)}
          className={`p-2 rounded-full transition-all ${isDarkMode ? 'bg-slate-800 text-yellow-400' : 'bg-gray-200 text-slate-700'}`}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-8 pb-20">

        {/* SECTION 1: UPLOAD */}
        {!imageSrc && (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${isDarkMode ? 'border-slate-700 hover:border-indigo-500 hover:bg-slate-800' : 'border-gray-300 hover:border-indigo-500 hover:bg-gray-50'}`}
          >
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
              <Upload size={32} />
            </div>
            <div>
              <p className="text-lg font-medium">Uploader une capture d'écran</p>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>Détection automatique des sections & couleurs</p>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />
          </div>
        )}

        {/* LOADING STATE */}
        {imageSrc && isProcessing && (
          <div className="py-20 text-center animate-pulse">
            <div className="inline-block w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-lg">Analyse pixel par pixel...</p>
            <p className="text-sm opacity-60">Recherche des cadres et couleurs</p>
          </div>
        )}

        {/* RESULTATS */}
        {imageSrc && !isProcessing && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* ACTION BAR */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <button 
                onClick={() => fileInputRef.current?.click()} 
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white border hover:bg-gray-50'}`}
              >
                <RefreshCcw size={16} /> Nouvelle image
              </button>
              <button 
                onClick={() => setShowOutlines(!showOutlines)} 
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${showOutlines ? 'bg-indigo-500 text-white' : (isDarkMode ? 'bg-slate-800' : 'bg-white border')}`}
              >
                <Layers size={16} /> {showOutlines ? 'Masquer traits' : 'Voir traits'}
              </button>
            </div>

            {/* ZONE 1: ANALYSE VISUELLE */}
            <div className={`rounded-2xl overflow-hidden border relative ${isDarkMode ? 'border-slate-700 bg-slate-950' : 'border-gray-200 bg-gray-100'}`}>
              <div className="p-3 border-b border-opacity-10 flex justify-between items-center bg-opacity-50 backdrop-blur-sm absolute w-full z-10 top-0 left-0">
                <span className="text-xs font-bold uppercase tracking-wider opacity-70 bg-black/30 px-2 py-1 rounded">Original + Détection</span>
                <span className="text-xs opacity-70">{zones.length} sections détectées</span>
              </div>
              
              <div className="relative">
                <img src={imageSrc} alt="Source" className="w-full h-auto block opacity-60" />
                
                {/* SVG OVERLAY - DESSIN DES TRAITS */}
                {showOutlines && (
                  <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                    {zones.map((zone) => (
                      <rect
                        key={zone.id}
                        x={`${(zone.x / (zones[0]?.width ? 600 : 1)) * 100}%`} // Approximation pour le ratio
                        y={zone.y} // Note: SVG overlay requires precise coordination matching img. In a real app, use ref dimensions.
                        width={zone.width}
                        height={zone.height}
                        // Utilisation de coordonnées absolues simplifiées ici pour la démo,
                        // Idéalement on map sur la viewBox du SVG correspondant à la taille de l'image.
                        style={{
                            transformBox: 'fill-box',
                            transformOrigin: 'center'
                        }}
                        className="stroke-red-500 fill-transparent stroke-1 vector-effect-non-scaling-stroke"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {/* Correction pour l'affichage : On utilise ViewBox pour matcher l'image */}
                    <foreignObject x="0" y="0" width="100%" height="100%">
                         {/* Ce div transparent sert juste à mapper les coordonnées si on voulait faire complexe, 
                             mais pour cette démo on va utiliser une méthode plus directe en bas */}
                    </foreignObject>
                  </svg>
                )}
                
                {/* RECTANGLES DE DÉTECTION ABSOLUS (Plus fiable que SVG simple pour le responsive) */}
                {showOutlines && zones.map((zone) => (
                   <div
                     key={zone.id}
                     className="absolute border border-red-500 shadow-[0_0_10px_rgba(255,0,0,0.3)] hover:bg-red-500/20 transition-colors cursor-crosshair"
                     style={{
                       left: zone.x,
                       top: zone.y,
                       width: zone.width,
                       height: zone.height,
                     }}
                     title={zone.color}
                   />
                ))}
              </div>
            </div>

            {/* ZONE 2: PALETTE EXTRAITE */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2 opacity-80">
                <Palette size={16} /> Couleurs Détectées
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {uniqueColors.map((color, idx) => (
                  <button
                    key={idx}
                    onClick={() => copyToClipboard(color)}
                    className={`group relative flex items-center gap-3 p-3 rounded-xl border transition-all hover:scale-105 active:scale-95 ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-white'}`}
                  >
                    <div 
                      className="w-10 h-10 rounded-lg shadow-inner ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: color }}
                    />
                    <div className="text-left flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold truncate">{color}</p>
                      <p className="text-xs opacity-50">Copier</p>
                    </div>
                    <Copy className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2" />
                  </button>
                ))}
              </div>
            </div>

            {/* ZONE 3: TEST "COLORIAGE" / WIREFRAME */}
            <div className={`p-1 rounded-2xl border ${isDarkMode ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-white'}`}>
              <div className="p-4 border-b border-dashed flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2 border-opacity-20 border-gray-500">
                <div>
                  <h3 className="font-bold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    Zone de Test "Coloriage"
                  </h3>
                  <p className="text-xs opacity-60 mt-1">Clique sur une zone pour activer/désactiver sa couleur.</p>
                </div>
                <button 
                  onClick={toggleAllZones}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-colors"
                >
                  Tout basculer
                </button>
              </div>

              {/* CANEVAS DE RECONSTRUCTION */}
              <div className="relative overflow-hidden rounded-xl bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-gray-100 dark:bg-slate-950">
                {/* On recrée la structure de l'image ici mais "propre" */}
                <div style={{ 
                    position: 'relative', 
                    width: '100%', 
                    height: '0', 
                    paddingBottom: `${(zones.length > 0 ? (Math.max(...zones.map(z => z.y + z.height)) / Math.max(...zones.map(z => z.x + z.width))) * 100 : 56.25)}%` 
                }}>
                    {zones.map((zone) => (
                      <div
                        key={zone.id}
                        onClick={() => toggleZoneFill(zone.id)}
                        className="absolute transition-all duration-300 cursor-pointer hover:brightness-110 active:scale-95 flex items-center justify-center group"
                        style={{
                          left: `${(zone.x / Math.max(...zones.map(z => z.x + z.width))) * 100}%`,
                          top: `${(zone.y / Math.max(...zones.map(z => z.y + z.height))) * 100}%`,
                          width: `${(zone.width / Math.max(...zones.map(z => z.x + z.width))) * 100}%`,
                          height: `${(zone.height / Math.max(...zones.map(z => z.y + z.height))) * 100}%`,
                          backgroundColor: filledZones[zone.id] ? zone.color : 'transparent',
                          border: filledZones[zone.id] ? 'none' : `1px solid ${isDarkMode ? '#475569' : '#cbd5e1'}`,
                          borderRadius: '4px', // On arrondit un peu pour faire "UI moderne"
                        }}
                      >
                         {!filledZones[zone.id] && (
                             <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                 <div className="w-2 h-2 rounded-full" style={{backgroundColor: zone.color}}></div>
                             </div>
                         )}
                         {/* Afficher le hex si assez grand */}
                         {filledZones[zone.id] && zone.width > 60 && zone.height > 20 && (
                            <span 
                                className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity select-none"
                                style={{ color: zone.textColor }}
                            >
                                {zone.color}
                            </span>
                         )}
                      </div>
                    ))}
                </div>
              </div>
              
              <div className="p-4 text-center">
                 <p className="text-xs opacity-50 italic">
                    Tapote les cases vides ci-dessus pour voir la couleur originale réapparaitre ("Splash").
                 </p>
              </div>

            </div>

          </div>
        )}
      </main>
    </div>
  );
}
