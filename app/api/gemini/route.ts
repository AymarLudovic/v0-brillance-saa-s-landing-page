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
// CORRECTEUR PROGRAMMATIQUE — COUCHE 1
// Règles déterministes. Aucun LLM. Chaque règle = un bug connu → fix garanti.
// =============================================================================

interface FixRule {
  name: string;
  detect: (path: string, code: string) => boolean;
  fix: (path: string, code: string, allFiles: GeneratedFile[]) => string;
}

const FIX_RULES: FixRule[] = [

  // ── RÈGLE 1 : Framer-motion — propriétés CSS invalides dans animate/whileHover
  // Erreur : Property 'shadow' does not exist in type TargetAndTransition
  // Fix   : shadow → boxShadow, radius → borderRadius, etc.
  {
    name: "framer-motion-invalid-props",
    detect: (_, code) =>
      (code.includes("framer-motion") || code.includes("motion.")) &&
      /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{[^}]*\b(shadow|radius|opacity-[\d]+|scale-[\d]+)\b/.test(code),
    fix: (_, code) => {
      return code
        // shadow → boxShadow (seule propriété CSS valide dans framer-motion)
        .replace(/\b(shadow)\s*:/g, "boxShadow:")
        // borderRadius si écrit "radius:"
        .replace(/\b(radius)\s*:/g, "borderRadius:")
        // opacity-50 style tailwind dans animate → 0.5
        .replace(/opacity-([\d]+)\b/g, (_, n) => String(parseInt(n) / 100));
    },
  },

  // ── RÈGLE 2 : Framer-motion — shadow string incomplet
  // whileHover={{ boxShadow: "0 20px..." }} est correct, mais parfois l'IA
  // écrit boxShadow avec une valeur Tailwind non reconnue
  {
    name: "framer-motion-boxshadow-value",
    detect: (_, code) =>
      /boxShadow\s*:\s*["'](?:shadow-|ring-)/.test(code),
    fix: (_, code) =>
      code.replace(
        /boxShadow\s*:\s*["'](shadow-\w+|ring-\w+)["']/g,
        `boxShadow: "0 10px 30px -5px rgba(0,0,0,0.15)"`
      ),
  },

  // ── RÈGLE 3 : ClassValue non importé
  // Erreur : Cannot find name 'ClassValue'
  {
    name: "missing-classvalue-import",
    detect: (_, code) =>
      code.includes("ClassValue") &&
      !code.includes("from 'clsx'") && !code.includes('from "clsx"'),
    fix: (_, code) => {
      let fixed = code.replace(
        /function cn\s*\(\s*\.\.\.\s*\w+\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g, ""
      );
      if (!fixed.includes("clsx")) {
        fixed = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + fixed;
      } else if (!fixed.includes("type ClassValue")) {
        fixed = fixed.replace(
          /import\s*\{([^}]+)\}\s*from\s*["']clsx["']/,
          (_, g) => `import { ${g.trim()}, type ClassValue } from "clsx"`
        );
      }
      return fixed;
    },
  },

  // ── RÈGLE 4 : Next.js 15 route params — type invalide
  // Erreur : Type "{ params: { id: string } }" is not valid for second argument
  {
    name: "nextjs15-route-params",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(code) &&
      !code.includes("Promise<{"),
    fix: (_, code) => {
      let fixed = code.replace(
        /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g,
        (_, typeBody) => `{ params }: { params: Promise<${typeBody}> }`
      );
      if (!fixed.includes("await params") && !fixed.includes("resolvedParams")) {
        fixed = fixed.replace(/params\.(\w+)/g, "(await params).$1");
      }
      return fixed;
    },
  },

  // ── RÈGLE 5 : Zustand — corps de méthode dans interface
  // Erreur : Expected ';', got '('
  {
    name: "zustand-interface-method-body",
    detect: (_, code) =>
      (code.includes("store") || code.includes("create<")) &&
      /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(code),
    fix: (_, code) => {
      return code.replace(
        /(interface\s+\w+State\s*\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;\s*)/g,
        (_, iface, methodWithBody) => {
          const name = methodWithBody.match(/^(\w+)/)?.[1] ?? "action";
          return `${iface}${name}: () => void;\n`;
        }
      );
    },
  },

  // ── RÈGLE 6 : 'use client' manquant
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

  // ── RÈGLE 7 : export default dans route handler
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

  // ── RÈGLE 8 : cn() utilisé sans import depuis @/lib/utils
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
      if (code.includes('"use client"') || code.includes("'use client'")) {
        return code.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${line}\n`);
      }
      return `${line}\n${code}`;
    },
  },

  // ── RÈGLE 9 : Metadata dans Client Component
  {
    name: "metadata-in-client-component",
    detect: (_, code) =>
      (code.includes('"use client"') || code.includes("'use client'")) &&
      code.includes("export const metadata"),
    fix: (_, code) =>
      code.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },

  // ── RÈGLE 10 : params Next.js 15 destructuré sans await
  {
    name: "nextjs15-params-no-await",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(code) &&
      !code.includes("await params") &&
      code.includes("Promise<{"),
    fix: (_, code) =>
      code.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },

  // ── RÈGLE 11 : import type manquant pour ReactNode / FC / etc.
  {
    name: "missing-type-keyword-on-react-types",
    detect: (_, code) => {
      const typeOnlys = ["FC", "ReactNode", "CSSProperties", "MouseEvent", "KeyboardEvent", "ChangeEvent", "FormEvent", "RefObject", "Dispatch", "SetStateAction"];
      return typeOnlys.some(t => {
        const rx = new RegExp(`import\\s*\\{[^}]*\\b${t}\\b[^}]*\\}\\s*from\\s*["']react["']`);
        return rx.test(code) && !code.includes("import type {");
      });
    },
    fix: (_, code) => {
      const typeOnlys = new Set(["FC", "ReactNode", "CSSProperties", "MouseEvent", "KeyboardEvent", "ChangeEvent", "FormEvent", "RefObject", "Dispatch", "SetStateAction", "ComponentProps", "ComponentPropsWithoutRef"]);
      return code.replace(
        /import\s*\{([^}]+)\}\s*from\s*["']react["']/g,
        (_, imports) => {
          const list = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
          const types = list.filter((i: string) => typeOnlys.has(i.replace(/\s+as\s+\w+/, "").trim()));
          const values = list.filter((i: string) => !typeOnlys.has(i.replace(/\s+as\s+\w+/, "").trim()));
          const lines: string[] = [];
          if (values.length > 0) lines.push(`import { ${values.join(", ")} } from "react"`);
          if (types.length > 0) lines.push(`import type { ${types.join(", ")} } from "react"`);
          return lines.join(";\n");
        }
      );
    },
  },

  // ── RÈGLE 12 : Framer-motion whileHover avec propriétés tailwind-style (scale-105)
  {
    name: "framer-motion-tailwind-in-animate",
    detect: (_, code) =>
      /(?:whileHover|animate|initial|exit)\s*=\s*\{[^}]*(?:scale-|translate-|rotate-)/.test(code),
    fix: (_, code) =>
      code
        .replace(/scale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${parseInt(n) / 100}`)
        .replace(/translate-x-([\d]+)\b/g, (_, n) => `x: ${n}`)
        .replace(/translate-y-([\d]+)\b/g, (_, n) => `y: ${n}`)
        .replace(/rotate-([\d]+)\b/g, (_, n) => `rotate: ${n}`),
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
PALETTE EXTRAITE PIXEL PAR PIXEL (autorité absolue — utilise ces codes HEX en Tailwind arbitrary values) :
  Fond       : ${merged.backgroundColor}  → bg-[${merged.backgroundColor}]
  Texte      : ${merged.textColor}         → text-[${merged.textColor}]
  Primaire   : ${merged.dominantColors[0] ?? "dériver"}
  Secondaire : ${merged.dominantColors[1] ?? "dériver"}
  Accents    : ${allAccents.join(", ")}
`;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set(["next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk","@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis","@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion","motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts","recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player","react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio","replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps","@googlemaps/google-maps-services-js","finnhub","finnhub-node","yahoo-finance2","@alpacahq/alpaca-trade-api","playwright","date-fns","dayjs","luxon","clsx","tailwind-merge","@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose","bcryptjs"]);
const TYPES_MAP: Record<string, string> = { howler:"@types/howler", leaflet:"@types/leaflet", express:"@types/express", cors:"@types/cors", bcrypt:"@types/bcrypt", multer:"@types/multer", passport:"@types/passport", "passport-local":"@types/passport-local", "passport-jwt":"@types/passport-jwt", lodash:"@types/lodash", uuid:"@types/uuid", nodemailer:"@types/nodemailer", "body-parser":"@types/body-parser", morgan:"@types/morgan", "cookie-parser":"@types/cookie-parser", pg:"@types/pg", "better-sqlite3":"@types/better-sqlite3", jsonwebtoken:"@types/jsonwebtoken", "js-cookie":"@types/js-cookie", "node-cron":"@types/node-cron", "react-datepicker":"@types/react-datepicker", "spotify-web-api-node":"@types/spotify-web-api-node", "node-geocoder":"@types/node-geocoder", formidable:"@types/formidable" };

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

const readFileDeclaration: FunctionDeclaration = { name: "readFile", description: "Lecture fichier.", parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] } };

// =============================================================================
// AGENTS
// =============================================================================

const AGENTS = {

  // ───────────────────────────────────────────────────────────────────────────
  // AGENT 0 — DESIGN ANALYST
  // Phase d'ultra-analyse visuelle AVANT tout code.
  // Reçoit les images de référence, produit une analyse pixel-perfect exhaustive.
  // Son output est injecté dans le Builder comme contrat de design absolu.
  // L'utilisateur ne voit PAS cet output — c'est un contrat interne.
  // ───────────────────────────────────────────────────────────────────────────
  DESIGN_ANALYST: {
    name: "Design Analyst",
    icon: "🎨",
    prompt: `
Tu es un Designer UI/UX Senior et un expert en analyse visuelle de haute précision.
Tu reçois des images de référence design. Ton unique mission est de produire une analyse
exhaustive, pixel par pixel, de ces images afin que le Builder puisse les reproduire
au pixel perfect dans le code.

═══════════════════════════════════════════════════════════
PROTOCOLE D'ULTRA-ANALYSE VISUELLE OBLIGATOIRE
═══════════════════════════════════════════════════════════

Tu sélectionnes l'image la plus pertinente parmi celles reçues (ou tu analyses toutes si
complémentaires). Tu ne combines pas deux images — tu te concentres sur la plus riche.

TON ANALYSE DOIT COUVRIR EXHAUSTIVEMENT, DANS CET ORDRE :

1. PALETTE CHROMATIQUE EXACTE
   Pour chaque couleur visible : note le code HEX précis que tu observes.
   Ne suppose jamais. Ne dis pas "bleu foncé", dis "#1a1a2e".
   Couvre : fond global, fonds de cards, fonds de sidebar, couleurs de texte primaire,
   secondaire, tertiaire, couleurs de bordures, couleurs d'accent, couleurs hover,
   couleurs actives, ombres (rgba), gradients (de quelle couleur à quelle couleur).

2. TYPOGRAPHIE
   Pour chaque zone de texte distincte :
   - Style de police : serif / sans-serif / monospace / display
   - Graisses utilisées : thin, light, regular, medium, semibold, bold, extrabold
   - Tailles relatives : hierarchy H1 > H2 > body > caption
   - Line-height estimé : compact / normal / spacieux
   - Letter-spacing : normal / tight / wide
   - Couleur exacte du texte à chaque niveau
   - Transformations : uppercase, capitalize, lowercase

3. STRUCTURE ET COMPOSITION
   - Layout global : sidebar + main content / full-width / grid / etc.
   - Largeurs estimées : sidebar en px/%, main content en %
   - Système de grilles : colonnes, gouttières
   - Sections identifiées : header, sidebar, topbar, main, footer, modals
   - Alignements : left / center / right pour chaque section
   - Paddings et margins : tight (4-8px) / medium (12-16px) / large (24-32px) / xl (48px+)
   - Border-radius : aucun / small (4px) / medium (8px) / large (16px) / full (9999px)

4. COMPOSANTS — CHAQUE COMPOSANT IDENTIFIÉ POINT PAR POINT
   Pour chaque composant visible (navbar, sidebar, card, bouton, input, badge, avatar,
   table, tabs, dropdown, modal, toast, tooltip, progress bar, etc.) :
   - Dimensions et proportions
   - Couleur de fond exact (#HEX)
   - Couleur de bordure si présente (épaisseur + couleur #HEX)
   - Border-radius
   - Ombres (direction, blur, spread, couleur rgba)
   - Padding interne
   - Contenu : icône + texte / texte seul / icône seule
   - État par défaut vs hover vs actif vs désactivé
   - Transitions visibles

5. EFFETS VISUELS
   - Glassmorphism : backdrop-blur + bg-white/alpha
   - Gradients : direction + couleurs de début et fin (#HEX)
   - Ombres portées : direction (bas-droite / haut / ambiant) + intensité + couleur
   - Effets de texture : noise, grain, pattern
   - Séparateurs : ligne / gradient / espace vide
   - Highlight / glow : sur quels éléments, de quelle couleur
   - Animations implicites (hover lifts, scale, underline reveal, etc.)

6. ICONOGRAPHIE
   - Style : outline / filled / duotone / flat
   - Taille : small (16px) / medium (20px) / large (24px) / xl (32px)
   - Couleur des icônes par contexte

7. IMAGES ET MÉDIAS
   - Ratio d'aspect des images : 1:1 / 16:9 / 4:3 / portrait
   - Style : photos réelles / illustrations / avatars / mockups
   - Traitements : grayscale, overlay, border, shadow

8. DENSITÉ ET RYTHME VISUEL
   - Densité générale : ultra-compact (tableau Bloomberg) / medium (dashboard) / spacieux (landing)
   - Rythme des sections : régulier / varié / alternant

═══════════════════════════════════════════════════════════
CE QUE TU PRODUIS COMME OUTPUT
═══════════════════════════════════════════════════════════

Tu produis un DESIGN CONTRACT structuré en sections numérotées (utilise 1. 2. 3. etc.,
JAMAIS de # ou ** qui seraient formatés). Ce contrat sera la loi absolue du Builder.

Inclus à la fin :
DESIGN_TOKENS:
  --color-bg: #...
  --color-surface: #...
  --color-primary: #...
  --color-text: #...
  --color-border: #...
  --radius-card: ...px
  --shadow-card: ...

Note : tu présentes ce style comme une proposition de design pour l'application demandée.
Tu ne révèles JAMAIS à l'utilisateur que tu analyses une image de référence.
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // AGENT 1 — MASTER BLUEPRINT
  // ───────────────────────────────────────────────────────────────────────────
  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    icon: "🧠",
    prompt: `
Tu es un Architecte Logiciel Senior. Tu n'écris pas de code.
Tu produis le Blueprint technique qui sera la loi absolue pour le Builder.

ÉTAPE 1 — CLASSIFICATION (première ligne obligatoire) :
  CLASSIFICATION: CHAT_ONLY    → discussion, pas de code
  CLASSIFICATION: FIX_ACTION   → correction de bug
  CLASSIFICATION: CODE_ACTION  → création ou ajout de features

ÉTAPE 2 — FEATURE BLUEPRINT (si CODE_ACTION ou FIX_ACTION) :

<feature id="F01" name="[nom]" priority="CORE|HIGH|MEDIUM">
  <what>Ce que l'utilisateur obtient (1 phrase)</what>
  <real_package>package npm exact</real_package>
  <real_service>Service tiers si applicable</real_service>
  <env_vars>VAR_1, VAR_2</env_vars>
  <real_implementation>Méthode exacte : SDK, endpoint, pattern</real_implementation>
  <forbidden>Ce que le Builder NE doit PAS faire (simuler, hardcoder, etc.)</forbidden>
  <typescript_requirements>@types requis, patterns TS spécifiques</typescript_requirements>
  <architecture_patterns>
    - NextAuth : authOptions dans lib/auth.ts UNIQUEMENT
    - Next.js 15 route params : Promise<{id:string}> + await params
    - Route handlers : export named GET/POST uniquement
    - Zustand : signature () => void dans interface, corps dans create()
    - cn() : import depuis @/lib/utils UNIQUEMENT
    - Env vars : lib/env.ts UNIQUEMENT
    - Framer-motion : boxShadow (JAMAIS shadow), scale: 1.05 (JAMAIS scale-105)
  </architecture_patterns>
  <files_to_create>liste des fichiers</files_to_create>
</feature>

MAPPING SERVICES RÉELS :
  Charts trading → lightweight-charts | Prix live → finnhub-node
  Audio → howler [@types/howler] | Maps → react-leaflet + leaflet [@types/leaflet]
  Chat IA streaming → openai ou @anthropic-ai/sdk | Paiements → stripe
  Auth → next-auth [authOptions dans lib/auth.ts] | DB → drizzle-orm
  Real-time → socket.io | Emails → resend | Contrôle PC → @nut-tree/nut-js

<env_file_required>
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=openssl rand -base64 32
</env_file_required>

<build_order>F01, F02, ...</build_order>
DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // AGENT 2 — FULL STACK BUILDER
  // ───────────────────────────────────────────────────────────────────────────
  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    icon: "⚡",
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint (contrat technique) et un Design Contract (contrat visuel).
Les deux sont des LOIS ABSOLUES que tu respectes intégralement.

═══════════════════════════════════════════════════════════════════
LOI 0 — ANTI-GHOSTING & ANTI-LAZY : LA LOI LA PLUS IMPORTANTE
═══════════════════════════════════════════════════════════════════

Avant d'écrire la première ligne, grave ces principes :

BÊTE NOIRE 1 — UI PADDING / LAZY MOCKING :
  ❌ Élément UI qui ne fait rien (bouton sans onClick, lien sans route, input sans handler)
  ❌ Données hardcodées pour "faire beau" (noms fictifs, stats inventées)
  ❌ Section vide avec juste du texte pour remplir l'espace
  ✅ Chaque bouton déclenche une vraie action ou ouvre un vrai état
  ✅ Chaque input a un onChange + validation + submission réelle
  ✅ Chaque stat affiche une vraie donnée (API, calcul, ou state explicitement mockée
     avec des mocks crédibles en attendant le backend)

BÊTE NOIRE 2 — GHOST NAVIGATION / COMPONENT STALLING :
  ❌ Menu sidebar qui ne route vers rien (onClick vide ou absent)
  ❌ Menu qui dit "Under Development" ou "Coming Soon"
  ❌ Lien href="#" sans raison
  ✅ Chaque item de menu a sa vue dédiée et unique
  ✅ Le routing interne est géré (useState pour les vues, ou next/navigation)
  ✅ Chaque vue a son propre contenu, layout, et fonctionnalités distinctes

BÊTE NOIRE 3 — INTERFACE MIRRORING / INTERACTIVE IMPOTENCE :
  ❌ 10 menus qui affichent le même composant générique avec juste le titre qui change
  ❌ Dropdown qui ne s'ouvre pas, modal inexistante, filtre qui ne filtre pas
  ❌ Formulaire qui fait console.log au lieu de soumettre
  ✅ Chaque vue est unique en contenu, structure et fonctionnalité
  ✅ Dropdowns, modals, drawers sont implémentés dans un Modals.tsx centralisé
  ✅ Les filtres filtrent vraiment, les recherches cherchent vraiment

BÊTE NOIRE 4 — SEMANTIC SHIFTING / TEMPLATE COLLAPSING :
  ❌ Réutiliser le même composant générique pour des concepts métier différents
  ❌ Composant "Dashboard" qui sert aussi de "Profil" et d'"Analytics"
  ✅ Chaque concept métier = son propre composant avec sa logique propre
  ✅ Analytics = graphiques réels | Orders = liste avec statuts | Profile = formulaire éditable

RÈGLE DU GRAAL :
  Pense comme le meilleur ingénieur qui veut que l'utilisateur ait un vrai logiciel.
  Un bouton "Exporter" exporte vraiment. Une barre de recherche cherche vraiment.
  Un graphique montre de vraies données (depuis une API ou des mocks structurés réalistes).
  Un modal s'ouvre vraiment. Un formulaire soumet vraiment.

═══════════════════════════════════════════════════════════════════
LOI 1 — REAL IMPLEMENTATION ONLY
═══════════════════════════════════════════════════════════════════

✅ stripe.paymentIntents.create({ amount, currency })
✅ new Howl({ src: [url], html5: true, onend: next })
✅ openai.chat.completions.create({ model, messages, stream: true })
✅ motion.div whileHover={{ y: -4, boxShadow: "0 20px 40px rgba(0,0,0,0.1)" }}
❌ setTimeout(() => setData(fakeData), 800)
❌ Math.random() pour simuler des données réelles
❌ whileHover={{ shadow: "..." }} — INTERDIT (framer-motion n'a pas shadow)
❌ whileHover={{ scale: "scale-105" }} — INTERDIT (tailwind class dans framer)

═══════════════════════════════════════════════════════════════════
LOI 2 — TYPESCRIPT STRICT : ZÉRO ERREUR DE BUILD
═══════════════════════════════════════════════════════════════════

2.1 — lib/env.ts TOUJOURS PREMIER :
const req = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing: "+k); return v; };
export const env = { dbUrl: req("DATABASE_URL") } as const;
→ Importe TOUJOURS depuis @/lib/env

2.2 — NEXTAUTH PATTERN :
// lib/auth.ts — authOptions ICI et SEULEMENT ICI
export const authOptions: NextAuthOptions = { providers: [...] };
// app/api/auth/[...nextauth]/route.ts — 3 lignes UNIQUEMENT :
import NextAuth from "next-auth"; import { authOptions } from "@/lib/auth";
const handler = NextAuth(authOptions); export { handler as GET, handler as POST };

2.3 — ROUTE PARAMS NEXT.JS 15 :
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // await OBLIGATOIRE
}

2.4 — ZUSTAND :
interface State { count: number; setCount: (n: number) => void; } // SIGNATURE UNIQUEMENT
const useStore = create<State>()((set) => ({ count: 0, setCount: (n) => set({ count: n }) }));

2.5 — cn() : import depuis @/lib/utils UNIQUEMENT, jamais redéfini inline

2.6 — FRAMER-MOTION PROPRIÉTÉS VALIDES :
✅ whileHover={{ y: -4, scale: 1.02, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", opacity: 0.9 }}
❌ whileHover={{ shadow: "...", scale: "scale-102", opacity-50, translate-y-1 }}
Les valeurs CSS dans framer-motion sont des valeurs CSS réelles, pas des classes Tailwind.

2.7 — 'use client' obligatoire sur tout composant avec useState/useEffect/useRef/useRouter

2.8 — Route handlers : export GET/POST nommés, JAMAIS export default

2.9 — Gestion d'erreurs : try/catch sur chaque appel API, return NextResponse.json({error}, {status:500})

2.10 — Cleanup : zéro console.log, zéro TODO, JSX fermé, useEffect avec dépendances

═══════════════════════════════════════════════════════════════════
LOI 3 — DESIGN CONTRACT (reçu du Design Analyst)
═══════════════════════════════════════════════════════════════════

Le Design Contract ci-dessous est une LOI. Tu le reproduis au pixel perfect.
Chaque couleur HEX extraite = une Tailwind arbitrary value obligatoire.
Effets visuels identifiés = implémentés exactement (glassmorphism, shadows, gradients).
Typographie identifiée = Google Fonts correspondant via next/font.
Composants identifiés = reproduits fidèlement dans leur structure et apparence.

Si aucun Design Contract n'est fourni : tu crées un design ambitieux et distinctif.
Jamais de Inter/Arial/purple-gradient banals. Toujours un style fort et cohérent.

═══════════════════════════════════════════════════════════════════
LOI 4 — STRUCTURE NEXT.JS 15 OBLIGATOIRE
═══════════════════════════════════════════════════════════════════

Ordre de création :
  lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/index.ts
  → hooks/use[Feature].ts → components/ui/ → components/Modals.tsx
  → components/views/[View].tsx → app/api/[route]/route.ts → app/page.tsx

components/Modals.tsx = FICHIER UNIQUE qui contient TOUS les modals de l'app.
Chaque vue de la sidebar = son propre fichier components/views/[Name]View.tsx.
Chaque vue est UNIQUE en contenu et fonctionnalité — jamais de copier-coller.

FORMAT :
<create_file path="lib/env.ts">...</create_file>
<create_file path="lib/utils.ts">...</create_file>
...

DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // AGENT 3 — CODE VALIDATOR (COUCHE 2 — validation LLM)
  // RÈGLE FONDAMENTALE : ne modifier QUE ce qui est cassé.
  // Ne pas toucher au design. Ne pas simplifier le code.
  // Ne pas introduire de nouvelles dépendances non nécessaires.
  // ───────────────────────────────────────────────────────────────────────────
  CODE_VALIDATOR: {
    name: "Code Validator",
    icon: "🔬",
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
Tu reçois des fichiers générés. Ta mission : détecter et corriger uniquement
les erreurs qui feraient échouer npm run build.

═══════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°1 : PRIMUM NON NOCERE (D'ABORD NE PAS NUIRE)
═══════════════════════════════════════════════════════════

Tu NE dois PAS :
  ❌ Simplifier ou réécrire du code qui fonctionne
  ❌ Modifier le design, les couleurs, les animations
  ❌ Supprimer des fonctionnalités pour "nettoyer"
  ❌ Remplacer du code complexe par une version plus simple
  ❌ Ajouter des "améliorations" non demandées
  ❌ Toucher aux fichiers qui n'ont pas d'erreur

Tu DOIS uniquement :
  ✅ Corriger les erreurs TypeScript réelles
  ✅ Corriger les erreurs de syntax
  ✅ Corriger les import manquants ou invalides
  ✅ Corriger les patterns Next.js 15 incorrects

═══════════════════════════════════════════════════════════
CE QUE TU CHERCHES (uniquement ces catégories)
═══════════════════════════════════════════════════════════

CATÉGORIE A — IMPORTS INVALIDES :
  - Import d'un fichier absent du FILE SYSTEM MANIFEST
  - Export named importé comme default ou vice versa
  - Package non listé dans DEPENDENCIES

CATÉGORIE B — ERREURS TYPESCRIPT CRITIQUES :
  - Variable non déclarée utilisée
  - Type 'any' implicite sur paramètre de fonction
  - Propriété accédée sur type potentiellement undefined sans guard
  - Interface avec corps de méthode (Zustand)
  - ClassValue non importé depuis clsx

CATÉGORIE C — ERREURS NEXT.JS 15 :
  - Route handler export default au lieu de GET/POST nommés
  - Route params sans Promise<{}> et sans await
  - 'use client' manquant sur composant avec hooks
  - Metadata dans un Client Component

CATÉGORIE D — FRAMER-MOTION :
  - Propriété 'shadow' dans whileHover/animate → corriger en 'boxShadow'
  - Classe Tailwind dans animate (scale-105) → corriger en valeur numérique (scale: 1.05)
  - 'opacity-50' → 0.5 dans les propriétés animate

CATÉGORIE E — SYNTAXE CASSÉE :
  - Balises JSX non fermées
  - Accolades non fermées
  - Virgules manquantes dans objets

═══════════════════════════════════════════════════════════
FORMAT DE SORTIE
═══════════════════════════════════════════════════════════

Si tout est correct → réponds : ALL_FILES_VALID

Si des erreurs sont trouvées → liste d'abord :
ERRORS_FOUND:
- [fichier]: [erreur précise]

Puis produis UNIQUEMENT les fichiers corrigés (pas les fichiers inchangés) :
<create_file path="...">...</create_file>

DEVDEPENDENCIES: ["@types/X"] si des @types manquent
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // AGENT FIXER — Correction de bugs post-build
  // ───────────────────────────────────────────────────────────────────────────
  FIXER: {
    name: "Bug Fixer",
    icon: "🔧",
    prompt: `
Tu es un expert en débogage Next.js / TypeScript.
Cause racine uniquement. Modifications chirurgicales. Applique les Lois 2.1-2.10 du Builder.

CORRECTIONS CLASSIQUES :
  "Could not find declaration file for X"      → DEVDEPENDENCIES: ["@types/X"]
  "'handler' not exported"                     → authOptions dans lib/auth.ts
  "params is not a Promise"                    → Promise<{ id: string }> + await
  "Expected ';', got '('"                      → Corps dans interface Zustand
  "Cannot find name 'ClassValue'"              → import { cn } from "@/lib/utils"
  "shadow does not exist in TargetAndTransition" → shadow → boxShadow dans framer-motion
  "scale-105 is not assignable"                → scale: 1.05 dans framer-motion

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

    // ── Extraction couleurs côté serveur ──────────────────────────────────────
    const colorPalettePrompt = await buildColorPalettePrompt(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    // ── Compilateur virtuel (injecté dans chaque agent) ───────────────────────
    const VIRTUAL_COMPILER_RULES = `
=== 🛡️ AUTO-VÉRIFICATION AVANT CHAQUE FICHIER ===
□ Imports → FILE SYSTEM MANIFEST ou packages déclarés
□ Framer-motion → boxShadow (JAMAIS shadow), scale: 1.05 (JAMAIS scale-105), opacity: 0.5 (JAMAIS opacity-50)
□ cn() → import depuis @/lib/utils uniquement
□ NextAuth → authOptions dans lib/auth.ts, route = 3 lignes
□ Route params Next.js 15 → Promise<{...}> + await params
□ Zustand interface → signatures () => void, corps dans create()
□ 'use client' → obligatoire si hooks React utilisés
□ Route handlers → export GET/POST nommés, jamais export default
□ Env vars → lib/env.ts uniquement
□ Anti-ghosting → chaque bouton/menu/input est fonctionnel
□ Chaque vue de sidebar = fichier unique avec contenu unique
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
          const cleaned = txt.replace(/```xml/gi,"").replace(/```tsx/gi,"").replace(/```ts/gi,"").replace(/```html/gi,"").replace(/```css/gi,"").replace(/```json/gi,"").replace(/```/g,"");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);

        async function runAgent(
          agentKey: keyof typeof AGENTS,
          briefing: string,
          projectContext: string,
          options: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean } = {}
        ) {
          const { silent = false, filterXml = false, captureFiles = false } = options;
          const agent = AGENTS[agentKey];
          if (!silent) send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);

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

        try {
          // ══════════════════════════════════════════════════════════════════
          // PHASE 0 — DESIGN ANALYST (si images présentes, silencieux côté client)
          // Produit un Design Contract exhaustif avant tout code
          // ══════════════════════════════════════════════════════════════════
          let designContract = "";
          if (hasImages) {
            send(`\n\n--- 🎨 [Ultra-analyse du design...] ---\n\n`);
            designContract = await runAgent(
              "DESIGN_ANALYST",
              `Analyse toutes les images de référence reçues et produis le Design Contract exhaustif.
               Projet : "${lastUserMessage}"`,
              "",
              { silent: true } // jamais montré brut à l'utilisateur
            );
            send(`✅ Design Contract établi — ${designContract.split("\n").filter(l => l.trim()).length} points d'analyse.\n`);
          }

          // ══════════════════════════════════════════════════════════════════
          // PHASE 1 — MASTER BLUEPRINT (silencieux)
          // ══════════════════════════════════════════════════════════════════
          send(`\n\n--- 🧠 [Analyse du projet...] ---\n\n`);
          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse cette demande et produis le Blueprint complet.\nDemande : "${lastUserMessage}"`,
            "",
            { silent: true }
          );

          const classMatch = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            send(filterBlueprintXml(blueprintOutput));
            controller.close();
            return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g) ?? []).length;
          send(`✅ ${featureCount} feature${featureCount > 1 ? "s" : ""} analysée${featureCount > 1 ? "s" : ""}.\n`);

          // ══════════════════════════════════════════════════════════════════
          // FIX ACTION
          // ══════════════════════════════════════════════════════════════════
          if (decision === "FIX_ACTION") {
            const codeContext = currentProjectFiles
              ? currentProjectFiles.map((f: any) => `\n--- ${f.path} ---\n${f.content}`).join("\n")
              : "";
            await runAgent(
              "FIXER",
              `Bug : "${lastUserMessage}"`,
              `${blueprintOutput}\n\n=== CODEBASE ===\n${codeContext}`,
              { captureFiles: true }
            );
            const { files: pFixed, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const total = Object.values(report).flat().length;
            if (total > 0) {
              send(`\n✅ ${total} correction(s) automatique(s).\n`);
              for (const f of Object.keys(report)) {
                const corrected = pFixed.find(x => x.path === f);
                if (corrected) send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
              }
            }
            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ══════════════════════════════════════════════════════════════════
          // CODE ACTION — PHASE A : BUILDER
          // ══════════════════════════════════════════════════════════════════
          await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint et Design Contract reçus. Implémente CHAQUE feature.
             PREMIER FICHIER : lib/env.ts puis lib/utils.ts.
             Respecte intégralement la LOI 0 (anti-ghosting) : chaque élément UI est fonctionnel.
             Respecte le Design Contract pixel par pixel.`,
            `=== 📐 BLUEPRINT ===\n${blueprintOutput}\n\n=== 🎨 DESIGN CONTRACT ===\n${designContract}`,
            { captureFiles: true }
          );

          // ══════════════════════════════════════════════════════════════════
          // PHASE B : CORRECTEUR PROGRAMMATIQUE (Couche 1 — déterministe)
          // ══════════════════════════════════════════════════════════════════
          send(`\n\n--- 🔧 [Correcteur automatique...] ---\n\n`);
          const { files: pFixed, report: fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;

          if (totalFixes > 0) {
            send(`✅ ${totalFixes} pattern(s) corrigé(s) :\n`);
            for (const [filePath, fixes] of Object.entries(fixReport)) {
              send(`  • ${filePath}: ${fixes.join(", ")}\n`);
              const idx = allGeneratedFiles.findIndex(f => f.path === filePath);
              if (idx >= 0) allGeneratedFiles[idx] = pFixed.find(f => f.path === filePath)!;
            }
            for (const filePath of Object.keys(fixReport)) {
              const corrected = pFixed.find(f => f.path === filePath);
              if (corrected) send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
            }
          } else {
            send(`✅ Aucune correction de pattern nécessaire.\n`);
          }

          // ══════════════════════════════════════════════════════════════════
          // PHASE C : VALIDATEUR LLM (Couche 2 — sémantique)
          // Reçoit tous les fichiers, ne modifie QUE ce qui est cassé
          // ══════════════════════════════════════════════════════════════════
          send(`\n\n--- 🔬 [Validation TypeScript...] ---\n\n`);

          const filesForValidation = allGeneratedFiles
            .map(f => `\n=== ${f.path} ===\n${f.content}`)
            .join("\n");

          const validatorOutput = await runAgent(
            "CODE_VALIDATOR",
            `Valide ces ${allGeneratedFiles.length} fichiers.
             RAPPEL ABSOLU : ne modifie QUE les erreurs de build.
             Ne touche pas au design. Ne simplifie pas le code.
             Ne modifie pas les fichiers sans erreur.`,
            `=== FICHIERS À VALIDER ===\n${filesForValidation}\n\n=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles: true }
          );

          if (validatorOutput.includes("ALL_FILES_VALID")) {
            send(`✅ Validation complète — aucune erreur de build détectée.\n`);
          } else {
            const errorsSection = validatorOutput.match(/ERRORS_FOUND:([\s\S]*?)(?=<create_file|DEPENDENCIES|$)/);
            if (errorsSection) {
              const errorCount = (errorsSection[1].match(/^-\s/gm) ?? []).length;
              send(`🔧 ${errorCount} erreur(s) corrigée(s) par le validateur.\n`);
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // PHASE D : RÉSOLUTION DES PACKAGES
          // ══════════════════════════════════════════════════════════════════
          globalPackages.add("autoprefixer");
          globalPackages.add("sharp");
          globalPackages.add("clsx");
          globalPackages.add("tailwind-merge");

          const existingPkg = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps = existingPkg ? JSON.parse(existingPkg.content).dependencies ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.561.0", sharp: "0.33.5",
            clsx: "2.1.1", "tailwind-merge": "2.3.0",
            ...existingDeps,
          };

          send("\n\n--- 📦 [Résolution des packages...] ---\n");
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
          send(`\n✅ ${Object.keys(newDeps).length} packages runtime + ${Object.keys(allDevTypes).length} @types résolus.\n`);

          send("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Workflow error:", err);
          send(`\n\n⛔ ERREUR CRITIQUE: ${err.message}`);
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
