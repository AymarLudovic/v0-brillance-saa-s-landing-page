"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

export default function AnalyzePage() {
  const [imageSrc, setImageSrc] = useState(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // Fonction appelée quand OpenCV.js est fini de charger depuis le CDN
  const onOpenCvLoaded = () => {
    console.log("OpenCV.js est prêt !");
    // On attend un petit peu que la variable globale 'cv' soit bien initialisée
    setTimeout(() => {
        setIsOpenCvReady(true);
    }, 500);
  };

  // Gérer l'upload de l'image
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      // Une fois l'image chargée, on la dessine dans le canvas
      const img = new Image();
      img.onload = () => {
        drawOriginalImage(img);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Dessiner l'image originale sur le canvas
  const drawOriginalImage = (img) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    // On adapte la taille du canvas à l'image
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };


  // --- LE CŒUR DU REACTEUR : LA DÉTECTION VIA OPENCV ---
  const detectShapes = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    // On redessine l'image originale pour effacer les anciens tracés si on clique plusieurs fois
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
        ctx.drawImage(img, 0, 0);

        try {
            // 1. Lire l'image du canvas dans une matrice OpenCV
            let src = cv.imread(canvas);
            let gray = new cv.Mat();
            let blurred = new cv.Mat();
            let edges = new cv.Mat();
        
            // 2. Convertir en niveaux de gris (la couleur gêne la détection de forme)
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        
            // 3. Flouter légèrement pour réduire le "bruit" (les petits détails inutiles)
            // Tu peux jouer sur le (5, 5) pour flouter plus ou moins
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
        
            // 4. Détection des bords (Canny Edge Detection)
            // Les valeurs 50 et 150 sont des seuils. Joue avec si ça détecte trop ou pas assez.
            cv.Canny(blurred, edges, 50, 150);
        
            // 5. Trouver les contours basés sur les bords
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            // RETR_EXTERNAL permet de ne prendre que les contours extérieurs principaux
            // Si tu veux aussi les éléments DANS les éléments, utilise cv.RETR_TREE
            cv.findContours(edges, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
        
            console.log(`Nombre de formes détectées : ${contours.size()}`);
        
            // Configurer le style du tracé (vert fluo, épais)
            ctx.strokeStyle = "#00FF00"; // Vert lime
            ctx.lineWidth = 2;
        
            // 6. Boucler sur tous les contours trouvés
            for (let i = 0; i < contours.size(); ++i) {
                let contour = contours.get(i);
                
                // Optionnel : Filtrer les trop petits éléments (bruit)
                let area = cv.contourArea(contour);
                if (area < 100) continue; // Ignore les formes de moins de 100px²

                // Obtenir le rectangle englobant (bounding box) du contour
                let rect = cv.boundingRect(contour);
                
                // Dessiner le rectangle sur le canvas JS normal
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

                // Si tu veux aussi détecter les cercles spécifiquement, c'est un autre algo (HoughCircles)
                // mais boundingRect fait déjà un bon travail pour encadrer tout ce qu'il voit.
            }
        
            // 7. Nettoyage de la mémoire (TRÈS IMPORTANT avec OpenCV.js)
            src.delete(); gray.delete(); blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
        
        } catch (err) {
            console.error("Erreur OpenCV :", err);
            alert("Erreur lors de la détection. Vérifie la console.");
        } finally {
            setIsProcessing(false);
        }
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
        {/* Chargement du script OpenCV depuis un CDN gratuit */}
      <Script 
        src="https://docs.opencv.org/4.8.0/opencv.js" 
        onLoad={onOpenCvLoaded}
        strategy="afterInteractive"
      />

      <h1 className="text-3xl font-bold mb-6">Détecteur de structure (Style Wireframe)</h1>

      {!isOpenCvReady && (
        <div className="bg-yellow-100 text-yellow-800 p-4 rounded mb-4">
          Chargement du moteur de détection (OpenCV)... Patientez.
        </div>
      )}

      {isOpenCvReady && (
        <div className="mb-6 space-y-4">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            ref={fileInputRef}
            className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-violet-50 file:text-violet-700
              hover:file:bg-violet-100"
          />
          
          <button
            onClick={detectShapes}
            disabled={!imageSrc || isProcessing}
            className={`px-6 py-2 rounded text-white font-bold transition-colors ${
              !imageSrc || isProcessing ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isProcessing ? 'Analyse en cours...' : 'Tout Détecter & Tracer'}
          </button>
        </div>
      )}

      <div className="border-2 border-gray-300 rounded p-2 bg-gray-50 inline-block">
        {/* Le canvas où tout se passe */}
        <canvas ref={canvasRef} className="max-w-full h-auto" />
        {!imageSrc && <p className="text-gray-500 text-center p-4">L'image apparaîtra ici</p>}
      </div>
      
      {imageSrc && (
         <p className="mt-4 text-sm text-gray-600">
            Si le résultat est trop chargé, il faut ajuster les seuils `cv.Canny(blurred, edges, 50, 150);` dans le code.
         </p>
      )}
    </div>
  );
  }
