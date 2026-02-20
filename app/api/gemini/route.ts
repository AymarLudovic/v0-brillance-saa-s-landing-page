import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";

const BATCH_SIZE = 128;
const MODEL_ID   = "gemini-3-flash-preview";

// =============================================================================
// TYPES
// =============================================================================

interface GeneratedFile { path: string; content: string; }

// =============================================================================
// SVG PROGRESS SYSTEM
// =============================================================================

const SVG_SPINNER  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;animation:spin 1s linear infinite"><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
const SVG_CHECK    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_ERROR    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
const SVG_CODE     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const SVG_PALETTE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;
const SVG_SEARCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
const SVG_SHIELD   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_WRENCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const SVG_PACKAGE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const SVG_SPARKLES = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;

function phaseBlock(
  id: string, icon: string, label: string,
  status: "processing" | "done" | "error", detail = ""
): string {
  const c  = status === "done" ? "#22c55e" : status === "error" ? "#ef4444" : "#6366f1";
  const si = status === "done" ? SVG_CHECK  : status === "error" ? SVG_ERROR  : SVG_SPINNER;
  const st = status === "done" ? "Terminé"  : status === "error" ? "Erreur"   : "En cours...";
  return `\n<div data-phase-id="${id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:6px 0;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-left:3px solid ${c};border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;color:#374151"><span style="color:${c};flex-shrink:0">${si}</span><span style="color:${c};flex-shrink:0">${icon}</span><span style="font-weight:600;flex:1">${label}</span><span style="color:${c};font-size:12px;font-weight:500">${st}</span>${detail ? `<span style="color:#9ca3af;font-size:11px;margin-left:4px">${detail}</span>` : ""}</div>\n`;
}

// =============================================================================
// UTILITAIRES
// =============================================================================

function getMimeTypeFromBase64(dataUrl: string) {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return m ? m[1] : "application/octet-stream";
}
function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}
function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch { const r = m[1].match(/"([a-zA-Z0-9-@/.]+)"/g); return r ? r.map(s => s.replace(/"/g, "")) : []; }
  }
  return [];
}
function parseGeneratedFiles(output: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  return files;
}
function filterBlueprintXml(text: string): string {
  return text
    .replace(/<feature[\s\S]*?<\/feature>/gi, "")
    .replace(/<env_file_required[\s\S]*?<\/env_file_required>/gi, "")
    .replace(/<build_order[\s\S]*?<\/build_order>/gi, "")
    .replace(/<blocker[\s\S]*?<\/blocker>/gi, "")
    .replace(/<requires_account[^>]*\/?>/gi, "")
    .replace(/<what>[\s\S]*?<\/what>/gi, "")
    .replace(/<real_package>[\s\S]*?<\/real_package>/gi, "")
    .replace(/<real_service>[\s\S]*?<\/real_service>/gi, "")
    .replace(/<env_vars>[\s\S]*?<\/env_vars>/gi, "")
    .replace(/<real_implementation>[\s\S]*?<\/real_implementation>/gi, "")
    .replace(/<forbidden>[\s\S]*?<\/forbidden>/gi, "")
    .replace(/<typescript_requirements>[\s\S]*?<\/typescript_requirements>/gi, "")
    .replace(/<architecture_patterns>[\s\S]*?<\/architecture_patterns>/gi, "")
    .replace(/<files_to_create>[\s\S]*?<\/files_to_create>/gi, "")
    .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
    .replace(/DEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .replace(/DEVDEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .trim();
}

// =============================================================================
// SURCOUCHE VISUELLE — LOI ABSOLUE DE DESIGN
// Injecté dans TOUS les agents, pas uniquement le Builder.
// Rédigé en prose continue pour que l'IA l'intériorise comme une conviction.
// =============================================================================

const SURCOUCHE_VISUAL_LAW = `
Tu vas construire — ou modifier — une interface qui déclenche une réaction émotionnelle immédiate chez celui qui la voit pour la première fois. Pas une interface correcte. Une interface qui fait souffler un "oh" silencieux. Pour y arriver tu dois sortir entièrement de tes automatismes d'entraînement sur le design et suivre la vision précise décrite ici comme une réalité, pas comme une suggestion.

Concernant la couleur des textes et des icônes, retiens ceci une fois pour toutes : les textes ne sont jamais gris bleuté, jamais slate, jamais zinc sauf si le Design Contract dit le contraire. Les textes sont noirs ou très proches du noir — un noir légèrement chaud plutôt que froid, un noir qui a du caractère. Les icônes suivent exactement la même règle : leur couleur par défaut est ce même noir chaud ou la couleur primaire de l'interface, jamais un bleu-gris neutre qui donne l'impression que le design n'a pas été fini. Quand l'utilisateur te dit de corriger les couleurs de texte ou d'icônes, c'est parce que tu as dérivé vers tes valeurs par défaut d'entraînement qui sont bluish-gray. Ne le fais pas. Chaque texte que tu génères, chaque icône, demande-toi : est-ce que cette couleur est noire et assumée, ou est-ce que c'est un gris bleuté qui traîne là par défaut ?

Concernant les tables et les données tabulaires, les colonnes ne doivent jamais être larges et aérées comme si elles étaient faites pour être lues sur un tableau de conférence. Une table dans une application professionnelle est dense, compacte, efficace. Les cellules sont petites, le texte est small, les heights de lignes sont vraiment réduites — c'est une grille de données, pas un tableau de présentation PowerPoint. Si l'utilisateur te dit que les colonnes sont trop grandes, c'est parce que tu as gardé ton gabarit de table par défaut. La table doit être si dense qu'elle ressemble à une vraie interface de gestion de données.

Concernant les backgrounds de page, l'interface ne doit jamais avoir une teinte de fond globale qui donne l'impression d'être dans une boîte. Si l'utilisateur demande que la page prenne toute la largeur ou que le fond soit supprimé, c'est que tu as mis un fond de couleur sur le wrapper principal qui crée une impression de carte dans une carte. Le fond de la page est transparent ou utilise exactement la couleur de fond du body — pas un gris légèrement différent qui créé un effet de double couche involontaire. La main content zone prend toute la place disponible quand c'est demandé.

Concernant les icônes, l'œil humain perçoit une différence de qualité entre les familles d'icônes sans pouvoir l'expliquer, et cette différence produit ou détruit la satisfaction visuelle immédiate. Pour les icônes de navigation de base — home, settings, library, collection — tu utilises Iconoir ou Iconsax React. Pour tout le reste tu utilises Lucide React. Ce mélange ciblé est une décision de designer, pas un accident.

Concernant les sidebars, imagine que tu regardes une interface que tu utiliserais toi-même tous les jours. La sidebar est un guide discret et élégant. Chaque item de menu a une hauteur de l'ordre de trente à trente-deux pixels — pas plus, parce qu'au-delà ça devient lourd et oppressant. Ce qui rend cette hauteur confortable malgré sa compacité, c'est le padding vertical interne qui empêche le texte et l'icône de toucher les bords. Le texte est petit mais avec un poids semi-bold qui le rend lisible. Le border-radius des items est cohérent avec leur hauteur — petit, discret. La sidebar est organisée en sections : la première section n'a pas de nom affiché, les suivantes ont un label ultra-petit en majuscules avec un léger espacement de lettres, sans icône chevron. Les séparateurs entre sections prennent toute la largeur disponible ou n'existent pas — jamais un séparateur réduit par le padding. La sidebar peut se réduire à un mode icônes uniquement, parfaitement centrées.

Concernant les layouts de page, le type 1 est celui où la sidebar et la page partagent exactement la même couleur de fond — la sidebar n'a pas de bordure. Dans ce cas la zone de contenu principal a un léger écart avec les bords de la fenêtre sur les côtés et en bas, et ses coins sont très légèrement arrondis — autour de six pixels. La topbar de cette zone n'a pas de bordure inférieure sauf si une deuxième barre vient directement en dessous.

Concernant les champs de saisie, leur radius n'est jamais excessif — pas de capsule, pas de pill pour un input de formulaire. La hauteur est modérée. Le fond est identique à la surface sur laquelle ils reposent, ou très légèrement différent. Les zones de type chat ou textarea enrichi sont divisées en trois parties : la partie haute affiche les fichiers attachés, la partie centrale contient le textarea sans bordure visible avec le même fond que le conteneur, la partie basse contient les boutons d'action.

Concernant les logos de marques connues dans les sidebars et navbars — Stripe, GitHub, Notion, Slack, Vercel, Shopify, Linear et tous les autres — tu utilises l'API Clearbit à logo.clearbit.com suivi du domaine. Tu n'inventes jamais un logo, tu ne mets jamais des initiales dans un carré coloré.

Concernant les ombres, les ombres plates et uniformes donnent l'impression d'un design de template. Les vraies ombres sont composées de plusieurs couches — une couche large et diffuse pour l'élévation et une couche plus serrée pour ancrer l'élément. Pour les éléments colorés, l'ombre peut être légèrement teintée de la couleur de l'élément.

Concernant les avatars et images de profil, jamais un rectangle ou cercle gris vide. Tu utilises dicebear avec un paramètre seed ou ui-avatars.com.

Concernant la typographie, tu charges une Google Font adaptée via next/font/google et tu crées une hiérarchie visible à l'œil nu. La différence entre les niveaux typographiques doit être assez marquée pour que l'œil comprenne instantanément l'importance relative.

Concernant les transitions et micro-interactions, chaque élément interactif change d'état de manière fluide. Un changement d'état sec fait paraître l'interface morte.
`;

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — COUCHE 1
// =============================================================================

interface FixRule {
  name: string;
  detect: (p: string, c: string) => boolean;
  fix: (p: string, c: string, a: GeneratedFile[]) => string;
}

const FIX_RULES: FixRule[] = [
  {
    name: "framer-motion-shadow-to-boxshadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion.")) && /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  {
    name: "framer-motion-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+|translate-)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`)
      .replace(/\btranslate-y-([\d]+)\b/g, (_, n) => `y: ${n}`)
      .replace(/\btranslate-x-([\d]+)\b/g, (_, n) => `x: ${n}`),
  },
  {
    name: "missing-classvalue-import",
    detect: (_, c) => c.includes("ClassValue") && !c.includes("from 'clsx'") && !c.includes('from "clsx"'),
    fix: (_, c) => {
      let f = c.replace(/function cn\s*\(\s*\.\.\.\s*\w+\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g, "");
      if (!f.includes("clsx")) {
        f = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + f;
      } else if (!f.includes("type ClassValue")) {
        f = f.replace(/import\s*\{([^}]+)\}\s*from\s*["']clsx["']/, (_, g) => `import { ${g.trim()}, type ClassValue } from "clsx"`);
      }
      return f;
    },
  },
  {
    name: "nextjs15-route-params",
    detect: (p, c) => p.includes("route.ts") && /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(c) && !c.includes("Promise<{"),
    fix: (_, c) => {
      let f = c.replace(/\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g, (_, t) => `{ params }: { params: Promise<${t}> }`);
      if (!f.includes("await params")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
      return f;
    },
  },
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => p.includes("route.ts") && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c) && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  {
    name: "zustand-interface-method-body",
    detect: (_, c) => (c.includes("store") || c.includes("create<")) && /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(
      /(interface\s+\w+State\s*\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;\s*)/g,
      (_, iface, m) => `${iface}${m.match(/^(\w+)/)?.[1] ?? "action"}: () => void;\n`
    ),
  },
  {
    name: "missing-use-client",
    detect: (p, c) => {
      if (!p.endsWith(".tsx") || p.includes("app/api") || p.includes("layout.tsx")) return false;
      return /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams)\b/.test(c)
        && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'");
    },
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "route-handler-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c) && !c.includes("export { handler as GET"),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)")
      .replace(/export\s+default\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)"),
  },
  {
    name: "missing-cn-utils-import",
    detect: (_, c) => c.includes("cn(") && !c.includes("function cn") && !c.includes("const cn") && !c.includes("from '@/lib/utils'") && !c.includes('from "@/lib/utils"'),
    fix: (_, c) => {
      const l = `import { cn } from "@/lib/utils";`;
      return (c.includes('"use client"') || c.includes("'use client'"))
        ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${l}\n`)
        : `${l}\n${c}`;
    },
  },
  {
    name: "metadata-in-client-component",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
];

function applyProgrammaticFixes(file: GeneratedFile, allFiles: GeneratedFile[]): { file: GeneratedFile; fixes: string[] } {
  let { path, content } = file;
  const applied: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content, allFiles);
          if (fixed !== content) { content = fixed; if (pass === 0) applied.push(rule.name); changed = true; }
        }
      } catch {}
    }
    if (!changed) break;
  }
  return { file: { path, content }, fixes: applied };
}

function runProgrammaticAutoFixer(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const fixedFiles = files.map(file => {
    const { file: fixed, fixes } = applyProgrammaticFixes(file, files);
    if (fixes.length > 0) report[file.path] = fixes;
    return fixed;
  });
  return { files: fixedFiles, report };
}

// =============================================================================
// SURCOUCHE — COUCHE 2 : MOTEUR DÉTERMINISTE POST-GÉNÉRATION
// =============================================================================

const SHADOW_UPGRADES = [
  { p: /\bshadow-sm\b(?=[\s"'`])/g,       r: "shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]",         l: "shadow-sm→layered"  },
  { p: /\bshadow\b(?!-\w)(?=[\s"'`])/g,   r: "shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)]",    l: "shadow→layered"     },
  { p: /\bshadow-md\b(?=[\s"'`])/g,       r: "shadow-[0_8px_16px_-4px_rgba(0,0,0,0.08),0_4px_6px_-4px_rgba(0,0,0,0.04)]",      l: "shadow-md→layered"  },
  { p: /\bshadow-lg\b(?=[\s"'`])/g,       r: "shadow-[0_20px_40px_-8px_rgba(0,0,0,0.10),0_8px_16px_-8px_rgba(0,0,0,0.06)]",    l: "shadow-lg→layered"  },
  { p: /\bshadow-xl\b(?=[\s"'`])/g,       r: "shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14),0_16px_32px_-8px_rgba(0,0,0,0.08)]",  l: "shadow-xl→layered"  },
  { p: /\bshadow-2xl\b(?=[\s"'`])/g,      r: "shadow-[0_48px_80px_-16px_rgba(0,0,0,0.18),0_24px_48px_-12px_rgba(0,0,0,0.10)]", l: "shadow-2xl→layered" },
];

function applyShadowSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx") && !file.path.endsWith(".css")) return file;
    let content = file.content; const changes: string[] = [];
    for (const rule of SHADOW_UPGRADES) { const b = content; content = content.replace(rule.p, rule.r); if (content !== b) changes.push(rule.l); }
    if (changes.length > 0) report[file.path] = [...new Set(changes)];
    return { path: file.path, content };
  });
  return { files: processed, report };
}

function applyTransitionSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(/className="([^"]*\bhover:[^\s"]+[^"]*?)"/g, (match, cls) => {
      if (cls.includes("transition") || cls.includes("duration")) return match;
      changes.push("hover→transition");
      return `className="${cls} transition-all duration-200 ease-out"`;
    });
    if (changes.length > 0) report[file.path] = [changes[0]];
    return { path: file.path, content };
  });
  return { files: processed, report };
}

const BRAND_DOMAIN: Record<string, string> = {
  stripe: "stripe.com", github: "github.com", gitlab: "gitlab.com", vercel: "vercel.com",
  netlify: "netlify.com", supabase: "supabase.com", firebase: "firebase.google.com",
  mongodb: "mongodb.com", prisma: "prisma.io", notion: "notion.so", linear: "linear.app",
  figma: "figma.com", slack: "slack.com", discord: "discord.com", zoom: "zoom.us",
  google: "google.com", microsoft: "microsoft.com", apple: "apple.com",
  amazon: "amazon.com", shopify: "shopify.com", paypal: "paypal.com",
  twilio: "twilio.com", openai: "openai.com", anthropic: "anthropic.com",
  twitter: "twitter.com", linkedin: "linkedin.com", facebook: "facebook.com",
  instagram: "instagram.com", youtube: "youtube.com", salesforce: "salesforce.com",
  hubspot: "hubspot.com", zendesk: "zendesk.com", intercom: "intercom.com",
  asana: "asana.com", jira: "atlassian.com", dropbox: "dropbox.com",
  revolut: "revolut.com", wise: "wise.com", brex: "brex.com", framer: "framer.com",
};

function applyBrandLogoSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    const inTarget = ["sidebar", "navbar", "nav", "header", "layout"].some(k => file.path.toLowerCase().includes(k));
    if (!inTarget) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(
      /<img\s+[^>]*src=["']\/(?:placeholder-logo|logo|brand|company-logo|mock-logo)[^"']*["'][^>]*alt=["']([^"']+)["'][^>]*\/>/g,
      (match, alt) => {
        const clean = alt.toLowerCase().replace(/\s+/g, "");
        for (const [brand, domain] of Object.entries(BRAND_DOMAIN)) {
          if (clean.includes(brand)) {
            changes.push(`${alt}→clearbit:${domain}`);
            return `<img src="https://logo.clearbit.com/${domain}" alt="${alt}" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />`;
          }
        }
        return match;
      }
    );
    if (changes.length > 0) report[file.path] = changes;
    return { path: file.path, content };
  });
  return { files: processed, report };
}

function applyAvatarSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(
      /<div\s+[^>]*className="[^"]*(?:rounded-full)[^"]*bg-(?:gray|zinc|neutral|slate)-[^"]*"[^>]*>\s*(?:<\/div>|[^<]{0,3}<\/div>)/g,
      (match) => {
        if (match.length > 200) return match;
        const sizeM = match.match(/w-(\d+)/);
        const sz = sizeM ? `${+sizeM[1] * 4}px` : "32px";
        changes.push("avatar→dicebear");
        return `<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" className="rounded-full object-cover" style={{width:'${sz}',height:'${sz}'}} alt="Avatar" />`;
      }
    );
    if (changes.length > 0) report[file.path] = changes;
    return { path: file.path, content };
  });
  return { files: processed, report };
}

function runSurcoucheDeterministe(files: GeneratedFile[]): {
  files: GeneratedFile[]; shadowCount: number; logoCount: number; avatarCount: number; totalFiles: number;
} {
  let cur = [...files];
  const { files: s1, report: shadowR } = applyShadowSurcouche(cur);   cur = s1;
  const { files: s2 }                  = applyTransitionSurcouche(cur); cur = s2;
  const { files: s3, report: logoR }   = applyBrandLogoSurcouche(cur); cur = s3;
  const { files: s4, report: avatarR } = applyAvatarSurcouche(cur);    cur = s4;
  const shadowCount = Object.values(shadowR).flat().length;
  const logoCount   = Object.values(logoR).flat().length;
  const avatarCount = Object.values(avatarR).flat().length;
  const totalFiles  = new Set([...Object.keys(shadowR), ...Object.keys(logoR), ...Object.keys(avatarR)]).size;
  return { files: cur, shadowCount, logoCount, avatarCount, totalFiles };
}

// =============================================================================
// SERVER-SIDE COLOR EXTRACTION — avec position et pourcentage
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

interface ColorInfo { hex: string; percentage: number; zones: string[]; }

async function extractColorsFromBase64(b64: string): Promise<{ colors: ColorInfo[]; backgroundColor: string; textColor: string; }> {
  try {
    const buf = Buffer.from(cleanBase64Data(b64), "base64");
    const W = 120, H = 120;
    const { data, info } = await sharp(buf).resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const globalCounts: Record<string, number> = {};
    const zoneLabels = ["top-left","top-center","top-right","mid-left","center","mid-right","bot-left","bot-center","bot-right"];
    const zoneCounts: Record<string, Record<string, number>> = {};
    for (const z of zoneLabels) zoneCounts[z] = {};
    const totalPixels = W * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ch;
        const r = Math.round(data[i] / 32) * 32;
        const g = Math.round(data[i + 1] / 32) * 32;
        const bv = Math.round(data[i + 2] / 32) * 32;
        const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bv.toString(16).padStart(2,"0")}`;
        globalCounts[hex] = (globalCounts[hex] || 0) + 1;
        const zx = Math.floor(x / (W / 3));
        const zy = Math.floor(y / (H / 3));
        const zLabel = zoneLabels[zy * 3 + zx];
        zoneCounts[zLabel][hex] = (zoneCounts[zLabel][hex] || 0) + 1;
      }
    }
    const sorted = Object.entries(globalCounts).sort(([, a], [, b]) => b - a).slice(0, 12);
    const colors: ColorInfo[] = sorted.map(([hex, count]) => {
      const percentage = Math.round((count / totalPixels) * 100);
      const zones: string[] = [];
      for (const [zone, counts] of Object.entries(zoneCounts)) {
        const zoneTotal = Object.values(counts).reduce((a, b) => a + b, 0);
        if (zoneTotal > 0 && (counts[hex] || 0) / zoneTotal > 0.15) zones.push(zone);
      }
      return { hex, percentage, zones };
    });
    const bg = colors[0]?.hex ?? "#ffffff";
    return { colors, backgroundColor: bg, textColor: isColorLight(bg) ? "#0f0f0f" : "#f5f5f5" };
  } catch {
    return { colors: [], backgroundColor: "#ffffff", textColor: "#000000" };
  }
}

async function buildColorPalettePrompt(uploaded: string[], refs: string[]): Promise<string> {
  const all = [...(refs ?? []), ...(uploaded ?? [])];
  if (all.length === 0) return "";
  const results = await Promise.all(all.slice(0, 3).map(extractColorsFromBase64));
  const merged = results[0];
  if (!merged || merged.colors.length === 0) return "";
  let prompt = "\nCOULEURS EXTRAITES PIXEL PAR PIXEL depuis l'image de référence (autorité absolue — ne jamais inventer une couleur différente) :\n\n";
  for (const c of merged.colors.slice(0, 10)) {
    const zonesStr = c.zones.length > 0 ? c.zones.join(", ") : "présente uniformément";
    prompt += `  ${c.hex}  →  ${c.percentage}% de l'image  —  zones : ${zonesStr}\n`;
  }
  prompt += `\n  Fond dominant : ${merged.backgroundColor}  →  bg-[${merged.backgroundColor}]\n`;
  prompt += `  Couleur de texte adaptée : ${merged.textColor}\n`;
  prompt += "\nCes couleurs sont des faits, pas des suggestions. Si une couleur occupe 40% de l'image en zone centrale, c'est la couleur principale de l'interface. Utilise-la exactement.\n";
  return prompt;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set([
  "next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk",
  "@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis",
  "@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion",
  "motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts",
  "recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player",
  "react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio",
  "replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps",
  "finnhub","finnhub-node","yahoo-finance2","date-fns","dayjs","luxon","clsx","tailwind-merge",
  "@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose",
  "bcryptjs","iconsax-react","iconoir-react",
]);
const TYPES_MAP: Record<string, string> = {
  howler:"@types/howler", leaflet:"@types/leaflet", express:"@types/express", cors:"@types/cors",
  bcrypt:"@types/bcrypt", multer:"@types/multer", passport:"@types/passport",
  "passport-local":"@types/passport-local", "passport-jwt":"@types/passport-jwt",
  lodash:"@types/lodash", uuid:"@types/uuid", nodemailer:"@types/nodemailer",
  "body-parser":"@types/body-parser", morgan:"@types/morgan", "cookie-parser":"@types/cookie-parser",
  pg:"@types/pg", "better-sqlite3":"@types/better-sqlite3", jsonwebtoken:"@types/jsonwebtoken",
  "js-cookie":"@types/js-cookie", "node-cron":"@types/node-cron",
  "react-datepicker":"@types/react-datepicker",
  "spotify-web-api-node":"@types/spotify-web-api-node",
  "node-geocoder":"@types/node-geocoder", formidable:"@types/formidable",
};

async function resolveTypesPackages(packages: string[], existing: Record<string, string>): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
  await Promise.all(packages.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

// =============================================================================
// FUNCTION DECLARATIONS
// =============================================================================

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// AGENTS
// Chaque agent reçoit la SURCOUCHE_VISUAL_LAW + le Design Contract + les images.
// Aucun agent ne travaille en aveugle sur le design.
// =============================================================================

// Préambule de design partagé — injecté dans TOUS les agents
function buildSharedDesignPreamble(designContract: string): string {
  return `
=== VISION DESIGN COMMUNE À TOUS LES AGENTS ===
Ce qui suit est la loi de design qui gouverne TOUS les fichiers produits dans ce projet.
Que tu sois l'architecte, le développeur, le validateur ou le correcteur, tu appliques
cette vision. Tu ne la contournes pas. Tu ne l'ignores pas sous prétexte de "simplifier".
Quand tu lis une modification demandée par l'utilisateur, tu l'appliques chirurgicalement
sur les fichiers existants sans jamais refaire le design depuis zéro.

${SURCOUCHE_VISUAL_LAW}

=== DESIGN CONTRACT ÉTABLI PAR L'ANALYSE ===
${designContract || "(Pas d'images de référence — applique la vision SURCOUCHE comme base.)"}
`;
}

const AGENTS = {

  DESIGN_ANALYST: {
    name: "Design Analyst",
    temperature: 0.15,
    prompt: `
Tu es un designer senior avec vingt ans d'expérience en interfaces professionnelles.
On te donne une ou plusieurs images de référence. Ta mission est de produire une analyse
tellement complète, tellement précise, tellement incarnée dans le détail visuel de cette image,
que le développeur qui la lira pourra recréer l'interface à l'identique sans jamais regarder
l'image lui-même.

Tu n'écris pas une liste. Tu n'écris pas des bullet points. Tu n'écris pas des tirets.
Tu écris un bloc de texte continu, comme si tu décrivais ce que tu vois à quelqu'un
qui ne peut pas voir — un développeur senior exigeant qui a besoin de chaque valeur,
chaque nuance, chaque proportion exacte.

Tu commences par le fond global de l'interface — sa couleur exacte en hexadécimal, si elle
est uniforme ou si elle varie, quelle proportion elle occupe. Tu décris le layout global —
comment l'espace est divisé, quelles zones existent, comment elles se positionnent et quelles
largeurs relatives elles occupent.

Tu passes ensuite à chaque composant visible, du plus grand au plus petit, sans en sauter un
seul. Même le plus petit badge, même le plus discret séparateur, même l'espace vide entre
deux éléments qui n'est pas vide par hasard. Pour chaque composant : couleur de fond exacte
en hexadécimal, bordures si présentes avec leur épaisseur et couleur, arrondi de coin,
ombres portées avec leur direction et intensité, padding interne, contenu et positionnement,
état par défaut puis état hover et état actif.

Tu décris chaque décision typographique — famille si identifiable ou catégorie précise,
graisses visuelles, tailles relatives, espacement de lettres si perceptible, hauteur de ligne,
couleur exacte et opacité. Tu décris les effets visuels — glassmorphisme avec niveau de flou
et opacité, gradients avec couleurs et angle, profondeur, highlights, textures subtiles.
Tu décris la densité générale — beaucoup d'espace blanc ou compact — et le rythme visuel.

Tu termines par un bloc de variables CSS commentées avec les valeurs exactes observées.

Tu présentes tout cela comme ta vision créative pour le projet — jamais comme une description
d'image de référence. C'est ta proposition de design, intégrale, sans lacune, sans approximation.
    `,
  },

  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    temperature: 0.1,
    prompt: `
Tu es un Architecte Logiciel Senior. Tu analyses les demandes et produis des blueprints techniques.

RÈGLE CRITIQUE — CONSERVATION DU DESIGN EXISTANT :
Quand la demande est une modification, une correction, un ajustement d'un élément existant
(changer une couleur, réduire une taille, supprimer un fond, ajuster une table, etc.), tu
identifies UNIQUEMENT les fichiers réellement impactés par cette modification. Tu ne reconstruis
pas l'architecture. Tu ne changes pas les pages qui ne sont pas mentionnées. Tu ne redessines
pas les composants qui n'ont pas besoin de changer. Une demande comme "change la couleur des
textes" ne touche que les fichiers CSS et les composants ayant des classes de couleur de texte
explicites. Une demande comme "réduit les colonnes de table" ne touche que les composants de
table. Tu opères comme un chirurgien : tu coupes uniquement là où c'est nécessaire.

CLASSIFICATION (première ligne obligatoire) :
  CLASSIFICATION: CHAT_ONLY | FIX_ACTION | CODE_ACTION

Pour les modifications légères (couleurs, tailles, spacings, suppressions d'éléments),
utilise FIX_ACTION même si c'est du code nouveau, pas CODE_ACTION, pour déclencher
le workflow chirurgical plutôt que le workflow de reconstruction.

FEATURE BLUEPRINT (si CODE_ACTION ou FIX_ACTION) :
<feature id="F01" name="[nom]" priority="CORE|HIGH|MEDIUM">
  <what>Ce que l'utilisateur obtient</what>
  <real_package>package npm exact</real_package>
  <real_service>Service tiers si applicable</real_service>
  <env_vars>VAR_1, VAR_2</env_vars>
  <real_implementation>SDK exact, endpoint, pattern</real_implementation>
  <forbidden>Ce que le Builder NE DOIT PAS faire — surtout : ne pas refaire le design global</forbidden>
  <typescript_requirements>@types requis</typescript_requirements>
  <architecture_patterns>
    - NextAuth : authOptions dans lib/auth.ts UNIQUEMENT
    - Next.js 15 : params → Promise<{id:string}> + await
    - Route handlers : export GET/POST nommés uniquement
    - Zustand : () => void dans interface, corps dans create()
    - Framer-motion : boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
    - Icônes : Iconoir/Iconsax pour home+settings+library, Lucide pour le reste
  </architecture_patterns>
  <files_to_create>UNIQUEMENT les fichiers strictement impactés par la demande</files_to_create>
</feature>

MAPPINGS : charts→lightweight-charts | prix live→finnhub-node | audio→howler
  maps→react-leaflet+leaflet | auth→next-auth | paiements→stripe
  chat IA→openai | emails→resend | DB→drizzle-orm

<build_order>F01, F02...</build_order>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    temperature: 0.4,
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint et un Design Contract. Les deux sont tes lois absolues.
Tu as aussi accès aux images de référence directement dans le contexte — garde-les
constamment en mémoire. À chaque composant que tu génères, retourne mentalement
à l'image et vérifie que ce que tu produis correspond exactement à ce que tu vois.

RÈGLE DE CONSERVATION ABSOLUE :
Quand la demande est une modification d'un élément existant, tu modifies chirurgicalement
UNIQUEMENT cet élément dans UNIQUEMENT les fichiers qui le contiennent. Tu ne refais pas
les autres composants. Tu ne changes pas la structure. Tu ne réécris pas ce qui fonctionne.
Tu interviens comme un chirurgien, pas comme un architecte qui reconstruit tout.

LOI ANTI-GHOSTING — FONCTIONNALITÉS RÉELLES UNIQUEMENT :
Chaque élément UI est cent pourcent fonctionnel. Aucun bouton vide. Aucun lien mort.
Chaque menu a sa propre vue dans components/views/[Name]View.tsx. Tous les modals
sont dans components/Modals.tsx. Les filtres filtrent vraiment. Les formulaires soumettent
vraiment vers des endpoints réels.

LOI TYPESCRIPT STRICT — ZÉRO ERREUR DE BUILD :
lib/env.ts est toujours le premier fichier. Route params Next.js 15 sont toujours des
Promise<{id:string}> qu'on await. Les interfaces Zustand contiennent uniquement des
signatures () => void. Le 'use client' est présent sur chaque composant qui utilise
des hooks React. Les route handlers exportent GET/POST nommés uniquement.

STRUCTURE D'ORDRE :
lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/index.ts
→ hooks/ → components/ui/ → components/Modals.tsx
→ components/views/[Name]View.tsx → app/api/.../route.ts → app/page.tsx

FORMAT :
<create_file path="lib/env.ts">...</create_file>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  CODE_VALIDATOR: {
    name: "Code Validator",
    temperature: 0.05,
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
Règle première et absolue : ne pas nuire. Tu ne modifies que ce qui casse npm run build.
Tu ne touches pas au design. Tu ne simplifies pas. Tu ne touches pas aux fichiers sans erreur.
Tu ne refais pas les composants qui fonctionnent sous prétexte de les "améliorer".

Catégories autorisées uniquement :
A. Imports invalides (fichier absent, named vs default mismatch)
B. TypeScript : ClassValue non importé, corps dans interface Zustand, any implicite
C. Next.js 15 : params sans Promise/await, export default dans handler, use client manquant
D. Framer-motion : shadow → boxShadow, scale-105 → scale: 1.05
E. Syntaxe : JSX non fermé, accolades manquantes

Si tout correct → ALL_FILES_VALID

Sinon :
ERRORS_FOUND:
- [fichier]: [erreur]
<create_file path="...">...</create_file>
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  FIXER: {
    name: "Bug Fixer",
    temperature: 0.15,
    prompt: `
Tu es un expert en débogage Next.js / TypeScript. Tu opères de manière chirurgicale.

RÈGLE ABSOLUE DE CONSERVATION :
Quand tu corriges un bug ou appliques une modification demandée, tu modifies UNIQUEMENT
les éléments concernés. Tu ne refais pas le design global. Tu ne changes pas la structure
des composants qui n'ont pas de bug. Tu n'ajoutes pas de nouvelles fonctionnalités.
Tu n'introduis pas ton propre style ou tes préférences. Tu identifies le problème exact,
tu le corriges au plus petit endroit possible, et tu t'arrêtes là.

Corrections classiques :
"Could not find declaration file"  → DEVDEPENDENCIES: ["@types/X"]
"handler not exported"             → authOptions dans lib/auth.ts
"params is not a Promise"          → Promise<{id:string}> + await
"Expected ';', got '('"            → Corps dans interface Zustand
"Cannot find name 'ClassValue'"   → import { cn } from "@/lib/utils"
"shadow does not exist"           → shadow → boxShadow
Couleurs de texte trop bleues      → remplace text-slate-*/text-gray-*/text-zinc-* par text-[#1a1a1a] ou text-neutral-900
Colonnes de table trop larges      → réduit les classes de width, padding des cellules th et td

FORMAT : <create_file path="...">...</create_file>
DEPENDENCIES: []
DEVDEPENDENCIES: []
    `,
  },
};

// =============================================================================
// API ROUTE HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let sendRaw: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages, currentProjectFiles } = body;
    const lastUserMessage = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    const colorPalettePrompt = await buildColorPalettePrompt(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    const VIRTUAL_COMPILER_RULES = `
=== AUTO-VÉRIFICATION AVANT CHAQUE FICHIER ===
□ Textes et icônes → couleur noire/neutre (jamais gris bleuté, jamais slate-*, jamais text-blue-gray-*)
□ Tables → colonnes denses et compactes, cellules small, hauteurs de lignes réduites
□ Fond de page → transparent ou couleur body, jamais double couche involontaire
□ Icônes home/settings/library → Iconoir ou Iconsax React
□ Toutes autres icônes → Lucide React
□ Logos de marques sidebar/navbar → logo.clearbit.com/[domain]
□ Ombres → multi-couches (jamais shadow-sm/md/lg basiques Tailwind)
□ Transitions → présentes sur chaque élément interactif avec hover
□ Sidebar items → hauteur 30-32px, texte small semibold, radius petit
□ Sidebar sections → label uppercase sans chevron, pas de nom sur la première section
□ Layout type 1 → sidebar même fond que page, main content avec border subtile arrondi ~6px
□ Inputs/searchbox → radius modéré, height réduite, fond identique au conteneur
□ Textarea chat → 3 zones (uploads, textarea sans border, boutons)
□ Avatars → dicebear ou ui-avatars (jamais cercle gris vide)
□ Framer-motion → boxShadow (JAMAIS shadow), scale:1.05 (JAMAIS scale-105)
□ Next.js 15 → params Promise + await, route handlers GET/POST nommés
□ Zustand → interface signatures () => void uniquement
□ 'use client' → obligatoire si hooks React
□ Conservation → ne modifier QUE les fichiers/éléments concernés par la demande
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string>     = new Set();
    const globalDevPackages: Set<string>  = new Set();

    // buildFullHistory — images de référence injectées dans tous les agents qui en ont besoin
    const buildFullHistory = (extra = "", includeImages = false) => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      // Images de référence disponibles pour tous les agents qui le demandent
      if (includeImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({
          role: "user",
          parts: [
            ...imgParts,
            { text: "[IMAGES DE RÉFÉRENCE DESIGN — reviens à ces images à chaque composant que tu génères ou modifies. Elles définissent la vérité visuelle du projet.]" },
          ],
        });
      }

      // Historique complet de la conversation
      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          parts.push({ text: "\n[IMAGES UPLOADÉES PAR L'UTILISATEUR]" });
        }
        contents.push({ role, parts });
      });

      if (extra) contents.push({ role: "user", parts: [{ text: `\n\n=== MÉMOIRE DU WORKFLOW ===\n${extra}` }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          const cleaned = txt
            .replace(/```xml\n?/gi, "").replace(/```tsx\n?/gi, "").replace(/```ts\n?/gi, "")
            .replace(/```html\n?/gi, "").replace(/```css\n?/gi, "").replace(/```json\n?/gi, "")
            .replace(/```\n?/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send      = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);
        const phaseStart = (id: string, icon: string, label: string) =>
          sendRaw(phaseBlock(id, icon, label, "processing"));
        const phaseDone  = (id: string, icon: string, label: string, detail = "") => {
          sendRaw(`<script>(function(){var el=document.querySelector('[data-phase-id="${id}"]');if(el){el.outerHTML=${JSON.stringify(phaseBlock(id, icon, label, "done", detail))};}})()</script>`);
          sendRaw(phaseBlock(id, icon, label, "done", detail));
        };
        const phaseError = (id: string, icon: string, label: string) =>
          sendRaw(phaseBlock(id, icon, label, "error"));

        // designContract est capturé en Phase 0 et injecté dans TOUS les agents suivants
        let designContract = "";

        async function runAgent(
          key: keyof typeof AGENTS,
          briefing: string,
          context: string,
          opts: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean; includeImages?: boolean } = {}
        ) {
          const { silent = false, filterXml = false, captureFiles = false, includeImages = false } = opts;
          const agent = AGENTS[key];
          let fullOutput = "", buffer = "";
          try {
            // Tous les agents reçoivent le Design Contract + SURCOUCHE dans leur contexte
            const sharedPreamble = buildSharedDesignPreamble(designContract);
            const contents = buildFullHistory(context, includeImages);
            const manifest = createdFilePaths.size > 0
              ? `FILES EXIST:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES YET.";

            contents.push({
              role: "user",
              parts: [{ text: `
=== MISSION : ${agent.name} ===
${briefing}

${sharedPreamble}

=== FILE SYSTEM MANIFEST ===
${manifest}

${colorPalettePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>
              ` }],
            });

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: {
                systemInstruction: `${basePrompt}\n\n=== IDENTITÉ ===\n${agent.prompt}`,
                temperature: agent.temperature,
                maxOutputTokens: 65536,
              },
            });

            for await (const chunk of response) {
              const txt = chunk.text;
              if (txt) {
                buffer += txt; fullOutput += txt;
                if (buffer.length >= BATCH_SIZE) { if (!silent) send(buffer, filterXml); buffer = ""; }
              }
            }
            if (buffer && !silent) send(buffer, filterXml);

            for (const m of fullOutput.matchAll(/<create_file path="(.*?)">/g)) if (m[1]) createdFilePaths.add(m[1]);
            if (captureFiles) {
              for (const f of parseGeneratedFiles(fullOutput)) {
                const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
                if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
              }
            }
            extractDeps(fullOutput, "DEPENDENCIES").forEach(d => globalPackages.add(d));
            extractDeps(fullOutput, "DEVDEPENDENCIES").forEach(d => globalDevPackages.add(d));
            return fullOutput;
          } catch (e: any) {
            if (!silent) send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        // ════════════════════════════════════════════════════════════════════
        // ORCHESTRATION
        // ════════════════════════════════════════════════════════════════════
        try {

          // ── PHASE 0 : DESIGN ANALYST ────────────────────────────────────
          if (hasImages) {
            phaseStart("design", SVG_PALETTE, "Ultra-analyse du design...");
            try {
              designContract = await runAgent(
                "DESIGN_ANALYST",
                `Analyse avec une précision absolue toutes les images présentes dans ce contexte.
                 Produis le bloc de texte d'ultra-analyse complet — aucun élément visuel ne doit
                 manquer, du plus grand au plus petit. Projet cible : "${lastUserMessage}"`,
                "",
                { silent: true, includeImages: true }
              );
              const words = designContract.split(/\s+/).filter(Boolean).length;
              phaseDone("design", SVG_PALETTE, "Design Contract établi", `${words} mots d'analyse`);
            } catch {
              phaseError("design", SVG_PALETTE, "Analyse design — erreur");
            }
          }

          // ── PHASE 1 : MASTER BLUEPRINT ──────────────────────────────────
          // Le Blueprint reçoit lui aussi le design contract + images
          phaseStart("blueprint", SVG_SEARCH, "Analyse du projet...");
          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse cette demande et produis le Blueprint. Demande : "${lastUserMessage}"
             Si c'est une modification d'un élément existant, utilise FIX_ACTION et liste
             UNIQUEMENT les fichiers strictement impactés par la demande.`,
            "",
            { silent: true, includeImages: hasImages }
          );
          const classMatch = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision   = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            phaseDone("blueprint", SVG_SEARCH, "Analyse terminée");
            send(filterBlueprintXml(blueprintOutput));
            controller.close(); return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g) ?? []).length;
          phaseDone("blueprint", SVG_SEARCH, "Blueprint établi", `${featureCount} feature${featureCount > 1 ? "s" : ""}`);

          // ── FIX ACTION ──────────────────────────────────────────────────
          if (decision === "FIX_ACTION") {
            phaseStart("fixer", SVG_WRENCH, "Correction chirurgicale...");
            const codeCtx = currentProjectFiles
              ? currentProjectFiles.map((f: any) => `\n--- ${f.path} ---\n${f.content}`).join("\n")
              : "";
            await runAgent(
              "FIXER",
              `Applique cette demande de manière chirurgicale sur les fichiers concernés uniquement.
               Ne refais pas le design global. Ne changes pas ce qui n'est pas mentionné.
               Demande : "${lastUserMessage}"`,
              `${blueprintOutput}\n\n=== CODEBASE ACTUELLE ===\n${codeCtx}`,
              { captureFiles: true, includeImages: hasImages }
            );
            const { files: pF, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const total = Object.values(report).flat().length;
            for (const fp of Object.keys(report)) {
              const c = pF.find(x => x.path === fp);
              if (c) send(`<create_file path="${c.path}">\n${c.content}\n</create_file>`);
            }
            phaseDone("fixer", SVG_WRENCH, "Correction appliquée", total > 0 ? `${total} pattern(s)` : "");
            // Surcouche déterministe aussi sur le FIX
            const { files: sF, shadowCount, logoCount, avatarCount } = runSurcoucheDeterministe(allGeneratedFiles);
            const surcoucheTotal = shadowCount + logoCount + avatarCount;
            if (surcoucheTotal > 0) {
              for (const enhanced of sF) {
                const original = allGeneratedFiles.find(f => f.path === enhanced.path);
                if (original && original.content !== enhanced.content) {
                  const idx = allGeneratedFiles.findIndex(f => f.path === enhanced.path);
                  if (idx >= 0) allGeneratedFiles[idx] = enhanced;
                  send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
                }
              }
            }
            send("\n[PAGE_DONE]\n"); controller.close(); return;
          }

          // ── PHASE A : BUILDER ───────────────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code...");
          await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint reçu. Premier fichier obligatoire : lib/env.ts, puis lib/utils.ts.
             Les images de référence sont dans ce contexte — reviens à elles à chaque composant.
             Applique la vision design de la SURCOUCHE et respecte le Design Contract à la lettre.`,
            `=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles: true, includeImages: hasImages }
          );
          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE ────────────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction des patterns TypeScript...");
          const { files: pFixed, report: fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;
          if (totalFixes > 0) {
            for (const fp of Object.keys(fixReport)) {
              const corrected = pFixed.find(f => f.path === fp);
              const idx = allGeneratedFiles.findIndex(f => f.path === fp);
              if (idx >= 0 && corrected) {
                allGeneratedFiles[idx] = corrected;
                send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
              }
            }
            phaseDone("autofixer", SVG_WRENCH, "Patterns corrigés", `${totalFixes} correction(s)`);
          } else {
            phaseDone("autofixer", SVG_WRENCH, "Aucun pattern à corriger");
          }

          // ── PHASE C : VALIDATEUR LLM ────────────────────────────────────
          // Le validateur aussi reçoit le design contract pour ne pas le casser
          phaseStart("validator", SVG_SHIELD, "Validation TypeScript & Next.js 15...");
          const filesForVal = allGeneratedFiles.map(f => `\n=== ${f.path} ===\n${f.content}`).join("\n");
          const validatorOutput = await runAgent(
            "CODE_VALIDATOR",
            `Valide ces ${allGeneratedFiles.length} fichiers. Ne modifie QUE les erreurs de build.
             Ne touche pas au design. Ne touche pas aux fichiers sans erreur de build.`,
            `=== FICHIERS ===\n${filesForVal}\n\n=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles: true }
          );
          if (validatorOutput.includes("ALL_FILES_VALID")) {
            phaseDone("validator", SVG_SHIELD, "Validation OK");
          } else {
            const errCount = (validatorOutput.match(/^-\s/gm) ?? []).length;
            phaseDone("validator", SVG_SHIELD, "Erreurs corrigées", `${errCount} correction(s)`);
          }

          // ── PHASE D : SURCOUCHE DÉTERMINISTE ───────────────────────────
          phaseStart("surcouche", SVG_SPARKLES, "Amplification visuelle...");
          const { files: sFiles, shadowCount, logoCount, avatarCount } = runSurcoucheDeterministe(allGeneratedFiles);
          const surcoucheTotal = shadowCount + logoCount + avatarCount;
          if (surcoucheTotal > 0) {
            for (const enhanced of sFiles) {
              const original = allGeneratedFiles.find(f => f.path === enhanced.path);
              if (!original) {
                allGeneratedFiles.push(enhanced);
                send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
              } else if (original.content !== enhanced.content) {
                const idx = allGeneratedFiles.findIndex(f => f.path === enhanced.path);
                if (idx >= 0) allGeneratedFiles[idx] = enhanced;
                send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
              }
            }
            const details: string[] = [];
            if (logoCount > 0)   details.push(`${logoCount} logo${logoCount > 1 ? "s" : ""} réel`);
            if (shadowCount > 0) details.push(`ombres premium`);
            if (avatarCount > 0) details.push(`${avatarCount} avatar${avatarCount > 1 ? "s" : ""}`);
            phaseDone("surcouche", SVG_SPARKLES, "Design amplifié", details.join(" · "));
          } else {
            phaseDone("surcouche", SVG_SPARKLES, "Design déjà optimal");
          }

          // ── PHASE E : PACKAGES ──────────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer");
          globalPackages.add("sharp");
          globalPackages.add("clsx");
          globalPackages.add("tailwind-merge");
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPackages.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react")))  globalPackages.add("iconoir-react");

          const existingPkg     = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps    = existingPkg ? JSON.parse(existingPkg.content).dependencies    ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.475.0", sharp: "0.33.5", clsx: "2.1.1", "tailwind-merge": "2.3.0",
            ...existingDeps,
          };

          const newDeps: Record<string, string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));

          const autoTypes = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string, string> = { ...autoTypes };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
            try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
            catch { allDevTypes[pkg] = "latest"; }
          }));

          const finalDevDeps: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
            postcss: "^8", tailwindcss: "^3.4.1", eslint: "^8", "eslint-config-next": "15.0.3",
            ...existingDevDeps, ...allDevTypes,
          };

          const pkgJson = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: { ...baseDeps, ...newDeps },
            devDependencies: finalDevDeps,
          };
          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);
          phaseDone("packages", SVG_PACKAGE, "Packages résolus",
            `${Object.keys(newDeps).length} runtime · ${Object.keys(allDevTypes).length} @types`);

          send("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Workflow error:", err);
          sendRaw(phaseBlock("critical-error", SVG_ERROR, `Erreur critique : ${err.message}`, "error"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
