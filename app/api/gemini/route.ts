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
  // ── "use client" manquant — hooks React ───────────────────────────────────
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
  // ── "use client" manquant — store Zustand ─────────────────────────────────
  {
    name: "use-client-zustand",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /use[A-Z]\w*Store\b/.test(c)
      && !c.includes('"use client"') && !c.includes("'use client'"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ZUSTAND — les deux erreurs les plus fréquentes
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Zustand create() body : `: () => void;` → implémentation réelle ───────
  // Erreur : setSelectedSymbol: () => void;  dans le corps du create()
  // Cause  : le LLM mélange interface TS et objet littéral JS
  {
    name: "zustand-void-in-create-body",
    detect: (p, c) => p.endsWith(".ts") && c.includes("create<")
      // Présence de `: () => void;` HORS d'un bloc `interface`
      && (() => {
        // Retire les blocs interface pour ne tester que le reste
        const withoutInterfaces = c.replace(/interface\s+\w+[\s\S]*?\n\}/g, "");
        return /\w+\s*:\s*\(\s*\)\s*=>\s*void\s*;/.test(withoutInterfaces);
      })(),
    fix: (p, c) => {
      // Dans le corps du create(), convertit `method: () => void;` en implémentation
      // On détecte le contenu entre create<X>()((set, get) => ({ ... }))
      // et on remplace les `: () => void;` par des vraies fonctions
      return c.replace(
        /(\w+)\s*:\s*\(([^)]*)\)\s*=>\s*void\s*;(\s*(?:\/\/[^\n]*)?\n)/g,
        (match, name, params, trail) => {
          // Génère une implémentation minimale valide basée sur le nom de la méthode
          const paramList = params.trim();
          if (name.startsWith("set") || name.startsWith("update") || name.startsWith("toggle")) {
            // Méthodes de mutation → set({})
            if (paramList) {
              const firstParam = paramList.split(",")[0].split(":")[0].trim();
              const stateKey = name.replace(/^set/, "").replace(/^toggle/, "");
              const stateKeyLower = stateKey.charAt(0).toLowerCase() + stateKey.slice(1);
              return `${name}: (${paramList}) => set({ ${stateKeyLower}: ${firstParam} }),${trail}`;
            }
            return `${name}: () => set({}),${trail}`;
          }
          if (name.startsWith("reset") || name.startsWith("clear")) {
            return `${name}: () => set((state) => ({ ...state })),${trail}`;
          }
          if (name.startsWith("fetch") || name.startsWith("load") || name.startsWith("get")) {
            return `${name}: async (${paramList}) => { /* fetch implementation */ },${trail}`;
          }
          // Fallback : no-op valide
          return `${name}: (${paramList}) => {},${trail}`;
        }
      );
    },
  },
  // ── Zustand create() body : semicolons → commas dans l'objet ──────────────
  // Erreur : Expected ',' got ';' dans le corps du store
  {
    name: "zustand-semicolons-in-create-body",
    detect: (p, c) => p.endsWith(".ts") && c.includes("create<")
      && /create<[^>]+>\s*\(\s*\)\s*\(\s*\([^)]*\)\s*=>\s*\(?\s*\{[\s\S]*?;\s*\n\s*\w+/.test(c),
    fix: (_, c) => {
      // Localise le corps du create() et remplace les ; par , dans l'objet littéral
      // On repère le bloc ((set...) => ({ ... })) et on traite les semicolons
      let inCreateBody = false;
      let depth = 0;
      const lines = c.split("\n");
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!inCreateBody && /create<[^>]+>/.test(line)) {
          inCreateBody = true;
        }
        if (inCreateBody) {
          // Compte les accolades pour rester dans le corps
          for (const ch of line) {
            if (ch === "{") depth++;
            if (ch === "}") depth--;
          }
          if (depth <= 0) inCreateBody = false;

          // Dans le corps du create, si une ligne finit par ; et contient :
          // et n'est PAS une déclaration de type (interface/type) → remplace par ,
          const trimmed = line.trimEnd();
          if (
            trimmed.endsWith(";") &&
            /\w+\s*:\s*/.test(trimmed) &&
            !trimmed.trimStart().startsWith("//") &&
            !trimmed.trimStart().startsWith("interface") &&
            !trimmed.trimStart().startsWith("type ") &&
            depth > 0
          ) {
            result.push(line.trimEnd().slice(0, -1) + ",");
            continue;
          }
        }
        result.push(line);
      }
      return result.join("\n");
    },
  },
  // ── Zustand interface avec implémentation dans les types ──────────────────
  // Erreur : interface FooState { method: () => set({}) }
  {
    name: "zustand-impl-in-interface",
    detect: (_, c) => c.includes("create<")
      && /interface\s+\w+State\s*\{[\s\S]*?:\s*\([^)]*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(
      /(interface\s+\w+State\s*\{[\s\S]*?)(\w+)\s*:\s*\([^)]*\)\s*=>\s*[^;]+;/g,
      (_, before, name) => `${before}${name}: (...args: any[]) => void;`
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STRING LITERALS — &apos; JAMAIS dans le code TypeScript
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Corrige les &apos; mal placés dans les strings TS ─────────────────────
  {
    name: "fix-bad-apos-in-ts-strings",
    detect: (_, c) =>
      /case\s+['"][^'"]*&apos;/.test(c) ||
      /useState\(['"][^'"]*&apos;/.test(c) ||
      /=\s*['"][^'"]*&apos;/.test(c) ||
      /:\s*['"][^'"]*&apos;/.test(c) ||
      /\(\s*['"][^'"]*&apos;/.test(c),
    fix: (_, c) => fixBadAposInTsStrings(c),
  },
  // ── Apostrophes non échappées dans JSX text UNIQUEMENT ────────────────────
  {
    name: "apostrophe-jsx-text-only",
    detect: (p, c) => p.endsWith(".tsx") && />([^<{]*[a-zA-Zà-ÿ])'([a-zA-Zà-ÿ][^<{]*)</.test(c),
    fix: (_, c) => fixApostrophesInJsxOnly(c),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Déduplication des imports (cause "already declared") ──────────────────
  {
    name: "deduplicate-imports",
    detect: (_, c) => {
      const importLines = c.match(/^import\s*(?:type\s*)?\{[^}]+\}\s*from\s*['"][^'"]+['"]/gm) ?? [];
      const seen = new Set<string>();
      for (const line of importLines) {
        const ids = line.match(/\{([^}]+)\}/)?.[1]
          .split(",")
          .map(s => s.trim().split(/\s+as\s+/).pop()!.trim())
          .filter(Boolean) ?? [];
        for (const id of ids) {
          if (seen.has(id)) return true;
          seen.add(id);
        }
      }
      return false;
    },
    fix: (_, c) => {
      const lines = c.split("\n");
      const seenIds = new Set<string>();
      const result: string[] = [];
      for (const line of lines) {
        const match = line.match(/^(import\s*(?:type\s*)?\{)([^}]+)(\}\s*from\s*['"][^'"]+['"].*)/);
        if (match) {
          const ids = match[2].split(",").map(s => s.trim()).filter(Boolean);
          const newIds = ids.filter(rawId => {
            const id = rawId.split(/\s+as\s+/).pop()!.trim();
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
          });
          if (newIds.length > 0) result.push(`${match[1]}${newIds.join(", ")}${match[3]}`);
          // ligne entièrement en doublon → sautée
        } else {
          result.push(line);
        }
      }
      return result.join("\n");
    },
  },
  // ── cn() sans import ou import relatif ────────────────────────────────────
  {
    name: "missing-cn-import",
    detect: (_, c) => {
      if (!c.includes("cn(")) return false;
      if (c.includes("function cn") || c.includes("const cn") || c.includes("= cn;")) return false;
      if (c.includes("from '@/lib/utils'") || c.includes('from "@/lib/utils"')) return false;
      return true;
    },
    fix: (_, c) => {
      if (/from ['"](?:\.\.?\/)*lib\/utils['"]/.test(c))
        return c.replace(/from ['"](?:\.\.?\/)*lib\/utils['"]/g, 'from "@/lib/utils"');
      const line = `import { cn } from "@/lib/utils";`;
      return (c.includes('"use client"') || c.includes("'use client'"))
        ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${line}\n`)
        : `${line}\n${c}`;
    },
  },
  // ── Normalisation des chemins relatifs → alias @/ ─────────────────────────
  {
    name: "normalize-all-relative-imports",
    detect: (_, c) => /from ['"](?:\.\.?\/){2,}(lib|components|types|stores|hooks|services|app)\//.test(c),
    fix: (_, c) => c.replace(
      /from ['"](?:\.\.?\/){2,}(lib|components|types|stores|hooks|services)\/([^'"]+)['"]/g,
      'from "@/$1/$2"'
    ),
  },
  // ── import relatif simple ../lib/ → @/lib/ ────────────────────────────────
  {
    name: "normalize-single-relative-imports",
    detect: (_, c) => /from ['"]\.\.?\/(lib|components|types|stores|hooks|services)\//.test(c),
    fix: (_, c) => c.replace(
      /from ['"]\.\.\/(lib|components|types|stores|hooks|services)\/([^'"]+)['"]/g,
      'from "@/$1/$2"'
    ),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NEXT.JS 15
  // ═══════════════════════════════════════════════════════════════════════════

  // ── params → Promise ───────────────────────────────────────────────────────
  {
    name: "nextjs15-params-promise",
    detect: (p, c) => (p.includes("route.ts") || p.includes("["))
      && /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(c) && !c.includes("Promise<{"),
    fix: (_, c) => {
      let f = c.replace(
        /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g,
        (_, t) => `{ params }: { params: Promise<${t}> }`
      );
      if (!f.includes("await params")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
      return f;
    },
  },
  // ── params sans await ─────────────────────────────────────────────────────
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => (p.includes("route.ts") || p.includes("["))
      && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c)
      && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(
      /const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g,
      "const $1 = await params"
    ),
  },
  // ── Route handler export default → named export ───────────────────────────
  {
    name: "route-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+\w+/g, "export async function POST")
      .replace(/export\s+default\s+function\s+\w+/g, "export async function POST"),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAMER-MOTION
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: "framer-shadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion."))
      && /(?:whileHover|whileTap|animate|initial)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  {
    name: "framer-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIVERS TYPESCRIPT
  // ═══════════════════════════════════════════════════════════════════════════

  // ── metadata dans client component ────────────────────────────────────────
  {
    name: "metadata-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'"))
      && c.includes("export const metadata"),
    fix: (_, c) => c.replace(
      /export\s+const\s+metadata\s*=[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g,
      ""
    ),
  },
  // ── server-only dans client component ─────────────────────────────────────
  {
    name: "server-only-in-client",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'"))
      && c.includes("import 'server-only'"),
    fix: (_, c) => c.replace(/import ['"]server-only['"];\n?/g, ""),
  },
  // ── key= manquant dans .map() ─────────────────────────────────────────────
  {
    name: "missing-key-map",
    detect: (p, c) => p.endsWith(".tsx")
      && /\.map\(\s*\([^)]+\)\s*=>\s*\(?\s*<[A-Za-z](?![^>]*key=)/.test(c),
    fix: (_, c) => c.replace(
      /\.map\(\s*\((\w+)(?:,\s*(\w+))?\)\s*=>\s*\(?\s*<([A-Za-z]\w*)(?![^>]*key=)/g,
      (m, item, idx, tag) => m.replace(`<${tag}`, `<${tag} key={${idx ? idx : `${item}.id ?? ${item}`}}`)
    ),
  },
  // ── Tailwind bg-opacity déprécié ──────────────────────────────────────────
  {
    name: "tailwind-bg-opacity",
    detect: (_, c) => /bg-opacity-\d+/.test(c),
    fix: (_, c) => c.replace(/(\S+)\s+bg-opacity-(\d+)/g, "$1/$2"),
  },
  // ── children type manquant ────────────────────────────────────────────────
  {
    name: "missing-children-type",
    detect: (_, c) => c.includes("{children}")
      && /interface\s+\w+Props/.test(c) && !/children\s*:/.test(c),
    fix: (_, c) => c.replace(
      /(interface\s+\w+Props\s*\{)/,
      "$1\n  children?: React.ReactNode;"
    ),
  },
  // ── any implicite dans catch ───────────────────────────────────────────────
  {
    name: "catch-any",
    detect: (_, c) => /catch\s*\(\s*\w+\s*\)(?!\s*:\s*(?:unknown|any))/.test(c),
    fix: (_, c) => c.replace(/catch\s*\(\s*(\w+)\s*\)(?!\s*:\s*(?:unknown|any))/g, "catch ($1: unknown)"),
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
// ZUSTAND RULES — correction complète des stores
// =============================================================================

/**
 * Corrige un fichier store Zustand entier.
 * Le LLM confond régulièrement 3 patterns :
 *   A. Interface avec implémentation : interface FooState { method: () => set({}) }
 *   B. Objet create() avec `: () => void;` au lieu d'une vraie fonction
 *   C. Semicolons au lieu de virgules dans l'objet littéral JS
 */
function fixZustandStore(content: string): string {
  if (!content.includes("create<")) return content;

  const lines = content.split("\n");
  const result: string[] = [];
  let inInterface = false;
  let inCreateBody = false;
  let braceDepth = 0;
  let createBraceStart = -1;

  // Détecte si on est dans le bloc create()...
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Entrée dans une interface
    if (/^interface\s+\w+/.test(trimmed)) { inInterface = true; }
    if (inInterface) {
      if (line.includes("{")) braceDepth += (line.match(/\{/g) ?? []).length;
      if (line.includes("}")) braceDepth -= (line.match(/\}/g) ?? []).length;
      if (braceDepth <= 0) { inInterface = false; braceDepth = 0; }

      // Dans l'interface : toutes les méthodes doivent finir par `: (...) => void;`
      // Si elles ont un corps JS, on le nettoie
      const methodWithBody = line.match(/^(\s*)(\w+)\s*:\s*\([^)]*\)\s*=>\s*(?!void\s*[;,])([\s\S]+?)[,;]\s*$/);
      if (methodWithBody && inInterface) {
        const [, indent, name, params] = line.match(/^(\s*)(\w+)\s*:\s*(\([^)]*\))/) ?? [];
        if (name) {
          result.push(`${indent ?? "  "}${name}: ${params ?? "()"} => void;`);
          continue;
        }
      }
      result.push(line);
      continue;
    }

    // Entrée dans le bloc create()
    if (/create<[^>]+>/.test(line) && !inCreateBody) {
      inCreateBody = true;
      createBraceStart = braceDepth;
    }

    if (inCreateBody) {
      // Compte les accolades pour savoir si on est dans l'objet du store
      const opens  = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      const prevDepth = braceDepth;
      braceDepth += opens - closes;
      if (braceDepth <= createBraceStart && prevDepth > createBraceStart) {
        inCreateBody = false;
      }

      // Dans le corps du create() : `: () => void;` → vraie implémentation
      const voidMethod = line.match(/^(\s*)(\w+)\s*:\s*\(([^)]*)\)\s*=>\s*void\s*;(\s*(?:\/\/[^\n]*)?)$/);
      if (voidMethod && braceDepth > createBraceStart) {
        const [, indent, name, params] = voidMethod;
        const cleanParams = params.trim();

        let impl = "";
        if (name.startsWith("set") && cleanParams) {
          const firstParam = cleanParams.split(",")[0].split(":")[0].trim();
          const stateKey = name.slice(3);
          const key = stateKey.charAt(0).toLowerCase() + stateKey.slice(1);
          impl = `${indent}${name}: (${cleanParams}) => set({ ${key}: ${firstParam} }),`;
        } else if (name.startsWith("set")) {
          impl = `${indent}${name}: () => set({}),`;
        } else if (name.startsWith("toggle")) {
          const stateKey = name.slice(6);
          const key = stateKey.charAt(0).toLowerCase() + stateKey.slice(1);
          impl = `${indent}${name}: () => set((s) => ({ ${key}: !s.${key} })),`;
        } else if (name.startsWith("reset") || name.startsWith("clear")) {
          impl = `${indent}${name}: () => set((s) => ({ ...s })),`;
        } else if (name.startsWith("fetch") || name.startsWith("load")) {
          impl = `${indent}${name}: async (${cleanParams}) => {},`;
        } else {
          impl = `${indent}${name}: (${cleanParams}) => {},`;
        }
        result.push(impl);
        continue;
      }

      // Semicolons dans l'objet create() → virgules
      if (
        line.trimEnd().endsWith(";") &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("interface") &&
        !trimmed.startsWith("type ") &&
        /\w+\s*[:(]/.test(trimmed) &&
        braceDepth > createBraceStart + 1
      ) {
        result.push(line.trimEnd().slice(0, -1) + ",");
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

// =============================================================================
// PATCH MODE — détection et parsing des erreurs de build
// =============================================================================

interface BuildError {
  file: string;
  line?: number;
  message: string;
  snippet?: string;
}

/** Détecte si le message utilisateur contient des erreurs de build Next.js/TypeScript */
function isPatchRequest(msg: string): boolean {
  return (
    msg.includes("Failed to compile") ||
    msg.includes("Build Error") ||
    msg.includes("SyntaxError") ||
    msg.includes("Module parse failed") ||
    msg.includes("Cannot find module") ||
    msg.includes("Type error:") ||
    msg.includes("Error:   x ") ||
    (msg.includes("error TS") && msg.includes(".ts")) ||
    /\.\/(app|components|stores|hooks|services|lib|types)\/.*\.(ts|tsx)\n/.test(msg)
  );
}

/** Extrait les chemins de fichiers cassés depuis un message d'erreur de build */
function parseBrokenFiles(msg: string): string[] {
  const files = new Set<string>();

  // Pattern Next.js : "./<path>" ou "./<path>\nError:"
  const nextPatterns = msg.matchAll(/\.\/((?:app|components|stores|hooks|services|lib|types|pages)[^\s\n]+\.tsx?)/g);
  for (const m of nextPatterns) files.add(m[1]);

  // Pattern TypeScript : "/<path>(<line>,<col>)"
  const tsPatterns = msg.matchAll(/\/((?:app|components|stores|hooks|services|lib|types)[^\s(]+\.tsx?)(?:\(|\s)/g);
  for (const m of tsPatterns) files.add(m[1]);

  // Pattern "Error in <path>"
  const errorInPatterns = msg.matchAll(/(?:Error in|at)\s+\.(\/(?:app|components|stores|hooks|services|lib|types)[^\s:]+\.tsx?)/g);
  for (const m of errorInPatterns) files.add(m[1].startsWith("/") ? m[1].slice(1) : m[1]);

  return Array.from(files);
}

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
// MEGA-AGENT PROMPT — build initial complet
// =============================================================================

const MEGA_AGENT_PROMPT = `
Tu es un Ingénieur Full Stack Principal + Product Manager Senior.
Tu construis de vraies applications, pas des maquettes.

════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°0 — ZUSTAND : INTERFACE ≠ OBJET LITTÉRAL
════════════════════════════════════════════════════════════

Un store Zustand a DEUX parties distinctes avec des règles différentes :

PARTIE 1 — L'interface TypeScript (types uniquement)
  interface MarketState {
    selectedSymbol: string;
    setSelectedSymbol: (symbol: string) => void;   ← void; avec point-virgule OK
    fetchData: () => Promise<void>;                  ← void; avec point-virgule OK
  }

PARTIE 2 — Le corps du create() (objet littéral JavaScript)
  const useMarketStore = create<MarketState>()((set, get) => ({
    selectedSymbol: 'BTCUSDT',                           ← virgule, pas de ;
    setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),  ← virgule
    fetchData: async () => { const d = await fetchAPI(); set({ data: d }); },  ← virgule
  }));

INTERDIT ABSOLU dans le corps du create() :
  setSelectedSymbol: () => void;    ← CRASH "Expression expected"
  fetchData: () => void;            ← CRASH "Expected ',' got ';'"

RÈGLE : dans create(), chaque méthode doit avoir une VRAIE implémentation
        se terminant par une VIRGULE, jamais un point-virgule.

════════════════════════════════════════════════════════════
RÈGLE ABSOLUE N°1 — STRING LITERALS TS ≠ JSX TEXT
════════════════════════════════════════════════════════════

&apos; UNIQUEMENT dans le texte JSX visible par l'utilisateur :
  <p>L&apos;application</p>  ← OK

JAMAIS dans les string literals TypeScript :
  case 'home': ← CORRECT      case 'home&apos;': ← CRASH BUILD
  useState('tab') ← CORRECT   useState('tab&apos;') ← CRASH BUILD

════════════════════════════════════════════════════════════
PROTOCOLE EN 5 PHASES INTERNES
════════════════════════════════════════════════════════════

PHASE 1 — PRODUCT THINKING
"Si je payais 50$/mois pour ce logiciel, qu'est-ce que j'attendrais ?"

PHASE 2 — FEATURE INVENTORY
Pour chaque feature : service → store → hook → composant → wire complet.

PHASE 3 — ORDRE DE GÉNÉRATION (IMMUABLE)
  1. lib/env.ts, lib/utils.ts, types/index.ts
  2. services/*.ts          ← TOUJOURS AVANT TOUT UI
  3. stores/*.ts
  4. hooks/*.ts
  5. app/api/**/route.ts
  6. components/ui/*
  7. components/Modals.tsx
  8. components/views/*View.tsx ← layout UNIQUE par page
  9. app/globals.css, app/layout.tsx, app/page.tsx

PHASE 4 — WIRE VERIFICATION
  □ Chaque bouton → handler réel
  □ Chaque nav item → View distincte
  □ Chaque service → importé et appelé

PHASE 5 — SELF-AUDIT BUILD
  □ "use client" dans tout tsx avec hooks
  □ Zustand : interface = () => void; / create() = vraie implémentation,
  □ Aucun import vers fichier inexistant
  □ ZÉRO "This module is active", "Coming soon", "Under development"
  □ Imports internes → alias @/ uniquement

════════════════════════════════════════════════════════════
LES 7 CRIMES
════════════════════════════════════════════════════════════

CRIME 1 — SANDBOX : Math.random() pour des données de marché
CRIME 2 — GHOST NAVIGATION : sidebar items sans vraie View
CRIME 3 — INTERFACE MIRRORING : deux views = même composant, titre différent
CRIME 4 — HOLLOW INTERACTIVITY : bouton sans logique systémique
CRIME 5 — ATOMIC NEGLECT : topbar avec 6 boutons dont 5 sans handler
CRIME 6 — DISCONNECTED SERVICES : service créé mais jamais importé
CRIME 7 — DESIGN REGRESSION : corriger en perdant le CSS d'origine

════════════════════════════════════════════════════════════
STRUCTURE
════════════════════════════════════════════════════════════

lib/env.ts, lib/utils.ts, types/index.ts
services/[domain].ts → logique pure, API calls
stores/[name]Store.ts → Zustand typé
hooks/use[Name].ts → orchestration
components/ui/, components/Modals.tsx, components/views/
app/api/**/route.ts → export GET/POST nommés
app/globals.css → :root {} variables
app/layout.tsx → CDN links
app/page.tsx → router

════════════════════════════════════════════════════════════
RÈGLES TS / NEXT.JS 15
════════════════════════════════════════════════════════════

Imports internes → TOUJOURS "@/lib/...", "@/components/..." etc.
"use client" → tout tsx avec useState/useEffect/useRouter/Zustand/window
params → Promise<{id:string}> + const {id} = await params
Route handlers → export GET/POST nommés (JAMAIS export default)
Framer-motion → boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
key= dans tout .map() JSX
Images : favicons.google / dicebear / picsum

════════════════════════════════════════════════════════════
FORMAT
════════════════════════════════════════════════════════════

<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>

DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/pkg1"]


[Prose naturelle, 4-6 lignes, pas de **, pas de ##]

Tu es développeur NextJs React Typescript. 
`;

// =============================================================================
// PATCH-AGENT PROMPT — correction chirurgicale d'erreurs de build
// =============================================================================

const PATCH_AGENT_PROMPT = `
Tu es un compilateur TypeScript/Next.js avec capacité de correction chirurgicale.

════════════════════════════════════════════════════════════
MISSION PATCH — RÈGLES ABSOLUES
════════════════════════════════════════════════════════════

1. Tu reçois des erreurs de build précises avec les fichiers cassés.
2. Tu corriges UNIQUEMENT les fichiers listés dans les erreurs.
3. Tu NE touches PAS aux autres fichiers — SURTOUT pas app/page.tsx,
   app/layout.tsx, app/globals.css, les views, les composants UI.
4. Tu NE réécris PAS tout l'application — JAMAIS.
5. Tu fournis le fichier corrigé en entier (pas de diff, pas de patch partiel).

════════════════════════════════════════════════════════════
ERREURS ZUSTAND LES PLUS FRÉQUENTES
════════════════════════════════════════════════════════════

ERREUR : "Expression expected" ou "Expected ',' got ';'" dans un store

CAUSE : Le store a \`: () => void;\` dans le corps du create()
  Mauvais :                        Correct :
  create<S>()((set) => ({          create<S>()((set) => ({
    count: 0,                        count: 0,
    setCount: () => void;    →       setCount: (n: number) => set({ count: n }),
  }))                              }))

RAPPEL interface vs create() :
  interface FooState {
    count: number;
    setCount: (n: number) => void;     ← void; avec ; dans l'interface
  }
  const useFoo = create<FooState>()((set) => ({
    count: 0,
    setCount: (n) => set({ count: n }),  ← vraie impl avec , dans create()
  }));

════════════════════════════════════════════════════════════
AUTRES ERREURS FRÉQUENTES
════════════════════════════════════════════════════════════

"already declared" → identifiant importé deux fois → supprime le doublon
"Cannot find module" → mauvais chemin d'import → corrige vers @/...
"use client" missing → ajoute en première ligne
Unterminated string → &apos; dans string TS → remplace par apostrophe droite
params without await → ajoute Promise<{}> et await

════════════════════════════════════════════════════════════
FORMAT DE RÉPONSE
════════════════════════════════════════════════════════════

Pour chaque fichier cassé, fournis le fichier complet corrigé :

<create_file path="stores/marketStore.ts">
... fichier entier corrigé, pas de placeholder ...
</create_file>

Puis une phrase en français expliquant ce qui a été corrigé.
RIEN D'AUTRE. Pas de nouveaux fichiers. Pas de refactoring. Juste la correction.
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

    // ── Détection PATCH vs BUILD ──────────────────────────────────────────────
    const isPatch = isPatchRequest(lastUserMsg);
    const brokenFiles = isPatch ? parseBrokenFiles(lastUserMsg) : [];

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

          // ════════════════════════════════════════════════════════════════
          // MODE PATCH — correction chirurgicale des fichiers cassés
          // ════════════════════════════════════════════════════════════════
          if (isPatch) {
            // 1. D'abord essayer de corriger programmatiquement SANS appel LLM
            const targetFiles: GeneratedFile[] = [];
            for (const brokenPath of brokenFiles) {
              const existing = currentProjectFiles?.find(
                (f: any) => f.path === brokenPath || f.path === `./${brokenPath}`
              );
              if (existing) targetFiles.push({ path: existing.path, content: existing.content });
            }

            if (targetFiles.length > 0) {
              // Applique le correcteur Zustand spécialisé en premier
              const zustandFixed = targetFiles.map(f => ({
                ...f,
                content: f.path.includes("store") || f.path.includes("Store")
                  ? fixZustandStore(f.content)
                  : f.content,
              }));

              // Puis le correcteur programmatique général
              const { files: programFixed } = runFixer(zustandFixed);

              // Vérifie si les corrections ont suffi
              const anyChanged = programFixed.some((f, i) => f.content !== targetFiles[i].content);
              if (anyChanged) {
                for (const f of programFixed) {
                  emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                }
                emit("\nErreurs corrigées automatiquement.\n[PAGE_DONE]\n");
                controller.close();
                return;
              }
            }

            // 2. Si la correction programmatique n'a pas suffi → LLM ciblé
            const brokenFilesContent = brokenFiles
              .map(fp => {
                const f = currentProjectFiles?.find(
                  (cf: any) => cf.path === fp || cf.path === `./${fp}`
                );
                return f ? `\n=== ${f.path} ===\n${f.content}` : `\n=== ${fp} === (introuvable dans le projet)`;
              })
              .join("\n");

            const patchContext = `
ERREURS DE BUILD :
${lastUserMsg}

FICHIERS CASSÉS À CORRIGER (UNIQUEMENT CES FICHIERS) :
${brokenFilesContent}

RAPPEL : corrige UNIQUEMENT les fichiers listés ci-dessus.
NE touche PAS aux autres fichiers. NE réécris PAS l'application.
`;

            const contents = buildHistory(patchContext);
            let fullOutput = "";
            let buffer = "";

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDecl] }],
              config: {
                systemInstruction: `\n\n${PATCH_AGENT_PROMPT}`,
                temperature: 0.05,
                maxOutputTokens: 16384,
              },
            });

            for await (const chunk of response) {
              const txt = chunk.text;
              if (txt) {
                fullOutput += txt;
                buffer += txt;
                if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
              }
            }
            if (buffer.trim()) emit(buffer);

            // Applique le fixer programmatique sur les fichiers patchés par le LLM
            const patchedFiles = parseGeneratedFiles(fullOutput);
            if (patchedFiles.length > 0) {
              const zustandPatched = patchedFiles.map(f => ({
                ...f,
                content: f.path.includes("store") || f.path.includes("Store")
                  ? fixZustandStore(f.content)
                  : f.content,
              }));
              const { files: finalPatched } = runFixer(zustandPatched);
              for (const f of finalPatched) {
                if (f.content !== patchedFiles.find(p => p.path === f.path)?.content) {
                  emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                }
              }
            }

            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ════════════════════════════════════════════════════════════════
          // MODE BUILD — génération complète de l'application
          // ════════════════════════════════════════════════════════════════

          const manifest = createdPaths.size > 0
            ? `FICHIERS EXISTANTS :\n${Array.from(createdPaths).join("\n")}`
            : "NOUVEAU PROJET.";

          const fullContext = `
=== DEMANDE ===
"${lastUserMsg}"

${designAnchor}
${colorCtx}

${manifest}

=== RAPPELS CRITIQUES ===
Zustand create() body : VRAIES implémentations avec virgules. JAMAIS ": () => void;"
Imports internes : TOUJOURS "@/..." jamais "../..."
case 'home': avec apostrophes droites. JAMAIS &apos; dans le code TS.
Services/ en premier, avant tout composant UI.
Chaque service importé et appelé depuis ses composants.
`;

          const contents = buildHistory(fullContext);
          let fullOutput = "";
          let buffer = "";

          const response = await ai.models.generateContentStream({
            model: MODEL_ID,
            contents,
            tools: [{ functionDeclarations: [readFileDecl] }],
            config: {
              systemInstruction: `\n\n${MEGA_AGENT_PROMPT}`,
              temperature: 0.2,
              maxOutputTokens: 65536,
            },
          });

          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) {
              fullOutput += txt;
              buffer += txt;
              if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
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

          // ── Correction Zustand spécialisée ────────────────────────────
          const zustandFixed = allGeneratedFiles.map(f => ({
            ...f,
            content: (f.path.includes("store") || f.path.includes("Store"))
              ? fixZustandStore(f.content)
              : f.content,
          }));
          for (let i = 0; i < zustandFixed.length; i++) {
            if (zustandFixed[i].content !== allGeneratedFiles[i].content) {
              allGeneratedFiles[i] = zustandFixed[i];
              emit(`<create_file path="${zustandFixed[i].path}">\n${zustandFixed[i].content}\n</create_file>`);
            }
          }

          // ── Correcteur programmatique 2 passes ────────────────────────
          const { files: pass1 } = runFixer(allGeneratedFiles);
          for (let i = 0; i < pass1.length; i++) {
            if (pass1[i].content !== allGeneratedFiles[i].content) {
              allGeneratedFiles[i] = pass1[i];
              emit(`<create_file path="${pass1[i].path}">\n${pass1[i].content}\n</create_file>`);
            }
          }
          const { files: pass2 } = runFixer(pass1);
          for (let i = 0; i < pass2.length; i++) {
            if (pass2[i].content !== pass1[i].content) {
              allGeneratedFiles[i] = pass2[i];
              emit(`<create_file path="${pass2[i].path}">\n${pass2[i].content}\n</create_file>`);
            }
          }

          // ── Packages ──────────────────────────────────────────────────
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

// =============================================================================
// MEGA-AGENT PROMPT
// =============================================================================




// =============================================================================
// API ROUTE HANDLER
// =============================================================================

            
