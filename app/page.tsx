'use client';

import { useState, useRef } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  label: string;
  box_2d: number[];
  realColor?: string;
  dimensions?: string;
};

export default function DeepScanDebug() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [elements, setElements] = useState<UiElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- LOGGING SYSTÈME AVANCÉ ---
  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
  };

  // Fonction pour copier le log dans le presse-papier du téléphone
  const copyLog = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Erreur copiée !');
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    log('Chargement image...', 'info');
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setImageSrc(ev.target.result as string);
        setElements([]);
        setSelectedId(null);
        log('Image chargée. Prêt.', 'ok');
      }
    };
    reader.readAsDataURL(file);
  };

  const runDeepScan = async () => {
    if (!imageSrc) return;
    setAnalyzing(true);
    setSelectedId(null);
    log('Envoi à Gemini (Wait 20-30s)...', 'info');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageSrc }),
      });

      // ON RÉCUPÈRE D'ABORD LE TEXTE BRUT POUR LE DEBUG
      const rawText = await res.text();

      if (!res.ok) {
        // Si c'est une erreur HTML (ex: 504 Timeout Vercel)
        if (rawText.includes('<!DOCTYPE html>')) {
           throw new Error(`Vercel Error (${res.status}): Probable Timeout. L'image est peut-être trop lourde ou Gemini trop lent.`);
        }
        // Sinon on essaie de lire le JSON d'erreur
        try {
          const jsonErr = JSON.parse(rawText);
          throw new Error(jsonErr.error || jsonErr.message || JSON.stringify(jsonErr));
        } catch {
          throw new Error(`Erreur HTTP ${res.status}: ${rawText.slice(0, 100)}...`);
        }
      }

      // Si tout va bien, on parse
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        throw new Error(`Réponse invalide (Pas de JSON): ${rawText.slice(0, 50)}...`);
      }
      
      if (data.error) throw new Error(data.error);

      let rawElements: UiElement[] = data.elements;
      log(`${rawElements.length} éléments reçus.`, 'ok');
      log('Vérification Pixel-Perfect...', 'info');
      
      const verifiedElements = performPixelAudit(rawElements);
      setElements(verifiedElements);
      log('Terminé ! Touchez les zones.', 'ok');

    } catch (err: any) {
      console.error(err);
      // On affiche l'erreur complète
      log(err.message || JSON.stringify(err), 'err');
    } finally {
      setAnalyzing(false);
    }
  };

  const performPixelAudit = (items: UiElement[]) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return items;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return items;

    ctx.drawImage(img, 0, 0);

    return items.map(item => {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const x = Math.floor((xmin / 1000) * canvas.width);
      const y = Math.floor((ymin / 1000) * canvas.height);
      const w = Math.floor(((xmax - xmin) / 1000) * canvas.width);
      const h = Math.floor(((ymax - ymin) / 1000) * canvas.height);

      const imageData = ctx.getImageData(x, y, w, h);
      const hex = getDominantHex(imageData.data);

      return {
        ...item,
        realColor: hex,
        dimensions: `${w}x${h}px`
      };
    });
  };

  const getDominantHex = (data: Uint8ClampedArray) => {
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 40) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    return `#${((1 << 24) + (Math.floor(r/count) << 16) + (Math.floor(g/count) << 8) + Math.floor(b/count)).toString(16).slice(1).toUpperCase()}`;
  };

  const activeElement = elements.find(e => e.id === selectedId);

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FF94] font-mono p-4 flex flex-col gap-4">
      
      {/* HEADER */}
      <div className="flex justify-between items-center border-b border-[#003311] pb-2">
        <h1 className="text-sm font-bold tracking-widest">DEBUG SCANNER</h1>
        <div className="text-[10px] bg-red-900/50 text-red-200 px-2 py-1 rounded">DEV MODE</div>
      </div>

      {/* VIEWER */}
      <div className="relative w-full aspect-square bg-[#0a0a0a] border border-[#003311] rounded overflow-hidden flex items-center justify-center">
        {!imageSrc ? (
           <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer active:bg-[#00220a]">
              <span className="text-4xl mb-2">+</span>
              <span className="text-xs">UPLOAD IMAGE</span>
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
           </label>
        ) : (
          <div className="relative w-full h-full">
            <img ref={imgRef} src={imageSrc} alt="Target" className="w-full h-full object-contain opacity-60" />
            {elements.map((el) => {
               const top = el.box_2d[0] / 10 + '%';
               const left = el.box_2d[1] / 10 + '%';
               const height = (el.box_2d[2] - el.box_2d[0]) / 10 + '%';
               const width = (el.box_2d[3] - el.box_2d[1]) / 10 + '%';
               const isSelected = selectedId === el.id;
               return (
                 <div
                   key={el.id}
                   onClick={() => setSelectedId(isSelected ? null : el.id)}
                   className={`absolute border-2 transition-all z-20 ${isSelected ? 'border-[#00FF94] bg-[#00FF94]/20' : 'border-[#00FF94]/40'}`}
                   style={{ top, left, width, height }}
                 />
               )
            })}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* ACTION */}
      <button 
        onClick={runDeepScan}
        disabled={!imageSrc || analyzing}
        className="w-full bg-[#003311] active:bg-[#00FF94] active:text-black disabled:opacity-30 border border-[#00FF94]/50 text-[#00FF94] py-4 rounded font-bold text-sm"
      >
        {analyzing ? 'ANALYSE EN COURS...' : 'LANCER SCAN'}
      </button>

      {/* INFO PANEL */}
      <div className="bg-[#080808] border border-[#111] p-3 rounded shadow-2xl min-h-[100px]">
        {activeElement ? (
          <div className="text-xs space-y-2">
            <div className="flex justify-between font-bold text-white text-sm">
                <span>{activeElement.label}</span>
                <span className="text-gray-500">{activeElement.type}</span>
            </div>
            <div className="flex gap-4">
                <div>HEX: <span className="text-white select-all">{activeElement.realColor}</span></div>
                <div>DIM: <span className="text-white select-all">{activeElement.dimensions}</span></div>
            </div>
            <div className="w-full h-4 mt-1 border border-white" style={{background: activeElement.realColor}}></div>
          </div>
        ) : (
          <div className="text-center text-gray-600 text-xs py-4">Sélectionnez une zone verte pour les détails</div>
        )}
      </div>

      {/* DEBUG LOGS (AVEC BOUTON COPY) */}
      <div className="flex-1 bg-black border border-gray-800 rounded p-2 overflow-y-auto min-h-[150px] text-[10px] font-mono">
        <h3 className="text-gray-500 mb-2 border-b border-gray-900 pb-1">ERROR LOGS</h3>
        {logs.length === 0 && <span className="text-gray-800">Aucun log...</span>}
        
        {logs.map((log, i) => (
          <div key={i} className="mb-2 border-b border-gray-900 pb-2 last:border-0">
            <div className="flex justify-between items-start mb-1">
                <span className="text-gray-600">[{log.time}]</span>
                {/* BOUTON COPY SPECIFIQUE À L'ERREUR */}
                <button 
                    onClick={() => copyLog(log.msg)}
                    className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[8px] uppercase hover:bg-white hover:text-black"
                >
                    Copy
                </button>
            </div>
            
            {/* TEXTE SÉLECTIONNABLE AVEC CSS 'select-text' */}
            <p className={`break-words select-text ${
              log.type === 'err' ? 'text-red-500 font-bold' : 
              log.type === 'ok' ? 'text-white' : 'text-[#00FF94]'
            }`}>
              {log.type === 'err' ? 'ERROR: ' : '> '}
              {log.msg}
            </p>
          </div>
        ))}
      </div>

    </div>
  );
}
