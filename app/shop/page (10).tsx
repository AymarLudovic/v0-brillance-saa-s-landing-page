'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

interface ColorInfo { hex: string; r: number; g: number; b: number; count: number; xPercent: number; yPercent: number; }
interface ColorZone { name: string; row: number; col: number; dominant: string; colors: string[]; }
interface ExtractedColorData { dominantPalette: ColorInfo[]; zones: ColorZone[]; imageWidth: number; imageHeight: number; totalSampled: number; }

/* ── IndexedDB ── */
const DB_NAME = 'pixelperfect-v1', STORE = 'config';
async function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = e => { const db = (e.target as IDBOpenDBRequest).result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function dbGet(k: string): Promise<string | null> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(STORE,'readonly').objectStore(STORE).get(k); r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error); }); }
async function dbSet(k: string, v: string): Promise<void> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(STORE,'readwrite').objectStore(STORE).put(v, k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }

/* ── Canvas Color Extraction ── */
function extractColors(canvas: HTMLCanvasElement, img: HTMLImageElement): ExtractedColorData {
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const STEP = 3, Q = 8;
  const hex = (n: number) => n.toString(16).padStart(2,'0');
  const mkHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;
  const cmap = new Map<string,{r:number;g:number;b:number;count:number;x:number;y:number}>();
  let total = 0;
  for (let y = 0; y < height; y += STEP) for (let x = 0; x < width; x += STEP) {
    const i = (y*width+x)*4, r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];
    if (a < 20) continue;
    const qr=Math.round(r/Q)*Q, qg=Math.round(g/Q)*Q, qb=Math.round(b/Q)*Q, k=`${qr}|${qg}|${qb}`;
    if (cmap.has(k)) cmap.get(k)!.count++; else cmap.set(k,{r:qr,g:qg,b:qb,count:1,x,y});
    total++;
  }
  const dominantPalette = Array.from(cmap.values()).sort((a,b)=>b.count-a.count).slice(0,64)
    .map(v=>({hex:mkHex(v.r,v.g,v.b),r:v.r,g:v.g,b:v.b,count:v.count,xPercent:Math.round(v.x/width*100),yPercent:Math.round(v.y/height*100)}));
  const COLS=6,ROWS=6,zw=Math.floor(width/COLS),zh=Math.floor(height/ROWS),ZQ=16;
  const rL=['top','upper','mid-upper','mid-lower','lower','bottom'], cL=['far-left','ctr-left','near-left','near-right','ctr-right','far-right'];
  const zones: ColorZone[] = [];
  for (let row=0;row<ROWS;row++) for (let col=0;col<COLS;col++) {
    const x0=col*zw,y0=row*zh,x1=Math.min(x0+zw,width),y1=Math.min(y0+zh,height);
    const zm = new Map<string,number>();
    for (let y=y0;y<y1;y+=STEP) for (let x=x0;x<x1;x+=STEP) {
      const i=(y*width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=pixels[i+3];
      if(a<20) continue;
      const h=mkHex(Math.round(r/ZQ)*ZQ,Math.round(g/ZQ)*ZQ,Math.round(b/ZQ)*ZQ);
      zm.set(h,(zm.get(h)??0)+1);
    }
    const top=Array.from(zm.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([h])=>h);
    zones.push({name:`${rL[row]}_${cL[col]}`,row,col,dominant:top[0]??'#000',colors:top});
  }
  return {dominantPalette,zones,imageWidth:width,imageHeight:height,totalSampled:total};
}

/* ── System Prompt ── */
const SYSTEM_PROMPT = `You are a forensic UI reverse-engineering system. You MEASURE and REPRODUCE. You do NOT interpret, improve, or stylize. You work like a pixel-reading machine.

══════════════════════════════════════════════════════════════
SECTION 1 — FULL-PAGE OUTPUT REQUIREMENT (CRITICAL)
══════════════════════════════════════════════════════════════

The generated HTML MUST produce a FULL-PAGE layout, not a centered block.

ALWAYS start your <style> or Tailwind config with:
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100vh;
    overflow-x: hidden;
  }

NEVER wrap the entire page content in a container with:
  - max-width: 800px / 1000px / 1200px centered with margin: auto
  unless the ORIGINAL screenshot clearly shows a narrow centered content area.

If the original is full-width (background color/image spans edge-to-edge) → your output must also be full-width.
The page must fill 100% of the iframe viewport width.

══════════════════════════════════════════════════════════════
SECTION 2 — AVAILABLE EFFECT LIBRARIES (USE THEM CORRECTLY)
══════════════════════════════════════════════════════════════

You have access to these CDNs. Use ONLY what is NEEDED for the detected effects:

▸ GSAP (animations, scroll triggers, timelines):
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"></script>
  Use for: floating elements, parallax, timeline animations, scroll-driven effects
  Example: gsap.to(".card", {rotateY: 15, rotateX: -10, duration: 2, ease: "power2.out"})

▸ CSS 3D / mix-blend-mode (NO library needed — native browser):
  Use for:
  - Overlapping text over images: mix-blend-mode: multiply / screen / overlay
  - 3D card tilts: transform: perspective(800px) rotateY(15deg) rotateX(-10deg)
  - Text clipping through images: background-clip: text
  - Layered visual compositions

▸ Three.js (only for true 3D scenes):
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  Use ONLY if the original has a WebGL 3D scene, particles, or 3D geometry.

▸ AOS (scroll reveal animations):
  <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet">
  <script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
  Use for: elements that fade/slide in on scroll

▸ Tabler Icons:
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
  Usage: <i class="ti ti-home"></i>

▸ Google Favicon API (brand logos):
  <img src="https://www.google.com/s2/favicons?domain=netflix.com&sz=32">

▸ Tailwind CSS:
  <script src="https://cdn.tailwindcss.com"></script>

WHEN TO USE EACH:
- Floating/tilted cards (like physical cards in 3D space) → CSS 3D transforms + GSAP
- Text overlapping images with color blend → CSS mix-blend-mode
- Elements that animate on scroll → GSAP ScrollTrigger or AOS
- Particles / WebGL scenes → Three.js
- Static icons → Tabler Icons
- Never use Three.js for something achievable with CSS 3D

══════════════════════════════════════════════════════════════
SECTION 3 — CRITICAL FAILURE MODES (DO NOT REPEAT THESE)
══════════════════════════════════════════════════════════════

1. BADGE SYNDROME: "Finance" with dot = dot + plain text. NOT a pill/chip with background.
   Only add badge background if you CLEARLY SEE a filled shape around the text.

2. ICON SIZE INFLATION: Icons in most UIs are 14-16px relative to text. NOT 20-24px.
   Measure: icon height ≈ text line-height → 14-16px.

3. ROW HEIGHT INFLATION: Count rows visible / divide table height.
   12 rows in 400px = ~33px/row. DO NOT default to 44-48px.

4. BORDER-RADIUS CREEP: Professional UIs often have 0-4px radius on inputs/cells.
   Only round things that LOOK visually round. Do not auto-add rounded corners.

5. PADDING INFLATION: If text is close to its container edge → padding is 4-8px.
   Do not inflate to 12-16px unless clearly visible.

6. COLOR GUESSING: USE ONLY canvas-extracted hex values. Zero approximation.

7. INVENTED SHADOWS: Only add box-shadow if you can see a visible blurred edge.

8. GENERIC LAYOUT: Do NOT wrap content in a centered 800px box when the original is full-width.

9. MISSING BLEND EFFECTS: If text overlaps images/backgrounds with color mixing visible
   → use mix-blend-mode (multiply, screen, overlay, difference). Do not skip this.

10. FLAT WHEN 3D: If elements appear tilted/rotated in 3D space (like physical cards)
    → use perspective + rotateX/rotateY CSS transforms, optionally animated with GSAP.

══════════════════════════════════════════════════════════════
SECTION 4 — ANALYSIS PROTOCOL
══════════════════════════════════════════════════════════════

▸ STEP 1 — DETECT VISUAL EFFECTS PRESENT
  Before anything, identify:
  □ Is there a 3D element? (perspective, tilt, depth)
  □ Is there text blending over images? (mix-blend-mode needed)
  □ Are there scroll animations? (GSAP ScrollTrigger / AOS needed)
  □ Are there animated transitions? (GSAP timeline needed)
  □ Is the background full-width? → must be full-width in output
  □ Are there parallax layers?

▸ STEP 2 — MEASURE LAYOUT
  - Full page or centered container? (measure proportions)
  - Sidebar width if present
  - Header height
  - Section heights and background colors (canvas hex only)

▸ STEP 3 — TYPOGRAPHY
  - Font families (closest Google Font)
  - Sizes per role: display/h1/h2/body/small/label (in px)
  - Weights: exact (300/400/500/600/700/800/900)
  - Colors: canvas hex only
  - letter-spacing, line-height, text-transform

▸ STEP 4 — COLOR MAPPING (canvas data is the source of truth)
  - Background: canvas hex
  - Surface/card: canvas hex
  - Borders: canvas hex
  - Text primary/secondary: canvas hex
  - Accent/interactive: canvas hex

▸ STEP 5 — COMPONENT SPECS (measure each)
  Inputs: exact height, border (width+color+radius), bg, padding
  Buttons: padding, radius, bg, font-size/weight, border
  Cards: bg, border, shadow (only if visible), radius, padding
  Table rows: height, border, cell padding
  Nav items: height, spacing, active state

▸ STEP 6 — GENERATE HTML
  1. <!DOCTYPE html> — complete, no truncation
  2. html,body: margin:0; padding:0; width:100%; min-height:100vh
  3. Google Fonts <link>
  4. Only the CDN libraries actually needed for detected effects
  5. CSS custom properties with canvas hex values
  6. All text verbatim
  7. All effects/animations reproduced
  8. Renders perfectly standalone in an iframe at 100% width

OUTPUT RULE: Raw HTML only. <!DOCTYPE html> to </html>. No markdown, no backticks, no explanation.`;

/* ── Gemini API Call ── */
async function callGemini(
  apiKey: string, userMsg: string, imageB64: string, mimeType: string,
  cd: ExtractedColorData, onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Sending to Gemini 3...');
  const colorPrompt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CANVAS PIXEL-EXTRACTED COLOR DATA
(Direct from image via Canvas API — use ONLY these hex values)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE: ${cd.imageWidth}×${cd.imageHeight}px | SAMPLED: ${cd.totalSampled.toLocaleString()}px

── TOP ${Math.min(cd.dominantPalette.length,48)} COLORS ──
${cd.dominantPalette.slice(0,48).map((c,i)=>`  ${String(i+1).padStart(2)}. ${c.hex}  rgb(${c.r},${c.g},${c.b})  freq:${c.count.toLocaleString()}px  @(${c.xPercent}%,${c.yPercent}%)`).join('\n')}

── ZONE MAP 6×6 ──
${cd.zones.map(z=>`  [${z.row},${z.col}] ${z.name.padEnd(22)} dom:${z.dominant}  [${z.colors.join(', ')}]`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${userMsg}`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
        system_instruction: { parts:[{text:SYSTEM_PROMPT}] },
        contents:[{role:'user',parts:[{inline_data:{mime_type:mimeType,data:imageB64}},{text:colorPrompt}]}],
        generationConfig:{temperature:0.01,maxOutputTokens:65536,topK:1,topP:0.85},
      }),
    }
  );
  if (!resp.ok) { const e = await resp.json().catch(()=>({})); throw new Error((e as any)?.error?.message??`API Error ${resp.status}`); }
  onProgress('Parsing response...');
  const data = await resp.json();
  const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const m = raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i); if (m) return m[0];
  const f = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/i); if (f) return f[1].trim();
  return raw.trim();
}

/* ── Open in new tab ── */
function openInTab(html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ── Icons ── */
const IcKey = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>;
const IcUpload = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IcEye = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcCode = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
const IcCopy = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IcZap = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const IcX = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcCheck = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcDownload = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IcExternalLink = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const IcPalette = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>;

const Spinner = ({ size='sm' }: { size?: 'sm'|'lg' }) => (
  <div className={`${size==='lg'?'w-10 h-10 border-[3px]':'w-3 h-3 border-2'} rounded-full border-cyan-500/20 border-t-cyan-400 animate-spin shrink-0`} />
);

/* ── Main ── */
export default function PixelPerfectAI() {
  const [apiKey, setApiKey]               = useState('');
  const [tempKey, setTempKey]             = useState('');
  const [showModal, setShowModal]         = useState(false);
  const [keySaved, setKeySaved]           = useState(false);
  const [copied, setCopied]               = useState(false);
  const [imgUrl, setImgUrl]               = useState('');
  const [imgB64, setImgB64]               = useState('');
  const [imgMime, setImgMime]             = useState('');
  const [colorData, setColorData]         = useState<ExtractedColorData|null>(null);
  const [extracting, setExtracting]       = useState(false);
  const [dragOver, setDragOver]           = useState(false);
  const [prompt, setPrompt]               = useState('Reproduis cette interface au pixel perfect. Chaque élément, couleur, espacement, effet visuel identique à la capture. Full-width. Aucun ajout non visible dans l\'original.');
  const [generating, setGenerating]       = useState(false);
  const [code, setCode]                   = useState('');
  const [error, setError]                 = useState('');
  const [progress, setProgress]           = useState('');
  const [tab, setTab]                     = useState<'preview'|'code'>('preview');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { dbGet('gemini_key').then(k => { if (k) { setApiKey(k); setTempKey(k); setKeySaved(true); } else setShowModal(true); }); }, []);

  useEffect(() => {
    if (!code) return;
    const iframe = iframeRef.current; if (!iframe) return;
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document; if (!doc) return;
    doc.open(); doc.write(code); doc.close();
  }, [code]);

  const saveKey = async () => { if (!tempKey.trim()) return; await dbSet('gemini_key', tempKey.trim()); setApiKey(tempKey.trim()); setKeySaved(true); setShowModal(false); };

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setExtracting(true); setColorData(null); setError('');
    const url = URL.createObjectURL(file); setImgUrl(url);
    const reader = new FileReader();
    reader.onload = e => { const res = e.target?.result as string; setImgB64(res.split(',')[1]); setImgMime(file.type); };
    reader.readAsDataURL(file);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { if (canvasRef.current) { try { setColorData(extractColors(canvasRef.current, img)); } catch(e) { console.error(e); } } setExtracting(false); };
    img.onerror = () => setExtracting(false); img.src = url;
  }, []);

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) processImage(f); };

  const generate = async () => {
    if (!apiKey) { setShowModal(true); return; }
    if (!imgB64) { setError('Upload a screenshot first.'); return; }
    if (!colorData) { setError('Color extraction still running…'); return; }
    setGenerating(true); setError(''); setCode('');
    try { const html = await callGemini(apiKey, prompt, imgB64, imgMime, colorData, setProgress); setCode(html); setTab('preview'); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error.'); }
    finally { setGenerating(false); setProgress(''); }
  };

  const copyCode = async () => { if (!code) return; await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const downloadCode = () => { if (!code) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code],{type:'text/html'})); a.download = 'pixel-perfect.html'; a.click(); };

  return (
    <div className="flex flex-col h-screen bg-[#07070f] text-slate-200 font-mono overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* HEADER */}
      <header className="flex items-center justify-between px-4 h-12 border-b border-white/[0.06] bg-[#08081a]/80 backdrop-blur-xl shrink-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center text-xs shadow-[0_0_14px_rgba(0,229,255,0.25)] shrink-0">⬡</div>
          <div>
            <p className="text-[12px] font-black tracking-tight bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent leading-none" style={{fontFamily:'system-ui'}}>PIXEL PERFECT AI</p>
            <p className="text-[7.5px] text-slate-700 tracking-[0.16em] mt-px">GEMINI 3 · CANVAS · GSAP · FULL-PAGE</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {keySaved && <span className="flex items-center gap-1 text-[8.5px] text-emerald-400 tracking-widest bg-emerald-950/50 border border-emerald-900/30 rounded-full px-2 py-0.5"><IcCheck/> KEY ACTIVE</span>}
          <button onClick={() => { setTempKey(apiKey); setShowModal(true); }}
            className="flex items-center gap-1 text-[10px] text-slate-500 border border-white/[0.07] rounded px-2 py-1 hover:border-cyan-500/40 hover:text-cyan-400 transition-all duration-100 cursor-pointer">
            <IcKey/> {keySaved ? 'Edit Key' : 'Set Key'}
          </button>
        </div>
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">

        {/* SIDEBAR */}
        <aside className="w-[320px] shrink-0 border-r border-white/[0.06] bg-[#09091b] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2">

            {/* Upload */}
            <div className="bg-[#0e0e1f] border border-white/[0.06] rounded-lg p-2.5">
              <p className="text-[8.5px] font-semibold tracking-[0.12em] uppercase text-slate-600 mb-2 flex items-center gap-1"><IcUpload/> Screenshot</p>
              <div
                onDrop={onDrop} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
                onClick={()=>fileRef.current?.click()}
                className={`border-2 border-dashed rounded cursor-pointer transition-all duration-150 flex flex-col items-center justify-center gap-1.5
                  ${dragOver?'border-cyan-400/50 bg-cyan-950/20':imgUrl?'border-white/[0.08] p-2':'border-white/[0.08] p-3 min-h-[80px]'}
                  hover:border-cyan-500/40`}
              >
                {imgUrl ? (
                  <><img src={imgUrl} alt="" className="w-full rounded max-h-36 object-contain"/><span className="text-[8px] text-slate-700">Click / drop to replace</span></>
                ) : (
                  <div className="text-center"><div className="text-slate-700 flex justify-center mb-1"><IcUpload/></div><p className="text-[10px] text-slate-500">Drop UI screenshot</p><p className="text-[8px] text-slate-700 mt-0.5">PNG · JPG · WEBP</p></div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)processImage(f);}}/>
              {extracting && <div className="flex items-center gap-1.5 mt-2 text-[9.5px] text-cyan-400"><Spinner/> Extracting…</div>}
            </div>

            {/* Color Data */}
            {colorData && (
              <div className="bg-[#0e0e1f] border border-white/[0.06] rounded-lg p-2.5">
                <div className="flex items-center mb-2">
                  <span className="text-[8.5px] font-semibold tracking-[0.1em] uppercase text-slate-600 flex items-center gap-1"><IcPalette/> Colors</span>
                  <span className="ml-auto text-[8px] text-cyan-700">{colorData.totalSampled.toLocaleString()}px · {colorData.dominantPalette.length}</span>
                </div>
                <div className="flex flex-wrap gap-[2.5px] mb-2">
                  {colorData.dominantPalette.slice(0,32).map((c,i)=>(
                    <div key={i} className="w-[14px] h-[14px] rounded-[2px] border border-white/[0.07] cursor-pointer hover:scale-[1.6] transition-transform duration-100 shrink-0" style={{backgroundColor:c.hex}} title={`${c.hex} freq:${c.count}px`}/>
                  ))}
                </div>
                <div className="grid grid-cols-6 gap-[1.5px]">
                  {colorData.zones.map((z,i)=>(
                    <div key={i} className="aspect-square rounded-[1.5px] cursor-pointer hover:scale-125 transition-transform duration-100" style={{backgroundColor:z.dominant}} title={`[${z.row},${z.col}] ${z.name}\n${z.colors.join(' · ')}`}/>
                  ))}
                </div>
                <p className="text-[7.5px] text-slate-700 mt-1">{colorData.imageWidth}×{colorData.imageHeight}px</p>
              </div>
            )}

            {/* Libraries indicator */}
            <div className="bg-[#0e0e1f] border border-violet-900/20 rounded-lg p-2.5">
              <p className="text-[8.5px] font-semibold tracking-[0.1em] uppercase text-violet-500 mb-1.5">Auto-detected libraries</p>
              <div className="flex flex-col gap-1">
                {[
                  ['GSAP 3.12', 'Animations & scroll triggers', 'violet'],
                  ['CSS 3D + blend', 'Perspective, mix-blend-mode', 'cyan'],
                  ['Three.js r128', 'WebGL scenes (if needed)', 'slate'],
                  ['Tabler Icons', 'UI icons (exact match)', 'slate'],
                  ['Google Favicon', 'Brand logos via API', 'slate'],
                  ['AOS', 'Scroll reveal (if needed)', 'slate'],
                ].map(([name, desc, color]) => (
                  <div key={name} className="flex items-start gap-1.5">
                    <span className={`text-[8px] font-mono ${color==='violet'?'text-violet-400':color==='cyan'?'text-cyan-400':'text-slate-600'} shrink-0 mt-px`}>›</span>
                    <div><span className={`text-[8.5px] ${color==='violet'?'text-violet-300':color==='cyan'?'text-cyan-300':'text-slate-500'}`}>{name}</span><span className="text-[7.5px] text-slate-700 ml-1">{desc}</span></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="bg-[#0e0e1f] border border-white/[0.06] rounded-lg p-2.5">
              <p className="text-[8.5px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1.5">Prompt</p>
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4}
                className="w-full bg-[#09091b] border border-white/[0.06] rounded text-slate-300 font-mono text-[10px] p-2 outline-none leading-relaxed resize-y focus:border-cyan-500/40 transition-colors duration-100 placeholder:text-slate-700"/>
            </div>

            {error && <div className="bg-red-950/30 border border-red-900/30 rounded-md px-2.5 py-2 text-[9.5px] text-red-400 leading-relaxed">{error}</div>}

            {/* Generate */}
            <button onClick={generate} disabled={generating||!imgB64}
              className={`w-full py-2.5 rounded-lg font-bold text-[11.5px] tracking-wide flex items-center justify-center gap-1.5 transition-all duration-150
                ${generating||!imgB64?'bg-cyan-950/20 border border-cyan-900/20 text-cyan-800 cursor-not-allowed':'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black shadow-[0_0_18px_rgba(0,229,255,0.2)] hover:shadow-[0_0_32px_rgba(0,229,255,0.4)] hover:-translate-y-px cursor-pointer'}`}>
              {generating?<><Spinner/><span className="text-cyan-400 text-[10px]">{progress||'Analyzing…'}</span></>:<><IcZap/> Generate Pixel-Perfect UI</>}
            </button>

            {code && (
              <div className="flex gap-2.5 text-[8.5px] text-slate-700 pl-0.5">
                <span className="text-emerald-600">✓ Ready</span>
                <span>{(code.length/1024).toFixed(1)} KB</span>
                <span>{code.split('\n').length} lines</span>
              </div>
            )}
          </div>
        </aside>

        {/* PREVIEW PANE */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Tab bar */}
          <div className="flex items-center h-9 px-3 gap-0.5 border-b border-white/[0.06] bg-[#09091b] shrink-0">
            {(['preview','code'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                className={`flex items-center gap-1 px-2.5 h-full text-[9.5px] font-medium tracking-[0.1em] uppercase border-b-2 transition-all duration-100 cursor-pointer
                  ${tab===t?'border-cyan-400 text-cyan-400':'border-transparent text-slate-600 hover:text-slate-400'}`}>
                {t==='preview'?<IcEye/>:<IcCode/>}{t}
              </button>
            ))}

            {code && (
              <div className="ml-auto flex items-center gap-1">
                {/* OPEN IN NEW TAB */}
                <button onClick={()=>openInTab(code)}
                  className="flex items-center gap-1 text-[9px] border border-violet-800/40 text-violet-400 rounded px-2 py-1 hover:border-violet-500/60 hover:text-violet-300 hover:bg-violet-950/30 transition-all duration-100 cursor-pointer font-medium">
                  <IcExternalLink/> Open in tab
                </button>
                <button onClick={copyCode}
                  className={`flex items-center gap-1 text-[9px] border rounded px-2 py-1 transition-all duration-100 cursor-pointer
                    ${copied?'border-emerald-800 text-emerald-400':'border-white/[0.08] text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400'}`}>
                  {copied?<><IcCheck/>Copied</>:<><IcCopy/>Copy</>}
                </button>
                <button onClick={downloadCode}
                  className="flex items-center gap-1 text-[9px] border border-white/[0.08] text-slate-500 rounded px-2 py-1 hover:border-emerald-700/40 hover:text-emerald-400 transition-all duration-100 cursor-pointer">
                  <IcDownload/>.html
                </button>
                <button onClick={()=>setCode('')}
                  className="flex items-center text-[9px] border border-white/[0.08] text-slate-700 rounded px-1.5 py-1 hover:border-red-900/40 hover:text-red-400 transition-all duration-100 cursor-pointer">
                  <IcX/>
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          {tab==='preview' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {code
                ? <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    className="flex-1 border-none w-full" style={{background:'white'}} title="Result"/>
                : <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-700">
                    {generating
                      ? <div className="text-center"><Spinner size="lg"/><p className="text-[11px] text-cyan-400 mt-3">{progress}</p><p className="text-[9px] text-slate-700 mt-1">Measuring every pixel…</p></div>
                      : <><div className="text-[50px] opacity-[0.04]">⬡</div><div className="text-center"><p className="text-[11px] text-slate-600">Upload a screenshot to start</p><p className="text-[9px] text-slate-700 mt-1">GSAP · CSS 3D · blend modes · full-width output</p></div></>
                    }
                  </div>
              }
            </div>
          )}

          {/* Code */}
          {tab==='code' && (
            <div className="flex-1 overflow-auto p-3.5">
              {code
                ? <pre className="text-[10px] leading-[1.8] text-[#c8d3f5] whitespace-pre-wrap break-words font-mono">{code}</pre>
                : <div className="h-full flex items-center justify-center text-slate-700 text-[11px]">No code yet.</div>
              }
            </div>
          )}
        </div>
      </div>

      {/* API KEY MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          onClick={e=>{if(e.target===e.currentTarget&&keySaved)setShowModal(false);}}>
          <div className="w-full max-w-[400px] bg-[#0e0e1f] border border-white/[0.08] rounded-xl p-5 shadow-[0_0_50px_rgba(0,229,255,0.05),0_20px_50px_rgba(0,0,0,0.8)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-cyan-400"><IcKey/></span>
              <h2 className="text-[14px] font-black bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent" style={{fontFamily:'system-ui'}}>Gemini API Key</h2>
              {keySaved&&<button onClick={()=>setShowModal(false)} className="ml-auto text-slate-600 hover:text-slate-300 cursor-pointer"><IcX/></button>}
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-2 mb-3.5">
              Stored only in <strong className="text-slate-300">IndexedDB</strong>. Sent only to Google&apos;s Gemini API.{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Get key →</a>
            </p>
            <label className="block text-[8.5px] font-semibold tracking-[0.12em] uppercase text-slate-600 mb-1.5">API Key</label>
            <input type="password" autoFocus value={tempKey} onChange={e=>setTempKey(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveKey()} placeholder="AIzaSy…"
              className="w-full bg-[#09091b] border border-white/[0.07] rounded-md text-slate-200 font-mono text-[12px] px-3 py-2.5 outline-none mb-3.5 focus:border-cyan-500/40 transition-colors duration-150 placeholder:text-slate-700"/>
            <div className="flex gap-2">
              <button onClick={saveKey} disabled={!tempKey.trim()}
                className={`flex-1 py-2.5 rounded-md text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150
                  ${tempKey.trim()?'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black cursor-pointer hover:shadow-[0_0_24px_rgba(0,229,255,0.35)]':'bg-cyan-950/20 border border-cyan-900/20 text-cyan-800 cursor-not-allowed'}`}>
                <IcCheck/> Save to IndexedDB
              </button>
              {keySaved&&<button onClick={()=>setShowModal(false)} className="px-3.5 py-2.5 border border-white/[0.07] text-slate-500 rounded-md text-[10.5px] hover:border-white/20 transition-colors cursor-pointer">Cancel</button>}
            </div>
            <div className="mt-3 flex items-start gap-1.5 bg-emerald-950/25 border border-emerald-900/20 rounded-md px-2.5 py-2 text-[9px] text-slate-500 leading-relaxed">
              <span className="text-emerald-500 shrink-0">🔒</span>
              IndexedDB only — never logged or shared. Edit anytime via header.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
