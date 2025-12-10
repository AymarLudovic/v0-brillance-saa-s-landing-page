"use client";

import { useState, useRef } from "react";
import Script from "next/script";

export default function AnalyzePage() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef(null);

  // Initialisation d'OpenCV
  const onOpenCvLoaded = () => {
    // On attend que cv soit globalement disponible
    cv['onRuntimeInitialized'] = () => {
      console.log("OpenCV.js est prêt et initialisé !");
      setIsOpenCvReady(true);
    };
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
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

  // --- ALGORITHME RENFORCÉ V3 (Objectif 99%) ---
  const detectShapes = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Recharger l'image propre avant de dessiner par dessus
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);

      try {
        // --- 1. PRÉPARATION ---
        let src = cv.imread(canvas);
        let gray = new cv.Mat();
        let blurred = new cv.Mat();
        let binary = new cv.Mat();
        
        // Convertir en gris
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // Flou léger pour tuer le "bruit" (les pixels isolés qui ne sont pas des formes)
        // Tu peux essayer (3,3) ou (5,5)
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

        // --- 2. DÉTECTION AGRESSIVE (ADAPTIVE THRESHOLD) ---
        // C'est ici que ça change tout. Au lieu d'un seuil fixe, on s'adapte à la luminosité locale.
        // Paramètres : 255 (max), ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY_INV (inverser pour avoir contours blancs sur fond noir)
        // 11 : Taille du bloc de voisinage (doit être impair)
        // 2 : Constant soustraite (réglage de sensibilité fine)
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // --- 3. REPARATION DES FORMES (MORPHOLOGY) ---
        // On va "fermer" les trous. Si un rectangle a un bord discontinu, ça le recolle.
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        // Dilatation + Erosion = Closing. Ça bouche les trous.
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);


        // --- 4. TROUVER LES CONTOURS ---
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        // RETR_TREE : Récupère TOUTE la hiérarchie (parents, enfants, petits-enfants)
        // CHAIN_APPROX_SIMPLE : Économise la mémoire en gardant les points essentiels
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        console.log(`Nombre total d'éléments détectés : ${contours.size()}`);

        // --- 5. DESSIN ---
        ctx.lineWidth = 2;

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            
            // Approximation de polygone (rend les formes plus "carrées" et moins organiques)
            let perimeter = cv.arcLength(contour, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

            // Bounding Rect (le cadre)
            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;

            // --- FILTRAGE INTELLIGENT ---
            // 1. On ignore ce qui est trop petit (poussière) : < 100px²
            // 2. On ignore ce qui est trop grand (souvent le cadre entier de l'image) : > 98% de l'image
            let canvasArea = canvas.width * canvas.height;
            
            if (area > 100 && area < (canvasArea * 0.98)) {
                
                // Code couleur selon la hiérarchie pour le debug (Optionnel, ici tout rouge)
                // Si tu veux distinguer les "parents" des "enfants", tu peux utiliser 'hierarchy'
                
                ctx.strokeStyle = "#FF0000"; // ROUGE pour tout voir
                
                // On dessine le rectangle
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
                
                // Si tu veux dessiner les points exacts du contour au lieu du rectangle :
                // cv.drawContours(src, contours, i, new cv.Scalar(255, 0, 0, 255), 1);
            }
            
            approx.delete();
        }

        // --- 6. NETTOYAGE MÉMOIRE (CRUCIAL) ---
        src.delete();
        gray.delete();
        blurred.delete();
        binary.delete();
        kernel.delete();
        contours.delete();
        hierarchy.delete();

      } catch (err) {
        console.error("Erreur OpenCV :", err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans">
      <Script 
        src="https://docs.opencv.org/4.8.0/opencv.js" 
        onLoad={onOpenCvLoaded}
        strategy="afterInteractive"
      />

      <div className="max-w-5xl mx-auto bg-white shadow-xl rounded-xl p-6">
        <header className="mb-8 border-b pb-4">
          <h1 className="text-3xl font-extrabold text-gray-800">
            Détecteur UI "Wireframe" <span className="text-red-600 text-sm">(Mode Renforcé)</span>
          </h1>
          <p className="text-gray-500 mt-2">
            Utilise le seuillage adaptatif et la morphologie mathématique pour maximiser la détection.
          </p>
        </header>

        <div className="flex flex-col gap-6">
          {/* Zone de contrôle */}
          <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-lg border">
            {!isOpenCvReady ? (
              <span className="flex items-center gap-2 text-orange-600 font-semibold animate-pulse">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Chargement moteur IA...
              </span>
            ) : (
              <span className="text-green-600 font-bold flex items-center gap-2">
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Moteur Prêt
              </span>
            )}

            <input
              type="file"
              accept="image/*"
              disabled={!isOpenCvReady}
              onChange={handleImageUpload}
              className="block w-full text-sm text-slate-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100 cursor-pointer disabled:opacity-50"
            />

            <button
              onClick={detectShapes}
              disabled={!imageSrc || isProcessing || !isOpenCvReady}
              className={`whitespace-nowrap px-6 py-2 rounded-lg text-white font-bold transition-all shadow-md ${
                !imageSrc || isProcessing 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-red-600 hover:bg-red-700 active:scale-95'
              }`}
            >
              {isProcessing ? 'Analyse...' : 'DÉTECTION MAXIMALE'}
            </button>
          </div>

          {/* Zone d'affichage */}
          <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 min-h-[400px] flex items-center justify-center overflow-auto">
             {/* Le canvas est caché tant qu'il n'y a pas d'image, mais il doit exister dans le DOM */}
             <canvas 
                ref={canvasRef} 
                className={`max-w-full h-auto shadow-lg ${!imageSrc ? 'hidden' : 'block'}`}
             />
             
             {!imageSrc && (
               <div className="text-center text-gray-400">
                 <svg className="w-16 h-16 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 8.282 8.282 0 0111.314 0L20 21H4z" />
                 </svg>
                 <p>Uploadez une interface pour commencer</p>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
