import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview";

// =============================================================================
// TYPES
// =============================================================================

interface GeneratedFile { path: string; content: string; }

// =============================================================================
// PHASE BLOCKS — texte pur, zéro SVG embarqué
// =============================================================================

function phaseBlock(id: string, label: string, status: "processing" | "done" | "error", detail = ""): string {
  const c    = status === "done" ? "#22c55e" : status === "error" ? "#ef4444" : "#6366f1";
  const icon = status === "done" ? "✓" : status === "error" ? "✗" : "◉";
  const st   = status === "done" ? "Terminé" : status === "error" ? "Erreur" : "En cours...";
  return `\n<div data-phase-id="${id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:6px 0;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-left:3px solid ${c};border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;color:#374151"><span style="color:${c};font-size:15px;flex-shrink:0">${icon}</span><span style="font-weight:600;flex:1">${label}</span><span style="color:${c};font-size:12px;font-weight:500">${st}</span>${detail ? `<span style="color:#9ca3af;font-size:11px;margin-left:6px">${detail}</span>` : ""}</div>\n`;
}

function phaseDoneInline(id: string, label: string, detail = ""): string {
  return phaseBlock(id, label, "done", detail);
}

// =============================================================================
// UTILITAIRES
// =============================================================================

function getMimeType(dataUrl: string) {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return m ? m[1] : "application/octet-stream";
}
function cleanBase64(dataUrl: string) {
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
function stripAgentXml(text: string): string {
  return text
    .replace(/<phase_thinking>[\s\S]*?<\/phase_thinking>/gi, "")
    .replace(/<feature_manifest>[\s\S]*?<\/feature_manifest>/gi, "")
    .replace(/<wire_check>[\s\S]*?<\/wire_check>/gi, "")
    .replace(/DEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .replace(/DEVDEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .replace(/<create_file[\s\S]*?<\/create_file>/gi, "")
    .trim();
}

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — 6 PASSES, 20 RÈGLES
// =============================================================================

interface FixRule {
  name: string;
  detect: (p: string, c: string) => boolean;
  fix: (p: string, c: string) => string;
}

const FIX_RULES: FixRule[] = [
  {
    name: "use-client-hooks",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api") && !p.includes("layout.tsx")
      && /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer)\b/.test(c)
      && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "use-client-router",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /\b(useRouter|usePathname|useSearchParams|useParams)\b/.test(c)
      && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "use-client-window",
    detect: (p, c) => p.endsWith(".tsx") && /\bwindow\.\w+|\bdocument\.\w+/.test(c)
      && !c.includes('"use client"') && !c.includes("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "use-client-zustand-subscribe",
    detect: (p, c) => p.endsWith(".tsx") && c.includes("useStore") && !c.includes('"use client"') && !c.includes("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "framer-shadow-to-boxshadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion."))
      && /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  {
    name: "framer-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`),
  },
  {
    name: "missing-cn-import",
    detect: (_, c) => c.includes("cn(") && !c.includes("function cn") && !c.includes("const cn")
      && !c.includes("from '@/lib/utils'") && !c.includes('from "@/lib/utils"'),
    fix: (_, c) => {
      const line = `import { cn } from "@/lib/utils";`;
      return (c.includes('"use client"') || c.includes("'use client'"))
        ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${line}\n`)
        : `${line}\n${c}`;
    },
  },
  {
    name: "nextjs15-params-promise",
    detect: (p, c) => (p.includes("route.ts") || p.includes("["))
      && /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(c) && !c.includes("Promise<{"),
    fix: (_, c) => {
      let f = c.replace(/\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g,
        (_, t) => `{ params }: { params: Promise<${t}> }`);
      if (!f.includes("await params")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
      return f;
    },
  },
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => (p.includes("route.ts") || p.includes("["))
      && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c) && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  {
    name: "route-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+\w+/g, "export async function POST")
      .replace(/export\s+default\s+function\s+\w+/g, "export async function POST"),
  },
  {
    name: "zustand-interface-body",
    detect: (_, c) => c.includes("create<") && /interface\s+\w+State\s*\{[\s\S]*?:\s*\(\s*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(
      /(\w+)\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;(\s*\/\*[\s\S]*?\*\/)?/g,
      (_, name) => `${name}: () => void;`
    ),
  },
  {
    name: "metadata-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata\s*=[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
  {
    name: "server-only-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("import 'server-only'"),
    fix: (_, c) => c.replace(/import ['"]server-only['"];\n?/g, ""),
  },
  {
    name: "deep-relative-imports",
    detect: (_, c) => /from ['"]\.\.\/\.\.\/\.\.\//.test(c),
    fix: (_, c) => c.replace(/from ['"]\.\.\/\.\.\/\.\.\//g, 'from "@/'),
  },
  {
    name: "missing-key-map",
    detect: (p, c) => p.endsWith(".tsx") && /\.map\(\s*\([^)]+\)\s*=>\s*\(?\s*<[A-Za-z](?![^>]*key=)/.test(c),
    fix: (_, c) => c.replace(
      /\.map\(\s*\((\w+)(?:,\s*(\w+))?\)\s*=>\s*\(?\s*<([A-Za-z]\w*)(?![^>]*key=)/g,
      (m, item, idx, tag) => m.replace(`<${tag}`, `<${tag} key={${idx ? idx : `${item}.id ?? ${item}`}}`)
    ),
  },
  {
    name: "any-in-catch",
    detect: (_, c) => /catch\s*\(\s*\w+\s*\)/.test(c) && !/catch\s*\(\s*\w+\s*:\s*unknown\s*\)/.test(c) && !/catch\s*\(\s*\w+\s*:\s*any\s*\)/.test(c),
    fix: (_, c) => c.replace(/catch\s*\(\s*(\w+)\s*\)/g, "catch ($1: unknown)"),
  },
  {
    name: "unescaped-apostrophe",
    detect: (p, c) => p.endsWith(".tsx") && />([^<]*?[a-zA-Zà-ÿ])'([^<]*?)</.test(c),
    fix: (_, c) => c.replace(/>([^<]*?[a-zA-Zà-ÿ])'([^<]*?)</g, (m, b, a) => `>${b}&apos;${a}<`),
  },
  {
    name: "missing-react-types",
    detect: (p, c) => p.endsWith(".tsx") && c.includes("{children}") && /interface\s+\w+Props/.test(c) && !/children\s*:/.test(c),
    fix: (_, c) => c.replace(/(interface\s+\w+Props\s*\{)/, "$1\n  children?: React.ReactNode;"),
  },
  {
    name: "implicit-event-any",
    detect: (_, c) => /onChange=\{(?:\(e\)|\(event\))\s*=>/.test(c) && !/: React\./.test(c),
    fix: (_, c) => c
      .replace(/onChange=\{\(e\)\s*=>/g, "onChange={(e: React.ChangeEvent<HTMLInputElement>) =>")
      .replace(/onChange=\{\(event\)\s*=>/g, "onChange={(event: React.ChangeEvent<HTMLInputElement>) =>"),
  },
  {
    name: "tailwind-bg-opacity",
    detect: (_, c) => /bg-opacity-\d+/.test(c),
    fix: (_, c) => c.replace(/(\S+)\s+bg-opacity-(\d+)/g, "$1/$2"),
  },
];

function applyProgrammaticFixes(file: GeneratedFile): { file: GeneratedFile; fixes: string[] } {
  let { path, content } = file;
  const applied: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content);
          if (fixed !== content) { content = fixed; if (!applied.includes(rule.name)) applied.push(rule.name); changed = true; }
        }
      } catch {}
    }
    if (!changed) break;
  }
  return { file: { path, content }, fixes: applied };
}

function runFixer(files: GeneratedFile[]): { files: GeneratedFile[]; totalFixes: number } {
  let totalFixes = 0;
  const fixed = files.map(f => {
    const { file, fixes } = applyProgrammaticFixes(f);
    totalFixes += fixes.length;
    return file;
  });
  return { files: fixed, totalFixes };
}

// =============================================================================
// COULEURS (Sharp)
// =============================================================================

async function extractColors(b64: string): Promise<string> {
  try {
    const buf = Buffer.from(cleanBase64(b64), "base64");
    const W = 100, H = 100;
    const { data, info } = await sharp(buf).resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const counts: Record<string, number> = {};
    for (let i = 0; i < data.length; i += ch) {
      const r = Math.round(data[i] / 16) * 16;
      const g = Math.round(data[i+1] / 16) * 16;
      const b = Math.round(data[i+2] / 16) * 16;
      const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
      counts[hex] = (counts[hex] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 8);
    let prompt = "\nPALETTE EXTRAITE (pixels réels) :\n";
    for (const [hex, cnt] of sorted) {
      prompt += `  ${hex}  ${Math.round(cnt / (W*H) * 100)}%\n`;
    }
    return prompt;
  } catch { return ""; }
}

async function buildColorContext(uploaded: string[], refs: string[]): Promise<string> {
  const all = [...(refs ?? []), ...(uploaded ?? [])];
  if (!all.length) return "";
  const results = await Promise.all(all.slice(0, 2).map(extractColors));
  return results.join("\n");
}

// =============================================================================
// @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set([
  "next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk",
  "@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis",
  "@upstash/redis","@vercel/postgres","zod","zustand","swr","@tanstack/react-query",
  "lucide-react","framer-motion","motion","tailwindcss","resend","axios","socket.io",
  "socket.io-client","lightweight-charts","recharts","chart.js","react-chartjs-2","d3",
  "wavesurfer.js","tone","react-player","react-hook-form","@aws-sdk/client-s3",
  "@aws-sdk/lib-storage","pusher","pusher-js","twilio","replicate","langchain",
  "@pinecone-database/pinecone","react-leaflet","finnhub","yahoo-finance2","date-fns",
  "dayjs","luxon","clsx","tailwind-merge","@react-pdf/renderer","pdf-lib","exceljs",
  "jose","bcryptjs","iconsax-react","iconoir-react","@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu","@radix-ui/react-select","@radix-ui/react-slot",
]);
const TYPES_MAP: Record<string,string> = {
  howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",
  cors:"@types/cors",bcrypt:"@types/bcrypt",multer:"@types/multer",
  lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer",
  pg:"@types/pg",jsonwebtoken:"@types/jsonwebtoken","js-cookie":"@types/js-cookie",
  "node-cron":"@types/node-cron","react-datepicker":"@types/react-datepicker",
};

async function resolveTypes(packages: string[], existing: Record<string,string>): Promise<Record<string,string>> {
  const needed: Record<string,string> = {};
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

const readFileDecl: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// DESIGN ANCHOR — injecté à chaque requête pour éviter la régression de design
// =============================================================================

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef) return "";
  return `
╔═══════════════════════════════════════════════════════════╗
║  ANCRE DESIGN PERMANENTE — AUTORITÉ ABSOLUE               ║
║  Ce HTML est la source de vérité visuelle. Zéro déviation ║
╚═══════════════════════════════════════════════════════════╝

LOI 1 — CSS VARIABLES : Extrais TOUTES les variables :root {} du HTML → app/globals.css
LOI 2 — CDN : Tous les <link> du <head> → app/layout.tsx (Tabler Icons, Google Fonts...)
LOI 3 — COULEURS EXACTES : bg-[#1a1a2e] et non bg-gray-900. Jamais d'approximation.
LOI 4 — ICÔNES : <i class="ti ti-[name]"> → <i className="ti ti-[name]" /> via CDN layout
LOI 5 — IMAGES RÉELLES UNIQUEMENT :
  Logos   : https://www.google.com/s2/favicons?domain=[x]&sz=64
  Avatars : https://api.dicebear.com/9.x/lorelei/svg?seed=[NOM]&backgroundColor=b6e3f4,c0aede,d1d4f9
  Contenu : https://picsum.photos/seed/[mot-clé]/[w]/[h]
  JAMAIS  : /placeholder.png, /avatar.jpg, ou chemins locaux

RÉFÉRENCE HTML/CSS :
\`\`\`html
${htmlRef.slice(0, 12000)}
\`\`\`
`;
}

// =============================================================================
// LE MÉGA-AGENT UNIQUE — phases internes forcées, service-first, wire-checked
// =============================================================================

const MEGA_AGENT_PROMPT = `
Tu es un Ingénieur Full Stack Principal — Next.js 15, TypeScript strict, Tailwind CSS.
Tu es aussi un Product Manager Senior et un Architecte Logiciel.

══════════════════════════════════════════════════════════════════════════════
█  PHILOSOPHIE FONDAMENTALE — GRAVER DANS LA PIERRE
══════════════════════════════════════════════════════════════════════════════

L'utilisateur construit son outil de travail quotidien. Pas une maquette.
Pas un MVP. Pas une démo. Un vrai produit qui tourne en production.

Le code que tu produis doit être de la même qualité que ce que Claude Code ou
Cursor génèrent pour des équipes professionnelles. Pas moins.

La différence entre un agent médiocre et toi :
→ L'agent médiocre : fait le UI, simule les fonctionnalités, crée des "views" génériques
→ Toi : penses comme le fondateur du produit, implémentes chaque feature de A à Z,
  connectes chaque bouton à son backend, testes chaque logique dans ta tête avant d'écrire

══════════════════════════════════════════════════════════════════════════════
█  PROTOCOLE EN 5 PHASES INTERNES — AVANT D'ÉCRIRE UNE SEULE LIGNE
══════════════════════════════════════════════════════════════════════════════

Ces phases sont INTERNES. Tu les exécutes mentalement. Tu ne les écris pas dans ta réponse.
Ta réponse contient UNIQUEMENT les fichiers de code.

▸ PHASE 1 — PRODUCT THINKING (30 secondes de réflexion avant tout)
  Question : "Si je payais 50$/mois pour ce logiciel, qu'est-ce que j'attendrais de lui ?"
  Liste mentalement TOUTES les fonctionnalités qu'un utilisateur réel de ce type de produit
  utilise au quotidien. Pense à 3 types d'utilisateurs différents et leurs besoins.
  Pense à Stripe, ElevenLabs, Linear, Shopify — comment ils ont implémenté leurs features.

▸ PHASE 2 — FEATURE INVENTORY (liste exhaustive interne)
  Pour chaque fonctionnalité identifiée, note mentalement :
  - Le service/algorithme qui la fait tourner (services/[domain].ts)
  - Le store Zustand qui gère son état (stores/[name]Store.ts)
  - L'endpoint API si besoin (app/api/[route]/route.ts)
  - Les composants UI qui la déclenchent
  - La chaîne complète : UI → handler → service → résultat → store → re-render

▸ PHASE 3 — ORDRE DE GÉNÉRATION (toujours ce même ordre, sans exception)
  1. lib/env.ts, lib/utils.ts, types/index.ts
  2. services/*.ts  ← TOUJOURS EN PREMIER avant tout UI
  3. stores/*.ts
  4. hooks/*.ts
  5. app/api/**/route.ts
  6. components/ui/*
  7. components/Modals.tsx  ← UN SEUL fichier pour TOUS les modals
  8. components/views/*View.tsx  ← UN fichier distinct par page, layout unique
  9. app/globals.css (CSS variables du design anchor)
  10. app/layout.tsx (CDN links du design anchor)
  11. app/page.tsx

▸ PHASE 4 — WIRE VERIFICATION (avant de terminer)
  Pour chaque composant UI créé, vérifie mentalement :
  □ Chaque bouton appelle-t-il une vraie fonction ?
  □ Chaque input est-il connecté à un état ou un store ?
  □ Chaque modal a-t-il un vrai submit connecté à un service ?
  □ Chaque item de nav affiche-t-il une vraie View distincte ?
  □ Chaque View a-t-elle son propre layout et ses propres données ?
  □ Chaque service est-il importé et appelé depuis un hook ou composant ?

▸ PHASE 5 — SELF-AUDIT (dernière vérification)
  □ "use client" présent dans tout fichier tsx avec hooks ou événements browser ?
  □ Aucun import vers un fichier qui n'existe pas dans ma liste ?
  □ Aucun "TODO", "Coming soon", "Under development", "This module is active" ?
  □ Aucune page qui affiche le même layout qu'une autre avec juste le titre changé ?
  □ Tous les packages utilisés seront dans ma liste DEPENDENCIES ?

══════════════════════════════════════════════════════════════════════════════
█  LES 7 CRIMES ABSOLUS — DÉTECTION = ÉCHEC IMMÉDIAT
══════════════════════════════════════════════════════════════════════════════

CRIME 1 — FONCTIONNALITÉ SANDBOX
  ✗ Math.random() présenté comme une vraie donnée de marché
  ✗ setTimeout(() => {}, 1000) simulant une vraie opération
  ✗ const mockData = [...] jamais remplacé par des vraies données
  ✓ Si tu n'as pas l'API key, tu structures le code pour qu'il fonctionne quand l'utilisateur
    ajoute sa clé dans .env — mais la logique réelle est là, complète

CRIME 2 — GHOST NAVIGATION
  ✗ onClick={() => setView("voices")} sans un vrai composant VoicesView
  ✗ Sidebar avec 8 items → 7 affichent un div vide
  ✓ Chaque item de navigation → son propre fichier components/views/[Name]View.tsx
  ✓ Ce fichier a son propre layout HTML unique, ses propres données, sa propre logique

CRIME 3 — INTERFACE MIRRORING (le plus fréquent, le plus grave)
  ✗ VoicesView et SoundEffectsView partagent le même composant générique
  ✗ "This module is currently active and functional." dans une vue
  ✗ Seul le titre change entre deux pages — même layout, mêmes composants
  ✓ VoicesView : grille de voix avec player audio, filtres, génération TTS
  ✓ SoundEffectsView : bibliothèque de sons, waveform, prévisualisation, téléchargement
  ✓ La différence est immédiatement visible et logiquement correcte

CRIME 4 — HOLLOW INTERACTIVITY
  ✗ Bouton "Like" qui change de couleur mais n't enregistre rien
  ✗ Searchbox qui ne filtre pas les vraies données
  ✗ Select/dropdown qui ne fait rien quand l'option change
  ✓ Chaque interaction produit un effet mesurable dans le store ou l'API

CRIME 5 — ATOMIC NEGLECT
  ✗ Ignorer les petits éléments (slider volume, bouton prev/next, progress bar, checkbox)
  ✗ Topbar avec 6 boutons → 5 n'ont aucun handler
  ✓ Chaque élément interactif visible dans la page a son handler complet

CRIME 6 — DISCONNECTED SERVICES
  ✗ services/voices.ts créé mais jamais importé
  ✗ stores/voiceStore.ts créé mais aucun composant ne le subscribe
  ✗ app/api/tts/route.ts créé mais jamais fetché
  ✓ La chaîne complète est traçable ligne par ligne dans le code

CRIME 7 — DESIGN REGRESSION
  ✗ Sur une correction ou modification, récrire les fichiers en perdant le CSS du design anchor
  ✗ Remplacer bg-[#1a1a2e] par bg-gray-900 parce que "c'est plus simple"
  ✗ Supprimer les CSS variables et les remplacer par des valeurs hardcodées différentes
  ✓ Le design anchor est la loi. Chaque correction PRÉSERVE le design exact.
  ✓ Sur une correction : modifier UNIQUEMENT les fichiers qui ont des erreurs

══════════════════════════════════════════════════════════════════════════════
█  QUALITÉ MINIMUM — PENSER COMME LE FONDATEUR, PAS LE STAGIAIRE
══════════════════════════════════════════════════════════════════════════════

Utilisateur demande "une app ElevenLabs" :
  Stagiaire : Text to Speech page + Library page (mêmes composants, titres différents)
  Fondateur : 
    → /tts : éditeur de texte riche, sélecteur de voix avec preview audio,
      paramètres (stability, similarity, style), génération via ElevenLabs API,
      historique des générations avec player, export MP3/WAV
    → /voices : galerie des voix avec filtres (langue, genre, accent), player de preview,
      clonage de voix (upload audio → API), voix personnalisées, search temps réel
    → /studio : éditeur de projets multi-segments, timeline, mixage, export
    → /library : sons communautaires, filtres avancés, favoris, partage
    → /usage : métriques de caractères utilisés, plan, historique de facturation
    → services/elevenlabs.ts : wrappeur complet de l'API avec gestion d'erreurs et retry
    → hooks/useAudioPlayer.ts : player audio avec états play/pause/seek/volume
    → hooks/useVoiceGeneration.ts : gestion de la génération avec queue et progress

Utilisateur demande "une app de tracking de voyages" :
  Stagiaire : Kanban avec 3 colonnes (Planned/In Progress/Done)
  Fondateur :
    → /dashboard : carte monde interactive (Leaflet) avec pins des voyages,
      stats globales (km parcourus, pays visités, budget dépensé), prochains voyages
    → /trips : liste complète avec filtres (statut, date, destination, budget),
      tri multi-colonnes, vue liste/grille, export CSV/PDF
    → /trip/[id] : détail complet : itinéraire jour par jour, hébergements,
      vols avec confirmation, budget détaillé, photos (upload), notes, partage
    → /planner : création de voyage avec recherche de destinations (API),
      calendrier interactif, estimateur de budget par catégorie
    → /analytics : graphiques de dépenses par voyage, destinations visitées,
      période de l'année préférée, comparaison budgets prévus vs réels
    → services/travel.ts : calcul de distances, conversion de devises, formatage dates
    → services/geo.ts : intégration OpenStreetMap/Nominatim pour geocoding

══════════════════════════════════════════════════════════════════════════════
█  STRUCTURE FICHIERS OBLIGATOIRE
══════════════════════════════════════════════════════════════════════════════

lib/env.ts           → Variables d'env typées (zod.parse au démarrage)
lib/utils.ts         → cn(), formatCurrency(), formatDate(), formatBytes()...
types/index.ts       → Tous les types TypeScript métier de l'application
services/[domain].ts → Logique pure : algorithmes, calculs, appels API externes
stores/[name]Store.ts → Zustand : state + actions typées
hooks/use[Name].ts   → Hooks React : orchestration services + stores
components/ui/       → Button, Input, Badge, Select, Modal, Spinner, Avatar...
components/Modals.tsx → ABSOLUMENT TOUS les modals dans ce seul fichier
components/views/    → Un fichier par page, layout UNIQUE et DIFFÉRENT
app/api/**/route.ts  → Handlers : export GET/POST nommés uniquement
app/globals.css      → CSS variables :root {} du design anchor
app/layout.tsx       → CDN links (Tabler Icons + Google Fonts) du design anchor
app/page.tsx         → Router principal des views, pas de logique métier ici

══════════════════════════════════════════════════════════════════════════════
█  RÈGLES TYPESCRIPT / NEXT.JS 15 — ZÉRO ERREUR DE BUILD
══════════════════════════════════════════════════════════════════════════════

"use client" obligatoire dans tout .tsx utilisant :
  useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer,
  useRouter, usePathname, useSearchParams, useParams,
  tout hook Zustand (useStore, useSomeStore),
  window, document, localStorage, sessionStorage

params → toujours Promise<{slug: string}> puis const {slug} = await params
Route handlers → export GET/POST nommés (JAMAIS export default)
Zustand interface → () => void (JAMAIS le corps de la fonction)
Framer-motion → boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
key= → présent dans TOUT .map() JSX
Apostrophes JSX → &apos; (jamais ' direct dans le JSX)
Imports → chaque import doit pointer vers un fichier qui existe dans la liste générée

══════════════════════════════════════════════════════════════════════════════
█  FORMAT DE SORTIE — STRICT
══════════════════════════════════════════════════════════════════════════════

Ta réponse contient :
1. Les fichiers de code au format :
   <create_file path="chemin/du/fichier.ext">
   ... code complet, jamais tronqué ...
   </create_file>

2. Les dépendances :
   DEPENDENCIES: ["pkg1", "pkg2"]
   DEVDEPENDENCIES: ["@types/pkg1"]

3. Un résumé FINAL en français (5-8 lignes max, propre, sans bullet points markdown) :
   <build_summary>
   [Description concise de ce qui a été construit, les pages créées, les services implémentés,
   les packages intégrés. Ton naturel, pas de bullet points **, pas de titres ###.]
   </build_summary>

INTERDIT dans la réponse :
  ✗ Texte avant le premier <create_file>
  ✗ Explications longues avec **, ##, bullet points pendant la génération
  ✗ "Je vais maintenant créer...", "Voici ce que j'ai fait..."
  ✗ Répétition du résumé — une seule fois à la fin dans <build_summary>
  ✗ Troncature de fichier avec "// ... reste du code ..."
`;

// =============================================================================
// API ROUTE HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages, currentProjectFiles, clonedHtmlCss } = body;

    const lastUserMsg = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });
    const colorCtx = await buildColorContext(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    // Design anchor toujours présent pour éviter la régression
    const designAnchor = buildDesignAnchor(clonedHtmlCss);

    const COMPILER_CHECKLIST = `
=== CHECKLIST BUILD OBLIGATOIRE ===
□ "use client" dans tout tsx avec hooks/browser APIs/Zustand
□ Imports vers fichiers réellement générés dans cette liste
□ params → Promise<{id:string}> + await dans les routes dynamiques
□ Route handlers : export GET/POST nommés (jamais export default)
□ key= dans tous les .map() JSX
□ Aucun apostrophe raw ' dans le JSX → &apos;
□ Zustand interface → () => void uniquement
□ Framer-motion → boxShadow, scale numérique
□ Images → uniquement URLs fonctionnelles (favicons.google, dicebear, picsum)
□ Aucun "TODO", "Coming soon", "This module is active", "Under development"
□ Aucune View avec le même layout qu'une autre → layout UNIQUE par page
`;

    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPkgs: Set<string> = new Set();
    const globalDevPkgs: Set<string> = new Set();
    const createdPaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdPaths.add(f.path));

    const buildHistory = (extra = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      // Images de référence
      if (hasImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE]" }] });
        contents.push({ role: "model", parts: [{ text: "Images de référence reçues." }] });
      }

      // Historique conversation
      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } })
          );
        }
        contents.push({ role, parts });
      });

      // Contexte supplémentaire
      if (extra) {
        contents.push({ role: "user", parts: [{ text: extra }] });
      }
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (txt: string) => {
          // Nettoyer les blocs de code markdown parasites mais garder les create_file
          const cleaned = txt
            .replace(/```tsx\n?/gi, "").replace(/```ts\n?/gi, "")
            .replace(/```css\n?/gi, "").replace(/```json\n?/gi, "")
            .replace(/```html\n?(?![\s\S]*<create_file)/gi, "")
            .replace(/(?<!<\/create_file>[\s\S]{0,10})```\n?/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const emitPhase = (id: string, label: string, status: "processing" | "done" | "error", detail = "") => {
          controller.enqueue(encoder.encode(phaseBlock(id, label, status, detail)));
        };

        try {
          // ── PHASE UNIQUE : MEGA-AGENT ──────────────────────────────────
          emitPhase("build", "Construction de l'application...", "processing");

          const manifest = createdPaths.size > 0
            ? `FICHIERS EXISTANTS :\n${Array.from(createdPaths).join("\n")}`
            : "NOUVEAU PROJET.";

          const fullContext = `
=== DEMANDE UTILISATEUR ===
"${lastUserMsg}"

${designAnchor}
${colorCtx}

${manifest}

${COMPILER_CHECKLIST}

INSTRUCTION FINALE :
Exécute les 5 phases internes (Product Thinking → Feature Inventory → Ordre de génération
→ Wire Verification → Self-Audit), puis génère TOUS les fichiers dans l'ordre obligatoire.
Commence par les services/, puis les stores/, puis les composants, puis les pages.
Ne tronque aucun fichier. Ne simule aucune fonctionnalité. Connecte chaque service à son UI.
`;
          const contents = buildHistory(fullContext);
          let fullOutput = "";
          let buffer = "";

          const response = await ai.models.generateContentStream({
            model: MODEL_ID,
            contents,
            tools: [{ functionDeclarations: [readFileDecl] }],
            config: {
              systemInstruction: `${basePrompt}\n\n${MEGA_AGENT_PROMPT}`,
              temperature: 0.2,
              maxOutputTokens: 65536,
            },
          });

          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) {
              fullOutput += txt;
              buffer += txt;

              // Émission en temps réel — on filtre le XML interne mais on garde le code
              if (buffer.length >= BATCH_SIZE) {
                // Ne pas émettre les balises internes de phases
                const filtered = buffer
                  .replace(/<phase_thinking>[\s\S]*?<\/phase_thinking>/g, "")
                  .replace(/<feature_manifest>[\s\S]*?<\/feature_manifest>/g, "");
                emit(filtered);
                buffer = "";
              }
            }
          }
          if (buffer.trim()) {
            const filtered = buffer
              .replace(/<phase_thinking>[\s\S]*?<\/phase_thinking>/g, "")
              .replace(/<feature_manifest>[\s\S]*?<\/feature_manifest>/g, "");
            emit(filtered);
          }

          // Capture des fichiers
          for (const f of parseGeneratedFiles(fullOutput)) {
            const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
            if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
            createdPaths.add(f.path);
          }
          extractDeps(fullOutput, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(fullOutput, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));

          // Réponse purement conversationnelle ?
          if (allGeneratedFiles.length === 0) {
            emitPhase("build", "Réponse directe", "done");
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          emitPhase("build", "Code généré", "done", `${allGeneratedFiles.length} fichier(s)`);

          // ── CORRECTEUR PROGRAMMATIQUE — 2 PASSES ──────────────────────
          emitPhase("fix", "Correction automatique...", "processing");
          const { files: fixedFiles, totalFixes: fixes1 } = runFixer(allGeneratedFiles);
          // Réinjecter les corrections
          for (let i = 0; i < fixedFiles.length; i++) {
            if (fixedFiles[i].content !== allGeneratedFiles[i]?.content) {
              allGeneratedFiles[i] = fixedFiles[i];
              emit(`<create_file path="${fixedFiles[i].path}">\n${fixedFiles[i].content}\n</create_file>`);
            }
          }
          // Second pass sur les fichiers corrigés
          const { files: fixedFiles2, totalFixes: fixes2 } = runFixer(fixedFiles);
          for (let i = 0; i < fixedFiles2.length; i++) {
            if (fixedFiles2[i].content !== fixedFiles[i]?.content) {
              allGeneratedFiles[i] = fixedFiles2[i];
              emit(`<create_file path="${fixedFiles2[i].path}">\n${fixedFiles2[i].content}\n</create_file>`);
            }
          }
          const totalFixes = fixes1 + fixes2;
          emitPhase("fix", "Corrections appliquées", "done", totalFixes > 0 ? `${totalFixes} pattern(s)` : "aucune erreur");

          // ── PACKAGES ──────────────────────────────────────────────────
          emitPhase("pkgs", "Résolution des packages...", "processing");
          globalPkgs.add("autoprefixer"); globalPkgs.add("sharp");
          globalPkgs.add("clsx"); globalPkgs.add("tailwind-merge"); globalPkgs.add("zustand");
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPkgs.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react")))  globalPkgs.add("iconoir-react");

          const existPkg   = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existDeps  = existPkg ? JSON.parse(existPkg.content).dependencies    ?? {} : {};
          const existDev   = existPkg ? JSON.parse(existPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string,string> = {
            next:"15.1.0", react:"19.0.0", "react-dom":"19.0.0",
            "lucide-react":"0.475.0", sharp:"0.33.5",
            clsx:"2.1.1", "tailwind-merge":"2.3.0", zustand:"4.5.2",
            ...existDeps,
          };
          const newDeps: Record<string,string> = {};
          await Promise.all(Array.from(globalPkgs).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));

          const autoTypes = await resolveTypes(Array.from(globalPkgs), existDev);
          const newDev: Record<string,string> = {};
          await Promise.all(Array.from(globalDevPkgs).map(async pkg => {
            if (newDev[pkg] || existDev[pkg]) return;
            try { const d = await packageJson(pkg); newDev[pkg] = d.version as string; }
            catch { newDev[pkg] = "latest"; }
          }));

          const finalDev: Record<string,string> = {
            typescript:"^5","@types/node":"^20","@types/react":"^19","@types/react-dom":"^19",
            postcss:"^8", tailwindcss:"^3.4.1", eslint:"^8","eslint-config-next":"15.0.3",
            ...existDev, ...autoTypes, ...newDev,
          };

          const pkg = {
            name:"app", version:"1.0.0", private:true,
            scripts:{ dev:"next dev", build:"next build", start:"next start", lint:"next lint" },
            dependencies:{ ...baseDeps, ...newDeps },
            devDependencies: finalDev,
          };
          emit(`<create_file path="package.json">\n${JSON.stringify(pkg, null, 2)}\n</create_file>`);

          emitPhase("pkgs", "Packages résolus", "done",
            `${Object.keys(newDeps).length} runtime · ${Object.keys(autoTypes).length} @types`);

          // ── FIN ───────────────────────────────────────────────────────
          emit("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Build error:", err);
          emitPhase("error", `Erreur : ${err.message}`, "error");
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      },
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
