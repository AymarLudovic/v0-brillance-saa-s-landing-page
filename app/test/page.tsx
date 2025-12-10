"use client";

import { useState, useRef } from "react";
import Script from "next/script";

export default function AnalyzePage() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedElements, setDetectedElements] = useState([]);
  const [globalPalette, setGlobalPalette] = useState([]);
  
  const canvasRef = useRef(null);

  // --- 1. OUTILS D'ANALYSE DE COULEUR (Pure JS) ---

  // Convertit RGB en Hex
  const rgbToHex = (r, g, b) => {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  };

  // Trouve la couleur dominante dans une zone donnée (x, y, w, h)
  // Utilise une quantification simple pour éviter les milliers de nuances
  const getDominantColor = (ctx, x, y, w, h) => {
    // On récupère les pixels de la zone
    const imageData = ctx.getImageData(x, y, w, h).data;
    const colorCounts = {};
    let maxCount = 0;
    let dominantColor = { r:0, g:0, b:0 };

    // On parcourt les pixels (on saute de 4 en 4 pour aller plus vite : step)
    const step = 4 * 4; // Check 1 pixel sur 4 pour performance
    
    for (let i = 0; i < imageData.length; i += step) {
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const a = imageData[i + 3];

      // Ignorer la transparence et le blanc pur/noir pur (souvent du fond ou texte)
      if (a < 128) continue; 
      // Optionnel : ignorer le blanc strict si tu veux la couleur des boutons
      // if (r > 250 && g > 250 && b > 250) continue; 

      // On arrondit les couleurs pour les regrouper (Bucket)
      // ex: 255 devient 250. Ça permet de grouper les nuances proches.
      const roundedR = Math.floor(r / 10) * 10;
      const roundedG = Math.floor(g / 10) * 10;
      const roundedB = Math.floor(b / 10) * 10;

      const key = `${roundedR},${roundedG},${roundedB}`;
      
      if (!colorCounts[key]) colorCounts[key] = 0;
      colorCounts[key]++;

      if (colorCounts[key] > maxCount) {
        maxCount = colorCounts[key];
        dominantColor = { r: roundedR, g: roundedG, b: roundedB };
      }
    }

    return rgbToHex(dominantColor.r, dominantColor.g, dominantColor.b);
  };

  // --- 2. SETUP OPENCV ---
  const onOpenCvLoaded = () => {
    cv['onRuntimeInitialized'] = () => {
      setIsOpenCvReady(true);
    };
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      setDetectedElements([]); // Reset
      setGlobalPalette([]);
      
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        // Extraction palette globale (toute l'image)
        const mainColor = getDominantColor(ctx, 0, 0, img.width, img.height);
        // Pour une vraie palette multi-couleurs, on pourrait appeler getDominantColor sur 4 quadrants
        setGlobalPalette([mainColor]); 
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };


  // --- 3. LE MOTEUR DE DÉTECTION (Structure + Couleur) ---
  const analyzeImage = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setDetectedElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d"); // Pour dessiner
    // On crée un 2ème contexte "virtuel" pour lire les couleurs originales sans les traits rouges
    const rawCtx = canvas.cloneNode().getContext("2d");
    const img = new Image();
    img.src = imageSrc;
    
    img.onload = () => {
      // Dessiner sur le canvas visible
      ctx.drawImage(img, 0, 0);
      // Dessiner sur le canvas virtuel (pour lire les couleurs pures)
      rawCtx.canvas.width = img.width;
      rawCtx.canvas.height = img.height;
      rawCtx.drawImage(img, 0, 0);

      try {
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let binary = new cv.Mat();

        // Pipeline OpenCV (Le même qui marche à 98%)
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        
        // Adaptive Threshold
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Dilatation pour fermer les formes
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        const newElements = [];

        // Style du tracé
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#00FF00"; // Vert Matrix
        ctx.font = "12px Arial";
        ctx.fillStyle = "red";

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            let canvasArea = canvas.width * canvas.height;

            // Filtres de taille (ni trop petit, ni immense)
            if (area > 200 && area < (canvasArea * 0.90)) {
                
                // Redresser la forme
                let peri = cv.arcLength(contour, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(contour, approx, 0.04 * peri, true); // 0.04 est plus strict sur les carrés

                if (approx.rows === 4) { // Si c'est approximativement un carré/rectangle
                    let rect = cv.boundingRect(approx);
                    
                    // --- EXTRACTION DE LA COULEUR ---
                    // On utilise rawCtx (l'image pure sans traits) pour piocher la couleur
                    const hexColor = getDominantColor(rawCtx, rect.x, rect.y, rect.width, rect.height);
                    
                    // On sauvegarde l'élément
                    newElements.push({
                        id: i,
                        type: "Container/Button",
                        x: rect.x,
                        y: rect.y,
                        w: rect.width,
                        h: rect.height,
                        color: hexColor
                    });

                    // On dessine le cadre
                    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
                    
                    // On dessine un petit point de la couleur détectée
                    ctx.fillStyle = hexColor;
                    ctx.fillRect(rect.x, rect.y, 10, 10);
                }
                approx.delete();
            }
        }
        
        // Trier les éléments du haut vers le bas (pour l'ordre logique)
        newElements.sort((a, b) => a.y - b.y);
        setDetectedElements(newElements);

        // Nettoyage
        src.delete(); gray.delete(); blurred.delete(); binary.delete(); kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  return (
    <div className="min-h-screen bg-neutral-900 text-white p-6 font-sans">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} strategy="afterInteractive"/>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
        
        {/* COLONNE GAUCHE : IMAGE & CONTROLES */}
        <div className="lg:col-span-2 space-y-4">
            <header className="flex justify-between items-center bg-neutral-800 p-4 rounded-lg border border-neutral-700">
                <h1 className="text-xl font-bold">Inspecteur UI</h1>
                <div className="flex gap-3">
                    <input 
                        type="file" 
                        onChange={handleImageUpload} 
                        className="text-sm file:bg-neutral-700 file:text-white file:border-0 file:rounded-md file:px-3 file:py-1"
                    />
                    <button 
                        onClick={analyzeImage}
                        disabled={!isOpenCvReady || !imageSrc}
                        className="bg-blue-600 hover:bg-blue-500 px-4 py-1 rounded-md font-bold disabled:opacity-50"
                    >
                        {isProcessing ? 'Analyse...' : 'Scanner'}
                    </button>
                </div>
            </header>

            <div className="bg-neutral-800 rounded-lg p-2 border border-neutral-700 overflow-auto flex justify-center">
                <canvas ref={canvasRef} className="max-w-full h-auto" />
                {!imageSrc && <div className="h-96 flex items-center text-neutral-500">En attente d'image...</div>}
            </div>
        </div>

        {/* COLONNE DROITE : DONNÉES EXTRAITES */}
        <div className="bg-neutral-800 p-4 rounded-lg border border-neutral-700 h-fit max-h-screen overflow-y-auto">
            <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                Données Extraites
                <span className="bg-blue-900 text-blue-200 text-xs px-2 py-0.5 rounded-full">
                    {detectedElements.length} items
                </span>
            </h2>

            {/* Palette Globale */}
            {globalPalette.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-xs text-neutral-400 uppercase font-bold mb-2">Couleur Dominante Image</h3>
                    <div className="flex gap-2">
                        {globalPalette.map((c, i) => (
                            <div key={i} className="flex items-center gap-2 bg-neutral-700 p-2 rounded">
                                <div className="w-6 h-6 rounded-full border border-white/20" style={{backgroundColor: c}}></div>
                                <span className="font-mono text-sm">{c}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Liste des éléments */}
            <div className="space-y-2">
                {detectedElements.length === 0 && <p className="text-neutral-500 text-sm">Aucun élément détecté.</p>}
                
                {detectedElements.map((el, index) => (
                    <div key={index} className="flex items-center justify-between bg-neutral-700/50 p-3 rounded hover:bg-neutral-700 transition">
                        <div className="flex items-center gap-3">
                            <div className="bg-neutral-600 w-6 h-6 flex items-center justify-center rounded text-xs font-mono">
                                {index + 1}
                            </div>
                            <div>
                                <p className="text-sm font-medium">Box / Bouton</p>
                                <p className="text-xs text-neutral-400">
                                    L: {el.w}px &times; H: {el.h}px
                                </p>
                            </div>
                        </div>
                        
                        {/* Indicateur de couleur détectée */}
                        <div className="text-right">
                             <div 
                                className="w-8 h-8 rounded border border-white/10 shadow-sm mx-auto mb-1" 
                                style={{backgroundColor: el.color}}
                                title={`Couleur détectée : ${el.color}`}
                             ></div>
                             <span className="text-[10px] font-mono text-neutral-400">{el.color}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </div>
  );
      }
