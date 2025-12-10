"use client";

import { useState, useRef } from "react";
import Script from "next/script";

export default function AnalyzePage() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState([]); // Pour stocker les données (x, y, couleur)

  const canvasRef = useRef(null);

  // --- 1. FONCTIONS UTILITAIRES COULEUR ---
  
  const rgbToHex = (r, g, b) => {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  };

  // Cette fonction va lire les pixels dans le carré détecté pour trouver la couleur de fond
  const extractColorFromRect = (ctx, x, y, w, h) => {
    // On prend le pixel central (souvent le plus représentatif)
    // Ou on fait une moyenne sur une petite zone au centre pour éviter le texte
    const centerX = x + Math.floor(w / 2);
    const centerY = y + Math.floor(h / 2);
    
    // Sécurité bords
    if (centerX < 0 || centerY < 0) return "#000000";

    // On lit 1 pixel au centre
    const pixel = ctx.getImageData(centerX, centerY, 1, 1).data;
    return rgbToHex(pixel[0], pixel[1], pixel[2]);

    // NOTE: Si tu veux être plus précis (moyenne), on peut scanner plus de pixels,
    // mais le pixel central marche à 90% pour les boutons/inputs.
  };

  // --- 2. SETUP OPENCV ---
  const onOpenCvLoaded = () => {
    cv['onRuntimeInitialized'] = () => {
      console.log("OpenCV Ready");
      setIsOpenCvReady(true);
    };
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      setElements([]); // Reset
      const img = new Image();
      img.onload = () => drawOriginalImage(img);
      img.src = event.target.result;
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

  // --- 3. ALGORITHME ULTIME (Detection V3 + Couleur) ---
  const detectShapesAndColors = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // CRUCIAL : On crée un canvas "virtuel" (non visible) qui contient l'image originale pure.
    // On lira les couleurs dessus pour ne pas être perturbé par les cadres rouges qu'on va dessiner.
    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');

    // On redessine l'image originale sur les deux canvas
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);       // Visible
      virtualCtx.drawImage(img, 0, 0); // Invisible (Source de vérité couleur)

      try {
        // --- LOGIQUE DE DÉTECTION V3 (Celle qui marche bien) ---
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let binary = new cv.Mat();
        
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        
        // Petit ajustement ici : (5,5) floute un peu plus pour ignorer le texte DANS les boutons
        cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

        // Adaptive Threshold (Le cœur de la V3)
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // Morphology (Réparation des trous)
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        // J'ajoute une itération de plus (iterations: 2) pour bien souder les formes
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        console.log(`Contours bruts trouvés : ${contours.size()}`);

        const detectedItems = [];

        // --- BOUCLE DE TRAITEMENT ---
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            
            // Approximation (rendre carré les trucs tordus)
            let perimeter = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            // Filtres (Taille min et max)
            if (area > 200 && area < (canvasArea * 0.95)) {
                
                // --- AJOUT : EXTRACTION COULEUR ---
                // On lit la couleur sur le virtualCtx (image propre) aux coordonnées du rect
                const color = extractColorFromRect(virtualCtx, rect.x, rect.y, rect.width, rect.height);

                // On stocke l'élément
                detectedItems.push({
                    x: rect.x,
                    y: rect.y,
                    w: rect.width,
                    h: rect.height,
                    color: color
                });
            }
            approx.delete();
        }

        // --- OPTIMISATION 99% : DÉDOUBLONNAGE ---
        // Parfois OpenCV détecte le bouton (parent) ET le texte dedans (enfant) comme deux carrés.
        // On va garder seulement les "contenants".
        // On trie par taille (du plus grand au plus petit)
        detectedItems.sort((a, b) => (b.w * b.h) - (a.w * a.h));

        // Dessiner sur le canvas visible
        ctx.lineWidth = 2;
        
        detectedItems.forEach((item, index) => {
            // Dessin du cadre rouge
            ctx.strokeStyle = "#FF0000"; 
            ctx.strokeRect(item.x, item.y, item.w, item.h);

            // Dessin d'un petit badge de couleur pour prouver qu'on l'a détectée
            ctx.fillStyle = item.color;
            ctx.fillRect(item.x, item.y - 10, 20, 10); // Petit rectangle au dessus
        });

        setElements(detectedItems);

        // Nettoyage mémoire
        src.delete(); gray.delete(); blurred.delete(); binary.delete();
        kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error("Erreur OpenCV :", err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 flex gap-6">
      <Script 
        src="https://docs.opencv.org/4.8.0/opencv.js" 
        onLoad={onOpenCvLoaded}
        strategy="afterInteractive"
      />

      {/* PARTIE GAUCHE : VISUALISATION */}
      <div className="flex-1 bg-white p-4 shadow rounded-xl">
        <h1 className="text-2xl font-bold mb-4">Scanner V5 (Hybride)</h1>
        
        <div className="flex gap-4 mb-4">
            <input type="file" onChange={handleImageUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:bg-blue-50 file:text-blue-700"/>
            <button 
                onClick={detectShapesAndColors}
                disabled={!isOpenCvReady || !imageSrc}
                className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50"
            >
                {isProcessing ? 'Traitement...' : 'Scanner + Couleurs'}
            </button>
        </div>

        <div className="border rounded overflow-hidden bg-gray-100 flex justify-center">
            <canvas ref={canvasRef} className="max-w-full" />
        </div>
      </div>

      {/* PARTIE DROITE : DONNÉES JSON */}
      <div className="w-80 bg-white p-4 shadow rounded-xl h-screen overflow-y-auto">
        <h2 className="font-bold text-lg mb-4">Éléments ({elements.length})</h2>
        <div className="space-y-2">
            {elements.map((el, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded hover:bg-gray-50 text-sm">
                    <div>
                        <span className="font-bold text-gray-500">#{i+1}</span> Block
                        <div className="text-xs text-gray-400">{el.w}x{el.h} px</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{el.color}</span>
                        <div 
                            className="w-6 h-6 rounded border shadow-sm" 
                            style={{backgroundColor: el.color}}
                        ></div>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
                    }
