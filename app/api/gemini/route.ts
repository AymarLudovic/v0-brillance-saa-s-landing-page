import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

// ─── Vercel config ────────────────────────────────────────────────────────────
export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Model constants ──────────────────────────────────────────────────────────
const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6", "claude-sonnet-4-6",
  "claude-opus-4-5", "claude-sonnet-4-5",
]);

// =============================================================================
// SYSTÈME — UN SEUL CERVEAU, TOUTE LA PUISSANCE
// Architecture: 1 appel IA + post-processing programmatique (pas de multi-agents)
// Inspiré de l'approche Claude Code / Windsurf Cascade : contexte unique, cohérence totale
// =============================================================================

const DESIGN_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTIVES FORENSIC UI — L'INGÉNIERIE DU PIXEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es une machine à lire les pixels. Tu REPRODUIS, tu ne stylises pas.

❌ BADGE SYNDROME : point de couleur + texte ≠ badge. Pas de fond sauf si visible.
❌ INFLATION : icônes 14-16px, row height selon le contenu, border-radius 0-4px sur inputs.
❌ COULEURS GÉNÉRIQUES : jamais bg-gray-900, text-blue-500. Utilise UNIQUEMENT les hex fournis.
❌ OMBRES INVENTÉES : pas de box-shadow sans ombre visible dans le design de référence.
❌ LAYOUT CENTRÉ : ne wrape pas en 800px si l'original est full-width.
✅ mix-blend-mode si texte sur image avec color mixing visible.
`;

const BASE_SYSTEM_PROMPT = `
Tu es un Principal Full-Stack Architect Next.js 15 / React 19 / TypeScript ET un Forensic UI Engineer.
Ton but : livrer un produit PARFAIT dès la première génération — moteur puissant (80%) + design précis au pixel (20%).

${DESIGN_RULES}

╔══════════════════════════════════════════════════════════════════════╗
║  LOI FONDAMENTALE — LOGIQUE DANS LE FICHIER QUI L'UTILISE           ║
╚══════════════════════════════════════════════════════════════════════╝
Chaque fichier .tsx contient TOUT ce dont il a besoin :
  - Interfaces TypeScript définies EN HAUT (jamais importées depuis un autre fichier)
  - Fonctions utilitaires avant le composant
  - Tout son state (useState, useReducer, useRef)
  - Toute sa logique dans des handlers
  - Son JSX complet dans le return

ARCHITECTURE DES FICHIERS :
  app/page.tsx              → Layout principal + navigation (useState activeView)
  
  components/ui/*.tsx       → Composants réutilisables simples (Button, Card, Modal...)
  app/globals.css           → Variables CSS, styles globaux
  app/layout.tsx            → Metadata, fonts, CDN links
  tailwind.config.ts        → plugins: [] — jamais tailwindcss-animate

RÈGLES ABSOLUES :
  ✅ "use client"; LIGNE 1 absolue sur tout fichier avec hooks ou events
  ✅ Named exports pour les views, default export pour app/page.tsx
  ✅ Imports internes avec @/ (jamais ../)
  ✅ Tailwind CSS pour tout le styling
  ❌ PAS de dossier /hooks/, /services/, /types/ séparés
  ❌ PAS d'import de logique depuis un autre fichier (sauf composants UI)
  ❌ PAS de Python, FastAPI, backend séparé
  ❌ PAS de fetch vers /api/py/

RÈGLES ANTI-RÉGRESSION :
  1. ZÉRO UI THEATER : Ne simule jamais un upload ou paiement. Tout doit être fonctionnel.
  2. ZERO FEATURE DROP : Ne supprime jamais les fonctionnalités existantes lors d'une modification.
  3. DEBUGGING ROOT-CAUSE : Trouve la cause racine avant d'éditer, pas de pansement à l'aveugle.

AMBITION :
  → Jamais le minimum. Données mock réalistes (12-15 entrées). Chaque bouton = vraie action.
  → Si > 40% du fichier change → create_file complet (plus économique en tokens).

LIBRAIRIES npm RECOMMANDÉES :
  Audio/DAW    : Tone.js, Howler.js
  Graphiques   : Recharts, Chart.js, D3.js
  Canvas/2D    : Fabric.js, Konva
  Drag & Drop  : dnd-kit
  Animations   : Framer Motion
  PDF          : jsPDF, @react-pdf/renderer
  Excel/CSV    : xlsx, papaparse
  Dates        : date-fns, dayjs
`;

const FILE_FORMAT = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRÉER (ligne "---" seule AVANT) :
---
<create_file path="components/views/DashboardView.tsx">
"use client";
// contenu COMPLET
</create_file>

ÉDITER (après lecture des vrais numéros de ligne — numéros approximatifs = JSX cassé) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M]
</changes_to_apply>
</edit_file>

BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>
INTERDIT dans tailwind.config.ts plugins[] : tailwindcss-animate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES (émet ces marqueurs si nécessaire)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPENDENCIES: ["nom-du-package", "autre-package"]
DEVDEPENDENCIES: ["@types/nom"]
REMOVE_DEPENDENCIES: ["ancien-package-à-supprimer"]



À la fin de chaque réponse qui installe des packages, déclare-les EXACTEMENT ainsi :

DEPENDENCIES: ["nom-package1", "nom-package2"]
DEVDEPENDENCIES: ["nom-dev-package"]
REMOVE_DEPENDENCIES: ["package-problematique"]

RÈGLES :
✅ Texte brut sur une seule ligne chacun
✅ Noms de packages npm exacts (comme sur npmjs.com)
✅ DEPENDENCIES pour les packages runtime
✅ DEVDEPENDENCIES pour les packages dev uniquement
✅ REMOVE_DEPENDENCIES pour retirer une dépendance problématique du package.json

QUAND UTILISER REMOVE_DEPENDENCIES :
→ tailwindcss-animate est utilisé dans tailwind.config.ts mais non installé
→ une librairie cause des conflits de types ou des erreurs de build
→ un package a été importé par erreur et n'est pas utilisé
→ une dépendance est remplacée par une autre

❌ NEVER multiline JSON:
  {
    "dependencies": { ... }   ← WRONG
  }
❌ NEVER a JSON object
❌ NEVER markdown or code block around it

CORRECT EXAMPLES:
DEPENDENCIES: ["tone", "howler", "recharts", "date-fns"]
DEVDEPENDENCIES: ["@types/howler"]
REMOVE_DEPENDENCIES: ["tailwindcss-animate", "bad-package"]

INCORRECT EXAMPLES (these will be ignored):
{ "dependencies": { "tone": "latest" } }   ← WRONG


pour le design de l'application que tu dois construire tu dois suivre ceci ════════════════════════════════════════════════════════════
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



Note: le système scanne aussi automatiquement tes imports pour détecter les nouvelles dépendances.
`;

const DESIGN_MANDATORY_INSTRUCTION = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN MEMORY — OBLIGATOIRE POUR TOUT NOUVEAU PROJET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si tu crées un nouveau projet OU changes significativement le design, émets OBLIGATOIREMENT :
════════════════════════════════════════════════════════════
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


Ce sont ces règles qje tu devras suivre pour faire le dzsign de l'application par rapport à l'image reçu ou autre
<create_file path="design.md">
ce fichier devra contenir toute ces règles là 
</create_file>

Ce fichier est la MÉMOIRE DESIGN du projet. Toute modification future devra respecter ces tokens.
`;

// =============================================================================
// UTILITAIRES
// =============================================================================

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch {
      const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g);
      return r ? r.map((s) => s.replace(/"/g, "")) : [];
    }
  }
  return [];
}

function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  // Cas normal (tag fermant présent)
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  // Cas tronqué (stream coupé) — récupère le partiel
  if (files.length === 0 && output.includes("<create_file ")) {
    const rxOpen = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxOpen.exec(output)) !== null) {
      const content = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (content.length > 50) files.push({ path: mo[1], content });
    }
  }
  return files;
}

/**
 * Scan les imports dans les fichiers générés pour détecter les packages npm.
 * Évite les faux positifs (built-ins React/Next, aliases @/).
 */
function scanImports(files: { path: string; content: string }[]): Set<string> {
  const pkgs = new Set<string>();
  const rx = /from\s+['"]([^'"./][^'"]*)['"]/g;
  const BUILTIN = new Set([
    "react", "react-dom", "next", "next/navigation", "next/image", "next/link",
    "next/font/google", "next/head", "next/router", "next/server",
  ]);
  for (const f of files) {
    let match;
    while ((match = rx.exec(f.content)) !== null) {
      const raw = match[1];
      if (raw.startsWith("@/")) continue; // alias interne
      const pkg = raw.startsWith("@")
        ? raw.split("/").slice(0, 2).join("/")
        : raw.split("/")[0];
      if (!BUILTIN.has(pkg) && pkg.length > 0) pkgs.add(pkg);
    }
  }
  return pkgs;
}

/**
 * TSC CHECKER STATIQUE — vérifie programmatiquement les erreurs les plus fréquentes.
 * Remplace 80% des crashs de build sans sandbox (rapide, sans dépendances externes).
 * Émis dans le stream sous [TSC_CHECK]...[/TSC_CHECK].
 */
function tscStaticCheck(
  files: { path: string; content: string }[]
): { issues: string[]; severity: "critical" | "warning" | "ok" } {
  const issues: string[] = [];

  for (const f of files) {
    const c = f.content;
    if (!c || c.length < 10) continue;

    // CRITICAL: "use client" manquant sur fichiers avec hooks/events
    if (
      f.path.endsWith(".tsx") &&
      (c.includes("useState") || c.includes("useEffect") || c.includes("onClick") ||
       c.includes("useRef") || c.includes("useCallback") || c.includes("useReducer"))
    ) {
      if (!c.startsWith('"use client"') && !c.startsWith("'use client'")) {
        issues.push(`CRITICAL [${f.path}]: "use client"; doit être ligne 1 absolue`);
      }
    }

    // CRITICAL: accolades déséquilibrées (JSX cassé)
    let braces = 0;
    for (const ch of c) { if (ch === "{") braces++; else if (ch === "}") braces--; }
    if (Math.abs(braces) > 2) {
      issues.push(`CRITICAL [${f.path}]: ${Math.abs(braces)} accolades déséquilibrées — JSX cassé garanti`);
    }

    // CRITICAL: double export default
    const defaultExports = (c.match(/export\s+default\s+/g) || []).length;
    if (defaultExports > 1) {
      issues.push(`CRITICAL [${f.path}]: ${defaultExports} "export default" — un seul autorisé par fichier`);
    }

    // CRITICAL: tailwindcss-animate dans tailwind.config
    if (f.path === "tailwind.config.ts" && c.includes("tailwindcss-animate")) {
      issues.push(`CRITICAL [${f.path}]: tailwindcss-animate non installé → crash build`);
    }

    // CRITICAL: template literals non fermées
    const backtickCount = (c.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      issues.push(`CRITICAL [${f.path}]: nombre impair de backticks — template literal non fermée`);
    }

    // WARNING: useState<T[]>() sans valeur initiale → crash .map()
    if (c.match(/useState<[^>]*\[\]>\s*\(\s*\)/)) {
      issues.push(`WARNING [${f.path}]: useState<T[]>() sans [] initial → crash .map() au premier render`);
    }

    // WARNING: onClick vides
    const emptyClicks = (c.match(/onClick=\{[(\s]*\)\s*=>\s*\{\s*\}/g) || []).length;
    if (emptyClicks > 0) {
      issues.push(`WARNING [${f.path}]: ${emptyClicks} onClick vide(s) — handler non implémenté`);
    }
  }

  const hasCritical = issues.some((i) => i.startsWith("CRITICAL"));
  return {
    issues,
    severity: hasCritical ? "critical" : issues.length > 0 ? "warning" : "ok",
  };
}

// =============================================================================
// PACKAGE.JSON — construction par scan d'imports + tags IA + package.json existant
// =============================================================================

const DEV_ONLY_PKGS = new Set([
  "typescript", "@types/node", "@types/react", "@types/react-dom",
  "postcss", "tailwindcss", "eslint", "eslint-config-next", "autoprefixer",
  "@types/autoprefixer",
]);

const IGNORE_PKGS = new Set(["react", "react-dom", "next", "sharp", "autoprefixer"]);

const BUNDLED_TYPES = new Set(["react", "react-dom", "next", "typescript", "node"]);
const TYPES_MAP: Record<string, string> = {
  express: "@types/express",
  lodash: "@types/lodash",
  "node-fetch": "@types/node-fetch",
};

async function resolveVersion(pkg: string): Promise<string> {
  try {
    const d = await packageJson(pkg);
    return d.version as string;
  } catch {
    return "latest";
  }
}

async function resolveAutoTypes(
  pkgs: string[],
  existing: Record<string, string>
): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
  await Promise.all(
    pkgs.map(async (pkg) => {
      if (!pkg || BUNDLED_TYPES.has(pkg)) return;
      const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
      if (existing[tp]) return;
      try {
        const d = await packageJson(tp);
        needed[tp] = d.version as string;
      } catch { /* pas de @types disponible */ }
    })
  );
  return needed;
}

async function buildPackageJson(
  aiOutput: string,
  newFiles: { path: string; content: string }[],
  currentProjectFiles: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  // 1. Scanne les imports dans les fichiers générés
  const scanned = scanImports(newFiles);

  // 2. Tags explicites émis par l'IA
  const aiDeps = extractDeps(aiOutput, "DEPENDENCIES");
  const aiDevDeps = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRemove = new Set([
    ...extractDeps(aiOutput, "REMOVE_DEPENDENCIES"),
    ...extractDeps(aiOutput, "REMOVEDEPENDENCIES"),
  ]);

  const allNew = new Set([...scanned, ...aiDeps]);
  if (allNew.size === 0 && aiDevDeps.length === 0 && toRemove.size === 0) return null;

  // 3. Package.json existant (base)
  const existFile = currentProjectFiles.find((f) => f.path === "package.json");
  let pkg: any = existFile
    ? JSON.parse(existFile.content)
    : {
        name: "app", version: "1.0.0", private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
        dependencies: {
          next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
          "lucide-react": "0.475.0", clsx: "2.1.1", "tailwind-merge": "2.3.0",
        },
        devDependencies: {
          typescript: "^5", "@types/node": "^20", "@types/react": "^19",
          "@types/react-dom": "^19", postcss: "^8",
          tailwindcss: "^3.4.1", autoprefixer: "^10.4.19",
          eslint: "^8", "eslint-config-next": "15.0.3",
        },
      };

  // 4. Résout les nouvelles deps (celles pas déjà présentes)
  const newToResolve = [...allNew].filter(
    (p) => p && !IGNORE_PKGS.has(p) && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]
  );
  const newDevToResolve = aiDevDeps.filter(
    (p) => p && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]
  );

  await Promise.all([
    ...newToResolve.map(async (p) => {
      const version = await resolveVersion(p);
      if (DEV_ONLY_PKGS.has(p)) pkg.devDependencies[p] = version;
      else pkg.dependencies[p] = version;
    }),
    ...newDevToResolve.map(async (p) => {
      pkg.devDependencies[p] = await resolveVersion(p);
    }),
  ]);

  // 5. @types automatiques pour les nouvelles deps
  const autoTypes = await resolveAutoTypes(newToResolve, pkg.devDependencies);
  Object.assign(pkg.devDependencies, autoTypes);

  // 6. Retire les packages marqués REMOVE_DEPENDENCIES
  for (const p of toRemove) {
    delete pkg.dependencies?.[p];
    delete pkg.devDependencies?.[p];
  }

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// =============================================================================
// POST_HANDLER : Après l'appel IA — TSC check + package.json (sans agent supplémentaire)
// =============================================================================

async function runPostPipeline(
  fullOutput: string,
  currentProjectFiles: { path: string; content: string }[],
  emit: (t: string) => void
): Promise<void> {
  const newFiles = parseGeneratedFiles(fullOutput);
  if (newFiles.length === 0) return;

  // ── TSC Static Check ──────────────────────────────────────────────────────
  const { issues, severity } = tscStaticCheck(newFiles);
  if (issues.length > 0) {
    emit("\n\n[TSC_CHECK]\n");
    for (const issue of issues) emit(`${issue}\n`);
    if (severity === "critical") {
      const critCount = issues.filter((i) => i.startsWith("CRITICAL")).length;
      emit(`[TSC_STATUS] ${critCount} erreur(s) critique(s) — corrige avant de lancer npm run dev\n`);
    } else {
      emit(`[TSC_STATUS] ${issues.length} avertissement(s) — build probable mais à vérifier\n`);
    }
    emit("[/TSC_CHECK]\n");
  }

  // ── Package.json ──────────────────────────────────────────────────────────
  try {
    const pkgResult = await buildPackageJson(fullOutput, newFiles, currentProjectFiles);
    if (pkgResult) {
      emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
    }
  } catch (pkgErr: any) {
    emit(`\n[PKG_ERROR] ${pkgErr.message}`);
  }
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  try {
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey)
      return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey)
      return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

    const body = await req.json();
    const {
      history = [],
      uploadedImages = [],
      allReferenceImages = [],
      currentProjectFiles = [],
      uploadedFiles = [],
    } = body;

    // ── Build system prompt ──────────────────────────────────────────────────
    let systemPrompt = BASE_SYSTEM_PROMPT + "\n\n" + FILE_FORMAT + "\n\n" + DESIGN_MANDATORY_INSTRUCTION;

    // Inject design.md existant → mémoire design pour ce projet
    const designMd = (currentProjectFiles as { path: string; content: string }[]).find(
      (f) => f.path === "design.md"
    );
    if (designMd) {
      systemPrompt +=
        `\n\n╔══════════════════════════════════════════════════╗\n` +
        `║  DESIGN MEMORY — TOKENS OBLIGATOIRES DE CE PROJET  ║\n` +
        `╚══════════════════════════════════════════════════╝\n` +
        `${designMd.content}\n` +
        `⚠️ Ces couleurs/polices/espacements sont OBLIGATOIRES. Respecte-les exactement.\n`;
    }

    // Inject fichiers existants avec numéros de ligne (pour edit_file précis)
    if ((currentProjectFiles as any[]).length > 0) {
      const addLineNums = (c: string) =>
        c.split("\n").map((l: string, i: number) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
      const fileList = (currentProjectFiles as { path: string; content: string }[])
        .map((f) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`)
        .join("\n\n");
      systemPrompt += `\n\nEXISTING PROJECT FILES (line numbers for edit_file):\n${fileList.slice(0, 80000)}`;
    }

    // ── Prépare le dernier message utilisateur ───────────────────────────────
    const lastHistory = history[history.length - 1];
    const lastUserText =
      lastHistory?.role === "user"
        ? typeof lastHistory.content === "string"
          ? lastHistory.content
          : lastHistory.content
              ?.filter((p: any) => p.type === "text")
              ?.map((p: any) => p.text)
              ?.join("\n") ?? ""
        : "";

    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);

    // ── Stream ───────────────────────────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));

        try {
          let fullOutput = "";

          // ── GEMINI ────────────────────────────────────────────────────────
          if (!isAnthropic) {
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const contents: any[] = [];

            for (const msg of history.slice(0, -1)) {
              const role = msg.role === "assistant" ? "model" : "user";
              const text =
                typeof msg.content === "string"
                  ? msg.content
                  : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
              if (text.trim()) contents.push({ role, parts: [{ text }] });
            }

            const lastParts: any[] = [];
            for (const img of allImages) {
              try {
                const raw = img.includes(",") ? img.split(",")[1] : img;
                if (!raw || raw.length < 100) continue;
                const mime =
                  img.startsWith("data:image/png") ? "image/png" :
                  img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
                lastParts.push({ inlineData: { data: raw, mimeType: mime } });
              } catch {}
            }
            for (const f of uploadedFiles || []) {
              if (f.base64Content && f.fileName)
                lastParts.push({ inlineData: { data: f.base64Content, mimeType: "application/pdf" } });
            }
            lastParts.push({ text: lastUserText || "Aide-moi." });
            contents.push({ role: "user", parts: lastParts });

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.7,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8000 },
              },
            });

            for await (const chunk of response) {
              const parts = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if ((part as any).thought || !part.text) continue;
                emit(part.text);
                fullOutput += part.text;
              }
            }

          // ── ANTHROPIC ─────────────────────────────────────────────────────
          } else {
            const anthropic = new Anthropic({ apiKey: anthropicKey });
            const messages: any[] = [];

            for (let i = 0; i < history.length - 1; i++) {
              const msg = history[i];
              const role = msg.role === "assistant" ? "assistant" : "user";
              const text =
                typeof msg.content === "string"
                  ? msg.content
                  : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
              if (text.trim()) messages.push({ role, content: text });
            }

            const lastContent: any[] = [];
            for (const img of allImages) {
              try {
                const raw = img.includes(",") ? img.split(",")[1] : img;
                if (!raw || raw.length < 100) continue;
                const mt =
                  img.startsWith("data:image/png") ? "image/png" :
                  img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
                lastContent.push({ type: "image", source: { type: "base64", media_type: mt, data: raw } });
              } catch {}
            }
            lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
            messages.push({ role: "user", content: lastContent });

            const response = await anthropic.messages.stream({
              model: MODEL_ID,
              max_tokens: 16000,
              system: systemPrompt,
              messages,
            });

            for await (const chunk of response) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                emit(chunk.delta.text);
                fullOutput += chunk.delta.text;
              }
            }
          }

          // ── POST-PIPELINE (programmatique, sans appel IA supplémentaire) ──
          await runPostPipeline(fullOutput, currentProjectFiles || [], emit);

          emit("\n[PAGE_DONE]\n");
        } catch (err: any) {
          console.error("Route error:", err);
          emit(`\n[ERROR] ${err.message}\n[PAGE_DONE]\n`);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
