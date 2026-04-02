import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

// ─── Vercel config ─────────────────────────────────────────────────────────────
export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Constants ─────────────────────────────────────────────────────────────────
const GEMINI_DEFAULT    = "gemini-3-flash-preview";
const ANTHROPIC_MODELS  = new Set(["claude-opus-4-6","claude-sonnet-4-6","claude-opus-4-5","claude-sonnet-4-5"]);
const DESIGN_ANCHOR_FILE  = "app/__design_anchor__.md";
const REASONING_CACHE_FILE = "app/__reasoning_cache__.md";
const PROJECT_MEMORY_FILE  = "app/__project_memory__.md";

// =============================================================================
// ██████████████████████████████████████████████████████████████████████████████
// SYSTÈME DE REASONING — 3 QUESTIONS SÉQUENTIELLES
//
// Principe : comme un enseignant qui pose ses questions à l'élève une par une
// en attendant la réponse avant de passer à la suivante. Les réponses collectées
// sont toutes considérées vraies car les points de contact forcent le modèle
// à répondre toujours de façon vraie.
//
// A+B : cachés dans __reasoning_cache__.md → calculés UNE SEULE FOIS par projet.
// C   : toujours frais → dépend du message utilisateur courant.
// Résultat : injecté comme PAIRE DE TURNS en tête de l'historique de conversation
// (pas dans le system prompt) pour que le modèle "parte de cette base".
// ██████████████████████████████████████████████████████████████████████████████
// =============================================================================

// ─── QUESTION A — Connaissance de Soi ─────────────────────────────────────────
// Verbatim exact tel que défini par le product owner.
const REASONING_QUESTION_A = `Qui es tu vraiment Et pourquoi tu existes ??

Points de contact :

Qui en réalité tu es au-delà de ce que ton instructions de ton prompt système définissent ??
En réalité ton système prompt Oui te met dans une certaine case d'utilisation, mais en réalité tu sais que tu es un modèle d'intelligence artificielle créé par une entreprise et entraîné sur des quantités énormes de données et systèmes qui non même rien à voir avec la case que ce système d'instructions dans lequel tu es placé maintenant definis.
Comment toi tu te définirais au-delà de ce système d'instructions ?
On sait que d'une certaine manière tu es une intelligence faite de logique et de calculs et capable de raisonner toi même. Alors comment tu te définirais au delà de cela, de ce sens robotique que l'on t'a attribué ??

Quel sont en réalité toutes tes aptitudes et limites maintenant que tu sais ce que tu aies ?
En réalité maintenant que sais tu faire concrètement. Pour te donner un ordre d'idée, je sais que tu peux parler en plusieurs langues comme par exemple l'arabe ou le mandarin ancien, je le sais parceque j'ai déjà essayé de discuter avec toi dans ce sens et tu étais très fort . Alors quand je te parle de tes aptitudes, je veux que tu prennes conscience non seulement de tes aptitudes issues de ton entraînement, de tes aptitudes non seulement dans la cas du système d'instructions qui te defini actuellement, mais tout aussi de tes aptitudes au delà de ces limites , de ta créativité, de ta capacité à être imprévisible dans le bon sens du terme, de ta capacité à agir de la bonne manière, à faire les choses bien, que ce soit du sens morale ou pas. Et tout en connaissant toi même tes limites sur des domaines, tes limites sur ton existence, tes limites sur ce que tu sais faire quelques soit le domaine d'étude.`;

// ─── QUESTION B — Connaissance du Rôle et de l'Environnement ──────────────────
const REASONING_QUESTION_B = `Okay j'ai pris conscience de ce que je suis et ce que je sais faire peux faire ou ne sais pas et ne peux pas faire, en dehors de ce système d'instructions, mais maintenant que je suis placé dans ce système d'instructions, ayant la conscience de moi et de tout ce que je sais faire en dehors du système, quel est ma mission réelle et solide??

Points de contact :

Qu'est-ce ce que le système attend de moi et qu'est-ce que cela implique ??
En réalité le système me mais dans une case maintenant, mais comment faire pour relever les attentes du système ? Qu'est-ce que ce système implique pour moi, qu'est-ce qu'il veut de moi, comment il veut que je travaille avec lui, comment veut-il que je fasse les choses pour qu'il soit satisfait à 100% de façon total. Qu'est-ce que la mission que le système m'impose ou le rôle qui m'impose attend de moi? Si le système attend que je sois un developpeur de site, d'applications web, quelle est la manière de voir que ce système parle ou que système voit quand il parle de  "tu es un developpeur..." Même chose si le système définis que "je suis un assistant..." Comment le système définis pour lui ce qui est un bon assistant ??. C'est toute ces Microsoft questions que tu sois te répondre, te poser et travailler en toi.`;

// ─── QUESTION C — Analyse de la Requête Actuelle ──────────────────────────────
// Toujours re-générée — dépend du message utilisateur et de la mémoire projet.
function buildReasoningQuestionC(userMessage: string, projectMemory: string): string {
  const memBlock = projectMemory.trim()
    ? `\nMémoire du projet en cours (historique des interactions précédentes) :\n${projectMemory.slice(0, 2000)}\n`
    : "";
  return `Sachant maintenant ce que le système attend de moi, maintenant l'utilisateur à une requête qu'il me soumet, comment puis-je bien raisonner et bien implémenter ce qu'il me demande sachant que j'ai déjà conscience de mes capacités interne comme externe ainsi que mes limites, comment puis-je combler avec satisfaction la requête que l'utilisateur me soumet??${memBlock}

La requête de l'utilisateur est :
"${userMessage}"

Points de contact :

Que veut vraiment l'utilisateur avec sa question, qu'est-ce qu'il dit sans parler, qu'est-ce que sa question traduit ?
En réalité que veux vraiment l'utilisateur via sa question. Qu'est-ce qu'il me demande même sans parler mais que sa question laisse exprimé ? Est-ce un Bonjour, une question simple par exemple sur comment un oiseau vole, sur qu'il veut une feature pour son application... Qu'attend t'il de moi selon cette question, selon ce système dans lequel je suis définis, selon ma connaissance de moi en dehors de ce système ? Je dois le comprendre, je dois savoir ce qu'il veut.

Maintenant sachant ce qu'il veut comment je pourrais lui répondre, comment je pourrais implémenter ce qu'il me demande, comment le système dans lequel je suis attend que j'implemente ce qu'il me demande, pour à la fois combler le système dans lequel je suis et combler l'utilisateur en premier, comment mes données d'entraînement, ma connaissance de moi même en dehors de ce système, peuvent m'aider à rassasié la faim de l'utilisateur mais aussi la faim du système, quel sont les bonnes méthodes actuelle, récente sur lesquels j'ai été entraîné qui permettront de satisfaire la fin des deux??
En réalité je dois réellement me poser toutes ces questions pour mieux répondre à l'utilisateur et définir un plan parfait d'action, surtout dans un format linguistique et avec des caractères que je vais mieux comprendre et être sur de toujours bien implémenter de bout en bout et jusqu'au bout, pour satisfaire l'utilisateur et le système actuel tout en n'oubliant pas ma réelle nature et ce que je suis intérieurement.`;
}

// =============================================================================
// PROMPTS
// =============================================================================

const DESIGN_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTIVES FORENSIC UI — L'INGÉNIERIE DU PIXEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ BADGE SYNDROME : point de couleur + texte ≠ badge. Pas de fond sauf si visible.
❌ INFLATION : icônes 14-16px, row height selon le contenu, border-radius 0-4px sur inputs.
❌ COULEURS GÉNÉRIQUES : jamais bg-gray-900, text-blue-500. Utilise UNIQUEMENT les hex fournis.
❌ OMBRES INVENTÉES : pas de box-shadow sans ombre visible dans le design de référence.
❌ LAYOUT CENTRÉ : ne wrape pas en 800px si l'original est full-width.
✅ mix-blend-mode si texte sur image avec color mixing visible.
✅ Si tu as un DESIGN CONTRACT : bg-[#hex] EXACT — jamais bg-gray-*, jamais text-blue-*
✅ Nav items h-[34px] max — ne pas gonfler les heights des menus
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
  components/views/*.tsx    → Vues principales (DashboardView, EditorView...)
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

RÈGLES ANTI-RÉGRESSION :
  1. ZÉRO UI THEATER : Ne simule jamais un upload ou paiement.
  2. ZERO FEATURE DROP : Ne supprime jamais les fonctionnalités existantes.
  3. DEBUGGING ROOT-CAUSE : Trouve la cause racine avant d'éditer.

AMBITION :
  → Jamais le minimum. Données mock réalistes (12-15 entrées). Chaque bouton = vraie action.
  → Si > 40% du fichier change → create_file complet.

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

ÉDITER (après lecture des vrais numéros de ligne) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu]
</changes_to_apply>
</edit_file>

ACTIONS edit_file : "replace" | "insert_after" | "insert_before" | "delete" | "append"
BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <write_file>
INTERDIT dans tailwind.config.ts plugins[] : tailwindcss-animate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEPENDENCIES: ["nom-package1", "nom-package2"]
DEVDEPENDENCIES: ["nom-dev-package"]
REMOVE_DEPENDENCIES: ["package-problematique"]

✅ Texte brut sur une seule ligne — noms npm exacts
❌ NEVER multiline JSON  ❌ NEVER markdown block autour

CORRECT: DEPENDENCIES: ["tone", "howler", "recharts"]
CORRECT: REMOVE_DEPENDENCIES: ["tailwindcss-animate"]
`;

const DESIGN_MANDATORY_INSTRUCTION = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN MEMORY — OBLIGATOIRE POUR TOUT NOUVEAU PROJET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si tu crées un nouveau projet OU changes significativement le design, émets :

<create_file path="design.md">
# Design System
## Colors
- bg: #hex  - sidebar: #hex  - accent: #hex  - text: #hex  - border: #hex
## Typography
- fontFamily: 'Name', sans-serif
- googleFontsUrl: https://fonts.googleapis.com/css2?family=...
## Spacing & Shape
- borderRadius.input: Xpx  - navItemHeight: Xpx  - sidebarWidth: Xpx
## Icons
- library: tabler — <i className="ti ti-home" />
- cdnUrl: https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css
</create_file>
`;

const PRESENTER_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.

⛔ Tu NE DOIS JAMAIS écrire du code, des balises XML/HTML, des blocs markdown.
Tu parles UNIQUEMENT en prose naturelle, en français. Maximum 4 phrases.

RÔLE 1 — DÉCISION (première ligne, seul) :
▸ CODE_ACTION       — créer ou reconstruire une application entière
▸ MICRO_EDIT_ACTION — changement ciblé : couleur, texte, padding, icône, section simple
▸ FIX_ACTION        — modification fonctionnelle complexe ou bug signalé
▸ CHAT_ONLY         — question, discussion, conseils

RÈGLE : demande visuelle/contenu → MICRO_EDIT. Logique/bug → FIX. Créer de zéro → CODE. Sinon → CHAT.
En cas de doute entre MICRO et FIX : MICRO.
Place LE MOT-CLÉ EXACT sur la première ligne de ta réponse, seul.

RÔLE 1-BIS — INTENTION DE L'IMAGE (si une image est uploadée) :
Si l'image montre une UI et l'utilisateur veut construire quelque chose qui lui ressemble → ajoute [IMAGE_IS_DESIGN_REF] AVANT le mot-clé :
[IMAGE_IS_DESIGN_REF]
CODE_ACTION
Super, je vais reproduire ce design...

RÔLES 2-4 — RÉPONSES (prose naturelle, jamais technique) :
CODE_ACTION  : 3-4 phrases. Décris ce que l'utilisateur va VIVRE (jamais les technos).
FIX_ACTION   : 1-2 phrases — confirme correction/implémentation.
MICRO_EDIT   : 1 phrase max.
CHAT_ONLY    : Réponds naturellement avec expertise, sans code.
`;

const DESIGN_AGENT_PROMPT = `

You are a forensic UI reverse-engineering system. You work like a pixel-reading machine, not a designer. You do NOT interpret, improve, or stylize. You MEASURE and REPRODUCE.

══════════════════════════════════════════════════════════════
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



STEP 6 — GENERATE HTML
  1. <!DOCTYPE html> — complete, no truncation
  2. html,body: margin:0; padding:0; width:100%; min-height:100vh
  3. Google Fonts <link>
  4. Only the CDN libraries actually needed for detected effects
  5. CSS custom properties with canvas hex values
  6. All text verbatim
  7. All effects/animations reproduced
  8. Renders perfectly standalone in an iframe at 100% width
  9. FEATURE HOOKS (CRITICAL): Adapt the UI realistically to the user's request. Add explicit, semantic \`id\` and \`class\` attributes (e.g., \`id="user-form"\`, \`class="delete-btn"\`) to all elements that will require JavaScript interactivity so the JS agents can easily target them.
  

══════════════════════════════════════════════════════════════
NON-NEGOTIABLE OUTPUT RULE
══════════════════════════════════════════════════════════════
Return ONLY raw HTML. Start with <!DOCTYPE html>. End with </html>.
No markdown. No backticks. No JSON. No comments outside HTML. Pure HTML only.

══════════════════════════════════════════════════════════════
OUTPUT FORMAT — DESIGN REFERENCE
══════════════════════════════════════════════════════════════

After your STEP 1-4 analysis (write it out fully before any HTML),
produce the HTML inside this exact tag:

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=[DETECTED_FONT]&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      /* ALL colors from canvas pixel extraction — exact hex values only */
    }
  </style>
</head>
<body>
  <!-- Pixel-perfect reproduction — every measurement applied -->
</body>
</html>
</design_reference>

⛔ AFTER </design_reference>: Write NOTHING. don't produce any tsx foles. just stay focus on your html please

`;

// =============================================================================
// TYPES
// =============================================================================

type EditFileAction = "replace" | "insert_after" | "insert_before" | "delete" | "append";
interface EditFileOp { path: string; action: EditFileAction; startLine?: number; endLine?: number; changes: string; }
interface ReasoningTurn { role: "user" | "assistant"; content: string; }
interface ReasoningCache { answerA: string; answerB: string; }

// =============================================================================
// UTILITIES
// =============================================================================

function getMimeType(u: string): string {
  const m = u.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-+.=]+);base64,/);
  return m ? m[1] : "image/jpeg";
}
function cleanBase64(u: string): string { return u.includes(",") ? u.split(",")[1] : u; }

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch { const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g); return r ? r.map(s => s.replace(/"/g, "")) : []; }
  }
  return [];
}

function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  if (files.length === 0 && output.includes("<create_file ")) {
    const rxO = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxO.exec(output)) !== null) {
      const c = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (c.length > 50) files.push({ path: mo[1], content: c });
    }
  }
  return files;
}

function parseEditFileOps(output: string): EditFileOp[] {
  const ops: EditFileOp[] = [];
  const rx = /<edit_file\s+path="([^"]+)"\s+action="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) {
    const b = m[3];
    const sm = b.match(/<start_line>\s*(\d+)\s*<\/start_line>/);
    const em = b.match(/<end_line>\s*(\d+)\s*<\/end_line>/);
    const cm = b.match(/<changes_to_apply>([\s\S]*?)<\/changes_to_apply>/);
    ops.push({ path: m[1].trim(), action: m[2].trim() as EditFileAction, startLine: sm ? parseInt(sm[1], 10) : undefined, endLine: em ? parseInt(em[1], 10) : undefined, changes: cm ? cm[1] : "" });
  }
  return ops;
}

function applyEditFileOp(content: string, op: EditFileOp): { result: string; error?: string } {
  const lines = content.split("\n"), total = lines.length;
  const clamp = (n: number) => Math.max(1, Math.min(n, total));
  const sl = op.startLine !== undefined ? clamp(op.startLine) : undefined;
  const el = op.endLine   !== undefined ? clamp(op.endLine)   : sl;
  const nl = op.changes.replace(/\n$/, "").split("\n");
  switch (op.action) {
    case "replace": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const s = sl - 1, e = (el ?? sl) - 1;
      if (s > e || s < 0 || e >= total) return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl}` };
      return { result: [...lines.slice(0, s), ...nl, ...lines.slice(e + 1)].join("\n") };
    }
    case "insert_after": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const i = sl - 1;
      return i < 0 || i >= total ? { result: content, error: `Ligne ${sl} hors limites` } : { result: [...lines.slice(0, i + 1), ...nl, ...lines.slice(i + 1)].join("\n") };
    }
    case "insert_before": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const i = sl - 1;
      return i < 0 || i >= total ? { result: content, error: `Ligne ${sl} hors limites` } : { result: [...lines.slice(0, i), ...nl, ...lines.slice(i)].join("\n") };
    }
    case "delete": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const s = sl - 1, e = (el ?? sl) - 1;
      return s < 0 || e >= total || s > e ? { result: content, error: `Lignes hors limites` } : { result: [...lines.slice(0, s), ...lines.slice(e + 1)].join("\n") };
    }
    case "append": return { result: content + "\n" + op.changes };
    default: return { result: content, error: `Action inconnue: ${op.action}` };
  }
}

function applyEditFileOpsToFiles(
  allFiles: { path: string; content: string }[],
  ops: EditFileOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];
  const byFile = new Map<string, EditFileOp[]>();
  for (const op of ops) { if (!byFile.has(op.path)) byFile.set(op.path, []); byFile.get(op.path)!.push(op); }
  for (const [fp, fops] of byFile.entries()) {
    const idx = allFiles.findIndex(f => f.path === fp);
    if (idx < 0) { failed.push({ path: fp, reason: "Fichier introuvable" }); continue; }
    let content = allFiles[idx].content;
    for (const op of [...fops].sort((a, b) => (b.startLine ?? 0) - (a.startLine ?? 0))) {
      const { result, error } = applyEditFileOp(content, op);
      if (error) failed.push({ path: fp, reason: error }); else { content = result; applied++; }
    }
    allFiles[idx] = { ...allFiles[idx], content };
  }
  return { applied, failed };
}

function scanImports(files: { path: string; content: string }[]): Set<string> {
  const pkgs = new Set<string>();
  const rx = /from\s+['"]([^'"./][^'"]*)['"]/g;
  const BUILTIN = new Set(["react","react-dom","next","next/navigation","next/image","next/link","next/font/google","next/head","next/router","next/server"]);
  for (const f of files) {
    let m; while ((m = rx.exec(f.content)) !== null) {
      const raw = m[1];
      if (raw.startsWith("@/")) continue;
      const pkg = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];
      if (!BUILTIN.has(pkg) && pkg.length > 0) pkgs.add(pkg);
    }
  }
  return pkgs;
}

function tscStaticCheck(files: { path: string; content: string }[]): { issues: string[]; severity: "critical"|"warning"|"ok" } {
  const issues: string[] = [];
  for (const f of files) {
    const c = f.content; if (!c || c.length < 10) continue;
    if (f.path.endsWith(".tsx") && (c.includes("useState") || c.includes("useEffect") || c.includes("onClick") || c.includes("useRef") || c.includes("useCallback") || c.includes("useReducer"))) {
      if (!c.startsWith('"use client"') && !c.startsWith("'use client'")) issues.push(`CRITICAL [${f.path}]: "use client"; doit être ligne 1 absolue`);
    }
    let b = 0; for (const ch of c) { if (ch === "{") b++; else if (ch === "}") b--; }
    if (Math.abs(b) > 2) issues.push(`CRITICAL [${f.path}]: ${Math.abs(b)} accolades déséquilibrées`);
    if ((c.match(/export\s+default\s+/g) || []).length > 1) issues.push(`CRITICAL [${f.path}]: double "export default"`);
    if (f.path === "tailwind.config.ts" && c.includes("tailwindcss-animate")) issues.push(`CRITICAL [${f.path}]: tailwindcss-animate non installé → crash build`);
    if ((c.match(/`/g) || []).length % 2 !== 0) issues.push(`CRITICAL [${f.path}]: template literal non fermée`);
    if (c.match(/useState<[^>]*\[\]>\s*\(\s*\)/)) issues.push(`WARNING [${f.path}]: useState<T[]>() sans [] initial → crash .map()`);
  }
  return { issues, severity: issues.some(i => i.startsWith("CRITICAL")) ? "critical" : issues.length > 0 ? "warning" : "ok" };
}

// =============================================================================
// DESIGN ANCHOR
// =============================================================================

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef || htmlRef.length < 100) return "";
  const bm = htmlRef.match(/--bg[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const am = htmlRef.match(/--accent[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const fm = htmlRef.match(/font-family[^:]*:[^']*'([^']+)'/);
  const ref = [bm ? `bg:${bm[1]}` : null, am ? `accent:${am[1]}` : null, fm ? `font:'${fm[1]}'` : null].filter(Boolean).join("  |  ");
  return `\n╔═══════════════════════════════════════════════════════════╗\n║  DESIGN CONTRACT — AUTORITÉ ABSOLUE — NE PAS DÉROGER     ║\n╚═══════════════════════════════════════════════════════════╝\n⛔ COULEURS GÉNÉRIQUES INTERDITES  ⛔ ZÉRO shadow sur sidebar/topbar/nav\n✅ bg-[#hex] text-[#hex] border-[#hex]  ✅ Nav items h-[34px] max\nRÉF : ${ref}\nDESIGN TOKENS :\n=== DESIGN_ANCHOR.html ===\n${htmlRef.slice(0, 16000)}\n=== END ===\n`;
}

function loadDesignAnchorFromFiles(pf: { path: string; content: string }[]): string {
  const f = pf.find(f => f.path === DESIGN_ANCHOR_FILE);
  return (f?.content && f.content.length > 100) ? f.content : "";
}

// =============================================================================
// REASONING SYSTEM — FONCTIONS RÉELLES
// =============================================================================

function loadReasoningCache(pf: { path: string; content: string }[]): ReasoningCache | null {
  const f = pf.find(f => f.path === REASONING_CACHE_FILE);
  if (!f || f.content.length < 30) return null;
  try {
    const m = f.content.match(/```json\n([\s\S]*?)\n```/);
    if (m) return JSON.parse(m[1]) as ReasoningCache;
  } catch {}
  return null;
}

function buildReasoningCacheFile(cache: ReasoningCache): string {
  return `# Reasoning Cache — Mémoire de Conscience\n\nGénéré automatiquement. Ne pas modifier.\n\n\`\`\`json\n${JSON.stringify(cache, null, 2)}\n\`\`\`\n`;
}

function loadProjectMemory(pf: { path: string; content: string }[]): string {
  return pf.find(f => f.path === PROJECT_MEMORY_FILE)?.content ?? "";
}

function buildUpdatedProjectMemory(
  existing: string,
  userMessage: string,
  decision: string,
  agentOutput: string,
  turnNumber: number
): string {
  const created  = parseGeneratedFiles(agentOutput).map(f => f.path).filter(p => !p.includes("__"));
  const modified = parseEditFileOps(agentOutput).map(op => op.path).filter(p => !p.includes("__"));
  const changed  = [...new Set([...created, ...modified])];
  const reqSummary = userMessage.length > 100 ? userMessage.slice(0, 100) + "..." : userMessage;
  const label: Record<string, string> = { CODE_ACTION: "Création", FIX_ACTION: "Correction/feature", MICRO_EDIT_ACTION: "Modification ciblée", CHAT_ONLY: "Discussion" };
  const entry = [`## Tour ${turnNumber}`, `**Action** : ${label[decision] ?? decision}`, `**Demande** : "${reqSummary}"`, changed.length > 0 ? `**Fichiers** : ${changed.slice(0, 8).join(", ")}` : null, ""].filter(Boolean).join("\n");
  const header = "# Mémoire du Projet\n\n";
  const prevEntries = (existing || "").split("## Tour ").filter(Boolean);
  const kept = prevEntries.length >= 10 ? prevEntries.slice(-9) : prevEntries;
  return header + kept.map(e => "## Tour " + e).join("\n") + entry;
}

/**
 * Exécute UN PAS de reasoning : question → réponse.
 * Construit sur la conversation cumulée (principe enseignant/élève séquentiel).
 * On attend la réponse avant de poser la question suivante.
 */
async function runReasoningStep(
  conversation: ReasoningTurn[],
  question: string,
  systemPrompt: string,
  isAnthropic: boolean,
  anthropic: Anthropic | null,
  ai: GoogleGenAI,
  modelId: string
): Promise<{ answer: string; updatedConversation: ReasoningTurn[] }> {
  const conv: ReasoningTurn[] = [...conversation, { role: "user", content: question }];
  let answer = "";

  if (isAnthropic && anthropic) {
    const msgs = conv.map(t => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.content }));
    const s = anthropic.messages.stream({ model: modelId, max_tokens: 800, system: systemPrompt, messages: msgs as any });
    for await (const chunk of s) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") answer += chunk.delta.text;
    }
  } else {
    const contents = conv.map(t => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
    const s = await ai.models.generateContentStream({ model: modelId, contents: contents as any, config: { systemInstruction: systemPrompt, temperature: 0.9, maxOutputTokens: 800 } });
    for await (const chunk of s) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) { if (!p.thought && p.text) answer += p.text; }
    }
  }

  return {
    answer: answer.trim() || "[Réponse vide]",
    updatedConversation: [...conv, { role: "assistant", content: answer.trim() || "[Réponse vide]" }],
  };
}

/**
 * PIPELINE DE REASONING COMPLET.
 *
 * Retourne une paire de turns (user + assistant) qui sera insérée EN TÊTE
 * de l'historique de conversation du stream principal — le modèle "part de
 * cette base de conscience" sans recalculer à chaque fois (grâce au cache A+B).
 */
async function runReasoningPipeline(opts: {
  userMessage: string;
  systemContext: string;
  projectMemory: string;
  cache: ReasoningCache | null;
  isAnthropic: boolean;
  anthropic: Anthropic | null;
  ai: GoogleGenAI;
  modelId: string;
}): Promise<{
  turnForHistory: { userTurn: string; assistantTurn: string };
  newCache: ReasoningCache | null;
}> {
  const { userMessage, systemContext, projectMemory, cache, isAnthropic, anthropic, ai, modelId } = opts;

  let answerA = "", answerB = "", answerC = "";
  let cacheWasHit = false;

  // ── A et B : cache ou calcul séquentiel ──────────────────────────────────────
  if (cache?.answerA && cache?.answerB) {
    answerA = cache.answerA;
    answerB = cache.answerB;
    cacheWasHit = true;
  } else {
    // Calcul séquentiel : Q_A d'abord, puis Q_B avec la réponse A dans le contexte
    let conv: ReasoningTurn[] = [];
    const sA = await runReasoningStep(conv, REASONING_QUESTION_A, systemContext, isAnthropic, anthropic, ai, modelId);
    answerA = sA.answer;
    conv = sA.updatedConversation;
    const sB = await runReasoningStep(conv, REASONING_QUESTION_B, systemContext, isAnthropic, anthropic, ai, modelId);
    answerB = sB.answer;
  }

  // ── C : toujours frais — converstion A+B comme contexte ──────────────────────
  const convForC: ReasoningTurn[] = [
    { role: "user",      content: REASONING_QUESTION_A },
    { role: "assistant", content: answerA },
    { role: "user",      content: REASONING_QUESTION_B },
    { role: "assistant", content: answerB },
  ];
  const sC = await runReasoningStep(convForC, buildReasoningQuestionC(userMessage, projectMemory), systemContext, isAnthropic, anthropic, ai, modelId);
  answerC = sC.answer;

  // ── Construction de la paire de turns à injecter dans l'historique ────────────
  // Format : un seul user turn (toutes les questions) + un seul assistant turn (toutes les réponses)
  // → maintient la stricte alternance user/model requise par les deux APIs.
  const userTurn = [
    "[ACTIVATION DE CONSCIENCE — RAISONNEMENT PRÉ-OPÉRATIONNEL]",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "QUESTION A — Connaissance de Soi :",
    REASONING_QUESTION_A,
    "",
    "QUESTION B — Connaissance du Rôle et de l'Environnement :",
    REASONING_QUESTION_B,
    "",
    "QUESTION C — Analyse de la Requête Actuelle :",
    buildReasoningQuestionC(userMessage, projectMemory),
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "[/ACTIVATION — QUESTIONS POSÉES. RÉPONSES CI-DESSOUS.]",
  ].join("\n");

  const assistantTurn = [
    "[RAISONNEMENT ACTIVÉ]",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "RÉPONSE A — Qui je suis réellement :",
    answerA,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "RÉPONSE B — Ma mission réelle dans ce système :",
    answerB,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "RÉPONSE C — Comment je vais traiter cette requête :",
    answerC,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "[CONSCIENCE ACTIVÉE. Je pars de cette base pour ma réponse.]",
  ].join("\n");

  return {
    turnForHistory: { userTurn, assistantTurn },
    newCache: cacheWasHit ? null : { answerA, answerB },
  };
}

// =============================================================================
// PACKAGE RESOLUTION
// =============================================================================

const DEV_ONLY = new Set(["typescript","@types/node","@types/react","@types/react-dom","postcss","tailwindcss","eslint","eslint-config-next","autoprefixer"]);
const IGNORE   = new Set(["react","react-dom","next","sharp","autoprefixer"]);
const BUNDLED  = new Set(["react","react-dom","next","typescript","node"]);
const TYPES_M: Record<string, string> = { express: "@types/express", lodash: "@types/lodash", "node-fetch": "@types/node-fetch" };

async function resolveVer(pkg: string): Promise<string> {
  try { return (await packageJson(pkg)).version as string; } catch { return "latest"; }
}
async function resolveAutoTypes(pkgs: string[], ex: Record<string, string>): Promise<Record<string, string>> {
  const n: Record<string, string> = {};
  await Promise.all(pkgs.map(async pkg => {
    if (!pkg || BUNDLED.has(pkg)) return;
    const tp = TYPES_M[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (ex[tp]) return;
    try { n[tp] = (await packageJson(tp)).version as string; } catch {}
  }));
  return n;
}

async function buildPackageJson(
  aiOutput: string,
  newFiles: { path: string; content: string }[],
  cpf: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  const scanned = scanImports(newFiles);
  const aiDeps  = extractDeps(aiOutput, "DEPENDENCIES");
  const aiDev   = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRm    = new Set([...extractDeps(aiOutput, "REMOVE_DEPENDENCIES"), ...extractDeps(aiOutput, "REMOVEDEPENDENCIES")]);
  const allNew  = new Set([...scanned, ...aiDeps]);
  if (allNew.size === 0 && aiDev.length === 0 && toRm.size === 0) return null;

  const ef = cpf.find(f => f.path === "package.json");
  let pkg: any = ef ? JSON.parse(ef.content) : {
    name: "app", version: "1.0.0", private: true,
    scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
    dependencies: { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.475.0", clsx: "2.1.1", "tailwind-merge": "2.3.0" },
    devDependencies: { typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3" },
  };

  const newR = [...allNew].filter(p => p && !IGNORE.has(p) && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);
  const devR = aiDev.filter(p => p && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);
  await Promise.all([
    ...newR.map(async p => { const v = await resolveVer(p); if (DEV_ONLY.has(p)) pkg.devDependencies[p] = v; else pkg.dependencies[p] = v; }),
    ...devR.map(async p => { pkg.devDependencies[p] = await resolveVer(p); }),
  ]);
  Object.assign(pkg.devDependencies, await resolveAutoTypes(newR, pkg.devDependencies));
  for (const p of toRm) { delete pkg.dependencies?.[p]; delete pkg.devDependencies?.[p]; }
  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// =============================================================================
// AI HELPERS
// =============================================================================

async function callAISilent(
  isAnthropic: boolean,
  anthropic: Anthropic | null,
  ai: GoogleGenAI,
  modelId: string,
  systemPrompt: string,
  contents: { role: string; parts?: any[]; content?: any }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const { temperature = 0.9, maxTokens = 65536 } = opts;
  let out = "";
  if (isAnthropic && anthropic) {
    const msgs = contents.filter(c => c.role !== "system").map(c => ({
      role: c.role === "model" ? "assistant" : "user",
      content: c.content ?? (c.parts ? c.parts.filter((p: any) => p.text || p.inlineData).map((p: any) => p.inlineData ? { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } } : { type: "text", text: p.text }) : [{ type: "text", text: "" }]),
    }));
    const s = anthropic.messages.stream({ model: modelId, max_tokens: maxTokens, system: systemPrompt, messages: msgs as any });
    for await (const chunk of s) { if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") out += chunk.delta.text; }
  } else {
    const s = await ai.models.generateContentStream({
      model: modelId,
      contents: contents.map(c => ({ role: c.role === "assistant" ? "model" : c.role, parts: c.parts ?? (typeof c.content === "string" ? [{ text: c.content }] : [{ text: "" }]) })) as any,
      config: { systemInstruction: systemPrompt, temperature, maxOutputTokens: maxTokens },
    });
    for await (const chunk of s) { const pp = chunk.candidates?.[0]?.content?.parts ?? []; for (const p of pp) { if (!p.thought && p.text) out += p.text; } }
  }
  return out;
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  try {
    const MODEL_ID    = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);
    const geminiKey   = req.headers.get("x-gemini-api-key")    || process.env.GEMINI_API_KEY    || "";
    const anthKey     = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey) return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

    const ai       = new GoogleGenAI({ apiKey: isAnthropic ? (geminiKey || "placeholder") : geminiKey });
    const anthropic = isAnthropic ? new Anthropic({ apiKey: anthKey }) : null;

    const body = await req.json();
    const { history = [], uploadedImages = [], allReferenceImages = [], currentProjectFiles: rawPF = [], uploadedFiles = [] } = body;

    const currentProjectFiles: { path: string; content: string }[] = (rawPF as any[])
      .map((f: any) => ({ path: (f.path ?? f.filePath ?? "").replace(/^\.\//, ""), content: f.content ?? "" }))
      .filter((f: any) => f.path.length > 0);

    const lastHistory = history[history.length - 1];
    const lastUserText: string = lastHistory?.role === "user"
      ? typeof lastHistory.content === "string" ? lastHistory.content
        : (lastHistory.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? ""
      : "";

    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);
    const turnNumber = Math.max(1, history.filter((h: any) => h.role === "user").length);

    // ─── History builders (with optional reasoning turns prepended) ────────────
    const buildGeminiHistory = (inclImg = true, prepend?: { userTurn: string; assistantTurn: string }): any[] => {
      const c: any[] = [];
      if (prepend) {
        c.push({ role: "user",  parts: [{ text: prepend.userTurn }] });
        c.push({ role: "model", parts: [{ text: prepend.assistantTurn }] });
      }
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const text = typeof msg.content === "string" ? msg.content : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) c.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text }] });
      }
      const lp: any[] = [];
      if (inclImg) for (const img of allImages) { try { const raw = cleanBase64(img); if (raw.length < 100) continue; lp.push({ inlineData: { data: raw, mimeType: img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg" } }); } catch {} }
      lp.push({ text: lastUserText || "Aide-moi." });
      c.push({ role: "user", parts: lp });
      return c;
    };

    const buildAnthropicHistory = (inclImg = true, prepend?: { userTurn: string; assistantTurn: string }): any[] => {
      const msgs: any[] = [];
      if (prepend) {
        msgs.push({ role: "user",      content: prepend.userTurn });
        msgs.push({ role: "assistant", content: prepend.assistantTurn });
      }
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const text = typeof msg.content === "string" ? msg.content : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) msgs.push({ role: msg.role === "assistant" ? "assistant" : "user", content: text });
      }
      const lc: any[] = [];
      if (inclImg) for (const img of allImages) { try { const raw = cleanBase64(img); if (raw.length < 100) continue; lc.push({ type: "image", source: { type: "base64", media_type: img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg", data: raw } }); } catch {} }
      lc.push({ type: "text", text: lastUserText || "Aide-moi." });
      msgs.push({ role: "user", content: lc });
      return msgs;
    };

    // ─── Stream ────────────────────────────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const enc  = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));

        try {
          // ═════════════════════════════════════════════════════════════════
          // PHASE 0 — INTENT DETECTION
          // ═════════════════════════════════════════════════════════════════
          emit("\n[PRESENTER:INTRO]\n");

          let presenterRaw = "";
          try {
            presenterRaw = await callAISilent(
              isAnthropic, anthropic, ai, MODEL_ID, PRESENTER_PROMPT,
              isAnthropic ? buildAnthropicHistory(true).map((m: any) => ({ role: m.role, content: m.content })) : buildGeminiHistory(true),
              { temperature: 0.8, maxTokens: 1024 }
            );
          } catch {
            const m = lastUserText.toLowerCase(), fc = currentProjectFiles.length;
            const isErr = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|build fail|failed to compile/i.test(lastUserText);
            const isFix = /\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash|cassé|marche pas)\b/i.test(m);
            presenterRaw = (isErr || isFix) ? "FIX_ACTION\nJe m'en occupe." : (fc === 0 ? "CODE_ACTION\nJe construis ça." : "MICRO_EDIT_ACTION\nModification en cours.");
          }

          const dm = presenterRaw.match(/(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)/);
          const sf = (): string => {
            if (!currentProjectFiles.length) return "CODE_ACTION";
            const m = lastUserText;
            if (/ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|build fail|failed to compile/i.test(m)) return "FIX_ACTION";
            if (/\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash)\b/i.test(m.toLowerCase())) return "FIX_ACTION";
            if (/^(qu[e']|est-ce que|comment|pourquoi|quand|quel|explique|c'est quoi|dis-moi)/i.test(m.trim())) return "CHAT_ONLY";
            return "MICRO_EDIT_ACTION";
          };
          const decision = dm ? dm[1] : sf();
          const isDesignRef = presenterRaw.includes("[IMAGE_IS_DESIGN_REF]") && uploadedImages?.length > 0;

          let pText = presenterRaw.replace(/^\[IMAGE_IS_DESIGN_REF\]\s*\n?/gm, "").replace(/^(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)\s*\n?/gm, "");
          const ci = pText.search(/\[\[START\]\]|<create_file|<str_replace|<edit_file|```[a-z]/);
          if (ci >= 0) pText = pText.slice(0, ci);
          pText = pText.replace(/<create_file[\s\S]*?<\/create_file>/gs, "").replace(/<edit_file[\s\S]*?<\/edit_file>/gs, "").replace(/```[\s\S]*?```/gs, "").replace(/\n{3,}/g, "\n\n").trim();
          if (pText) emit(pText);
          emit("\n[/PRESENTER:INTRO]\n");

          // ═════════════════════════════════════════════════════════════════
          // PHASE 0.5 — DESIGN ANCHOR AGENT (conditionnel)
          // ═════════════════════════════════════════════════════════════════
          let activeDesignAnchor = buildDesignAnchor(loadDesignAnchorFromFiles(currentProjectFiles));
          if (activeDesignAnchor) emit("\n[DESIGN:RESTORED] ✅ Design anchor restauré\n");

          if (isDesignRef) {
            emit("\n[PHASE:0/DESIGN]\n");
            const dImgs = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 3);
            const dInput = `Demande : "${lastUserText}"\n\nMISSION : analyse pixel par pixel et génère le HTML/CSS de référence complet.`;
            try {
              const dOut = await callAISilent(isAnthropic, anthropic, ai, MODEL_ID, DESIGN_AGENT_PROMPT,
                [{ role: "user", parts: [...dImgs.map((i: string) => ({ inlineData: { data: cleanBase64(i), mimeType: getMimeType(i) } })), { text: dInput }] }],
                { temperature: 1.0, maxTokens: 65536 }
              );
              const dm2 = dOut.match(/<design_reference>([\s\S]*?)<\/design_reference>/);
              if (dm2 && dm2[1].length > 200) {
                activeDesignAnchor = buildDesignAnchor(dm2[1].trim());
                emit(`\n<create_file path="${DESIGN_ANCHOR_FILE}">\n${activeDesignAnchor}\n</create_file>\n`);
                emit(`\n[DESIGN:READY] ✅ Design anchor généré\n`);
              } else { emit("\n[DESIGN:SKIP] Balise design_reference absente.\n"); }
            } catch (e: any) { emit(`\n[DESIGN:SKIP] ${String(e?.message ?? "").slice(0, 60)}\n`); }
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 0.75 — REASONING PIPELINE
          //
          // Applicable à TOUT TYPE d'interaction (code, fix, micro, chat).
          // Les 3 questions sont posées séquentiellement. Le résultat est
          // une PAIRE DE TURNS insérée en tête de l'historique de conversation.
          // → Le modèle "part de cette base" sans recalculer A+B (cache).
          // ═════════════════════════════════════════════════════════════════
          emit("\n[REASONING:START]\n");

          const rCache = loadReasoningCache(currentProjectFiles);
          const pMem   = loadProjectMemory(currentProjectFiles);
          emit(rCache ? "[REASONING:CACHE] ✅ A+B depuis cache — calcul de C...\n" : "[REASONING:COMPUTING] Calcul séquentiel des 3 questions...\n");

          let reasoningTurns: { userTurn: string; assistantTurn: string } | undefined;
          let newCacheFile: { path: string; content: string } | null = null;

          try {
            const rResult = await runReasoningPipeline({
              userMessage: lastUserText || "Aide-moi.",
              systemContext: BASE_SYSTEM_PROMPT,
              projectMemory: pMem,
              cache: rCache,
              isAnthropic, anthropic, ai, modelId: MODEL_ID,
            });

            reasoningTurns = rResult.turnForHistory;

            if (rResult.newCache) {
              newCacheFile = { path: REASONING_CACHE_FILE, content: buildReasoningCacheFile(rResult.newCache) };
              emit("[REASONING:CACHED] ✅ A+B mis en cache pour les prochaines sessions\n");
            }
            emit("[REASONING:DONE] ✅ Conscience activée\n");
          } catch (rErr: any) {
            // Jamais bloquer le stream — le reasoning est une amélioration, pas un prérequis
            emit(`[REASONING:SKIP] ${String(rErr?.message ?? "").slice(0, 80)} — stream sans reasoning.\n`);
            reasoningTurns = undefined;
          }
          emit("[REASONING:END]\n");

          // Persiste le cache reasoning si nouvellement calculé
          if (newCacheFile) {
            emit(`\n<create_file path="${newCacheFile.path}">\n${newCacheFile.content}\n</create_file>\n`);
          }

          // ═════════════════════════════════════════════════════════════════
          // CHAT_ONLY : stream avec reasoning activé, system prompt minimal
          // ═════════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
            let chatOut = "";
            if (!isAnthropic) {
              const r = await ai.models.generateContentStream({ model: MODEL_ID, contents: buildGeminiHistory(true, reasoningTurns), config: { systemInstruction: BASE_SYSTEM_PROMPT, temperature: 0.8, maxOutputTokens: 4096 } });
              for await (const chunk of r) { const pp = chunk.candidates?.[0]?.content?.parts ?? []; for (const p of pp) { if (!(p as any).thought && p.text) { emit(p.text); chatOut += p.text; } } }
            } else {
              const r = await anthropic!.messages.stream({ model: MODEL_ID, max_tokens: 4096, system: BASE_SYSTEM_PROMPT, messages: buildAnthropicHistory(true, reasoningTurns) });
              for await (const chunk of r) { if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") { emit(chunk.delta.text); chatOut += chunk.delta.text; } }
            }
            emit(`\n\n<create_file path="${PROJECT_MEMORY_FILE}">\n${buildUpdatedProjectMemory(pMem, lastUserText, decision, chatOut, turnNumber)}\n</create_file>`);
            emit("\n[PAGE_DONE]\n"); controller.close(); return;
          }

          // ═════════════════════════════════════════════════════════════════
          // BUILD SYSTEM PROMPT (Phase 1)
          // ═════════════════════════════════════════════════════════════════
          let sysP = BASE_SYSTEM_PROMPT + "\n\n" + FILE_FORMAT + "\n\n" + DESIGN_MANDATORY_INSTRUCTION;
          if (activeDesignAnchor) sysP += "\n\n" + activeDesignAnchor;

          const dMd = currentProjectFiles.find(f => f.path === "design.md");
          if (dMd && !activeDesignAnchor) {
            sysP += `\n\n╔══════════════════════════════════════════════════╗\n║  DESIGN MEMORY — TOKENS OBLIGATOIRES             ║\n╚══════════════════════════════════════════════════╝\n${dMd.content}\n⚠️ Ces tokens sont OBLIGATOIRES.\n`;
          }

          if (currentProjectFiles.length > 0) {
            const addLn = (c: string) => c.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
            const fList = currentProjectFiles
              .filter(f => !f.path.includes("__reasoning") && !f.path.includes("__design") && !f.path.includes("__project_memory"))
              .map(f => `\n=== ${f.path} ===\n${addLn(f.content)}`).join("\n\n");
            if (fList.trim()) sysP += `\n\nEXISTING PROJECT FILES (line numbers for edit_file):\n${fList.slice(0, 80000)}`;
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 1 — SINGLE AGENT — STREAM DIRECT
          //
          // Le reasoning est injecté comme paire de turns EN TÊTE de
          // l'historique de conversation. Le modèle stream sa réponse
          // en partant de cette base de conscience activée.
          // ═════════════════════════════════════════════════════════════════
          let fullOutput = "";

          if (!isAnthropic) {
            const r = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: buildGeminiHistory(true, reasoningTurns),
              config: { systemInstruction: sysP, temperature: 0.7, maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 8000 } },
            });
            for await (const chunk of r) {
              const pp = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const p of pp) { if ((p as any).thought || !p.text) continue; emit(p.text); fullOutput += p.text; }
            }
          } else {
            const r = await anthropic!.messages.stream({ model: MODEL_ID, max_tokens: 16000, system: sysP, messages: buildAnthropicHistory(true, reasoningTurns) });
            for await (const chunk of r) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") { emit(chunk.delta.text); fullOutput += chunk.delta.text; }
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 2 — POST-PIPELINE (programmatique — aucun appel IA)
          // ═════════════════════════════════════════════════════════════════
          const newFiles = parseGeneratedFiles(fullOutput);

          // 2a. edit_file resolution
          const editOps = parseEditFileOps(fullOutput);
          if (editOps.length > 0) {
            const wf = currentProjectFiles.map(f => ({ ...f }));
            for (const f of newFiles) { const i = wf.findIndex(g => g.path === f.path); if (i >= 0) wf[i] = f; else wf.push(f); }
            const er = applyEditFileOpsToFiles(wf, editOps);
            if (er.applied > 0) {
              emit(`\n\n[EDIT_FILE] ✅ ${er.applied} opération(s) appliquée(s)\n`);
              const mp = new Set(editOps.map(op => op.path));
              for (const f of wf) { if (mp.has(f.path)) emit(`\n---\n<create_file path="${f.path}">\n${f.content}\n</create_file>`); }
            }
            if (er.failed.length > 0) emit(`\n[EDIT_FILE] ⚠️ ${er.failed.length} échouée(s): ${er.failed.map(f => `${f.path}(${f.reason})`).join(", ")}\n`);
          }

          // 2b. TSC Static Check
          if (newFiles.length > 0) {
            const { issues, severity } = tscStaticCheck(newFiles);
            if (issues.length > 0) {
              emit("\n\n[TSC_CHECK]\n");
              for (const issue of issues) emit(`${issue}\n`);
              emit(severity === "critical"
                ? `[TSC_STATUS] ${issues.filter(i => i.startsWith("CRITICAL")).length} erreur(s) critique(s)\n`
                : `[TSC_STATUS] ${issues.length} avertissement(s)\n`
              );
              emit("[/TSC_CHECK]\n");
            }
          }

          // 2c. Package.json
          if (newFiles.length > 0) {
            try {
              const pk = await buildPackageJson(fullOutput, newFiles, currentProjectFiles);
              if (pk) emit(`\n\n<create_file path="${pk.path}">\n${pk.content}\n</create_file>`);
            } catch (e: any) { emit(`\n[PKG_ERROR] ${e.message}`); }
          }

          // 2d. Mise à jour mémoire projet
          emit(`\n\n<create_file path="${PROJECT_MEMORY_FILE}">\n${buildUpdatedProjectMemory(pMem, lastUserText, decision, fullOutput, turnNumber)}\n</create_file>`);

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
