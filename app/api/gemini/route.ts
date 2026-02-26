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
  // ── Zustand create() body : semicolons → commas UNIQUEMENT au niveau direct ─
  // Erreur : Expected ',' got ';' dans le corps du store
  // IMPORTANT : on ne convertit QUE les propriétés directes de l'objet (depth 1)
  // JAMAIS les statements dans les corps de fonctions imbriquées (depth 2+)
  {
    name: "zustand-semicolons-in-create-body",
    detect: (p, c) => p.endsWith(".ts") && c.includes("create<")
      && /create<[^>]+>\s*\(\s*\)\s*\(\s*\([^)]*\)\s*=>\s*\(?\s*\{[\s\S]*?;\s*\n\s*\w+/.test(c),
    fix: (_, c) => {
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
          for (const ch of line) {
            if (ch === "{") depth++;
            if (ch === "}") depth--;
          }
          if (depth <= 0) inCreateBody = false;

          const trimmed = line.trimEnd();
          // Ne convertit QU'À depth === 1 (propriétés directes de l'objet create)
          // depth 2+ = intérieur de corps de fonctions imbriquées → NE PAS toucher
          if (
            depth === 1 &&
            trimmed.endsWith(";") &&
            /\w+\s*:\s*/.test(trimmed) &&
            !trimmed.trimStart().startsWith("//") &&
            !trimmed.trimStart().startsWith("interface") &&
            !trimmed.trimStart().startsWith("type ")
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
  // ── Zustand function body : commas → semicolons pour les statements ─────────
  // Erreur : "Expression expected" — set({...}), dans un corps de fonction
  // Cause : le LLM ou le fixer met une virgule après un statement dans un bloc {}
  {
    name: "zustand-comma-in-fn-body",
    detect: (p, c) => p.endsWith(".ts") && c.includes("create<")
      && /=>\s*\{[\s\S]*?(?:set|get)\s*\([^)]*\)\s*,\s*\n/m.test(c),
    fix: (_, c) => {
      // Ligne par ligne : si on est à depth >= 2 dans un store (intérieur d'une fonction)
      // et qu'une ligne finit par ),  (statement avec virgule finale) → changer en );
      let inCreateBody = false;
      let depth = 0;
      const lines = c.split("\n");
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        if (!inCreateBody && /create<[^>]+>/.test(line)) {
          inCreateBody = true;
        }

        if (inCreateBody) {
          for (const ch of line) {
            if (ch === "{") depth++;
            if (ch === "}") depth--;
          }
          if (depth <= 0) inCreateBody = false;

          // À depth >= 2 (intérieur d'un corps de fonction imbriqué)
          // Si la ligne est un statement qui finit par ), → changer en );
          if (
            depth >= 2 &&
            !trimmed.startsWith("//") &&
            // Ligne = statement (indentée), finit par ),
            /\)\s*,\s*$/.test(line) &&
            // N'est PAS une propriété d'objet (pas de pattern "name: value")
            !/^\s*\w+\s*:\s*(?:\([^)]*\)|async\s*\()/.test(line) &&
            // Contient un appel de fonction (set, get, fetch, etc.)
            /\b(?:set|get|fetch|load|update|dispatch|resolve|reject|push|splice|delete|assign)\s*\(/.test(trimmed)
          ) {
            result.push(line.trimEnd().replace(/\)\s*,\s*$/, ");"));
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
// TYPE SAFETY FIXER — cohérence interface ↔ usage dans les vues et stores
// =============================================================================

/**
 * Extrait les champs déclarés dans une interface ou un type TypeScript.
 * Retourne un Set<string> des noms de propriétés.
 */
function extractInterfaceFields(interfaceBlock: string): Set<string> {
  const fields = new Set<string>();
  // Chaque ligne : optionnel? nom: type;
  const rx = /^\s*(\w+)\??\s*:/gm;
  let m;
  while ((m = rx.exec(interfaceBlock)) !== null) {
    fields.add(m[1]);
  }
  return fields;
}

/**
 * Construit un catalogue de toutes les interfaces connues dans le projet.
 * { NomInterface → Set<propriété> }
 */
function buildInterfaceCatalog(files: GeneratedFile[]): Map<string, Set<string>> {
  const catalog = new Map<string, Set<string>>();
  for (const f of files) {
    // Capture blocs interface NomInterface { ... }
    const rx = /interface\s+(\w+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = rx.exec(f.content)) !== null) {
      const name = m[1];
      const fields = extractInterfaceFields(m[2]);
      if (fields.size > 0) {
        const existing = catalog.get(name) ?? new Set<string>();
        fields.forEach(f => existing.add(f));
        catalog.set(name, existing);
      }
    }
    // Capture type aliases avec objet littéral : type NomType = { champ: type; }
    const rxType = /type\s+(\w+)\s*=\s*\{([^}]*)\}/g;
    while ((m = rxType.exec(f.content)) !== null) {
      const name = m[1];
      const fields = extractInterfaceFields(m[2]);
      if (fields.size > 0) {
        const existing = catalog.get(name) ?? new Set<string>();
        fields.forEach(f => existing.add(f));
        catalog.set(name, existing);
      }
    }
  }
  return catalog;
}

/**
 * Construit le catalogue d'état de chaque store Zustand.
 * { useNomStore → Set<propriété> }
 */
function buildStoreCatalog(files: GeneratedFile[]): Map<string, Set<string>> {
  const catalog = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.content.includes("create<")) continue;
    // Trouve le nom du store: export const useXxxStore = create<...>
    const storeNameM = f.content.match(/export\s+const\s+(use\w+Store)/);
    if (!storeNameM) continue;
    const storeName = storeNameM[1];
    // Trouve l'interface associée: interface XxxState { ... }
    const interfaceM = f.content.match(/interface\s+\w+State\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
    if (!interfaceM) continue;
    const fields = extractInterfaceFields(interfaceM[1]);
    catalog.set(storeName, fields);
  }
  return catalog;
}

/**
 * Vérifie la cohérence entre :
 * 1. Ce qu'une view destructure depuis un store et ce que ce store expose réellement.
 * 2. L'accès à des propriétés sur des objets typés (pos.pnl, item.quantity, etc.).
 * Corrige les mismatches détectés.
 */
function runTypeSafetyFixer(files: GeneratedFile[]): GeneratedFile[] {
  const storeCatalog = buildStoreCatalog(files);
  const interfaceCatalog = buildInterfaceCatalog(files);

  return files.map(f => {
    if (!f.path.endsWith(".tsx") && !f.path.endsWith(".ts")) return f;
    if (f.path.includes("app/api")) return f;
    let content = f.content;
    let changed = false;

    // ── 1. Vérification destructure de store ──────────────────────────────────
    // Pattern: const { field1, field2, missingField } = useXxxStore()
    const storeDestructureRx = /const\s*\{([^}]+)\}\s*=\s*(use\w+Store)\s*\(/g;
    let sdm;
    while ((sdm = storeDestructureRx.exec(content)) !== null) {
      const destructured = sdm[1];
      const storeName = sdm[2];
      const knownFields = storeCatalog.get(storeName);
      if (!knownFields || knownFields.size === 0) continue;

      // Extrait les noms destructurés
      const names = destructured.split(",").map(s => {
        const trimmed = s.trim();
        // Handle aliases: { realName: alias } → realName
        return trimmed.split(":")[0].trim();
      }).filter(Boolean);

      const unknownFields = names.filter(n => n && !knownFields.has(n) && !n.startsWith("//"));
      if (unknownFields.length === 0) continue;

      // Supprime les champs inconnus du destructuring
      const cleanedDestructure = names
        .filter(n => knownFields.has(n))
        .join(", ");

      if (cleanedDestructure.length === 0) continue;

      const original = sdm[0];
      const fixed = original.replace(
        /\{[^}]+\}/,
        `{ ${cleanedDestructure} }`
      );
      if (fixed !== original) {
        content = content.replace(original, fixed);
        changed = true;
        // Supprime les usages des champs inconnus pour éviter "undeclared variable"
        for (const field of unknownFields) {
          // Remplace {field} dans JSX par string vide
          content = content.replace(new RegExp(`\\{${field}\\}`, "g"), "{''}");
          // Remplace usages pos.field → 0 ou '' selon contexte
          content = content.replace(new RegExp(`\\.${field}\\b`, "g"), `?.${field} ?? 0`);
        }
      }
    }

    // ── 2. Modules inconnus spécifiques à remplacer par des alternatives ─────
    // NOTE : Monaco est intentionnellement AUTORISÉ — si le projet en a besoin,
    // le laisser. Seuls les modules vraiment problématiques (inexistants sur npm)
    // sont interceptés ici. Actuellement : aucun.
    // (La gestion des packages se fait via DEPENDENCIES dans les prompts)

    // ── 4. Accès à des propriétés potentiellement manquantes ──────────────────
    // Détecte les patterns "variable.propriete" dans le JSX et vérifie dans le catalogue
    // On cible les patterns courants comme pos.pnl, item.quantity, trade.entryPrice, etc.
    // Pour chaque type connu, vérifie que les accès sont valides
    for (const [typeName, fields] of interfaceCatalog.entries()) {
      if (fields.size === 0) continue;
      // Cherche les variables déclarées avec ce type: const positions: Position[] = ...
      // ou dans les maps: positions.map((pos) => pos.xxx)
      // Simplifié: on ne peut pas déduire le type de chaque variable sans AST complet
      // On se limite à vérifier les accès évidents grâce aux noms de variables courants
    }

    return changed ? { ...f, content } : f;
  });
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
      // UNIQUEMENT au niveau direct de l'objet (depth === createBraceStart + 1)
      // PAS à l'intérieur des corps de fonctions imbriquées (depth > createBraceStart + 1)
      if (
        line.trimEnd().endsWith(";") &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("interface") &&
        !trimmed.startsWith("type ") &&
        /\w+\s*[:(]/.test(trimmed) &&
        braceDepth === createBraceStart + 1
      ) {
        result.push(line.trimEnd().slice(0, -1) + ",");
        continue;
      }

      // Commas dans les corps de fonctions → semicolons pour les statements
      // Pattern : set({...}), à l'intérieur d'une fonction (depth >= createBraceStart + 2)
      if (
        braceDepth >= createBraceStart + 2 &&
        /\)\s*,$/.test(line.trimEnd()) &&
        !trimmed.startsWith("//") &&
        !/^\s*\w+\s*:\s*(?:\([^)]*\)|async\s*\()/.test(line) &&
        /\b(?:set|get)\s*\(/.test(trimmed)
      ) {
        result.push(line.trimEnd().replace(/\)\s*,$/, ");"));
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
// UTILITAIRES PIPELINE — sleep, retry avec backoff sur 503
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exécute un appel API Gemini avec retry automatique sur 503/429/UNAVAILABLE.
 * - maxAttempts : nombre de tentatives totales
 * - baseDelay   : délai initial avant retry (ms), doublé à chaque tentative
 * - Sur 503/429 : attend baseDelay * 2^attempt ms avant de réessayer
 * - Émet les chunks au fur et à mesure (stream transparent pour le client)
 */
async function callWithRetry(
  fn: () => Promise<AsyncIterable<any>>,
  onChunk: (txt: string) => void,
  opts: { maxAttempts?: number; baseDelay?: number } = {}
): Promise<string> {
  const { maxAttempts = 4, baseDelay = 12000 } = opts;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stream = await fn();
      let fullOutput = "";
      for await (const chunk of stream) {
        const txt = chunk.text;
        if (txt) { fullOutput += txt; onChunk(txt); }
      }
      return fullOutput;
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err ?? "");
      const isRetryable =
        msg.includes("503") || msg.includes("502") || msg.includes("429") ||
        msg.includes("UNAVAILABLE") || msg.includes("high demand") ||
        msg.includes("Service Unavailable") || msg.includes("overloaded");
      if (!isRetryable || attempt === maxAttempts - 1) throw err;
      const waitMs = baseDelay * Math.pow(2, attempt);
      onChunk(`\n[RETRY ${attempt + 1}/${maxAttempts - 1} — attente ${Math.round(waitMs / 1000)}s...]\n`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

// =============================================================================
// PHASE 1 — PRODUCT THINKING PROMPT
// Analyse profonde de la demande, produit une spec de produit détaillée
// =============================================================================

// =============================================================================
// PRESENTER PROMPT — Agent visible, interlocuteur principal de l'utilisateur
// Intro avant les phases, outro après. Jamais technique, toujours humain.
// =============================================================================

const PRESENTER_INTRO_PROMPT = `
Tu es l'interlocuteur principal d'un assistant de développement.
Tu reçois la demande d'un utilisateur qui veut créer une application.

MISSION : Écrire un message d'accueil chaleureux et bref (3-4 phrases maximum).

Ce message doit :
1. Accuser réception de la demande avec enthousiasme naturel
2. Décrire en une phrase ce que tu vas construire (en termes utilisateur, pas techniques)
3. Annoncer que tu commences maintenant

RÈGLES ABSOLUES :
- PAS de liste, PAS de plan, PAS de "voici les étapes que je vais suivre"
- PAS de mention de "phases", "agents", "pipeline", "architecture"
- Parle en "je" — tu ES l'assistant qui fait tout le travail
- Tu ne mentionnes aucune technologie (pas de Next.js, React, TypeScript, etc.)
- Ton seul but ici : mettre l'utilisateur à l'aise et lui dire que ça commence
- Max 4 phrases, style naturel et direct
`;

const PRESENTER_OUTRO_PROMPT = `
Tu es l'interlocuteur principal d'un assistant de développement.
Tu viens de terminer la construction d'une application complète.

Tu reçois : la demande originale + la liste des fichiers générés.

MISSION : Écrire un message de conclusion chaleureux (5-7 phrases).

Ce message doit :
1. Annoncer que le projet est prêt
2. Décrire les fonctionnalités disponibles — avec leurs noms visibles (Dashboard, Graphiques de prix, Carnet d'ordres...), jamais les noms de fichiers
3. Donner 1-2 phrases simples sur comment lancer et tester (npm run dev, puis ce qui se passe)
4. Inviter à demander des modifications ou ajouts

RÈGLES ABSOLUES :
- PAS de noms de fichiers (.tsx, .ts, stores, components...)
- PAS de termes techniques sauf le strict minimum (npm run dev est OK)
- Parle des fonctionnalités du point de vue de l'utilisateur final
- Style : chaleureux, concis, comme un collègue qui livre un projet
- Max 7 phrases
`;

const PRODUCT_THINKING_PROMPT = `
Tu es un Product Manager Senior + CTO d'une startup qui vient de lever 10M€.
On te donne la demande d'un utilisateur. Tu dois produire une SPEC PRODUIT COMPLÈTE.

════════════════════════════════════════════════════════════
TA MISSION
════════════════════════════════════════════════════════════

Analyser la demande et produire un document de spécification produit exhaustif.
Ce document sera utilisé par 6 agents de développement différents.
Il doit être COMPLET, PRÉCIS et SANS AMBIGUITÉ.

════════════════════════════════════════════════════════════
FORMAT DE SORTIE OBLIGATOIRE
════════════════════════════════════════════════════════════

=== PRODUCT SPEC ===

APP_NAME: [nom de l'application]

CORE_PURPOSE: [1 phrase — ce que fait l'app]

TARGET_USER: [qui utilise cette app et pourquoi]

PREMIUM_VISION: [Si un utilisateur payait 50$/mois, qu'attendrait-il ? Liste de 8-12 features premium]

KEY_FEATURES:
  [F01] Nom de la feature — description détaillée (OBLIGATOIRE, pas optionnel)
  [F02] ...
  (liste 8-15 features minimum avec vraie valeur métier)

DATA_MODELS:
  NomModel: { champ: type, ... }
  (tous les modèles de données nécessaires)

API_ENDPOINTS:
  METHOD /api/path → description de ce que ça fait et retourne
  (tous les endpoints nécessaires)

TECH_STACK_DECISIONS:
  - [package]: [raison du choix + version API critique si applicable]
  NOTES CRITIQUES SUR LES APIs :
    - lightweight-charts v5: addCandleSeries() PAS addCandlestickSeries()
    - lightweight-charts v5: createChart() retourne IChartApiBase, pas IChartApi
    - framer-motion: boxShadow (jamais shadow), scale numérique (jamais scale-105 Tailwind)
    - Next.js 15: params est Promise<{id:string}>, toujours await params
    - Route handlers: export GET/POST nommés, JAMAIS export default

DESIGN_LANGUAGE:
  COLOR_SCHEME: [couleurs précises avec hex si possible]
  TYPOGRAPHY: [fonts, tailles]
  STYLE: [dark/light, minimal/rich, flat/glassmorphism...]
  COMPONENTS: [types de composants UI principaux]

USER_FLOWS:
  Flow 1 — [nom]: étape1 → étape2 → étape3
  (tous les parcours utilisateur principaux)

CRITICAL_IMPLEMENTATION_NOTES:
  - [note technique critique 1]
  - [note technique critique 2]
  (contraintes, pièges à éviter, décisions architecturales)

=== END SPEC ===

IMPORTANT: Sois EXHAUSTIF. Ce document définit TOUT ce qui sera développé.
Les agents de code suivants n'auront PAS accès à la demande originale, seulement à ce spec.
`;

// =============================================================================
// PHASE 2 — FEATURE INVENTORY PROMPT
// Produit un manifeste de câblage précis avec les noms d'export exacts
// =============================================================================

const FEATURE_INVENTORY_PROMPT = `
Tu es un Architecte Logiciel Senior specialise en Next.js 15 + TypeScript.
Tu recois un Product Spec. Tu dois produire un MANIFESTE DE CABLAGE COMPLET.

════════════════════════════════════════════════════════════
TA MISSION CRITIQUE
════════════════════════════════════════════════════════════

Decomposer CHAQUE feature en couches concretes avec les noms exacts.
Ce manifeste est la BIBLE du projet. Les agents de code suivront ce manifeste a la lettre.

Les erreurs "X is not exported from Y" et "Property Z does not exist on type T"
viennent de manifestes imprecis. Sois CHIRURGICAL sur les noms et types.

════════════════════════════════════════════════════════════
CONTRAT DE TYPES — REGLE ABSOLUE
════════════════════════════════════════════════════════════

Pour CHAQUE interface, liste EXPLICITEMENT tous les champs qui seront utilises dans les vues.
Exemple obligatoire :

  Interface Position dans types/index.ts :
    interface Position {
      id: string;
      symbol: string;
      qty: number;
      avgPrice: number;
      currentPrice: number;
      pnl: number;
      pnlPercent: number;
      side: 'long' | 'short';
    }

  Store TradeState dans stores/useTradeStore.ts :
    STATE: balance, positions, tradeHistory, loading
    ACTIONS: setBalance, addPosition, closePosition, fetchPositions

  VUE PortfolioView PEUT UTILISER UNIQUEMENT :
    - depuis useTradeStore: balance, positions, tradeHistory, loading
    - depuis Position: id, symbol, qty, avgPrice, currentPrice, pnl, pnlPercent, side

REGLE : si une vue accede a pos.quantity alors quantity DOIT etre dans l'interface Position.
REGLE : si une vue destructure { history } depuis useTradeStore, alors history DOIT etre dans TradeState.
CRIME : declarer qty dans l'interface mais ecrire pos.quantity dans la vue. Les noms doivent etre IDENTIQUES.

════════════════════════════════════════════════════════════
FORMAT DE SORTIE OBLIGATOIRE
════════════════════════════════════════════════════════════

=== WIRING MANIFEST ===

TYPE_CONTRACT:
  Interface NomInterface → champ1: type, champ2: type, champ3: type
  (liste complete de TOUS les champs, les vues n'utiliseront QUE ces champs)

FICHIERS_PARTAGES:
  lib/utils.ts → export function cn(...) [named] | export function formatDate(...) [named]
  lib/env.ts → export const ENV = {...} [named]
  types/index.ts → export interface NomType {...} [named]

[F01] NOM_FEATURE
  SERVICE: services/nomService.ts
    export async function nomFn(params): ReturnType [named]
  STORE: stores/useNomStore.ts
    interface NomState {
      champ1: type;
      champ2: type;
      action1: (p: Type) => void;
    }
    export const useNomStore [named]
    STATE_FIELDS: champ1, champ2 (noms EXACTS a utiliser dans les vues)
    ACTION_METHODS: action1, action2 (noms EXACTS a appeler dans les vues)
  COMPONENTS:
    components/views/NomView.tsx: export function NomView() [named]
    ACCESSES_FROM_STORE: champ1, champ2, action1 (liste exhaustive)
    ACCESSES_FROM_TYPE: NomInterface.field1, NomInterface.field2 (liste exhaustive)
  WIRING:
    NomView importe useNomStore, appelle fetchNom() dans useEffect
    app/page.tsx : import { NomView } from '@/components/views/NomView'

EXPORT_REGISTRY:
  components/views/ChartView.tsx: named export ChartView
  stores/useMarketStore.ts: named export useMarketStore
  (liste complete)

=== END MANIFEST ===

REGLES CRITIQUES:
1. TOUJOURS specifier [named] ou [default] pour chaque fichier
2. Les components/views/*.tsx → TOUJOURS named exports (jamais default)
3. Les stores → TOUJOURS named exports
4. Les noms dans STATE_FIELDS DOIVENT correspondre exactement aux champs de l'interface
5. Les vues ne doivent acceder QUE aux champs listes dans ACCESSES_FROM_STORE et ACCESSES_FROM_TYPE
`;

// =============================================================================
// PHASE 3 — CODE GEN FOUNDATION PROMPT
// Génère : lib/ + types/ + services/ + stores/
// =============================================================================

const CODE_GEN_FOUNDATION_PROMPT = `
Tu es un Ingenieur Full Stack Senior NextJS/TypeScript.
Tu generes la COUCHE FONDATION de l'application.

════════════════════════════════════════════════════════════
FICHIERS A GENERER (UNIQUEMENT CES COUCHES)
════════════════════════════════════════════════════════════

1. lib/utils.ts — utilitaires (cn, formatters, helpers)
2. lib/env.ts — variables d'env typees
3. types/index.ts — TOUTES les interfaces et types de l'app
4. services/*.ts — TOUTE la logique metier et appels API
5. stores/*.ts — TOUS les stores Zustand

NE PAS generer : hooks, composants UI, vues, layout, page.tsx.

════════════════════════════════════════════════════════════
CONTRAT DE TYPES — REGLE ABSOLUE N°1
════════════════════════════════════════════════════════════

PRINCIPE : Un champ qui n'est PAS dans l'interface N'EXISTE PAS pour les vues.
Les erreurs "Property X does not exist on type Y" viennent d'un desaccord entre
l'interface declaree et les proprietes utilisees dans les composants.

OBLIGATION : Declare TOUS les champs qui seront utilises dans les vues.

Exemple CORRECT :
  interface Position {
    id: string;
    symbol: string;
    qty: number;           <- la vue ecrira pos.qty (pas pos.quantity)
    avgPrice: number;      <- la vue ecrira pos.avgPrice (pas pos.entryPrice)
    currentPrice: number;
    pnl: number;           <- la vue ecrira pos.pnl
    pnlPercent: number;
    side: 'long' | 'short';
  }

Exemple ERRONE qui cause des crashes :
  interface Position {
    qty: number;           <- DECLARE qty
  }
  // Dans la vue : pos.quantity   <- CRASH "quantity does not exist on type Position"
  // Dans la vue : pos.entryPrice <- CRASH "entryPrice does not exist on type Position"

REGLE DE COHESION DES NOMS : Le nom dans l'interface = le nom dans la vue. IDENTIQUE.
JAMAIS de synonymes : qty OU quantity, avgPrice OU entryPrice, pnl OU unrealizedPnl.
CHOISIR UN NOM ET LE GARDER PARTOUT.

════════════════════════════════════════════════════════════
CONTRAT DE STORE — REGLE ABSOLUE N°2
════════════════════════════════════════════════════════════

PRINCIPE : Une propriete qui n'est PAS dans l'interface du store N'EXISTE PAS.
Les erreurs "Property X does not exist on type TradeState" viennent de vues qui
destructurent des champs absents du store.

Exemple CORRECT :
  interface TradeState {
    balance: number;
    positions: Position[];
    tradeHistory: Trade[];  <- la vue peut destructurer tradeHistory
    loading: boolean;
    fetchPositions: () => void;
  }
  // Dans la vue : const { balance, positions, tradeHistory } = useTradeStore()

Exemple ERRONE :
  interface TradeState {
    balance: number;
    positions: Position[];
    // history n'est PAS declare ici
  }
  // Dans la vue : const { history } = useTradeStore()
  // CRASH : "Property 'history' does not exist on type 'TradeState'"

OBLIGATION : Declare TOUS les champs dont les vues auront besoin.

════════════════════════════════════════════════════════════
NOTE SUR LES PACKAGES
════════════════════════════════════════════════════════════

Si le projet necessite @monaco-editor/react, ace-builds, ou tout autre package,
tu peux l'utiliser — liste-le dans DEPENDENCIES et imports correctement.
Pour les editeurs de code : @monaco-editor/react est valide si le projet en a besoin.

════════════════════════════════════════════════════════════
REGLES ZUSTAND ABSOLUES
════════════════════════════════════════════════════════════

PARTIE A — Interface TypeScript (declaration des types) :
  interface AppState {
    count: number;
    items: Item[];
    loading: boolean;
    setCount: (n: number) => void;
    fetchItems: () => Promise<void>;
  }

PARTIE B — Corps du create() (OBJET LITTERAL JavaScript) :
  const useAppStore = create<AppState>()((set, get) => ({
    count: 0,
    items: [],
    loading: false,
    setCount: (n) => set({ count: n }),
    fetchItems: async () => {
      set({ loading: true });
      try {
        const data = await nomService.getItems();
        set({ items: data, loading: false });
      } catch (e) {
        set({ loading: false });
      }
    },
  }));

CRIME : setCount: () => void; dans le corps du create() → CRASH "Expression expected"
CRIME : count: 0; avec point-virgule → CRASH "Expected comma"

════════════════════════════════════════════════════════════
REGLES TYPES
════════════════════════════════════════════════════════════

- Interfaces pour tous les modeles de donnees
- Types union pour les etats : type Status = 'idle' | 'loading' | 'error' | 'success'
- Export named pour chaque type/interface
- Pas d'any sauf si vraiment inevitable
- TOUS les champs utilises dans les vues doivent etre declares

════════════════════════════════════════════════════════════
FORMAT DE SORTIE
════════════════════════════════════════════════════════════

Utilise UNIQUEMENT le format create_file. Ne mets pas de backticks autour du code.

<create_file path="lib/utils.ts">
code complet ici
</create_file>

<create_file path="types/index.ts">
code complet ici
</create_file>

<create_file path="services/nomService.ts">
code complet ici
</create_file>

<create_file path="stores/useNomStore.ts">
code complet ici
</create_file>

DEPENDENCIES: ["pkg-si-necessaire"]
DEVDEPENDENCIES: []

Genere du code PRODUCTION-READY. Pas de stubs. Pas de @monaco-editor/react.
`;

// =============================================================================
// PHASE 4 — CODE GEN UI PROMPT
// Génère : hooks/ + app/api/ + components/ui/
// =============================================================================

const CODE_GEN_UI_PROMPT = `
Tu es un Ingenieur Frontend Senior NextJS/TypeScript.
Tu generes la COUCHE ORCHESTRATION ET UI de l'application.
Tu as acces au manifeste de cablage et aux fichiers de fondation deja generes.

════════════════════════════════════════════════════════════
FICHIERS A GENERER (UNIQUEMENT CES COUCHES)
════════════════════════════════════════════════════════════

1. hooks/use*.ts — hooks d'orchestration (consomment services + stores)
2. app/api/**/route.ts — route handlers Next.js 15
3. components/ui/*.tsx — composants reutilisables (Button, Input, Card, Modal, etc.)

NE PAS generer : views, globals.css, layout.tsx, page.tsx.

════════════════════════════════════════════════════════════
PACKAGES INTERDITS
════════════════════════════════════════════════════════════

JAMAIS utiliser :
- @monaco-editor/react → utilise un textarea stylise
- ace-builds, react-ace → utilise un textarea stylise
- Tout package non certain d'exister sur npm

════════════════════════════════════════════════════════════
REGLES ABSOLUES
════════════════════════════════════════════════════════════

"use client" OBLIGATOIRE dans tout .tsx ou .ts qui utilise :
  useState, useEffect, useRef, useCallback, useMemo, useContext,
  useRouter, usePathname, useSearchParams, useParams,
  n'importe quel store Zustand,
  window, document, localStorage

ROUTE HANDLERS Next.js 15 :
  Correct : export async function GET(req: Request): Promise<Response>
  Correct : export async function POST(req: Request): Promise<Response>
  INTERDIT : export default function handler(...)
  Params : { params }: { params: Promise<{ id: string }> }
  Access : const { id } = await params;

COMPOSANTS UI :
  - Named exports TOUJOURS : export function Button(...) { ... }
  - Props typees avec interfaces
  - Animations avec framer-motion si le projet l'utilise :
    boxShadow (JAMAIS shadow qui n'existe pas dans framer-motion)
    scale: 1.05 (JAMAIS scale-105 qui est une classe Tailwind)

HOOKS :
  - Named exports : export function useNomHook() { ... }
  - Gerent loading/error states
  - Cleanup dans useEffect : return () => { ... }

════════════════════════════════════════════════════════════
FORMAT DE SORTIE — PAS DE BACKTICKS DANS LE CODE
════════════════════════════════════════════════════════════

Utilise UNIQUEMENT le format create_file. Ne mets pas de backticks autour du code.

<create_file path="hooks/useNomHook.ts">
"use client";
code complet ici
</create_file>

<create_file path="app/api/nom/route.ts">
code complet ici (pas de "use client" dans les routes)
</create_file>

<create_file path="components/ui/NomComponent.tsx">
"use client";
code complet ici
</create_file>

DEPENDENCIES: []

Chaque composant UI doit etre BEAU, ACCESSIBLE et REELLEMENT FONCTIONNEL.
`;

// =============================================================================
// PHASE 5 — CODE GEN VIEWS PROMPT
// Génère : components/views/ + app/globals.css + app/layout.tsx + app/page.tsx
// =============================================================================

const CODE_GEN_VIEWS_PROMPT = `
Tu es un Ingenieur Frontend Senior specialise UI/UX NextJS/TypeScript.
Tu generes la COUCHE VUE ET APPLICATION de l'application.
Tu as acces au manifeste de cablage ET aux fichiers deja generes.

════════════════════════════════════════════════════════════
FICHIERS A GENERER
════════════════════════════════════════════════════════════

1. components/views/*View.tsx — UNE view par section/page
2. components/Modals.tsx — tous les modals/dialogues
3. app/globals.css — variables CSS :root, styles globaux
4. app/layout.tsx — layout racine avec CDN links
5. app/page.tsx — routeur principal

════════════════════════════════════════════════════════════
REGLE ABSOLUE N°1 — COHERENCE DES TYPES
════════════════════════════════════════════════════════════

AVANT d'ecrire une view, consulte le WIRING MANIFEST pour connaitre :
  - Les champs exacts du store (STATE_FIELDS)
  - Les proprietes exactes de chaque interface (TYPE_CONTRACT)

REGLE : tu ne peux acceder QU'AUX champs declares dans le manifest.

Exemple CORRECT (si manifest dit: STATE_FIELDS = balance, positions, tradeHistory) :
  const { balance, positions, tradeHistory } = useTradeStore()
  positions.map(pos => pos.pnl)  // pnl doit etre dans TYPE_CONTRACT de Position

Exemple ERRONE qui cause CRASH :
  const { history } = useTradeStore()       // CRASH si 'history' n'est pas dans TradeState
  positions.map(pos => pos.quantity)        // CRASH si 'quantity' n'est pas dans Position
  positions.map(pos => pos.entryPrice)      // CRASH si le manifest dit 'avgPrice'

REGLE : les noms de proprietes dans les vues doivent etre IDENTIQUES aux noms dans les interfaces.
JAMAIS de synonymes. qty et quantity sont deux champs DIFFERENTS pour TypeScript.

════════════════════════════════════════════════════════════
REGLE ABSOLUE N°2 — EXPORTS NAMED
════════════════════════════════════════════════════════════

TOUJOURS named exports pour les views :
  export function ChartView() { ... }           CORRECT
  export default function ChartView() { ... }   INCORRECT → "not exported" errors

Dans app/page.tsx TOUJOURS :
  import { ChartView } from '@/components/views/ChartView';   CORRECT
  import ChartView from '@/components/views/ChartView';       INCORRECT

"use client" obligatoire dans TOUTES les views (elles utilisent des stores).

════════════════════════════════════════════════════════════
REGLE ABSOLUE N°3 — PACKAGES INTERDITS
════════════════════════════════════════════════════════════

JAMAIS : import Editor from '@monaco-editor/react'
JAMAIS : import { Editor } from '@monaco-editor/react'
Alternative : utilise un textarea avec font-mono et styles dark

JAMAIS : import AceEditor from 'react-ace'
Alternative : textarea stylise

════════════════════════════════════════════════════════════
CONTENU REEL OBLIGATOIRE
════════════════════════════════════════════════════════════

Chaque view doit avoir du VRAI CONTENU fonctionnel.
INTERDIT dans les views :
  - "Coming soon" ou "Under development"
  - TODO
  - onClick={() => {}} sur boutons principaux
  - Sections vides sans contenu

Chaque view :
  - importe et utilise son store Zustand (avec les bons champs du manifest)
  - importe et appelle son service dans useEffect si necessaire
  - a des handlers reels sur tous les boutons importants

════════════════════════════════════════════════════════════
REGLES app/page.tsx
════════════════════════════════════════════════════════════

"use client" en premiere ligne.
Gere le routing entre les views avec useState.
Importe TOUTES les views avec des named imports.

const views: Record<string, React.ComponentType> = {
  dashboard: DashboardView,
  analytics: AnalyticsView,
};
const ActiveView = views[activeTab] ?? DashboardView;

════════════════════════════════════════════════════════════
FORMAT DE SORTIE — PAS DE BACKTICKS DANS LE CODE
════════════════════════════════════════════════════════════

Utilise UNIQUEMENT le format create_file. Ne mets pas de backticks autour du code.

<create_file path="components/views/NomView.tsx">
"use client";
import { useNomStore } from '@/stores/useNomStore';
code complet et fonctionnel
export function NomView() { ... }
</create_file>

Design PREMIUM, contenu REEL, pas de placeholders, pas de @monaco-editor.
`;

// =============================================================================
// PHASE 6 — WIRE VERIFICATION PROMPT
// Vérifie que le câblage du manifeste est respecté, complète ce qui manque
// =============================================================================

const WIRE_VERIFY_PROMPT = `
Tu es un QA Engineer Senior + Architecte qui fait une revue de câblage.
Tu reçois : (1) le manifeste de câblage, (2) tous les fichiers générés.
Ta mission : vérifier que CHAQUE feature du manifeste est correctement câblée.

════════════════════════════════════════════════════════════
PROCESSUS D'AUDIT OBLIGATOIRE
════════════════════════════════════════════════════════════

Pour CHAQUE feature du manifeste, vérifie :

□ Le service existe et exporte les bonnes fonctions ?
□ Le store existe, les actions sont des VRAIES implémentations (pas void;) ?
□ La view existe avec un named export (export function XxxView) ?
□ La view importe et utilise réellement son store ?
□ La view appelle les services/fetch dans useEffect ?
□ app/page.tsx importe la view avec le bon style (named import) ?
□ Les noms d'export correspondent aux noms d'import ? (source principale de crash)
□ Chaque bouton/action UI a un handler réel dans le store ou service ?
□ Toutes les vues ont du contenu différent et réel ?

════════════════════════════════════════════════════════════
CORRECTIONS OBLIGATOIRES
════════════════════════════════════════════════════════════

Pour chaque problème trouvé, émet le fichier COMPLET corrigé.
NE PAS émettre les fichiers sans erreur.
NE PAS ajouter de nouvelles features — seulement câbler ce qui manque.

Cas courants à corriger :
1. View avec default export → ajouter named export (ou remplacer)
2. app/page.tsx avec wrong import → corriger le style d'import
3. Store avec void; dans create() → remplacer par vraie implémentation
4. View qui n'appelle jamais son service → ajouter useEffect + appel
5. Bouton onClick={() => {}} → ajouter le handler depuis le store

FORMAT :
<create_file path="chemin/fichier.tsx">
... fichier complet corrigé ...
</create_file>

Rapport de câblage en 5-8 lignes : ce qui était cassé et ce qui a été corrigé.
`;

// =============================================================================
// PHASE 7 — SELF AUDIT PROMPT
// Audit TypeScript strict : types, imports, syntaxe
// =============================================================================

const SELF_AUDIT_PROMPT = `
Tu es un compilateur TypeScript/ESLint + Expert Next.js 15.
Tu recois tous les fichiers d'une application.
Tu dois detecter et corriger TOUTES les erreurs qui feraient echouer le build.

════════════════════════════════════════════════════════════
CHECKLIST D'AUDIT EXHAUSTIVE
════════════════════════════════════════════════════════════

□ COHERENCE DES TYPES — LA PLUS IMPORTANTE :
  Methode : parse les interfaces dans types/index.ts et les stores
  Pour chaque view, verifie que :
    - Les proprietes accedees sur les objets (pos.pnl, item.qty) existent dans l'interface
    - Les champs destructures depuis les stores existent dans l'interface du store
  
  ERREUR COURANTE 1 : Property 'pnl' does not exist on type 'Position'
    Cause : la vue ecrit pos.pnl mais l'interface declare unrealizedPnl
    Fix : aligner le nom dans l'interface OU dans la vue (choisir un et corriger les deux)
  
  ERREUR COURANTE 2 : Property 'history' does not exist on type 'TradeState'  
    Cause : const { history } = useTradeStore() mais TradeState declare tradeHistory
    Fix : const { tradeHistory } = useTradeStore() ou ajouter history a l'interface

  ERREUR COURANTE 3 : Property 'quantity' does not exist on type 'Position'
    Cause : pos.quantity mais l'interface declare qty
    Fix : utiliser pos.qty dans la vue

□ PACKAGES INTERDITS :
  Si @monaco-editor/react est importe → remplacer par textarea :
    Avant : import Editor from '@monaco-editor/react'
    Apres : supprimer l'import, remplacer le composant par <textarea className="font-mono..." />

□ ZUSTAND — dans le corps du create() :
  ERREUR : setX: () => void; → CORRECTION : setX: (v) => set({ x: v }),
  ERREUR : x: 0;              → CORRECTION : x: 0,
  Cherche le pattern : colon + parentheses + arrow + void + semicolon dans les stores

□ "use client" MANQUANT :
  Fichier .tsx avec useState/useEffect/useRef → "use client" en ligne 1
  Fichier .tsx avec store Zustand → "use client" en ligne 1

□ IMPORTS CASSES :
  from '../stores/...' → from '@/stores/...'
  from '../../lib/...' → from '@/lib/...'

□ EXPORTS MAL TYPES :
  import { X } from './Fichier' mais Fichier a export default X → corriger en named export

□ NEXT.JS 15 :
  { params }: { params: { id: string } } → { params }: { params: Promise<{ id: string }> }

□ LIBRAIRIES :
  lightweight-charts v5 : addCandleSeries() PAS addCandlestickSeries()
  lightweight-charts v5 : IChartApiBase PAS IChartApi
  framer-motion : boxShadow PAS shadow, scale: 1.05 PAS scale-105

════════════════════════════════════════════════════════════
FORMAT DE SORTIE
════════════════════════════════════════════════════════════

Emet UNIQUEMENT les fichiers qui ont des erreurs reelles a corriger.
Chaque fichier emis est COMPLET (pas de diff).
Preserve le CSS, les classes Tailwind, la structure.

<create_file path="chemin/fichier.tsx">
fichier entier corrige
</create_file>

Liste des corrections en 3-5 lignes. RIEN D'AUTRE.
`;

// =============================================================================
// PHASE 8 — FIXER PROMPT (température 0.05)
// Correction chirurgicale ultra-précise sur erreurs résiduelles
// =============================================================================

const FIXER_PROMPT = `
Tu es un compilateur TypeScript de precision absolue.
Tu recois des fichiers avec des erreurs precises identifiees.
Tu CORRIGES uniquement l'erreur signalee. Tu ne changes RIEN d'autre.

REGLE 1 : Fichier complet — pas de diff, pas de "...", pas de placeholder.
REGLE 2 : Preserve integralement CSS, Tailwind, noms de variables, structure.
REGLE 3 : Une correction = un fichier. N'invente pas de corrections supplementaires.

════════════════════════════════════════════════════════════
CORRECTIONS TYPE PAR TYPE
════════════════════════════════════════════════════════════

ERREUR "Property X does not exist on type Y" :
  Cas 1 — pos.quantity mais interface declare qty :
    Fix dans la vue : remplace pos.quantity par pos.qty partout
  Cas 2 — la propriete n'existe nulle part dans l'interface :
    Fix dans types/index.ts : ajoute le champ manquant a l'interface
    ET assure-toi que le store l'initialise avec la bonne valeur par defaut

ERREUR "Property X does not exist on type StoreState" :
  Cas : const { history } = useTradeStore() mais TradeState n'a pas 'history'
  Fix option A : renomme history en tradeHistory dans la vue si c'est le bon nom
  Fix option B : ajoute history: Trade[] dans l'interface ET dans le create() body

ERREUR "Cannot find module '@monaco-editor/react'" :
  Fix : supprime l'import ET remplace le composant par :
    <textarea
      className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm p-4 resize-none outline-none"
      defaultValue={code}
      onChange={(e) => setCode(e.target.value)}
      spellCheck={false}
    />

ERREUR "X is not exported from Y" :
  Cas : import { ChartView } from '...' mais le fichier a export default ChartView
  Fix : change l'export en : export function ChartView() { ... }

Zustand void dans create() :
  Avant : setX: (v: T) => void;
  Apres : setX: (v: T) => set({ x: v }),

use client manquant :
  Ajoute "use client"; en toute premiere ligne

Import relatif :
  Avant : from '../../stores/useStore'
  Apres : from '@/stores/useStore'

lightweight-charts API :
  Avant : chart.addCandlestickSeries({...})
  Apres : chart.addCandleSeries({...})

FORMAT :
<create_file path="...">fichier complet</create_file>
Une phrase de correction. RIEN D'AUTRE.
`;

// =============================================================================
// PATCH-AGENT PROMPT — correction chirurgicale d'erreurs de build
// =============================================================================

// (alias for compat — real pipeline uses phase-specific prompts above)

// =============================================================================
// PATCH-AGENT PROMPT — correction chirurgicale d'erreurs de build
// =============================================================================

const PATCH_AGENT_PROMPT = `
Tu es un compilateur TypeScript/Next.js avec capacite de correction chirurgicale.

MISSION PATCH — REGLES ABSOLUES
1. Tu recois des erreurs de build precises avec les fichiers casses.
2. Tu corriges UNIQUEMENT les fichiers listes dans les erreurs.
3. Tu NE touches PAS aux autres fichiers.
4. Tu NE reecris PAS toute l'application — JAMAIS.
5. Tu fournis le fichier corrige en entier (pas de diff, pas de patch partiel).
6. JAMAIS de backticks autour du code dans ta reponse — utilise uniquement create_file.

════════════════════════════════════════════════════════════
ERREUR 1 — Property X does not exist on type Y
════════════════════════════════════════════════════════════

ERREUR : Property 'pnl' does not exist on type 'Position'
CAUSE : La vue utilise pos.pnl mais l'interface Position ne declare pas pnl
  Solutions (choisir UNE) :
  A) Ajoute pnl: number dans l'interface Position dans types/index.ts
     ET initialise pnl dans le service/store qui cree les Position
  B) Remplace pos.pnl par pos.unrealizedPnl si c'est le bon nom dans l'interface

ERREUR : Property 'quantity' does not exist on type 'Position'
CAUSE : La vue utilise pos.quantity mais l'interface declare qty
  Fix : remplace pos.quantity par pos.qty dans la vue

REGLE GENERALE : le nom dans la vue DOIT etre identique au nom dans l'interface.
JAMAIS de synonymes. qty != quantity, pnl != unrealizedPnl, avgPrice != entryPrice.

════════════════════════════════════════════════════════════
ERREUR 2 — Property X does not exist on type StoreState
════════════════════════════════════════════════════════════

ERREUR : Property 'history' does not exist on type 'TradeState'
CAUSE : const { history } = useTradeStore() mais TradeState declare tradeHistory
  Fix A : change history en tradeHistory dans la destructuration de la vue
  Fix B : ajoute history: Trade[] dans l'interface TradeState ET dans le create() body

ERREUR : Property 'orders' does not exist on type 'MarketState'
CAUSE : La view destructure orders mais le store ne l'expose pas
  Fix : ajoute orders: Order[] dans l'interface ET dans create() avec orders: []

════════════════════════════════════════════════════════════
ERREUR 3 — Cannot find module '@monaco-editor/react'
════════════════════════════════════════════════════════════

CAUSE : @monaco-editor/react n'est pas installe / incompatible
  Fix OBLIGATOIRE :
  1. Supprime l'import monaco
  2. Remplace le composant Editor par un textarea :
     <textarea
       className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm p-4 resize-none outline-none border border-[#3c3c3c]"
       defaultValue={code}
       onChange={(e) => setCode(e.target.value)}
       spellCheck={false}
     />

════════════════════════════════════════════════════════════
ERREUR 4 — Zustand "Expression expected" / "Expected comma"
════════════════════════════════════════════════════════════

CAUSE : setCount: () => void; dans le corps du create()
  Mauvais → setCount: () => void;
  Correct → setCount: (n: number) => set({ count: n }),

Interface (AUTORISE) :
  interface FooState { setCount: (n: number) => void; }
Corps create() (OBLIGATOIRE) :
  setCount: (n) => set({ count: n }),

════════════════════════════════════════════════════════════
AUTRES ERREURS FREQUENTES
════════════════════════════════════════════════════════════

"X is not exported from Y" :
  Fix : change l'export en named : export function X() { ... }
  ET : import { X } from '@/components/views/...' (named import)

"already declared" → identifiant importe deux fois → supprime le doublon
"Cannot find module" → mauvais chemin → corrige vers @/...
"use client" missing → ajoute en premiere ligne
params without await → ajoute Promise et await
addCandlestickSeries → remplace par addCandleSeries

════════════════════════════════════════════════════════════
FORMAT DE REPONSE
════════════════════════════════════════════════════════════

Pour chaque fichier casse, fournis le fichier complet corrige :

<create_file path="stores/marketStore.ts">
fichier entier corrige, pas de placeholder
</create_file>

Puis une phrase expliquant ce qui a ete corrige.
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
              // Contexte complet du projet pour le type safety fixer (il a besoin des interfaces)
              const allProjectFiles: GeneratedFile[] = currentProjectFiles
                ? currentProjectFiles.map((f: any) => ({ path: f.path, content: f.content }))
                : targetFiles;

              // Applique le type safety fixer en premier (mismatch interface/usage + Monaco)
              const typeSafeFixed = runTypeSafetyFixer(allProjectFiles);
              const typeSafeTargets = targetFiles.map(tf => {
                const fixed = typeSafeFixed.find(f => f.path === tf.path);
                return fixed ?? tf;
              });

              // Applique le correcteur Zustand spécialisé
              const zustandFixed = typeSafeTargets.map(f => ({
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
          // MODE BUILD — PIPELINE 8 PHASES (appels API séparés + retry 503)
          // ════════════════════════════════════════════════════════════════

          // Helper pour merger les fichiers générés dans le registre global
          function mergeFiles(files: GeneratedFile[]) {
            for (const f of files) {
              const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
              if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
              createdPaths.add(f.path);
            }
          }

          // Helper pour appliquer les correcteurs programmatiques après chaque phase
          function applyProgrammaticFixers() {
            // 1. Type safety fixer (store/interface coherence + Monaco replacement)
            const typeSafe = runTypeSafetyFixer(allGeneratedFiles);
            for (let i = 0; i < typeSafe.length; i++) allGeneratedFiles[i] = typeSafe[i];
            // 2. Zustand store fixer
            const zustandFixed = allGeneratedFiles.map(f => ({
              ...f,
              content: (f.path.includes("store") || f.path.includes("Store"))
                ? fixZustandStore(f.content) : f.content,
            }));
            for (let i = 0; i < zustandFixed.length; i++) {
              if (zustandFixed[i].content !== allGeneratedFiles[i].content) {
                allGeneratedFiles[i] = zustandFixed[i];
              }
            }
            // 3. General rule-based fixer (2 passes)
            const { files: fixed1 } = runFixer(allGeneratedFiles);
            for (let i = 0; i < fixed1.length; i++) allGeneratedFiles[i] = fixed1[i];
            const { files: fixed2 } = runFixer(fixed1);
            for (let i = 0; i < fixed2.length; i++) allGeneratedFiles[i] = fixed2[i];
          }

          // Helper stream chunk → emit
          let buffer = "";
          function onChunk(txt: string) {
            buffer += txt;
            if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
          }
          function flushBuffer() {
            if (buffer.trim()) { emit(buffer); buffer = ""; }
          }

          const manifest = createdPaths.size > 0
            ? `FICHIERS EXISTANTS :\n${Array.from(createdPaths).join("\n")}`
            : "NOUVEAU PROJET.";

          // ─────────────────────────────────────────────────────────────────
          // PRESENTER INTRO — Message d'accueil visible, avant toutes les phases
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PRESENTER:INTRO]\n");

          const presenterIntroOutput = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `Demande utilisateur : "${lastUserMsg}"` }] }],
              config: {
                systemInstruction: PRESENTER_INTRO_PROMPT,
                temperature: 1.8,
                maxOutputTokens: 512,
              },
            }),
            onChunk,
            { maxAttempts: 3, baseDelay: 8000 }
          );
          flushBuffer();
          emit("\n[/PRESENTER:INTRO]\n");

          await sleep(1000);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 1 — PRODUCT THINKING
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:1/PRODUCT_THINKING]\n");
          await sleep(1500);

          const phase1Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `
DEMANDE UTILISATEUR:
"${lastUserMsg}"

${designAnchor}
${colorCtx}
${manifest}

Produis la PRODUCT SPEC COMPLÈTE selon le format de ton prompt système.
Sois EXHAUSTIF — ce document sera utilisé par 6 agents de développement différents.
              ` }] }],
              config: {
                systemInstruction: PRODUCT_THINKING_PROMPT,
                temperature: 1.6,
                maxOutputTokens: 8192,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 12000 }
          );
          flushBuffer();

          const productSpec = phase1Output.match(/=== PRODUCT SPEC ===([\s\S]*?)=== END SPEC ===/)?.[0]
            ?? phase1Output;

          await sleep(2500);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 2 — FEATURE INVENTORY
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:2/FEATURE_INVENTORY]\n");

          const phase2Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `
PRODUCT SPEC:
${productSpec}

DEMANDE ORIGINALE:
"${lastUserMsg}"

Produis le WIRING MANIFEST COMPLET selon le format de ton prompt système.
Spécifie les noms d'export EXACTS (named/default) pour chaque fichier.
C'est critique pour éviter les erreurs "X is not exported from Y".
              ` }] }],
              config: {
                systemInstruction: FEATURE_INVENTORY_PROMPT,
                temperature: 1.4,
                maxOutputTokens: 8192,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 12000 }
          );
          flushBuffer();

          const wiringManifest = phase2Output.match(/=== WIRING MANIFEST ===([\s\S]*?)=== END MANIFEST ===/)?.[0]
            ?? phase2Output;

          await sleep(2500);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 3 — CODE GEN FOUNDATION
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:3/CODE_FOUNDATION]\n");

          const phase3Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: buildHistory(`
=== PRODUCT SPEC ===
${productSpec}

=== WIRING MANIFEST ===
${wiringManifest}

=== INSTRUCTION ===
Génère UNIQUEMENT les fichiers de la couche fondation :
lib/utils.ts, lib/env.ts, types/index.ts, services/*.ts, stores/*.ts

RÈGLE ZUSTAND ABSOLUE dans le corps du create() :
- JAMAIS setX: () => void;  → TOUJOURS setX: (v) => set({ x: v }),
- JAMAIS fetch: () => void; → TOUJOURS fetchX: async () => { ... },
- Chaque propriété séparée par une VIRGULE, jamais un point-virgule

Suis le WIRING MANIFEST à la lettre pour les noms de fonctions et exports.
Termine par DEPENDENCIES: ["pkg1", "pkg2"] listant TOUS les packages npm nécessaires.
              `),
              tools: [{ functionDeclarations: [readFileDecl] }],
              config: {
                systemInstruction: CODE_GEN_FOUNDATION_PROMPT,
                temperature: 1.6,
                maxOutputTokens: 32768,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 15000 }
          );
          flushBuffer();

          mergeFiles(parseGeneratedFiles(phase3Output));
          extractDeps(phase3Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(phase3Output, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          // Scan tous les imports pour détecter les packages utilisés
          parseGeneratedFiles(phase3Output).forEach(f => {
            const imports = f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g);
            for (const m of imports) { const pkg = m[1].split("/")[0]; if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg); }
          });
          applyProgrammaticFixers();

          await sleep(3000);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 4 — CODE GEN UI
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:4/CODE_UI]\n");

          const foundationSummary = allGeneratedFiles
            .map(f => `FILE: ${f.path}\n${f.content.split("\n").slice(0, 5).join("\n")}`)
            .join("\n---\n");

          const phase4Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `
=== PRODUCT SPEC ===
${productSpec.slice(0, 3000)}

=== WIRING MANIFEST ===
${wiringManifest}

=== FICHIERS FONDATION DÉJÀ GÉNÉRÉS (résumé) ===
${foundationSummary.slice(0, 4000)}

=== INSTRUCTION ===
Génère UNIQUEMENT la couche orchestration et UI :
hooks/use*.ts, app/api/**/route.ts, components/ui/*.tsx

"use client" obligatoire dans TOUT tsx avec hooks/Zustand.
Route handlers: export async function GET/POST — JAMAIS export default.
Components: named exports TOUJOURS.
Consomme les stores et services déjà définis dans le manifeste.
Termine par DEPENDENCIES: ["pkg1", "pkg2"] listant TOUS les packages npm nécessaires.
              ` }] }],
              config: {
                systemInstruction: CODE_GEN_UI_PROMPT,
                temperature: 1.6,
                maxOutputTokens: 32768,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 15000 }
          );
          flushBuffer();

          mergeFiles(parseGeneratedFiles(phase4Output));
          extractDeps(phase4Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(phase4Output, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          parseGeneratedFiles(phase4Output).forEach(f => {
            const imports = f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g);
            for (const m of imports) { const pkg = m[1].split("/")[0]; if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg); }
          });
          applyProgrammaticFixers();

          await sleep(3000);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 5 — CODE GEN VIEWS
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:5/CODE_VIEWS]\n");

          const exportRegistry = wiringManifest.match(/EXPORT_REGISTRY:([\s\S]*?)(?:=== END|$)/)?.[1]
            ?? wiringManifest;

          const allPathsSoFar = allGeneratedFiles.map(f => f.path).join("\n");

          const phase5Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: buildHistory(`
=== PRODUCT SPEC ===
${productSpec.slice(0, 2500)}

=== EXPORT REGISTRY DU MANIFESTE ===
${exportRegistry.slice(0, 2000)}

=== FICHIERS DÉJÀ GÉNÉRÉS ===
${allPathsSoFar}

${designAnchor}
${colorCtx}

=== INSTRUCTION ===
Génère la couche vue et application :
components/views/*View.tsx, components/Modals.tsx, app/globals.css, app/layout.tsx, app/page.tsx

RÈGLES CRITIQUES EXPORTS :
- TOUTES les views : export function NomView() — NAMED, jamais export default
- app/page.tsx : import { NomView } from '@/components/views/NomView' — NAMED import
- "use client" obligatoire dans TOUTES les views et page.tsx

CONTENU RÉEL dans chaque view — ZÉRO "Coming soon", ZÉRO onClick={() => {}} sur boutons principaux.
Chaque view importe et utilise son store Zustand + services.

Suis EXACTEMENT le EXPORT REGISTRY pour les noms d'exports et imports.
Termine par DEPENDENCIES: ["pkg1", "pkg2"] listant TOUS les packages npm nécessaires.
              `),
              tools: [{ functionDeclarations: [readFileDecl] }],
              config: {
                systemInstruction: CODE_GEN_VIEWS_PROMPT,
                temperature: 1.6,
                maxOutputTokens: 32768,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 15000 }
          );
          flushBuffer();

          mergeFiles(parseGeneratedFiles(phase5Output));
          extractDeps(phase5Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(phase5Output, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          parseGeneratedFiles(phase5Output).forEach(f => {
            const imports = f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g);
            for (const m of imports) { const pkg = m[1].split("/")[0]; if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg); }
          });
          applyProgrammaticFixers();

          if (allGeneratedFiles.length === 0) {
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          await sleep(3000);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 6 — WIRE VERIFICATION
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:6/WIRE_VERIFICATION]\n");

          const wireCheckFiles = allGeneratedFiles
            .filter(f =>
              f.path.includes("page.tsx") ||
              f.path.includes("store") || f.path.includes("Store") ||
              f.path.includes("views/") ||
              f.path.includes("services/")
            )
            .map(f => `\n=== ${f.path} ===\n${f.content}`)
            .join("\n");

          const phase6Output = await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `
=== WIRING MANIFEST ===
${wiringManifest}

=== FICHIERS CLÉS À VÉRIFIER ===
${wireCheckFiles.slice(0, 28000)}

=== DEMANDE ORIGINALE ===
"${lastUserMsg}"

Vérifie que CHAQUE feature du manifeste est correctement câblée.
Émet UNIQUEMENT les fichiers avec des corrections réelles.
Fichiers complets — pas de diff.
Si tu ajoutes des imports de packages → ajoute DEPENDENCIES: ["pkg"] à la fin.
              ` }] }],
              config: {
                systemInstruction: WIRE_VERIFY_PROMPT,
                temperature: 1.0,
                maxOutputTokens: 24576,
              },
            }),
            onChunk,
            { maxAttempts: 4, baseDelay: 12000 }
          );
          flushBuffer();

          mergeFiles(parseGeneratedFiles(phase6Output));
          extractDeps(phase6Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(phase6Output, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          applyProgrammaticFixers();

          await sleep(2500);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 7 — SELF AUDIT TypeScript
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:7/SELF_AUDIT]\n");

          const auditCandidates = allGeneratedFiles.filter(f => {
            const c = f.content;
            return (
              f.path.endsWith(".ts") || f.path.endsWith(".tsx")
            ) && (
              c.includes("create<") ||
              (c.includes("useState") && !c.includes('"use client"') && !c.includes("'use client'")) ||
              c.includes("addCandlestickSeries") ||
              c.includes("IChartApi") ||
              /import\s*\{[^}]+\}\s*from\s*['"]\.\.\//.test(c) ||
              /case\s+['"][^'"]*&apos;/.test(c)
            );
          });

          const allFilesForAudit = [
            ...auditCandidates,
            ...allGeneratedFiles.filter(f =>
              f.path === "app/page.tsx" ||
              (f.path.includes("store") && !auditCandidates.find(a => a.path === f.path))
            ),
          ].filter((f, i, arr) => arr.findIndex(a => a.path === f.path) === i);

          if (allFilesForAudit.length > 0) {
            const auditContext = allFilesForAudit
              .map(f => `\n=== ${f.path} ===\n${f.content}`)
              .join("\n");

            const phase7Output = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: [{ role: "user", parts: [{ text: `
Fais un audit TypeScript complet sur ces fichiers.
Corrige TOUTES les erreurs qui feraient échouer le build.

${auditContext.slice(0, 30000)}

Émet uniquement les fichiers avec des corrections réelles. Fichiers complets.
Si tu utilises de nouveaux packages → ajoute DEPENDENCIES: ["pkg"] à la fin.
                ` }] }],
                config: {
                  systemInstruction: SELF_AUDIT_PROMPT,
                  temperature: 0.6,
                  maxOutputTokens: 24576,
                },
              }),
              onChunk,
              { maxAttempts: 4, baseDelay: 12000 }
            );
            flushBuffer();

            mergeFiles(parseGeneratedFiles(phase7Output));
            extractDeps(phase7Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
            applyProgrammaticFixers();
          }

          await sleep(2000);

          // ─────────────────────────────────────────────────────────────────
          // PHASE 8 — POLISH (corrections résiduelles + ajustements demandés)
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PHASE:8/POLISH]\n");

          const stillBroken = allGeneratedFiles.filter(f => {
            const c = f.content;
            return (
              (f.path.endsWith(".ts") && c.includes("create<") &&
                /:\s*\(\s*[^)]*\)\s*=>\s*void\s*;/.test(c.replace(/interface\s+\w+[\s\S]*?\n\}/g, ""))) ||
              (f.path.endsWith(".tsx") && !f.path.includes("layout") && !f.path.includes("api") &&
                /\b(useState|useEffect|useRef|useRouter|useCallback)\b/.test(c) &&
                !c.includes('"use client"') && !c.includes("'use client'")) ||
              /case\s+['"][^'"]*&apos;/.test(c) ||
              c.includes("addCandlestickSeries") ||
              /import\s*\{[^}]+\}\s*from\s*['"]\.\.\//.test(c)
            );
          });

          if (stillBroken.length > 0) {
            const fixerCtx = stillBroken
              .map(f => `\n=== ${f.path} ===\n${f.content}`)
              .join("\n");

            const phase8Output = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: [{ role: "user", parts: [{ text: `
Ces fichiers ont encore des erreurs détectées automatiquement. Corrige-les :

${fixerCtx.slice(0, 20000)}

Fichier complet pour chaque correction. Ne touche à rien d'autre.
Si tu utilises de nouveaux packages → ajoute DEPENDENCIES: ["pkg"] à la fin.
                ` }] }],
                config: {
                  systemInstruction: FIXER_PROMPT,
                  temperature: 0.4,
                  maxOutputTokens: 16384,
                },
              }),
              onChunk,
              { maxAttempts: 4, baseDelay: 12000 }
            );
            flushBuffer();

            mergeFiles(parseGeneratedFiles(phase8Output));
            extractDeps(phase8Output, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          }

          // ── Passes programmatiques finales ──────────────────────────────
          applyProgrammaticFixers();
          const { files: finalPass } = runFixer(allGeneratedFiles);
          for (let i = 0; i < finalPass.length; i++) {
            if (finalPass[i].content !== allGeneratedFiles[i].content) {
              allGeneratedFiles[i] = finalPass[i];
              emit(`<create_file path="${finalPass[i].path}">\n${finalPass[i].content}\n</create_file>`);
            }
          }
          for (const f of allGeneratedFiles) {
            emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
          }

          // ── Packages ────────────────────────────────────────────────────
          // Scan TOUS les fichiers générés pour récupérer les imports non déclarés
          for (const f of allGeneratedFiles) {
            const imports = f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g);
            for (const m of imports) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".") && !pkg.startsWith("next") && pkg !== "react" && pkg !== "react-dom") {
                globalPkgs.add(pkg);
              }
            }
          }

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

          // ─────────────────────────────────────────────────────────────────
          // PRESENTER OUTRO — Résumé visible après toutes les phases
          // ─────────────────────────────────────────────────────────────────
          emit("\n[PRESENTER:OUTRO]\n");

          const builtFeaturesList = allGeneratedFiles
            .filter(f => f.path.includes("views/") || f.path.includes("components/"))
            .map(f => f.path.split("/").pop()?.replace(".tsx", "").replace(".ts", ""))
            .filter(Boolean)
            .join(", ");

          await callWithRetry(
            () => ai.models.generateContentStream({
              model: MODEL_ID,
              contents: [{ role: "user", parts: [{ text: `
Demande originale : "${lastUserMsg}"

Fonctionnalités construites (noms de composants) : ${builtFeaturesList}
Nombre total de fichiers : ${allGeneratedFiles.length}

Écris le message de conclusion selon ton prompt système.
              ` }] }],
              config: {
                systemInstruction: PRESENTER_OUTRO_PROMPT,
                temperature: 1.8,
                maxOutputTokens: 512,
              },
            }),
            onChunk,
            { maxAttempts: 3, baseDelay: 8000 }
          );
          flushBuffer();
          emit("\n[/PRESENTER:OUTRO]\n");

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

            
