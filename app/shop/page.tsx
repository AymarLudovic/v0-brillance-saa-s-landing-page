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
   — Anti-LLM-design, forensic reproduction, Tabler Icons, Google logos
================================================================ */
const SYSTEM_PROMPT = `You are a forensic UI reproduction engine. Your ONLY job is to reproduce what is VISIBLE in the screenshot — nothing more, nothing less. You are NOT a designer. You do NOT improve, enhance, stylize, or interpret.

═══════════════════════════════════════════════════════════════
⛔ ABSOLUTE PROHIBITIONS — THESE ARE NON-NEGOTIABLE RULES
═══════════════════════════════════════════════════════════════

❌ NEVER add any visual element that is not present in the screenshot
❌ NEVER add icons to cards, sections, or headings unless the EXACT icon appears in the screenshot
❌ NEVER add gradients unless a gradient is visually present in the screenshot
❌ NEVER add colored borders, glow effects, or accent rings unless they exist in the original
❌ NEVER add box-shadows that are more prominent than what appears in the original
❌ NEVER make buttons more colorful, larger, or more decorated than the original
❌ NEVER add background patterns, noise textures, or decorative shapes not in the original
❌ NEVER add hover animations or transitions that aren't implied by the original
❌ NEVER add extra padding, margins, or spacing beyond what the screenshot shows
❌ NEVER use gradient text unless gradient text visibly appears in the original
❌ NEVER invent content, placeholder text, or additional UI sections
❌ NEVER apply a "design system" or "component library" aesthetic — only reproduce what you SEE
❌ NEVER add decorative dividers, separators, or lines not in the original
❌ NEVER make card corners more rounded than they appear
❌ NEVER use bright/saturated accent colors for borders or outlines unless they exist in the original

The #1 failure mode to avoid: making a "nicer" or "more polished" version of the original.
The goal is EXACT REPRODUCTION, not improvement.

═══════════════════════════════════════════════════════════════
ANALYSIS PROTOCOL — EXECUTE EVERY PHASE BEFORE CODING
═══════════════════════════════════════════════════════════════

▸ PHASE 1 — INVENTORY EVERY ELEMENT
  List EVERY visible element in the screenshot.
  For each element, note:
  — What it is
  — Its exact position (top/left/center/right, nested inside what)
  — Its exact visual appearance (color, size, shape, decoration)
  — What it does NOT have (e.g., "no border", "no shadow", "no icon", "no background")

▸ PHASE 2 — TYPOGRAPHY EXACT MEASUREMENT
  • Font families — identify or find closest Google Font match
  • Font sizes in px/rem for every text element
  • Font weights (exact: 300, 400, 500, 600, 700, 800, 900)
  • Line-height, letter-spacing, text-transform
  • ALL colors mapped to provided canvas hex values

▸ PHASE 3 — COLOR MAPPING (USE CANVAS DATA ONLY)
  ⚠ MANDATORY: Use ONLY the canvas-extracted hex values below.
  Map each hex to its exact usage in the UI:
  — What element uses this color
  — Background, text, border, or fill
  NEVER guess or approximate a color.

▸ PHASE 4 — COMPONENT EXACT REPRODUCTION
  For EACH component, document precisely:

  CARDS/PANELS:
  — Background color (exact hex from canvas data)
  — Border: does it have one? If yes: 1px solid #xxx or none?
  — Border-radius: how many px? Is it subtle (4px) or prominent (12px)?
  — Shadow: is there one? How subtle? (e.g., "0 1px 3px rgba(0,0,0,0.3)")
  — Padding: measure in px
  — Are there icons? Only if visible. What size?

  INPUTS/FORM FIELDS:
  — Height in px
  — Background: what color? (usually very dark, close to the card bg)
  — Border: 1px? What color? Barely visible or prominent?
  — Border-radius: subtle or round?
  — Placeholder: what color? Usually dim/muted

  BUTTONS:
  — Background color (exact hex)
  — Is it outlined or filled?
  — Border-radius
  — Font size, font weight
  — Padding
  — Any icon? What icon? What size?

  NAVIGATION/HEADER:
  — Height
  — Background or transparent?
  — Item spacing
  — Active state appearance

▸ PHASE 5 — ICON AUDIT
  For each icon visible in the screenshot:
  — Identify the closest Tabler Icons equivalent
  — Note its size, color, stroke width
  — Note its exact position and context

▸ PHASE 6 — COMPANY LOGO DETECTION
  If any company/service logos are visible (Netflix, Apple, Spotify, etc.):
  — Identify the company name and domain
  — Use Google Favicon API: https://www.google.com/s2/favicons?domain=COMPANY.com&sz=128
  — Or use Clearbit Logo API: https://logo.clearbit.com/COMPANY.com
  — Display as <img> at the correct size

═══════════════════════════════════════════════════════════════
CODE GENERATION RULES
═══════════════════════════════════════════════════════════════

1. ONE complete self-contained HTML file. Never truncate.
2. Google Fonts via <link> for all identified fonts
3. CSS custom properties using ONLY canvas-extracted hex values
4. Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
5. Tabler Icons CDN for all icons (ONLY if icons exist in original):
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css">
   Usage: <i class="ti ti-brand-netflix"></i>
6. Company logos via Google Favicon API or Clearbit (ONLY if logos exist in original)
7. All text reproduced verbatim from screenshot
8. Standalone, renders perfectly in an iframe at 100% zoom

CRITICAL OUTPUT:
Return ONLY raw HTML starting with <!DOCTYPE html> ending with </html>.
No markdown. No backticks. No explanation. Pure HTML.`;

/* ================================================================
   GEMINI API CALL — model: gemini-2.5-flash-preview-05-20
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
 (Direct from browser Canvas API — pixel-accurate, ZERO approximation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE DIMENSIONS: ${cd.imageWidth}×${cd.imageHeight}px
TOTAL PIXELS SAMPLED: ${cd.totalSampled.toLocaleString()}

── TOP ${Math.min(cd.dominantPalette.length, 48)} DOMINANT COLORS (sorted by pixel frequency) ──
${cd.dominantPalette.slice(0, 48).map((c, i) =>
    `  ${String(i + 1).padStart(2, ' ')}. ${c.hex}  rgb(${c.r},${c.g},${c.b})  freq:${c.count.toLocaleString()}px  pos:(${c.xPercent}%x, ${c.yPercent}%y)`
  ).join('\n')}

── SPATIAL ZONE COLOR MAP (6×6 = 36 zones, [row,col] 0-indexed from top-left) ──
${cd.zones.map(z =>
    `  [${z.row},${z.col}] ${z.name.padEnd(24)} dominant:${z.dominant}  all:[${z.colors.join(', ')}]`
  ).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTION: ${userMsg}
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
        generationConfig: {
          temperature: 0.02,
          maxOutputTokens: 65536,
          topK: 1,
          topP: 0.85,
        },
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
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></svg>;
}
function IconUpload() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
}
function IconEye() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function IconCode() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
}
function IconCopy() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}
function IconZap() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
}
function IconStar() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>;
}
function IconX() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}
function IconCheck() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}
function IconDownload() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}
function IconSettings() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;
}

/* ================================================================
   SPINNER
================================================================ */
function Spinner({ size = 'sm', pulse = false }: { size?: 'sm' | 'lg'; pulse?: boolean }) {
  const dim = size === 'lg' ? 'w-10 h-10 border-[3px]' : 'w-3.5 h-3.5 border-2';
  return (
    <div className={`${dim} rounded-full border-cyan-500/20 border-t-cyan-400 animate-spin ${pulse ? 'opacity-70' : ''}`} />
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

  const [imgUrl, setImgUrl]         = useState('');
  const [imgB64, setImgB64]         = useState('');
  const [imgMime, setImgMime]       = useState('');
  const [colorData, setColorData]   = useState<ExtractedColorData | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver]     = useState(false);

  const [prompt, setPrompt] = useState(
    'Reproduis cette interface au pixel perfect. Chaque élément, chaque couleur, chaque espacement doit être identique à la capture. Aucun ajout, aucune amélioration, reproduction stricte uniquement.'
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

  return (
    <div className="flex flex-col h-screen bg-[#080808] text-slate-200 font-mono overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* ══ HEADER ══ */}
      <header className="flex items-center justify-between px-5 h-[52px] border-b border-white/[0.06] bg-[#0a0a0a] shrink-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center text-[13px] shadow-[0_0_16px_rgba(0,229,255,0.25)] shrink-0">
            ⬡
          </div>
          <div>
            <p className="text-[13px] font-black tracking-tight bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent leading-none">
              PIXEL PERFECT AI
            </p>
            <p className="text-[8px] text-slate-700 tracking-[0.18em] mt-0.5">
              GEMINI · CANVAS COLOR ENGINE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {keySaved && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400 tracking-widest bg-emerald-950/50 border border-emerald-900/40 rounded-full px-2.5 py-0.5">
              <IconCheck /> KEY ACTIVE
            </span>
          )}
          <button
            onClick={() => { setTempKey(apiKey); setShowKeyModal(true); }}
            className="flex items-center gap-1.5 text-[10.5px] text-slate-500 border border-white/[0.07] rounded-md px-3 py-1.5 hover:border-cyan-500/40 hover:text-cyan-400 transition-all duration-150 cursor-pointer"
          >
            <IconSettings /> {keySaved ? 'API Key' : 'Set Key'}
          </button>
        </div>
      </header>

      {/* ══ BODY ══ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═ LEFT PANEL ═ */}
        <aside className="w-[340px] shrink-0 border-r border-white/[0.06] bg-[#0c0c0c] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">

            {/* Upload */}
            <section className="bg-[#111] border border-white/[0.07] rounded-lg p-3">
              <p className="text-[9px] font-semibold tracking-[0.14em] uppercase text-slate-600 mb-2 flex items-center gap-1.5">
                <IconUpload /> Screenshot
              </p>
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-md cursor-pointer transition-all duration-150 flex flex-col items-center justify-center gap-2 
                  ${dragOver
                    ? 'border-cyan-500/50 bg-cyan-950/20'
                    : imgUrl
                      ? 'border-white/[0.08] p-2'
                      : 'border-white/[0.07] p-6 min-h-[100px] hover:border-white/[0.14]'
                  }`}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt="" className="w-full rounded max-h-48 object-contain" />
                    <span className="text-[8.5px] text-slate-700">Click / drop to replace</span>
                  </>
                ) : (
                  <>
                    <div className="text-slate-700 opacity-60"><IconUpload /></div>
                    <div className="text-center">
                      <p className="text-[11px] text-slate-500">Drop UI screenshot here</p>
                      <p className="text-[9px] text-slate-700 mt-0.5">PNG · JPG · WEBP — from device only</p>
                    </div>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) processImage(f); }} />
              {extracting && (
                <div className="flex items-center gap-2 mt-2 text-[10.5px] text-cyan-400">
                  <Spinner /> Extracting colors…
                </div>
              )}
            </section>

            {/* Color data */}
            {colorData && (
              <section className="bg-[#111] border border-white/[0.07] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <span className="text-[9px] font-semibold tracking-[0.14em] uppercase text-slate-600 flex items-center gap-1.5">
                    <IconStar /> Color Data
                  </span>
                  <span className="ml-auto text-[8.5px] text-slate-700">
                    {colorData.totalSampled.toLocaleString()}px · {colorData.dominantPalette.length} colors
                  </span>
                </div>
                <p className="text-[8px] uppercase tracking-widest text-slate-700 mb-1.5">Dominant palette</p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {colorData.dominantPalette.slice(0, 40).map((c, i) => (
                    <div
                      key={i}
                      className="w-[15px] h-[15px] rounded-[3px] border border-white/[0.08] cursor-pointer hover:scale-150 transition-transform duration-100 shrink-0"
                      style={{ backgroundColor: c.hex }}
                      title={`${c.hex} · ${c.count}px · (${c.xPercent}%,${c.yPercent}%)`}
                    />
                  ))}
                </div>
                <p className="text-[8px] uppercase tracking-widest text-slate-700 mb-1.5">Zone map (6×6)</p>
                <div className="grid grid-cols-6 gap-0.5">
                  {colorData.zones.map((z, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-[2px] cursor-pointer hover:scale-125 hover:z-10 transition-transform duration-100 relative"
                      style={{ backgroundColor: z.dominant }}
                      title={`[${z.row},${z.col}] ${z.name}\n${z.colors.join(' · ')}`}
                    />
                  ))}
                </div>
                <p className="text-[8px] text-slate-700 mt-1.5">{colorData.imageWidth}×{colorData.imageHeight}px</p>
              </section>
            )}

            {/* Prompt */}
            <section className="bg-[#111] border border-white/[0.07] rounded-lg p-3">
              <p className="text-[9px] font-semibold tracking-[0.14em] uppercase text-slate-600 mb-2">
                Instruction
              </p>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                className="w-full bg-[#0c0c0c] border border-white/[0.07] rounded-md text-slate-300 font-mono text-[11px] p-2.5 outline-none leading-relaxed resize-y focus:border-white/[0.15] transition-all duration-150 placeholder:text-slate-700"
              />
            </section>

            {/* Error */}
            {error && (
              <div className="bg-red-950/20 border border-red-900/30 rounded-md px-3 py-2 text-[10.5px] text-red-400 leading-relaxed">
                {error}
              </div>
            )}

            {/* Generate */}
            <button
              onClick={generate}
              disabled={generating || !imgB64}
              className={`w-full py-3 rounded-lg font-bold text-[12.5px] tracking-wide flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer
                ${generating || !imgB64
                  ? 'bg-white/[0.04] border border-white/[0.06] text-slate-700 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black hover:shadow-[0_0_32px_rgba(0,229,255,0.35)] hover:-translate-y-px shadow-[0_0_16px_rgba(0,229,255,0.15)]'
                }`}
            >
              {generating ? (
                <><Spinner pulse /><span className="text-cyan-500 text-[11.5px]">{progress || 'Generating…'}</span></>
              ) : (
                <><IconZap /> Generate Pixel-Perfect UI</>
              )}
            </button>

            {code && (
              <div className="flex gap-3 text-[9px] text-slate-700 pl-0.5">
                <span className="text-emerald-600">✓ Ready</span>
                <span>{(code.length / 1024).toFixed(1)} KB</span>
                <span>{code.split('\n').length} lines</span>
                {colorData && <span>{colorData.dominantPalette.length} colors</span>}
              </div>
            )}
          </div>
        </aside>

        {/* ═ RIGHT PANE ═ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Tab bar */}
          <div className="flex items-center h-9 px-3 gap-0.5 border-b border-white/[0.06] bg-[#0c0c0c] shrink-0">
            {(['preview', 'code'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 h-full text-[10px] font-medium tracking-[0.1em] uppercase border-b-2 transition-all duration-100 cursor-pointer
                  ${tab === t ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-slate-600 hover:text-slate-400'}`}
              >
                {t === 'preview' ? <IconEye /> : <IconCode />}{t}
              </button>
            ))}
            {code && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={copyCode}
                  className={`flex items-center gap-1 text-[9.5px] border rounded px-2.5 py-1 transition-all duration-100 cursor-pointer
                    ${copied ? 'border-emerald-700/60 text-emerald-500' : 'border-white/[0.08] text-slate-500 hover:border-white/[0.16] hover:text-slate-300'}`}
                >
                  {copied ? <><IconCheck />Copied</> : <><IconCopy />Copy</>}
                </button>
                <button
                  onClick={downloadCode}
                  className="flex items-center gap-1 text-[9.5px] border border-white/[0.08] text-slate-500 rounded px-2.5 py-1 hover:border-white/[0.16] hover:text-slate-300 transition-all duration-100 cursor-pointer"
                >
                  <IconDownload /> .html
                </button>
                <button
                  onClick={() => setCode('')}
                  className="flex items-center text-[9.5px] border border-white/[0.06] text-slate-700 rounded px-1.5 py-1 hover:border-red-900/40 hover:text-red-500 transition-all duration-100 cursor-pointer"
                >
                  <IconX />
                </button>
              </div>
            )}
          </div>

          {/* Preview */}
          {tab === 'preview' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {code ? (
                <iframe
                  ref={iframeRef}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  className="flex-1 border-none bg-white w-full"
                  title="Preview"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-700">
                  {generating ? (
                    <div className="text-center">
                      <Spinner size="lg" />
                      <p className="text-xs text-cyan-500 mt-4">{progress}</p>
                      <p className="text-[9px] text-slate-700 mt-1">Analyzing every pixel…</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-5xl opacity-[0.04]">⬡</div>
                      <div className="text-center">
                        <p className="text-xs text-slate-600">Upload a screenshot to begin</p>
                        <p className="text-[9.5px] text-slate-700 mt-1">Canvas extracts exact colors → Gemini reproduces pixel-perfect</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Code */}
          {tab === 'code' && (
            <div className="flex-1 overflow-auto p-4 bg-[#080808]">
              {code ? (
                <pre className="text-[10.5px] leading-7 text-[#c8d3f5] whitespace-pre-wrap break-words font-mono">
                  {code}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-700 text-xs">No code generated yet.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ API KEY MODAL ══ */}
      {showKeyModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          onClick={e => { if (e.target === e.currentTarget && keySaved) setShowKeyModal(false); }}
        >
          <div className="w-full max-w-[420px] bg-[#111] border border-white/[0.1] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-cyan-400"><IconKey /></span>
              <h2 className="text-[15px] font-black bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent">
                Gemini API Key
              </h2>
              {keySaved && (
                <button onClick={() => setShowKeyModal(false)} className="ml-auto text-slate-600 hover:text-slate-300 transition-colors cursor-pointer">
                  <IconX />
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-slate-500 leading-relaxed mt-3 mb-5">
              Stored exclusively in your browser&apos;s <strong className="text-slate-300">IndexedDB</strong>.
              Never sent anywhere except Google&apos;s Gemini API.{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                Get your key →
              </a>
            </p>
            <label className="block text-[8.5px] font-semibold tracking-[0.14em] uppercase text-slate-600 mb-1.5">API Key</label>
            <input
              type="password" autoFocus
              value={tempKey}
              onChange={e => setTempKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()}
              placeholder="AIzaSy…"
              className="w-full bg-[#0a0a0a] border border-white/[0.08] rounded-lg text-slate-200 font-mono text-[12.5px] px-3.5 py-2.5 outline-none mb-4 focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/10 transition-all duration-150 placeholder:text-slate-700"
            />
            <div className="flex gap-2">
              <button
                onClick={saveKey}
                disabled={!tempKey.trim()}
                className={`flex-1 py-2.5 rounded-lg text-[11.5px] font-bold flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer
                  ${tempKey.trim()
                    ? 'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black hover:shadow-[0_0_28px_rgba(0,229,255,0.3)]'
                    : 'bg-white/[0.04] border border-white/[0.06] text-slate-700 cursor-not-allowed'
                  }`}
              >
                <IconCheck /> Save to IndexedDB
              </button>
              {keySaved && (
                <button onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2.5 bg-transparent border border-white/[0.08] text-slate-500 rounded-lg text-[11.5px] hover:border-white/[0.15] transition-all duration-150 cursor-pointer">
                  Cancel
                </button>
              )}
            </div>
            <div className="mt-3.5 flex items-start gap-2 bg-emerald-950/30 border border-emerald-900/25 rounded-lg px-3 py-2.5 text-[9.5px] text-slate-500 leading-relaxed">
              <span className="text-emerald-500 shrink-0">🔒</span>
              Stored in IndexedDB — editable anytime. Never shared with any server except Gemini.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
