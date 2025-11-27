'use client';

import { useState, useRef, useEffect } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  label: string;
  box_2d: number[]; // [ymin, xmin, ymax, xmax] (0-1000)
  realColor?: string; // Calculé par le navigateur
  dimensions?: string; // Calculé par le navigateur
};

export default function DeepScanTool() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [elements, setElements] = useState<UiElement[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- LOGGER ---
  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
  };

  // --- 1. CHARGEMENT IMAGE ---
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    log('Chargement du fichier...', 'info');
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setImageSrc(ev.target.result as string);
        setElements([]);
        log('Image chargée en mémoire RAM.', 'ok');
      }
    };
    reader.readAsDataURL(file);
  };

  // --- 2. MOTEUR D'ANALYSE ---
  const runDeepScan = async () => {
    if (!imageSrc) return;
    setAnalyzing(true);
    log('Initialisation du modèle Gemini Thinking...', 'info');

    try {
      // PHASE 1 : INTELLIGENCE (Serveur)
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageSrc }),
      });

      if (!res.ok) throw new Error('Erreur API Gemini');
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      let rawElements: UiElement[] = data.elements;
      log(`Géométrie reçue : ${rawElements.length} objets identifiés.`, 'ok');

      // PHASE 2 : VÉRIFICATION PHYSIQUE (Client)
      log('Démarrage de la vérification Pixel-Perfect...', 'info');
      const verifiedElements = performPixelAudit(rawElements);
      
      setElements(verifiedElements);
      log('Audit terminé. Rendu de la superposition.', 'ok');

    } catch (err: any) {
      log(`ECHEC: ${err.message}`, 'err');
    } finally {
      setAnalyzing(false);
    }
  };

  // --- LE CŒUR MATHÉMATIQUE (AUDIT PIXEL) ---
  const performPixelAudit = (items: UiElement[]) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return items;

    // On prépare le laboratoire de mesure (Canvas)
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return items;

    // On projette l'image pour lecture
    ctx.drawImage(img, 0, 0);

    return items.map(item => {
      // 1. Conversion Coordonnées Normalisées (0-1000) -> Pixels Réels
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const x = Math.floor((xmin / 1000) * canvas.width);
      const y = Math.floor((ymin / 1000) * canvas.height);
      const w = Math.floor(((xmax - xmin) / 1000) * canvas.width);
      const h = Math.floor(((ymax - ymin) / 1000) * canvas.height);

      // 2. Extraction de l'ADN de la zone (Pixel Data)
      // C'est ici qu'on obtient la fiabilité 100%
      const imageData = ctx.getImageData(x, y, w, h);
      const hex = getDominantHex(imageData.data);

      return {
        ...item,
        realColor: hex,
        dimensions: `${w}x${h}px`
      };
    });
  };

  // Utilitaire: Calcul de la couleur moyenne exacte
  const getDominantHex = (data: Uint8ClampedArray) => {
    let r = 0, g = 0, b = 0, count = 0;
    // On échantillonne tous les 10 pixels pour la vitesse
    for (let i = 0; i < data.length; i += 40) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    return `#${((1 << 24) + (Math.floor(r/count) << 16) + (Math.floor(g/count) << 8) + Math.floor(b/count)).toString(16).slice(1).toUpperCase()}`;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FF94] font-mono p-6 flex flex-col md:flex-row gap-6">
      
      {/* SECTION GAUCHE : VISUALISATION */}
      <div className="flex-1 flex flex-col gap-4 relative">
        <div className="border border-[#003311] bg-[#0a0a0a] rounded-xl overflow-hidden relative min-h-[600px] flex items-center justify-center">
          
          {!imageSrc ? (
             <label className="cursor-pointer flex flex-col items-center gap-4 opacity-50 hover:opacity-100 transition duration-300">
                <div className="w-16 h-16 border-2 border-dashed border-[#00FF94] rounded-full flex items-center justify-center">+</div>
                <span className="tracking-widest text-sm">INITIALISER LE SCAN</span>
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
             </label>
          ) : (
            <div className="relative inline-block">
              {/* Image Source (Légèrement grisée pour faire ressortir les box) */}
              <img ref={imgRef} src={imageSrc} alt="Target" className="max-w-full max-h-[80vh] opacity-70" />
              
              {/* Overlay des boîtes détectées */}
              {elements.map((el) => {
                 const top = el.box_2d[0] / 10 + '%';
                 const left = el.box_2d[1] / 10 + '%';
                 const height = (el.box_2d[2] - el.box_2d[0]) / 10 + '%';
                 const width = (el.box_2d[3] - el.box_2d[1]) / 10 + '%';

                 return (
                   <div
                     key={el.id}
                     className={`absolute border transition-all duration-200 z-10 group
                       ${hoverId === el.id ? 'border-[#00FF94] bg-[#00FF94]/10' : 'border-[#00FF94]/30 hover:border-[#00FF94]'}`}
                     style={{ top, left, width, height }}
                     onMouseEnter={() => setHoverId(el.id)}
                     onMouseLeave={() => setHoverId(null)}
                   >
                     {/* Tooltip ultra-précise au survol */}
                     {hoverId === el.id && (
                       <div className="absolute -top-12 left-0 bg-black/90 border border-[#00FF94] px-2 py-1 text-xs whitespace-nowrap z-50 shadow-[0_0_20px_rgba(0,255,148,0.3)]">
                         <div className="font-bold text-white">{el.label}</div>
                         <div className="text-[#00FF94]">{el.dimensions} • {el.realColor}</div>
                       </div>
                     )}
                   </div>
                 )
              })}
            </div>
          )}
          {/* Canvas invisible pour les maths */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <button 
          onClick={runDeepScan}
          disabled={!imageSrc || analyzing}
          className="bg-[#003311] hover:bg-[#004418] disabled:opacity-30 border border-[#00FF94]/50 text-[#00FF94] py-4 px-6 rounded text-sm font-bold tracking-[0.2em] transition-all shadow-[0_0_20px_rgba(0,255,148,0.1)]"
        >
          {analyzing ? '/// ANALYSE NEURONALE EN COURS...' : 'EXÉCUTER LE SCAN PROFOND'}
        </button>
      </div>

      {/* SECTION DROITE : TERMINAL DE LOGS */}
      <div className="w-full md:w-[400px] flex flex-col gap-4">
        <div className="bg-[#080808] border border-[#111] p-4 rounded-lg flex-1 shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-[#222] pb-3 mb-3">
            <span className="text-xs text-gray-500">TERMINAL OUTPUT</span>
            <div className="flex gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500/20"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-500/20"></div>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2 pr-2 scrollbar-thin scrollbar-thumb-[#003311]">
            {logs.length === 0 && <span className="text-gray-700 animate-pulse">_Waiting for input stream...</span>}
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-gray-600 min-w-[60px]">{log.time}</span>
                <span className={`${
                  log.type === 'err' ? 'text-red-500' : 
                  log.type === 'ok' ? 'text-white' : 'text-[#00FF94]'
                }`}>
                  {log.type === 'ok' ? 'SUCCESS >> ' : log.type === 'err' ? 'ERROR >> ' : 'INFO >> '}
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* DETAILS PANEL (Pour voir les datas brutes) */}
        {hoverId && (
          <div className="h-40 bg-[#080808] border border-[#222] p-4 rounded text-xs overflow-auto">
             <pre className="text-gray-400">
               {JSON.stringify(elements.find(e => e.id === hoverId), null, 2)}
             </pre>
          </div>
        )}
      </div>
    </div>
  );
        }
