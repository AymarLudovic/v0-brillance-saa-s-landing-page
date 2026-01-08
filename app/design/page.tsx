"use client";

import React, { useState, useRef } from 'react';

export default function SimpleExtractor() {
  const [image, setImage] = useState<string | null>(null);
  const [sections, setSections] = useState<{id: number, x: number, y: number, w: number, h: number, color: string}[]>([]);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef({ isDrawing: false, x: 0, y: 0 });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage(ev.target?.result as string);
      setSections([]); // Reset
    };
    reader.readAsDataURL(file);
  };

  const startSelecting = (e: React.TouchEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top;
    drawingRef.current = { isDrawing: true, x, y };
  };

  const endSelecting = (e: React.TouchEvent | React.MouseEvent) => {
    if (!drawingRef.current.isDrawing) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const endX = ('changedTouches' in e ? e.changedTouches[0].clientX : e.clientX) - rect.left;
    const endY = ('changedTouches' in e ? e.changedTouches[0].clientY : e.clientY) - rect.top;

    const ctx = canvasRef.current!.getContext('2d', { willReadFrequently: true })!;
    // On prend la couleur au centre de ta sélection
    const pixel = ctx.getImageData(endX, endY, 1, 1).data;
    const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase()}`;

    setSections([...sections, {
      id: Date.now(),
      x: drawingRef.current.x,
      y: drawingRef.current.y,
      w: endX - drawingRef.current.x,
      h: endY - drawingRef.current.y,
      color: hex
    }]);
    drawingRef.current.isDrawing = false;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 font-sans">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-lg font-bold">COLOR MATCH PRO</h1>
        <input type="file" onChange={handleUpload} className="hidden" id="up" />
        <label htmlFor="up" className="bg-blue-600 px-4 py-2 rounded-lg text-sm">Upload</label>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* 1. IMAGE SOURCE AVEC DÉTECTION */}
        <div className="relative border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900">
          <p className="text-[10px] p-2 text-zinc-500 uppercase">1. Tracez un cadre sur l'image pour extraire</p>
          {image && (
            <div className="relative touch-none">
              <img src={image} className="w-full h-auto" onLoad={(e) => {
                const img = e.currentTarget;
                canvasRef.current!.width = img.width;
                canvasRef.current!.height = img.height;
                canvasRef.current!.getContext('2d')!.drawImage(img, 0, 0);
              }} />
              <canvas 
                ref={canvasRef}
                onMouseDown={startSelecting}
                onMouseUp={endSelecting}
                onTouchStart={startSelecting}
                onTouchEnd={endSelecting}
                className="absolute inset-0 w-full h-full opacity-0"
              />
              {/* Dessin des traits par dessus l'image */}
              <svg className="absolute inset-0 pointer-events-none w-full h-full">
                {sections.map(s => (
                  <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="#00FF00" strokeWidth="2" />
                ))}
              </svg>
            </div>
          )}
        </div>

        {/* 2. PAGE BLANCHE DE TEST (COLORIAGE) */}
        <div className="bg-white rounded-xl p-4 min-h-[300px] relative shadow-2xl">
          <p className="text-[10px] mb-4 text-zinc-400 uppercase">2. Rendu des sections & Harmonie</p>
          <div className="relative w-full h-full border border-zinc-100">
            {sections.map(s => (
              <div 
                key={s.id}
                className="absolute border border-black/10 flex items-center justify-center group"
                style={{ left: s.x, top: s.y, width: s.w, height: s.h, backgroundColor: s.color }}
                onClick={() => {
                    navigator.clipboard.writeText(s.color);
                    setSelectedColor(s.color);
                    setTimeout(() => setSelectedColor(null), 1000);
                }}
              >
                <span className="text-[10px] font-bold mix-blend-difference text-white opacity-0 group-active:opacity-100">
                  COPIÉ
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. LISTE DES CODES HEX */}
        <div className="flex gap-2 overflow-x-auto pb-4">
          {sections.map(s => (
            <div key={s.id} className="flex-shrink-0 bg-zinc-900 p-2 rounded-lg border border-zinc-800 text-center">
              <div className="w-12 h-12 rounded mb-1" style={{ backgroundColor: s.color }} />
              <code className="text-[10px] text-zinc-400">{s.color}</code>
            </div>
          ))}
        </div>
      </div>

      {selectedColor && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-green-600 px-6 py-3 rounded-full font-bold animate-bounce">
          {selectedColor} COPIÉ !
        </div>
      )}
    </div>
  );
                                   }
