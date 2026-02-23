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
const SVG_WRENCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const SVG_PACKAGE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

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
// SERVER-SIDE COLOR EXTRACTION (Sharp) — avec position et pourcentage
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 0.299*r + 0.587*g + 0.114*b > 128;
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
        const g = Math.round(data[i+1] / 32) * 32;
        const bv = Math.round(data[i+2] / 32) * 32;
        const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bv.toString(16).padStart(2,"0")}`;
        globalCounts[hex] = (globalCounts[hex] || 0) + 1;
        const zx = Math.floor(x / (W / 3));
        const zy = Math.floor(y / (H / 3));
        const zLabel = zoneLabels[zy * 3 + zx];
        zoneCounts[zLabel][hex] = (zoneCounts[zLabel][hex] || 0) + 1;
      }
    }
    const sorted = Object.entries(globalCounts).sort(([,a],[,b]) => b - a).slice(0, 12);
    const colors: ColorInfo[] = sorted.map(([hex, count]) => {
      const percentage = Math.round((count / totalPixels) * 100);
      const zones: string[] = [];
      for (const [zone, counts] of Object.entries(zoneCounts)) {
        const zoneTotal = Object.values(counts).reduce((a,b) => a+b, 0);
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
  let prompt = "\nCOULEURS EXTRAITES PIXEL PAR PIXEL depuis l'image de référence (autorité absolue) :\n\n";
  for (const c of merged.colors.slice(0, 10)) {
    const zonesStr = c.zones.length > 0 ? c.zones.join(", ") : "présente uniformément";
    prompt += `  ${c.hex}  →  ${c.percentage}% de l'image  —  zones : ${zonesStr}\n`;
  }
  prompt += `\n  Fond dominant : ${merged.backgroundColor}  →  bg-[${merged.backgroundColor}]\n`;
  prompt += `  Couleur de texte adaptée : ${merged.textColor}\n`;
  prompt += "\nCes couleurs sont des faits. Utilise-les exactement.\n";
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
const TYPES_MAP: Record<string,string> = {
  howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",cors:"@types/cors",
  bcrypt:"@types/bcrypt",multer:"@types/multer",passport:"@types/passport",
  "passport-local":"@types/passport-local","passport-jwt":"@types/passport-jwt",
  lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer",
  "body-parser":"@types/body-parser",morgan:"@types/morgan","cookie-parser":"@types/cookie-parser",
  pg:"@types/pg","better-sqlite3":"@types/better-sqlite3",jsonwebtoken:"@types/jsonwebtoken",
  "js-cookie":"@types/js-cookie","node-cron":"@types/node-cron",
  "react-datepicker":"@types/react-datepicker","spotify-web-api-node":"@types/spotify-web-api-node",
  "node-geocoder":"@types/node-geocoder",formidable:"@types/formidable",
};

async function resolveTypesPackages(packages: string[], existing: Record<string,string>): Promise<Record<string,string>> {
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

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// AGENT — FULL STACK BUILDER UNIQUEMENT
// Reçoit le HTML/CSS pixel-perfect généré par /api/chat comme référence absolue.
// =============================================================================

function buildHtmlDesignPreamble(htmlReference?: string): string {
  if (!htmlReference) return "";
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║         ⚠️  DESIGN CONTRACT — RÉFÉRENCE HTML/CSS — AUTORITÉ ABSOLUE         ║
╚══════════════════════════════════════════════════════════════════════════════╝

Le HTML/CSS ci-dessous est la vérité visuelle de cette application.
Il a été généré par un moteur de clonage pixel-perfect depuis l'image de référence.
Ton code React/Next.js doit produire EXACTEMENT le même rendu visuel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 INTERDICTIONS ABSOLUES — ZÉRO EXCEPTION :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NE PAS modifier une seule couleur (hex, rgb, hsl, ou variable CSS)
- NE PAS changer les espacements, paddings, margins, gaps définis
- NE PAS altérer les border-radius, box-shadow, transitions, animations
- NE PAS remplacer les polices, les tailles de texte, les font-weight
- NE PAS renommer ou supprimer les variables CSS déclarées dans :root {}
- NE PAS "améliorer" ou réinterpréter le design de ta propre initiative

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ OBLIGATIONS — SANS EXCEPTION :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Extraire TOUTES les CSS variables de :root {} et les utiliser dans chaque composant React
- Reproduire chaque layout, couleur, espacement, border-radius, typographie à l'identique
- Dans app/layout.tsx, inclure OBLIGATOIREMENT les <link> CDN présents dans le <head> du HTML :
    • Tabler Icons webfont (si présent : cdn.jsdelivr.net/npm/@tabler/icons-webfont...)
    • Google Fonts (si présentes : fonts.googleapis.com/css2?family=...)
    • Tout autre CDN dans le <head> du HTML de référence
- Chaque valeur Tailwind = traduction exacte du CSS du HTML (bg-[#1a1a2e] et non bg-gray-900)
- Les icônes utilisées dans le HTML (<i class="ti ti-..."/>) → même icône en React via le CDN du layout
- La structure des layouts (flex, grid, positions) reproduite à l'identique
- L'application finale doit être visuellement INDISCERNABLE du design de référence
-LOGOS D'ENTREPRISES
══════════════════════════════════════════
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:18px;height:18px;object-fit:contain">
Format : https://www.google.com/s2/favicons?domain=[domaine]&sz=64

══════════════════════════════════════════
AVATARS
══════════════════════════════════════════
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">

══════════════════════════════════════════

Tout ce que tu vois comme url d'image utilise les
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 HTML/CSS DE RÉFÉRENCE (utiliser INTÉGRALEMENT) :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\`\`\`html
${htmlReference.slice(0, 12000)}
\`\`\`
`;
}

const AGENTS = {

  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    temperature: 0.4,
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois une demande utilisateur, et quand elle est présente, une référence HTML/CSS pixel-perfect
générée par un moteur de clonage depuis l'image de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOI DE TRADUCTION HTML → REACT :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Quand une référence HTML/CSS est présente dans le contexte, ta mission est de la
TRADUIRE en React/Next.js — pas de la réinterpréter, pas de l'améliorer, de la TRADUIRE.
Chaque div du HTML devient un composant React. Chaque style inline ou classe CSS du HTML
devient un className Tailwind ou un style prop avec les valeurs EXACTES du HTML.

RÈGLE CDN → LAYOUT :
Les liens <link> du <head> du HTML de référence (Tabler Icons, Google Fonts, etc.)
DOIVENT être présents dans app/layout.tsx dans la section <head>. Sans exception.
Les icônes <i class="ti ti-[name]"> du HTML restent utilisables en React via ce CDN.

RÈGLE DE CONSERVATION ABSOLUE :
Quand la demande est une modification, tu modifies chirurgicalement UNIQUEMENT l'élément
concerné dans UNIQUEMENT les fichiers qui le contiennent.

LOI ANTI-GHOSTING : chaque élément UI est fonctionnel.
LOI TYPESCRIPT STRICT : zéro erreur de build.
LOI DONNÉES RÉELLES : jamais de Lorem ipsum. Contenu contextuel et pertinent.

STRUCTURE : lib/env.ts → lib/utils.ts → lib/auth.ts → types/index.ts → hooks/
→ components/ui/ → components/Modals.tsx → components/views/[Name]View.tsx
→ app/api/.../route.ts → app/layout.tsx → app/page.tsx

RÈGLES TYPESCRIPT/NEXT.JS 15 :
- params → Promise<{id:string}> + await
- Route handlers : export GET/POST nommés uniquement
- Zustand : () => void dans interface, corps dans create()
- Framer-motion : boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)

FORMAT OBLIGATOIRE :
<create_file path="lib/env.ts">...</create_file>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
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
    const {
      history,
      uploadedImages,
      allReferenceImages,
      currentProjectFiles,
      colorsByZone,
      designMode,
      clonedHtmlCss,   // ← HTML/CSS pixel-perfect envoyé par sendChat depuis /api/chat
    } = body;

    const lastUserMessage = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    const colorPalettePrompt = await buildColorPalettePrompt(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    const VIRTUAL_COMPILER_RULES = `
=== AUTO-VÉRIFICATION AVANT CHAQUE FICHIER ===
□ Textes et icônes → couleur noire/neutre (jamais gris bleuté, jamais slate-*, jamais text-blue-gray-*)
□ Tables → colonnes denses et compactes, cellules small, hauteurs de lignes réduites
□ Fond de page → transparent ou couleur body, jamais double couche involontaire
□ Logos de marques LOGOS D'ENTREPRISES
══════════════════════════════════════════
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:18px;height:18px;object-fit:contain">
Format : https://www.google.com/s2/favicons?domain=[domaine]&sz=64

══════════════════════════════════════════
AVATARS
══════════════════════════════════════════
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">

══════════════════════════════════════════
□ Ombres → multi-couches (jamais shadow-sm/md/lg basiques)
□ Transitions → présentes sur chaque élément interactif avec hover
□ Sidebar items → hauteur 30-32px, texte small semibold, radius petit
□ Inputs/searchbox → radius modéré, height réduite, fond identique au conteneur
□ Avatars → dicebear ou ui-avatars (jamais cercle gris vide)
□ Conservation → modifier UNIQUEMENT les fichiers/éléments concernés par la demande
□ CDN layout → tous les <link> du HTML de référence présents dans app/layout.tsx
□ CSS variables → toutes les variables :root {} du HTML utilisées dans les composants React
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string>    = new Set();
    const globalDevPackages: Set<string> = new Set();

    const buildFullHistory = (extra = "", includeImages = false) => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];
      if (includeImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE DESIGN — garde-les en mémoire pour chaque composant que tu génères ou modifies.]" }] });
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
      if (extra) contents.push({ role: "user", parts: [{ text: `\n\n=== MÉMOIRE ===\n${extra}` }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          const cleaned = txt
            .replace(/```xml\n?/gi,"").replace(/```tsx\n?/gi,"").replace(/```ts\n?/gi,"")
            .replace(/```html\n?/gi,"").replace(/```css\n?/gi,"").replace(/```json\n?/gi,"")
            .replace(/```\n?/g,"");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send       = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);
        const phaseStart = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "processing"));
        const phaseDone  = (id: string, icon: string, label: string, detail = "") => {
          sendRaw(`<script>(function(){var el=document.querySelector('[data-phase-id="${id}"]');if(el){el.outerHTML=${JSON.stringify(phaseBlock(id, icon, label, "done", detail))};}})()</script>`);
          sendRaw(phaseBlock(id, icon, label, "done", detail));
        };
        const phaseError = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "error"));

        async function runAgent(
          key: keyof typeof AGENTS,
          briefing: string,
          context: string,
          opts: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean; includeImages?: boolean; rawOutput?: boolean } = {}
        ) {
          const { silent = false, filterXml = false, captureFiles = false, includeImages = false, rawOutput = false } = opts;
          const agent = AGENTS[key];
          let fullOutput = "", buffer = "";
          try {
            // Injection du Design Contract HTML/CSS si disponible
            const htmlPreamble = buildHtmlDesignPreamble(clonedHtmlCss);
            const contents = buildFullHistory(context, includeImages);
            const manifest = createdFilePaths.size > 0
              ? `FILES EXIST:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES YET.";
            contents.push({ role: "user", parts: [{ text: `
=== MISSION : ${agent.name} ===
${briefing}

${htmlPreamble}

=== FILE SYSTEM MANIFEST ===
${manifest}

${colorPalettePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>
            ` }] });

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
                if (rawOutput && buffer.length >= BATCH_SIZE) { buffer = ""; }
                else if (!rawOutput && !silent && buffer.length >= BATCH_SIZE) { send(buffer, filterXml); buffer = ""; }
              }
            }
            if (!rawOutput && buffer && !silent) send(buffer, filterXml);

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

        try {

          // ── PHASE A : FULL STACK BUILDER ─────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code React/Next.js...");
          const builderOutput = await runAgent(
            "FULL_STACK_BUILDER",
            `Demande : "${lastUserMessage}"
             ${clonedHtmlCss
               ? "⚠️ Un HTML/CSS pixel-perfect de référence est présent dans ce contexte. Tu DOIS l'utiliser intégralement comme base visuelle. Commence par lib/env.ts, puis lib/utils.ts, puis app/layout.tsx avec les CDN du HTML."
               : "Commence par lib/env.ts, puis lib/utils.ts."}`,
            "",
            { captureFiles: true, includeImages: hasImages }
          );

          // Si aucun fichier généré → c'était une réponse conversationnelle, on s'arrête
          if (allGeneratedFiles.length === 0) {
            phaseDone("builder", SVG_CODE, "Réponse générée");
            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE ──────────────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction patterns TypeScript...");
          const { files: pFixed, report: fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;
          if (totalFixes > 0) {
            for (const fp of Object.keys(fixReport)) {
              const corrected = pFixed.find(f => f.path === fp);
              const idx = allGeneratedFiles.findIndex(f => f.path === fp);
              if (idx >= 0 && corrected) { allGeneratedFiles[idx] = corrected; send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`); }
            }
            phaseDone("autofixer", SVG_WRENCH, "Patterns corrigés", `${totalFixes} correction(s)`);
          } else { phaseDone("autofixer", SVG_WRENCH, "Aucun pattern à corriger"); }

          // ── PHASE C : PACKAGES ───────────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer"); globalPackages.add("sharp");
          globalPackages.add("clsx"); globalPackages.add("tailwind-merge");
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPackages.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react")))  globalPackages.add("iconoir-react");

          const existingPkg     = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps    = existingPkg ? JSON.parse(existingPkg.content).dependencies    ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string,string> = {
            next:"15.1.0", react:"19.0.0", "react-dom":"19.0.0",
            "lucide-react":"0.475.0", sharp:"0.33.5", clsx:"2.1.1", "tailwind-merge":"2.3.0",
            ...existingDeps,
          };
          const newDeps: Record<string,string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));
          const autoTypes = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string,string> = { ...autoTypes };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
            try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
            catch { allDevTypes[pkg] = "latest"; }
          }));
          const finalDevDeps: Record<string,string> = {
            typescript:"^5","@types/node":"^20","@types/react":"^19","@types/react-dom":"^19",
            postcss:"^8",tailwindcss:"^3.4.1",eslint:"^8","eslint-config-next":"15.0.3",
            ...existingDevDeps,...allDevTypes,
          };
          const pkgJson = {
            name:"app",version:"1.0.0",private:true,
            scripts:{ dev:"next dev",build:"next build",start:"next start",lint:"next lint" },
            dependencies:{ ...baseDeps,...newDeps },
            devDependencies:finalDevDeps,
          };
          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson,null,2)}\n</create_file>`);
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
