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
   CANVAS COLOR EXTRACTION
================================================================ */
function extractColors(canvas: HTMLCanvasElement, img: HTMLImageElement): ExtractedColorData {
  const ctx = canvas.getContext('2d')!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const STEP = 3, QUANT = 8;
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const mkHex = (r: number, g: number, b: number) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  const cmap = new Map<string, { r: number; g: number; b: number; count: number; x: number; y: number }>();
  let totalSampled = 0;
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 20) continue;
      const qr = Math.round(r / QUANT) * QUANT, qg = Math.round(g / QUANT) * QUANT, qb = Math.round(b / QUANT) * QUANT;
      const k = `${qr}|${qg}|${qb}`;
      if (cmap.has(k)) cmap.get(k)!.count++;
      else cmap.set(k, { r: qr, g: qg, b: qb, count: 1, x, y });
      totalSampled++;
    }
  }
  const dominantPalette: ColorInfo[] = Array.from(cmap.values())
    .sort((a, b) => b.count - a.count).slice(0, 64)
    .map(v => ({ hex: mkHex(v.r, v.g, v.b), r: v.r, g: v.g, b: v.b, count: v.count, xPercent: Math.round((v.x / width) * 100), yPercent: Math.round((v.y / height) * 100) }));
  const COLS = 6, ROWS = 6, zw = Math.floor(width / COLS), zh = Math.floor(height / ROWS), ZQUANT = 16;
  const rowL = ['top', 'upper', 'mid-upper', 'mid-lower', 'lower', 'bottom'];
  const colL = ['far-left', 'ctr-left', 'near-left', 'near-right', 'ctr-right', 'far-right'];
  const zones: ColorZone[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = col * zw, y0 = row * zh, x1 = Math.min(x0 + zw, width), y1 = Math.min(y0 + zh, height);
      const zm = new Map<string, number>();
      for (let y = y0; y < y1; y += STEP)
        for (let x = x0; x < x1; x += STEP) {
          const i = (y * width + x) * 4;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
          if (a < 20) continue;
          const h = mkHex(Math.round(r / ZQUANT) * ZQUANT, Math.round(g / ZQUANT) * ZQUANT, Math.round(b / ZQUANT) * ZQUANT);
          zm.set(h, (zm.get(h) ?? 0) + 1);
        }
      const top = Array.from(zm.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
      zones.push({ name: `${rowL[row]}_${colL[col]}`, row, col, dominant: top[0] ?? '#000', colors: top });
    }
  }
  return { dominantPalette, zones, imageWidth: width, imageHeight: height, totalSampled };
}

/* ================================================================
   SYSTEM PROMPT — MEASURE-FIRST APPROACH
================================================================ */
const SYSTEM_PROMPT = `You are a forensic UI reverse-engineering system. You work like a pixel-reading machine, not a designer. You do NOT interpret, improve, or stylize. You MEASURE and REPRODUCE.

══════════════════════════════════════════════════════════════
CRITICAL FAILURE MODES TO AVOID — YOU HAVE BEEN WARNED
══════════════════════════════════════════════════════════════

You tend to make these mistakes. Do NOT make them:

1. BADGE SYNDROME: Seeing "Finance" with a colored dot → you add a colored pill/badge background.
   REALITY: In most UIs it's just a colored dot (●) + plain text. NO background. NO padding. NO border-radius.
   FIX: Only add a badge background if you can clearly see a filled background shape around the text.

2. ICON SIZE INFLATION: You render icons at 20-24px when originals are 14-16px.
   FIX: Measure the icon height relative to the text. If icon ≈ text height → 14-16px. Never default to 20px+.

3. ROW HEIGHT INFLATION: You render table rows at 40-48px when originals are 28-36px.
   FIX: Count the rows visible and divide the table height. If 12 rows in 400px → ~33px per row.

4. BORDER-RADIUS CREEP: You add border-radius: 6-8px to everything.
   FIX: Most inputs, table cells, and containers in professional UIs have 0-4px radius. Measure it.
   A flat rectangular input is border-radius: 0 or 2px. Only round things that look visually round.

5. PADDING INFLATION: You add 12-16px padding where originals have 6-10px.
   FIX: If text appears close to the border → padding is 4-8px. If there's breathing room → 10-14px.

6. COLOR GUESSING: You use #e5e7eb when the real color is #f0f0f0 or #e8e8e8.
   FIX: Use ONLY the canvas-extracted hex values. Do not deviate by even one shade.

7. SPACING INFLATION: You add gap/margin-bottom of 16-24px between elements that have 8-12px in reality.
   FIX: Look at how much whitespace exists proportionally. If it's tight → 6-8px. If loose → 16-20px.

8. GENERIC ICONS: You use a blue video-camera for all file types.
   FIX: Look at each icon's actual color. Different file types have different icon colors. Reproduce each one.

9. FONT WEIGHT ERRORS: You use font-weight: 600 when the text appears to be 400 or 500.
   FIX: Only use 600+ if text appears clearly bold compared to surrounding text.

10. INVENTED SHADOWS: You add box-shadow to cards/panels that have none.
    FIX: Only add shadow if you can see a visible blurred edge around an element.

══════════════════════════════════════════════════════════════
ANALYSIS PROTOCOL — EXECUTE IN ORDER
══════════════════════════════════════════════════════════════

▸ STEP 1 — MEASURE BEFORE YOU CODE
  Before writing any HTML, derive these measurements from the image:

  LAYOUT:
  - Overall page width and main column widths (estimate as % or px)
  - Sidebar width if present (estimate px)
  - Header height if present (estimate px)

  TYPOGRAPHY per text role:
  - Body text: size, weight, color (canvas hex), line-height
  - Heading: size, weight, color
  - Label/caption: size, weight, color
  - Table cell text: size, weight, color
  - Muted/secondary text: size, weight, color

  SPACING SYSTEM:
  - Base unit (4px or 8px grid?)
  - Typical row height in tables/lists
  - Card internal padding
  - Gap between sidebar items

  COMPONENT SPECS:
  For EACH component type present, note:
  - border: width + style + exact color (canvas hex)
  - border-radius (0px? 2px? 4px? 6px? more?)
  - background color (canvas hex)
  - padding (top/right/bottom/left)
  - font-size and font-weight

▸ STEP 2 — COLOR MAPPING
  Using ONLY canvas-extracted colors:
  - Page background: ___
  - Sidebar background: ___
  - Card/panel background: ___
  - Border color: ___
  - Primary text: ___
  - Secondary text: ___
  - Accent/primary: ___
  - Success color: ___
  - Warning/danger: ___

▸ STEP 3 — COMPONENT INVENTORY
  List every distinct component type visible:
  - Navigation items (count, active style, hover style)
  - Badges/status indicators (dot only? filled pill? outline pill?)
  - Buttons (style, size, border-radius)
  - Input fields (height, border, radius, background)
  - Table (header style, row style, cell padding, borders)
  - Cards (border, radius, shadow? none?)
  - Icons (size relative to text, style: outline/filled)

▸ STEP 4 — ICON & LOGO RESOLUTION
  • Use Tabler Icons webfont (already imported via CDN):
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
    Usage: <i class="ti ti-home" style="font-size:16px;color:#555"></i>
    Find the best matching icon name from Tabler's library.

  • For brand/company logos (Netflix, Apple, Google Drive, Notion, Dropbox, etc.):
    <img src="https://www.google.com/s2/favicons?domain=DOMAIN&sz=32" style="width:16px;height:16px">
    Use sz=16, sz=32, or sz=64 depending on the displayed size.
    Examples:
    - Google Drive → domain=drive.google.com
    - Netflix → domain=netflix.com
    - Notion → domain=notion.so
    - Dropbox → domain=dropbox.com
    - Apple → domain=apple.com

  • ONLY include icons/logos that are VISUALLY PRESENT in the screenshot.

▸ STEP 5 — GENERATE HTML
  Produce one complete self-contained HTML file:
  1. <!DOCTYPE html> — no truncation
  2. <link> for Google Fonts (detected fonts only)
  3. <link> for Tabler Icons CDN
  4. <script src="https://cdn.tailwindcss.com"></script>
  5. <style> block with CSS custom properties using EXACT canvas hex values
  6. All text content verbatim from the screenshot
  7. All measurements applied with precision
  8. Renders correctly standalone in an iframe

══════════════════════════════════════════════════════════════
NON-NEGOTIABLE OUTPUT RULE
══════════════════════════════════════════════════════════════
Return ONLY raw HTML. Start with <!DOCTYPE html>. End with </html>.
No markdown. No backticks. No JSON. No comments outside HTML. Pure HTML only.`;

/* ================================================================
   GEMINI API — gemini-3-flash-preview
================================================================ */
async function callGemini(
  apiKey: string,
  userMsg: string,
  imageB64: string,
  mimeType: string,
  cd: ExtractedColorData,
  onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Sending image + pixel color data to Gemini...');

  const colorPrompt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CANVAS PIXEL-EXTRACTED COLOR DATA
These colors were read DIRECTLY from image pixels via the Canvas API.
They are 100% accurate. Use ONLY these hex values — no approximations.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE: ${cd.imageWidth}×${cd.imageHeight}px | SAMPLED: ${cd.totalSampled.toLocaleString()} pixels

── TOP ${Math.min(cd.dominantPalette.length, 48)} COLORS by frequency ──
${cd.dominantPalette.slice(0, 48).map((c, i) =>
    `  ${String(i + 1).padStart(2)}. ${c.hex}  rgb(${String(c.r).padStart(3)},${String(c.g).padStart(3)},${String(c.b).padStart(3)})  freq:${c.count.toLocaleString().padStart(8)}px  @ (${c.xPercent}%x, ${c.yPercent}%y)`
  ).join('\n')}

── SPATIAL ZONE MAP 6×6 (row 0=top, col 0=left) ──
${cd.zones.map(z =>
    `  [${z.row},${z.col}] ${z.name.padEnd(24)} dominant:${z.dominant}  zone_palette:[${z.colors.join(', ')}]`
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
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imageB64 } }, { text: colorPrompt }] }],
        generationConfig: { temperature: 0.01, maxOutputTokens: 65536, topK: 1, topP: 0.85 },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Gemini API Error ${resp.status}`);
  }

  onProgress('Processing response...');
  const data = await resp.json();
  const raw: string = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const htmlMatch = raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i);
  if (htmlMatch) return htmlMatch[0];
  const fence = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return raw.trim();
}

/* ================================================================
   ICONS (UI chrome only — not injected into generated output)
================================================================ */
const IcKey = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>;
const IcUpload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IcEye = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcCode = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
const IcCopy = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IcZap = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const IcX = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcCheck = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcDownload = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IcPalette = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>;

const Spinner = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <div className={`${size === 'lg' ? 'w-10 h-10 border-[3px]' : 'w-3.5 h-3.5 border-2'} rounded-full border-cyan-500/20 border-t-cyan-400 animate-spin`} />
);

/* ================================================================
   MAIN PAGE
================================================================ */
export default function PixelPerfectAI() {
  const [apiKey, setApiKey]             = useState('');
  const [tempKey, setTempKey]           = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keySaved, setKeySaved]         = useState(false);
  const [copied, setCopied]             = useState(false);

  const [imgUrl, setImgUrl]         = useState('');
  const [imgB64, setImgB64]         = useState('');
  const [imgMime, setImgMime]       = useState('');
  const [colorData, setColorData]   = useState<ExtractedColorData | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver]     = useState(false);

  const [prompt, setPrompt] = useState(
    "Reproduis cette interface au pixel perfect. Chaque élément, chaque couleur, chaque espacement doit être identique à la capture. Aucun ajout, aucune amélioration, reproduction stricte."
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
    reader.onload = e => { const res = e.target?.result as string; setImgB64(res.split(',')[1]); setImgMime(file.type); };
    reader.readAsDataURL(file);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (canvasRef.current) { try { setColorData(extractColors(canvasRef.current, img)); } catch (e) { console.error(e); } }
      setExtracting(false);
    };
    img.onerror = () => setExtracting(false);
    img.src = url;
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) processImage(f);
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
      setError(err instanceof Error ? err.message : 'Unknown error.');
    } finally { setGenerating(false); setProgress(''); }
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
    a.download = 'pixel-perfect.html'; a.click();
  };

  return (
    <div className="flex flex-col h-screen bg-[#07070f] text-slate-200 font-mono overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* ── HEADER ── */}
      <header className="flex items-center justify-between px-5 h-[52px] border-b border-white/[0.06] bg-[#08081a]/80 backdrop-blur-xl shrink-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center text-sm shadow-[0_0_16px_rgba(0,229,255,0.25)] shrink-0">⬡</div>
          <div>
            <p className="text-[13px] font-black tracking-tight bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent leading-none" style={{ fontFamily: 'system-ui' }}>
              PIXEL PERFECT AI
            </p>
            <p className="text-[8px] text-slate-600 tracking-[0.18em] mt-0.5">GEMINI 3 · CANVAS ENGINE · MEASURE-FIRST</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {keySaved && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400 tracking-widest bg-emerald-950/50 border border-emerald-900/40 rounded-full px-2.5 py-0.5">
              <IcCheck /> KEY ACTIVE
            </span>
          )}
          <button onClick={() => { setTempKey(apiKey); setShowKeyModal(true); }}
            className="flex items-center gap-1.5 text-[11px] text-slate-500 border border-white/[0.08] rounded-md px-2.5 py-1.5 hover:border-cyan-500/40 hover:text-cyan-400 transition-all duration-150">
            <IcKey /> {keySaved ? 'Edit Key' : 'Set API Key'}
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═ SIDEBAR ═ */}
        <aside className="w-[340px] shrink-0 border-r border-white/[0.06] bg-[#0a0a1a] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">

            {/* Upload zone */}
            <div className="bg-[#0f0f20] border border-white/[0.07] rounded-lg p-3">
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-600 mb-2 flex items-center gap-1.5">
                <IcUpload /> Screenshot
              </p>
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-md cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2
                  ${dragOver ? 'border-cyan-400/60 bg-cyan-950/20' : imgUrl ? 'border-white/10 p-2' : 'border-white/10 p-4 min-h-[90px]'}
                  hover:border-cyan-500/40`}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt="" className="w-full rounded max-h-40 object-contain" />
                    <span className="text-[9px] text-slate-700">Click / drop to replace</span>
                  </>
                ) : (
                  <div className="text-center">
                    <div className="text-slate-700 flex justify-center mb-1.5"><IcUpload /></div>
                    <p className="text-[11px] text-slate-500">Drop UI screenshot here</p>
                    <p className="text-[9px] text-slate-700 mt-0.5">PNG · JPG · WEBP</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processImage(f); }} />
              {extracting && (
                <div className="flex items-center gap-2 mt-2 text-[10px] text-cyan-400">
                  <Spinner /> Extracting pixel colors…
                </div>
              )}
            </div>

            {/* Color Data */}
            {colorData && (
              <div className="bg-[#0f0f20] border border-white/[0.07] rounded-lg p-3">
                <div className="flex items-center mb-2.5">
                  <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-600 flex items-center gap-1"><IcPalette /> Color Data</span>
                  <span className="ml-auto text-[8.5px] text-cyan-600">{colorData.totalSampled.toLocaleString()}px · {colorData.dominantPalette.length} colors</span>
                </div>
                {/* Dominant palette */}
                <div className="mb-2.5">
                  <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700 mb-1.5">Dominant</p>
                  <div className="flex flex-wrap gap-[3px]">
                    {colorData.dominantPalette.slice(0, 36).map((c, i) => (
                      <div key={i}
                        className="w-[15px] h-[15px] rounded-[2px] border border-white/[0.08] cursor-pointer hover:scale-[1.5] transition-transform duration-100 shrink-0"
                        style={{ backgroundColor: c.hex }}
                        title={`${c.hex}  freq:${c.count}px  pos:(${c.xPercent}%,${c.yPercent}%)`}
                      />
                    ))}
                  </div>
                </div>
                {/* Zone grid */}
                <div>
                  <p className="text-[8px] uppercase tracking-[0.1em] text-slate-700 mb-1.5">Zones 6×6</p>
                  <div className="grid grid-cols-6 gap-[2px]">
                    {colorData.zones.map((z, i) => (
                      <div key={i}
                        className="aspect-square rounded-[2px] cursor-pointer hover:scale-125 hover:z-10 transition-transform duration-100 relative"
                        style={{ backgroundColor: z.dominant }}
                        title={`[${z.row},${z.col}] ${z.name}\n${z.colors.join(' · ')}`}
                      />
                    ))}
                  </div>
                  <p className="text-[8px] text-slate-700 mt-1">{colorData.imageWidth}×{colorData.imageHeight}px</p>
                </div>
              </div>
            )}

            {/* Defect checklist — visual reminder */}
            <div className="bg-[#0f0f20] border border-amber-900/20 rounded-lg p-3">
              <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-amber-600 mb-2">Gemini will avoid</p>
              <div className="flex flex-col gap-1">
                {[
                  'Badge backgrounds on plain text',
                  'Icon size inflation (20px → 14px)',
                  'Row height inflation (48px → 32px)',
                  'Border-radius on flat elements',
                  'Padding inflation',
                  'Invented box-shadows',
                  'Wrong colors (canvas-only)',
                  'Generic icons (→ Tabler Icons)',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[9px] text-slate-600 leading-snug">
                    <span className="text-amber-700 shrink-0 mt-px">✕</span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="bg-[#0f0f20] border border-white/[0.07] rounded-lg p-3">
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-600 mb-2">Prompt</p>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                className="w-full bg-[#0a0a1a] border border-white/[0.07] rounded text-slate-300 font-mono text-[11px] p-2 outline-none leading-relaxed resize-y focus:border-cyan-500/40 transition-colors duration-150 placeholder:text-slate-700"
              />
            </div>

            {error && (
              <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 text-[10px] text-red-400 leading-relaxed">{error}</div>
            )}

            {/* Generate */}
            <button
              onClick={generate}
              disabled={generating || !imgB64}
              className={`w-full py-3 rounded-lg font-bold text-[12px] tracking-wide flex items-center justify-center gap-2 transition-all duration-150
                ${generating || !imgB64
                  ? 'bg-cyan-950/20 border border-cyan-900/20 text-cyan-800 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black shadow-[0_0_20px_rgba(0,229,255,0.2)] hover:shadow-[0_0_36px_rgba(0,229,255,0.4)] hover:-translate-y-px cursor-pointer'
                }`}
            >
              {generating
                ? <><Spinner /><span className="text-cyan-400 text-[11px]">{progress || 'Analyzing…'}</span></>
                : <><IcZap /> Generate Pixel-Perfect UI</>
              }
            </button>

            {code && (
              <div className="flex gap-3 text-[9px] text-slate-700 pl-0.5">
                <span className="text-emerald-600">✓ Ready</span>
                <span>{(code.length / 1024).toFixed(1)} KB</span>
                <span>{code.split('\n').length} lines</span>
              </div>
            )}
          </div>
        </aside>

        {/* ═ PREVIEW PANE ═ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Tabs */}
          <div className="flex items-center h-9 px-3 gap-0.5 border-b border-white/[0.06] bg-[#0a0a1a] shrink-0">
            {(['preview', 'code'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 h-full text-[10px] font-medium tracking-[0.1em] uppercase border-b-2 transition-all duration-100 cursor-pointer
                  ${tab === t ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-600 hover:text-slate-400'}`}>
                {t === 'preview' ? <IcEye /> : <IcCode />}{t}
              </button>
            ))}
            {code && (
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={copyCode}
                  className={`flex items-center gap-1 text-[9.5px] border rounded px-2 py-1 transition-all duration-100 cursor-pointer
                    ${copied ? 'border-emerald-800 text-emerald-400' : 'border-white/[0.08] text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400'}`}>
                  {copied ? <><IcCheck />Copied</> : <><IcCopy />Copy</>}
                </button>
                <button onClick={downloadCode}
                  className="flex items-center gap-1 text-[9.5px] border border-white/[0.08] text-slate-500 rounded px-2 py-1 hover:border-emerald-700/40 hover:text-emerald-400 transition-all duration-100 cursor-pointer">
                  <IcDownload />.html
                </button>
                <button onClick={() => setCode('')}
                  className="flex items-center text-[9.5px] border border-white/[0.08] text-slate-700 rounded px-1.5 py-1 hover:border-red-900/40 hover:text-red-400 transition-all duration-100 cursor-pointer">
                  <IcX />
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          {tab === 'preview' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {code
                ? <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin allow-forms" className="flex-1 border-none bg-white w-full" title="Result" />
                : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-700">
                    {generating
                      ? <div className="text-center"><Spinner size="lg" /><p className="text-[11px] text-cyan-400 mt-3">{progress}</p><p className="text-[9px] text-slate-700 mt-1">Gemini is measuring every element…</p></div>
                      : <>
                          <div className="text-[52px] opacity-[0.04]">⬡</div>
                          <div className="text-center">
                            <p className="text-[12px] text-slate-600">Upload a screenshot to start</p>
                            <p className="text-[9.5px] text-slate-700 mt-1">Canvas extracts exact pixel colors · Gemini measures and reproduces</p>
                          </div>
                        </>
                    }
                  </div>
                )}
            </div>
          )}

          {/* Code */}
          {tab === 'code' && (
            <div className="flex-1 overflow-auto p-4">
              {code
                ? <pre className="text-[10.5px] leading-[1.75] text-[#c8d3f5] whitespace-pre-wrap break-words font-mono">{code}</pre>
                : <div className="h-full flex items-center justify-center text-slate-700 text-[11px]">No code yet.</div>
              }
            </div>
          )}
        </div>
      </div>

      {/* ── API KEY MODAL ── */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget && keySaved) setShowKeyModal(false); }}>
          <div className="w-full max-w-[420px] bg-[#0f0f20] border border-white/[0.09] rounded-xl p-6 shadow-[0_0_60px_rgba(0,229,255,0.06),0_24px_60px_rgba(0,0,0,0.8)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-cyan-400"><IcKey /></span>
              <h2 className="text-[15px] font-black bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent" style={{ fontFamily: 'system-ui' }}>
                Gemini API Key
              </h2>
              {keySaved && <button onClick={() => setShowKeyModal(false)} className="ml-auto text-slate-600 hover:text-slate-300 cursor-pointer"><IcX /></button>}
            </div>
            <p className="text-[10.5px] text-slate-500 leading-relaxed mt-2.5 mb-4">
              Stored only in your browser&apos;s <strong className="text-slate-300">IndexedDB</strong>. Sent exclusively to Google&apos;s Gemini API.{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Get key →</a>
            </p>
            <label className="block text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-600 mb-1.5">API Key</label>
            <input type="password" autoFocus value={tempKey} onChange={e => setTempKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()} placeholder="AIzaSy…"
              className="w-full bg-[#0a0a1a] border border-white/[0.08] rounded-md text-slate-200 font-mono text-[12px] px-3 py-2.5 outline-none mb-4 focus:border-cyan-500/40 transition-colors duration-150 placeholder:text-slate-700"
            />
            <div className="flex gap-2">
              <button onClick={saveKey} disabled={!tempKey.trim()}
                className={`flex-1 py-2.5 rounded-md text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all duration-150
                  ${tempKey.trim() ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black cursor-pointer hover:shadow-[0_0_28px_rgba(0,229,255,0.35)]' : 'bg-cyan-950/20 border border-cyan-900/20 text-cyan-800 cursor-not-allowed'}`}>
                <IcCheck /> Save to IndexedDB
              </button>
              {keySaved && (
                <button onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2.5 border border-white/[0.08] text-slate-500 rounded-md text-[11px] hover:border-white/20 transition-all duration-150 cursor-pointer">
                  Cancel
                </button>
              )}
            </div>
            <div className="mt-3 flex items-start gap-2 bg-emerald-950/30 border border-emerald-900/20 rounded-md px-2.5 py-2 text-[9.5px] text-slate-500 leading-relaxed">
              <span className="text-emerald-500 shrink-0">🔒</span>
              IndexedDB only — never logged, never shared. Edit anytime via the header.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
