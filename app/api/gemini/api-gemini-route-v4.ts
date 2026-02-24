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

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — 6 PASSES, RÈGLES PRÉCISES
// =============================================================================

interface FixRule {
  name: string;
  detect: (p: string, c: string) => boolean;
  fix: (p: string, c: string) => string;
}

// ─── Helpers pour distinguer JSX text vs TS string literals ────────────────

/**
 * Remplace les apostrophes UNIQUEMENT dans les nœuds texte JSX :
 * texte entre >...< qui n'est pas du code TS (pas de {, pas de case/import/const...)
 * JAMAIS dans les string literals TS comme case 'home': ou import '...'
 */
function fixApostrophesInJsxOnly(content: string): string {
  // On traite ligne par ligne pour éviter les faux positifs
  return content.split("\n").map(line => {
    const trimmed = line.trimStart();
    // Lignes à ne JAMAIS toucher — code TypeScript/JavaScript
    if (
      trimmed.startsWith("case ") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ") ||
      trimmed.startsWith("const ") ||
      trimmed.startsWith("let ") ||
      trimmed.startsWith("var ") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("\"") ||
      trimmed.startsWith("'") ||
      trimmed.includes(": '") ||
      trimmed.includes(": \"") ||
      trimmed.includes("= '") ||
      trimmed.includes("= \"") ||
      trimmed.includes("useState('") ||
      trimmed.includes("useState(\"") ||
      trimmed.includes("href='") ||
      trimmed.includes('href="') ||
      /^\s*\w+\s*[=:]\s*['"]/.test(line) ||
      /case\s+['"]/.test(line)
    ) {
      return line;
    }
    // Remplace ' dans texte JSX : >texte avec apostrophe< 
    // Pattern : après > et avant < avec du texte alphabétique
    return line.replace(/>([^<{]*[a-zA-Zà-ÿ])'([a-zA-Zà-ÿ][^<{]*)</g, (m, before, after) => {
      return `>${before}&apos;${after}<`;
    });
  }).join("\n");
}

/**
 * Corrige les &apos; mal placés dans les string literals TS (switch cases, etc.)
 * Si on trouve case 'xxx&apos;: on le remet à case 'xxx':
 */
function fixBadAposInTsStrings(content: string): string {
  return content
    // case 'home&apos;: → case 'home':
    .replace(/case\s+'([^']*?)&apos;'/g, "case '$1'")
    .replace(/case\s+"([^"]*?)&apos;"/g, 'case "$1"')
    // useState('val&apos;') → useState('val')
    .replace(/useState\('([^']*?)&apos;'\)/g, "useState('$1')")
    // setView('val&apos;') → setView('val')
    .replace(/setView\('([^']*?)&apos;'\)/g, "setView('$1')")
    // setCurrentView('val&apos;') → setCurrentView('val')
    .replace(/setCurrentView\('([^']*?)&apos;'\)/g, "setCurrentView('$1')")
    // href='val&apos;' → href='val'
    .replace(/href='([^']*?)&apos;'/g, "href='$1'")
    // = 'val&apos;' → = 'val'
    .replace(/=\s*'([^']*?)&apos;'/g, "= '$1'")
    // : 'val&apos;' → : 'val'  (object literals)
    .replace(/:\s*'([^']*?)&apos;'/g, ": '$1'");
}

const FIX_RULES: FixRule[] = [
  // ── "use client" manquant — hooks ─────────────────────────────────────────
  {
    name: "use-client-hooks",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api") && !p.includes("layout.tsx")
      && /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer)\b/.test(c)
      && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — router hooks ──────────────────────────────────
  {
    name: "use-client-router",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /\b(useRouter|usePathname|useSearchParams|useParams)\b/.test(c)
      && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — window/document ───────────────────────────────
  {
    name: "use-client-window",
    detect: (p, c) => p.endsWith(".tsx") && /\bwindow\.\w+|\bdocument\.\w+/.test(c)
      && !c.includes('"use client"') && !c.includes("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — zustand subscribe ─────────────────────────────
  {
    name: "use-client-zustand",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /use[A-Z]\w*Store\b/.test(c)
      && !c.includes('"use client"') && !c.includes("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── &apos; mal placés dans les string literals TS ─────────────────────────
  // DOIT PASSER AVANT la règle d'ajout d'apostrophes JSX
  {
    name: "fix-bad-apos-in-ts-strings",
    detect: (_, c) => /case\s+['"][^'"]*&apos;/.test(c)
      || /useState\(['"][^'"]*&apos;/.test(c)
      || /=\s*['"][^'"]*&apos;/.test(c),
    fix: (_, c) => fixBadAposInTsStrings(c),
  },
  // ── Apostrophes non échappées dans JSX text uniquement ────────────────────
  {
    name: "apostrophe-jsx-text-only",
    detect: (p, c) => p.endsWith(".tsx") && />([^<{]*[a-zA-Zà-ÿ])'([a-zA-Zà-ÿ][^<{]*)</.test(c),
    fix: (_, c) => fixApostrophesInJsxOnly(c),
  },
  // ── Framer-motion shadow → boxShadow ──────────────────────────────────────
  {
    name: "framer-shadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion."))
      && /(?:whileHover|whileTap|animate|initial)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  // ── Framer-motion valeurs Tailwind ─────────────────────────────────────────
  {
    name: "framer-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`),
  },
  // ── cn() sans import ───────────────────────────────────────────────────────
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
  // ── Next.js 15 — params Promise ───────────────────────────────────────────
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
  // ── Next.js 15 — params sans await ────────────────────────────────────────
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => (p.includes("route.ts") || p.includes("["))
      && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c) && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  // ── Route handler — export default → named ────────────────────────────────
  {
    name: "route-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+\w+/g, "export async function POST")
      .replace(/export\s+default\s+function\s+\w+/g, "export async function POST"),
  },
  // ── Zustand interface avec corps de méthode ───────────────────────────────
  {
    name: "zustand-interface-body",
    detect: (_, c) => c.includes("create<") && /interface\s+\w+State\s*\{[\s\S]*?:\s*\(\s*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(
      /(\w+)\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;(\s*\/\*[\s\S]*?\*\/)?/g,
      (_, name) => `${name}: () => void;`
    ),
  },
  // ── metadata dans client component ────────────────────────────────────────
  {
    name: "metadata-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata\s*=[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
  // ── server-only dans client component ─────────────────────────────────────
  {
    name: "server-only-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("import 'server-only'"),
    fix: (_, c) => c.replace(/import ['"]server-only['"];\n?/g, ""),
  },
  // ── Imports relatifs profonds → alias @/ ──────────────────────────────────
  {
    name: "deep-relative-imports",
    detect: (_, c) => /from ['"]\.\.\/\.\.\/\.\.\//.test(c),
    fix: (_, c) => c.replace(/from ['"]\.\.\/\.\.\/\.\.\//g, 'from "@/'),
  },
  // ── key= manquant dans .map() ─────────────────────────────────────────────
  {
    name: "missing-key-map",
    detect: (p, c) => p.endsWith(".tsx") && /\.map\(\s*\([^)]+\)\s*=>\s*\(?\s*<[A-Za-z](?![^>]*key=)/.test(c),
    fix: (_, c) => c.replace(
      /\.map\(\s*\((\w+)(?:,\s*(\w+))?\)\s*=>\s*\(?\s*<([A-Za-z]\w*)(?![^>]*key=)/g,
      (m, item, idx, tag) => m.replace(`<${tag}`, `<${tag} key={${idx ? idx : `${item}.id ?? ${item}`}}`)
    ),
  },
  // ── tailwind bg-opacity déprécié ──────────────────────────────────────────
  {
    name: "tailwind-bg-opacity",
    detect: (_, c) => /bg-opacity-\d+/.test(c),
    fix: (_, c) => c.replace(/(\S+)\s+bg-opacity-(\d+)/g, "$1/$2"),
  },
  // ── children type manquant ────────────────────────────────────────────────
  {
    name: "missing-children-type",
    detect: (_, c) => c.includes("{children}") && /interface\s+\w+Props/.test(c) && !/children\s*:/.test(c),
    fix: (_, c) => c.replace(/(interface\s+\w+Props\s*\{)/, "$1\n  children?: React.ReactNode;"),
  },
];

function applyFixes(file: GeneratedFile): { file: GeneratedFile; fixCount: number } {
  let { path, content } = file;
  let fixCount = 0;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content);
          if (fixed !== content) { content = fixed; fixCount++; changed = true; }
        }
      } catch {}
    }
    if (!changed) break;
  }
  return { file: { path, content }, fixCount };
}

function runFixer(files: GeneratedFile[]): { files: GeneratedFile[]; totalFixes: number } {
  let totalFixes = 0;
  const fixed = files.map(f => {
    const { file, fixCount } = applyFixes(f);
    totalFixes += fixCount;
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
    const { data, info } = await sharp(buf)
      .resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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
    for (const [hex, cnt] of sorted) prompt += `  ${hex}  ${Math.round(cnt / (W*H) * 100)}%\n`;
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
  "jose","bcryptjs","iconsax-react","iconoir-react",
]);
const TYPES_MAP: Record<string,string> = {
  howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",
  cors:"@types/cors",bcrypt:"@types/bcrypt",multer:"@types/multer",
  lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer",
  pg:"@types/pg",jsonwebtoken:"@types/jsonwebtoken","js-cookie":"@types/js-cookie",
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
// DESIGN ANCHOR — injecté à chaque requête
// =============================================================================

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef) return "";
  return `
╔═══════════════════════════════════════════════════════════╗
║  DESIGN CONTRACT — AUTORITÉ ABSOLUE SUR LE VISUEL        ║
╚═══════════════════════════════════════════════════════════╝
LOI 1 — CSS variables :root {} du HTML → app/globals.css (toutes, sans exception)
LOI 2 — <link> CDN du HTML → app/layout.tsx (Tabler Icons, Google Fonts...)
LOI 3 — Couleurs exactes : bg-[#1a1a2e] jamais bg-gray-900
LOI 4 — Icônes : <i className="ti ti-[name]" /> via CDN du layout
LOI 5 — Images réelles : favicons.google / dicebear / picsum UNIQUEMENT

HTML/CSS DE RÉFÉRENCE :
\`\`\`html
${htmlRef.slice(0, 12000)}
\`\`\`
`;
}

// =============================================================================
// MEGA-AGENT PROMPT
// =============================================================================

const MEGA_AGENT_PROMPT = `
Tu es un Ingénieur Full Stack Principal + Product Manager Senior.
Tu construis de vraies applications, pas des maquettes.

════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°0 — LES STRING LITERALS TS NE SONT PAS DU JSX
════════════════════════════════════════════════════════════

Dans les fichiers TypeScript/TSX, les apostrophes dans les string literals
JavaScript/TypeScript NE doivent PAS être remplacées par &apos;.

CORRECT — string TS :
  case 'home': return <HomeView />;
  const [view, setView] = useState('dashboard');
  setView('analytics');

CORRECT — texte JSX (entre balises, pour l'utilisateur) :
  <p>L&apos;utilisateur a validé</p>
  <span>C&apos;est bon</span>

INCORRECT — NE JAMAIS FAIRE :
  case 'home&apos;: return <HomeView />;   ← CRASH BUILD
  useState('dashboard&apos;')               ← CRASH BUILD

RÈGLE : &apos; uniquement dans le texte visible par l'utilisateur (entre >et<).
        JAMAIS dans les string literals TypeScript.

════════════════════════════════════════════════════════════
PROTOCOLE EN 5 PHASES INTERNES (exécutées mentalement, jamais écrites)
════════════════════════════════════════════════════════════

PHASE 1 — PRODUCT THINKING
"Si je payais 50$/mois pour ce logiciel, qu'est-ce que j'attendrais ?"
Liste toutes les fonctionnalités qu'un utilisateur réel utilise quotidiennement.

PHASE 2 — FEATURE INVENTORY
Pour chaque feature : service → store → hook → composant → wire complet.

PHASE 3 — ORDRE DE GÉNÉRATION (IMMUABLE)
  1. lib/env.ts, lib/utils.ts, types/index.ts
  2. services/*.ts          ← TOUJOURS AVANT TOUT UI
  3. stores/*.ts
  4. hooks/*.ts
  5. app/api/**/route.ts
  6. components/ui/*
  7. components/Modals.tsx  ← TOUS les modals dans CE SEUL fichier
  8. components/views/*View.tsx ← UN fichier par page, layout UNIQUE
  9. app/globals.css (CSS variables du design contract)
  10. app/layout.tsx (CDN links du design contract)
  11. app/page.tsx

PHASE 4 — WIRE VERIFICATION
  □ Chaque bouton → handler réel connecté à un service
  □ Chaque input → état ou store
  □ Chaque modal → submit connecté à un service
  □ Chaque nav item → View distincte avec layout unique
  □ Chaque service → importé et appelé depuis hook ou composant

PHASE 5 — SELF-AUDIT BUILD
  □ "use client" dans tout tsx avec useState/useEffect/useRouter/Zustand
  □ Aucun import vers fichier inexistant
  □ ZÉRO "TODO", "Coming soon", "Under development", "This module is active"
  □ ZÉRO vue avec le même layout qu'une autre (juste le titre changé)
  □ case 'xxx': avec apostrophes DROITES, jamais &apos; dans les switch cases
  □ Tous les packages déclarés dans DEPENDENCIES

════════════════════════════════════════════════════════════
LES 7 CRIMES ABSOLUS
════════════════════════════════════════════════════════════

CRIME 1 — FONCTIONNALITÉ SANDBOX
  ✗ Math.random() comme donnée de marché / setTimeout() simulant une API
  ✓ Logique réelle structurée pour fonctionner avec les vraies clés API en .env

CRIME 2 — GHOST NAVIGATION
  ✗ Sidebar items sans vraie View correspondante
  ✓ Chaque item → components/views/[Name]View.tsx avec contenu réel

CRIME 3 — INTERFACE MIRRORING (le plus fréquent)
  ✗ VoicesView et SoundEffectsView = même composant, titre différent
  ✗ "This module is currently active and functional."
  ✓ Chaque vue = layout HTML unique + données propres + logique propre

CRIME 4 — HOLLOW INTERACTIVITY
  ✗ Bouton qui change de couleur sans logique
  ✓ Chaque interaction → mutation store ou appel API

CRIME 5 — ATOMIC NEGLECT
  ✗ Topbar avec 6 boutons dont 5 sans handler
  ✓ Tout élément interactif = handler complet

CRIME 6 — DISCONNECTED SERVICES
  ✗ services/voices.ts créé mais jamais importé
  ✓ La chaîne UI → hook → service → store est traçable

CRIME 7 — DESIGN REGRESSION
  ✗ Sur correction : réécrire les fichiers en perdant le CSS du design contract
  ✓ Sur correction : modifier UNIQUEMENT les fichiers qui ont des erreurs

════════════════════════════════════════════════════════════
QUALITÉ — L'AGENT TYPE 2 (toujours)
════════════════════════════════════════════════════════════

App ElevenLabs demandée :
  Type 1 (médiocre) : TTS page + Library page avec textes génériques
  Type 2 (toi) :
  → /tts : éditeur texte, sélecteur voix + preview audio, paramètres stability/similarity,
     génération via ElevenLabs API, historique générations, export MP3/WAV
  → /voices : galerie + filtres langue/genre, player preview, clonage (upload audio → API)
  → /studio : projets multi-segments, timeline, mixage, export
  → /library : bibliothèque communautaire, filtres avancés, favoris
  → /usage : métriques caractères, plan, historique facturation
  → services/elevenlabs.ts : wrappeur API complet avec retry et gestion d'erreurs
  → hooks/useAudioPlayer.ts : play/pause/seek/volume avec état global
  → hooks/useVoiceGeneration.ts : queue + progress

════════════════════════════════════════════════════════════
STRUCTURE OBLIGATOIRE
════════════════════════════════════════════════════════════

lib/env.ts           → Variables d'env typées (zod)
lib/utils.ts         → cn(), formatCurrency(), formatDate()
types/index.ts       → Tous les types métier
services/[domain].ts → Logique pure : algorithmes, API calls
stores/[name]Store.ts → Zustand typé
hooks/use[Name].ts   → Orchestration services + stores
components/ui/       → Composants atomiques
components/Modals.tsx → TOUS les modals ici
components/views/    → Un fichier par page, layout DISTINCT
app/api/**/route.ts  → export GET/POST nommés uniquement
app/globals.css      → :root {} CSS variables
app/layout.tsx       → CDN links
app/page.tsx         → Router

════════════════════════════════════════════════════════════
RÈGLES TYPESCRIPT / NEXT.JS 15
════════════════════════════════════════════════════════════

"use client" dans tout tsx utilisant :
  useState, useEffect, useRef, useRouter, usePathname,
  tout hook Zustand, window, document, localStorage

params → Promise<{slug:string}> puis const {slug} = await params
Route handlers → export GET/POST nommés (JAMAIS export default)
Zustand interface → () => void uniquement (jamais le corps)
Framer-motion → boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
key= dans tout .map() JSX
&apos; UNIQUEMENT dans texte JSX visible (JAMAIS dans string literals TS)
Images : favicons.google / dicebear / picsum — JAMAIS de chemins locaux

════════════════════════════════════════════════════════════
FORMAT DE SORTIE
════════════════════════════════════════════════════════════

<create_file path="chemin/fichier.ext">
... code complet, jamais tronqué ...
</create_file>

DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/pkg1"]

<build_summary>
[Résumé concis en français — ce qui a été construit, les pages, les services, les packages.
Prose naturelle. Pas de **, pas de ##, pas de bullet points. 4-6 lignes maximum.]
</build_summary>
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
    const designAnchor = buildDesignAnchor(clonedHtmlCss);

    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPkgs: Set<string> = new Set();
    const globalDevPkgs: Set<string> = new Set();
    const createdPaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdPaths.add(f.path));

    const buildHistory = (extra = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      if (hasImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE]" }] });
        contents.push({ role: "model", parts: [{ text: "Images reçues." }] });
      }

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

      if (extra) contents.push({ role: "user", parts: [{ text: extra }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (txt: string) => {
          const cleaned = txt
            .replace(/```tsx?\n?/gi, "").replace(/```css\n?/gi, "")
            .replace(/```json\n?/gi, "").replace(/```\n?/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        try {
          const manifest = createdPaths.size > 0
            ? `FICHIERS EXISTANTS :\n${Array.from(createdPaths).join("\n")}`
            : "NOUVEAU PROJET.";

          const fullContext = `
=== DEMANDE ===
"${lastUserMsg}"

${designAnchor}
${colorCtx}

${manifest}

=== RAPPEL CRITIQUE ===
Dans les switch/case et useState : utilise des apostrophes DROITES normales.
case 'home': ← CORRECT
case 'home&apos;': ← CRASH BUILD, INTERDIT ABSOLU

Génère TOUS les fichiers dans l'ordre obligatoire.
Services/ en premier, avant tout composant UI.
Connecte chaque service à son composant.
Aucun fichier tronqué. Aucune simulation.
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
              if (buffer.length >= BATCH_SIZE) {
                emit(buffer);
                buffer = "";
              }
            }
          }
          if (buffer.trim()) emit(buffer);

          // Capture fichiers
          for (const f of parseGeneratedFiles(fullOutput)) {
            const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
            if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
            createdPaths.add(f.path);
          }
          extractDeps(fullOutput, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(fullOutput, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));

          if (allGeneratedFiles.length === 0) {
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ── CORRECTION PROGRAMMATIQUE — 2 PASSES ──────────────────────
          // Pass 1
          const { files: pass1 } = runFixer(allGeneratedFiles);
          for (let i = 0; i < pass1.length; i++) {
            if (pass1[i].content !== allGeneratedFiles[i].content) {
              allGeneratedFiles[i] = pass1[i];
              emit(`<create_file path="${pass1[i].path}">\n${pass1[i].content}\n</create_file>`);
            }
          }

          // Pass 2 (rattrape ce que le pass 1 a pu introduire)
          const { files: pass2 } = runFixer(pass1);
          for (let i = 0; i < pass2.length; i++) {
            if (pass2[i].content !== pass1[i].content) {
              allGeneratedFiles[i] = pass2[i];
              emit(`<create_file path="${pass2[i].path}">\n${pass2[i].content}\n</create_file>`);
            }
          }

          // ── PACKAGES ──────────────────────────────────────────────────
          globalPkgs.add("autoprefixer"); globalPkgs.add("sharp");
          globalPkgs.add("clsx"); globalPkgs.add("tailwind-merge"); globalPkgs.add("zustand");
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPkgs.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react")))  globalPkgs.add("iconoir-react");

          const existPkg  = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existDeps = existPkg ? JSON.parse(existPkg.content).dependencies    ?? {} : {};
          const existDev  = existPkg ? JSON.parse(existPkg.content).devDependencies ?? {} : {};

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
            postcss:"^8",tailwindcss:"^3.4.1",eslint:"^8","eslint-config-next":"15.0.3",
            ...existDev,...autoTypes,...newDev,
          };

          const pkg = {
            name:"app", version:"1.0.0", private:true,
            scripts:{ dev:"next dev", build:"next build", start:"next start", lint:"next lint" },
            dependencies:{ ...baseDeps,...newDeps },
            devDependencies: finalDev,
          };
          emit(`<create_file path="package.json">\n${JSON.stringify(pkg,null,2)}\n</create_file>`);

          emit("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Build error:", err);
          emit(`\n[ERREUR]: ${err.message}\n[PAGE_DONE]\n`);
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
