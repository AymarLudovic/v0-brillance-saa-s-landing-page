'use client';

import { useState, useRef } from 'react';

// --- TYPES ---
type Log = { time: string; msg: string; type: 'info' | 'ok' | 'err' };
type UiElement = {
  id: string;
  type: string;
  box_2d: number[];
  dimensions?: string;
};

export default function StreamScanner() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'reconstructing'>('idle');
  const [elements, setElements] = useState<UiElement[]>([]);
  const [reconstructedHtml, setReconstructedHtml] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const log = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    setLogs(prev => [{ time, msg, type }, ...prev]);
  };

  const copyLog = (text: string) => navigator.clipboard.writeText(text);

  // OPTIMISATION IMAGE : On convertit en JPEG léger pour éviter le timeout upload
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // On limite la taille max à 1500px pour la vitesse
            const scale = Math.min(1, 1500 / Math.max(img.width, img.height));
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Compression JPEG 70% -> Beaucoup plus rapide pour l'API
            const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.7);
            
            setImageSrc(optimizedBase64);
            setElements([]);
            setReconstructedHtml(null);
            log('Image optimisée et chargée.', 'ok');
        };
        img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // --- LECTEUR DE STREAM UNIVERSEL ---
  // Cette fonction lit les morceaux de données qui arrivent petit à petit
  const fetchStream = async (url: string, body: any) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    if (!response.body) throw new Error("Pas de flux de réponse");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let resultText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resultText += decoder.decode(value, { stream: true });
    }
    // Fin du stream
    resultText += decoder.decode(); 
    return resultText;
  };

  // --- 1. SCAN (STREAMED) ---
  const runScan = async () => {
    if (!imageSrc) return;
    setStatus('analyzing');
    log('Démarrage flux stream...', 'info');

    try {
      // On récupère le texte brut via stream
      let rawText = await fetchStream('/api/analyze', { imageBase64: imageSrc });
      
      // Nettoyage JSON post-réception
      rawText = rawText.replace(/```json/g, '').replace(/```/g, '');
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace === -1) throw new Error("Réponse invalide (Pas de JSON)");
      
      const cleanJson = rawText.substring(firstBrace, lastBrace + 1);
      const data = JSON.parse(cleanJson);

      let rawElements: UiElement[] = data.elements;
      log(`${rawElements.length} éléments reçus en stream.`, 'ok');

      // Audit rapide des dimensions (Client-side)
      const refinedElements = performFastAudit(rawElements);
      setElements(refinedElements);

    } catch (err: any) {
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  // --- 2. RECONSTRUCT (STREAMED) ---
  const runReconstruct = async () => {
    if (!imageSrc || elements.length === 0) return;
    setStatus('reconstructing');
    log('Streaming HTML Wireframe...', 'info');

    try {
      let htmlCode = await fetchStream('/api/reconstruct', { 
        imageBase64: imageSrc,
        scannedElements: elements 
      });

      // Nettoyage HTML
      htmlCode = htmlCode.replace(/```html/g, '').replace(/```/g, '');
      setReconstructedHtml(htmlCode);
      log('Reconstruction terminée.', 'ok');

    } catch (err: any) {
      log(err.message, 'err');
    } finally {
      setStatus('idle');
    }
  };

  const performFastAudit = (items: UiElement[]) => {
    // Calcul simple des dimensions pour l'affichage
    // (Ta logique existante de canvas audit peut être réintégrée ici si besoin)
    return items.map(item => item); 
  };

  return (
    <div className="min-h-screen bg-[#111] text-white font-mono p-2 flex flex-col gap-2">
      <div className="border-b border-gray-800 pb-2 mb-2">
        <h1 className="text-xs font-bold text-[#00FF94]">STREAM SCANNER V3</h1>
      </div>

      <div className="relative w-full bg-black border border-gray-800 rounded min-h-[250px] overflow-hidden">
        {!imageSrc ? (
           <label className="flex flex-col items-center justify-center w-full h-full p-10 cursor-pointer">
              <span className="text-2xl text-gray-600">+</span>
              <span className="text-[10px] text-gray-500 mt-2">UPLOAD (AUTO-OPTIMIZED)</span>
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
           </label>
        ) : (
          <>
            <img src={imageSrc} className="w-full opacity-40" />
            {elements.map((el, i) => (
                <div 
                    key={i}
                    className="absolute border border-[#00FF94]/70"
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
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button 
            onClick={runScan} 
            disabled={!imageSrc || status !== 'idle'}
            className="bg-[#003311] text-[#00FF94] py-3 rounded text-[10px] font-bold disabled:opacity-50"
        >
            {status === 'analyzing' ? 'STREAMING DATA...' : '1. SCAN STREAM'}
        </button>
        <button 
            onClick={runReconstruct} 
            disabled={elements.length === 0 || status !== 'idle'}
            className="bg-[#001133] text-blue-400 py-3 rounded text-[10px] font-bold disabled:opacity-50"
        >
            {status === 'reconstructing' ? 'STREAMING HTML...' : '2. RECONSTRUCT'}
        </button>
      </div>

      {reconstructedHtml && (
          <div className="border border-white bg-white h-[300px] relative">
              <iframe srcDoc={reconstructedHtml} className="w-full h-full border-none" />
          </div>
      )}

      <div className="bg-black border border-gray-800 rounded p-2 h-[150px] overflow-y-auto text-[9px]">
        {logs.map((log, i) => (
            <div key={i} className="flex justify-between items-start mb-1 border-b border-gray-900 pb-1">
                <span className={log.type === 'err' ? 'text-red-500' : 'text-green-400'}>
                    {log.type === 'err' ? 'ERR: ' : '> '} {log.msg}
                </span>
                <button onClick={() => copyLog(log.msg)} className="bg-gray-800 text-gray-300 px-1 rounded">CPY</button>
            </div>
        ))}
      </div>
    </div>
  );
    }
