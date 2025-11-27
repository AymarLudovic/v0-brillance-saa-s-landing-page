'use client';

import { useState, useRef, useEffect } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  box_2d: number[];
  realColor?: string;
  dimensions?: string;
  isCorrected?: boolean;
};

export default function UltimateScanner() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'reconstructing'>('idle');
  const [elements, setElements] = useState<UiElement[]>([]);
  const [reconstructedHtml, setReconstructedHtml] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
  };

  const copyLog = (text: string) => navigator.clipboard.writeText(text);

  // --- UPLOAD ---
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    log(`Chargement RAW: ${(file.size / 1024 / 1024).toFixed(2)} MB`, 'info');
    
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (ev.target?.result) {
            setImageSrc(ev.target.result as string);
            setElements([]);
            setReconstructedHtml(null);
            log('Image prête. Canvas initialisé.', 'ok');
        }
    };
    reader.readAsDataURL(file);
  };

  // --- MOTEUR DE STREAMING ---
  const fetchStream = async (url: string, body: any) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt.slice(0, 50)}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let resultText = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      resultText += decoder.decode(value, { stream: true });
    }
    resultText += decoder.decode();
    return resultText;
  };

  // --- 1. SCAN + CORRECTION PIXEL PERFECT (Le retour) ---
  const runScan = async () => {
    if (!imageSrc) return;
    setStatus('analyzing');
    log('1. Analyse IA (Structure)...', 'info');

    try {
      let rawText = await fetchStream('/api/analyze', { imageBase64: imageSrc });
      
      // Nettoyage JSON
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '');
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace === -1) throw new Error("JSON invalide");
      const cleanJson = rawText.substring(firstBrace, lastBrace + 1);
      const data = JSON.parse(cleanJson);

      let rawElements: UiElement[] = data.elements;
      log(`IA: ${rawElements.length} éléments.`, 'ok');

      // --- LE RETOUR DU CANVAS MAGIC ---
      log('2. Chirurgie Pixels (Canvas)...', 'info');
      const correctedElements = performPixelSurgery(rawElements);
      setElements(correctedElements);
      log('Correction terminée. Précision Max.', 'ok');

    } catch (err: any) {
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  // --- 2. RECONSTRUCTION ---
  const runReconstruct = async () => {
    if (!imageSrc || elements.length === 0) return;
    setStatus('reconstructing');
    log('Génération Wireframe...', 'info');

    try {
      // On envoie les éléments CORRIGÉS par le canvas à l'IA
      let htmlCode = await fetchStream('/api/reconstruct', { 
        imageBase64: imageSrc, 
        scannedElements: elements 
      });

      htmlCode = htmlCode.replace(/```html/g, '').replace(/```/g, '');
      setReconstructedHtml(htmlCode);
      log('Wireframe généré.', 'ok');
    } catch (err: any) {
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  // --- ALGORITHME CHIRURGICAL (CANVAS) ---
  const performPixelSurgery = (items: UiElement[]) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return items;

    // Configuration du labo
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return items;

    ctx.drawImage(img, 0, 0);

    return items.map(item => {
      // 1. Conversion 0-1000 -> Pixels Réels
      let x = Math.floor((item.box_2d[1] / 1000) * canvas.width);
      let y = Math.floor((item.box_2d[0] / 1000) * canvas.height);
      let w = Math.floor(((item.box_2d[3] - item.box_2d[1]) / 1000) * canvas.width);
      let h = Math.floor(((item.box_2d[2] - item.box_2d[0]) / 1000) * canvas.height);

      // Sécurité bords
      if (w <= 0 || h <= 0) return item;

      // 2. Shrink-Wrap (Resserrer la boite)
      const imageData = ctx.getImageData(x, y, w, h);
      const refined = autoCorrectBoundaries(imageData, w, h);
      
      let finalX = x, finalY = y, finalW = w, finalH = h;
      let isRefined = false;

      if (refined) {
        finalX += refined.x;
        finalY += refined.y;
        finalW = refined.w;
        finalH = refined.h;
        isRefined = true;
      }

      // 3. Couleur Réelle
      const centerPixel = ctx.getImageData(finalX + finalW/2, finalY + finalH/2, 1, 1).data;
      const hexColor = `#${((1 << 24) + (centerPixel[0] << 16) + (centerPixel[1] << 8) + centerPixel[2]).toString(16).slice(1).toUpperCase()}`;

      // 4. On renvoie les coordonnées corrigées (re-normalisées pour l'affichage CSS)
      return {
        ...item,
        box_2d: [
            (finalY / canvas.height) * 1000,
            (finalX / canvas.width) * 1000,
            ((finalY + finalH) / canvas.height) * 1000,
            ((finalX + finalW) / canvas.width) * 1000
        ],
        realColor: hexColor,
        dimensions: `${finalW}x${finalH}`,
        isCorrected: isRefined
      };
    });
  };

  // Logique mathématique de détection de bords
  const autoCorrectBoundaries = (imgData: ImageData, w: number, h: number) => {
    const data = imgData.data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let found = false;
    
    // On prend la couleur du coin haut-gauche comme référence de "vide"
    const bgR = data[0], bgG = data[1], bgB = data[2];

    for (let y = 0; y < h; y+=2) { // Step 2 pour perf
      for (let x = 0; x < w; x+=2) {
        const i = (y * w + x) * 4;
        const diff = Math.abs(data[i]-bgR) + Math.abs(data[i+1]-bgG) + Math.abs(data[i+2]-bgB);
        
        if (diff > 30) { // Seuil de tolérance
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    
    if (!found) return null;
    return { x: Math.max(0, minX-2), y: Math.max(0, minY-2), w: (maxX-minX)+4, h: (maxY-minY)+4 };
  };

  const activeEl = elements.find(e => e.id === selectedId);

  return (
    <div className="min-h-screen bg-[#050505] text-[#00FF94] font-mono p-4 flex flex-col gap-4">
      <div className="flex justify-between border-b border-[#003311] pb-2">
        <h1 className="font-bold">ULTIMATE SCANNER V4</h1>
        <div className="flex gap-2">
            <span className="text-[10px] bg-blue-900 text-white px-1 rounded">STREAM</span>
            <span className="text-[10px] bg-purple-900 text-white px-1 rounded">CANVAS</span>
        </div>
      </div>

      <div className="relative w-full bg-[#0a0a0a] border border-[#003311] rounded min-h-[300px] overflow-hidden">
        {!imageSrc ? (
           <label className="flex flex-col items-center justify-center w-full h-full p-10 cursor-pointer">
              <span className="text-4xl">+</span>
              <span className="text-xs mt-2 text-gray-500">UPLOAD IMAGE</span>
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
           </label>
        ) : (
          <>
            <img ref={imgRef} src={imageSrc} className="w-full opacity-40" />
            {elements.map((el, i) => {
                 const isSel = selectedId === el.id;
                 return (
                    <div 
                        key={i}
                        onClick={() => setSelectedId(isSel ? null : el.id)}
                        className={`absolute border transition-all ${isSel ? 'z-50 border-white bg-white/10' : 'border-green-500/50'} ${el.isCorrected ? 'border-dashed' : ''}`}
                        style={{
                            top: el.box_2d[0] / 10 + '%',
                            left: el.box_2d[1] / 10 + '%',
                            height: (el.box_2d[2] - el.box_2d[0]) / 10 + '%',
                            width: (el.box_2d[3] - el.box_2d[1]) / 10 + '%'
                        }}
                    />
                 )
            })}
          </>
        )}
        {/* LE CANVAS CACHÉ EST LÀ ! */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button onClick={runScan} disabled={!imageSrc || status !== 'idle'} className="bg-[#003311] py-4 rounded font-bold disabled:opacity-30">
            {status === 'analyzing' ? 'SCANNING...' : '1. PIXEL SCAN'}
        </button>
        <button onClick={runReconstruct} disabled={elements.length === 0 || status !== 'idle'} className="bg-[#001133] text-blue-400 py-4 rounded font-bold disabled:opacity-30">
            {status === 'reconstructing' ? 'BUILDING...' : '2. RECONSTRUCT'}
        </button>
      </div>

      {/* INFO PANEL */}
      <div className="bg-[#111] p-2 border border-[#333] h-[60px] flex items-center gap-4">
        {activeEl ? (
            <>
                <div className="text-xs text-white font-bold">{activeEl.type}</div>
                <div className="text-xs text-gray-400">Dim: {activeEl.dimensions}</div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    Hex: <div className="w-3 h-3 border" style={{background: activeEl.realColor}}></div> {activeEl.realColor}
                </div>
                {activeEl.isCorrected && <div className="text-[9px] bg-green-900 text-green-200 px-1 rounded">CORRECTED</div>}
            </>
        ) : <div className="text-xs text-gray-600">Touchez une zone...</div>}
      </div>

      {reconstructedHtml && (
          <div className="border border-white bg-white h-[300px] relative mt-2">
              <iframe srcDoc={reconstructedHtml} className="w-full h-full border-none" />
          </div>
      )}

      <div className="bg-black border border-gray-800 rounded p-2 h-[150px] overflow-y-auto text-[10px]">
        {logs.map((log, i) => (
            <div key={i} className="flex justify-between items-start mb-1 border-b border-gray-900 pb-1">
                <span className={log.type === 'err' ? 'text-red-500' : 'text-green-400'}>
                    {log.type === 'err' ? '✖ ' : '> '} {log.msg}
                </span>
                <button onClick={() => copyLog(log.msg)} className="bg-[#111] text-gray-500 px-1 border border-[#333]">C</button>
            </div>
        ))}
      </div>
    </div>
  );
    }
