'use client';

import { useState, useRef } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  label: string;
  box_2d: number[]; // [ymin, xmin, ymax, xmax]
  realColor?: string;
  dimensions?: string;
};

export default function DeepScanMobile() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [elements, setElements] = useState<UiElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null); // On utilise "Selected" au lieu de Hover

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
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
        log('Prêt pour analyse.', 'ok');
      }
    };
    reader.readAsDataURL(file);
  };

  const runDeepScan = async () => {
    if (!imageSrc) return;
    setAnalyzing(true);
    setSelectedId(null);
    log('Analyse IA lancée...', 'info');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageSrc }),
      });

      if (!res.ok) throw new Error('Erreur API');
      
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      let rawElements: UiElement[] = data.elements;
      log(`${rawElements.length} zones trouvées.`, 'ok');
      log('Calcul des pixels...', 'info');
      
      const verifiedElements = performPixelAudit(rawElements);
      setElements(verifiedElements);
      log('Terminé. Touchez les zones vertes.', 'ok');

    } catch (err: any) {
      log(`Erreur: ${err.message}`, 'err');
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

  // Trouver l'élément actuellement sélectionné pour afficher ses détails
  const activeElement = elements.find(e => e.id === selectedId);

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FF94] font-mono p-4 flex flex-col gap-4">
      
      {/* HEADER MOBILE */}
      <div className="flex justify-between items-center border-b border-[#003311] pb-2">
        <h1 className="text-sm font-bold tracking-widest">PIXEL SCANNER</h1>
        <div className="text-[10px] bg-[#003311] px-2 py-1 rounded">MOBILE MODE</div>
      </div>

      {/* ZONE IMAGE (SCROLLABLE SI TROP GRANDE) */}
      <div className="relative w-full aspect-square bg-[#0a0a0a] border border-[#003311] rounded overflow-hidden flex items-center justify-center">
        {!imageSrc ? (
           <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer active:bg-[#00220a]">
              <span className="text-4xl mb-2">+</span>
              <span className="text-xs">TOUCHER POUR UPLOAD</span>
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
           </label>
        ) : (
          <div className="relative w-full h-full">
            <img 
              ref={imgRef} 
              src={imageSrc} 
              alt="Scan Target" 
              className="w-full h-full object-contain opacity-60" 
            />
            
            {/* OVERLAY INTERACTIF */}
            {elements.map((el) => {
               // Adaptation responsive simplifiée pour l'affichage mobile
               const top = el.box_2d[0] / 10 + '%';
               const left = el.box_2d[1] / 10 + '%';
               const height = (el.box_2d[2] - el.box_2d[0]) / 10 + '%';
               const width = (el.box_2d[3] - el.box_2d[1]) / 10 + '%';
               const isSelected = selectedId === el.id;

               return (
                 <div
                   key={el.id}
                   // Au lieu de hover, on utilise onClick pour le tactile
                   onClick={() => setSelectedId(isSelected ? null : el.id)}
                   className={`absolute border-2 transition-all z-20
                     ${isSelected ? 'border-[#00FF94] bg-[#00FF94]/20 shadow-[0_0_15px_rgba(0,255,148,0.6)]' : 'border-[#00FF94]/40'}`}
                   style={{ top, left, width, height }}
                 />
               )
            })}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* BOUTON D'ACTION (Large pour le pouce) */}
      <button 
        onClick={runDeepScan}
        disabled={!imageSrc || analyzing}
        className="w-full bg-[#003311] active:bg-[#00FF94] active:text-black disabled:opacity-30 border border-[#00FF94]/50 text-[#00FF94] py-4 rounded font-bold text-sm transition-colors"
      >
        {analyzing ? 'ANALYSE EN COURS...' : 'LANCER SCAN'}
      </button>

      {/* PANNEAU DE DÉTAILS (Fixe ou sous l'image) */}
      <div className="flex-1 bg-[#080808] border border-[#111] p-4 rounded shadow-2xl flex flex-col gap-2 min-h-[200px]">
        {activeElement ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex justify-between items-start border-b border-[#222] pb-2 mb-2">
              <span className="text-white font-bold text-lg">{activeElement.label}</span>
              <span className="text-[10px] border border-[#333] px-1 rounded text-gray-400">{activeElement.type.toUpperCase()}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-[#111] p-2 rounded">
                <p className="text-gray-500 mb-1">COULEUR RÉELLE</p>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded border border-white" style={{background: activeElement.realColor}}></div>
                  <span className="text-white font-mono text-sm">{activeElement.realColor}</span>
                </div>
              </div>
              
              <div className="bg-[#111] p-2 rounded">
                <p className="text-gray-500 mb-1">DIMENSIONS</p>
                <p className="text-white font-mono text-sm">{activeElement.dimensions}</p>
              </div>
            </div>
            
            <div className="mt-2 text-xs text-gray-400">
              ID: {activeElement.id} • Scan verified via Canvas API
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs text-center">
            <p>1. Lancez l'analyse</p>
            <p>2. Touchez une zone verte pour voir les données pixel-perfect</p>
          </div>
        )}
      </div>

      {/* LOGS MINIMALISTES */}
      <div className="h-24 bg-black border-t border-[#111] overflow-y-auto text-[10px] p-2 font-mono">
        {logs.map((log, i) => (
          <div key={i} className={log.type === 'err' ? 'text-red-500' : log.type === 'ok' ? 'text-white' : 'text-gray-500'}>
            {log.type === 'ok' ? '✔' : '>'} {log.msg}
          </div>
        ))}
      </div>

    </div>
  );
    }
