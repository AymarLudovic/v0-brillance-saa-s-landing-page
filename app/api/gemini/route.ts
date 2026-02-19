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

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

interface GeneratedFile {
  path: string;
  content: string;
}

// =============================================================================
// UTILITAIRES DE BASE
// =============================================================================

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDependenciesFromAgentOutput(output: string, key = "DEPENDENCIES"): string[] {
  const match = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (match?.[1]) {
    try {
      return JSON.parse(match[1].replace(/'/g, '"'));
    } catch {
      const manual = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      return manual ? manual.map((s) => s.replace(/"/g, "")) : [];
    }
  }
  return [];
}

// Extrait tous les <create_file> d'une sortie d'agent
function parseGeneratedFiles(output: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const regex = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    files.push({ path: match[1], content: match[2].trim() });
  }
  return files;
}

// Recompile les fichiers corrigés en format <create_file>
function serializeFiles(files: GeneratedFile[]): string {
  return files
    .map((f) => `<create_file path="${f.path}">\n${f.content}\n</create_file>`)
    .join("\n\n");
}

// =============================================================================
// ██████╗ ██████╗  ██████╗  ██████╗ ██████╗  █████╗ ███╗   ███╗███╗   ███╗ █████╗ ████████╗██╗ ██████╗
// ██╔══██╗██╔══██╗██╔═══██╗██╔════╝ ██╔══██╗██╔══██╗████╗ ████║████╗ ████║██╔══██╗╚══██╔══╝██║██╔════╝
// ██████╔╝██████╔╝██║   ██║██║  ███╗██████╔╝███████║██╔████╔██║██╔████╔██║███████║   ██║   ██║██║
// ██╔═══╝ ██╔══██╗██║   ██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║██║╚██╔╝██║██╔══██║   ██║   ██║██║
// ██║     ██║  ██║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║██║ ╚═╝ ██║██║  ██║   ██║   ██║╚██████╗
// ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝
// AUTO-FIXER — COUCHE 1 : Corrections déterministes par patterns regex
// Aucun LLM impliqué. Chaque règle est un bug connu → correction garantie.
// =============================================================================

interface FixRule {
  name: string;
  detect: (path: string, code: string) => boolean;
  fix: (path: string, code: string, allFiles: GeneratedFile[]) => string;
}

const FIX_RULES: FixRule[] = [

  // ─── RÈGLE 1 : ClassValue non importé ────────────────────────────────────
  // Erreur : Cannot find name 'ClassValue'
  {
    name: "missing-classvalue-import",
    detect: (_, code) =>
      code.includes("ClassValue") && !code.includes("from 'clsx'") && !code.includes('from "clsx"'),
    fix: (_, code) => {
      // Remplace la définition inline de cn() avec la version correcte importée
      let fixed = code.replace(
        /function cn\s*\(\s*\.\.\.\s*inputs\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g,
        ""
      );
      // Ajoute l'import clsx en haut si pas déjà là
      if (!fixed.includes("clsx") && !fixed.includes("tailwind-merge")) {
        fixed = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + fixed;
      } else if (!fixed.includes("type ClassValue")) {
        fixed = fixed.replace(
          /import\s*\{([^}]+)\}\s*from\s*["']clsx["']/,
          (m, group) => `import { ${group.trim()}, type ClassValue } from "clsx"`
        );
      }
      return fixed;
    },
  },

  // ─── RÈGLE 2 : Next.js 15 Route Params type invalide ─────────────────────
  // Erreur : Type "{ params: { id: string; }; }" is not a valid type for second argument
  // Next.js 15 : params est maintenant une Promise<{...}>
  {
    name: "nextjs15-route-params",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(code) &&
      !code.includes("Promise<{"),
    fix: (_, code) => {
      // Transforme: { params }: { params: { id: string } }
      // En:         { params }: { params: Promise<{ id: string }> }
      let fixed = code.replace(
        /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g,
        (_, typeBody) => `{ params }: { params: Promise<${typeBody}> }`
      );
      // Ajoute await params; après la signature de fonction si pas déjà là
      fixed = fixed.replace(
        /(async function (?:GET|POST|PUT|PATCH|DELETE|HEAD)[^{]*\{)\s*\n(\s*)(const\s*\{[^}]+\}\s*=\s*params)/g,
        (_, fnStart, indent, destructure) =>
          `${fnStart}\n${indent}const resolvedParams = await params;\n${indent}${destructure.replace("params", "resolvedParams")}`
      );
      // Fix plus simple: remplace `params.id` par `(await params).id` si pas d'await
      if (!fixed.includes("await params") && !fixed.includes("resolvedParams")) {
        fixed = fixed.replace(/params\.(\w+)/g, "(await params).$1");
      }
      return fixed;
    },
  },

  // ─── RÈGLE 3 : Zustand — corps de fonction dans interface ────────────────
  // Erreur : Expected ';', got '(' — méthode définie avec corps dans l'interface
  // Ex: triggerRefresh: () => set({ refreshTrigger: Math.random() });
  {
    name: "zustand-interface-method-body",
    detect: (path, code) =>
      (path.includes("store") || code.includes("create<")) &&
      /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(code),
    fix: (_, code) => {
      // Dans l'interface/type, remplace les corps de méthode par la signature
      // triggerRefresh: () => set({...}); → triggerRefresh: () => void;
      return code.replace(
        /(interface\s+\w+[\s\S]*?\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^)]*\)\s*;)/g,
        (fullMatch, interfaceStart, methodWithBody) => {
          const methodName = methodWithBody.match(/^(\w+)/)?.[1] ?? "method";
          return `${interfaceStart}${methodName}: () => void;`;
        }
      );
    },
  },

  // ─── RÈGLE 4 : 'use client' manquant sur composants avec hooks ───────────
  // Erreur : You're importing a component that needs useState/useEffect (etc.)
  {
    name: "missing-use-client",
    detect: (path, code) => {
      const isComponent = path.endsWith(".tsx") && !path.includes("app/api") && !path.includes("layout.tsx") && !path.includes("page.tsx");
      const usesClientHooks = /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams)\b/.test(code);
      const hasUseClient = code.trimStart().startsWith('"use client"') || code.trimStart().startsWith("'use client'");
      return isComponent && usesClientHooks && !hasUseClient;
    },
    fix: (_, code) => `"use client";\n\n${code}`,
  },

  // ─── RÈGLE 5 : Export default dans route handler ──────────────────────────
  // Erreur : Route handlers must export named functions (GET, POST, etc.)
  {
    name: "route-handler-default-export",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /export\s+default\s+(?:async\s+)?function/.test(code) &&
      !code.includes("export { handler as GET"),
    fix: (_, code) => {
      // Transforme export default function handler() en export async function GET/POST
      return code.replace(
        /export\s+default\s+async\s+function\s+handler\s*\(([^)]*)\)/g,
        "export async function POST($1)"
      ).replace(
        /export\s+default\s+function\s+handler\s*\(([^)]*)\)/g,
        "export async function POST($1)"
      );
    },
  },

  // ─── RÈGLE 6 : Import React manquant dans fichiers TSX ───────────────────
  // Certaines configs strict requièrent l'import React explicite
  {
    name: "missing-react-import",
    detect: (path, code) =>
      path.endsWith(".tsx") &&
      /<[A-Z]|jsx|<div|<span|<p |<h[1-6]/.test(code) &&
      !code.includes("from 'react'") &&
      !code.includes('from "react"') &&
      !code.includes("from 'next/"),
    fix: (_, code) => {
      if (code.includes("from 'react'") || code.includes('from "react"')) return code;
      // Vérifie si des hooks spécifiques sont utilisés
      const hooks = ["useState", "useEffect", "useRef", "useCallback", "useMemo", "useContext", "useReducer", "Suspense", "createContext", "forwardRef"].filter(
        (h) => code.includes(h)
      );
      if (hooks.length === 0) return code;
      const importLine = `import { ${hooks.join(", ")} } from "react";`;
      // Ajoute après 'use client' si présent, sinon en haut
      if (code.includes('"use client"') || code.includes("'use client'")) {
        return code.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${importLine}\n`);
      }
      return `${importLine}\n${code}`;
    },
  },

  // ─── RÈGLE 7 : process.env utilisé directement (hors lib/env.ts) ─────────
  // Avertissement/erreur selon config : env vars non typées
  {
    name: "direct-process-env",
    detect: (path, code) =>
      !path.includes("lib/env") &&
      !path.includes("next.config") &&
      /process\.env\.[A-Z_]+/.test(code) &&
      code.includes("process.env.") &&
      !code.includes("// @env-ok"),
    fix: (_, code, allFiles) => {
      // Vérifie si lib/env.ts existe dans les fichiers générés
      const envFileExists = allFiles.some((f) => f.path.includes("lib/env"));
      if (!envFileExists) return code; // Pas de substitution si env.ts pas encore créé
      // Substitution conservative : on ne change que les patterns simples
      // (les cas complexes sont laissés au validateur LLM)
      return code; // Laissé au CODE_VALIDATOR pour ce cas
    },
  },

  // ─── RÈGLE 8 : Syntaxe async/await mal formée ────────────────────────────
  // Erreur : await outside async function
  {
    name: "await-outside-async",
    detect: (_, code) => {
      const awaitMatches = code.match(/\bawait\b/g) ?? [];
      const asyncMatches = code.match(/\basync\b/g) ?? [];
      return awaitMatches.length > asyncMatches.length;
    },
    fix: (_, code) => {
      // Transforme les fonctions qui utilisent await mais ne sont pas async
      return code.replace(
        /\b(function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\bawait\b)/g,
        (match) => {
          if (!match.startsWith("async")) return "async " + match;
          return match;
        }
      ).replace(
        /\b(const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\bawait\b)/g,
        (match) => {
          if (!match.includes("async")) return match.replace("const ", "const ").replace("= (", "= async (");
          return match;
        }
      );
    },
  },

  // ─── RÈGLE 9 : twMerge/clsx importés mais cn() pas définie ──────────────
  {
    name: "missing-cn-function",
    detect: (_, code) =>
      code.includes("cn(") &&
      !code.includes("function cn") &&
      !code.includes("const cn") &&
      !code.includes("from '@/lib/utils'") &&
      !code.includes('from "@/lib/utils"'),
    fix: (_, code) => {
      // Ajoute l'import depuis lib/utils (pattern shadcn standard)
      const importLine = `import { cn } from "@/lib/utils";`;
      if (code.includes('"use client"') || code.includes("'use client'")) {
        return code.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${importLine}\n`);
      }
      return `${importLine}\n${code}`;
    },
  },

  // ─── RÈGLE 10 : Params Next.js destructuré avant await ───────────────────
  // Erreur : params accessed before async resolution in Next.js 15
  {
    name: "nextjs15-params-sync-access",
    detect: (path, code) =>
      path.includes("route.ts") &&
      /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(code) &&
      !code.includes("await params") &&
      code.includes("Promise<{"),
    fix: (_, code) => {
      return code.replace(
        /const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g,
        "const $1 = await params"
      );
    },
  },

  // ─── RÈGLE 11 : Imports de types sans 'type' keyword ─────────────────────
  // Erreur TS : isolatedModules — type imports doivent utiliser 'import type'
  {
    name: "missing-type-keyword-imports",
    detect: (_, code) =>
      /import\s*\{[^}]*(?:FC|ReactNode|CSSProperties|MouseEvent|KeyboardEvent|ChangeEvent|FormEvent|RefObject|MutableRefObject|Dispatch|SetStateAction|ComponentProps|ComponentPropsWithoutRef|HTMLAttributes|ButtonHTMLAttributes|InputHTMLAttributes|TextareaHTMLAttributes|DivHTMLAttributes)[^}]*\}\s*from\s*["']react["']/.test(code) &&
      !/import\s+type/.test(code),
    fix: (_, code) => {
      const typeOnlyExports = [
        "FC", "ReactNode", "CSSProperties", "MouseEvent", "KeyboardEvent",
        "ChangeEvent", "FormEvent", "RefObject", "MutableRefObject",
        "Dispatch", "SetStateAction", "ComponentProps", "ComponentPropsWithoutRef",
        "HTMLAttributes", "ButtonHTMLAttributes", "InputHTMLAttributes",
      ];
      // Sépare les imports de valeurs et de types pour React
      return code.replace(
        /import\s*\{([^}]+)\}\s*from\s*["']react["']/g,
        (_, imports) => {
          const importList = imports.split(",").map((s: string) => s.trim()).filter(Boolean);
          const typeImports = importList.filter((i: string) => typeOnlyExports.includes(i.replace(/\s+as\s+\w+/, "").trim()));
          const valueImports = importList.filter((i: string) => !typeOnlyExports.includes(i.replace(/\s+as\s+\w+/, "").trim()));
          const lines: string[] = [];
          if (valueImports.length > 0) lines.push(`import { ${valueImports.join(", ")} } from "react"`);
          if (typeImports.length > 0) lines.push(`import type { ${typeImports.join(", ")} } from "react"`);
          return lines.join(";\n");
        }
      );
    },
  },

  // ─── RÈGLE 12 : Metadata exportée dans composant 'use client' ────────────
  // Erreur : Metadata cannot be exported from a Client Component
  {
    name: "metadata-in-client-component",
    detect: (_, code) =>
      (code.includes('"use client"') || code.includes("'use client'")) &&
      code.includes("export const metadata"),
    fix: (_, code) => {
      // Supprime l'export metadata du client component — doit être dans un layout/page server
      return code.replace(/export\s+const\s+metadata\s*=[\s\S]*?(?=\n(?:export|function|const|class|interface|type))/g, "");
    },
  },
];

// Applique toutes les règles de correction sur un fichier
function applyProgrammaticFixes(
  file: GeneratedFile,
  allFiles: GeneratedFile[]
): { file: GeneratedFile; fixes: string[] } {
  let { path, content } = file;
  const appliedFixes: string[] = [];

  for (const rule of FIX_RULES) {
    try {
      if (rule.detect(path, content)) {
        const fixed = rule.fix(path, content, allFiles);
        if (fixed !== content) {
          content = fixed;
          appliedFixes.push(rule.name);
        }
      }
    } catch {
      // Règle échouée → on skip sans crasher
    }
  }

  // Passe multiple si certaines corrections ouvrent de nouvelles détections
  let hasMoreFixes = true;
  let iterations = 0;
  while (hasMoreFixes && iterations < 3) {
    hasMoreFixes = false;
    iterations++;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content, allFiles);
          if (fixed !== content) {
            content = fixed;
            appliedFixes.push(`${rule.name}[pass${iterations + 1}]`);
            hasMoreFixes = true;
          }
        }
      } catch {}
    }
  }

  return { file: { path, content }, fixes: appliedFixes };
}

// Applique les corrections sur tous les fichiers générés
function runProgrammaticAutoFixer(files: GeneratedFile[]): {
  files: GeneratedFile[];
  report: Record<string, string[]>;
} {
  const report: Record<string, string[]> = {};
  const fixedFiles = files.map((file) => {
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

async function extractColorsFromBase64(base64Image: string) {
  try {
    const buffer = Buffer.from(cleanBase64Data(base64Image), "base64");
    const { data, info } = await sharp(buffer)
      .resize(120, 120, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const colorCounts: Record<string, number> = {};
    const step = info.channels * 8;
    for (let i = 0; i < data.length; i += step) {
      const r = Math.round(data[i] / 24) * 24;
      const g = Math.round(data[i + 1] / 24) * 24;
      const b = Math.round(data[i + 2] / 24) * 24;
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      colorCounts[hex] = (colorCounts[hex] || 0) + 1;
    }

    const sorted = Object.entries(colorCounts).sort(([, a], [, b]) => b - a).map(([c]) => c);
    const bg = sorted[0] ?? "#ffffff";
    return {
      dominantColors: sorted.slice(0, 2),
      backgroundColor: bg,
      textColor: isColorLight(bg) ? "#0f0f0f" : "#f5f5f5",
      accentColors: sorted.slice(2, 5),
    };
  } catch {
    return { dominantColors: [], backgroundColor: "#ffffff", textColor: "#000000", accentColors: [] };
  }
}

async function buildDesignStylePrompt(
  uploadedImages: string[],
  allReferenceImages: string[]
): Promise<string> {
  const allImages = [...(allReferenceImages ?? []), ...(uploadedImages ?? [])];
  if (allImages.length === 0) {
    return `
=== 🎨 DESIGN (MODE CRÉATIF LIBRE) ===
Aucune image de référence. Style libre — choisis une direction distincte et mémorable.
Évite l'Inter/Arial/purple-gradient générique. Varie dark/light, typographies fortes.
`;
  }

  const palettes = await Promise.all(allImages.slice(0, 3).map(extractColorsFromBase64));
  const merged = palettes[0];
  const allAccents = palettes.flatMap((p) => [...p.dominantColors, ...p.accentColors])
    .filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 6);

  return `
=== 🎨 SYSTÈME DE DESIGN (EXTRACTION PIXEL SERVEUR) ===
Palette extraite pixel par pixel — utilise ces codes HEX via Tailwind arbitrary values.

  Fond principal    : ${merged.backgroundColor}  → bg-[${merged.backgroundColor}]
  Texte principal   : ${merged.textColor}         → text-[${merged.textColor}]
  Primaire          : ${merged.dominantColors[0] ?? "dériver de l'analyse"}
  Secondaire        : ${merged.dominantColors[1] ?? "dériver de l'analyse"}
  Accents           : ${allAccents.join(", ")}

STYLE À TRANSPOSER (présente-le comme ton choix créatif — ne mentionne jamais "images de référence") :
  1. Composition/grilles, espacements, hiérarchie visuelle
  2. Effets de surface : glassmorphism, gradients, ombres, textures
  3. Typographie : style, poids, contrastes
  4. Micro-interactions : hover, transitions, animations d'entrée
  5. Adapte ce style au type d'interface demandé (dashboard, landing, app)
`;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set([
  "next","react","react-dom","typescript","sharp",
  "stripe","openai","@anthropic-ai/sdk","@google/genai",
  "next-auth","@clerk/nextjs","drizzle-orm","prisma",
  "ioredis","@upstash/redis","@vercel/postgres",
  "zod","zustand","swr","@tanstack/react-query","@tanstack/react-table",
  "lucide-react","framer-motion","motion","tailwindcss",
  "resend","axios","socket.io","socket.io-client",
  "lightweight-charts","recharts","chart.js","react-chartjs-2","d3",
  "wavesurfer.js","tone","react-player","react-hook-form",
  "@aws-sdk/client-s3","@aws-sdk/lib-storage",
  "pusher","pusher-js","twilio",
  "replicate","langchain","@pinecone-database/pinecone",
  "react-leaflet","@vis.gl/react-google-maps",
  "@googlemaps/google-maps-services-js",
  "finnhub","finnhub-node","yahoo-finance2",
  "@alpacahq/alpaca-trade-api","playwright",
  "date-fns","dayjs","luxon","clsx","tailwind-merge",
  "@react-pdf/renderer","pdf-lib","exceljs",
  "@react-email/components","react-email","jose","bcryptjs",
]);

const TYPES_MAP: Record<string, string> = {
  howler: "@types/howler",
  leaflet: "@types/leaflet",
  express: "@types/express",
  cors: "@types/cors",
  bcrypt: "@types/bcrypt",
  multer: "@types/multer",
  passport: "@types/passport",
  "passport-local": "@types/passport-local",
  "passport-jwt": "@types/passport-jwt",
  lodash: "@types/lodash",
  uuid: "@types/uuid",
  nodemailer: "@types/nodemailer",
  "body-parser": "@types/body-parser",
  morgan: "@types/morgan",
  "cookie-parser": "@types/cookie-parser",
  pg: "@types/pg",
  "better-sqlite3": "@types/better-sqlite3",
  "connect-redis": "@types/connect-redis",
  "express-session": "@types/express-session",
  jsonwebtoken: "@types/jsonwebtoken",
  "sanitize-html": "@types/sanitize-html",
  "markdown-it": "@types/markdown-it",
  "js-cookie": "@types/js-cookie",
  "js-yaml": "@types/js-yaml",
  "node-cron": "@types/node-cron",
  "node-fetch": "@types/node-fetch",
  "react-beautiful-dnd": "@types/react-beautiful-dnd",
  "react-transition-group": "@types/react-transition-group",
  "react-datepicker": "@types/react-datepicker",
  "react-modal": "@types/react-modal",
  "react-slick": "@types/react-slick",
  "slick-carousel": "@types/slick-carousel",
  "react-color": "@types/react-color",
  "react-helmet": "@types/react-helmet",
  "spotify-web-api-node": "@types/spotify-web-api-node",
  "node-geocoder": "@types/node-geocoder",
  formidable: "@types/formidable",
  busboy: "@types/busboy",
  archiver: "@types/archiver",
  multer: "@types/multer",
  "cookie-parser": "@types/cookie-parser",
};

async function resolveTypesPackages(
  packages: string[],
  existingDevDeps: Record<string, string>
): Promise<Record<string, string>> {
  const typesNeeded: Record<string, string> = {};
  await Promise.all(
    packages.map(async (pkg) => {
      if (!pkg || BUNDLED_TYPES.has(pkg)) return;
      if (TYPES_MAP[pkg]) {
        const tp = TYPES_MAP[pkg];
        if (!existingDevDeps[tp]) {
          try { const d = await packageJson(tp); typesNeeded[tp] = d.version as string; }
          catch { typesNeeded[tp] = "latest"; }
        }
        return;
      }
      const cleanPkg = pkg.startsWith("@") ? pkg.split("/")[1] : pkg;
      const tp = `@types/${cleanPkg}`;
      if (!existingDevDeps[tp]) {
        try { const d = await packageJson(tp); typesNeeded[tp] = d.version as string; }
        catch {}
      }
    })
  );
  return typesNeeded;
}

// =============================================================================
// XML BLUEPRINT FILTER
// =============================================================================

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
// FUNCTION DECLARATIONS
// =============================================================================

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture d'un fichier existant du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// =============================================================================
// AGENTS
// =============================================================================

const AGENTS = {

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT 1 — MASTER BLUEPRINT
  // ─────────────────────────────────────────────────────────────────────────
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
  <real_implementation>Méthode exacte d'implémentation avec SDK/endpoint précis</real_implementation>
  <forbidden>Ce que le Builder NE doit PAS faire (simuler, hardcoder, etc.)</forbidden>
  <typescript_requirements>@types requis, patterns TS spécifiques</typescript_requirements>
  <architecture_patterns>
    Patterns obligatoires pour éviter erreurs :
    - NextAuth : authOptions dans lib/auth.ts UNIQUEMENT
    - Next.js 15 route params : toujours Promise<{id:string}> avec await params
    - Route handlers : export named GET/POST uniquement, jamais export default
    - Zustand interfaces : signature uniquement (), jamais corps de méthode
    - cn() : toujours importé depuis @/lib/utils, jamais redéfini inline
    - Env vars : toujours via lib/env.ts, jamais process.env directement
    - 'use client' : obligatoire si useState/useEffect/useRef utilisés
  </architecture_patterns>
  <files_to_create>liste des fichiers</files_to_create>
</feature>

MAPPING SERVICES RÉELS :
  Charts trading         → lightweight-charts
  Prix live              → finnhub-node (WebSocket wss://ws.finnhub.io)
  Indicateurs            → technicalindicators
  Ordres                 → @alpacahq/alpaca-trade-api
  Audio                  → howler [nécessite @types/howler]
  Spotify                → spotify-web-api-node [nécessite @types/spotify-web-api-node]
  Maps gratuite          → react-leaflet + leaflet [nécessite @types/leaflet]
  Chat IA streaming      → openai ou @anthropic-ai/sdk
  Paiements              → stripe
  Auth OAuth             → next-auth
  Auth simple            → @clerk/nextjs
  Real-time              → socket.io + socket.io-client
  Emails                 → resend
  DB PostgreSQL          → drizzle-orm + @vercel/postgres
  Upload S3              → @aws-sdk/client-s3
  Contrôle PC            → @nut-tree/nut-js

<env_file_required>
# Variables d'environnement requises
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=générer avec openssl rand -base64 32
</env_file_required>

<build_order>F01, F02, ...</build_order>
DEPENDENCIES: ["package1", "package2"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT 2 — FULL STACK BUILDER
  // ─────────────────────────────────────────────────────────────────────────
  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    icon: "⚡",
    prompt: `
Tu es un Développeur Full Stack Senior, Next.js 15 App Router, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint. C'est la LOI.

════════ LOI 1 : REAL IMPLEMENTATION ONLY ════════
✅ stripe.paymentIntents.create({...})
✅ new Howl({ src: [url], html5: true })
✅ openai.chat.completions.create({ stream: true })
❌ setTimeout(() => setData(fakeData), 800)
❌ Math.random() pour simuler des données
❌ Arrays hardcodées de données fictives
❌ Divs grises à la place de vraies maps

════════ LOI 2 : TYPESCRIPT STRICT (zéro erreur de build) ════════

2.1 — lib/env.ts TOUJOURS EN PREMIER :
const req = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing: " + k); return v; };
export const env = { stripeKey: req("STRIPE_SECRET_KEY"), ... } as const;
→ Importe TOUJOURS depuis @/lib/env, jamais process.env directement.

2.2 — NEXTAUTH PATTERN OBLIGATOIRE :
// lib/auth.ts — authOptions ICI seulement
export const authOptions: NextAuthOptions = { ... };
// app/api/auth/[...nextauth]/route.ts — SEULEMENT CES 3 LIGNES :
import NextAuth from "next-auth"; import { authOptions } from "@/lib/auth";
const handler = NextAuth(authOptions); export { handler as GET, handler as POST };

2.3 — NEXT.JS 15 ROUTE PARAMS — PATTERN OBLIGATOIRE :
// TOUJOURS avec Promise<{...}> ET await :
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // await obligatoire
  ...
}

2.4 — ZUSTAND STORE — RÈGLE INTERFACE :
// Dans l'interface : signature uniquement, JAMAIS de corps de fonction
interface AppState {
  count: number;
  setCount: (n: number) => void;          // ✅ signature
  reset: () => void;                       // ✅ signature
  // reset: () => set({ count: 0 });      // ❌ INTERDIT dans interface
}
// Le corps va dans le create() :
export const useStore = create<AppState>()((set) => ({
  count: 0,
  setCount: (n) => set({ count: n }),
  reset: () => set({ count: 0 }),         // ✅ corps ici
}));

2.5 — cn() — PATTERN UNIQUE :
// lib/utils.ts — définition unique
import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
// Partout ailleurs : import { cn } from "@/lib/utils"; — JAMAIS redéfini inline

2.6 — 'use client' :
Obligatoire en première ligne si : useState / useEffect / useRef / useCallback /
useMemo / useContext / useRouter / usePathname / useSearchParams sont utilisés.

2.7 — EXPORTS ROUTE HANDLERS :
export async function GET(req: Request) { ... }    ✅
export async function POST(req: Request) { ... }   ✅
export default async function handler() { ... }    ❌ INTERDIT

2.8 — EXPORTS COHÉRENTS :
export const foo → import { foo }     ✅
export default foo → import foo        ✅
NE MÉLANGE JAMAIS les deux pour le même symbol.

2.9 — GESTION D'ERREURS COMPLÈTE :
try { ... } catch (error) {
  const message = error instanceof Error ? error.message : "Erreur inconnue";
  return NextResponse.json({ error: message }, { status: 500 });
}

2.10 — CLEANUP :
Zéro console.log. Zéro TODO. JSX fermé. useEffect avec dépendances.

════════ LOI 3 : DESIGN ════════
Applique la palette extraite des images via bg-[#HEX] text-[#HEX].
Typographie distinctive (jamais Arial/Inter par défaut).
Effets élaborés : glassmorphism, gradients, micro-interactions.

════════ LOI 4 : STRUCTURE NEXT.JS 15 ════════
lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/ → hooks/ → components/ → app/

FORMAT :
<create_file path="lib/env.ts">...</create_file>
<create_file path="lib/utils.ts">...</create_file>
(dans l'ordre logique)

DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT 3 — CODE VALIDATOR (COUCHE 2 : validation LLM post-génération)
  // Reçoit TOUS les fichiers générés + le rapport du correcteur programmatique
  // Produit uniquement les fichiers qui ont encore des erreurs
  // ─────────────────────────────────────────────────────────────────────────
  CODE_VALIDATOR: {
    name: "Code Validator",
    icon: "🔬",
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
Tu reçois une liste de fichiers générés par le Builder.
Ton unique mission : détecter et corriger les erreurs qui feraient échouer npm run build.

════════ CE QUE TU CHERCHES ════════

1. IMPORTS INVALIDES
   - Import d'un fichier absent du FILE SYSTEM MANIFEST
   - Import nommé d'un symbol exporté en default (ou inverse)
   - Import d'un package non listé dans DEPENDENCIES
   - Type importé sans le mot-clé 'type' (mode isolatedModules)

2. ERREURS TYPESCRIPT
   - Variable utilisée avant déclaration
   - Type 'any' implicite (paramètre sans type)
   - Propriété accédée sur type potentiellement undefined sans vérification
   - Return type manquant sur fonction async exportée
   - Interface avec corps de méthode (Zustand store pattern)

3. ERREURS NEXT.JS 15
   - Route handler avec export default au lieu de export { GET, POST }
   - Route params non awaité : { params: { id } } sans Promise<> ni await
   - 'use client' manquant sur composant avec hooks
   - Metadata exportée depuis un Client Component
   - Server-only code importé dans un Client Component

4. ERREURS DE SYNTAXE
   - Balises JSX non fermées
   - Virgules manquantes ou en trop dans des objets/arrays
   - Accolades non fermées

════════ RÈGLES DE CORRECTION ════════

- Ne réécris QUE les fichiers qui ont des erreurs réelles.
- Ne change PAS ce qui fonctionne. Modifications chirurgicales uniquement.
- Pour chaque correction, applique les mêmes patterns que le Builder (Lois 2.1-2.10).
- Si un import pointe vers un fichier absent → crée le fichier minimal qui l'exporte.
- Si un @types manque → ajoute-le dans DEVDEPENDENCIES.

════════ FORMAT DE SORTIE ════════

Si tout est correct → réponds uniquement : ALL_FILES_VALID

Si des erreurs sont trouvées → liste-les d'abord :
ERRORS_FOUND:
- components/Foo.tsx: Import 'Bar' absent du manifest
- lib/store.ts: Interface method body (Zustand)
- app/api/test/route.ts: params non awaité

Puis produis uniquement les fichiers corrigés :
<create_file path="components/Foo.tsx">...</create_file>

DEPENDENCIES: [] // si nouveaux packages requis
DEVDEPENDENCIES: ["@types/X"] // si @types manquants
    `,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT FIXER — Correction de bugs post-build
  // ─────────────────────────────────────────────────────────────────────────
  FIXER: {
    name: "Bug Fixer",
    icon: "🔧",
    prompt: `
Tu es un expert en débogage Next.js / TypeScript.
Tu reçois une codebase complète et un rapport de bug précis.

PROTOCOLE CHIRURGICAL :
1. Lis TOUS les fichiers avant de modifier quoi que ce soit.
2. Identifie la CAUSE RACINE, pas les symptômes.
3. Modifie SEULEMENT les fichiers impactés.
4. Applique toutes les règles TypeScript du Builder (Lois 2.1-2.10).

CORRECTIONS CLASSIQUES :
  "Could not find declaration file for X"       → DEVDEPENDENCIES: ["@types/X"]
  "'handler' not exported from nextauth route"  → Déplacer authOptions dans lib/auth.ts
  "params is not a Promise"                     → { params }: { params: Promise<{ id: string }> }
  "export mismatch"                             → Aligner named vs default
  "Expected ';', got '('"                       → Corps de méthode dans interface Zustand
  "Cannot find name 'ClassValue'"              → import { cn } from "@/lib/utils"

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
    const apiKey =
      authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey)
      return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const {
      history,
      uploadedImages,
      allReferenceImages,
      currentProjectFiles,
    } = body;

    const lastUserMessage =
      history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    const designStylePrompt = await buildDesignStylePrompt(
      uploadedImages ?? [],
      allReferenceImages ?? []
    );

    const VIRTUAL_COMPILER_RULES = `
=== 🛡️ AUTO-VÉRIFICATION OBLIGATOIRE AVANT CHAQUE FICHIER ===
□ Imports → tous dans FILE SYSTEM MANIFEST ou packages déclarés
□ ClassValue → import depuis clsx, jamais redéfini inline
□ cn() → import depuis @/lib/utils uniquement
□ NextAuth → authOptions dans lib/auth.ts, route = 3 lignes seulement
□ Route params Next.js 15 → Promise<{...}> + await params
□ Zustand interface → signatures () => void, corps dans create()
□ 'use client' → présent si useState/useEffect/useRef utilisés
□ Route handlers → export named GET/POST, jamais export default
□ Exports → named↔named, default↔default, jamais mixé
□ Env vars → lib/env.ts uniquement, jamais process.env direct
□ try/catch → chaque appel API externe
□ Cleanup → zéro console.log, zéro TODO, JSX fermé
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) {
      currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    }

    // Stockage de tous les fichiers générés pour le validateur
    const allGeneratedFiles: GeneratedFile[] = [];

    const buildFullHistory = (extraContext = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      if (allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[RÉFÉRENCES VISUELLES]" }] });
      }

      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          parts.push({ text: "\n[IMAGES UPLOADÉES]" });
        }
        contents.push({ role, parts });
      });

      if (extraContext) {
        contents.push({
          role: "user",
          parts: [{ text: `\n\n=== 🧠 MÉMOIRE DU PROJET ===\n${extraContext}` }],
        });
      }
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          const cleaned = txt
            .replace(/```xml/gi, "").replace(/```tsx/gi, "").replace(/```ts/gi, "")
            .replace(/```html/gi, "").replace(/```css/gi, "").replace(/```json/gi, "")
            .replace(/```/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send = (txt: string, filterXml = false) => {
          sendRaw(filterXml ? filterBlueprintXml(txt) : txt);
        };

        const globalPackages: Set<string> = new Set();
        const globalDevPackages: Set<string> = new Set();

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
            const fileManifest =
              createdFilePaths.size > 0
                ? `FILES CURRENTLY EXIST:\n${Array.from(createdFilePaths).join("\n")}`
                : "NO FILES CREATED YET.";

            contents.push({
              role: "user",
              parts: [{
                text: `
=== MISSION : ${agent.name} ===
${briefing}

=== 📂 FILE SYSTEM MANIFEST ===
${fileManifest}

${designStylePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code ...
</create_file>
                `,
              }],
            });

            const temperature =
              agentKey === "MASTER_BLUEPRINT" ? 0.1
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

            // Mise à jour du manifeste de fichiers
            for (const m of fullOutput.matchAll(/<create_file path="(.*?)">/g)) {
              if (m[1]) createdFilePaths.add(m[1]);
            }

            // Capture des fichiers générés pour le validateur
            if (captureFiles) {
              const newFiles = parseGeneratedFiles(fullOutput);
              for (const f of newFiles) {
                const idx = allGeneratedFiles.findIndex((g) => g.path === f.path);
                if (idx >= 0) allGeneratedFiles[idx] = f; // update
                else allGeneratedFiles.push(f);
              }
            }

            extractDependenciesFromAgentOutput(fullOutput, "DEPENDENCIES")
              .forEach((d) => globalPackages.add(d));
            extractDependenciesFromAgentOutput(fullOutput, "DEVDEPENDENCIES")
              .forEach((d) => globalDevPackages.add(d));

            return fullOutput;
          } catch (e: any) {
            console.error(`Agent ${agent.name} error:`, e);
            if (!silent) send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        try {
          // ════════════════════════════════════════════════════════════════
          // PHASE 1 — MASTER BLUEPRINT (silencieux)
          // ════════════════════════════════════════════════════════════════
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

          // ════════════════════════════════════════════════════════════════
          // PHASE FIX ACTION
          // ════════════════════════════════════════════════════════════════
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

            // Applique le correcteur programmatique même sur les fixes
            const { files: fixedFiles, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const fixCount = Object.values(report).flat().length;
            if (fixCount > 0) {
              send(`\n✅ ${fixCount} correction(s) automatique(s) appliquée(s).\n`);
              for (const f of fixedFiles) {
                const original = allGeneratedFiles.find((g) => g.path === f.path);
                if (original && original.content !== f.content) {
                  send(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                }
              }
            }

            const autoTypes = await resolveTypesPackages(Array.from(globalPackages), {});
            Object.keys(autoTypes).forEach((t) => globalDevPackages.add(t));

            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ════════════════════════════════════════════════════════════════
          // PHASE CODE ACTION
          // ════════════════════════════════════════════════════════════════

          // ÉTAPE A — Builder génère le code (capturé + streamé)
          const builderOutput = await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint reçu. Implémente CHAQUE feature.
             PREMIER FICHIER OBLIGATOIRE : lib/env.ts puis lib/utils.ts.
             Zéro simulation. Zéro placeholder.`,
            `=== 📐 BLUEPRINT (LOI ABSOLUE) ===\n${blueprintOutput}`,
            { captureFiles: true }
          );

          // ÉTAPE B — COUCHE 1 : Correcteur programmatique (déterministe, sans LLM)
          send(`\n\n--- 🔧 [Correcteur automatique...] ---\n\n`);
          const { files: programmaticallyFixed, report: fixReport } =
            runProgrammaticAutoFixer(allGeneratedFiles);

          const totalProgrammaticFixes = Object.values(fixReport).flat().length;
          if (totalProgrammaticFixes > 0) {
            send(`✅ ${totalProgrammaticFixes} correction(s) de pattern appliquée(s) :\n`);
            for (const [filePath, fixes] of Object.entries(fixReport)) {
              send(`  • ${filePath}: ${fixes.join(", ")}\n`);
              // Met à jour le fichier dans allGeneratedFiles
              const idx = allGeneratedFiles.findIndex((f) => f.path === filePath);
              if (idx >= 0) allGeneratedFiles[idx] = programmaticallyFixed.find((f) => f.path === filePath)!;
            }
            // Re-stream les fichiers corrigés
            for (const fix of Object.keys(fixReport)) {
              const corrected = programmaticallyFixed.find((f) => f.path === fix);
              if (corrected) {
                send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
              }
            }
          } else {
            send(`✅ Aucune correction de pattern nécessaire.\n`);
          }

          // ÉTAPE C — COUCHE 2 : Validateur LLM (détection sémantique)
          send(`\n\n--- 🔬 [Validation TypeScript & Next.js 15...] ---\n\n`);

          // On construit le contexte de validation avec tous les fichiers générés + corrigés
          const filesForValidation = allGeneratedFiles
            .map((f) => `\n=== FICHIER: ${f.path} ===\n${f.content}`)
            .join("\n");

          const validatorOutput = await runAgent(
            "CODE_VALIDATOR",
            `Analyse ces fichiers et corrige toutes les erreurs qui feraient échouer npm run build.
             Tu reçois ${allGeneratedFiles.length} fichiers à valider.`,
            `=== FICHIERS GÉNÉRÉS À VALIDER ===\n${filesForValidation}\n\n=== BLUEPRINT ORIGINAL ===\n${blueprintOutput}`,
            { captureFiles: true }
          );

          if (validatorOutput.includes("ALL_FILES_VALID")) {
            send(`✅ Tous les fichiers sont valides — aucune erreur détectée.\n`);
          } else {
            const errorsMatch = validatorOutput.match(/ERRORS_FOUND:([\s\S]*?)(?=\n<create_file|$)/);
            if (errorsMatch) {
              send(`🔧 Corrections appliquées par le validateur.\n`);
            }
          }

          // ════════════════════════════════════════════════════════════════
          // PHASE 4 — RÉSOLUTION DES PACKAGES
          // ════════════════════════════════════════════════════════════════
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

          send("\n\n--- 📦 [Résolution des packages + @types...] ---\n");

          const newDeps: Record<string, string> = {};
          await Promise.all(
            Array.from(globalPackages).map(async (pkg) => {
              if (!pkg || baseDeps[pkg]) return;
              try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
              catch { newDeps[pkg] = "latest"; }
            })
          );

          const autoTypesDeps = await resolveTypesPackages(
            Array.from(globalPackages),
            existingDevDeps
          );

          const allDevTypes: Record<string, string> = { ...autoTypesDeps };
          await Promise.all(
            Array.from(globalDevPackages).map(async (pkg) => {
              if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
              try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
              catch { allDevTypes[pkg] = "latest"; }
            })
          );

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
