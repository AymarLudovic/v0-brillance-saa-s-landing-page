'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';

interface ColorInfo { hex: string; r: number; g: number; b: number; count: number; xPercent: number; yPercent: number; }
interface ColorZone { name: string; row: number; col: number; dominant: string; colors: string[]; }
interface ExtractedColorData { dominantPalette: ColorInfo[]; zones: ColorZone[]; imageWidth: number; imageHeight: number; totalSampled: number; }
interface NextJSFile { path: string; content: string; }
interface SandboxState { id: string|null; url: string|null; step: 'idle'|'creating'|'adding'|'installing'|'building'|'starting'|'running'|'error'; logs: string[]; error: string; buildAttempts: number; }
interface Project { id: string; name: string; htmlCode: string; jsCode: string; fullCode: string; featuresCode: string; nextjsFiles: NextJSFile[]; imgDataUrl: string; createdAt: number; }
interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  type: 'text' | 'step' | 'result' | 'error' | 'decision';
  content: string;
  meta?: string; // e.g. step label, route name
}

/* ── IndexedDB ── */
const DB_NAME = 'pixelperfect-v2', STORE = 'config', PROJ_STORE = 'projects';
async function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PROJ_STORE)) db.createObjectStore(PROJ_STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbGet(k: string): Promise<string | null> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(STORE,'readonly').objectStore(STORE).get(k); r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error); }); }
async function dbSet(k: string, v: string): Promise<void> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(STORE,'readwrite').objectStore(STORE).put(v, k); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
async function dbSaveProject(p: Project): Promise<void> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(PROJ_STORE,'readwrite').objectStore(PROJ_STORE).put(p); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
async function dbGetAllProjects(): Promise<Project[]> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(PROJ_STORE,'readonly').objectStore(PROJ_STORE).getAll(); r.onsuccess = () => res((r.result as Project[]).sort((a,b)=>b.createdAt-a.createdAt)); r.onerror = () => rej(r.error); }); }
async function dbDeleteProject(id: string): Promise<void> { const db = await openDB(); return new Promise((res, rej) => { const r = db.transaction(PROJ_STORE,'readwrite').objectStore(PROJ_STORE).delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
async function dbPatchProjectJs(id: string, jsCode: string, fullCode: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const store = db.transaction(PROJ_STORE,'readwrite').objectStore(PROJ_STORE);
    const gr = store.get(id);
    gr.onsuccess = () => { const p = gr.result as Project; if(p){ p.jsCode=jsCode; p.fullCode=fullCode; store.put(p); } res(); };
    gr.onerror = () => rej(gr.error);
  });
}
async function dbPatchProjectFeatures(id: string, featuresCode: string): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const store = db.transaction(PROJ_STORE,'readwrite').objectStore(PROJ_STORE);
    const gr = store.get(id);
    gr.onsuccess = () => { const p = gr.result as Project; if(p){ p.featuresCode=featuresCode; store.put(p); } res(); };
    gr.onerror = () => rej(gr.error);
  });
}
async function dbPatchProjectNextjs(id: string, nextjsFiles: NextJSFile[]): Promise<void> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const store = db.transaction(PROJ_STORE,'readwrite').objectStore(PROJ_STORE);
    const gr = store.get(id);
    gr.onsuccess = () => { const p = gr.result as Project; if(p){ p.nextjsFiles=nextjsFiles; store.put(p); } res(); };
    gr.onerror = () => rej(gr.error);
  });
}

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
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const HIGH_DEMAND_RE = /high demand|try again later|overloaded/i;
const GEMINI_MODEL = 'gemini-3-flash-preview';

/* ── SDK factory (one instance per call, key may change) ── */
function getAI(apiKey: string) { return new GoogleGenAI({ apiKey }); }

/* ── Extract text from SDK response (ignores thought parts) ── */
function extractText(response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>): string {
  // response.text is a convenience getter that joins non-thought text parts
  return response.text ?? '';
}

async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  onProgress: (s: string) => void,
  maxRetries = 5,
  delayMs = 12000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (HIGH_DEMAND_RE.test(msg) && attempt <= maxRetries) {
        for (let s = Math.round(delayMs / 1000); s > 0; s--) {
          onProgress(`⚡ High demand — retry ${attempt}/${maxRetries} in ${s}s…`);
          await sleep(1000);
        }
        onProgress(`↺ Retrying (${attempt}/${maxRetries})…`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries reached. Please try again.');
}

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

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType, data: imageB64 } },
        { text: colorPrompt },
      ]}],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: 'high' as any },
        temperature: 1,
        maxOutputTokens: 65536,
        topP: 0.85,
      },
    });
    onProgress('Parsing response...');
    const raw = extractText(response);
    const m = raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i); if (m) return m[0];
    const f = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/i); if (f) return f[1].trim();
    return raw.trim();
  }, onProgress, 5, 30000);
}

/* ── Open in new tab ── */
function openInTab(html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ── Inject JS into HTML ── */
function injectScripts(htmlCode: string, scriptTags: string): string {
  const trimmed = scriptTags.trim();
  // Insert before </body> if present, otherwise append
  if (htmlCode.includes('</body>')) return htmlCode.replace('</body>', `\n${trimmed}\n</body>`);
  return htmlCode + '\n' + trimmed;
}

/* ── JS System Prompt ── */
const JS_SYSTEM_PROMPT = `You are an elite JavaScript engineer and UI analyst. You receive a screenshot and the exact HTML/CSS code for that UI. Your mission: make EVERY SINGLE interactive element work, leaving zero dead elements. You think deeply before writing any code.

══════════════════════════════════════════════════════════════
SECTION 1 — MANDATORY PRE-CODE ANALYSIS PROTOCOL
══════════════════════════════════════════════════════════════

Before writing a SINGLE line of JavaScript, you MUST mentally complete this checklist by reading the HTML and studying the screenshot:

□ LIST every button, link, input, select, checkbox, radio, textarea, toggle, icon-button present
□ LIST every navigation item, tab, pill, breadcrumb, step indicator
□ LIST every panel, section, modal placeholder, drawer placeholder, tooltip placeholder
□ LIST every card, list item, table row — what can happen when you click them?
□ LIST every data display: counters/stats, progress bars, charts, ratings, badges
□ LIST every form — what does submitting it do in the context of this specific app?
□ IDENTIFY the type of application from the screenshot:
  (dashboard / file manager / CRM / e-commerce / social / chat / calendar / kanban / portfolio / landing page / SaaS settings / editor / player / tracker / etc.)
□ For EACH identified element, decide the correct behavior for THIS SPECIFIC APP TYPE

Only after completing this analysis do you write code.

══════════════════════════════════════════════════════════════
SECTION 2 — DESIGN RULES (match the existing visual system exactly)
══════════════════════════════════════════════════════════════

When you need to inject any new DOM element (tooltip, dropdown, context menu, mini-panel, etc.) — NOT full features, those are for the Features agent — you must match the existing design precisely:

▸ READ CSS custom properties from :root in the HTML (--color-*, --bg-*, --border-*, --radius-*, --font-*, etc.)
▸ USE var(--xxx) references in your injected elements' style
▸ If no CSS vars: read computed values from existing elements:
    const refCard = document.querySelector('.card') // or whatever exists
    const cs = getComputedStyle(refCard)
    // reuse cs.backgroundColor, cs.borderRadius, cs.fontFamily, cs.color, etc.
▸ Match border-radius EXACTLY (0px? 4px? 8px? 12px? pill?)
▸ Match font-family, font-size scale, font-weight from existing text elements
▸ Match the color palette: if the app is dark → your injected UI is dark; if light → light
▸ Match spacing density: if the app is dense/compact → your elements are compact
▸ For buttons: copy the exact padding, border, radius, background from an existing button
▸ NEVER introduce generic Bootstrap/Material/Tailwind-default aesthetics if they clash

DO NOT inject any new visual elements that break the layout. Use position:fixed or position:absolute for overlays.

══════════════════════════════════════════════════════════════
SECTION 3 — COMPLETE INTERACTION COVERAGE
══════════════════════════════════════════════════════════════

Your job is to wire ALL of these in a way that makes sense for the specific app detected:

NAVIGATION & ROUTING
- Nav links / sidebar items → scroll-to-section OR show/hide page sections OR hash routing
- Active state highlights follow the current page/section
- Mobile hamburger → sidebar slide-in/out
- Breadcrumbs → navigate back
- Back/forward buttons → history.back() or equivalent

TABS, PILLS & SEGMENTED CONTROLS
- Click → switch active tab, hide all panels, show correct one
- URL hash or data attribute maps tab to panel
- Tab with counter badge → badge updates on relevant action

DROPDOWNS & MENUS
- Click trigger → toggle panel, close on outside click, close on ESC
- Each option item → executes its action (filter, sort, select value, etc.)
- Multi-level menus → hover or click for sub-menu

MODALS & DIALOGS (lightweight ones — NOT full-featured modals, that's Features agent)
- Trigger → open existing modal/dialog placeholder
- Close on backdrop click, X button, ESC key
- Focus trap inside open modal

ACCORDIONS & EXPANDABLES
- Click header → expand/collapse content with smooth height animation (max-height transition)
- Multiple open vs single open — detect from design

CAROUSELS & SLIDERS
- Prev/next arrows → slide items
- Dot indicators → click to jump to slide
- Auto-play with pause on hover
- Touch/drag support with pointer events

FORMS & INPUTS
- Real-time validation (required fields, email format, min length, etc.)
- Show/hide error messages inline under each field
- Submit → show loading state on button, then success/error state
- Character counters for textareas
- Password show/hide toggle

COUNTERS, STATS & PROGRESS
- Numbers in stat cards → animate count-up from 0 via IntersectionObserver
- Progress bars → animate width on scroll into view
- Circular progress → animate stroke-dashoffset
- Countdown timers → live countdown if present

INTERACTIVE TABLES & LISTS
- Row click → highlight/select
- Sortable column headers → sort rows by that column (asc/desc toggle, arrow indicator)
- Row checkbox → select/deselect, update "select all" header checkbox
- Inline action buttons (edit icon, delete icon, etc.) → visual feedback

SEARCH & FILTER
- Input → filter visible list/table rows in real-time (case-insensitive match)
- Clear button → reset filter
- Filter chips/tags → toggle filter, update results
- Empty state message when no results

TOGGLES & SWITCHES
- Click → toggle boolean state, update visual indicator
- Apply effect immediately (show/hide element, change theme, enable/disable something)

RATINGS & REVIEWS
- Star rating → click to rate (highlight up to clicked star), hover preview
- Show selected rating value

TOOLTIPS
- Hover (desktop) / click (touch) → show tooltip near element
- Position correctly (flip if near edge)
- Auto-dismiss after 3s or on mouseout

DRAG & DROP (UI layer only — actual data handling is Features agent)
- Draggable items → cursor:grab, visual feedback while dragging
- Drop zones → highlight on drag-over
- Reorder within a list with placeholder preview

COPY & SHARE
- Copy buttons → copy target text to clipboard, show "Copied!" feedback for 2s
- Share buttons → Web Share API if available, fallback to clipboard

THEME & APPEARANCE
- Dark/light mode toggle → toggle class on <html> or <body>, persist to localStorage
- Color scheme selector → apply CSS variable overrides, persist

SCROLL EFFECTS
- Sticky headers → add class when scrolled past threshold
- Scroll-to-top button → show after 300px scroll, smooth scroll on click
- Elements with animation classes → trigger via IntersectionObserver

KEYBOARD ACCESSIBILITY
- Tab focus → visible focus ring on all interactive elements
- Enter/Space on custom buttons
- Arrow keys for menus/tabs
- ESC closes any open overlay

══════════════════════════════════════════════════════════════
SECTION 4 — TECHNICAL RULES
══════════════════════════════════════════════════════════════

- Use ONLY classNames and IDs that EXIST in the provided HTML. Never invent selectors.
- Guard every querySelector: if (!el) return; — never assume an element exists
- Wrap everything in DOMContentLoaded
- Use a single IIFE to avoid polluting globals
- No TypeScript, no JSX, no import statements — pure ES2020+ vanilla JS in <script> tags
- Load CDN libraries by injecting <script src="..."> tags dynamically into <head>
- CDNs available: GSAP, Chart.js, SortableJS, flatpickr, Toastify, Hammer.js
- Use only what the detected app type actually needs

OUTPUT: Raw <script>...</script> blocks ONLY. Zero prose before or after.`;

/* ── Gemini JS Call ── */
async function callGeminiJS(
  apiKey: string, imageB64: string, mimeType: string, htmlCode: string,
  onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Analyzing UI for JS generation...');

  const userMsg = `STEP 1 — IDENTIFY THE APP TYPE from the screenshot. Name it explicitly.

STEP 2 — LIST every interactive element you see in both the screenshot AND the HTML code. For each, state what it should do in this specific app.

STEP 3 — Write <script>...</script> tags that implement ALL of the above. Leave zero dead elements.

Here is the complete HTML/CSS:

\`\`\`html
${htmlCode}
\`\`\`

REMINDER: Use ONLY selectors that exist in the HTML above. Match the design system for any new injected elements (read CSS variables from :root). Output ONLY <script>...</script> tags.`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType, data: imageB64 } },
        { text: userMsg },
      ]}],
      config: {
        systemInstruction: JS_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: 'high' as any },
        temperature: 1,
        maxOutputTokens: 32768,
        topP: 0.9,
      },
    });
    onProgress('Parsing JS response...');
    const raw = extractText(response);
    const scripts = [...raw.matchAll(/<script[\s\S]*?<\/script>/gi)].map(m=>m[0]).join('\n');
    if (scripts) return scripts;
    if (raw.includes('document.') || raw.includes('addEventListener') || raw.includes('querySelector')) {
      return `<script>\n${raw.trim()}\n</script>`;
    }
    return raw.trim();
  }, onProgress, 5, 20000);
}

/* ── Features System Prompt ── */
const FEATURES_SYSTEM_PROMPT = `You are a senior full-stack JavaScript architect. Your role is to build REAL, WORKING application features on top of an existing HTML/CSS/JS page — without ever breaking its visual design.

══════════════════════════════════════════════════════════════
SECTION 1 — ABSOLUTE DOM SAFETY RULES (NEVER VIOLATE THESE)
══════════════════════════════════════════════════════════════

These rules prevent CSS breakage. Violating them destroys the visual design.

❌ NEVER use innerHTML/outerHTML to replace the content of any EXISTING element in the page.
   Doing so strips all CSS classes from the replaced children. This is the #1 cause of broken styles.
   → Instead: use createElement + appendChild / insertAdjacentHTML('beforeend') / prepend()

❌ NEVER touch, remove, overwrite, or re-inject <style> tags, <link> tags, or <script> tags that already exist.

❌ NEVER call document.body.innerHTML = ... or document.documentElement.innerHTML = ...

❌ NEVER use document.write() inside feature scripts.

❌ NEVER reset, reassign, or remove className on existing elements unless toggling a specific single class.

✅ TO ADD new content into an existing list/grid:
   - Clone an existing item: const clone = existingItem.cloneNode(true)
   - Modify the clone's text content and data attributes
   - Append: container.appendChild(clone) or container.insertAdjacentElement('afterbegin', clone)

✅ TO CREATE modals / overlays / toasts / drawers:
   - Create with document.createElement, build structure with JS
   - Append ONLY to document.body, never inside existing layout containers
   - Use position: fixed so they float above everything

✅ TO UPDATE text in an existing element: use element.textContent = ... NOT innerHTML.

✅ TO SHOW/HIDE elements: toggle CSS classes or set element.style.display / element.style.visibility.

══════════════════════════════════════════════════════════════
SECTION 2 — DESIGN CONSISTENCY (CRITICAL)
══════════════════════════════════════════════════════════════

Every new DOM element you create (modals, panels, toasts, drawers, chips, badges, context menus) MUST feel native to the existing app. The user must not be able to tell which elements were original vs added by you.

▸ STEP 1 — EXTRACT THE DESIGN SYSTEM FROM THE HTML/CSS:
  Before writing any DOM injection code, read the provided HTML and extract:
  - CSS custom properties from :root (e.g. --bg-primary, --accent, --text-muted, --radius, etc.)
  - The exact background colors used on cards/panels (read from style or class)
  - The exact border styles used (color, width, radius)
  - The exact font-family, font-size scale, font-weight used
  - The exact color used for primary buttons, secondary buttons, danger actions
  - The exact padding scale (are things tight/dense or spacious?)
  - The exact border-radius values (sharp 0px? soft 4px? pill 999px?)

▸ STEP 2 — BUILD NEW ELEMENTS USING THOSE VALUES:
  - Reference CSS variables with var(--xxx) whenever they exist in the page
  - If no CSS variables: read the computed value from an existing element:
    const style = getComputedStyle(document.querySelector('.some-card'))
    const bg = style.backgroundColor  // then reuse this
  - Copy the exact border, border-radius, font, color from existing similar elements
  - Match button styles exactly: same padding, same radius, same font-weight, same hover state

▸ STEP 3 — NEVER introduce a foreign design system:
  - No Bootstrap, no Material UI defaults, no Tailwind reset
  - No generic gray #f5f5f5 backgrounds if the app is dark-themed
  - No generic blue #007bff if the app uses a different accent
  - No generic 4px radius if the app uses 0px or 12px

▸ MODAL EXAMPLE (dark app with CSS vars):
  const modal = document.createElement('div')
  modal.style.cssText = \`
    position:fixed; inset:0; z-index:9999;
    background: rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center;
  \`
  const panel = document.createElement('div')
  panel.style.cssText = \`
    background: var(--bg-surface, #1a1a2e);
    border: 1px solid var(--border-color, rgba(255,255,255,0.08));
    border-radius: var(--radius, 8px);
    padding: 20px; min-width: 320px;
    font-family: inherit; color: var(--text-primary, #e2e8f0);
  \`

══════════════════════════════════════════════════════════════
SECTION 3 — FEATURE SCOPE (OPEN-ENDED — BUILD EVERYTHING)
══════════════════════════════════════════════════════════════

Look at the screenshot and the HTML. Identify EVERY element, button, input, zone, or implied workflow that suggests a real feature, then BUILD IT — regardless of what type of application it is.

You are not limited to any category. The application could be:
a project manager, a file browser, a dashboard, a social app, a CRM, an e-commerce admin, a kanban board, a note-taking app, a calendar, a code editor, a chat app, a design tool, a music player, a video platform, a travel app, a health tracker, a game UI, a landing page builder, a settings panel, a documentation site, an analytics suite, a crypto tracker, a recruitment tool, an AI tool, a restaurant app, or anything else. You adapt fully to whatever the UI is.

FOR EVERY IDENTIFIED FEATURE, BUILD:
- The trigger (click, hover, key, scroll, drag, input event)
- The DOM output (modal, drawer, toast, inline edit, new row, expanded panel, etc.) — built safely per Section 1
- The data logic (read from localStorage, compute, transform, filter, sort)
- The persistence (save result to localStorage with ppai_feat_ prefix)
- The visual feedback (loading state, success confirmation, error state, empty state)
- The teardown (close button, ESC key, click-outside, auto-dismiss)

USE CDNs FREELY when a feature benefits from a library:
  Load by injecting: const s=document.createElement('script'); s.src='URL'; document.head.appendChild(s)
  - SortableJS: https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js
  - Chart.js: https://cdn.jsdelivr.net/npm/chart.js
  - Flatpickr: https://cdn.jsdelivr.net/npm/flatpickr + its CSS
  - Quill: https://cdn.quilljs.com/1.3.6/quill.min.js + its CSS
  - Fuse.js: https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js
  - Marked.js (markdown): https://cdn.jsdelivr.net/npm/marked/marked.min.js
  - Prism.js (syntax highlight): https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js
  - Hammer.js (touch/gestures): https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js

══════════════════════════════════════════════════════════════
SECTION 4 — COEXISTENCE WITH SCRIPT #1
══════════════════════════════════════════════════════════════

Script #1 already handles UI interactions (tabs, dropdowns, hover states, etc.).
YOUR role is the NEXT LAYER: actual product features and data operations.

- Read Script #1 carefully. Do NOT re-bind events it already binds.
- If Script #1 opens an empty modal → your job is to put real form fields inside it (safely, not with innerHTML).
- If Script #1 enables a drag zone → your job is to handle the dropped File objects and process them.
- If Script #1 adds a class to a button → your job is to actually execute the action that button implies.
- Wrap all your code in DOMContentLoaded and a self-contained IIFE.
- Prefix all localStorage keys with "ppai_feat_".

OUTPUT ONLY <script> tags. Nothing else. No prose, no CSS outside scripts, no HTML outside scripts.`;

/* ── Gemini Features Call ── */
async function callGeminiFeatures(
  apiKey: string, imageB64: string, mimeType: string,
  htmlCode: string, jsScript1: string,
  onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Analyzing features to build...');

  const userMsg = `STEP 1 — Identify the application type from the screenshot. State it explicitly.

STEP 2 — List EVERY feature-implying element visible in the screenshot AND the HTML:
  - Every action button ("Create", "Add", "Delete", "Upload", "Save", "Invite", "Export", "Import", etc.)
  - Every form that should submit data and affect state
  - Every list/table/grid that should be editable (add/edit/delete/reorder items)
  - Every upload zone that should handle real File objects
  - Every chart/graph placeholder that should show real data
  - Every data that should persist across page refreshes
  - Every workflow or multi-step process visible

STEP 3 — For each item listed in Step 2, build the complete JavaScript feature.

Here is the HTML/CSS (read the CSS variables, colors, fonts, spacing — your injected elements MUST match):

\`\`\`html
${htmlCode}
\`\`\`

Here is Script #1 — already handles UI interactions — do NOT re-bind what it binds, BUILD ON TOP:

\`\`\`javascript
${jsScript1}
\`\`\`

ABSOLUTE RULES:
- NEVER use innerHTML/outerHTML to modify existing elements (destroys CSS classes)
- NEVER touch existing <style> or <link> tags
- Build new DOM safely: createElement + appendChild only
- Append overlays (modals, toasts) ONLY to document.body with position:fixed
- Match the design system EXACTLY using var(--css-vars) or getComputedStyle from existing elements
- Persist all data to localStorage with "ppai_feat_" prefix
- Reload and render persisted data on DOMContentLoaded

Output ONLY <script>...</script> tags.`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType, data: imageB64 } },
        { text: userMsg },
      ]}],
      config: {
        systemInstruction: FEATURES_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: 'high' as any },
        temperature: 1,
        maxOutputTokens: 65536,
        topP: 0.95,
      },
    });
    onProgress('Parsing features response...');
    const raw = extractText(response);
    const scripts = [...raw.matchAll(/<script[\s\S]*?<\/script>/gi)].map(m=>m[0]).join('\n');
    if (scripts) return scripts;
    if (raw.includes('document.') || raw.includes('addEventListener') || raw.includes('localStorage')) {
      return `<script>\n${raw.trim()}\n</script>`;
    }
    return raw.trim();
  }, onProgress, 5, 20000);
}
/* ── Next.js System Prompt ── */
const NEXTJS_SYSTEM_PROMPT = `You are a Next.js 15 TypeScript conversion engineer. Convert a complete HTML/CSS/JavaScript page into a Next.js 15 App Router TypeScript project.

THE FUNDAMENTAL ARCHITECTURE RULE:
  JSX = HTML STRUCTURE ONLY — no event handlers, no behavior, no state
  useEffect = ALL interactivity, ALL event listeners, ALL DOM behavior
This guarantees every querySelector in the JS finds the exact element it expects.

OUTPUT FORMAT — raw JSON only, no markdown fences:
{ "files": [ { "path": "app/page.tsx", "content": "..." }, ... ] }

Always include: app/page.tsx · app/globals.css · app/layout.tsx · next.config.mjs

══════════════════════════════════════════════════════════════
SECTION 1 — HTML → JSX (structure only, minimum changes)
══════════════════════════════════════════════════════════════

Required syntactic changes ONLY:
  class="..."        → className="..."
  for="..."          → htmlFor="..."
  <img> <input> <br> <hr> <link>  → self-closing with />
  style="color:red"  → style={{color:'red', fontSize:'14px'}} (camelCase props)
  HTML comments      → {/* comment */}
  <script> tags      → REMOVE entirely from JSX
  <style> tags       → REMOVE entirely from JSX

❌ NEVER add onClick, onChange, onSubmit, onMouseEnter, onKeyDown or ANY event prop to JSX
❌ NEVER add useState for toggling classes, showing/hiding, tabs, etc.
❌ NEVER add ref={...} to any JSX element
❌ NEVER convert behavior to React-controlled state
✅ Preserve EVERY class name and id EXACTLY as in the original HTML
✅ Preserve EVERY data-* attribute exactly
✅ Preserve the complete HTML tree structure, nesting, and element order

Why: the JS scripts use document.querySelector('.my-class') — if class names change, nothing works.

══════════════════════════════════════════════════════════════
SECTION 2 — CSS (verbatim, zero changes)
══════════════════════════════════════════════════════════════

app/globals.css:
- Prepend: html, body { margin: 0; padding: 0; width: 100%; min-height: 100vh; }
- Then copy ALL <style> tag content VERBATIM — not one character changed
- Keep ALL :root{} variables, @keyframes, @media, pseudo-classes, custom selectors
- CDN stylesheets (<link rel="stylesheet" href="...cdn...">) → <link> tags in layout.tsx <head>

══════════════════════════════════════════════════════════════
SECTION 3 — JAVASCRIPT → TYPESCRIPT IN useEffect
══════════════════════════════════════════════════════════════

You receive Script #1 (UI interactions) and Script #2 (application features).
Both go into a single useEffect. Here is the exact process:

▸ STEP A — PRE-ANALYSIS (do this mentally before writing)
  Scan both scripts. List every querySelector / getElementById / querySelectorAll call.
  Confirm that each targeted class/id/element exists in the JSX you are generating.
  If any selector references a class that you are about to change → DON'T change it.

▸ STEP B — UNWRAP WRAPPERS
  These patterns exist in the scripts. Remove the wrapper, keep the inner body:
    document.addEventListener('DOMContentLoaded', function() { BODY })  → just BODY
    document.addEventListener('DOMContentLoaded', () => { BODY })        → just BODY
    window.addEventListener('load', () => { BODY })                       → just BODY
    (function() { BODY })()                                               → just BODY
    (() => { BODY })()                                                     → just BODY

▸ STEP C — CDN SCRIPTS
  Any library loaded via <script src="https://..."> must be loaded dynamically and AWAITED
  before the main JS runs. Use this helper inside the run() function:

    const loadScript = (src: string): Promise<void> => new Promise((resolve) => {
      if (document.querySelector(\`script[src="\${src}"]\`)) { resolve(); return; }
      const s = document.createElement('script'); s.src = src;
      s.onload = () => resolve(); s.onerror = () => resolve();
      document.head.appendChild(s);
    });

  Await ALL CDN scripts before any line of the main JS runs.

▸ STEP D — TYPESCRIPT TYPING (minimal, compile-focused)
  - DOM queries: document.querySelector<HTMLElement>('.selector')
  - Null guards:
      const el = document.querySelector<HTMLElement>('.btn');
      if (!el) return;
  - Events: element.addEventListener('click', (e: Event) => { ... })
  - CDN globals: (window as any).gsap  ·  (window as any).Chart  ·  (window as any).Sortable
  - Use 'as any' liberally to bypass TypeScript errors — the goal is compilation, not perfect types

▸ STEP E — ASSEMBLE app/page.tsx

'use client';
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    const loadScript = (src: string): Promise<void> => new Promise((resolve) => {
      if (document.querySelector(\`script[src="\${src}"]\`)) { resolve(); return; }
      const s = document.createElement('script'); s.src = src;
      s.onload = () => resolve(); s.onerror = () => resolve();
      document.head.appendChild(s);
    });

    const run = async (): Promise<void> => {
      // ── Load ALL CDN scripts first (order matters) ──────────
      // await loadScript('https://cdnjs.cloudflare.com/...');

      // ── Script #1: UI Interactions ──────────────────────────
      // [Script #1 body — DOMContentLoaded unwrapped, TypeScript typed]

      // ── Script #2: Application Features ─────────────────────
      // [Script #2 body — DOMContentLoaded unwrapped, TypeScript typed]
    };

    run().catch(console.error);
  }, []);

  return (
    <>
      {/* JSX — structure only, NO event handlers */}
    </>
  );
}

══════════════════════════════════════════════════════════════
SECTION 4 — FIXED CONFIG FILES
══════════════════════════════════════════════════════════════

next.config.mjs — ALWAYS exactly this content:
  /** @type {import('next').NextConfig} */
  const nextConfig = { reactStrictMode: false };
  export default nextConfig;

  reactStrictMode: false is MANDATORY — prevents useEffect from running twice in dev,
  which would double-bind all event listeners and break the page.

app/layout.tsx:
  import type { Metadata } from 'next';
  import './globals.css';
  export const metadata: Metadata = { title: 'App', description: 'Generated App' };
  export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
      <html lang="en">
        <head>{/* CDN <link rel="stylesheet"> here if original had them */}</head>
        <body>{children}</body>
      </html>
    );
  }

══════════════════════════════════════════════════════════════
SECTION 5 — FINAL CHECKLIST (verify before outputting)
══════════════════════════════════════════════════════════════

□ EVERY class= → className= (scan the entire JSX)
□ All void elements self-close with />
□ ZERO onClick/onChange/onSubmit/on* props anywhere in JSX
□ ZERO useState in the component
□ ALL original class names and ids preserved verbatim
□ CSS is 100% verbatim in globals.css
□ ALL CDN scripts are loaded with await loadScript() before any JS code runs
□ DOMContentLoaded/IIFE wrappers all removed from JS
□ (window as any) used for all CDN library globals
□ reactStrictMode: false in next.config.mjs
□ Output is valid parseable JSON (properly escape template literals and backslashes)
□ No TypeScript error that blocks compilation (use 'as any' everywhere needed)`;

function parseNextjsFiles(raw: string): NextJSFile[] {
  const clean = raw.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/i,'').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in NextJS response');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.files)) throw new Error('Invalid response: missing files array');
  return parsed.files as NextJSFile[];
}

async function callGeminiNextJS(
  apiKey: string, imageB64: string, mimeType: string,
  htmlCode: string, jsCode: string, featuresCode: string,
  onProgress: (s: string) => void,
): Promise<NextJSFile[]> {
  onProgress('Analyzing UI for Next.js conversion...');

  // Extract raw JS bodies from <script> tags
  const extractJS = (src: string): string =>
    [...src.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1].trim()).filter(Boolean).join('\n\n');

  // Extract CDN script URLs from <script src="...">
  const extractCDNScripts = (src: string): string[] =>
    [...src.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

  const js1 = extractJS(jsCode);
  const allFeatScripts = featuresCode ? [...featuresCode.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1].trim()).filter(Boolean) : [];
  const htmlScripts = [...htmlCode.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1].trim());
  const js2 = allFeatScripts.filter(s => !htmlScripts.includes(s) && s.trim() !== js1.trim()).join('\n\n');

  // Collect all CDN script URLs referenced across all layers
  const cdnUrls = [
    ...extractCDNScripts(htmlCode),
    ...extractCDNScripts(jsCode),
    ...extractCDNScripts(featuresCode || ''),
  ].filter((u, i, a) => u && a.indexOf(u) === i);

  const userMsg = `TASK: Convert this page to a Next.js 15 TypeScript project.

IMPORTANT — Follow these steps in order:

STEP 1: Scan Script #1 and Script #2. List every querySelector/getElementById selector used.
STEP 2: Generate the JSX. Verify every selector from Step 1 has its target element with the exact original class/id.
STEP 3: Generate useEffect with all JS. Verify CDN scripts are awaited before any main code.
STEP 4: Output the JSON.

═══ ORIGINAL HTML (convert structure to JSX, ZERO event handlers in JSX) ═══
\`\`\`html
${htmlCode}
\`\`\`

═══ CDN SCRIPTS TO LOAD (await each one before running main JS) ═══
${cdnUrls.length > 0 ? cdnUrls.map(u => `- ${u}`).join('\n') : '(none detected — check the HTML above for any <script src>)'}

═══ SCRIPT #1 — UI Interactions (unwrap DOMContentLoaded, convert to TypeScript) ═══
\`\`\`javascript
${js1 || '// none'}
\`\`\`

═══ SCRIPT #2 — Application Features (unwrap DOMContentLoaded, convert to TypeScript) ═══
\`\`\`javascript
${js2 || '// none'}
\`\`\`

REMINDER:
- NO onClick/onChange/on* props in JSX — ALL events via addEventListener in useEffect
- NO useState — ALL state via direct DOM class/style manipulation in useEffect  
- Preserve EVERY class name and id exactly
- Use (window as any).LibraryName for CDN globals
- Output raw JSON only`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{role:'user', parts:[
        {inlineData:{mimeType, data:imageB64}},
        {text: userMsg},
      ]}],
      config: {
        systemInstruction: NEXTJS_SYSTEM_PROMPT,
        thinkingConfig: {thinkingLevel: 'high' as any},
        temperature: 1, maxOutputTokens: 65536, topP: 0.9,
      },
    });
    onProgress('Parsing Next.js files...');
    return parseNextjsFiles(extractText(response));
  }, onProgress, 5, 25000);
}

async function fixNextJSBuildErrors(
  apiKey: string, files: NextJSFile[], buildErrors: string,
  onProgress: (s: string) => void,
): Promise<NextJSFile[]> {
  onProgress('Fixing build errors...');
  const filesBlock = files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

  const userMsg = `Fix the TypeScript/build errors in this Next.js project.

BUILD ERRORS:
\`\`\`
${buildErrors.slice(0, 8000)}
\`\`\`

CURRENT FILES:
${filesBlock}

RULES — fix ONLY the errors, change nothing else:
1. Use 'as any' / 'as HTMLElement' / 'as HTMLInputElement' type casts to silence TS errors
2. Add null checks: if (!el) return; or if (!el) continue;
3. Replace (window as any).LibraryName for any undefined CDN globals
4. Ensure reactStrictMode: false in next.config.mjs
5. Do NOT add onClick/onChange/on* props to JSX — keep all events in useEffect
6. Do NOT change any class names or ids in JSX
7. Do NOT change CSS in globals.css
8. If a CDN script URL is causing issues, use: (window as any).GSAP ?? (window as any).gsap

Output complete corrected JSON files array. Raw JSON only, no markdown.`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{role:'user', parts:[{text: userMsg}]}],
      config: {
        systemInstruction: NEXTJS_SYSTEM_PROMPT,
        thinkingConfig: {thinkingLevel: 'high' as any},
        temperature: 1, maxOutputTokens: 65536, topP: 0.85,
      },
    });
    onProgress('Parsing fixed files...');
    return parseNextjsFiles(extractText(response));
  }, onProgress, 3, 20000);
}

/* ── Manager Agent ── */
const MANAGER_PROMPT = `You are an orchestration agent for a UI generation system. Analyze the user message and decide which pipeline to trigger.

OUTPUT: Raw JSON ONLY — no markdown, no backticks, no explanation.
Format: { "route": "generate" | "html_js" | "html_nextjs" | "nextjs" | "chat", "reasoning": "one sentence" }

ROUTES:
"generate"    → User wants to build/generate a new app from scratch (first generation). Triggers when they describe a UI, say "create", "build", "generate", "make me", or attach an image with a description.
"html_js"     → Add a feature achievable entirely client-side. UI snippet + JS interaction + JS features agents. Examples: dark mode toggle, modal, chart, filter, animation, form validation, carousel, tab system, search, localStorage state, any visual interactive component.
"html_nextjs" → Feature needs a UI component PLUS server-side logic. HTML agent designs the UI, then Next.js agent implements the logic in React TypeScript. Examples: form that sends email, real API data fetch, file upload to server, auth login form, database CRUD.
"nextjs"      → Pure server infrastructure, no significant new UI needed. Examples: new API route, server action, middleware, authentication flow, database migration, environment config.
"chat"        → User is asking a question, giving feedback, saying thanks, asking how something works, or anything not triggering generation. Respond conversationally.

IMPORTANT: When in doubt between html_js and html_nextjs, pick html_js. Most UI features work client-side.
IMPORTANT: "generate" is ONLY for initial full-page creation, not for adding features to existing projects.`;

type PipelineRoute = 'generate' | 'html_js' | 'html_nextjs' | 'nextjs' | 'chat';
interface ManagerDecision { route: PipelineRoute; reasoning: string; reply?: string; }

async function callGeminiManager(
  apiKey: string,
  userMessage: string,
  hasImage: boolean,
  hasExistingProject: boolean,
  onProgress: (s: string) => void,
): Promise<ManagerDecision> {
  onProgress('Manager thinking…');
  const ctx = `Context: user ${hasImage ? 'HAS attached an image' : 'has NO image'}. ${hasExistingProject ? 'An app has already been generated.' : 'No app generated yet.'}`;
  const userMsg = `${ctx}\nUser message: "${userMessage}"\n\nOutput raw JSON only: { "route": "...", "reasoning": "..." }`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      config: {
        systemInstruction: MANAGER_PROMPT,
        thinkingConfig: { thinkingLevel: 'medium' as any },
        temperature: 1, maxOutputTokens: ,8545, topP: 0.9,
      },
    });
    const raw = extractText(response);
    // Robust JSON extraction — strip anything that's not the JSON object
    const cleaned = raw
      .replace(/^```(?:json)?\s*/gim, '')
      .replace(/```\s*$/gim, '')
      .trim();
    const m = cleaned.match(/\{[\s\S]*?\}/);
    if (!m) {
      // Fallback: infer route from keywords
      const lower = userMessage.toLowerCase();
      if (lower.includes('api') || lower.includes('database') || lower.includes('auth') || lower.includes('server')) {
        return { route: 'nextjs', reasoning: 'Server-side feature detected (fallback)' };
      }
      return { route: 'html_js', reasoning: 'Client-side feature assumed (fallback)' };
    }
    try {
      const parsed = JSON.parse(m[0]);
      return { route: parsed.route || 'html_js', reasoning: parsed.reasoning || '' };
    } catch {
      return { route: 'html_js', reasoning: 'JSON parse fallback' };
    }
  }, onProgress, 3, 10000);
}

/* ── Chat responder (when route = 'chat') ── */
async function callGeminiChat(
  apiKey: string,
  history: { role: 'user'|'ai'; content: string }[],
  userMessage: string,
  hasProject: boolean,
): Promise<string> {
  const systemMsg = `You are the AI assistant of Pixel Perfect AI, a vibe-coding platform. You help users build web apps from screenshots using Gemini AI. ${hasProject ? 'The user has an app currently generated.' : 'No app generated yet.'} Be concise, helpful, and friendly. If the user wants to build something, tell them to describe their app and attach a screenshot.`;
  const historyParts = history.slice(-6).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  const ai = getAI(apiKey);
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [...historyParts, { role: 'user', parts: [{ text: userMessage }] }] as any,
    config: { systemInstruction: systemMsg, temperature: 1, maxOutputTokens: 6524 },
  });
  return extractText(response);
}

/* ── Feature HTML Snippet prompt ── */
const FEATURE_HTML_SNIPPET_PROMPT = `You are a forensic UI component engineer. You receive an existing page HTML and a feature request. You generate ONLY the new HTML snippet(s) needed — no full page, no boilerplate.

OUTPUT: Raw HTML fragment only. No <!DOCTYPE>, no <html>, no <head>, no <body> wrapper.
Just the exact HTML elements to add.

DESIGN SYSTEM RULES (critical — the snippet must be invisible from the existing UI):
- Read the existing HTML carefully: extract colors, fonts, border-radius, spacing, component patterns
- Copy the exact same CSS variable references (var(--xxx)), class naming patterns, and element structures
- Match density: if the page is compact, your elements are compact
- Match the visual language: dark/light theme, shadow style, icon style, border style
- If the page uses a specific component pattern (card, list-item, modal overlay) — replicate it exactly
- Reuse existing class names where the same style applies
- DO NOT introduce a foreign design system

OUTPUT RULES:
- Include only the structural HTML for the new feature (a modal, a section, a panel, a form, etc.)
- Keep IDs and class names semantic and unique (prefix new ones with "feat-")
- Add style="" inline only if absolutely necessary and no existing class covers it
- CDN <script> or <link> tags needed for this feature → include them at the very top of your output
- No JavaScript in the output — that's handled by separate agents`;

async function callGeminiFeatureSnippet(
  apiKey: string,
  imageB64: string,
  mimeType: string,
  existingHtml: string,
  userRequest: string,
  onProgress: (s: string) => void,
): Promise<string> {
  onProgress('Designing feature HTML snippet…');
  const userMsg = `EXISTING PAGE HTML (read to extract design system):
\`\`\`html
${existingHtml.slice(0, 40000)}
\`\`\`

FEATURE REQUEST: ${userRequest}

Generate ONLY the HTML snippet for this feature. Match the existing design exactly.`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType, data: imageB64 } },
        { text: userMsg },
      ]}],
      config: {
        systemInstruction: FEATURE_HTML_SNIPPET_PROMPT,
        thinkingConfig: { thinkingLevel: 'high' as any },
        temperature: 0.1, maxOutputTokens: 16384, topP: 0.9,
      },
    });
    onProgress('Snippet ready');
    return extractText(response).trim();
  }, onProgress, 5, 20000);
}

/* ── Next.js Patch System Prompt ── */
const NEXTJS_PATCH_PROMPT = `You are a Next.js 15 TypeScript feature engineer. You receive an existing working Next.js project and a request to add or modify functionality. Your job is to return ONLY the files that need to be created or changed — nothing else.

OUTPUT FORMAT — raw JSON only, no markdown:
{ "files": [ { "path": "app/page.tsx", "content": "..." } ] }
Include ONLY files that are new or modified. Unchanged files must NOT appear in the output.

══════════════════════════════════════════════════════════════
ABSOLUTE RULES — DO NOT VIOLATE
══════════════════════════════════════════════════════════════

✅ ADD new TypeScript functions, new components, new useEffect logic, new helper files
✅ ADD new routes/pages (app/about/page.tsx, etc.) if requested
✅ EXTEND existing useEffect by appending new event listeners at the end
✅ ADD new CSS classes at the bottom of globals.css if needed
✅ ADD new entries to package.json dependencies if a new library is needed

❌ NEVER remove or rename existing HTML elements, classNames, or ids in JSX
❌ NEVER delete existing event listeners or functions from useEffect
❌ NEVER change existing CSS rules in globals.css
❌ NEVER add onClick/onChange/on* event props to JSX — use addEventListener in useEffect
❌ NEVER add useState to replace existing DOM manipulation
❌ NEVER change next.config.mjs unless strictly necessary

══════════════════════════════════════════════════════════════
HOW TO ADD FUNCTIONALITY
══════════════════════════════════════════════════════════════

For new interactivity → add addEventListener calls at the END of the existing useEffect run() function.
For new UI sections → append new JSX elements AFTER the existing content (don't restructure).
For new pages → create a new app/[route]/page.tsx file.
For new components → create app/components/NewComponent.tsx and import it.
For new API calls → create app/api/[route]/route.ts.
For new TypeScript utilities → create lib/utils.ts or similar.

Keep all existing DOM-targeting code intact so nothing breaks.`;

/* ── Gemini Next.js Patch Call ── */
async function callGeminiNextJSPatch(
  apiKey: string,
  existingFiles: NextJSFile[],
  userRequest: string,
  onProgress: (s: string) => void,
): Promise<NextJSFile[]> {
  onProgress('Analyzing patch request...');

  const filesBlock = existingFiles
    .map(f => `### ${f.path}\n\`\`\`tsx\n${f.content}\n\`\`\``)
    .join('\n\n');

  const userMsg = `Here is the existing Next.js project:

${filesBlock}

USER REQUEST:
${userRequest}

Return ONLY the files that need to be created or modified. Raw JSON only.`;

  return withGeminiRetry(async () => {
    const ai = getAI(apiKey);
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      config: {
        systemInstruction: NEXTJS_PATCH_PROMPT,
        thinkingConfig: { thinkingLevel: 'high' as any },
        temperature: 0.15, maxOutputTokens: 65536, topP: 0.9,
      },
    });
    onProgress('Parsing patch files...');
    return parseNextjsFiles(extractText(response));
  }, onProgress, 5, 20000);
}

const IcKey = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>;
const IcUpload = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IcEye = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcCode = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
const IcFolder = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
const IcJs = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M14 8v5a2 2 0 0 1-4 0"/><path d="M10 15v1"/></svg>;
const IcTrash = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const IcFeatures = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
const IcNextjs = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 15V9l7.745 10.65A9 9 0 1 1 19 17.657"/><path d="M15 12V9"/></svg>;
const IcPlay = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
const IcRefresh = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
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
  /* ── Project state ── */
  const [projects, setProjects]           = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string|null>(null);
  const [showProjects, setShowProjects]   = useState(false);
  /* ── JS Generation state ── */
  const [jsCode, setJsCode]               = useState('');
  const [fullCode, setFullCode]           = useState(''); // html + injected js
  const [generatingJs, setGeneratingJs]   = useState(false);
  const [jsProgress, setJsProgress]       = useState('');
  const [jsError, setJsError]             = useState('');
  /* ── Features Generation state ── */
  const [featuresCode, setFeaturesCode]   = useState('');
  const [generatingFeatures, setGeneratingFeatures] = useState(false);
  const [featuresProgress, setFeaturesProgress]     = useState('');
  const [featuresError, setFeaturesError]           = useState('');
  const [viewMode, setViewMode]           = useState<'html'|'full'|'features'>('html');
  /* ── Next.js Engine state ── */
  const [nextjsFiles, setNextjsFiles]     = useState<NextJSFile[]>([]);
  const [generatingNextjs, setGeneratingNextjs]     = useState(false);
  const [nextjsProgress, setNextjsProgress]         = useState('');
  const [nextjsError, setNextjsError]               = useState('');
  const [selectedNxFile, setSelectedNxFile]         = useState(0);
  /* ── Sandbox state ── */
  const SANDBOX_INIT: SandboxState = {id:null,url:null,step:'idle',logs:[],error:'',buildAttempts:0};
  const [sandbox, setSandbox]             = useState<SandboxState>(SANDBOX_INIT);
  const [showSandbox, setShowSandbox]     = useState(false);
  /* ── Patch state ── */
  const [patchPrompt, setPatchPrompt]     = useState('');
  const [patchFiles, setPatchFiles]       = useState<NextJSFile[]>([]);
  const [generatingPatch, setGeneratingPatch] = useState(false);
  const [patchProgress, setPatchProgress] = useState('');
  const [patchError, setPatchError]       = useState('');
  const [patchAddingFiles, setPatchAddingFiles] = useState(false);
  /* ── Manager decision state ── */
  const [managerDecision, setManagerDecision] = useState<ManagerDecision | null>(null);
  const [patchRoute, setPatchRoute]           = useState<'html'|'nextjs'|null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  /* ── Chat state ── */
  const [messages, setMessages]           = useState<ChatMessage[]>([
    { id: '0', role: 'ai', type: 'text', content: 'Hi! I\'m Pixel Perfect AI. Upload a screenshot and describe your app, and I\'ll build it for you — HTML, JavaScript, features, and a full Next.js project.' }
  ]);
  const [chatInput, setChatInput]         = useState('');
  const [isSending, setIsSending]         = useState(false);

  // Load API key + projects on mount
  useEffect(() => {
    dbGet('gemini_key').then(k => { if (k) { setApiKey(k); setTempKey(k); setKeySaved(true); } else setShowModal(true); });
    dbGetAllProjects().then(setProjects);
  }, []);

  useEffect(() => {
    const content =
      viewMode === 'features' && featuresCode ? featuresCode :
      viewMode === 'full'     && fullCode     ? fullCode :
      code;
    if (!content) return;
    const iframe = iframeRef.current; if (!iframe) return;
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document; if (!doc) return;
    doc.open(); doc.write(content); doc.close();
  }, [code, fullCode, featuresCode, viewMode]);

  const saveKey = async () => { if (!tempKey.trim()) return; await dbSet('gemini_key', tempKey.trim()); setApiKey(tempKey.trim()); setKeySaved(true); setShowModal(false); };

  const loadProject = (p: Project) => {
    setCode(p.htmlCode);
    setJsCode(p.jsCode || '');
    setFullCode(p.fullCode || '');
    setFeaturesCode(p.featuresCode || '');
    setNextjsFiles(p.nextjsFiles || []);
    setActiveProjectId(p.id);
    setViewMode(p.featuresCode ? 'features' : p.fullCode ? 'full' : 'html');
    setTab('preview');
    setShowProjects(false);
    setImgUrl(p.imgDataUrl);
    setSandbox(SANDBOX_INIT);
    setShowSandbox(false);
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await dbDeleteProject(id);
    const updated = await dbGetAllProjects();
    setProjects(updated);
    if (activeProjectId === id) { setActiveProjectId(null); }
  };

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
    setGenerating(true); setError(''); setCode(''); setJsCode(''); setFullCode(''); setFeaturesCode(''); setNextjsFiles([]); setActiveProjectId(null); setViewMode('html'); setSandbox(SANDBOX_INIT);
    try {
      const html = await callGemini(apiKey, prompt, imgB64, imgMime, colorData, setProgress);
      setCode(html);
      setTab('preview');
      // Auto-save project
      const id = `proj_${Date.now()}`;
      const proj: Project = {
        id, name: `Project ${new Date().toLocaleString()}`,
        htmlCode: html, jsCode: '', fullCode: '',
        imgDataUrl: imgUrl, createdAt: Date.now(),
      };
      await dbSaveProject(proj);
      setActiveProjectId(id);
      setProjects(await dbGetAllProjects());
    }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Unknown error.'); }
    finally { setGenerating(false); setProgress(''); }
  };

  const generateJs = async () => {
    if (!apiKey) { setShowModal(true); return; }
    if (!code) { setJsError('Generate the HTML/CSS first.'); return; }
    if (!imgB64) { setJsError('Image required for JS generation.'); return; }
    setGeneratingJs(true); setJsError(''); setFeaturesCode('');
    try {
      const scripts = await callGeminiJS(apiKey, imgB64, imgMime, code, setJsProgress);
      const merged = injectScripts(code, scripts);
      setJsCode(scripts);
      setFullCode(merged);
      setViewMode('full');
      if (activeProjectId) await dbPatchProjectJs(activeProjectId, scripts, merged);
      setProjects(await dbGetAllProjects());
    }
    catch (err: unknown) { setJsError(err instanceof Error ? err.message : 'Unknown JS error.'); }
    finally { setGeneratingJs(false); setJsProgress(''); }
  };

  const generateFeatures = async () => {
    if (!apiKey) { setShowModal(true); return; }
    if (!code) { setFeaturesError('Generate the HTML/CSS first.'); return; }
    if (!jsCode) { setFeaturesError('Generate the JavaScript layer first.'); return; }
    if (!imgB64) { setFeaturesError('Image required for Features generation.'); return; }
    setGeneratingFeatures(true); setFeaturesError('');
    try {
      const scripts = await callGeminiFeatures(apiKey, imgB64, imgMime, code, jsCode, setFeaturesProgress);
      const baseWithJs1 = fullCode || injectScripts(code, jsCode);
      const merged = injectScripts(baseWithJs1, scripts);
      setFeaturesCode(merged);
      setViewMode('features');
      if (activeProjectId) await dbPatchProjectFeatures(activeProjectId, merged);
      setProjects(await dbGetAllProjects());
    }
    catch (err: unknown) { setFeaturesError(err instanceof Error ? err.message : 'Unknown Features error.'); }
    finally { setGeneratingFeatures(false); setFeaturesProgress(''); }
  };

  /* ── Generate Next.js ── */
  const generateNextjs = async () => {
    if (!apiKey) { setShowModal(true); return; }
    if (!code) { setNextjsError('Generate the HTML/CSS first.'); return; }
    if (!imgB64) { setNextjsError('Image required.'); return; }
    setGeneratingNextjs(true); setNextjsError(''); setNextjsFiles([]); setSelectedNxFile(0);
    try {
      const files = await callGeminiNextJS(
        apiKey, imgB64, imgMime, code, jsCode, featuresCode, setNextjsProgress
      );
      setNextjsFiles(files);
      setShowSandbox(true);
      if (activeProjectId) await dbPatchProjectNextjs(activeProjectId, files);
      setProjects(await dbGetAllProjects());
    }
    catch (err: unknown) { setNextjsError(err instanceof Error ? err.message : 'Unknown Next.js error.'); }
    finally { setGeneratingNextjs(false); setNextjsProgress(''); }
  };

  /* ── Sandbox API helper ── */
  /* ── Smart Patch — manager routes to correct pipeline ── */

  /* ── Write only patch files to sandbox ── */
  const applyPatchToSandbox = async () => {
    if (!sandbox.id) { sbErr('Create the sandbox first.'); return; }
    if (!patchFiles.length) { sbErr('Generate a patch first.'); return; }
    setPatchAddingFiles(true);
    sbLog(`⧖ Writing ${patchFiles.length} patch file(s) to sandbox…`);
    try {
      const res = await callSandbox({
        action: 'addFiles',
        sandboxId: sandbox.id,
        files: patchFiles.map(f => ({ filePath: f.path, content: f.content })),
      });
      if (!res.success) throw new Error(res.error || 'addFiles failed');
      sbLog(`✓ Patch applied: ${patchFiles.map(f => f.path).join(', ')}`);
      sbLog('⧖ Rebuilding…');
      await runSandboxBuild(sandbox.id, sandbox.buildAttempts);
    } catch (e: any) {
      sbErr(`Patch failed: ${e.message}`);
    } finally {
      setPatchAddingFiles(false);
    }
  };

  const callSandbox = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  };

  const sbLog = (msg: string) => setSandbox(s => ({ ...s, logs: [...s.logs, msg] }));
  const sbErr = (msg: string) => setSandbox(s => ({ ...s, error: msg, step: 'error' }));

  /* ── Run full sandbox pipeline ── */
  const runSandboxCreate = async () => {
    if (!nextjsFiles.length) { sbErr('Generate Next.js files first.'); return; }
    setSandbox({ id: null, url: null, step: 'creating', logs: ['⧖ Creating sandbox…'], error: '', buildAttempts: 0 });
    setShowSandbox(true);

    // 1. Create
    let sid: string;
    try {
      const res = await callSandbox({ action: 'create' });
      if (!res.sandboxId) throw new Error(res.error || 'No sandboxId returned');
      sid = res.sandboxId;
      setSandbox(s => ({ ...s, id: sid, logs: [...s.logs, `✓ Sandbox created: ${sid}`], step: 'adding' }));
    } catch (e: any) { sbErr(`Create failed: ${e.message}`); return; }

    await runSandboxAddFiles(sid, nextjsFiles, 0);
  };

  const runSandboxAddFiles = async (sid: string, files: NextJSFile[], buildAttempts: number) => {
    sbLog('⧖ Writing files to sandbox…');
    setSandbox(s => ({ ...s, step: 'adding', buildAttempts }));
    try {
      const res = await callSandbox({
        action: 'addFiles',
        sandboxId: sid,
        files: files.map(f => ({ filePath: f.path, content: f.content })),
      });
      if (!res.success) throw new Error(res.error || 'addFiles failed');
      sbLog(`✓ ${files.length} files written`);
    } catch (e: any) { sbErr(`addFiles failed: ${e.message}`); return; }

    await runSandboxInstall(sid, buildAttempts);
  };

  const runSandboxInstall = async (sid: string, buildAttempts: number) => {
    sbLog('⧖ Running npm install…');
    setSandbox(s => ({ ...s, step: 'installing' }));
    try {
      const res = await callSandbox({ action: 'install', sandboxId: sid });
      if (res.stdout) res.stdout.split('\n').filter(Boolean).forEach((l: string) => sbLog(l));
      if (res.stderr) res.stderr.split('\n').filter((l: string) => l.trim()).forEach((l: string) => sbLog(`⚠ ${l}`));
      sbLog('✓ Install complete');
    } catch (e: any) { sbErr(`Install failed: ${e.message}`); return; }

    await runSandboxBuild(sid, buildAttempts);
  };

  const runSandboxBuild = async (sid: string, buildAttempts: number) => {
    sbLog(`⧖ Building (attempt ${buildAttempts + 1}/3)…`);
    setSandbox(s => ({ ...s, step: 'building', buildAttempts }));
    let res: any;
    try {
      res = await callSandbox({ action: 'build', sandboxId: sid });
    } catch (e: any) { sbErr(`Build failed: ${e.message}`); return; }

    if (res.stdout) res.stdout.split('\n').filter(Boolean).forEach((l: string) => sbLog(l));

    if (!res.success) {
      const errors = (res.stderr || '') + '\n' + (res.stdout || '');
      sbLog(`✗ Build error (attempt ${buildAttempts + 1}/3)`);

      if (buildAttempts < 2 && apiKey) {
        sbLog('⧖ Sending errors to Gemini for fix…');
        setSandbox(s => ({ ...s, buildAttempts: buildAttempts + 1 }));
        try {
          const currentFiles = nextjsFiles; // capture current
          const fixed = await fixNextJSBuildErrors(apiKey, currentFiles, errors, msg => sbLog(msg));
          setNextjsFiles(fixed);
          if (activeProjectId) await dbPatchProjectNextjs(activeProjectId, fixed);
          sbLog(`✓ Fix applied — re-writing files and rebuilding…`);
          await runSandboxAddFiles(sid, fixed, buildAttempts + 1);
          return;
        } catch (fixErr: any) {
          sbLog(`⚠ Fix attempt failed: ${fixErr.message}`);
        }
      }
      sbErr('Build failed after max attempts. Check the errors above.');
      return;
    }

    sbLog('✓ Build successful!');
    await runSandboxStart(sid);
  };

  const runSandboxStart = async (sid: string) => {
    sbLog('⧖ Starting server…');
    setSandbox(s => ({ ...s, step: 'starting' }));
    try {
      const res = await callSandbox({ action: 'start', sandboxId: sid });
      if (res.stdout) res.stdout.split('\n').filter(Boolean).slice(-20).forEach((l: string) => sbLog(l));
      if (res.url) {
        setSandbox(s => ({ ...s, url: res.url, step: 'running' }));
        sbLog(`✓ Live at: ${res.url}`);
      } else {
        sbErr(`Start failed: ${res.error || 'No URL returned'}`);
      }
    } catch (e: any) { sbErr(`Start failed: ${e.message}`); }
  };

  /* ── Chat helpers ── */
  const addMsg = (msg: Omit<ChatMessage, 'id'>) => {
    const m = { ...msg, id: Date.now().toString() + Math.random() };
    setMessages(prev => [...prev, m]);
    setTimeout(() => chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
    return m.id;
  };
  const updateLastAiMsg = (content: string) => {
    setMessages(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'ai') { copy[i] = { ...copy[i], content }; break; }
      }
      return copy;
    });
  };

  /* ── Full generation pipeline (HTML → JS → Features → NextJS) ── */
  const fullGenerate = async () => {
    if (!imgB64 || !colorData) { addMsg({ role:'ai', type:'error', content:'Please attach a screenshot first.' }); return; }
    if (!apiKey) { setShowModal(true); return; }

    setGenerating(true); setCode(''); setJsCode(''); setFullCode(''); setFeaturesCode('');
    setNextjsFiles([]); setActiveProjectId(null); setViewMode('html'); setSandbox(SANDBOX_INIT);

    const progress = (s: string) => { setProgress(s); updateLastAiMsg(s); };

    try {
      // Step 1 — HTML
      addMsg({ role:'ai', type:'step', content:'Generating pixel-perfect HTML/CSS…', meta:'html' });
      const html = await callGemini(apiKey, prompt, imgB64, imgMime, colorData, progress);
      setCode(html); setTab('preview');
      updateLastAiMsg('✓ HTML/CSS generated');
      const id = `proj_${Date.now()}`;
      const proj: Project = { id, name: `Project ${new Date().toLocaleString()}`, htmlCode: html, jsCode: '', fullCode: '', featuresCode: '', nextjsFiles: [], imgDataUrl: imgUrl, createdAt: Date.now() };
      await dbSaveProject(proj); setActiveProjectId(id); setProjects(await dbGetAllProjects());

      // Step 2 — JS Interactions
      addMsg({ role:'ai', type:'step', content:'Wiring all interactions…', meta:'js' });
      const scripts = await callGeminiJS(apiKey, imgB64, imgMime, html, progress);
      const merged = injectScripts(html, scripts);
      setJsCode(scripts); setFullCode(merged); setViewMode('full');
      updateLastAiMsg('✓ JavaScript interactions ready');
      await dbPatchProjectJs(id, scripts, merged);

      // Step 3 — Features
      addMsg({ role:'ai', type:'step', content:'Building application features…', meta:'features' });
      const featScripts = await callGeminiFeatures(apiKey, imgB64, imgMime, html, scripts, progress);
      const featMerged = injectScripts(merged, featScripts);
      setFeaturesCode(featMerged); setViewMode('features');
      updateLastAiMsg('✓ Features & functionality built');
      await dbPatchProjectFeatures(id, featMerged);

      // Step 4 — Next.js
      addMsg({ role:'ai', type:'step', content:'Converting to Next.js TypeScript project…', meta:'nextjs' });
      const nxFiles = await callGeminiNextJS(apiKey, imgB64, imgMime, html, scripts, featMerged, progress);
      setNextjsFiles(nxFiles); setShowSandbox(true);
      updateLastAiMsg('✓ Next.js project ready');
      await dbPatchProjectNextjs(id, nxFiles); setProjects(await dbGetAllProjects());

      addMsg({ role:'ai', type:'result', content:`Your app is ready! ${nxFiles.length} Next.js files generated. Click **Create** in the sandbox panel to deploy it.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      addMsg({ role:'ai', type:'error', content:`Error: ${msg}` });
    } finally {
      setGenerating(false); setProgress('');
    }
  };

  /* ── Smart Patch pipeline ── */
  const smartPatch = async (userRequest: string) => {
    if (!apiKey) { setShowModal(true); return; }
    if (!nextjsFiles.length && !code) { addMsg({ role:'ai', type:'error', content:'Generate an app first before adding features.' }); return; }

    setPatchError(''); setPatchFiles([]); setManagerDecision(null); setPatchRoute(null);

    const progress = (s: string) => { setPatchProgress(s); updateLastAiMsg(s); };

    try {
      // Manager decides
      addMsg({ role:'ai', type:'step', content:'Analyzing your request…', meta:'manager' });
      const decision = await callGeminiManager(apiKey, userRequest, !!imgB64, !!code, progress);
      setManagerDecision(decision); setPatchRoute(decision.route);

      addMsg({ role:'ai', type:'decision',
        content: decision.route === 'html_js'     ? `🎨 HTML + JS pipeline — ${decision.reasoning}` :
                 decision.route === 'html_nextjs'  ? `🎨⚙️ HTML + Next.js pipeline — ${decision.reasoning}` :
                 decision.route === 'nextjs'        ? `⚙️ Next.js pipeline — ${decision.reasoning}` :
                 decision.route === 'chat'          ? decision.reasoning :
                                                     `🔄 Full generation — ${decision.reasoning}`,
        meta: decision.route });

      if (decision.route === 'chat') {
        const reply = await callGeminiChat(apiKey,
          messages.map(m=>({role:m.role,content:m.content})), userRequest, !!code);
        addMsg({ role:'ai', type:'text', content: reply });
        return;
      }

      if (decision.route === 'generate') {
        await fullGenerate(); return;
      }

      const baseHtml = code;
      if (!baseHtml) { addMsg({ role:'ai', type:'error', content:'No base HTML found. Generate an app first.' }); return; }

      if (decision.route === 'html_js' || decision.route === 'html_nextjs') {
        // Step A — Feature HTML snippet
        addMsg({ role:'ai', type:'step', content:'Designing feature UI (matching your design system)…', meta:'html' });
        const snippet = await callGeminiFeatureSnippet(apiKey, imgB64||'', imgMime||'image/png', baseHtml, userRequest, progress);
        const enrichedHtml = baseHtml.includes('</body>')
          ? baseHtml.replace('</body>', `\n<!-- FEATURE: ${userRequest} -->\n${snippet}\n</body>`)
          : baseHtml + `\n${snippet}`;
        updateLastAiMsg('✓ Feature UI designed');

        if (decision.route === 'html_js') {
          // Step B — JS Interactions on full enriched HTML
          addMsg({ role:'ai', type:'step', content:'Wiring interactions on new elements…', meta:'js' });
          const newJs1 = await callGeminiJS(apiKey, imgB64||'', imgMime||'image/png', enrichedHtml, progress);
          updateLastAiMsg('✓ Interactions wired');

          // Step C — JS Features
          addMsg({ role:'ai', type:'step', content:'Building feature logic…', meta:'features' });
          const newJs2 = await callGeminiFeatures(apiKey, imgB64||'', imgMime||'image/png', enrichedHtml, newJs1, progress);
          updateLastAiMsg('✓ Feature logic ready');

          // Step D — Convert enriched HTML + both JS layers to Next.js (page.tsx + globals only)
          addMsg({ role:'ai', type:'step', content:'Integrating into Next.js project…', meta:'nextjs' });
          const enrichedWithJs = injectScripts(injectScripts(enrichedHtml, newJs1), newJs2);
          const allFiles = await callGeminiNextJS(apiKey, imgB64||'', imgMime||'image/png', enrichedHtml, newJs1, enrichedWithJs, progress);
          const relevant = allFiles.filter(f => ['app/page.tsx','app/globals.css'].includes(f.path));
          setPatchFiles(relevant);
          const mergedMap = new Map(nextjsFiles.map(f=>[f.path,f]));
          relevant.forEach(f=>mergedMap.set(f.path,f));
          const merged = Array.from(mergedMap.values());
          setNextjsFiles(merged);
          if (activeProjectId) await dbPatchProjectNextjs(activeProjectId, merged);

        } else {
          // html_nextjs: Next.js agent designs + implements everything in TSX
          addMsg({ role:'ai', type:'step', content:'Next.js agent implementing server-side logic…', meta:'nextjs' });
          const patchReq = `${userRequest}\n\nHere is the new UI snippet to integrate:\n${snippet}`;
          const patched = await callGeminiNextJSPatch(apiKey, nextjsFiles, patchReq, progress);
          setPatchFiles(patched);
          const mergedMap = new Map(nextjsFiles.map(f=>[f.path,f]));
          patched.forEach(f=>mergedMap.set(f.path,f));
          setNextjsFiles(Array.from(mergedMap.values()));
          if (activeProjectId) await dbPatchProjectNextjs(activeProjectId, Array.from(mergedMap.values()));
        }

      } else {
        // Pure nextjs patch
        addMsg({ role:'ai', type:'step', content:'Next.js agent implementing…', meta:'nextjs' });
        const patched = await callGeminiNextJSPatch(apiKey, nextjsFiles, userRequest, progress);
        setPatchFiles(patched);
        const mergedMap = new Map(nextjsFiles.map(f=>[f.path,f]));
        patched.forEach(f=>mergedMap.set(f.path,f));
        setNextjsFiles(Array.from(mergedMap.values()));
        if (activeProjectId) await dbPatchProjectNextjs(activeProjectId, Array.from(mergedMap.values()));
      }

      setProjects(await dbGetAllProjects());
      addMsg({ role:'ai', type:'result',
        content:`✓ Feature added! ${patchFiles.length || '?'} file(s) updated. ${sandbox.id ? 'Click **Add Files** to deploy.' : 'Create the sandbox to deploy.'}` });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setPatchError(msg);
      addMsg({ role:'ai', type:'error', content:`Error: ${msg}` });
    } finally {
      setPatchProgress('');
    }
  };

  /* ── Send message (entry point for chat) ── */
  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text && !imgB64) return;
    if (isSending) return;
    setChatInput(''); setIsSending(true);
    addMsg({ role:'user', type:'text', content: text || '📎 (image attached)' });

    try {
      if (!apiKey) { addMsg({ role:'ai', type:'text', content:'Please set your Gemini API key first (top right).' }); return; }

      // First message with image and no project yet → full generate
      if (imgB64 && !code) {
        await fullGenerate(); return;
      }

      // Otherwise route through manager
      if (text) await smartPatch(text);
      else addMsg({ role:'ai', type:'text', content:'Image attached! Now describe what you want to build.' });
    } finally {
      setIsSending(false);
    }
  };

  const activeCode = () => viewMode==='features'&&featuresCode ? featuresCode : viewMode==='full'&&fullCode ? fullCode : code;
  const copyCode = async () => { if (!code) return; await navigator.clipboard.writeText(activeCode()); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const downloadCode = () => { if (!code) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([activeCode()],{type:'text/html'})); a.download = 'pixel-perfect.html'; a.click(); };

  return (
    <div className="flex flex-col h-screen bg-[#07070f] text-slate-200 font-mono overflow-hidden">
      {/* Hidden elements */}
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e=>{ const f=e.target.files?.[0]; if(f) processImage(f); }}/>

      {/* HEADER */}
      <header className="flex items-center justify-between px-4 h-11 border-b border-white/[0.06] bg-[#08081a]/90 backdrop-blur-xl shrink-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center text-xs shadow-[0_0_14px_rgba(0,229,255,0.25)] shrink-0">⬡</div>
          <p className="text-[12px] font-black tracking-tight bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent" style={{fontFamily:'system-ui'}}>PIXEL PERFECT AI</p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Projects dropdown */}
          <div className="relative">
            <button onClick={()=>setShowProjects(v=>!v)}
              className="flex items-center gap-1 text-[9px] border border-white/[0.07] text-slate-500 rounded px-2 py-1 hover:border-violet-500/40 hover:text-violet-400 transition-all cursor-pointer">
              <IcFolder/> Projects <span className="text-[7px] text-violet-700 bg-violet-950/50 rounded-full px-1">{projects.length}</span>
            </button>
            {showProjects && (
              <div className="absolute right-0 top-8 w-[280px] bg-[#0e0e1f] border border-white/[0.08] rounded-lg shadow-2xl z-50 overflow-hidden">
                <div className="max-h-[320px] overflow-y-auto">
                  {projects.length === 0
                    ? <p className="text-[9px] text-slate-700 px-3 py-4 text-center">No projects yet</p>
                    : projects.map(p => (
                        <div key={p.id} onClick={()=>loadProject(p)}
                          className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.03] border-b border-white/[0.03] last:border-0 ${activeProjectId===p.id?'bg-cyan-950/20':''}`}>
                          {p.imgDataUrl && <img src={p.imgDataUrl} className="w-8 h-6 object-cover rounded shrink-0 border border-white/[0.06]" alt=""/>}
                          <div className="flex-1 min-w-0">
                            <p className="text-[8.5px] text-slate-300 truncate">{p.name}</p>
                            <div className="flex gap-1 mt-0.5">
                              {p.jsCode && <span className="text-[6.5px] text-yellow-600 bg-yellow-950/30 border border-yellow-900/20 rounded px-1">JS</span>}
                              {p.featuresCode && <span className="text-[6.5px] text-orange-500 bg-orange-950/30 border border-orange-900/20 rounded px-1">FT</span>}
                              {p.nextjsFiles?.length>0 && <span className="text-[6.5px] text-emerald-500 bg-emerald-950/30 border border-emerald-900/20 rounded px-1">NX</span>}
                            </div>
                          </div>
                          <button onClick={e=>{e.stopPropagation();deleteProject(p.id,e);}} className="text-slate-700 hover:text-red-400 cursor-pointer p-0.5"><IcTrash/></button>
                        </div>
                      ))
                  }
                </div>
                <button onClick={()=>setShowProjects(false)} className="w-full text-[8px] text-slate-700 hover:text-slate-500 py-2 border-t border-white/[0.04] cursor-pointer">Close</button>
              </div>
            )}
          </div>
          {keySaved && <span className="flex items-center gap-1 text-[8px] text-emerald-400 bg-emerald-950/50 border border-emerald-900/30 rounded-full px-2 py-0.5"><IcCheck/> KEY</span>}
          <button onClick={()=>{setTempKey(apiKey);setShowModal(true);}}
            className="flex items-center gap-1 text-[9px] text-slate-500 border border-white/[0.07] rounded px-2 py-1 hover:border-cyan-500/40 hover:text-cyan-400 transition-all cursor-pointer">
            <IcKey/> {keySaved?'Key':'Set Key'}
          </button>
        </div>
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── CHAT PANEL ── */}
        <div className="w-[360px] shrink-0 border-r border-white/[0.06] bg-[#09091b] flex flex-col overflow-hidden">

          {/* Messages */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex flex-col gap-1 ${msg.role==='user'?'items-end':''}`}>
                {msg.role==='ai' && (
                  <div className="flex items-center gap-1 mb-0.5">
                    <div className="w-4 h-4 rounded bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center text-[7px] shrink-0">⬡</div>
                    <span className="text-[7.5px] text-slate-600">Pixel Perfect AI</span>
                    {msg.meta && (
                      <span className={`text-[6.5px] px-1.5 py-0.5 rounded-full border
                        ${msg.meta==='html'?'text-cyan-400 border-cyan-900/30 bg-cyan-950/20':
                          msg.meta==='js'?'text-yellow-500 border-yellow-900/30 bg-yellow-950/20':
                          msg.meta==='features'?'text-orange-400 border-orange-900/30 bg-orange-950/20':
                          msg.meta==='nextjs'?'text-emerald-400 border-emerald-900/30 bg-emerald-950/20':
                          msg.meta==='manager'?'text-violet-400 border-violet-900/30 bg-violet-950/20':
                          'text-slate-500 border-white/[0.06]'}`}>
                        {msg.meta==='html'?'HTML':msg.meta==='js'?'JS':msg.meta==='features'?'Features':msg.meta==='nextjs'?'Next.js':msg.meta==='manager'?'Manager':msg.meta}
                      </span>
                    )}
                  </div>
                )}
                <div className={`max-w-[90%] rounded-xl px-3 py-2 text-[9.5px] leading-relaxed
                  ${msg.role==='user'
                    ? 'bg-cyan-900/30 border border-cyan-800/30 text-cyan-100 rounded-tr-sm'
                    : msg.type==='error' ? 'bg-red-950/40 border border-red-900/30 text-red-300 rounded-tl-sm'
                    : msg.type==='result' ? 'bg-emerald-950/30 border border-emerald-900/20 text-emerald-300 rounded-tl-sm'
                    : msg.type==='decision' ? 'bg-violet-950/30 border border-violet-900/20 text-violet-300 rounded-tl-sm'
                    : msg.type==='step' ? 'bg-white/[0.02] border border-white/[0.04] text-slate-500 rounded-tl-sm'
                    : 'bg-[#0e0e1f] border border-white/[0.06] text-slate-300 rounded-tl-sm'}`}>
                  {msg.type==='step' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5 mb-0.5"/>}
                  {msg.content}
                </div>
              </div>
            ))}
            {isSending && !messages[messages.length-1]?.type?.includes('step') && (
              <div className="flex items-center gap-2 text-slate-700 text-[9px]">
                <Spinner/> Processing…
              </div>
            )}
          </div>

          {/* Image preview strip */}
          {imgUrl && (
            <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center gap-2 bg-[#08081a]">
              <img src={imgUrl} className="h-8 w-12 object-cover rounded border border-white/[0.08]" alt=""/>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] text-slate-500 truncate">{imgMime || 'image'}</p>
                {colorData && <p className="text-[7px] text-cyan-700">{colorData.dominantPalette.length} colors · {colorData.imageWidth}×{colorData.imageHeight}</p>}
                {extracting && <p className="text-[7px] text-cyan-500 animate-pulse">Extracting colors…</p>}
              </div>
              <button onClick={()=>{setImgUrl('');setImgB64('');setImgMime('');setColorData(null);}}
                className="text-slate-700 hover:text-red-400 cursor-pointer"><IcX/></button>
            </div>
          )}

          {/* Chat input */}
          <div className="p-3 border-t border-white/[0.06] bg-[#09091b]">
            <div className="flex gap-2 items-end bg-[#0e0e1f] border border-white/[0.07] rounded-xl px-3 py-2.5 focus-within:border-cyan-500/30 transition-colors">
              <textarea
                value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                placeholder={code ? "Add a feature, ask a question…" : "Describe the app you want to build…"}
                rows={2}
                className="flex-1 bg-transparent text-slate-300 text-[10px] outline-none resize-none placeholder:text-slate-700 leading-relaxed"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={()=>fileRef.current?.click()}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${imgB64?'text-cyan-400 bg-cyan-950/30':'text-slate-600 hover:text-slate-400'}`}
                  title="Attach screenshot">
                  <IcUpload/>
                </button>
                <button onClick={sendMessage} disabled={isSending || (!chatInput.trim() && !imgB64)}
                  className={`p-1.5 rounded-lg transition-all
                    ${isSending||(!chatInput.trim()&&!imgB64) ? 'text-slate-700 cursor-not-allowed' : 'bg-cyan-500 text-black hover:bg-cyan-400 cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.2)]'}`}>
                  {isSending ? <Spinner/> : <IcPlay/>}
                </button>
              </div>
            </div>
            <p className="text-[7px] text-slate-700 mt-1.5 text-center">Enter to send · Shift+Enter for newline · 📎 to attach image</p>
          </div>
        </div>

        {/* ── PREVIEW PANE ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Tab bar */}
          <div className="flex items-center h-9 px-3 gap-0.5 border-b border-white/[0.06] bg-[#09091b] shrink-0">
            {(['preview','code'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                className={`flex items-center gap-1 px-2.5 h-full text-[9.5px] font-medium tracking-[0.1em] uppercase border-b-2 transition-all cursor-pointer
                  ${tab===t?'border-cyan-400 text-cyan-400':'border-transparent text-slate-600 hover:text-slate-400'}`}>
                {t==='preview'?<IcEye/>:<IcCode/>}{t}
              </button>
            ))}
            {nextjsFiles.length>0 && (
              <button onClick={()=>setTab('nextjs' as any)}
                className={`flex items-center gap-1 px-2.5 h-full text-[9.5px] font-medium tracking-[0.1em] uppercase border-b-2 transition-all cursor-pointer
                  ${(tab as string)==='nextjs'?'border-emerald-400 text-emerald-400':'border-transparent text-slate-600 hover:text-slate-400'}`}>
                <IcNextjs/>Next.js
              </button>
            )}

            {code && (
              <div className="ml-auto flex items-center gap-1">
                {/* View mode switcher */}
                {(fullCode||featuresCode||sandbox.url) && (
                  <div className="flex items-center gap-0.5 border border-white/[0.07] rounded overflow-hidden mr-1">
                    <button onClick={()=>setViewMode('html')} className={`px-2 py-1 text-[7.5px] font-medium cursor-pointer transition-all ${viewMode==='html'?'bg-cyan-950/60 text-cyan-400':'text-slate-600 hover:text-slate-400'}`}>HTML</button>
                    {fullCode && <button onClick={()=>setViewMode('full')} className={`px-2 py-1 text-[7.5px] font-medium cursor-pointer transition-all ${viewMode==='full'?'bg-yellow-950/60 text-yellow-400':'text-slate-600 hover:text-slate-400'}`}>+JS</button>}
                    {featuresCode && <button onClick={()=>setViewMode('features')} className={`px-2 py-1 text-[7.5px] font-medium cursor-pointer transition-all ${viewMode==='features'?'bg-orange-950/60 text-orange-400':'text-slate-600 hover:text-slate-400'}`}>+FT</button>}
                    {sandbox.url && <button onClick={()=>setViewMode('sandbox' as any)} className={`px-2 py-1 text-[7.5px] font-medium cursor-pointer transition-all ${(viewMode as string)==='sandbox'?'bg-emerald-950/60 text-emerald-400':'text-slate-600 hover:text-slate-400'}`}>Live</button>}
                  </div>
                )}
                <button onClick={()=>openInTab(activeCode())} className="flex items-center gap-1 text-[8.5px] border border-violet-800/40 text-violet-400 rounded px-2 py-1 hover:bg-violet-950/30 transition-all cursor-pointer"><IcExternalLink/> Tab</button>
                <button onClick={copyCode} className={`flex items-center gap-1 text-[8.5px] border rounded px-2 py-1 cursor-pointer transition-all ${copied?'border-emerald-800 text-emerald-400':'border-white/[0.08] text-slate-500 hover:border-cyan-500/40 hover:text-cyan-400'}`}>{copied?<><IcCheck/>Copied</>:<><IcCopy/>Copy</>}</button>
                <button onClick={downloadCode} className="flex items-center gap-1 text-[8.5px] border border-white/[0.08] text-slate-500 rounded px-2 py-1 hover:border-emerald-700/40 hover:text-emerald-400 cursor-pointer transition-all"><IcDownload/>.html</button>
              </div>
            )}
          </div>

          {/* Preview */}
          {tab==='preview' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {code || sandbox.url
                ? <>
                    {(viewMode as string) === 'sandbox' && sandbox.url
                      ? <iframe src={sandbox.url} className="flex-1 border-none w-full min-h-0" title="Live App"/>
                      : <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                          className="flex-1 border-none w-full min-h-0" style={{background:'white'}} title="Preview"/>
                    }
                    {/* Sandbox console */}
                    {showSandbox && (
                      <div className="h-[200px] shrink-0 border-t border-white/[0.06] bg-[#09091b] flex flex-col">
                        <div className="flex items-center px-3 py-1.5 border-b border-white/[0.04] shrink-0 gap-2">
                          <IcNextjs/><span className="text-[8px] text-emerald-500 font-semibold tracking-widest uppercase">Sandbox</span>
                          {sandbox.step!=='idle' && <span className={`text-[7px] px-1.5 py-0.5 rounded-full border ${sandbox.step==='running'?'text-emerald-400 border-emerald-800/40 bg-emerald-950/30':sandbox.step==='error'?'text-red-400 border-red-800/40 bg-red-950/30':'text-cyan-400 border-cyan-800/40 bg-cyan-950/30'}`}>{sandbox.step.toUpperCase()}</span>}
                          {sandbox.id && <span className="text-[7px] text-slate-700 font-mono">{sandbox.id.slice(0,10)}…</span>}
                          <div className="ml-auto flex items-center gap-1">
                            {(['Create','Install','Build','Start'] as const).map(label => {
                              const disabled = label==='Create'?sandbox.step==='creating':!sandbox.id||sandbox.step==='installing'||sandbox.step==='building'||sandbox.step==='starting';
                              const fn = label==='Create'?runSandboxCreate:label==='Install'?()=>runSandboxInstall(sandbox.id!,sandbox.buildAttempts):label==='Build'?()=>runSandboxBuild(sandbox.id!,sandbox.buildAttempts):()=>runSandboxStart(sandbox.id!);
                              return (
                                <button key={label} onClick={fn} disabled={disabled}
                                  className={`px-2 py-0.5 rounded text-[7.5px] font-bold cursor-pointer transition-all
                                    ${disabled?'text-slate-700 cursor-not-allowed':
                                      label==='Create'?'text-emerald-400 bg-emerald-900/30 border border-emerald-800/40 hover:bg-emerald-900/50':
                                      label==='Start'?'text-violet-400 bg-violet-900/30 border border-violet-800/40 hover:bg-violet-900/50':
                                      'text-slate-400 bg-white/[0.04] border border-white/[0.07] hover:text-slate-200'}`}>
                                  {label}
                                </button>
                              );
                            })}
                            {/* Add Files button for patch */}
                            {patchFiles.length>0 && sandbox.id && (
                              <button onClick={applyPatchToSandbox} disabled={patchAddingFiles}
                                className="px-2 py-0.5 rounded text-[7.5px] font-bold cursor-pointer text-sky-400 bg-sky-900/30 border border-sky-800/40 hover:bg-sky-900/50 transition-all">
                                {patchAddingFiles?'…':'Add Files'}
                              </button>
                            )}
                            {sandbox.url && <a href={sandbox.url} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 rounded text-[7.5px] text-violet-400 border border-violet-800/40 hover:bg-violet-950/30 flex items-center gap-1"><IcExternalLink/>Open</a>}
                            <button onClick={()=>setShowSandbox(false)} className="text-slate-700 hover:text-slate-400 cursor-pointer ml-1"><IcX/></button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                          {sandbox.logs.length===0
                            ? <p className="text-[8px] text-slate-700 italic">No logs yet. Click Create to start.</p>
                            : sandbox.logs.map((l,i)=>(
                                <p key={i} className={`text-[8px] font-mono leading-relaxed ${l.startsWith('✓')?'text-emerald-500':l.startsWith('✗')||l.includes('error')||l.includes('Error')?'text-red-400':l.startsWith('⧖')?'text-cyan-400':'text-slate-500'}`}>{l}</p>
                              ))
                          }
                          {sandbox.error && <p className="text-[8px] font-mono text-red-400 mt-1 border border-red-900/20 rounded px-2 py-1 bg-red-950/20">{sandbox.error}</p>}
                        </div>
                      </div>
                    )}
                    {/* Sandbox toggle button */}
                    {nextjsFiles.length>0 && !showSandbox && (
                      <button onClick={()=>setShowSandbox(true)}
                        className="h-7 shrink-0 border-t border-white/[0.04] bg-[#09091b] text-[8px] text-slate-700 hover:text-emerald-400 flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                        <IcNextjs/> Show Sandbox Console
                        {sandbox.step!=='idle' && <span className={`text-[7px] px-1.5 py-0.5 rounded-full border ${sandbox.step==='running'?'text-emerald-400 border-emerald-800/40':'text-cyan-400 border-cyan-800/40'}`}>{sandbox.step.toUpperCase()}</span>}
                      </button>
                    )}
                  </>
                : <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-700">
                    <div className="text-[50px] opacity-[0.04]">⬡</div>
                    <div className="text-center">
                      <p className="text-[11px] text-slate-600">Your app will appear here</p>
                      <p className="text-[9px] text-slate-700 mt-1">Upload a screenshot and describe your app in the chat</p>
                    </div>
                  </div>
              }
            </div>
          )}

          {/* Code tab */}
          {tab==='code' && (
            <div className="flex-1 overflow-auto p-3.5">
              {code
                ? <>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[7.5px] text-slate-600 uppercase tracking-widest">Showing:</span>
                      <button onClick={()=>setViewMode('html')} className={`text-[7.5px] px-1.5 py-0.5 rounded border cursor-pointer transition-all ${viewMode==='html'?'border-cyan-700/50 text-cyan-400 bg-cyan-950/30':'border-white/[0.06] text-slate-600'}`}>HTML</button>
                      {fullCode && <button onClick={()=>setViewMode('full')} className={`text-[7.5px] px-1.5 py-0.5 rounded border cursor-pointer transition-all ${viewMode==='full'?'border-yellow-700/50 text-yellow-400 bg-yellow-950/30':'border-white/[0.06] text-slate-600'}`}>+JS</button>}
                      {featuresCode && <button onClick={()=>setViewMode('features')} className={`text-[7.5px] px-1.5 py-0.5 rounded border cursor-pointer transition-all ${viewMode==='features'?'border-orange-700/50 text-orange-400 bg-orange-950/30':'border-white/[0.06] text-slate-600'}`}>+Features</button>}
                    </div>
                    <pre className="text-[10px] leading-[1.8] text-[#c8d3f5] whitespace-pre-wrap break-words font-mono">{activeCode()}</pre>
                  </>
                : <div className="h-full flex items-center justify-center text-slate-700 text-[11px]">No code yet.</div>
              }
            </div>
          )}

          {/* Next.js Files tab */}
          {(tab as string)==='nextjs' && nextjsFiles.length>0 && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04] bg-[#08081a] overflow-x-auto shrink-0">
                {nextjsFiles.map((f,i)=>{
                  const isPatched = patchFiles.some(p=>p.path===f.path);
                  return (
                    <button key={f.path} onClick={()=>setSelectedNxFile(i)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[8px] font-mono whitespace-nowrap transition-all cursor-pointer shrink-0
                        ${selectedNxFile===i?(isPatched?'bg-sky-950/40 border border-sky-800/40 text-sky-400':'bg-emerald-950/40 border border-emerald-800/40 text-emerald-400'):'text-slate-600 hover:text-slate-400 border border-transparent'}`}>
                      {isPatched && <span className="text-sky-500 text-[7px]">★</span>}
                      {f.path.split('/').pop()}
                    </button>
                  );
                })}
                <button onClick={()=>{ const f=nextjsFiles[selectedNxFile]; if(f) navigator.clipboard.writeText(f.content); }}
                  className="ml-auto flex items-center gap-1 text-[8px] border border-white/[0.07] text-slate-600 hover:text-slate-300 rounded px-2 py-1 cursor-pointer shrink-0">
                  <IcCopy/>Copy
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[8px] text-slate-700 font-mono">{nextjsFiles[selectedNxFile]?.path}</span>
                  {patchFiles.some(p=>p.path===nextjsFiles[selectedNxFile]?.path) && (
                    <span className="text-[7px] text-sky-400 bg-sky-950/30 border border-sky-900/20 rounded px-1.5 py-0.5">★ patched</span>
                  )}
                </div>
                <pre className="text-[10px] leading-[1.8] text-[#c8d3f5] whitespace-pre-wrap break-words font-mono">{nextjsFiles[selectedNxFile]?.content}</pre>
              </div>
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
              className="w-full bg-[#09091b] border border-white/[0.07] rounded-md text-slate-200 font-mono text-[12px] px-3 py-2.5 outline-none mb-3.5 focus:border-cyan-500/40 transition-colors placeholder:text-slate-700"/>
            <div className="flex gap-2">
              <button onClick={saveKey} disabled={!tempKey.trim()}
                className={`flex-1 py-2.5 rounded-md text-[10.5px] font-bold flex items-center justify-center gap-1.5 transition-all
                  ${tempKey.trim()?'bg-gradient-to-r from-cyan-500 to-cyan-400 text-black cursor-pointer hover:shadow-[0_0_24px_rgba(0,229,255,0.35)]':'bg-cyan-950/20 border border-cyan-900/20 text-cyan-800 cursor-not-allowed'}`}>
                <IcCheck/> Save to IndexedDB
              </button>
              {keySaved&&<button onClick={()=>setShowModal(false)} className="px-3.5 py-2.5 border border-white/[0.07] text-slate-500 rounded-md text-[10.5px] hover:border-white/20 cursor-pointer">Cancel</button>}
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
