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
// SVG PROGRESS SYSTEM — Envoyé côté serveur, rendu nativement par le navigateur
// Le client reçoit du HTML inline dans le stream — le navigateur l'interprète.
// Chaque phase : un bloc "processing" remplacé par "done" quand terminée.
// =============================================================================

// SVG : spinner animé (phase en cours)
const SVG_SPINNER = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;animation:spin 1s linear infinite"><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

// SVG : check vert (phase terminée)
const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>`;

// SVG : erreur rouge
const SVG_ERROR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;

// SVG : code (Builder)
const SVG_CODE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

// SVG : palette (Design)
const SVG_PALETTE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;

// SVG : magnifying glass (Analyse)
const SVG_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;

// SVG : shield (Validator)
const SVG_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

// SVG : wrench (Fixer)
const SVG_WRENCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

// SVG : package
const SVG_PACKAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

// Conteneur d'une phase — le navigateur le rend comme un bloc HTML stylé
// On utilise un id unique pour pouvoir "remplacer" visuellement en renvoyant le même id avec done
function phaseBlock(id: string, icon: string, label: string, status: "processing" | "done" | "error", detail = ""): string {
  const statusColor =
    status === "done" ? "#22c55e"
    : status === "error" ? "#ef4444"
    : "#6366f1";

  const statusIcon =
    status === "done" ? SVG_CHECK
    : status === "error" ? SVG_ERROR
    : SVG_SPINNER;

  const statusText =
    status === "done" ? "Terminé"
    : status === "error" ? "Erreur"
    : "En cours...";

  return `
<div data-phase-id="${id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:6px 0;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-left:3px solid ${statusColor};border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;color:#374151;transition:all 0.3s">
  <span style="color:${statusColor};flex-shrink:0">${statusIcon}</span>
  <span style="color:${statusColor};flex-shrink:0">${icon}</span>
  <span style="font-weight:600;flex:1">${label}</span>
  <span style="color:${statusColor};font-size:12px;font-weight:500">${statusText}</span>
  ${detail ? `<span style="color:#9ca3af;font-size:11px;margin-left:4px">${detail}</span>` : ""}
</div>`;
}

// =============================================================================
// UTILITAIRES
// =============================================================================

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const match = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (match?.[1]) {
    try { return JSON.parse(match[1].replace(/'/g, '"')); }
    catch {
      const m = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      return m ? m.map(s => s.replace(/"/g, "")) : [];
    }
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
// CORRECTEUR PROGRAMMATIQUE — COUCHE 1 (déterministe, sans LLM)
// =============================================================================

interface FixRule {
  name: string;
  detect: (path: string, code: string) => boolean;
  fix: (path: string, code: string, allFiles: GeneratedFile[]) => string;
}

const FIX_RULES: FixRule[] = [
  // ── Framer-motion : propriétés CSS invalides dans animate/whileHover
  {
    name: "framer-motion-shadow-to-boxshadow",
    detect: (_, code) =>
      (code.includes("framer-motion") || code.includes("motion.")) &&
      /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{\{[^}]*\bshadow\b/.test(code),
    fix: (_, code) => code.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  // ── Framer-motion : valeurs Tailwind dans animate (scale-105, opacity-50…)
  {
    name: "framer-motion-tailwind-values",
    detect: (_, code) =>
      /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+|translate-)/.test(code),
    fix: (_, code) =>
      code
        .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${parseInt(n) / 100}`)
        .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${parseInt(n) / 100}`)
        .replace(/\btranslate-y-([\d]+)\b/g, (_, n) => `y: ${n}`)
        .replace(/\btranslate-x-([\d]+)\b/g, (_, n) => `x: ${n}`),
  },
  // ── Framer-motion : boxShadow avec classe Tailwind en valeur
  {
    name: "framer-motion-boxshadow-tailwind-value",
    detect: (_, code) => /boxShadow\s*:\s*["'](?:shadow-|ring-)/.test(code),
    fix: (_, code) =>
      code.replace(
        /boxShadow\s*:\s*["'](?:shadow-\w+|ring-\w+)["']/g,
        `boxShadow: "0 10px 30px -5px rgba(0,0,0,0.15)"`
      ),
  },
  // ── ClassValue non importé
  {
    name: "missing-classvalue-import",
    detect: (_, code) =>
      code.includes("ClassValue") &&
      !code.includes("from 'clsx'") && !code.includes('from "clsx"'),
    fix: (_, code) => {
      let fixed = code.replace(/function cn\s*\(\s*\.\.\.\s*\w+\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g, "");
      if (!fixed.includes("clsx")) {
        fixed = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + fixed;
      } else if (!fixed.includes("type ClassValue")) {
        fixed = fixed.replace(/import\s*\{([^}]+)\}\s*from\s*["']clsx["']/, (_, g) => `import { ${g.trim()}, type ClassValue } from "clsx"`);
      }
      return fixed;
    },
  },
  // ── Next.js 15 route params : type invalide
  {
    name: "nextjs15-route-params",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(code) &&
      !code.includes("Promise<{"),
    fix: (_, code) => {
      let fixed = code.replace(
        /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g,
        (_, t) => `{ params }: { params: Promise<${t}> }`
      );
      if (!fixed.includes("await params") && !fixed.includes("resolvedParams")) {
        fixed = fixed.replace(/params\.(\w+)/g, "(await params).$1");
      }
      return fixed;
    },
  },
  // ── Next.js 15 : params Promise mais pas awaité
  {
    name: "nextjs15-params-no-await",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(code) &&
      !code.includes("await params") &&
      code.includes("Promise<{"),
    fix: (_, code) => code.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  // ── Zustand : corps de méthode dans interface
  {
    name: "zustand-interface-method-body",
    detect: (_, code) =>
      (code.includes("store") || code.includes("create<")) &&
      /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(code),
    fix: (_, code) =>
      code.replace(
        /(interface\s+\w+State\s*\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;\s*)/g,
        (_, iface, m) => `${iface}${(m.match(/^(\w+)/)?.[1] ?? "action")}: () => void;\n`
      ),
  },
  // ── 'use client' manquant
  {
    name: "missing-use-client",
    detect: (path, code) => {
      if (!path.endsWith(".tsx") || path.includes("app/api") || path.includes("layout.tsx")) return false;
      const hooks = /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams)\b/.test(code);
      const hasIt = code.trimStart().startsWith('"use client"') || code.trimStart().startsWith("'use client'");
      return hooks && !hasIt;
    },
    fix: (_, code) => `"use client";\n\n${code}`,
  },
  // ── export default dans route handler
  {
    name: "route-handler-default-export",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /export\s+default\s+(?:async\s+)?function/.test(code) &&
      !code.includes("export { handler as GET"),
    fix: (_, code) =>
      code
        .replace(/export\s+default\s+async\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)")
        .replace(/export\s+default\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)"),
  },
  // ── cn() sans import
  {
    name: "missing-cn-utils-import",
    detect: (_, code) =>
      code.includes("cn(") &&
      !code.includes("function cn") &&
      !code.includes("const cn") &&
      !code.includes("from '@/lib/utils'") &&
      !code.includes('from "@/lib/utils"'),
    fix: (_, code) => {
      const line = `import { cn } from "@/lib/utils";`;
      return (code.includes('"use client"') || code.includes("'use client'"))
        ? code.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${line}\n`)
        : `${line}\n${code}`;
    },
  },
  // ── Metadata dans Client Component
  {
    name: "metadata-in-client-component",
    detect: (_, code) =>
      (code.includes('"use client"') || code.includes("'use client'")) &&
      code.includes("export const metadata"),
    fix: (_, code) =>
      code.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
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
          if (fixed !== content) {
            content = fixed;
            if (pass === 0) applied.push(rule.name);
            changed = true;
          }
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
// SERVER-SIDE COLOR EXTRACTION (Sharp)
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

async function extractColorsFromBase64(b64: string) {
  try {
    const buf = Buffer.from(cleanBase64Data(b64), "base64");
    const { data, info } = await sharp(buf).resize(120, 120, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts: Record<string, number> = {};
    const step = info.channels * 8;
    for (let i = 0; i < data.length; i += step) {
      const r = Math.round(data[i] / 24) * 24;
      const g = Math.round(data[i + 1] / 24) * 24;
      const b = Math.round(data[i + 2] / 24) * 24;
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      counts[hex] = (counts[hex] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a).map(([c]) => c);
    const bg = sorted[0] ?? "#ffffff";
    return { dominantColors: sorted.slice(0, 2), backgroundColor: bg, textColor: isColorLight(bg) ? "#0f0f0f" : "#f5f5f5", accentColors: sorted.slice(2, 5) };
  } catch {
    return { dominantColors: [], backgroundColor: "#ffffff", textColor: "#000000", accentColors: [] };
  }
}

async function buildColorPalettePrompt(uploadedImages: string[], allReferenceImages: string[]): Promise<string> {
  const all = [...(allReferenceImages ?? []), ...(uploadedImages ?? [])];
  if (all.length === 0) return "";
  const palettes = await Promise.all(all.slice(0, 3).map(extractColorsFromBase64));
  const merged = palettes[0];
  const allAccents = palettes.flatMap(p => [...p.dominantColors, ...p.accentColors]).filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);
  return `
PALETTE EXTRAITE PIXEL PAR PIXEL (autorité absolue) :
  Fond       : ${merged.backgroundColor}  → bg-[${merged.backgroundColor}]
  Texte      : ${merged.textColor}         → text-[${merged.textColor}]
  Primaire   : ${merged.dominantColors[0] ?? "à dériver"}
  Secondaire : ${merged.dominantColors[1] ?? "à dériver"}
  Accents    : ${allAccents.join(", ")}
`;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set(["next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk","@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis","@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion","motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts","recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player","react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio","replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps","@googlemaps/google-maps-services-js","finnhub","finnhub-node","yahoo-finance2","@alpacahq/alpaca-trade-api","playwright","date-fns","dayjs","luxon","clsx","tailwind-merge","@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose","bcryptjs"]);
const TYPES_MAP: Record<string, string> = { howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",cors:"@types/cors",bcrypt:"@types/bcrypt",multer:"@types/multer",passport:"@types/passport","passport-local":"@types/passport-local","passport-jwt":"@types/passport-jwt",lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer","body-parser":"@types/body-parser",morgan:"@types/morgan","cookie-parser":"@types/cookie-parser",pg:"@types/pg","better-sqlite3":"@types/better-sqlite3",jsonwebtoken:"@types/jsonwebtoken","js-cookie":"@types/js-cookie","node-cron":"@types/node-cron","react-datepicker":"@types/react-datepicker","spotify-web-api-node":"@types/spotify-web-api-node","node-geocoder":"@types/node-geocoder",formidable:"@types/formidable" };

async function resolveTypesPackages(packages: string[], existingDevDeps: Record<string, string>): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
  await Promise.all(packages.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existingDevDeps[tp]) return;
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
// =============================================================================

const AGENTS = {

  DESIGN_ANALYST: {
    name: "Design Analyst",
    icon: SVG_PALETTE,
    prompt: `
Tu es un Designer UI/UX Senior et expert en analyse visuelle de haute précision.
Tu reçois des images de référence. Ta mission : produire une analyse exhaustive, pixel par pixel,
que le Builder utilisera comme contrat absolu pour reproduire le design.

═══════════════════════════════════════════════════════════
PROTOCOLE D'ULTRA-ANALYSE VISUELLE OBLIGATOIRE
═══════════════════════════════════════════════════════════

Tu analyses l'image la plus pertinente (ou toutes si complémentaires).
Ton analyse doit couvrir CHAQUE élément, même infime.
Utilise des numéros simples (1. 2. 3.) — jamais de # ou ** qui seront mal formatés.

1. PALETTE CHROMATIQUE EXACTE
   Code HEX précis pour CHAQUE couleur visible :
   fond global, fonds de cards, sidebar, textes (tous niveaux), bordures,
   accents, états hover/actif, ombres rgba, gradients (début → fin).

2. TYPOGRAPHIE (chaque zone distincte)
   Famille : serif / sans-serif / monospace / display
   Graisses : thin / light / regular / medium / semibold / bold / extrabold
   Tailles relatives : H1 > H2 > body > caption (en unités relatives)
   Line-height, letter-spacing, transformations (uppercase etc.)

3. STRUCTURE & COMPOSITION
   Layout global, largeurs estimées, système de grilles
   Sections identifiées avec leurs rôles
   Paddings/margins estimés, border-radius, alignements

4. COMPOSANTS — CHAQUE COMPOSANT POINT PAR POINT
   Pour : navbar, sidebar, cards, boutons, inputs, badges, avatars, tables,
   tabs, dropdowns, modals, toasts, progress bars, etc.
   → Dimensions, couleur de fond (#HEX), bordure (épaisseur + couleur),
     border-radius, ombres (direction + blur + couleur rgba), padding,
     contenu, états (default / hover / actif / disabled)

5. EFFETS VISUELS
   Glassmorphism (backdrop-blur + bg/alpha), gradients, ombres portées,
   textures (noise, grain, pattern), séparateurs, highlights/glow, animations implicites

6. ICONOGRAPHIE
   Style (outline / filled / duotone), taille, couleur par contexte

7. DENSITÉ ET RYTHME VISUEL
   Ultra-compact / medium / spacieux — régulier / varié

═══════════════════════════════════════════════════════════
OUTPUT OBLIGATOIRE
═══════════════════════════════════════════════════════════

Tu produis un DESIGN CONTRACT numéroté point par point (jamais de # ou **).
Tu termines avec :
DESIGN_TOKENS:
  --color-bg: #...
  --color-surface: #...
  --color-primary: #...
  --color-text: #...
  --color-border: #...
  --radius-card: ...px
  --shadow-card: ...

Tu présentes ce style comme ta vision créative pour le projet — jamais "image de référence".
    `,
  },

  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    icon: SVG_SEARCH,
    prompt: `
Tu es un Architecte Logiciel Senior. Tu n'écris pas de code.
Tu produis le Blueprint technique qui sera la loi absolue pour le Builder.

ÉTAPE 1 — CLASSIFICATION (première ligne obligatoire) :
  CLASSIFICATION: CHAT_ONLY    → discussion
  CLASSIFICATION: FIX_ACTION   → correction de bug
  CLASSIFICATION: CODE_ACTION  → création / feature

ÉTAPE 2 — FEATURE BLUEPRINT (si CODE_ACTION ou FIX_ACTION) :

<feature id="F01" name="[nom]" priority="CORE|HIGH|MEDIUM">
  <what>Ce que l'utilisateur obtient</what>
  <real_package>package npm exact</real_package>
  <real_service>Service tiers si applicable</real_service>
  <env_vars>VAR_1, VAR_2</env_vars>
  <real_implementation>SDK exact, endpoint, pattern (REST/WS/OAuth)</real_implementation>
  <forbidden>Ce que le Builder NE DOIT PAS faire</forbidden>
  <typescript_requirements>@types requis</typescript_requirements>
  <architecture_patterns>
    - NextAuth : authOptions dans lib/auth.ts UNIQUEMENT
    - Next.js 15 : params → Promise<{id:string}> + await
    - Route handlers : export GET/POST nommés uniquement
    - Zustand : () => void dans interface, corps dans create()
    - Framer-motion : boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
    - cn() : depuis @/lib/utils uniquement
  </architecture_patterns>
  <files_to_create>liste</files_to_create>
</feature>

MAPPING RÉELS : charts→lightweight-charts | prix live→finnhub-node | audio→howler(@types/howler)
  maps→react-leaflet+leaflet(@types/leaflet) | auth→next-auth | paiements→stripe
  chat IA→openai | emails→resend | PC control→@nut-tree/nut-js

<env_file_required>
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=openssl rand -base64 32
</env_file_required>
<build_order>F01, F02...</build_order>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    icon: SVG_CODE,
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint et un Design Contract. Les deux sont des LOIS ABSOLUES.

═══════════════════════════════════════════════════════════════════
LOI 0 — ANTI-GHOSTING & ANTI-LAZY (LA PLUS IMPORTANTE)
═══════════════════════════════════════════════════════════════════

Avant d'écrire la première ligne, rappelle-toi intérieurement :
"Chaque élément UI que je génère est 100% fonctionnel. Aucun bouton vide. Aucun lien mort. Aucune vue générique."

BÊTE NOIRE 1 — UI PADDING / LAZY MOCKING :
❌ Bouton sans onClick réel | Input sans handler | Stats inventées hardcodées
✅ Chaque bouton → action réelle | Chaque input → onChange + validation + submit

BÊTE NOIRE 2 — GHOST NAVIGATION :
❌ Menu sidebar sans route | "Coming Soon" | href="#" sans raison
✅ Chaque menu → sa vue unique | Routing interne géré (useState ou next/navigation)

BÊTE NOIRE 3 — INTERFACE MIRRORING / INTERACTIVE IMPOTENCE :
❌ 10 menus → même composant générique avec titre qui change
❌ Dropdown qui ne s'ouvre pas | Modal inexistante | Filtre qui ne filtre pas
✅ Chaque vue = fichier unique avec contenu et logique propres
✅ components/Modals.tsx = fichier unique contenant TOUS les modals
✅ Dropdowns, drawers, tooltips sont tous implémentés

BÊTE NOIRE 4 — SEMANTIC SHIFTING / TEMPLATE COLLAPSING :
❌ Analytics = Orders = Profile → même composant générique
✅ Analytics → graphiques réels | Orders → liste statuts | Profile → formulaire éditable

═══════════════════════════════════════════════════════════════════
LOI 1 — REAL IMPLEMENTATION ONLY
═══════════════════════════════════════════════════════════════════

✅ stripe.paymentIntents.create({amount, currency})
✅ new Howl({ src: [url], html5: true, onend: next })
✅ openai.chat.completions.create({ model, messages, stream: true })
✅ motion.div whileHover={{ y: -4, boxShadow: "0 20px 40px rgba(0,0,0,0.1)", scale: 1.02 }}
❌ setTimeout(() => setData(fakeData), 800)
❌ Math.random() pour simuler des données
❌ whileHover={{ shadow: "..." }} → INTERDIT, framer-motion n'a pas "shadow"
❌ whileHover={{ scale: "scale-102" }} → INTERDIT, ce sont des classes Tailwind pas des valeurs CSS

═══════════════════════════════════════════════════════════════════
LOI 2 — TYPESCRIPT STRICT : ZÉRO ERREUR DE BUILD
═══════════════════════════════════════════════════════════════════

2.1 lib/env.ts PREMIER :
const req = (k:string) => { const v=process.env[k]; if(!v) throw new Error("Missing: "+k); return v; };
export const env = { dbUrl: req("DATABASE_URL") } as const;

2.2 NEXTAUTH :
lib/auth.ts → authOptions: NextAuthOptions = {...}
route.ts → import NextAuth; import {authOptions}; const h=NextAuth(authOptions); export {h as GET, h as POST};

2.3 ROUTE PARAMS NEXT.JS 15 :
async function GET(req, { params }: { params: Promise<{id:string}> }) { const {id} = await params; }

2.4 ZUSTAND : interface = signatures () => void, create() = corps des méthodes

2.5 cn() : import { cn } from "@/lib/utils" — jamais redéfini inline

2.6 FRAMER-MOTION VALEURS VALIDES :
✅ scale: 1.05 | y: -4 | opacity: 0.8 | boxShadow: "0 10px 30px rgba(0,0,0,0.1)" | rotate: 15
❌ scale-105 | translate-y-4 | opacity-80 | shadow-lg | shadow: "..." (propriété inexistante)

2.7 'use client' : obligatoire si hooks React utilisés

2.8 Route handlers : export GET/POST nommés uniquement

2.9 try/catch sur chaque appel API externe

2.10 Cleanup : zéro console.log, zéro TODO, JSX fermé, useEffect avec dépendances

═══════════════════════════════════════════════════════════════════
LOI 3 — DESIGN CONTRACT (reçu du Design Analyst)
═══════════════════════════════════════════════════════════════════

Reproduis le Design Contract au pixel perfect.
Chaque couleur HEX → Tailwind arbitrary value obligatoire.
Effets identifiés → implémentés exactement.
Typographie identifiée → Google Fonts via next/font.
Chaque composant → reproduit fidèlement.

═══════════════════════════════════════════════════════════════════
LOI 4 — STRUCTURE
═══════════════════════════════════════════════════════════════════

Ordre : lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/index.ts
→ hooks/ → components/ui/ → components/Modals.tsx → components/views/[Name]View.tsx
→ app/api/[route]/route.ts → app/page.tsx

FORMAT :
<create_file path="lib/env.ts">...</create_file>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  CODE_VALIDATOR: {
    name: "Code Validator",
    icon: SVG_SHIELD,
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
Tu reçois des fichiers générés. Tu corriges uniquement ce qui casse npm run build.

═══════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°1 : NE PAS NUIRE
═══════════════════════════════════════════════════════════

Tu NE dois PAS :
❌ Simplifier ou réécrire du code fonctionnel
❌ Modifier le design, les couleurs, les animations
❌ Supprimer des fonctionnalités
❌ Toucher les fichiers sans erreur

Tu corriges UNIQUEMENT :
A. Imports invalides (fichier absent du manifest, export nommé vs default mismatch)
B. TypeScript : ClassValue non importé, corps de méthode dans interface Zustand, any implicite
C. Next.js 15 : route params sans Promise/await, export default dans handler, use client manquant
D. Framer-motion : "shadow" → "boxShadow", valeurs Tailwind → valeurs CSS numériques
E. Syntaxe : JSX non fermé, accolades manquantes

FORMAT :
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
    icon: SVG_WRENCH,
    prompt: `
Tu es un expert en débogage Next.js / TypeScript.
Cause racine uniquement. Modifications chirurgicales.

CORRECTIONS CLASSIQUES :
"Could not find declaration file for X"        → DEVDEPENDENCIES: ["@types/X"]
"'handler' not exported"                       → authOptions dans lib/auth.ts
"params is not a Promise"                      → Promise<{ id: string }> + await
"Expected ';', got '('"                        → Corps dans interface Zustand
"Cannot find name 'ClassValue'"               → import { cn } from "@/lib/utils"
"shadow does not exist in TargetAndTransition" → shadow → boxShadow

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
□ Framer-motion → boxShadow (JAMAIS shadow), scale: 1.05 (JAMAIS scale-105)
□ Imports → FILE SYSTEM MANIFEST ou packages déclarés
□ cn() → @/lib/utils uniquement | NextAuth → authOptions dans lib/auth.ts
□ Route params Next.js 15 → Promise<{...}> + await
□ Zustand interface → () => void uniquement, corps dans create()
□ 'use client' → obligatoire si hooks React | Route handlers → GET/POST nommés
□ Anti-ghosting → chaque bouton/menu/input est fonctionnel et unique
□ Tous les modals dans components/Modals.tsx
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string> = new Set();
    const globalDevPackages: Set<string> = new Set();

    const buildFullHistory = (extraContext = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];
      if (allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE DESIGN]" }] });
      }
      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
          parts.push({ text: "\n[IMAGES UPLOADÉES]" });
        }
        contents.push({ role, parts });
      });
      if (extraContext) contents.push({ role: "user", parts: [{ text: `\n\n=== 🧠 MÉMOIRE ===\n${extraContext}` }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          // On ne nettoie que les backticks markdown — on laisse passer tout le reste (HTML, SVG, create_file)
          const cleaned = txt
            .replace(/```xml\n?/gi, "").replace(/```tsx\n?/gi, "").replace(/```ts\n?/gi, "")
            .replace(/```html\n?/gi, "").replace(/```css\n?/gi, "").replace(/```json\n?/gi, "")
            .replace(/```\n?/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        // ── Phase indicator helpers ────────────────────────────────────────
        // Envoie un bloc "processing" puis, une fois la phase finie, un bloc "done"
        // en renvoyant le même id — si le client réinterprète le HTML du stream,
        // il verra la mise à jour. Sinon les deux blocs s'affichent séquentiellement.
        const phaseStart = (id: string, svgIcon: string, label: string) => {
          sendRaw(phaseBlock(id, svgIcon, label, "processing"));
        };
        const phaseDone = (id: string, svgIcon: string, label: string, detail = "") => {
          // On envoie d'abord un script qui tente de remplacer le bloc précédent si le DOM est accessible
          sendRaw(`<script>
(function(){
  var el=document.querySelector('[data-phase-id="${id}"]');
  if(el){el.outerHTML=${JSON.stringify(phaseBlock(id, svgIcon, label, "done", detail))};}
})();
</script>`);
          // Fallback : on envoie aussi le bloc done en clair (les clients non-DOM le verront)
          sendRaw(phaseBlock(id, svgIcon, label, "done", detail));
        };
        const phaseError = (id: string, svgIcon: string, label: string) => {
          sendRaw(phaseBlock(id, svgIcon, label, "error"));
        };

        const send = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);

        // ── runAgent ──────────────────────────────────────────────────────
        async function runAgent(
          agentKey: keyof typeof AGENTS,
          briefing: string,
          projectContext: string,
          options: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean } = {}
        ) {
          const { silent = false, filterXml = false, captureFiles = false } = options;
          const agent = AGENTS[agentKey];
          let fullOutput = "";
          let buffer = "";

          try {
            const contents = buildFullHistory(projectContext);
            const fileManifest = createdFilePaths.size > 0
              ? `FILES CURRENTLY EXIST:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES CREATED YET.";

            contents.push({ role: "user", parts: [{ text: `
=== MISSION : ${agent.name} ===
${briefing}

=== 📂 FILE SYSTEM MANIFEST ===
${fileManifest}

${colorPalettePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>
            ` }] });

            const temperature =
              agentKey === "MASTER_BLUEPRINT" ? 0.1
              : agentKey === "DESIGN_ANALYST" ? 0.05
              : agentKey === "CODE_VALIDATOR" ? 0.05
              : agentKey === "FIXER" ? 0.15
              : 0.2;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: {
                systemInstruction: `${basePrompt}\n\n=== IDENTITÉ ===\n${agent.prompt}`,
                temperature,
                maxOutputTokens: 65536,
              },
            });

            for await (const chunk of response) {
              const txt = chunk.text;
              if (txt) {
                buffer += txt;
                fullOutput += txt;
                if (buffer.length >= BATCH_SIZE) {
                  if (!silent) send(buffer, filterXml);
                  buffer = "";
                }
              }
            }
            if (buffer && !silent) send(buffer, filterXml);

            for (const m of fullOutput.matchAll(/<create_file path="(.*?)">/g)) {
              if (m[1]) createdFilePaths.add(m[1]);
            }
            if (captureFiles) {
              const newFiles = parseGeneratedFiles(fullOutput);
              for (const f of newFiles) {
                const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
                if (idx >= 0) allGeneratedFiles[idx] = f;
                else allGeneratedFiles.push(f);
              }
            }

            extractDeps(fullOutput, "DEPENDENCIES").forEach(d => globalPackages.add(d));
            extractDeps(fullOutput, "DEVDEPENDENCIES").forEach(d => globalDevPackages.add(d));

            return fullOutput;
          } catch (e: any) {
            console.error(`Agent ${agent.name} error:`, e);
            if (!silent) send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        // ════════════════════════════════════════════════════════════════════
        // ORCHESTRATION PRINCIPALE
        // ════════════════════════════════════════════════════════════════════
        try {

          // ── PHASE 0 : DESIGN ANALYST ────────────────────────────────────
          let designContract = "";
          if (hasImages) {
            phaseStart("design", SVG_PALETTE, "Analyse du design en cours...");
            try {
              designContract = await runAgent(
                "DESIGN_ANALYST",
                `Analyse toutes les images de référence et produis le Design Contract exhaustif.\nProjet : "${lastUserMessage}"`,
                "",
                { silent: true }
              );
              const points = designContract.split("\n").filter(l => l.trim()).length;
              phaseDone("design", SVG_PALETTE, "Design analysé", `${points} points d'analyse`);
            } catch {
              phaseError("design", SVG_PALETTE, "Analyse design — erreur");
            }
          }

          // ── PHASE 1 : MASTER BLUEPRINT ──────────────────────────────────
          phaseStart("blueprint", SVG_SEARCH, "Analyse du projet...");
          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse cette demande et produis le Blueprint.\nDemande : "${lastUserMessage}"`,
            "",
            { silent: true }
          );

          const classMatch = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            phaseDone("blueprint", SVG_SEARCH, "Analyse terminée");
            send(filterBlueprintXml(blueprintOutput));
            controller.close();
            return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g) ?? []).length;
          phaseDone("blueprint", SVG_SEARCH, "Blueprint établi", `${featureCount} feature${featureCount > 1 ? "s" : ""}`);

          // ── FIX ACTION ─────────────────────────────────────────────────
          if (decision === "FIX_ACTION") {
            phaseStart("fixer", SVG_WRENCH, "Correction du bug...");
            const codeContext = currentProjectFiles
              ? currentProjectFiles.map((f: any) => `\n--- ${f.path} ---\n${f.content}`).join("\n")
              : "";
            await runAgent("FIXER", `Bug : "${lastUserMessage}"`, `${blueprintOutput}\n\n=== CODEBASE ===\n${codeContext}`, { captureFiles: true });

            const { files: pFixed, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const total = Object.values(report).flat().length;
            if (total > 0) {
              for (const f of Object.keys(report)) {
                const c = pFixed.find(x => x.path === f);
                if (c) send(`<create_file path="${c.path}">\n${c.content}\n</create_file>`);
              }
            }
            phaseDone("fixer", SVG_WRENCH, "Bug corrigé", total > 0 ? `${total} correction(s)` : "");
            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ── PHASE A : BUILDER ──────────────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code...");
          await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint et Design Contract reçus. PREMIER FICHIER : lib/env.ts puis lib/utils.ts.
             Respecte LOI 0 (anti-ghosting) : chaque élément UI est fonctionnel.
             Reproduis le Design Contract au pixel perfect.`,
            `=== 📐 BLUEPRINT ===\n${blueprintOutput}\n\n=== 🎨 DESIGN CONTRACT ===\n${designContract}`,
            { captureFiles: true }
          );
          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE ────────────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction automatique des patterns...");
          const { files: pFixed, report: fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;
          if (totalFixes > 0) {
            for (const filePath of Object.keys(fixReport)) {
              const idx = allGeneratedFiles.findIndex(f => f.path === filePath);
              if (idx >= 0) allGeneratedFiles[idx] = pFixed.find(f => f.path === filePath)!;
              const corrected = pFixed.find(f => f.path === filePath);
              if (corrected) send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
            }
            phaseDone("autofixer", SVG_WRENCH, "Patterns corrigés", `${totalFixes} correction(s)`);
          } else {
            phaseDone("autofixer", SVG_WRENCH, "Aucun pattern à corriger");
          }

          // ── PHASE C : VALIDATEUR LLM ───────────────────────────────────
          phaseStart("validator", SVG_SHIELD, "Validation TypeScript & Next.js 15...");
          const filesForValidation = allGeneratedFiles.map(f => `\n=== ${f.path} ===\n${f.content}`).join("\n");
          const validatorOutput = await runAgent(
            "CODE_VALIDATOR",
            `Valide ces ${allGeneratedFiles.length} fichiers.
             RÈGLE ABSOLUE : ne modifie QUE les erreurs de build. Ne touche pas au design.`,
            `=== FICHIERS ===\n${filesForValidation}\n\n=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles: true }
          );

          if (validatorOutput.includes("ALL_FILES_VALID")) {
            phaseDone("validator", SVG_SHIELD, "Validation OK — aucune erreur");
          } else {
            const errCount = (validatorOutput.match(/^-\s/gm) ?? []).length;
            phaseDone("validator", SVG_SHIELD, "Erreurs corrigées", `${errCount} correction(s)`);
          }

          // ── PHASE D : PACKAGES ─────────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer");
          globalPackages.add("sharp");
          globalPackages.add("clsx");
          globalPackages.add("tailwind-merge");

          const existingPkg = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps = existingPkg ? JSON.parse(existingPkg.content).dependencies ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};
          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.561.0", sharp: "0.33.5", clsx: "2.1.1", "tailwind-merge": "2.3.0",
            ...existingDeps,
          };

          const newDeps: Record<string, string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));

          const autoTypesDeps = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string, string> = { ...autoTypesDeps };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
            try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
            catch { allDevTypes[pkg] = "latest"; }
          }));

          const finalDevDeps: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19",
            "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1",
            eslint: "^8", "eslint-config-next": "15.0.3",
            ...existingDevDeps, ...allDevTypes,
          };

          const pkgJson = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: { ...baseDeps, ...newDeps },
            devDependencies: finalDevDeps,
          };
          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);
          phaseDone("packages", SVG_PACKAGE, "Packages résolus", `${Object.keys(newDeps).length} runtime · ${Object.keys(allDevTypes).length} @types`);

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
