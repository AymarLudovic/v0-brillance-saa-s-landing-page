'use client';

import { useState, useRef } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  content?: string;
  box_2d: number[];
  realColor?: string;
  dimensions?: string;
};

export default function PixelArchitect() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'reconstructing'>('idle');
  const [elements, setElements] = useState<UiElement[]>([]);
  const [reconstructedHtml, setReconstructedHtml] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- LOGGING ---
  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
  };

  const copyLog = (text: string) => {
    navigator.clipboard.writeText(text);
    // Petit feedback visuel pourrait être ajouté ici
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        setImageSrc(ev.target.result as string);
        setElements([]);
        setReconstructedHtml(null);
        log('Image chargée.', 'ok');
      }
    };
    reader.readAsDataURL(file);
  };

  // --- 1. SCAN & DETECT ---
  const runScan = async () => {
    if (!imageSrc) return;
    setStatus('analyzing');
    log('Démarrage analyse structurelle...', 'info');

    try {
      // APPEL API ANALYZE
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageSrc }),
      });

      const rawText = await res.text();
      if (!res.ok) throw new Error(`Erreur ${res.status}: ${rawText.slice(0, 100)}`);
      
      const data = JSON.parse(rawText);
      if (data.error) throw new Error(data.error);

      let rawElements: UiElement[] = data.elements;
      log(`${rawElements.length} éléments détectés.`, 'ok');

      // PIXEL PERFECT AUDIT (SHRINK WRAP RAPIDE)
      const refinedElements = performFastAudit(rawElements);
      setElements(refinedElements);
      
      log('Scan terminé. Prêt pour reconstruction.', 'ok');
    } catch (err: any) {
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  // --- 2. RECONSTRUCTION WIREFRAME ---
  // ... (Garde tes imports et états existants)

  // --- 2. RECONSTRUCTION WIREFRAME (MODE STREAM) ---
// ... (reste du code)

  const runReconstruct = async () => {
    if (!imageSrc || elements.length === 0) return;
    setStatus('reconstructing');
    setReconstructedHtml(''); 
    log('Génération du Wireframe (Stream)...', 'info');

    try {
      const res = await fetch('/api/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            imageBase64: imageSrc,
            scannedElements: elements 
        }),
      });

      if (!res.ok) {
        // Tentative de lire l'erreur JSON si le status n'est pas 200
        const errText = await res.text();
        throw new Error(`Erreur API (${res.status}): ${errText}`);
      }

      if (!res.body) throw new Error("Le corps de la réponse est vide.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedHtml = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        accumulatedHtml += chunk;
        
        // Optionnel : Feedback visuel en temps réel dans les logs si tu veux
        // log(`Reçu: ${chunk.length} caractères...`, 'info');
      }

      // Nettoyage de sécurité (au cas où Gemini insiste avec le Markdown)
      const cleanHtml = accumulatedHtml
        .replace(/```html/g, '')
        .replace(/```/g, '');

      setReconstructedHtml(cleanHtml);
      log('Wireframe terminé !', 'ok');

    } catch (err: any) {
      console.error(err);
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  // --- AUDIT PIXEL (Simple pour perf mobile) ---
  const performFastAudit = (items: UiElement[]) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return items;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return items;
    ctx.drawImage(img, 0, 0);

    return items.map(item => {
      // Ici on calcule juste les dimensions réelles pour l'affichage
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const w = Math.floor(((xmax - xmin) / 1000) * canvas.width);
      const h = Math.floor(((ymax - ymin) / 1000) * canvas.height);
      return { ...item, dimensions: `${w}x${h}` };
    });
  };

  return (
    <div className="min-h-screen bg-[#111] text-white font-mono p-2 flex flex-col gap-2">
      
      {/* HEADER */}
      <div className="flex justify-between items-center border-b border-gray-800 pb-2">
        <h1 className="text-xs font-bold text-[#00FF94]">PIXEL ARCHITECT</h1>
        <div className="text-[9px] text-gray-500">NEXTJS VERCEL</div>
      </div>

      {/* ZONE 1 : L'IMAGE ORIGINALE AVEC OVERLAY */}
      <div className="relative w-full bg-black border border-gray-800 rounded min-h-[250px]">
        {!imageSrc ? (
           <label className="flex flex-col items-center justify-center w-full h-full p-10 cursor-pointer">
              <span className="text-2xl text-gray-600">+</span>
              <span className="text-[10px] text-gray-500 mt-2">UPLOAD IMAGE</span>
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
           </label>
        ) : (
          <>
            <img ref={imgRef} src={imageSrc} className="w-full opacity-40" />
            {elements.map(el => (
                <div 
                    key={el.id}
                    onClick={() => setSelectedId(selectedId === el.id ? null : el.id)}
                    className={`absolute border ${selectedId === el.id ? 'border-white z-50 bg-white/10' : 'border-[#00FF94]/50'}`}
                    style={{
                        top: el.box_2d[0] / 10 + '%',
                        left: el.box_2d[1] / 10 + '%',
                        height: (el.box_2d[2] - el.box_2d[0]) / 10 + '%',
                        width: (el.box_2d[3] - el.box_2d[1]) / 10 + '%'
                    }}
                />
            ))}
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* BOUTONS D'ACTION */}
      <div className="grid grid-cols-2 gap-2">
        <button 
            onClick={runScan} 
            disabled={!imageSrc || status !== 'idle'}
            className="bg-[#003311] text-[#00FF94] border border-[#00FF94]/30 py-3 rounded text-[10px] font-bold disabled:opacity-30"
        >
            {status === 'analyzing' ? 'SCANNING...' : '1. SCAN STRUCTURE'}
        </button>
        <button 
            onClick={runReconstruct} 
            disabled={elements.length === 0 || status !== 'idle'}
            className="bg-[#001133] text-blue-400 border border-blue-500/30 py-3 rounded text-[10px] font-bold disabled:opacity-30"
        >
            {status === 'reconstructing' ? 'BUILDING...' : '2. RECONSTRUCT (TEST)'}
        </button>
      </div>

      {/* ZONE 2 : LA PREUVE (IFRAME WIREFRAME) */}
      {reconstructedHtml && (
          <div className="border border-white bg-white rounded overflow-hidden h-[300px] relative">
              <div className="absolute top-0 left-0 bg-black text-white text-[9px] px-2 py-1 z-10">RÉSULTAT GÉNÉRÉ (WIREFRAME)</div>
              <iframe 
                srcDoc={reconstructedHtml} 
                className="w-full h-full border-none"
                title="Reconstruction"
              />
          </div>
      )}

      {/* LOGS RESTAURÉS (AVEC COPY) */}
      <div className="bg-black border border-gray-800 rounded p-2 h-[150px] overflow-y-auto text-[9px]">
        {logs.length === 0 && <span className="text-gray-700">Waiting for logs...</span>}
        {logs.map((log, i) => (
            <div key={i} className="flex justify-between items-start mb-1 border-b border-gray-900 pb-1">
                <div className={`${log.type === 'err' ? 'text-red-500' : log.type === 'ok' ? 'text-green-400' : 'text-gray-400'} break-all pr-2`}>
                    <span className="text-gray-600 mr-2">[{log.time}]</span>
                    {log.type === 'err' ? 'ERROR: ' : '> '}
                    {log.msg}
                </div>
                <button 
                    onClick={() => copyLog(log.msg)}
                    className="text-[8px] bg-gray-800 text-gray-300 px-1 rounded hover:bg-white hover:text-black shrink-0"
                >
                    CPY
                </button>
            </div>
        ))}
      </div>
    </div>
  );
}
