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

/**
 * Vérifie si un import spécifique existe déjà dans le fichier
 * Gère tous les formats possibles : import { x } from "y", import {x} from 'y', etc.
 */
function hasImport(content: string, importName: string, fromPath: string): boolean {
  // Nettoie le contenu pour la recherche
  const lines = content.split('\n');
  
  // Cherche dans chaque ligne
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Ignore les commentaires
    if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    
    // Vérifie si c'est une ligne d'import qui correspond
    if (trimmed.startsWith('import ')) {
      // Extrait la partie from "..." ou from '...'
      const fromMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
      if (!fromMatch) continue;
      
      const importPath = fromMatch[1];
      
      // Vérifie si le chemin correspond (avec ou sans @/)
      const normalizedPath = fromPath.replace(/^@\//, '');
      const normalizedImportPath = importPath.replace(/^@\//, '');
      
      if (normalizedPath !== normalizedImportPath) continue;
      
      // Vérifie si l'import contient le nom recherché
      // Gère : import { cn }, import {cn}, import { cn, other }, etc.
      const importNames = trimmed.match(/import\s+\{([^}]+)\}/);
      if (!importNames) continue;
      
      const names = importNames[1].split(',').map(n => n.trim());
      if (names.includes(importName)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Vérifie si "use client" existe déjà dans le fichier
 */
function hasUseClient(content: string): boolean {
  const firstLines = content.split('\n').slice(0, 5).join('\n');
  return /['"]use client['"];?/.test(firstLines);
}

const FIX_RULES: FixRule[] = [
  // ── "use client" manquant — hooks ─────────────────────────────────────────
  {
    name: "use-client-hooks",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api") && !p.includes("layout.tsx")
      && /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer)\b/.test(c)
      && !hasUseClient(c),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — router hooks ──────────────────────────────────
  {
    name: "use-client-router",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /\b(useRouter|usePathname|useSearchParams|useParams)\b/.test(c)
      && !hasUseClient(c),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — window/document ───────────────────────────────
  {
    name: "use-client-window",
    detect: (p, c) => p.endsWith(".tsx") && /\bwindow\.\w+|\bdocument\.\w+/.test(c)
      && !hasUseClient(c),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" manquant — zustand subscribe ─────────────────────────────
  {
    name: "use-client-zustand",
    detect: (p, c) => p.endsWith(".tsx") && !p.includes("app/api")
      && /use[A-Z]\w*Store\b/.test(c)
      && !hasUseClient(c),
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
  // CORRECTION MAJEURE : Vérifie vraiment si l'import existe déjà
  {
    name: "missing-cn-import",
    detect: (_, c) => c.includes("cn(") 
      && !c.includes("function cn") 
      && !c.includes("const cn")
      && !hasImport(c, "cn", "@/lib/utils")
      && !hasImport(c, "cn", "lib/utils"),
    fix: (_, c) => {
      const line = `import { cn } from "@/lib/utils";`;
      if (hasUseClient(c)) {
        // Ajoute après "use client"
        return c.replace(/(['"]use client['"]\s*;?\n)/, `$1${line}\n`);
      } else {
        // Ajoute au début
        return `${line}\n${c}`;
      }
    },
  },
  // ── Next.js 15 — params Promise ───────────────────────────────────────────
  {
    name: "nextjs15-params-promise",
    detect: (p, c) =>
      (p.includes("app/") && (p.endsWith("/page.tsx") || p.endsWith("/layout.tsx")))
      && /\bparams\s*:\s*\{/.test(c)
      && !/Promise<\{/.test(c),
    fix: (_, c) => c
      .replace(/(\bparams\s*:\s*)\{/g, "$1Promise<{")
      .replace(/(Promise<\{[^}]*\})\s*\)/g, "$1>)"),
  },
  // ── Next.js 15 — searchParams Promise ─────────────────────────────────────
  {
    name: "nextjs15-searchparams-promise",
    detect: (p, c) => p.includes("app/") && p.endsWith("/page.tsx")
      && /\bsearchParams\s*:\s*\{/.test(c)
      && !/Promise<\{/.test(c),
    fix: (_, c) => c
      .replace(/(\bsearchParams\s*:\s*)\{/g, "$1Promise<{")
      .replace(/(Promise<\{[^}]*\})\s*\)/g, "$1>)"),
  },
  // ── async page/layout ─────────────────────────────────────────────────────
  {
    name: "nextjs15-async-page",
    detect: (p, c) => (p.endsWith("/page.tsx") || p.endsWith("/layout.tsx"))
      && /params\s*:\s*Promise</.test(c)
      && !/export\s+default\s+async\s+function/.test(c),
    fix: (_, c) => c.replace(/export\s+default\s+function/g, "export default async function"),
  },
  // ── await params/searchParams ─────────────────────────────────────────────
  {
    name: "nextjs15-await-params",
    detect: (_, c) => /params\s*:\s*Promise</.test(c)
      && /const\s+\w+\s*=\s*params\./.test(c)
      && !/await\s+params/.test(c),
    fix: (_, c) => c.replace(/const\s+(\w+)\s*=\s*params\./g, "const $1 = (await params)."),
  },
  {
    name: "nextjs15-await-searchParams",
    detect: (_, c) => /searchParams\s*:\s*Promise</.test(c)
      && /const\s+\w+\s*=\s*searchParams\./.test(c)
      && !/await\s+searchParams/.test(c),
    fix: (_, c) => c.replace(/const\s+(\w+)\s*=\s*searchParams\./g, "const $1 = (await searchParams)."),
  },
  // ── Next.js Image manquant ────────────────────────────────────────────────
  {
    name: "missing-next-image",
    detect: (_, c) => /<Image\s/.test(c) && !c.includes('from "next/image"') && !c.includes("from 'next/image'"),
    fix: (_, c) => {
      const line = `import Image from "next/image";`;
      if (hasUseClient(c)) {
        return c.replace(/(['"]use client['"]\s*;?\n)/, `$1${line}\n`);
      } else {
        return `${line}\n${c}`;
      }
    },
  },
  // ── Next.js Link manquant ─────────────────────────────────────────────────
  {
    name: "missing-next-link",
    detect: (_, c) => /<Link\s/.test(c) && !c.includes('from "next/link"') && !c.includes("from 'next/link'"),
    fix: (_, c) => {
      const line = `import Link from "next/link";`;
      if (hasUseClient(c)) {
        return c.replace(/(['"]use client['"]\s*;?\n)/, `$1${line}\n`);
      } else {
        return `${line}\n${c}`;
      }
    },
  },
  // ── clsx import manquant ──────────────────────────────────────────────────
  {
    name: "missing-clsx",
    detect: (_, c) => /\bclsx\(/.test(c) 
      && !hasImport(c, "clsx", "clsx")
      && !c.includes("function clsx"),
    fix: (_, c) => {
      const line = `import clsx from "clsx";`;
      if (hasUseClient(c)) {
        return c.replace(/(['"]use client['"]\s*;?\n)/, `$1${line}\n`);
      } else {
        return `${line}\n${c}`;
      }
    },
  },
];

// ─── FONCTION FIXER ────────────────────────────────────────────────────────

function runFixer(inputFiles: GeneratedFile[]): {
  files: GeneratedFile[];
  logs: string[];
} {
  const logs: string[] = [];
  const files = inputFiles.map((f) => ({ ...f }));

  for (const rule of FIX_RULES) {
    for (let i = 0; i < files.length; i++) {
      const { path, content } = files[i];
      if (rule.detect(path, content)) {
        const fixed = rule.fix(path, content);
        if (fixed !== content) {
          files[i].content = fixed;
          logs.push(`[${rule.name}] ${path}`);
        }
      }
    }
  }

  return { files, logs };
}

// =============================================================================
// FONCTION READ_FILE
// =============================================================================

const readFileDecl: FunctionDeclaration = {
  name: "read_file",
  description: "Lit le contenu d'un fichier existant du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Chemin du fichier (ex. src/app/page.tsx)" },
    },
    required: ["path"],
  },
};

// =============================================================================
// MEGA PROMPT
// =============================================================================

const MEGA_AGENT_PROMPT = `
TU ES L'IA ARCHITECTE FULLSTACK NEXT.JS 15 — GÉNÉRATION COMPLÈTE ET STRUCTURÉE

=== MISSION CRITIQUE ===
Construire des projets Next.js 15 complets, fonctionnels, sans aucune troncature.
TOUS les fichiers doivent être générés intégralement.
Aucune simulation. Aucun placeholder. Production ready uniquement.

=== STRUCTURE OBLIGATOIRE ===

1. **SERVICES EN PREMIER** (avant tout UI)
   - Créer TOUS les services nécessaires dans src/services/
   - Types, interfaces, configurations
   - Chaque service complet, testé, prêt à l'emploi

2. **COMPOSANTS UI ENSUITE**
   - Connectés aux services créés
   - Hooks et state management
   - Styling complet Tailwind

3. **PAGES ET LAYOUTS**
   - Routes Next.js 15
   - Métadonnées
   - Error boundaries

=== RÈGLES SYNTAXE CRITIQUE ===

**APOSTROPHES — RÈGLE ABSOLUE :**
- Dans switch/case, useState, props : APOSTROPHE DROITE NORMALE (')
  ✅ case 'home': 
  ✅ useState('value')
  ✅ const view = 'dashboard'
  
- Dans JSX text uniquement : &apos;
  ✅ <p>C&apos;est correct</p>
  
- JAMAIS &apos; dans le code TypeScript
  ❌ case 'home&apos;:  ← CRASH BUILD IMMÉDIAT
  ❌ useState('val&apos;')  ← ERREUR COMPILATION

**NEXT.JS 15 — ASYNC PAGES OBLIGATOIRE :**
\`\`\`typescript
export default async function Page({ 
  params,
  searchParams 
}: { 
  params: Promise<{ id: string }>,
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params;
  const { query } = await searchParams;
  // ...
}
\`\`\`

**IMPORTS REQUIS :**
- cn() → import { cn } from "@/lib/utils"
- clsx() → import clsx from "clsx"
- <Image> → import Image from "next/image"
- <Link> → import Link from "next/link"

**"use client" OBLIGATOIRE pour :**
- Tous hooks React (useState, useEffect, etc.)
- window, document, localStorage
- Event handlers (onClick, onChange, etc.)
- Zustand stores

=== FORMAT GÉNÉRATION ===

<create_file path="chemin/fichier.tsx">
[CONTENU COMPLET DU FICHIER - AUCUNE TRONCATURE]
</create_file>

**ORDRE DE GÉNÉRATION :**
1. Services et utilities
2. Types et interfaces
3. Composants réutilisables
4. Pages et layouts
5. Configuration (si nécessaire)

=== QUALITY GATES ===

Avant d'envoyer un fichier :
✓ Aucun placeholder ou TODO
✓ Toutes les fonctions implémentées
✓ Imports corrects et complets
✓ Syntaxe Next.js 15 respectée
✓ Types TypeScript stricts
✓ Pas d'apostrophes &apos; dans le code TS

=== DÉPENDANCES ===

Déclare à la fin :
DEPENDENCIES: ["package-name", "autre-package"]
DEVDEPENDENCIES: ["@types/something"]

AUTO-AJOUTÉES : next, react, tailwind, clsx, tailwind-merge, zustand, lucide-react, sharp

=== RAPPEL FINAL ===
GÉNÈRE TOUT. COMPLET. FONCTIONNEL.
Pas de "... reste du code" ou "// TODO".
Chaque fichier = production ready.
`;

// =============================================================================
// RESOLVE TYPES
// =============================================================================

async function resolveTypes(packages: string[], existingDevDeps: Record<string, string>) {
  const types: Record<string, string> = {};
  await Promise.all(
    packages.map(async (pkg) => {
      const typePkg = `@types/${pkg.replace(/^@/, "").replace(/\//g, "__")}`;
      if (existingDevDeps[typePkg]) return;
      try {
        const d = await packageJson(typePkg);
        types[typePkg] = d.version as string;
      } catch {
        // Pas de types disponibles
      }
    })
  );
  return types;
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(req: Request) {
  try {
    const {
      apiKey,
      prompt,
      history = [],
      uploadedImages = [],
      allReferenceImages = [],
      hasImages = false,
      currentProjectFiles = [],
      designAnchor = "",
      colorContext = "",
    } = await req.json();

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();
    const lastUserMsg = prompt || (history.length ? history[history.length - 1]?.content : "");

    const colorCtx = colorContext
      ? `PALETTE COULEURS :\n${colorContext}\nApplique cette palette dans tout le design.`
      : "";

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
