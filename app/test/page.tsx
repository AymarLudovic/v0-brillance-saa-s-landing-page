"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

export default function AnalyzePage() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState([]); 

  const canvasRef = useRef(null);

  // --- FONCTION COULEUR (Invisible pour l'utilisateur) ---
  const rgbToHex = (r, g, b) => "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join("");

  const extractColor = (ctx, x, y, w, h) => {
    // On prend le point central pour la couleur
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    if (cx < 0 || cy < 0) return "#FFFFFF";
    const p = ctx.getImageData(cx, cy, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  };

  // --- INIT OPENCV ---
  const onOpenCvLoaded = () => {
    cv['onRuntimeInitialized'] = () => setIsOpenCvReady(true);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      setElements([]);
      setTimeout(() => {
          const img = new Image();
          img.onload = () => drawOriginalImage(img);
          img.src = event.target.result;
      }, 100);
    };
    reader.readAsDataURL(file);
  };

  const drawOriginalImage = (img) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };

  // --- MOTEUR DE DÉTECTION V6 (Mode Agressif) ---
  const runDetection = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // 1. Création du Canvas Virtuel (Source de vérité pour les couleurs)
    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      // On reset l'affichage
      ctx.drawImage(img, 0, 0);
      virtualCtx.drawImage(img, 0, 0);

      try {
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let binary = new cv.Mat();

        // --- ETAPE 1 : PRE-PROCESSING ---
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        
        // Flou très léger (3x3) pour garder les détails fins
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

        // --- ETAPE 2 : ADAPTIVE THRESHOLD (Le retour de la V3) ---
        // C'est la méthode la plus fiable pour l'UI
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // --- ETAPE 3 : DILATATION FINE ---
        // Noyau 2x2 (très petit) pour ne pas fusionner les boutons proches
        let kernel = cv.Mat.ones(2, 2, cv.CV_8U); 
        cv.dilate(binary, binary, kernel, new cv.Point(-1, -1), 1);

        // --- ETAPE 4 : CONTOURS ---
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        const detectedItems = [];
        
        // Style du tracé : Rouge fin et précis
        ctx.strokeStyle = "#FF0000"; 
        ctx.lineWidth = 1.5;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            
            // On simplifie très légèrement la forme
            let perimeter = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.01 * perimeter, true); // 0.01 = très fidèle à la forme originale

            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            // --- FILTRE TAILLE (Réglé bas pour attraper les petites icônes) ---
            // On prend tout ce qui est supérieur à 50px carrés (ex: 7x7 pixels)
            if (area > 50 && area < (canvasArea * 0.99)) {
                
                // Extraction couleur (depuis le canvas virtuel propre)
                const color = extractColor(virtualCtx, rect.x, rect.y, rect.width, rect.height);

                detectedItems.push({
                    id: i,
                    x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                    color: color
                });

                // Dessin : JUSTE LE CADRE ROUGE. Pas de remplissage.
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            }
            approx.delete();
        }

        // Tri visuel (Haut -> Bas)
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

  return (
    <div className="h-screen flex flex-col bg-neutral-900 text-white overflow-hidden font-sans">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />

      {/* HEADER */}
      <header className="h-16 border-b border-neutral-700 flex items-center justify-between px-6 bg-neutral-800">
        <h1 className="font-bold text-xl tracking-tight">UI Extractor <span className="text-red-500">V6</span></h1>
        <div className="flex gap-3">
             <input type="file" onChange={handleImageUpload} className="text-sm text-gray-400 file:bg-neutral-600 file:text-white file:border-0 file:px-3 file:py-1 file:rounded cursor-pointer"/>
             <button 
                onClick={runDetection}
                disabled={!isOpenCvReady || !imageSrc}
                className="bg-red-600 hover:bg-red-700 px-6 py-1.5 rounded font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
             >
                {isProcessing ? 'Analyse...' : 'Scanner'}
             </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* GAUCHE : VISUALISATION (Juste l'image et les cadres rouges) */}
        <div className="flex-1 bg-neutral-900 p-8 flex items-center justify-center overflow-auto relative">
            <div className="border border-neutral-700 shadow-2xl bg-black">
                <canvas ref={canvasRef} className="block max-w-full max-h-[80vh]" />
                {!imageSrc && <p className="text-neutral-600 p-10">En attente d'image...</p>}
            </div>
        </div>

        {/* DROITE : SIDEBAR DONNÉES (Couleurs et Détails ici) */}
        <div className="w-80 bg-neutral-800 border-l border-neutral-700 flex flex-col">
            <div className="p-4 border-b border-neutral-700 bg-neutral-800 z-10">
                <h2 className="font-bold flex justify-between items-center">
                    Éléments
                    <span className="bg-neutral-700 px-2 py-0.5 rounded text-xs text-neutral-300">{elements.length}</span>
                </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {elements.map((el, i) => (
                    <div key={el.id} className="group flex items-center gap-3 p-2 rounded hover:bg-neutral-700 border border-transparent hover:border-neutral-600 transition-all cursor-default">
                        {/* Numéro */}
                        <span className="text-xs font-mono text-neutral-500 w-6 text-right">#{i+1}</span>
                        
                        {/* Aperçu couleur */}
                        <div 
                            className="w-8 h-8 rounded border border-white/20 shadow-sm flex-shrink-0"
                            style={{backgroundColor: el.color}}
                            title={el.color}
                        ></div>

                        {/* Infos */}
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-neutral-300 truncate font-mono">{el.color}</p>
                            <p className="text-[10px] text-neutral-500">
                                x:{el.x} y:{el.y} <span className="text-neutral-400 mx-1">•</span> {el.w}x{el.h}
                            </p>
                        </div>
                    </div>
                ))}

                {elements.length === 0 && imageSrc && !isProcessing && (
                    <div className="text-center text-neutral-500 mt-10 text-sm">
                        Clique sur "Scanner" pour voir les données.
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
  }
