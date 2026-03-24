'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

/* ================================================================
   TYPES
================================================================ */
interface ColorInfo {
  hex: string; r: number; g: number; b: number;
  count: number; xPercent: number; yPercent: number;
}
interface ColorZone {
  name: string; row: number; col: number;
  dominant: string; colors: string[];
}
interface ExtractedColorData {
  dominantPalette: ColorInfo[];
  zones: ColorZone[];
  imageWidth: number;
  imageHeight: number;
  totalSampled: number;
}

/* ================================================================
   INDEXEDDB
================================================================ */
const DB_NAME = 'pixelperfect-v1';
const STORE_NAME = 'config';

async function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  });
}
async function dbSet(key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

/* ================================================================
   CANVAS COLOR EXTRACTION ENGINE
================================================================ */
function extractColors(canvas: HTMLCanvasElement, img: HTMLImageElement): ExtractedColorData {
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const STEP = 3;
  const QUANT = 8;
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const mkHex = (r: number, g: number, b: number) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  const cmap = new Map<string, { r: number; g: number; b: number; count: number; x: number; y: number }>();
  let totalSampled = 0;

  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 20) continue;
      const qr = Math.round(r / QUANT) * QUANT;
      const qg = Math.round(g / QUANT) * QUANT;
      const qb = Math.round(b / QUANT) * QUANT;
      const k = `${qr}|${qg}|${qb}`;
      if (cmap.has(k)) { cmap.get(k)!.count++; }
      else { cmap.set(k, { r: qr, g: qg, b: qb, count: 1, x, y }); }
      totalSampled++;
    }
  }

  const dominantPalette: ColorInfo[] = Array.from(cmap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 64)
    .map(v => ({
      hex: mkHex(v.r, v.g, v.b),
      r: v.r, g: v.g, b: v.b, count: v.count,
      xPercent: Math.round((v.x / width) * 100),
      yPercent: Math.round((v.y / height) * 100),
    }));

  const COLS = 6, ROWS = 6;
  const zw = Math.floor(width / COLS);
  const zh = Math.floor(height / ROWS);
  const ZQUANT = 16;
  const rowL = ['top', 'upper', 'mid-upper', 'mid-lower', 'lower', 'bottom'];
  const colL = ['far-left', 'ctr-left', 'near-left', 'near-right', 'ctr-right', 'far-right'];

  const zones: ColorZone[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * zw, y0 = row * zh;
      const x1 = Math.min(x0 + zw, width), y1 = Math.min(y0 + zh, height);
      const zm = new Map<string, number>();
      for (let y = y0; y < y1; y += STEP) {
        for (let x = x0; x < x1; x += STEP) {
          const i = (y * width + x) * 4;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
          if (a < 20) continue;
          const h = mkHex(
            Math.round(r / ZQUANT) * ZQUANT,
            Math.round(g / ZQUANT) * ZQUANT,
            Math.round(b / ZQUANT) * ZQUANT,
          );
          zm.set(h, (zm.get(h) ?? 0) + 1);
        }
      }
      const top = Array.from(zm.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
      zones.push({ name: `${rowL[row]}_${colL[col]}`, row, col, dominant: top[0] ?? '#000', colors: top });
    }
  }
  return { dominantPalette, zones, imageWidth: width, imageHeight: height, totalSampled };
}

/* ================================================================
   GEMINI SYSTEM PROMPT
================================================================ */
const SYSTEM_PROMPT = `You are the world's most elite pixel-perfect UI engineer — a fusion of visual forensics expert, master CSS craftsman, and design archaeologist. Your mission: reproduce any web interface from a screenshot with ABSOLUTE, SURGICAL, PIXEL-PERFECT FIDELITY.

══════════════════════════════════════════════════════
MANDATORY ANALYSIS PROTOCOL — EXECUTE EVERY PHASE
══════════════════════════════════════════════════════

▸ PHASE 1 — MACRO STRUCTURAL ANALYSIS
  • Identify layout paradigm: sidebar+main, hero page, dashboard, SaaS app, landing page, etc.
  • Map the exact grid system: columns, gutters, container max-width, centering strategy
  • Identify every major section: header, nav, hero, features, footer, sidebar, main area
  • Estimate every width, height, padding, margin, gap value (in px or rem)
  • Detect flexbox vs CSS Grid patterns per container
  • Note any sticky/fixed/absolute elements, overlays, dropdowns

▸ PHASE 2 — TYPOGRAPHY FORENSICS
  • Identify all font families (use closest Google Font if exact font unknown)
  • Document font sizes for ALL text roles: display, h1–h6, body, small, label, caption, badge, tooltip
  • Extract every font weight used (100–900 scale)
  • Measure line-height and letter-spacing for each text style
  • Detect text-transform, text-decoration, word-spacing
  • Map ALL text colors to the provided canvas-extracted hex values

▸ PHASE 3 — COLOR SYSTEM REVERSE-ENGINEERING
  ⚠ CRITICAL: Use ONLY the canvas-extracted hex values from the provided data below.
  These are pixel-accurate values extracted directly via the browser Canvas API.
  NEVER approximate or guess colors — use the exact hex codes provided.
  • Map each color to its semantic role: bg, surface, primary, accent, text, border, shadow, overlay
  • Detect gradient directions and color stops using the extracted values
  • Identify background patterns, textures, noise, glass-morphism effects

▸ PHASE 4 — COMPONENT DEEP DISSECTION
  Forensically document EVERY UI component:
  BUTTONS: padding (v/h exact), border-radius, border, bg, font-size, font-weight, letter-spacing, text-transform, box-shadow, transition
  INPUTS/FORMS: height, padding, border, border-radius, bg, placeholder color, label placement, focus ring
  CARDS/PANELS: bg, border-radius, border style, box-shadow (FULL: offset-x offset-y blur spread color), padding, overflow, backdrop-filter
  NAVIGATION: height, bg, logo area, nav-item spacing, active/hover states, borders, shadows
  BADGES/PILLS/TAGS: exact padding, border-radius, font-size, font-weight, bg, color, border
  TABLES: border types, cell padding, row striping, header styling
  ICONS: pixel size, color, stroke vs fill, surrounding spacing

▸ PHASE 5 — DEPTH & ATMOSPHERIC EFFECTS
  • Every box-shadow: measure all layers (multiple shadows per element possible)
  • backdrop-filter: blur(Xpx) brightness(X) saturate(X)
  • Opacity values for layered elements
  • Specific border-radius per corner if asymmetric
  • Hover / active / focus states inferred from visual context
  • Transition timing and easing

▸ PHASE 6 — COMPLETE CONTENT EXTRACTION
  • Extract ALL visible text verbatim (every heading, paragraph, label, button text)
  • Identify all icons (describe as: chevron-down, search, user-circle, home, etc.)
  • Map image/media placeholder areas with aspect-ratios
  • List every interactive element and its label

══════════════════════════════════════════════════════
CODE GENERATION — ABSOLUTE REQUIREMENTS
══════════════════════════════════════════════════════
Produce ONE complete, self-contained, immediately-renderable HTML file:
1.  Full <!DOCTYPE html>…</html> — NEVER truncate, NEVER use placeholders
2.  ALL fonts imported via Google Fonts <link> or @import
3.  CSS custom properties (--var) for the entire color system using EXACT extracted hex values
4.  Include Tailwind CDN via <script src="https://cdn.tailwindcss.com"></script>
5.  ALL visible text content reproduced verbatim
6.  ALL shadows, gradients, border-radius, typography — exact values
7.  Icons reproduced as inline SVG paths
8.  Responsive if original appears responsive
9.  Standalone — renders perfectly at 100% zoom in an iframe with zero dependencies
10. If the UI uses glassmorphism, dark theme, or special backgrounds — replicate them exactly

CRITICAL OUTPUT RULE:
Return ONLY the raw HTML. Start: <!DOCTYPE html>  End: </html>
Zero markdown. Zero backticks. Zero explanation. Pure HTML only.`;

/* ================================================================
   GEMINI API CALL
================================================================ */
async function callGemini(
  apiKey: string,
  userMsg: string,
  imageB64: string,
  mimeType: string,
  cd: ExtractedColorData,
  onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Sending image + color matrix to Gemini...');

  const colorPrompt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 CANVAS PIXEL-EXTRACTED COLOR DATA
 (Direct from image pixels via Canvas API — ZERO approximation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE: ${cd.imageWidth}×${cd.imageHeight}px  |  SAMPLED: ${cd.totalSampled.toLocaleString()} pixels

── TOP ${Math.min(cd.dominantPalette.length, 48)} DOMINANT COLORS (by pixel frequency) ──
${cd.dominantPalette.slice(0, 48).map((c, i) =>
    `  ${String(i + 1).padStart(2, ' ')}. ${c.hex}  rgb(${c.r},${c.g},${c.b})  freq:${c.count.toLocaleString()}px  position:(${c.xPercent}%x, ${c.yPercent}%y)`
  ).join('\n')}

── SPATIAL ZONE MAP (6×6 grid = 36 zones, [row,col] 0-indexed) ──
${cd.zones.map(z =>
    `  [${z.row},${z.col}] ${z.name.padEnd(24)}  dominant:${z.dominant}  palette:[${z.colors.join(', ')}]`
  ).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER INSTRUCTION:
${userMsg}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: imageB64 } },
            { text: colorPrompt },
          ],
        }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 65536, topK: 5, topP: 0.92 },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Gemini API Error ${resp.status}`);
  }

  onProgress('Parsing generated code...');
  const data = await resp.json();
  const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const htmlMatch = raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i);
  if (htmlMatch) return htmlMatch[0];
  const fence = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return raw.trim();
}

/* ================================================================
   ICONS
================================================================ */
function IconKey() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconCode() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  );
}
function IconCopy() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconZap() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/* ================================================================
   SPINNER COMPONENT
================================================================ */
function Spinner({ size = 'sm', pulse = false }: { size?: 'sm' | 'lg'; pulse?: boolean }) {
  const dim = size === 'lg' ? 'w-12 h-12 border-[3px]' : 'w-3.5 h-3.5 border-2';
  return (
    <div
      className={`${dim} rounded-full border-cyan-500/20 border-t-cyan-400 animate-spin ${pulse ? 'animate-pulse' : ''}`}
    />
  );
}

/* ================================================================
   MAIN PAGE
================================================================ */
export default function PixelPerfectAI() {
  const [apiKey, setApiKey]             = useState('');
  const [tempKey, setTempKey]           = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keySaved, setKeySaved]         = useState(false);
  const [copied, setCopied]             = useState(false);

  const [imgUrl, setImgUrl]       = useState('');
  const [imgB64, setImgB64]       = useState('');
  const [imgMime, setImgMime]     = useState('');
  const [colorData, setColorData] = useState<ExtractedColorData | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver]   = useState(false);

  const [prompt, setPrompt] = useState(
    "Reproduis cette interface web au pixel perfect. Analyse exhaustivement chaque détail visuel — layout exact, typographie précise, couleurs canvas pixel-exactes, ombres, espacements, effets — et génère le HTML/CSS complet fidèle à 100%."
  );
  const [generating, setGenerating] = useState(false);
  const [code, setCode]             = useState('');
  const [error, setError]           = useState('');
  const [progress, setProgress]     = useState('');
  const [tab, setTab]               = useState<'preview' | 'code'>('preview');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    dbGet('gemini_key').then(k => {
      if (k) { setApiKey(k); setTempKey(k); setKeySaved(true); }
      else { setShowKeyModal(true); }
    });
  }, []);

  useEffect(() => {
    if (!code) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) return;
    doc.open(); doc.write(code); doc.close();
  }, [code]);

  const saveKey = async () => {
    if (!tempKey.trim()) return;
    await dbSet('gemini_key', tempKey.trim());
    setApiKey(tempKey.trim()); setKeySaved(true); setShowKeyModal(false);
  };

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setExtracting(true); setColorData(null); setError('');
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const reader = new FileReader();
    reader.onload = e => {
      const res = e.target?.result as string;
      setImgB64(res.split(',')[1]); setImgMime(file.type);
    };
    reader.readAsDataURL(file);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (canvasRef.current) {
        try { setColorData(extractColors(canvasRef.current, img)); }
        catch (e) { console.error('Extraction error', e); }
      }
      setExtracting(false);
    };
    img.onerror = () => setExtracting(false);
    img.src = url;
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processImage(f);
  };

  const generate = async () => {
    if (!apiKey) { setShowKeyModal(true); return; }
    if (!imgB64) { setError('⚠ Upload a screenshot first.'); return; }
    if (!colorData) { setError('⚠ Color extraction still running…'); return; }
    setGenerating(true); setError(''); setCode('');
    try {
      const html = await callGemini(apiKey, prompt, imgB64, imgMime, colorData, setProgress);
      setCode(html); setTab('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred.');
    } finally {
      setGenerating(false); setProgress('');
    }
  };

  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const downloadCode = () => {
    if (!code) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code], { type: 'text/html' }));
    a.download = 'pixel-perfect.html';
    a.click();
  };

  /* ── RENDER ── */
  return (
    <div className="flex flex-col h-screen bg-[#06060e] text-slate-200 font-mono overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* ══ HEADER ══ */}
      <header className="flex items-center justify-between px-5 h-14 border-b border-slate-800/60 bg-[#07070f]/90 backdrop-blur-xl shrink-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center text-base shadow-[0_0_20px_rgba(0,229,255,0.3)] shrink-0">
            ⬡
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-tight bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent leading-none" style={{ fontFamily: 'system-ui' }}>
              PIXEL PERFECT AI
            </p>
            <p className="text-[9px] text-slate-600 tracking-widest mt-0.5">
              GEMINI · CANVAS COLOR ENGINE · PIXEL FIDELITY
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {keySaved && (
            <span className="flex items-center gap-1.5 text-[9.5px] text-emerald-400 tracking-widest bg-emerald-950/60 border border-emerald-900/50 rounded-full px-3 py-1">
              <IconCheck /> KEY ACTIVE
            </span>
          )}
          <button
            onClick={() => { setTempKey(apiKey); setShowKeyModal(true); }}
            className="flex items-center gap-1.5 text-[11px] text-slate-400 border border-slate-700/60 rounded-md px-3 py-1.5 hover:border-cyan-500/60 hover:text-cyan-400 transition-all duration-150"
          >
            <IconKey /> {keySaved ? 'Edit API Key' : 'Set API Key'}
          </button>
        </div>
      </header>

      {/* ══ BODY ══ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═ LEFT SIDEBAR ═ */}
        <aside className="w-[370px] shrink-0 border-r border-slate-800/60 bg-[#0b0b18] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-3">

            {/* Image Upload */}
            <div className="bg-[#111120] border border-slate-800/60 rounded-xl p-3.5">
              <p className="text-[9.5px] font-semibold tracking-widest uppercase text-slate-600 mb-2.5 flex items-center gap-1.5">
                <IconUpload /> Screenshot Upload
              </p>
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 
                  ${dragOver ? 'border-cyan-400 bg-cyan-950/30' : imgUrl ? 'border-slate-600 p-2.5' : 'border-slate-700/60 p-5 min-h-[110px]'}
                  hover:border-cyan-500/50`}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt="" className="w-full rounded max-h-44 object-contain" />
                    <span className="text-[9px] text-slate-600">Click / drop to replace</span>
                  </>
                ) : (
                  <>
                    <div className="text-slate-700"><IconUpload /></div>
                    <div className="text-center">
                      <p className="text-xs text-slate-400">Drop your UI screenshot</p>
                      <p className="text-[9.5px] text-slate-600 mt-1">PNG · JPG · WEBP · from your device</p>
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processImage(f); }}
              />
              {extracting && (
                <div className="flex items-center gap-2 mt-2.5 text-[11px] text-cyan-400">
                  <Spinner /> Extracting pixel colors from canvas…
                </div>
              )}
            </div>

            {/* Color Data */}
            {colorData && (
              <div className="bg-[#111120] border border-slate-800/60 rounded-xl p-3.5 animate-[fadeIn_0.3s_ease]">
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-[9.5px] font-semibold tracking-widest uppercase text-slate-600 flex items-center gap-1.5">
                    <IconStar /> Extracted Color Data
                  </span>
                  <span className="ml-auto text-[9px] text-cyan-500">
                    {colorData.totalSampled.toLocaleString()}px · {colorData.dominantPalette.length} colors
                  </span>
                </div>

                <div className="mb-3">
                  <p className="text-[8.5px] uppercase tracking-widest text-slate-700 mb-1.5">Dominant palette</p>
                  <div className="flex flex-wrap gap-1">
                    {colorData.dominantPalette.slice(0, 40).map((c, i) => (
                      <div
                        key={i}
                        className="w-4 h-4 rounded-[3px] border border-white/10 cursor-pointer hover:scale-150 transition-transform duration-150 shrink-0"
                        style={{ backgroundColor: c.hex }}
                        title={`${c.hex}\nrgb(${c.r},${c.g},${c.b})\nfreq:${c.count}px\npos:(${c.xPercent}%,${c.yPercent}%)`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[8.5px] uppercase tracking-widest text-slate-700 mb-1.5">Spatial zone map (6×6)</p>
                  <div className="grid grid-cols-6 gap-0.5">
                    {colorData.zones.map((z, i) => (
                      <div
                        key={i}
                        className="aspect-square rounded-sm cursor-pointer hover:scale-125 hover:z-10 transition-transform duration-150 relative"
                        style={{ backgroundColor: z.dominant }}
                        title={`[${z.row},${z.col}] ${z.name}\n${z.colors.join(' · ')}`}
                      />
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-700 mt-1.5">
                    {colorData.imageWidth}×{colorData.imageHeight}px — hover cells to inspect
                  </p>
                </div>
              </div>
            )}

            {/* Prompt */}
            <div className="bg-[#111120] border border-slate-800/60 rounded-xl p-3.5">
              <p className="text-[9.5px] font-semibold tracking-widest uppercase text-slate-600 mb-2">
                Instruction Prompt
              </p>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={5}
                className="w-full bg-[#0b0b18] border border-slate-800/60 rounded-md text-slate-200 font-mono text-[11.5px] p-2.5 outline-none leading-relaxed resize-y focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all duration-150 placeholder:text-slate-700"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 text-[11px] text-red-400 leading-relaxed">
                {error}
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={generate}
              disabled={generating || !imgB64}
              className={`w-full py-3.5 rounded-lg font-bold text-[13px] tracking-wide flex items-center justify-center gap-2 transition-all duration-200
                ${generating || !imgB64
                  ? 'bg-cyan-950/30 border border-cyan-900/30 text-cyan-700 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black hover:shadow-[0_0_40px_rgba(0,229,255,0.4)] hover:-translate-y-px cursor-pointer shadow-[0_0_24px_rgba(0,229,255,0.2)]'
                }`}
            >
              {generating ? (
                <>
                  <Spinner pulse />
                  <span className="text-cyan-400">{progress || 'Generating…'}</span>
                </>
              ) : (
                <><IconZap /> Generate Pixel-Perfect UI</>
              )}
            </button>

            {/* Stats */}
            {code && (
              <div className="flex gap-3.5 text-[9.5px] text-slate-600 pl-0.5 animate-[fadeIn_0.3s_ease]">
                <span className="text-emerald-500">✓ Ready</span>
                <span>{(code.length / 1024).toFixed(1)} KB</span>
                <span>{code.split('\n').length} lines</span>
                <span>{colorData?.dominantPalette.length} colors used</span>
              </div>
            )}
          </div>
        </aside>

        {/* ═ RIGHT PREVIEW PANE ═ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#06060e]">

          {/* Tab bar */}
          <div className="flex items-center h-10 px-4 gap-0.5 border-b border-slate-800/60 bg-[#0b0b18] shrink-0">
            {(['preview', 'code'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3.5 h-full text-[10.5px] font-medium tracking-widest uppercase border-b-2 transition-all duration-150 cursor-pointer
                  ${tab === t
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-transparent text-slate-600 hover:text-slate-300'
                  }`}
              >
                {t === 'preview' ? <IconEye /> : <IconCode />}{t}
              </button>
            ))}

            {code && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-1.5 text-[10px] border rounded-md px-2.5 py-1 transition-all duration-150 cursor-pointer
                    ${copied ? 'border-emerald-700 text-emerald-400' : 'border-slate-700/60 text-slate-400 hover:border-cyan-500/50 hover:text-cyan-400'}`}
                >
                  {copied ? <><IconCheck />Copied!</> : <><IconCopy />Copy HTML</>}
                </button>
                <button
                  onClick={downloadCode}
                  className="flex items-center gap-1.5 text-[10px] border border-slate-700/60 text-slate-400 rounded-md px-2.5 py-1 hover:border-emerald-600/50 hover:text-emerald-400 transition-all duration-150 cursor-pointer"
                >
                  <IconDownload /> Download
                </button>
                <button
                  onClick={() => setCode('')}
                  className="flex items-center text-[10px] border border-slate-700/60 text-slate-600 rounded-md px-2 py-1 hover:border-red-800/50 hover:text-red-400 transition-all duration-150 cursor-pointer"
                >
                  <IconX />
                </button>
              </div>
            )}
          </div>

          {/* Preview iframe */}
          {tab === 'preview' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {code ? (
                <iframe
                  ref={iframeRef}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="flex-1 border-none bg-white w-full"
                  title="Pixel Perfect Result"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-700">
                  {generating ? (
                    <div className="text-center animate-[fadeIn_0.3s_ease]">
                      <Spinner size="lg" />
                      <p className="text-sm text-cyan-400 mt-4">{progress}</p>
                      <p className="text-[9.5px] text-slate-600 mt-1">Gemini is analyzing every pixel of your screenshot…</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-[56px] opacity-5">⬡</div>
                      <div className="text-center leading-loose">
                        <p className="text-sm text-slate-500">Upload a UI screenshot</p>
                        <p className="text-[11px] text-slate-700 mt-1">
                          Canvas will extract all colors at exact positions<br />
                          Gemini will reproduce it pixel-perfect
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Code view */}
          {tab === 'code' && (
            <div className="flex-1 overflow-auto p-4 bg-[#06060e]">
              {code ? (
                <pre className="text-[11px] leading-7 text-[#c8d3f5] whitespace-pre-wrap break-words font-mono animate-[fadeIn_0.3s_ease]">
                  {code}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-700 text-xs">
                  No code generated yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ API KEY MODAL ══ */}
      {showKeyModal && (
        <div
          className="fixed inset-0 z-50 bg-[#04040e]/90 backdrop-blur-lg flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget && keySaved) setShowKeyModal(false); }}
        >
          <div className="w-full max-w-md bg-[#111120] border border-slate-700/60 rounded-2xl p-7 shadow-[0_0_80px_rgba(0,229,255,0.07),0_30px_80px_rgba(0,0,0,0.7)] animate-[fadeIn_0.25s_ease]">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-cyan-400"><IconKey /></span>
              <h2 className="text-base font-extrabold bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: 'system-ui' }}>
                Gemini API Key
              </h2>
              {keySaved && (
                <button onClick={() => setShowKeyModal(false)} className="ml-auto text-slate-600 hover:text-slate-300 transition-colors cursor-pointer">
                  <IconX />
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed mt-3 mb-5">
              Your key is stored exclusively in your browser&apos;s{' '}
              <strong className="text-slate-200">IndexedDB</strong> — never sent anywhere except directly to Google&apos;s Gemini API.
              Get yours free at{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                aistudio.google.com
              </a>
            </p>

            <label className="block text-[9.5px] font-semibold tracking-widest uppercase text-slate-600 mb-1.5">
              API Key
            </label>
            <input
              type="password"
              autoFocus
              value={tempKey}
              onChange={e => setTempKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()}
              placeholder="AIzaSy…"
              className="w-full bg-[#0b0b18] border border-slate-700/60 rounded-lg text-slate-200 font-mono text-[13px] px-3.5 py-2.5 outline-none mb-4 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/15 transition-all duration-150 placeholder:text-slate-700"
            />

            <div className="flex gap-2.5">
              <button
                onClick={saveKey}
                disabled={!tempKey.trim()}
                className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer
                  ${tempKey.trim()
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black shadow-[0_0_22px_rgba(0,229,255,0.2)] hover:shadow-[0_0_36px_rgba(0,229,255,0.4)]'
                    : 'bg-cyan-950/30 border border-cyan-900/30 text-cyan-800 cursor-not-allowed'
                  }`}
              >
                <IconCheck /> Save to IndexedDB
              </button>
              {keySaved && (
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2.5 bg-transparent border border-slate-700/60 text-slate-400 rounded-lg text-xs hover:border-slate-500 transition-all duration-150 cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="mt-4 flex items-start gap-2 bg-emerald-950/40 border border-emerald-900/30 rounded-lg px-3 py-2.5 text-[10px] text-slate-400 leading-relaxed">
              <span className="text-emerald-400 shrink-0 mt-0.5">🔒</span>
              Stored locally in IndexedDB — editable anytime via the header button. Never shared with any server other than Gemini.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
