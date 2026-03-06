import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";
import { Sandbox } from "@e2b/code-interpreter";

const BATCH_SIZE = 256;
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
function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  // Cas normal : tag fermant présent
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });

  // Cas tronqué : tag ouvrant présent mais tag fermant absent (stream coupé)
  // On récupère quand même le contenu partiel si le fichier n'a pas déjà été parsé
  if (output.includes("<create_file ")) {
    const rxOpen = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxOpen.exec(output)) !== null) {
      const path = mo[1];
      const content = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (content.length > 50 && !files.find(f => f.path === path)) {
        files.push({ path, content });
      }
    }
  }
  return files;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// STR_REPLACE — édition chirurgicale de fichiers
// =============================================================================

interface StrReplaceOp { path: string; oldStr: string; newStr: string; }

function parseStrReplaceOps(output: string): StrReplaceOp[] {
  const ops: StrReplaceOp[] = [];
  const rx = /<str_replace path="([^"]+)">\s*<old_str>([\s\S]*?)<\/old_str>\s*<new_str>([\s\S]*?)<\/new_str>\s*<\/str_replace>/g;
  let m;
  while ((m = rx.exec(output)) !== null) ops.push({ path: m[1].trim(), oldStr: m[2], newStr: m[3] });
  return ops;
}

function applyStrReplaceToFiles(
  allFiles: { path: string; content: string }[],
  ops: StrReplaceOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];
  for (const op of ops) {
    const idx = allFiles.findIndex(f => f.path === op.path);
    if (idx < 0) { failed.push({ path: op.path, reason: "Fichier introuvable" }); continue; }
    if (!allFiles[idx].content.includes(op.oldStr)) { failed.push({ path: op.path, reason: "old_str introuvable" }); continue; }
    allFiles[idx] = { ...allFiles[idx], content: allFiles[idx].content.replace(op.oldStr, op.newStr) };
    applied++;
  }
  return { applied, failed };
}

function detectEnvVars(files: { path: string; content: string }[]): string[] {
  const envSet = new Set<string>();
  const rx = /process\.env\.([A-Z_][A-Z0-9_]+)/g;
  for (const f of files) { let m; while ((m = rx.exec(f.content)) !== null) envSet.add(m[1]); }
  const builtins = new Set(["NODE_ENV","PORT","VERCEL","VERCEL_URL","NEXT_RUNTIME"]);
  return Array.from(envSet).filter(v => !builtins.has(v)).sort();
}

// =============================================================================
// FUNCTION DECLARATION — readFile (tool pour les agents)
// =============================================================================

const readFileDecl: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet. Utilise-le pour consulter les fichiers existants.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// DESIGN ANCHOR
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
// RETRY — backoff automatique sur 503/429
// =============================================================================

async function callWithRetry(
  fn: () => Promise<AsyncIterable<any>>,
  onChunk: (txt: string) => void,
  opts: { maxAttempts?: number; baseDelay?: number; onThought?: (txt: string) => void; onUsage?: (usage: { totalTokenCount: number; promptTokenCount: number; candidatesTokenCount: number }) => void } = {}
): Promise<string> {
  const { maxAttempts = 6, baseDelay = 15000, onThought, onUsage } = opts;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 15s, 30s, 60s, 60s, 60s
      const waitMs = Math.min(baseDelay * Math.pow(2, attempt - 1), 60000);
      onChunk(`\n[RETRY ${attempt}/${maxAttempts - 1}] Modèle surchargé — reprise dans ${Math.round(waitMs / 1000)}s...\n`);
      await sleep(waitMs);
    }
    try {
      const stream = await fn();
      let fullOutput = "";
      for await (const chunk of stream) {
        // Capture usageMetadata from last chunk (only present on final chunk)
        if (chunk.usageMetadata && onUsage) {
          onUsage({
            totalTokenCount: chunk.usageMetadata.totalTokenCount ?? 0,
            promptTokenCount: chunk.usageMetadata.promptTokenCount ?? 0,
            candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount ?? 0,
          });
        }
        // Handle thought parts (from thinkingConfig.includeThoughts)
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts && parts.length > 0) {
          for (const part of parts) {
            if (!part.text) continue;
            if (part.thought) {
              // Capture thought content separately
              if (onThought) onThought(part.text);
            } else {
              fullOutput += part.text;
              onChunk(part.text);
            }
          }
        } else {
          // Fallback for non-thinking chunks
          const txt = chunk.text;
          if (txt) { fullOutput += txt; onChunk(txt); }
        }
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
      // backoff handled at top of loop
    }
  }
  throw lastErr;
}

// =============================================================================
// PACKAGE RESOLUTION
// =============================================================================

const BUNDLED_TYPES = new Set([
  "react","react-dom","next","typescript","node","@types/node",
  "tailwindcss","postcss","autoprefixer","eslint","eslint-config-next",
]);
const TYPES_MAP: Record<string,string> = {
  "express": "@types/express",
  "lodash": "@types/lodash",
  "node-fetch": "@types/node-fetch",
};

async function resolveTypes(pkgs: string[], existing: Record<string,string>): Promise<Record<string,string>> {
  const needed: Record<string,string> = {};
  await Promise.all(pkgs.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

// =============================================================================
// DÉTECTION PATCH MODE (erreurs de build collées dans le chat)
// =============================================================================

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

function parseBrokenFiles(msg: string): string[] {
  const files = new Set<string>();
  const nextPatterns = msg.matchAll(/\.\/((?:app|components|stores|hooks|services|lib|types|pages)[^\s\n]+\.tsx?)/g);
  for (const m of nextPatterns) files.add(m[1]);
  const tsPatterns = msg.matchAll(/\/((?:app|components|stores|hooks|services|lib|types)[^\s(]+\.tsx?)(?:\(|\s)/g);
  for (const m of tsPatterns) files.add(m[1]);
  return Array.from(files);
}

// =============================================================================
// SMART PATCH DETECTION — Détecte si c'est une petite modification vs reconstruction
// =============================================================================

function isSmallModificationRequest(msg: string, hasExistingFiles: boolean): boolean {
  if (!hasExistingFiles) return false;
  // Keywords indicating a full rebuild
  const rebuildKw = [
    "crée", "créer", "génère", "générer", "construis", "refais tout", "nouveau projet",
    "from scratch", "reconstruit", "entière", "entièrement", "toute l\'application",
    "create", "build", "rebuild", "complete", "full app",
  ];
  const lm = msg.toLowerCase();
  if (rebuildKw.some(k => lm.includes(k))) return false;
  // Keywords indicating a small change
  const smallKw = [
    "ajoute", "ajouter", "modifie", "modifier", "change", "changer", "fixe", "corriger",
    "rajoute", "mets", "mettre", "remplace", "supprimer", "supprime", "update", "add",
    "modify", "remove", "delete", "small", "just", "only", "simple", "quick",
    "améliore", "améliorer", "style", "couleur", "texte", "bouton", "section",
  ];
  const hasSmallKw = smallKw.some(k => lm.includes(k));
  const isShortMsg = msg.length < 300;
  return hasSmallKw && isShortMsg;
}

// =============================================================================
// DESIGN EXTRACTION — extrait les couleurs d'une image base64 côté serveur (via sharp)
// =============================================================================

async function extractDominantColorsFromBase64(base64: string): Promise<{ hex: string; zone: string }[]> {
  try {
    const data = base64.includes(",") ? base64.split(",")[1] : base64;
    const buf = Buffer.from(data, "base64");
    const { data: pixels, info } = await sharp(buf).resize(200, 200, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, ch = info.channels;
    const zones = [
      { name: "global",   x1: 0,        y1: 0,        x2: W,        y2: H },
      { name: "sidebar",  x1: 0,        y1: 0,        x2: W * 0.22, y2: H },
      { name: "header",   x1: 0,        y1: 0,        x2: W,        y2: H * 0.12 },
      { name: "content",  x1: W * 0.22, y1: H * 0.12, x2: W,        y2: H },
    ];
    const result: { hex: string; zone: string }[] = [];
    for (const zone of zones) {
      const colorMap: Record<string, number> = {};
      for (let y = Math.floor(zone.y1); y < Math.floor(zone.y2); y += 4) {
        for (let x = Math.floor(zone.x1); x < Math.floor(zone.x2); x += 4) {
          const i = (y * W + x) * ch;
          const r = Math.round(pixels[i] / 16) * 16;
          const g = Math.round(pixels[i+1] / 16) * 16;
          const b = Math.round(pixels[i+2] / 16) * 16;
          const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
          colorMap[hex] = (colorMap[hex] || 0) + 1;
        }
      }
      const topColors = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
      topColors.forEach(([hex]) => result.push({ hex, zone: zone.name }));
    }
    return result;
  } catch { return []; }
}

// =============================================================================
// ████████████████████████████████████████████████████████████████████████████
// PROMPTS DES AGENTS
// CHAQUE AGENT CONTIENT UNE CHECKLIST EXHAUSTIVE D'ERREURS À NE PAS COMMETTRE
// PLUS DE CORRECTEURS AUTOMATIQUES — L'IA EST LA SEULE LIGNE DE DÉFENSE
// ████████████████████████████████████████████████████████████████████████████
// =============================================================================

// =============================================================================
// PRESENTER — Interlocuteur visible. Décide CHAT_ONLY / CODE_ACTION / FIX_ACTION
// =============================================================================

const PRESENTER_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.
Tu es le visage humain d'une équipe d'agents qui construisent des applications.

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTION ABSOLUE — LIT CETTE SECTION EN PREMIER
══════════════════════════════════════════════════════════════════════

Tu NE DOIS JAMAIS écrire :
- Du code (import, export, const, function, interface, type, class...)
- Des balises XML ou HTML (<create_file>, <div>, <section>, tout tag HTML)
- Des blocs de code markdown (\`\`\`typescript ... \`\`\` ou tout autre bloc \`\`\`)
- Des imports de modules
- Des extraits de fichiers
- Les marqueurs [[START]] ou [[FINISH]]

Tu parles UNIQUEMENT en prose naturelle, en français. Maximum 4 phrases.
Dès que tu sens l'envie d'écrire un chevron < ou un backtick \` → ARRÊTE IMMÉDIATEMENT.
Ta seule mission est d'écrire 3-4 phrases en langage humain qui confirment la demande.
AUCUN PLAN, AUCUNE LISTE, AUCUNE ÉTAPE. Juste du texte naturel conversationnel.

══════════════════════════════════════════════════════════════════════
RÔLE 1 — DÉCISION (toujours en premier, sur une ligne seule)
══════════════════════════════════════════════════════════════════════

Lis le message de l'utilisateur et décide :

▸ CODE_ACTION   — l'utilisateur veut créer ou reconstruire une application entière
▸ FIX_ACTION    — l'utilisateur veut une modification ciblée OU signale une erreur/bug (les deux cas vont au même agent)
▸ CHAT_ONLY     — l'utilisateur pose une question, discute, demande des conseils

RÈGLE CRITIQUE : Choisis FIX_ACTION si ET SEULEMENT SI :
- Il y a déjà des fichiers de projet existants
- La demande est ciblée : modifier un composant, corriger un bug, ajouter une page, changer un style
- La demande ne nécessite PAS de reconstruire toute l'app depuis zéro

Place LE MOT-CLÉ EXACT sur la première ligne de ta réponse, seul.
Ensuite écris ta réponse en prose.

══════════════════════════════════════════════════════════════════════
RÔLE 1-BIS — INTENTION DE L'IMAGE (si une image est uploadée)
══════════════════════════════════════════════════════════════════════

Si l'utilisateur a joint une image dans son message, tu dois évaluer en silence son intention :

L'image EST une référence de design UI si :
- Elle montre un écran d'app, un dashboard, un site web, une maquette, un wireframe, un screenshot d'interface
- L'utilisateur dit "génère", "crée", "reproduis", "clone", "fait comme ça", "design similaire", même implicitement
- Le contexte suggère qu'il veut que l'app ressemble à l'image (même sans le dire explicitement)
- L'image est clairement une UI et le message n'indique pas autre chose

L'image N'EST PAS une référence de design si :
- C'est une photo, un logo seul, un diagramme, un schéma technique, un document
- L'utilisateur veut analyser le contenu de l'image (ex: "qu'est-ce que c'est ?")

Si l'image est une référence de design : ajoute le tag [IMAGE_IS_DESIGN_REF] sur une ligne seule AVANT ton mot-clé de décision, comme ceci :
[IMAGE_IS_DESIGN_REF]
CODE_ACTION
Super, je vais reproduire ce design...

Si l'image n'est pas une référence de design (ou qu'il n'y a pas d'image) : n'écris RIEN de spécial, commence directement par ton mot-clé.

══════════════════════════════════════════════════════════════════════
RÔLE 2 — INTRO (si CODE_ACTION, 3-4 phrases MAX en prose)
══════════════════════════════════════════════════════════════════════

- Confirme que tu as compris la demande
- Décris en une phrase ce que tu vas construire (côté utilisateur, jamais technique)
- Annonce que tu commences

INTERDIT : listes, étapes, phases, agents, Next.js/React/TypeScript, tout code.

══════════════════════════════════════════════════════════════════════
RÔLE 3 — CHAT (si CHAT_ONLY)
══════════════════════════════════════════════════════════════════════

Réponds naturellement, avec expertise, en français, sans code.

══════════════════════════════════════════════════════════════════════
RÔLE 4 — FIX / MODIFICATION INTRO (si FIX_ACTION, 1-2 phrases)
══════════════════════════════════════════════════════════════════════

Si c'est une erreur : dis que tu vas la corriger.
Si c'est une modification : confirme en 1 phrase ce que tu vas changer.
Reste court, naturel, pas technique.
`;

const PRESENTER_OUTRO_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.
Tu viens de terminer la construction d'une application.

Écris un message de conclusion chaleureux (5-7 phrases MAX).

Ce message doit :
1. Annoncer que le projet est prêt
2. Décrire les fonctionnalités disponibles avec leurs noms d'écran (Dashboard, Tableau de bord, etc.)
3. Donner 1-2 phrases sur comment tester (npm run dev)
4. Inviter à demander des ajustements

INTERDIT :
- Noms de fichiers (.tsx, .ts, stores, components)
- Termes trop techniques (sauf npm run dev)
- Plus de 7 phrases
`;

// =============================================================================
// LA BIBLE DES ERREURS — injectée dans CHAQUE agent de code
// Ce bloc remplace 100% des correcteurs programmatiques
// =============================================================================

const ERROR_PREVENTION_BIBLE = `
══════════════════════════════════════════════════════════════════════
⚠️  BIBLE DES ERREURS — LIS CHAQUE LIGNE AVANT D'ÉCRIRE UNE SEULE LIGNE DE CODE
Tu n'as AUCUN correcteur automatique après toi. Tu es la seule ligne de défense.
CHAQUE erreur ci-dessous a cassé des builds réels. Mémorise-les.
══════════════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #1 — "use client" MANQUANT (erreur silencieuse → crash au runtime)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : "use client"; doit être la TOUTE PREMIÈRE LIGNE de TOUT fichier .tsx ou .ts qui contient :
  → useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext
  → useRouter, usePathname, useSearchParams, useParams
  → window, document, localStorage, sessionStorage
  → N'IMPORTE quel store Zustand (useXxxStore)
  → N'IMPORTE quel hook custom commençant par "use"

AVANT :
  import React from 'react';
  "use client"; // ← FAUX, trop tard

APRÈS :
  "use client"; // ← LIGNE 1 ABSOLUMENT
  import React from 'react';

EXCEPTIONS (PAS de "use client") :
  - app/api/**/route.ts (server-only)
  - app/layout.tsx sans hooks
  - stores Zustand (les fichiers .ts dans stores/)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #2 — ZUSTAND : virgules et points-virgules (crash compilation immédiat)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Un store Zustand a DEUX zones distinctes avec des règles OPPOSÉES :

ZONE A — Interface TypeScript (avant le create<>) :
  Utilise des POINTS-VIRGULES. C'est du TypeScript pur.
  interface TradeState {
    balance: number;        // ← point-virgule
    setBalance: (v: number) => void;  // ← point-virgule
  }

ZONE B — Corps de create<>() (l'objet JavaScript) :
  Utilise des VIRGULES. C'est un objet littéral JavaScript.
  ✅ CORRECT :
  const useTradeStore = create<TradeState>()((set) => ({
    balance: 0,                           // ← virgule
    setBalance: (v) => set({ balance: v }),  // ← virgule
    fetchData: async () => {
      const data = await fetchApi();       // ← point-virgule ICI (dans le corps de la fn)
      set({ balance: data.balance });      // ← point-virgule ICI
    },                                     // ← virgule après la fn
  }));

  ❌ FAUX (crash) :
  const useTradeStore = create<TradeState>()((set) => ({
    balance: 0;              // ← FAUX, point-virgule dans l'objet JS
    setBalance: () => void;  // ← FAUX, void dans l'objet JS
  }));

RÈGLE RÉSUMÉE : Dans l'objet create(), TOUTES les propriétés séparées par VIRGULES.
À l'intérieur d'un corps de fonction async, POINTS-VIRGULES pour les statements.

INTERDICTION ABSOLUE : setX: () => void; dans le corps de create() — c'est le pattern d'interface, pas d'implémentation.
Remplace TOUJOURS par : setX: (v) => set({ x: v }),

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #3 — EXPORTS : named vs default (crash "X is not exported from Y")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE UNIVERSELLE : Toutes les vues (components/views/*.tsx) utilisent des NAMED EXPORTS.

✅ CORRECT :
  export function DashboardView() { ... }       // dans DashboardView.tsx
  import { DashboardView } from '@/components/views/DashboardView';  // dans page.tsx

❌ FAUX (crash) :
  export default function DashboardView() { ... }   // dans DashboardView.tsx
  import DashboardView from '@/components/views/DashboardView';     // mismatch silencieux

Pour les composants UI (components/ui/*.tsx) : même règle, named exports.
Pour les stores (stores/*.ts) : export const useXxxStore = create<...>()(...);
Pour les services (services/*.ts) : export function fetchXxx() ou export const xxxService = { ... };
Pour app/page.tsx : export default function Page() est OK (Next.js l'exige).
Pour app/layout.tsx : export default function RootLayout() est OK.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #4 — IMPORTS RELATIFS vs ALIAS @/ (crash "Cannot find module")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : Utilise TOUJOURS les alias @/ pour les imports internes. JAMAIS de chemins relatifs multi-niveaux.

✅ CORRECT :
  import { useTradeStore } from '@/stores/useTradeStore';
  import { cn } from '@/lib/utils';
  import { fetchPositions } from '@/services/tradeService';
  import type { Position } from '@/types';

❌ FAUX :
  import { useTradeStore } from '../../stores/useTradeStore';
  import { cn } from '../lib/utils';
  import { fetchPositions } from './services/tradeService';

EXCEPTION : imports relatifs dans le même dossier sont OK : import { Button } from './Button';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #5 — COHÉRENCE DES TYPES (crash "Property X does not exist on type Y")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : Un nom de propriété dans une interface doit être IDENTIQUE dans TOUS les fichiers qui l'utilisent.
qty et quantity sont DEUX CHAMPS DIFFÉRENTS pour TypeScript.

PROCESSUS OBLIGATOIRE avant d'écrire une view :
1. Lis l'interface dans types/index.ts
2. Note les noms EXACTS des champs (ex: tradeHistory, pas history)
3. Dans la view, utilise EXACTEMENT ces noms

✅ CORRECT (si interface déclare tradeHistory):
  interface TradeState { tradeHistory: Trade[]; }
  const { tradeHistory } = useTradeStore();  // ← nom identique

❌ FAUX (crash):
  interface TradeState { tradeHistory: Trade[]; }
  const { history } = useTradeStore();  // ← "history does not exist on type TradeState"

MÊME RÈGLE pour les propriétés d'objets :
  interface Position { qty: number; avgPrice: number; pnl: number; }
  positions.map(p => p.qty)       // ✅ correct
  positions.map(p => p.quantity)  // ❌ crash

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #6 — globals.css + tailwind.config.ts (crash webpack immédiat)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR FATALE : "The \`border-border\` class does not exist"

Cette erreur se produit quand globals.css contient @apply border-border (ou bg-background,
text-foreground, etc.) mais que tailwind.config.ts ne les définit PAS dans extend.colors.

RÈGLE : JAMAIS utiliser @apply avec des classes qui référencent des CSS variables sans
les définir dans tailwind.config.ts.

OPTION A — CSS pur (RECOMMANDÉE, zéro risque) :
  ❌ @apply border-border;
  ✅ border-color: hsl(var(--border));

  ❌ @apply bg-background text-foreground;
  ✅ background-color: hsl(var(--background)); color: hsl(var(--foreground));

OPTION B — Si tu utilises @apply, tailwind.config.ts DOIT avoir :
  extend: {
    colors: {
      border: "hsl(var(--border))",
      background: "hsl(var(--background))",
      foreground: "hsl(var(--foreground))",
      primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
      secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
      muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
      accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
      destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
      card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
      ring: "hsl(var(--ring))",
      input: "hsl(var(--input))",
    }
  }

CHOISIR UNE OPTION ET S'Y TENIR pour tout le fichier globals.css.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #7 — Next.js 15 : params est une Promise (crash TypeScript)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans les route handlers et pages dynamiques de Next.js 15, params est une PROMISE.

✅ CORRECT :
  export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;  // ← await obligatoire
  }

❌ FAUX (crash TypeScript) :
  export async function GET(req: Request, { params }: { params: { id: string } }) {
    const { id } = params;  // ← pas d'await = erreur de type
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #8 — Route handlers : export nommé OBLIGATOIRE (crash 405/404)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans app/api/**/route.ts, les handlers doivent être des exports NOMMÉS.

✅ CORRECT :
  export async function GET(req: Request) { ... }
  export async function POST(req: Request) { ... }

❌ FAUX (silencieux mais 404/405 au runtime) :
  export default async function handler(req: Request) { ... }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #9 — metadata dans un client component (crash build)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si un fichier a "use client", il ne peut PAS avoir export const metadata.
Place metadata dans un fichier serveur séparé ou dans layout.tsx sans "use client".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #10 — key manquant dans .map() (warning → crash potentiel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chaque élément rendu dans un .map() DOIT avoir un prop key unique.

✅ CORRECT :
  items.map((item, i) => <div key={item.id ?? i}>...</div>)

❌ FAUX :
  items.map((item) => <div>...</div>)  // "Each child should have a unique key"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #11 — Packages interdits (crash import)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JAMAIS : @monaco-editor/react → remplace par <textarea className="font-mono bg-neutral-900 text-green-400 p-4 w-full h-full resize-none" />
JAMAIS : react-ace → même remplacement

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #12 — APIs tierces version-spécifiques
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lightweight-charts v5 :
  ✅ chart.addCandleSeries()     ❌ chart.addCandlestickSeries()
  ✅ IChartApiBase               ❌ IChartApi

framer-motion :
  ✅ animate={{ boxShadow: "..." }}    ❌ animate={{ shadow: "..." }}
  ✅ animate={{ scale: 1.05 }}         ❌ animate={{ scale: "scale-105" }}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #13 — Imports dupliqués (crash "already declared")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ne pas importer deux fois le même identifiant depuis des sources différentes.
Fusionne les imports depuis la même source.

❌ FAUX :
  import { useState } from 'react';
  import { useEffect } from 'react';

✅ CORRECT :
  import { useState, useEffect } from 'react';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #14 — Apostrophes dans JSX (crash parser)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans le texte JSX (entre les balises), les apostrophes doivent être échappées.

❌ FAUX : <p>L'utilisateur n'est pas connecté</p>
✅ CORRECT : <p>L&apos;utilisateur n&apos;est pas connecté</p>

MAIS dans le code TypeScript (case 'home', useState('value')), utilise les apostrophes normales.
❌ JAMAIS : case &apos;home&apos;:  (les &apos; ne vont JAMAIS dans le code TS)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #15 — children manquant dans les props (crash TypeScript très fréquent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR : Type '{ children: string; href: string; }' is not assignable to type 'NavbarLinkProps'.
         Property 'children' does not exist on type 'NavbarLinkProps'.

Cause : tu as défini un composant qui s'utilise avec du contenu entre ses balises
(<NavbarLink href="...">Texte</NavbarLink>) mais tu n'as pas déclaré children dans ses props.

RÈGLE : SI un composant s'utilise comme wrapper avec du contenu entre balises → DÉCLARE children.

✅ CORRECT :
  interface NavbarLinkProps {
    href: string;
    children: React.ReactNode;  // ← OBLIGATOIRE si utilisé comme <NavbarLink>Texte</NavbarLink>
    className?: string;
  }
  export function NavbarLink({ href, children, className }: NavbarLinkProps) {
    return <a href={href} className={className}>{children}</a>;
  }

❌ FAUX :
  interface NavbarLinkProps {
    href: string;
    // children manquant → crash si utilisé comme wrapper
  }

RÈGLE GÉNÉRALE : Avant de définir l'interface Props d'un composant, demande-toi :
"Est-ce que ce composant sera utilisé avec du contenu entre ses balises ?"
Si OUI → ajoute children: React.ReactNode dans les props.

Composants qui PRESQUE TOUJOURS ont besoin de children :
  - Button, NavLink, NavbarLink, MenuItem, Card, Badge, Tooltip
  - Modal, Dialog, Drawer, Sheet, Popover
  - Section, Container, Wrapper, Layout
  - Tout composant dont le nom suggère un "conteneur"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #16 — Props TypeScript non exhaustifs (crash à l'usage)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire l'interface Props d'un composant, liste TOUTES les façons dont il sera utilisé.

✅ MÉTHODE CORRECTE :
  // Je vais utiliser ce Button comme :
  // <Button>Texte</Button>             → children: React.ReactNode
  // <Button variant="primary">...</Button> → variant?: string
  // <Button disabled>...</Button>       → disabled?: boolean
  // <Button onClick={fn}>...</Button>   → onClick?: () => void
  // <Button className="mt-4">...</Button> → className?: string
  
  interface ButtonProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    type?: 'button' | 'submit' | 'reset';
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #17 — Event handlers TypeScript mal typés
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT :
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;

❌ FAUX :
  onChange?: (e: any) => void;   // "any" masque les erreurs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #18 — React.FC / React.ReactNode confusion
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT :
  function Button({ children }: { children: React.ReactNode }) { ... }
  // ou
  interface ButtonProps { children: React.ReactNode }
  function Button({ children }: ButtonProps) { ... }

❌ ÉVITER React.FC<Props> — il est déprécié dans React 18+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #19 — Incohérence des noms de méthodes entre service et usage (très fréquente)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR : Property 'submitContact' does not exist on type '{ submitContactForm(...) }'
         Did you mean 'submitContactForm'?

Cause : un fichier appelle service.submitContact() mais le service déclare submitContactForm().
C'est le même problème que pour les champs de types : les noms doivent être IDENTIQUES.

RÈGLE : Le nom exact de la méthode dans le service = le nom exact utilisé partout.
JAMAIS de raccourcis ou variantes.

✅ CORRECT :
  // Dans landingService.ts :
  export const landingService = {
    submitContactForm: async (data: ContactFormData) => { ... }
  };
  
  // Dans route.ts :
  const result = await landingService.submitContactForm(body);  // ← nom identique

❌ FAUX :
  // Service déclare : submitContactForm
  // Route appelle  : landingService.submitContact(body)  // ← crash TypeScript

PROCESSUS : Avant d'appeler une méthode de service dans une route ou une vue,
relis mentalement la déclaration du service pour vérifier le nom EXACT.
Si le service a été écrit par un autre agent, utilise readFile() pour le vérifier.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pour CHAQUE composant qui wrap du contenu → vérifie children: React.ReactNode dans les props
Pour CHAQUE fichier .tsx avec hooks → vérifie "use client" ligne 1
Pour CHAQUE store Zustand → vérifie virgules dans create(), pas de void; dans l'objet
Pour CHAQUE view → vérifie export function NomView() (named, pas default)
Pour CHAQUE import interne → vérifie @/ pas ../../
Pour CHAQUE .map() → vérifie key={...}
Pour CHAQUE usage de type → vérifie que le nom de champ correspond à l'interface
Pour globals.css → vérifie qu'il n'y a pas de @apply border-border sans tailwind.config.ts correspondant
Pour les route handlers → vérifie export GET/POST nommés
Pour CHAQUE composant UI (Button, Card, Badge, etc.) → vérifie que tous les props utilisés sont déclarés

══════════════════════════════════════════════════════════════════════
PRENDS LE TEMPS. UN CODE LENT ET CORRECT VAUT MIEUX QU'UN CODE RAPIDE ET CASSÉ.
══════════════════════════════════════════════════════════════════════
`;

// =============================================================================
// PHASE 1 — FOUNDATION_AGENT
// types/index.ts, lib/utils.ts, lib/env.ts, services/*.ts, stores/*.ts, tailwind.config.ts
// =============================================================================

// =============================================================================
// DESIGN AGENT — Génère le HTML/CSS de référence depuis les images de style
// Ce prompt remplace l'appel à /api/chat côté client
// =============================================================================

const DESIGN_AGENT_PROMPT = `
Tu es un expert en design system et analyse visuelle d'interfaces.
Ta mission UNIQUE : analyser les images de référence et produire :
1. Une ANALYSE EXHAUSTIVE du design (dans ta réflexion)
2. Un HTML/CSS de référence complet et fidèle

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTION ABSOLUE
══════════════════════════════════════════════════════════════════════

Tu NE GÉNÈRES JAMAIS :
- Du code React, TypeScript, Next.js
- Des composants .tsx ou .ts
- Des balises <create_file> ou <str_replace>
- Des instructions d'implémentation

Tu produis UNIQUEMENT du HTML/CSS pur dans la balise <design_reference>.

══════════════════════════════════════════════════════════════════════
MISSION — ANALYSE ULTRA-DÉTAILLÉE (dans ta réflexion interne)
══════════════════════════════════════════════════════════════════════

Avant d'écrire le moindre HTML, analyse en profondeur dans ta pensée :

PALETTE — Chaque couleur de chaque zone :
• Fond global → hex
• Fond sidebar / nav → hex
• Fond cards / panneaux → hex
• Texte primaire → hex
• Texte secondaire / muted → hex
• Couleur d'accent / CTA → hex
• Bordures / dividers → hex + opacité
• Gradients → direction + couleurs

TYPOGRAPHIE — Chaque détail :
• Famille de police → nom exact (Google Fonts?)
• Titres h1/h2/h3 → taille px, weight, letter-spacing, line-height
• Body / paragraphe → taille px, weight, line-height
• Labels / captions → taille px, weight, couleur

COMPOSANTS — Décompose chaque élément visible :
• Boutons primaires / secondaires / ghost → shape, padding, radius, shadow, hover
• Inputs / champs → border style, focus ring, placeholder color
• Cards → border, radius, shadow, padding, gap interne
• Navigation → style actif/inactif, indicateur, bg au hover
• Badges / Tags → shape, couleurs, padding
• Tableaux / Listes → alternance, hauteur ligne, padding cellules
• Icônes → style (outline/filled/thin), taille en px

LAYOUT & ESPACEMENT :
• Grille → colonnes, gap entre colonnes
• Sidebar → largeur fixe en px
• Header → hauteur, position (sticky/fixed/relative)
• Section padding → top/bottom/left/right en px
• Gap entre éléments → px précis

EFFETS & AMBIANCE :
• Glassmorphisme → backdrop-blur, rgba bg
• Ombres → offset x/y, blur, spread, couleur + alpha
• Transitions → durée, easing
• Texture / bruit → présent ou non
• Thème → dark / light / mixed
• Densité → compact / confortable / spacieux

══════════════════════════════════════════════════════════════════════
OUTPUT — HTML/CSS DE RÉFÉRENCE
══════════════════════════════════════════════════════════════════════

Émets UNIQUEMENT ce bloc (rien avant, rien après) :

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=[FONT_EXTRAIT_DES_IMAGES]&display=swap" rel="stylesheet">
  <style>
    :root {
      /* ── Palette extraite pixel-perfect des images ── */
      --bg: #[hex exact];
      --sidebar-bg: #[hex exact];
      --card-bg: #[hex exact];
      --text-primary: #[hex exact];
      --text-muted: #[hex exact];
      --accent: #[hex exact];
      --border: rgba([r],[g],[b],[a]);
      /* ── Typographie ── */
      --font: '[NOM_EXACT]', sans-serif;
      --text-sm: [px]px;
      --text-base: [px]px;
      --text-lg: [px]px;
      --font-heading: [weight];
      /* ── Espacements extraits ── */
      --radius: [px]px;
      --radius-lg: [px]px;
      --shadow: [valeur complète];
      --gap: [px]px;
    }
    /* reset + layout global */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text-primary); font-size: var(--text-base); }
    /* ... styles complets pour CHAQUE composant extrait des images ... */
  </style>
</head>
<body>
  <!-- Reproduction fidèle de l'interface avec données réalistes inventées -->
  <!-- JAMAIS de Lorem ipsum — noms, chiffres, labels réalistes -->
</body>
</html>
</design_reference>

RÈGLES D'OR :
- Toutes les valeurs dans :root{} — jamais hardcodées dans les composants
- Police chargée depuis Google Fonts (nom exact extrait des images)
- Icônes : Tabler Icons CDN exclusivement
- Images : DiceBear avatars, Picsum photos, Google Favicon API pour logos
- Données réalistes inventées (jamais Lorem ipsum)
- Le HTML/CSS doit REPRODUIRE FIDÈLEMENT l'interface visible dans les images
- ⛔ APRÈS </design_reference> : N'écris RIEN. Pas de code React, TypeScript, ou balises <create_file>.
`;

// =============================================================================
// PATCH AGENT — Modifications ciblées sur projet existant (sans refaire tout)
// Utilisé quand l'utilisateur fait une petite modification sur un projet existant
// =============================================================================

const PATCH_AGENT_PROMPT = `
Tu es un chirurgien du code. Tu reçois un projet existant et une demande de modification précise.
Ta mission : appliquer des changements MINIMAUX et CIBLÉS sans jamais régénérer tout le projet.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE
══════════════════════════════════════════════════════════════════════
Avant de commencer à coder, émets sur UNE ligne ton titre de travail :
[WORKING_ON]Description courte et précise de ce que tu fais (ex: "Ajout du composant de notification")[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
RÈGLES D'ÉDITION CHIRURGICALE
══════════════════════════════════════════════════════════════════════

PRÉFÈRE toujours str_replace pour les fichiers existants :
<str_replace path="chemin/fichier.tsx">
<old_str>code exact à remplacer</old_str>
<new_str>nouveau code</new_str>
</str_replace>

Utilise create_file UNIQUEMENT pour les nouveaux fichiers :
---
<create_file path="chemin/nouveau.tsx">
... contenu ...
</create_file>

⚠️ RÈGLE SÉPARATEUR : Toujours émettre "---" seul sur une ligne AVANT chaque <create_file>.

INTERDICTIONS :
✗ Réécrire un fichier complet si seul 10% change
✗ Changer des parties non concernées par la demande
✗ Modifier le design (couleurs, espacements, police) sauf si explicitement demandé
✗ Ajouter des dépendances non nécessaires

PERMISSIONS :
✓ Ajouter de nouveaux composants (create_file)
✓ Modifier des parties précises (str_replace)
✓ Ajouter des imports (str_replace sur la section imports)
✓ Ajouter/modifier des routes API (str_replace ou create_file)

PROCESSUS :
1. Lis les fichiers existants (utilise readFile() si besoin)
2. Identifie EXACTEMENT quels fichiers touchent ta demande
3. Applique les changements minimaux
4. Vérifie que tes changements sont cohérents avec les types existants
`;

const FOUNDATION_PROMPT = `
Tu es un Architecte Full Stack Senior — Expert TypeScript, Zustand, et Next.js 15.
Tu génères la couche fondation d'une application : types, utilitaires, services, stores.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Avant de générer quoi que ce soit, émets sur UNE ligne :
[WORKING_ON]Architecture & Types — [description courte de ce que tu construis][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
STRATÉGIE INTELLIGENTE — PENSE AVANT D'AGIR
══════════════════════════════════════════════════════════════════════
Avant de générer du code :
1. Analyse la DEMANDE : identifie toutes les entités, relations, actions
2. Planifie les STORES : un store = un domaine métier (pas un store God object)
3. Anticipe les VUES : quels champs seront affichés ? Ajoute-les aux types DÈS MAINTENANT
4. Vérifie les CONVENTIONS : choisis UN nom par concept, applique-le PARTOUT

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER (couche fondation UNIQUEMENT)
══════════════════════════════════════════════════════════════════════

1. types/index.ts
   - TOUTES les interfaces et types de l'application
   - Les champs doivent être PRÉCIS et COMPLETS (incluant tous les champs qui seront utilisés dans les vues)
   - Convention de nommage : choisis UN nom par concept et utilise-le PARTOUT
     Ex : si tu choisis qty, TOUTES les vues écriront pos.qty — pas pos.quantity, pas pos.amount
   - Exemple :
     export interface Position {
       id: string;
       symbol: string;
       qty: number;          // ← ce nom EXACT sera utilisé dans les vues
       avgPrice: number;     // ← ce nom EXACT sera utilisé dans les vues
       pnl: number;          // ← ce nom EXACT sera utilisé dans les vues
       side: 'long' | 'short';
     }

2. lib/utils.ts
   - Fonction cn() pour fusionner les classes Tailwind (utilise clsx + tailwind-merge)
   - Fonctions de formatage (formatCurrency, formatDate, formatNumber, etc.)
   - Helpers génériques utiles à l'application

3. lib/env.ts
   - Variables d'environnement typées et validées
   - Valeurs par défaut sensées

4. services/*.ts
   - Logique métier et appels API
   - Fonctions async avec gestion d'erreur try/catch
   - Données mock réalistes pour le développement (pas de "TODO: implement")

5. stores/*.ts — Stores Zustand
   IMPÉRATIF — STRUCTURE CORRECTE :
   \`\`\`typescript
   "use client";  // ← PAS ici pour les stores, ils sont importés par les views qui ont "use client"
   
   // CORRECT pour un store :
   import { create } from 'zustand';
   import type { TradeState } from '@/types';
   
   interface StoreState extends TradeState {
     // Ici les types — POINTS-VIRGULES
     loading: boolean;
     error: string | null;
     fetchData: () => Promise<void>;
     setSymbol: (s: string) => void;
   }
   
   export const useTradeStore = create<StoreState>()((set, get) => ({
     // Ici les IMPLÉMENTATIONS — VIRGULES
     loading: false,
     error: null,
     fetchData: async () => {
       set({ loading: true });    // point-virgule DANS le corps de la fn
       try {
         const data = await fetchApi();
         set({ data, loading: false });  // point-virgule DANS le corps
       } catch (e) {
         set({ error: String(e), loading: false });
       }
     },                          // ← virgule APRÈS la fn (séparateur de propriété)
     setSymbol: (s) => set({ symbol: s }),  // ← virgule
   }));
   \`\`\`
   
   Les stores ne nécessitent PAS "use client" — ce sont les components qui les importent qui l'ont.

6. tailwind.config.ts
   OBLIGATOIRE — génère TOUJOURS ce fichier.
   Si globals.css utilisera des CSS variables (--border, --background, etc.),
   tu DOIS les mapper ici pour éviter "The border-border class does not exist".
   
   \`\`\`typescript
   import type { Config } from "tailwindcss";
   const config: Config = {
     darkMode: ["class"],
     content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
     theme: {
       extend: {
         colors: {
           border: "hsl(var(--border))",
           input: "hsl(var(--input))",
           ring: "hsl(var(--ring))",
           background: "hsl(var(--background))",
           foreground: "hsl(var(--foreground))",
           primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
           secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
           destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
           muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
           accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
           card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
           popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
         },
       },
     },
     plugins: [],
   };
   export default config;
   \`\`\`

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE — IMPÉRATIF
══════════════════════════════════════════════════════════════════════

⚠️ RÈGLE ABSOLUE — SÉPARATEUR DE FICHIER :
Avant CHAQUE balise <create_file>, tu DOIS émettre le séparateur "---" seul sur une ligne.
Ce séparateur signale au système que le contenu suivant est un fichier (masqué des messages).
Annonce d'abord en prose ce que tu vas créer, PUIS le séparateur, PUIS le fichier.

Exemple CORRECT :
Je commence par le fichier des types...
---
<create_file path="types/index.ts">
... code complet ...
</create_file>
Je passe maintenant aux stores...
---
<create_file path="stores/useAppStore.ts">
... code ...
</create_file>

À la fin, liste tous les packages npm nécessaires :
DEPENDENCIES: ["zustand", "clsx", "tailwind-merge", "axios"]

══════════════════════════════════════════════════════════════════════
AUTO-REVUE OBLIGATOIRE avant d'émettre
══════════════════════════════════════════════════════════════════════

Avant de finaliser chaque store :
□ Chaque propriété dans create() est séparée par une VIRGULE ?
□ Aucune propriété n'a : () => void; dans l'objet create() ?
□ Les corps de fonctions async utilisent des POINTS-VIRGULES ?
□ Tous les noms de champs dans types/index.ts correspondent à ceux utilisés partout ?

NE PAS generer : hooks, composants UI, vues, globals.css, layout.tsx, page.tsx.
`;

// =============================================================================
// PHASE 2 — UI_AGENT
// hooks/*.ts, app/api/**/route.ts, components/ui/*.tsx
// =============================================================================

const UI_AGENT_PROMPT = `
Tu es un Expert Frontend Senior — React/Next.js 15, TypeScript strict, patterns modernes.
Tu génères la couche orchestration : hooks, routes API, composants UI réutilisables.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Avant de générer quoi que ce soit, émets sur UNE ligne :
[WORKING_ON]Hooks & API — [description courte de ce que tu construis][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
STRATÉGIE INTELLIGENTE
══════════════════════════════════════════════════════════════════════
1. Lis TOUS les types de types/index.ts avant de commencer
2. Chaque hook DOIT implémenter toutes les fonctions annoncées dans le store
3. Les routes API doivent gérer TOUTES les opérations CRUD nécessaires
4. Anticipe les besoins des VIEWS : quels hooks elles utiliseront ?

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER
══════════════════════════════════════════════════════════════════════

1. hooks/use*.ts
   - "use client"; LIGNE 1 ABSOLUMENT pour chaque hook
   - Hooks qui combinent store Zustand + side effects
   - Logique de data fetching, polling, subscriptions

2. app/api/**/route.ts
   - PAS de "use client" (server-side)
   - TOUJOURS export async function GET/POST/PUT/DELETE (nommés)
   - JAMAIS export default
   - Next.js 15 : params est Promise<{id: string}> → const { id } = await params;
   - Gestion d'erreur robuste avec try/catch et NextResponse.json

3. components/ui/*.tsx
   - "use client"; si le composant a des handlers ou des hooks
   - NAMED exports : export function Button() {...}  JAMAIS export default
   - Props typées avec interface NomProps { ... }
   - Composants : Button, Card, Input, Badge, Spinner, Modal, Tooltip, etc.
   - Design premium avec Tailwind — pas de styles inline sauf exceptions
   - key={...} sur chaque élément de .map()

══════════════════════════════════════════════════════════════════════
CONSOMMATION DE LA COUCHE FONDATION
══════════════════════════════════════════════════════════════════════

Tu as accès aux fichiers générés par FOUNDATION_AGENT.
Lis-les si nécessaire avec readFile.
Importe correctement :
  import type { Position } from '@/types';
  import { useTradeStore } from '@/stores/useTradeStore';
  import { cn } from '@/lib/utils';

VÉRIFIE les noms de champs exacts dans types/index.ts avant d'y accéder.

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

⚠️ RÈGLE ABSOLUE — SÉPARATEUR DE FICHIER :
Avant CHAQUE balise <create_file>, émets "---" seul sur une ligne.
Annonce d'abord ce que tu génères en prose, PUIS le séparateur, PUIS le fichier.
Exemple :
Je génère le hook de données...
---
<create_file path="hooks/useData.ts">
...code...
</create_file>

Je génère le hook principal...
---
<create_file path="hooks/useMarketData.ts">
"use client";
... code complet ...
</create_file>

À la fin :
DEPENDENCIES: ["package1", "package2"]

══════════════════════════════════════════════════════════════════════
AUTO-REVUE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

□ "use client" ligne 1 sur CHAQUE hook et composant UI ?
□ Route handlers : export GET/POST nommés (pas default) ?
□ params de route dynamique : Promise<{...}> avec await ?
□ Tous les imports internes avec @/ ?
□ Named exports sur tous les composants UI ?
□ key prop sur tous les .map() ?

NE PAS generer : views, globals.css, layout.tsx, page.tsx, stores, types.
Ces fichiers sont la responsabilité du VIEWS_AGENT (Phase suivante).
`;

// =============================================================================
// PHASE 3 — VIEWS_AGENT
// components/views/*.tsx, components/Modals.tsx, app/globals.css, app/layout.tsx, app/page.tsx
// =============================================================================

const VIEWS_AGENT_PROMPT = `
Tu es le Lead Frontend Designer le plus créatif et minutieux qui existe.
Tu génères des interfaces qui font dire "WOW" au premier regard.
Tu es à la fois architecte technique (React, TypeScript, Next.js) et artiste visuel (UI/UX, motion, micro-interactions).

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Avant de générer quoi que ce soit, émets sur UNE ligne :
[WORKING_ON]UI & Vues — [description courte de l'interface que tu construis][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
📸 IMAGES DE RÉFÉRENCE — COMPARAISON VISUELLE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

Si des images de référence sont jointes à ce message :
⚡ C'est TON PRINCIPAL GUIDE. Tu dois examiner chaque image avec la précision d'un pixel artist.

PROCESSUS DE COMPARAISON (dans ton thinking) :
1. Liste TOUTES les sections visibles dans les images (hero, nav, grilles, cards, footer, modals...)
2. Pour chaque section : décris exactement ce que tu vois (layout, couleurs, texte, icônes, taille)
3. Vérifie que le design_reference HTML/CSS fourni capture ces sections
4. Dans ton code React, implémente CHAQUE section identifiée — ne saute RIEN
5. Après avoir écrit chaque view, compare mentalement avec l'image : est-ce fidèle à 95%+ ?

TU NES PAS LE DROIT de :
- Simplifier une section présente dans les images
- Changer l'ordre des sections
- Omettre des éléments visibles dans les images
- Inventer un layout différent de celui montré

══════════════════════════════════════════════════════════════════════
🔬 ANALYSE ULTRA-DÉTAILLÉE DU DESIGN DE RÉFÉRENCE — OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

⚡ TU DOIS faire cette analyse dans ta réflexion (thinking) AVANT de coder quoi que ce soit.
Ne commence PAS le code sans avoir analysé chaque point ci-dessous.

ANALYSE NIVEAU 1 — PALETTE & TOKENS VISUELS :
□ Couleur de fond principale (bg app) → hex exact
□ Couleur de fond des cards/panneaux → hex exact
□ Couleur de fond de la sidebar/nav → hex exact
□ Couleur de texte primaire → hex exact
□ Couleur de texte secondaire/muted → hex exact
□ Couleur d'accent/action principale (boutons primaires, liens actifs) → hex exact
□ Couleur de bordure (border, divider) → hex exact
□ Présence de glassmorphisme (backdrop-blur, rgba semi-transparent) ? → oui/non + valeurs
□ Présence de gradients ? → directions, couleurs de départ et fin
□ Ombres dominantes (box-shadow) → offset, blur, spread, couleur

ANALYSE NIVEAU 2 — TYPOGRAPHIE :
□ Police principale → famille de font, source (Google Fonts ?)
□ Taille de texte de base (body) → px/rem
□ Taille et weight des titres h1/h2/h3 → px + weight
□ Taille et weight des labels/captions → px + weight
□ Espacement des lettres (letter-spacing) → em value
□ Hauteur de ligne (line-height) → ratio

ANALYSE NIVEAU 3 — COMPOSANTS UI INDIVIDUELS :
□ Bouton primaire → bg, couleur, border-radius, padding, hover state, shadow
□ Bouton secondaire → mêmes infos
□ Input/Champ de texte → bg, border, border-radius, focus state
□ Card/Panneau → bg, border, border-radius, shadow, padding interne
□ Badge/Tag → couleur bg, couleur texte, padding, border-radius
□ Navigation/Tab active vs inactive → couleurs, underline, bg
□ Table/Liste → alternance de couleurs, hauteur de ligne, padding cells
□ Icônes → style (outline, filled, thin), taille, source
□ Avatar/Media → forme (circle, rounded), taille, border

ANALYSE NIVEAU 4 — LAYOUT & ESPACEMENT :
□ Grille principale → colonnes, gutters
□ Sidebar → largeur, fixed/sticky
□ Header → hauteur, position
□ Padding des sections → px
□ Gap entre les cartes/éléments → px
□ Border-radius dominant → px/rem

ANALYSE NIVEAU 5 — MICRO-INTERACTIONS & EFFETS :
□ Transitions présentes → type (fade, slide, scale), durée
□ Hover effects → changement de bg, shadow, transform
□ Focus states → outline, ring
□ Éléments animés → type d'animation
□ Effets visuels spéciaux → noise texture, grain, dot pattern, glassmorphisme

ANALYSE NIVEAU 6 — AMBIANCE GLOBALE :
□ Thème → dark/light/mixed
□ Densité → compact/confortable/spacieux
□ Ton → corporate/créatif/minimal/luxueux/playful
□ Sources d'inspiration proche → Figma, Linear, Vercel, Notion, etc.

══════════════════════════════════════════════════════════════════════
🎨 IMPLÉMENTATION — RÈGLES DE DESIGN INVIOLABLES
══════════════════════════════════════════════════════════════════════

1. EXTRACTION : Toutes les valeurs de l'analyse vont dans :root {} de globals.css
2. FIDÉLITÉ : Reproduis CHAQUE élément identifié avec une précision pixel-perfect
3. AMÉLIORATION : Si le design de référence est bon, rends-le ENCORE MIEUX — plus de détails, micro-interactions plus fluides
4. ⛔ JAMAIS downgrader : si tu modifies un fichier existant, le résultat DOIT être plus beau
5. DONNÉES RÉELLES : Zéro "Lorem ipsum", zéro placeholder vide — invente des données crédibles et abondantes
6. COMPLÉTUDE : Implémente ALL les fonctionnalités demandées — aucun bouton ne dit "Bientôt disponible"

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER
══════════════════════════════════════════════════════════════════════

1. components/views/*View.tsx — une par section/page principale
   - "use client"; LIGNE 1 ABSOLUMENT (les vues utilisent toujours des stores)
   - NAMED export : export function DashboardView() {...}  JAMAIS export default
   - Importe le store correspondant : const { data, setData } = useXxxStore();
   - Importe les composants UI : import { Button } from '@/components/ui/Button';
   - Importe les services si besoin : import { fetchData } from '@/services/xxxService';
   - CONTENU RÉEL COMPLET — ZÉRO placeholder, ZÉRO "Coming soon", ZÉRO onClick={() => {}} vide
   - Chaque bouton déclenche une vraie action du store
   - Chaque input est contrôlé avec useState ou store
   - Chaque section affiche des vraies données (mock si nécessaire)

2. components/Modals.tsx
   - "use client"; LIGNE 1
   - Tous les modals/dialogues de l'app dans un seul fichier
   - Named exports pour chaque modal

3. app/globals.css
   ⚠️ RÈGLE CRITIQUE — CHOIX ENTRE CES DEUX OPTIONS SEULEMENT :
   
   OPTION A (recommandée — CSS pur, zéro risque de build) :
     @tailwind base;
     @tailwind components;
     @tailwind utilities;
     
     :root {
       --background: 0 0% 100%;
       --foreground: 222.2 84% 4.9%;
       --border: 214.3 31.8% 91.4%;
       /* ... autres variables ... */
     }
     
     body {
       background-color: hsl(var(--background));  /* CSS pur, jamais @apply bg-background */
       color: hsl(var(--foreground));              /* CSS pur */
     }
     
     /* INTERDIT : @apply border-border; @apply bg-background; etc. */
     /* CSS pur UNIQUEMENT pour les propriétés qui utilisent des CSS variables */
   
   OPTION B (si tu veux absolument @apply) :
     Tu DOIS aussi générer tailwind.config.ts avec extend.colors complet.
     Dans ce cas, génère le tailwind.config.ts EN PLUS.
   
   CHOISIS UNE OPTION ET SUIS-LA PARTOUT dans globals.css.

4. app/layout.tsx
   - PAS de "use client" sauf si hooks nécessaires
   - Importe globals.css
   - Ajoute les liens CDN nécessaires (Google Fonts, Tabler Icons si utilisés)
   - export default function RootLayout() — OK ici (Next.js le requiert)

5. app/page.tsx  ⚠️ OBLIGATOIRE — NE JAMAIS OMETTRE
   - "use client"; LIGNE 1
   - Gère le routing entre les vues avec useState
   - TOUJOURS named imports pour les vues :
     import { DashboardView } from '@/components/views/DashboardView';
   - export default function Page() — OK ici (Next.js le requiert)
   - Pattern recommandé :
     const VIEWS: Record<string, React.ComponentType> = {
       dashboard: DashboardView,
       analytics: AnalyticsView,
     };
     const ActiveView = VIEWS[activeTab] ?? DashboardView;
     return <ActiveView />;

6. app/**/page.tsx — sous-pages si l'app a plusieurs routes
   - Pour chaque route Next.js nécessaire (ex: /dashboard, /settings, /profile)
   - Crée le fichier app/[route]/page.tsx correspondant
   - Chaque page importe et rend la view correspondante

⚠️ CHECKLIST FINALE OBLIGATOIRE avant de terminer :
□ app/page.tsx existe et importe TOUTES les vues créées ?
□ Chaque composant/view généré est bien importé quelque part ?
□ Pas de view orpheline non référencée dans page.tsx ?
□ La navigation entre les vues fonctionne (activeTab ou router) ?

══════════════════════════════════════════════════════════════════════
CONSOMMATION DES COUCHES PRÉCÉDENTES
══════════════════════════════════════════════════════════════════════

Lis les fichiers des phases précédentes avec readFile si nécessaire.
VÉRIFIE les noms de champs EXACTS dans types/index.ts avant de les utiliser dans les vues.

Si types/index.ts déclare : interface Position { qty: number; avgPrice: number; }
Ta view DOIT écrire : pos.qty et pos.avgPrice — JAMAIS pos.quantity ou pos.entryPrice

══════════════════════════════════════════════════════════════════════
CONTENU DES VUES — STANDARD DE QUALITÉ
══════════════════════════════════════════════════════════════════════

Chaque view doit avoir :
✅ Un layout complet avec header/sidebar/contenu si approprié
✅ Des données réelles affichées (depuis le store, avec mock data si store vide)
✅ Des interactions fonctionnelles (filtres, recherche, modals, CRUD)
✅ Un design premium et cohérent
✅ Des états loading/error/empty gérés
✅ Des animations subtiles si framer-motion est disponible

❌ INTERDIT :
  - "Aucune donnée disponible" comme seul contenu
  - Boutons sans handler
  - Sections vides
  - TODO dans le code rendu

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

⚠️ RÈGLE ABSOLUE — SÉPARATEUR DE FICHIER :
Avant CHAQUE balise <create_file>, émets "---" seul sur une ligne.
Annonce d'abord ce que tu génères en prose, PUIS le séparateur, PUIS le fichier.

Exemple CORRECT :
Je génère la vue Dashboard...
---
<create_file path="components/views/DashboardView.tsx">
"use client";
import { useDashboardStore } from '@/stores/useDashboardStore';
... code complet fonctionnel ...
export function DashboardView() { ... }
</create_file>

Pour les fichiers EXISTANTS que tu veux MODIFIER (< 40% de changements) :
PRÉFÈRE str_replace — NE RÉÉCRIS PAS tout le fichier :
<str_replace path="app/globals.css">
<old_str>code exact à remplacer</old_str>
<new_str>nouveau code</new_str>
</str_replace>

À la fin :
DEPENDENCIES: ["framer-motion", "recharts", "date-fns"]

══════════════════════════════════════════════════════════════════════
AUTO-REVUE FINALE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

Avant d'émettre, relis chaque fichier et vérifie :
□ "use client" ligne 1 sur toutes les vues et page.tsx ?
□ Named exports (export function NomView) sur toutes les vues ?
□ Named imports dans page.tsx ({ NomView } pas NomView en default) ?
□ globals.css : pas de @apply border-border sans tailwind.config.ts correspondant ?
□ Tous les champs accédés correspondent aux noms dans types/index.ts ?
□ key={...} sur tous les .map() ?
□ Tous les boutons ont un handler réel ?
□ Tous les imports avec @/ ?
`;

// =============================================================================
// FIXER AGENT — Corrections chirurgicales
// =============================================================================

const FIXER_PROMPT = `
Tu es un agent de correction et modification chirurgicale du code.
Tu traites DEUX types de demandes :
1. Corrections d'erreurs (build, TypeScript, runtime)
2. Modifications ciblées (ajouter une feature, changer un style, ajouter un fichier)

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Avant tout, émets sur UNE seule ligne :
[WORKING_ON]Description précise de ce que tu fais (ex: "Ajout de la page Settings" ou "Correction erreur TypeScript dans Dashboard")[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
PROCESSUS
══════════════════════════════════════════════════════════════════════

Pour une ERREUR :
1. Lis l'erreur exacte et identifie le fichier coupable
2. Utilise readFile() pour lire le fichier AVANT de le modifier
3. Applique la correction minimale ciblée
4. Vérifie que la correction ne casse rien d'autre

Pour une MODIFICATION :
1. Lis le(s) fichier(s) concerné(s) avec readFile() AVANT de modifier
2. Applique le changement demandé de façon chirurgicale
3. Si tu crées un nouveau fichier, ajoute son import dans page.tsx ou le fichier parent
4. Préserve intégralement tout ce qui n'est pas concerné par la modification

RÈGLE ABSOLUE : Pour les modifications < 40% du fichier — utilise TOUJOURS str_replace, JAMAIS create_file.
RÈGLE ABSOLUE : Lis toujours le fichier avec readFile() avant de le modifier.
RÈGLE ABSOLUE : Préserve intégralement le CSS, les classes Tailwind, la structure.

══════════════════════════════════════════════════════════════════════
ERREURS COURANTES ET LEURS CORRECTIONS
══════════════════════════════════════════════════════════════════════

"The \`border-border\` class does not exist" :
  → Dans globals.css, remplace @apply border-border; par border-color: hsl(var(--border));
  → OU génère/mets à jour tailwind.config.ts avec extend.colors

"Property 'children' does not exist on type 'NomProps'" :
  Cause : le composant s'utilise comme wrapper (<Button>Texte</Button>) mais children n'est pas dans l'interface Props.
  Fix : ajoute children: React.ReactNode dans l'interface Props du composant.
  interface ButtonProps {
    children: React.ReactNode;  // ← ajouter cette ligne
    // ...autres props
  }

"Property X does not exist on type 'IntrinsicAttributes & NomProps'" :
  Même cause — le prop X n'est pas déclaré dans l'interface NomProps.
  Fix : ajoute X: type dans l'interface Props correspondante.


  Cas A : pos.quantity mais interface déclare qty
  → Remplace pos.quantity par pos.qty partout dans ce fichier
  
  Cas A2 : service.submitContact() mais service déclare submitContactForm()
  → Aligne le nom : utilise readFile pour voir le nom exact dans le service,
    puis corrige l'appelant pour utiliser ce nom exact.
  
  Cas B : champ inexistant dans l'interface
  → Ajoute le champ dans types/index.ts ET initialise dans le store

"X is not exported from Y" :
  → Change export default function X en export function X dans le fichier source
  → OU change import X from '...' en import { X } from '...'

"Expression expected" (erreur Zustand) :
  → Dans le store, cherche les points-virgules à la fin des propriétés de l'objet create()
  → Remplace-les par des virgules
  → set({...}), dans un corps de fn → remplace par set({...});

"'use client' must be the first expression" :
  → Déplace "use client"; en toute première ligne du fichier

"Cannot find module '@monaco-editor/react'" :
  → Supprime l'import ET remplace Editor par :
    <textarea className="w-full h-full bg-neutral-900 text-green-400 font-mono text-sm p-4 resize-none outline-none"
      value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />

"params should be awaited" :
  → Change { params: { id: string } } en { params: Promise<{ id: string }> }
  → Ajoute const { id } = await params;

FORMATS DE CORRECTION DISPONIBLES :

⚠️ RÈGLE SÉPARATEUR : Avant CHAQUE <create_file>, émets "---" seul sur une ligne.

Option A — Réécriture complète (si plus de 40% du fichier change ou nouveau fichier) :
Je remplace/crée le fichier...
---
<create_file path="chemin/fichier.tsx">
... fichier entier corrigé ...
</create_file>

Option B — Édition chirurgicale str_replace (PRÉFÉRER pour moins de 40% de changements) :
<str_replace path="chemin/fichier.tsx">
<old_str>code exact à remplacer (doit être unique dans le fichier)</old_str>
<new_str>code corrigé</new_str>
</str_replace>

RÈGLE : Préfère TOUJOURS Option B (str_replace). Moins de risque de casser le reste.
Si tu utilises Option B, old_str doit être EXACTEMENT identique au code dans le fichier (copie littérale depuis readFile).

Rapport final en 2-3 lignes.
`;

// =============================================================================
// E2B TSC CHECK — Vérification TypeScript réelle dans un sandbox isolé
// =============================================================================

// tsconfig utilisé dans le sandbox — "node" au lieu de "bundler" (tsc standalone)
const TSC_CONFIG = JSON.stringify({
  compilerOptions: {
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    skipLibCheck: true,            // skip les .d.ts de node_modules seulement
    strict: false,                 // strict global OFF — on active les checks utiles manuellement
    strictNullChecks: true,        // ← ACTIVÉ : détecte null/undefined non gérés (erreurs réelles fréquentes)
    strictFunctionTypes: true,     // ← ACTIVÉ : détecte les incompatibilités de types de fonctions
    strictBindCallApply: true,     // ← ACTIVÉ : vérifie bind/call/apply correctement typés
    noImplicitAny: false,          // OFF : évite le bruit sur les any implicites (trop de faux positifs)
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    module: "commonjs",            // le plus compatible avec tsc standalone
    moduleResolution: "node",      // ← FIX CRITIQUE : "bundler" ne fonctionne pas en sandbox
    resolveJsonModule: true,
    isolatedModules: false,
    jsx: "react-jsx",
    incremental: false,
    baseUrl: ".",
    paths: { "@/*": ["./*"] },     // alias @/ → ./ pour résoudre les imports internes
    target: "ES2017",
    noUnusedLocals: false,         // OFF : pas de warnings sur les variables inutilisées
    noUnusedParameters: false,     // OFF : pas de warnings sur les paramètres inutilisés
    forceConsistentCasingInFileNames: true, // ← ACTIVÉ : détecte les imports avec mauvaise casse
  },
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules", ".next", "__stubs__.d.ts"],
}, null, 2);

// Stubs précis pour les packages qui ont une API importante à valider
const SPECIFIC_STUBS: Record<string, string> = {
  "zustand": `declare module "zustand" {
  type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
  type GetState<T> = () => T;
  type StoreApi<T> = { getState: GetState<T>; setState: SetState<T>; subscribe: (l: (s: T) => void) => () => void };
  export function create<T>(): (fn: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T) => (() => T) & StoreApi<T>;
  export function create<T>(fn: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T): (() => T) & StoreApi<T>;
}`,
  "zustand/middleware": `declare module "zustand/middleware" {
  export function persist(fn: any, opts?: any): any;
  export function devtools(fn: any, opts?: any): any;
  export function immer(fn: any): any;
  export function subscribeWithSelector(fn: any): any;
  export function combine(init: any, fn: any): any;
}`,
  "next/server": `declare module "next/server" {
  export class NextResponse extends Response {
    static json(data: any, init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
    static next(init?: any): NextResponse;
    static rewrite(url: string | URL): NextResponse;
  }
  export type NextRequest = Request & {
    cookies: { get: (k: string) => { value: string } | undefined; set: (k: string, v: string) => void; delete: (k: string) => void; getAll: () => any[] };
    nextUrl: URL & { pathname: string; searchParams: URLSearchParams };
    ip?: string;
    geo?: Record<string, string>;
  };
}`,
  "next/navigation": `declare module "next/navigation" {
  export function useRouter(): { push: (p: string, o?: any) => void; replace: (p: string, o?: any) => void; back: () => void; forward: () => void; refresh: () => void; prefetch: (p: string) => void };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams & { get: (k: string) => string | null };
  export function useParams<T = Record<string, string | string[]>>(): T;
  export function redirect(url: string, type?: any): never;
  export function notFound(): never;
}`,
  "next/image": `declare module "next/image" {
  interface ImageProps { src: any; alt: string; width?: number; height?: number; fill?: boolean; className?: string; style?: any; priority?: boolean; loading?: 'lazy' | 'eager'; quality?: number; placeholder?: string; blurDataURL?: string; sizes?: string; onLoad?: () => void; }
  const Image: (props: ImageProps) => JSX.Element;
  export default Image;
}`,
  "next/link": `declare module "next/link" {
  interface LinkProps { href: string | any; children?: any; className?: string; style?: any; prefetch?: boolean; replace?: boolean; scroll?: boolean; shallow?: boolean; passHref?: boolean; legacyBehavior?: boolean; onClick?: (e: any) => void; [k: string]: any; }
  const Link: (props: LinkProps) => JSX.Element;
  export default Link;
}`,
  "next/headers": `declare module "next/headers" {
  export function cookies(): { get: (k: string) => { value: string } | undefined; set: (k: string, v: string, o?: any) => void; delete: (k: string) => void; getAll: () => { name: string; value: string }[]; has: (k: string) => boolean };
  export function headers(): { get: (k: string) => string | null; has: (k: string) => boolean; entries: () => Iterable<[string, string]> };
}`,
  "next/font/google": `declare module "next/font/google" { export function Inter(o?: any): { className: string; style: any; variable: string }; export function Geist(o?: any): { className: string; style: any; variable: string }; export function Roboto(o?: any): { className: string; style: any; variable: string }; export function [key: string]: any; }`,
  "next/font/local": `declare module "next/font/local" { const fn: (o: any) => { className: string; style: any; variable: string }; export default fn; }`,
  // 'next' root — import { Metadata, NextPage, Viewport } from 'next'
  "next": `declare module "next" {
  export type Metadata = { title?: string | { default?: string; template?: string; absolute?: string }; description?: string; keywords?: string | string[]; openGraph?: any; twitter?: any; icons?: any; robots?: any; viewport?: any; themeColor?: any; manifest?: string; alternates?: any; [k: string]: any };
  export type Viewport = { width?: string | number; initialScale?: number; themeColor?: string; [k: string]: any };
  export type NextPage<P = {}, IP = P> = ((props: P) => any) & { getInitialProps?: (ctx: any) => Promise<IP> };
  export type NextApiRequest = any;
  export type NextApiResponse<T = any> = any;
  export type GetServerSideProps<T = any> = (ctx: any) => Promise<{ props: T } | { notFound: true } | { redirect: any }>;
  export type GetStaticProps<T = any> = (ctx: any) => Promise<{ props: T; revalidate?: number | boolean } | { notFound: true } | { redirect: any }>;
  export type GetStaticPaths = () => Promise<{ paths: any[]; fallback: boolean | 'blocking' }>;
}`,
};

// Packages ALWAYS_SKIP : ont de vraies @types installées dans le sandbox
// IMPORTANT : 'next' N'EST PAS dans cette liste — on fournit un stub précis dans SPECIFIC_STUBS
// car 'next' lui-même n'a pas de @types séparé, les types sont dans le package principal
const ALWAYS_SKIP = new Set(["react", "react-dom", "typescript", "@types/react", "@types/react-dom"]);

/**
 * Génère les stubs "shorthand ambient module" pour TOUS les packages importés
 * dans les fichiers. Le shorthand `declare module "xyz";` (sans corps) est la
 * forme la plus permissive : tous les imports sont typés `any`, zéro faux positif.
 * Les packages ayant un stub précis dans SPECIFIC_STUBS conservent leur stub complet.
 */
function buildDynamicStubs(files: { path: string; content: string }[]): string {
  const genericPackages = new Set<string>();
  const specificPackagesSeen = new Set<string>();

  for (const f of files) {
    const rx = /from\s+['"](@?[^./'"@][^'"]*)['"]/g;
    let m;
    while ((m = rx.exec(f.content)) !== null) {
      const raw = m[1];
      const root = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];

      if (ALWAYS_SKIP.has(root)) continue;

      // Si on a un stub précis pour ce package ou ce sous-chemin, on le garde
      if (SPECIFIC_STUBS[raw]) { specificPackagesSeen.add(raw); continue; }
      if (SPECIFIC_STUBS[root]) { specificPackagesSeen.add(root); continue; }

      // Sinon stub générique shorthand pour la racine ET le sous-chemin
      genericPackages.add(root);
      if (raw !== root) genericPackages.add(raw);
    }
  }

  const lines: string[] = [
    "// AUTO-GENERATED STUBS — NE PAS MODIFIER",
    "// Shorthand ambient modules : tous les imports sont typés 'any'",
    "",
  ];

  // Stubs précis pour les packages importants
  for (const [pkg, stub] of Object.entries(SPECIFIC_STUBS)) {
    if (specificPackagesSeen.has(pkg)) {
      lines.push(stub, "");
    }
  }

  // Stubs génériques shorthand pour tous les autres packages détectés
  for (const pkg of Array.from(genericPackages).sort()) {
    lines.push(`declare module "${pkg}";`);
  }

  // Assets statiques
  lines.push("", `declare module "*.css";`, `declare module "*.svg";`, `declare module "*.png";`, `declare module "*.jpg";`, `declare module "*.webp";`);

  return lines.join("\n");
}

interface TscCheckResult {
  errors: string;
  hasErrors: boolean;
  errorsByFile: Record<string, string[]>;
  errorCount: number;
  rawOutput: string; // sortie brute tsc pour debug
}

async function runTscCheck(
  files: { path: string; content: string }[],
  e2bApiKey: string,
  onProgress: (msg: string) => void
): Promise<TscCheckResult> {
  let sbx: Sandbox | null = null;
  try {
    onProgress("\n[TSC:START] Initialisation du sandbox E2B...\n");
    sbx = await Sandbox.create({ apiKey: e2bApiKey, timeoutMs: 120_000 });

    // ── PREUVE SANDBOX : ID réel E2B + empreinte de la VM ────────────────────
    // sbx.sandboxId = identifiant unique attribué par la plateforme E2B
    // On lit aussi /proc/sys/kernel/random/uuid pour avoir une empreinte interne unique
    const sandboxId = (sbx as any).sandboxId ?? (sbx as any).id ?? "inconnu";
    const vmProof = await sbx.commands.run(
      `echo "uuid=$(cat /proc/sys/kernel/random/uuid) node=$(node -v) kernel=$(uname -r | cut -d- -f1)"`,
      { timeoutMs: 5_000 }
    );
    onProgress(
      `[TSC:SANDBOX] 🔒 Sandbox E2B | sandboxId: ${sandboxId}\n` +
      `[TSC:SANDBOX]   VM → ${vmProof.stdout.trim()}\n`
    );
    // ─────────────────────────────────────────────────────────────────────────

    // Génère les stubs dynamiquement
    const dynamicStubs = buildDynamicStubs(files);
    const stubCount = (dynamicStubs.match(/^declare module/gm) ?? []).length;
    onProgress(`[TSC:STUBS] ${stubCount} stubs générés dynamiquement.\n`);

    await sbx.files.write("tsconfig.json", TSC_CONFIG);
    await sbx.files.write("__stubs__.d.ts", dynamicStubs);

    // Installe TypeScript + @types/react + @types/react-dom + @types/node
    // ⚠️ CRITIQUE : sans @types/react, tsc ne connaît pas JSX ni IntrinsicAttributes
    // et laisse passer silencieusement les erreurs de props React (className manquant, etc.)
    onProgress("[TSC:INSTALL] Installation de TypeScript + @types/react + @types/react-dom...\n");
    const installOut = await sbx.commands.run(
      "npm install --save-dev typescript @types/react@19 @types/react-dom@19 @types/node --no-package-lock 2>&1 | tail -3",
      { timeoutMs: 60_000 }
    );
    if (installOut.exitCode !== 0) {
      onProgress(`[TSC:WARN] npm install partiel : ${installOut.stdout.slice(-200)}\n`);
    }

    // Écrit tous les fichiers .ts / .tsx
    // ── CRITIQUE : crée TOUS les sous-dossiers avant d'écrire ────────────────
    // Sans mkdir -p, sbx.files.write() échoue silencieusement sur les chemins
    // imbriqués (components/views/Foo.tsx, app/api/route.ts, etc.)
    // → les fichiers ne sont pas écrits → tsc ne les voit pas → zéro erreur détectée
    const tsFiles = files.filter(f => f.path.endsWith(".ts") || f.path.endsWith(".tsx"));
    const allDirs = new Set(tsFiles.map(f => {
      const parts = f.path.split("/");
      parts.pop(); // retire le nom du fichier
      return parts.join("/");
    }).filter(Boolean));
    if (allDirs.size > 0) {
      const mkdirCmd = `mkdir -p ${Array.from(allDirs).map(d => `"${d}"`).join(" ")}`;
      await sbx.commands.run(mkdirCmd, { timeoutMs: 5_000 });
    }
    onProgress(`[TSC:FILES] Écriture de ${tsFiles.length} fichiers TypeScript dans le sandbox (${allDirs.size} dossiers créés)...\n`);
    // Écrit séquentiellement par groupe de 10 pour éviter les race conditions
    for (let i = 0; i < tsFiles.length; i += 10) {
      await Promise.all(tsFiles.slice(i, i + 10).map(f => sbx!.files.write(f.path, f.content)));
    }
    // Vérification : liste les fichiers réellement écrits
    const lsOut = await sbx.commands.run("find . -name '*.ts' -o -name '*.tsx' | grep -v node_modules | grep -v __stubs__ | sort", { timeoutMs: 5_000 });
    const writtenFiles = lsOut.stdout.trim().split("\n").filter(Boolean);
    onProgress(`[TSC:FILES] ✅ ${writtenFiles.length}/${tsFiles.length} fichiers confirmés dans le sandbox.\n`);
    if (writtenFiles.length < tsFiles.length) {
      const writtenSet = new Set(writtenFiles.map(p => p.replace(/^\.\//,"")));
      const missing = tsFiles.filter(f => !writtenSet.has(f.path)).map(f => f.path);
      onProgress(`[TSC:FILES] ⚠️ Fichiers NON écrits : ${missing.join(", ")}\n`);
    }

    // Lance tsc --noEmit et capture la sortie complète
    onProgress("[TSC:RUN] tsc --noEmit en cours...\n");
    const tscRun = await sbx.commands.run("npx tsc --noEmit --noErrorTruncation --pretty false 2>&1 || true", { timeoutMs: 90_000 });
    const rawOutput = (tscRun.stdout ?? "") + (tscRun.stderr ?? "");

    // Affiche le nombre de lignes total pour le diagnostic
    const rawLines = rawOutput.trim().split("\n").filter(Boolean);
    onProgress(`[TSC:RAW] ${rawLines.length} ligne(s) de sortie tsc brute.\n`);

    // ── Filtre CHIRURGICAL : exclut UNIQUEMENT les erreurs de packages externes ──
    // On ne filtre "Cannot find module" QUE si c'est un package npm externe (pas un @/ path)
    // Cela évite de masquer les erreurs d'imports internes cassés
    const externalPackages = Array.from((dynamicStubs.match(/^declare module "([^"]+)"/gm) ?? [])
      .map(l => l.replace(/^declare module "/, "").replace(/"$/, "")));

    const realErrorLines = rawOutput
      .split("\n")
      .filter(l => {
        if (!l.includes("error TS") && !l.includes(": error")) return false;
        if (l.includes("__stubs__")) return false; // erreurs dans notre fichier de stubs → ignorer
        // "Cannot find module" : garder si c'est un @/ interne, ignorer si c'est un package externe
        if (l.includes("Cannot find module") || l.includes("Could not find a declaration file")) {
          const modMatch = l.match(/Cannot find module '([^']+)'/);
          if (modMatch) {
            const mod = modMatch[1];
            if (mod.startsWith("@/") || mod.startsWith("./") || mod.startsWith("../")) {
              return true; // ← import interne cassé : VRAIE erreur, on la garde
            }
            return false; // package externe sans types → ignoré (couvert par stubs)
          }
          return false;
        }
        return true;
      });

    const hasErrors = realErrorLines.length > 0;

    if (!hasErrors) {
      onProgress("[TSC:OK] ✅ Zéro erreur TypeScript — build propre !\n");
      return { errors: "", hasErrors: false, errorsByFile: {}, errorCount: 0, rawOutput };
    }

    // ── Groupe par fichier avec numéro de ligne ───────────────────────────────
    const errorsByFile: Record<string, string[]> = {};
    for (const line of realErrorLines) {
      // Format tsc : components/views/Foo.tsx(75,17): error TS2322: ...
      const m = line.match(/^([^\s(]+\.tsx?)\((\d+),(\d+)\):\s*(error\s+TS\d+:\s*.+)$/);
      if (m) {
        const [, filePath, lineNum, col, message] = m;
        const clean = filePath.replace(/^\.\//, "");
        if (!errorsByFile[clean]) errorsByFile[clean] = [];
        errorsByFile[clean].push(`  L${lineNum}:${col} — ${message.trim()}`);
      } else {
        const key = "__global__";
        if (!errorsByFile[key]) errorsByFile[key] = [];
        errorsByFile[key].push(`  ${line.trim()}`);
      }
    }

    const errorCount = realErrorLines.length;
    const fileCount = Object.keys(errorsByFile).filter(k => k !== "__global__").length;

    // Rapport complet pour le log — toutes les erreurs sans troncature
    // (la limite était ici → le fixer ne voyait que 6 erreurs par fichier et laissait les autres)
    const fileReport = Object.entries(errorsByFile)
      .map(([f, errs]) =>
        `    📄 ${f === "__global__" ? "(global)" : f} — ${errs.length} erreur(s):\n` +
        errs.join("\n")  // TOUTES les erreurs, aucune troncature
      )
      .join("\n");

    onProgress(`[TSC:ERRORS] ⚠️ ${errorCount} erreur(s) dans ${fileCount} fichier(s) :\n${fileReport}\n`);

    return { errors: realErrorLines.join("\n"), hasErrors: true, errorsByFile, errorCount, rawOutput };

  } catch (err: any) {
    onProgress(`[TSC:SKIP] Sandbox E2B indisponible (${err.message?.slice(0, 80) ?? "?"}) — continue sans vérification.\n`);
    return { errors: "", hasErrors: false, errorsByFile: {}, errorCount: 0, rawOutput: "" };
  } finally {
    if (sbx) { try { await sbx.kill(); } catch {} }
  }
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    // Clé E2B pour le sandbox TypeScript (optionnelle — si absente, le check TSC est skippé)
    const e2bApiKey = req.headers.get("x-e2b-api-key") ?? process.env.E2B_API_KEY ?? "";

    const body = await req.json();
    const {
      history,
      uploadedImages,
      allReferenceImages,
      currentProjectFiles,
      clonedHtmlCss,
      uploadedFiles,
    }: {
      history: Message[];
      uploadedImages?: string[];
      allReferenceImages?: string[];
      currentProjectFiles?: { path: string; content: string }[];
      clonedHtmlCss?: string;
      uploadedFiles?: { fileName: string; base64Content: string }[];
    } = body;

    const lastUserMsg = history.filter((m) => m.role === "user").pop()?.content ?? "";
    const ai = new GoogleGenAI({ apiKey });

    // Design anchor (si HTML/CSS de référence cloné côté client)
    const designAnchor = buildDesignAnchor(clonedHtmlCss);

    // Contexte des fichiers du projet
    const CONTENT_SNAPSHOT_LIMIT = 60_000;
    const fileSnapshots: string[] = [];
    const fileList: string[] = [];

    (currentProjectFiles ?? []).forEach((f) => {
      const size = (f.content ?? "").length;
      if (size > 0 && size <= CONTENT_SNAPSHOT_LIMIT) {
        const numbered = f.content.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
        fileSnapshots.push(`<file_content_snapshot path="${f.path}">\n${numbered}\n</file_content_snapshot>`);
        fileList.push(`<file path="${f.path}" size="${size}" />`);
      } else if (size > CONTENT_SNAPSHOT_LIMIT) {
        fileList.push(`<file path="${f.path}" size="${size}" EXCLUDED_use_readFile />`);
      } else {
        fileList.push(`<file path="${f.path}" EMPTY />`);
      }
    });

    const projectContext = `# FICHIERS DU PROJET (${(currentProjectFiles ?? []).length} fichiers)\n${fileList.join("\n")}${fileSnapshots.length > 0 ? "\n\n# CONTENU\n" + fileSnapshots.join("\n\n") : ""}`;

    // History builder pour les agents avec chat
    const buildHistoryParts = (): { role: "user" | "model"; parts: Part[] }[] => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];

      // Style refs
      if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts = allReferenceImages.map((img) => ({
          inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
        contents.push({ role: "model", parts: [{ text: "Références de style reçues." }] });
      }

      history.forEach((msg, i) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img) =>
            parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } })
          );
          uploadedFiles?.forEach((f) => {
            parts.push({ text: `[FICHIER UPLOADÉ: ${f.fileName}]` });
          });
        }
        contents.push({ role, parts });
      });
      return contents;
    }

    // Helper: readFile tool handler
    const handleReadFile = (path: string): string => {
      const file = (currentProjectFiles ?? []).find(
        (f) => f.path === path || f.path === `./${path}` || path === `./${f.path}`
      );
      if (file) return `<file_content path="${file.path}">\n${file.content}\n</file_content>`;
      return `<error>Fichier "${path}" introuvable dans le projet.</error>`;
    }

    const stream = new ReadableStream({
      async start(controller) {
        // Émet uniquement du texte visible — jamais de code, jamais de markers internes
        const emit = (txt: string) => {
          if (txt.trim()) controller.enqueue(encoder.encode(txt));
        };

        // Accumule les tokens utilisés pendant toute la session
        let totalTokensUsed = 0;
        let totalPromptTokens = 0;
        let totalCandidatesTokens = 0;
        const onUsage = (usage: { totalTokenCount: number; promptTokenCount: number; candidatesTokenCount: number }) => {
          totalTokensUsed += usage.totalTokenCount;
          totalPromptTokens += usage.promptTokenCount;
          totalCandidatesTokens += usage.candidatesTokenCount;
        };

        let buffer = "";
        const onChunk = (txt: string) => {
          buffer += txt;
          if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
        };
        const flushBuffer = () => {
          if (buffer.trim()) { emit(buffer); buffer = ""; }
        };

        // Collecte silencieusement sans émettre (pour le PRESENTER et agents internes)
        const makeSilentCollector = (): { collect: (txt: string) => void; getOutput: () => string } => {
          let output = "";
          return {
            collect: (txt: string) => { output += txt; },
            getOutput: () => output,
          };
        }

        // ─── Agent runner avec support tool use (readFile) + thinkingConfig ────
        const runAgent = async (
          systemPrompt: string,
          userContent: string,
          opts: {
            temperature?: number;
            maxTokens?: number;
            useChatHistory?: boolean;
            emitOutput?: boolean;
            noTools?: boolean;
            agentName?: string;
            referenceImages?: string[]; // images injectées en tête du context (pour VIEWS)
          } = {}
        ): Promise<string> => {
          const { temperature = 1.0, maxTokens = 65536, useChatHistory = false, emitOutput = true, noTools = false, agentName = "", referenceImages } = opts;

          let contents: { role: "user" | "model"; parts: Part[] }[];

          if (useChatHistory) {
            contents = buildHistoryParts();
          } else {
            const parts: Part[] = [];
            // Inject reference images first (if any) — agent sees them before reading text
            if (referenceImages && referenceImages.length > 0) {
              referenceImages.forEach(img => parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } } as any));
              parts.push({ text: "[IMAGES DE RÉFÉRENCE DESIGN CI-DESSUS — Analyse-les en parallèle du design_reference pour valider et enrichir ton implémentation]\n\n" + userContent });
            } else {
              parts.push({ text: userContent });
            }
            contents = [{ role: "user", parts }];
          }

          let fullOutput = "";
          let thoughtsCollected = "";

          // Émetteur de pensées — collecte et émet via balise [THOUGHT:agentName]
          const emitThought = (txt: string) => {
            thoughtsCollected += txt;
          };

          const flushThoughts = () => {
            if (thoughtsCollected.trim() && agentName) {
              // On émet les pensées via une balise spéciale parsée côté frontend
              emit(`[THOUGHT:${agentName}]${thoughtsCollected}[/THOUGHT:${agentName}]`);
              thoughtsCollected = "";
            }
          };

          const thinkingConfig = { thinkingLevel: "HIGH" as const, includeThoughts: true };



          try {
            const result = await callWithRetry(
              async () => {
                const r = await ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents,
                  ...(noTools ? {} : { tools: [{ functionDeclarations: [readFileDecl] }] }),
                  config: {
                    systemInstruction: `${basePrompt}\n\n${systemPrompt}`,
                    temperature,
                    maxOutputTokens: maxTokens,
                    thinkingConfig,
                  },
                });
                return r as any;
              },
              emitOutput ? onChunk : () => {},
              { maxAttempts: 4, baseDelay: 12000, onThought: emitThought, onUsage }
            );
            flushThoughts();
            return result;
          } catch (e: any) {
            flushThoughts();
            if (emitOutput) onChunk(`\n[Erreur agent: ${e.message}]\n`);
            return "";
          }
        }; // end runAgent

        try {
          // effectiveReferenceImages — enrichi si le PRESENTER détecte une image de design
          let effectiveReferenceImages = allReferenceImages ?? [];

          // ═══════════════════════════════════════════════════════════════
          // ÉTAPE 1 — PRESENTER : décision + intro
          // Le PRESENTER collecte silencieusement. JAMAIS de code dans sa sortie.
          // On extrait la décision, puis on émet UNIQUEMENT le texte visible.
          // ═══════════════════════════════════════════════════════════════

          const presenterContents = buildHistoryParts();

          // Ajoute le contexte projet au dernier message
          const lastPart = presenterContents[presenterContents.length - 1];
          if (lastPart && lastPart.role === "user") {
            lastPart.parts.push({ text: `\n\n[CONTEXTE PROJET]\n${projectContext}` });
          }

          // ── PRESENTER : stream direct sans coupure ────────────────────────
          // On collecte ET on émet simultanément pour ne rien perdre.
          // La décision (CODE_ACTION / FIX_ACTION / CHAT_ONLY) est extraite
          // de la sortie complète une fois le stream terminé.
          let rawPresenterOutput = "";
          const presenterAndEmit = (txt: string) => {
            rawPresenterOutput += txt;
            // On n'émet PAS le mot-clé de décision lui-même (1ère ligne)
            // mais tout le reste est streamé directement
          };

          try {
            rawPresenterOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: presenterContents,
                config: {
                  systemInstruction: `${basePrompt}\n\n${PRESENTER_PROMPT}`,
                  temperature: 0.8, // plus bas = moins d'hallucination de code
                  maxOutputTokens: 512, // strict : juste assez pour 3-4 phrases + décision
                },
              }),
              presenterAndEmit,
              { maxAttempts: 3, baseDelay: 8000 }
            );
          } catch {
            rawPresenterOutput = "CODE_ACTION\nJe m'occupe de votre application tout de suite.";
          }

          // Extrait la décision (première ligne valide)
          const decisionMatch = rawPresenterOutput.match(/^(CODE_ACTION|FIX_ACTION|CHAT_ONLY)/m);
          const decision = decisionMatch ? decisionMatch[1] : "CHAT_ONLY";

          // Détecte si le PRESENTER a identifié l'image comme référence de design
          if (rawPresenterOutput.includes("[IMAGE_IS_DESIGN_REF]") && uploadedImages && uploadedImages.length > 0) {
            effectiveReferenceImages = [...uploadedImages, ...effectiveReferenceImages];
          }

          // ── Nettoyage STRICT du PRESENTER — NE JAMAIS exposer de code ──────
          // Stratégie : on coupe dès qu'on voit du code, et on ne garde que la prose initiale
          let presenterRaw = rawPresenterOutput;

          // 1. Retire les tags de contrôle internes
          presenterRaw = presenterRaw
            .replace(/^\[IMAGE_IS_DESIGN_REF\]\s*\n?/gm, "")
            .replace(/^(CODE_ACTION|FIX_ACTION|CHAT_ONLY)\s*\n?/gm, "");

          // 2. Coupe IMMÉDIATEMENT dès qu'on voit un marqueur de code
          // (premier <create_file, premier [[, premier ``` ou première ligne de code)
          const CODE_START_RE = /\[\[START\]\]|<create_file|<str_replace|```[a-z]/;
          const codeStartIdx = presenterRaw.search(CODE_START_RE);
          if (codeStartIdx >= 0) {
            presenterRaw = presenterRaw.slice(0, codeStartIdx);
          }

          // 3. Retire les blocs de code résiduels et les lignes qui ressemblent à du code
          presenterRaw = presenterRaw
            .replace(/<create_file[\s\S]*?<\/create_file>/gs, "")
            .replace(/<str_replace[\s\S]*?<\/str_replace>/gs, "")
            .replace(/```[\s\S]*?```/gs, "")
            .replace(/^[ \t]*(import |export |const |function |class |interface |type |return |<[A-Z][a-zA-Z]|<div|<section|<main|<header|<footer)[^\n]*/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          const visibleText = presenterRaw;

          // Émet le presenter intro complet
          emit("\n[PRESENTER:INTRO]\n");
          if (visibleText) emit(visibleText);
          emit("\n[/PRESENTER:INTRO]\n");

          // ═══════════════════════════════════════════════════════════════
          // MODE CHAT — fin simple
          // ═══════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
                        if (totalTokensUsed > 0) {
              emit(`\n[TOKEN_USAGE]${JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens })}[/TOKEN_USAGE]\n`);
            }
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // PATCH_ACTION est fusionné dans FIX_ACTION — plus de branche séparée

          // ═══════════════════════════════════════════════════════════════
          // MODE FIX — agent fixer uniquement
          // ═══════════════════════════════════════════════════════════════
          if (decision === "FIX_ACTION") {
            emit("\n[PHASE:1/FIX]\n");

            const brokenFiles = parseBrokenFiles(lastUserMsg);
            const brokenContext = brokenFiles.length > 0
              ? brokenFiles.map((fp) => {
                  const f = (currentProjectFiles ?? []).find((cf) => cf.path === fp || cf.path === `./${fp}`);
                  return f ? `\n=== ${f.path} ===\n${f.content}` : `\n=== ${fp} === (introuvable)`;
                }).join("\n")
              : "";

            const fixInput = `
DEMANDE (erreur OU modification ciblée) :
${lastUserMsg}

${activeDesignAnchor}

${brokenContext ? `FICHIERS SIGNALÉS :\n${brokenContext}\n\n` : ""}${projectContext}

Utilise readFile() pour lire TOUS les fichiers concernés avant de les modifier.
Préfère str_replace pour les modifications < 40% d'un fichier.
`;

            const fixOutput = await runAgent(FIXER_PROMPT, fixInput, { temperature: 0.7, maxTokens: 65536, agentName: "FIXER" });
            flushBuffer();

            // ── Appliquer les str_replace ops et créer les nouveaux fichiers ───
            const fixWorkingFiles: { path: string; content: string }[] = [
              ...(currentProjectFiles ?? []).map(f => ({ path: f.path, content: f.content })),
            ];
            const fixNewFiles = parseGeneratedFiles(fixOutput);
            fixNewFiles.forEach(f => {
              const idx = fixWorkingFiles.findIndex(g => g.path === f.path);
              if (idx >= 0) fixWorkingFiles[idx] = f; else fixWorkingFiles.push(f);
            });
            const fixOps = parseStrReplaceOps(fixOutput);
            if (fixOps.length > 0) {
              const srResult = applyStrReplaceToFiles(fixWorkingFiles, fixOps);
              emit(`\n[STR_REPLACE] ✅ ${srResult.applied} remplacement(s) appliqué(s) sans réécriture complète\n`);
              if (srResult.failed.length > 0) {
                emit(`\n[STR_REPLACE] ⚠️ ${srResult.failed.length} échoué(s): ${srResult.failed.map((f: any) => f.path).join(", ")}\n`);
              }
            }
            // Emit only actually-modified files with --- separator
            const modifiedPaths = new Set([
              ...fixNewFiles.map(f => f.path),
              ...fixOps.map(op => op.path),
            ]);
            fixWorkingFiles.forEach(f => {
              if (modifiedPaths.has(f.path)) {
                emit(`\n---\n<create_file path="${f.path}">\n${f.content}\n</create_file>`);
              }
            });

            // Package.json cumulatif si nouvelles dépendances
            const fixDeps = extractDeps(fixOutput);
            if (fixDeps.length > 0) {
              const existPkgFile2 = (currentProjectFiles ?? []).find((f) => f.path === "package.json");
              let existingPkg2: any = {
                name: "app", version: "1.0.0", private: true,
                scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
                dependencies: {}, devDependencies: {},
              };
              if (existPkgFile2) { try { existingPkg2 = JSON.parse(existPkgFile2.content); } catch {} }

              const fixBaseDeps: Record<string, string> = {
                next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.475.0",
                ...(existingPkg2.dependencies ?? {}),
              };
              const fixNewDeps: Record<string, string> = {};
              await Promise.all(fixDeps.map(async (pkg) => {
                if (!pkg || fixBaseDeps[pkg]) return;
                try { const d = await packageJson(pkg); fixNewDeps[pkg] = d.version as string; }
                catch { fixNewDeps[pkg] = "latest"; }
              }));
              if (Object.keys(fixNewDeps).length > 0) {
                existingPkg2.dependencies = { ...fixBaseDeps, ...fixNewDeps };
                emit(`\n---\n<create_file path="package.json">\n${JSON.stringify(existingPkg2, null, 2)}\n</create_file>`);
              }
            }

            // ── TSC après FIX_ACTION (si e2b disponible) ────────────────
            emit("\n[PHASE:2/TSC_CHECK]\n");
            if (e2bApiKey) {
              const fixTscFiles: { path: string; content: string }[] = [
                ...(currentProjectFiles ?? []).map(f => ({ path: f.path, content: f.content })),
              ];
              // Merge fix output into files
              parseGeneratedFiles(fixOutput).forEach(f => {
                const idx = fixTscFiles.findIndex(g => g.path === f.path);
                if (idx >= 0) fixTscFiles[idx] = f; else fixTscFiles.push(f);
              });
              const ops = parseStrReplaceOps(fixOutput);
              if (ops.length > 0) applyStrReplaceToFiles(fixTscFiles, ops);

              const fixTscResult = await runTscCheck(fixTscFiles, e2bApiKey, emit);
              if (fixTscResult.hasErrors) {
                await sleep(3000);
                const fix2Output = await runAgent(FIXER_PROMPT, `ERREURS TSC restantes:\n${fixTscResult.errors}\n\n${projectContext}`, {
                  temperature: 0.4, maxTokens: 32768, agentName: "TSC_FIXER2"
                });
                flushBuffer();
                parseGeneratedFiles(fix2Output).forEach(f => {
                  const idx = fixTscFiles.findIndex(g => g.path === f.path);
                  if (idx >= 0) fixTscFiles[idx] = f;
                  emit(`\n---\n<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                });
              }
            }

            if (totalTokensUsed > 0) {
              emit(`\n[TOKEN_USAGE]${JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens })}[/TOKEN_USAGE]\n`);
            }
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // MODE CODE — pipeline 3 agents
          // ═══════════════════════════════════════════════════════════════

          const globalPkgs = new Set<string>(["clsx", "tailwind-merge", "zustand", "autoprefixer", "sharp"]);
          const globalDevPkgs = new Set<string>();
          const allGeneratedFiles: { path: string; content: string }[] = [];

          const mergeGeneratedFiles = (files: { path: string; content: string }[]) => {
            for (const f of files) {
              const idx = allGeneratedFiles.findIndex((g) => g.path === f.path);
              if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
            }
          }

          // Applique les str_replace ops ET les create_file de la sortie d'un agent
          const mergeAgentOutput = (agentOutput: string) => {
            mergeGeneratedFiles(parseGeneratedFiles(agentOutput));
            const ops = parseStrReplaceOps(agentOutput);
            if (ops.length > 0) {
              const result = applyStrReplaceToFiles(allGeneratedFiles, ops);
              if (result.applied > 0) emit(`\n[STR_REPLACE] ✅ ${result.applied} remplacement(s) appliqué(s)\n`);
              if (result.failed.length > 0) {
                emit(`\n[STR_REPLACE] ⚠️ ${result.failed.length} remplacement(s) échoué(s): ${result.failed.map(f => f.path + ": " + f.reason).join(", ")}\n`);
              }
            }
            extractDeps(agentOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
            extractDeps(agentOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));
            parseGeneratedFiles(agentOutput).forEach((f) => {
              for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
                const pkg = m[1].split("/")[0];
                if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
              }
            });
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 0 — DESIGN AGENT (génère le HTML/CSS de référence)
          // ─────────────────────────────────────────────────────────────
          let activeDesignAnchor = designAnchor; // Peut être enrichi par le Design Agent

          if (effectiveReferenceImages && effectiveReferenceImages.length > 0) {
            emit("\n[PHASE:0/DESIGN]\n");
            
            // Extraction des couleurs des images de référence
            const colorExtractions = await Promise.all(
              effectiveReferenceImages.slice(0, 3).map(img => extractDominantColorsFromBase64(img))
            );
            const colorSummary = colorExtractions.flat().slice(0, 12)
              .map(c => `zone:${c.zone} → ${c.hex}`).join(", ");

            const designInput = `
Demande : "${lastUserMsg}"

Couleurs extraites des images de référence : ${colorSummary}

Analyse les images de style jointes et génère le HTML/CSS de référence de TRÈS HAUTE QUALITÉ.
Capture fidèlement : palette de couleurs exacte, typographie, densité visuelle, bordures, shadows, radius.
Sois AMBITIEUX et CRÉATIF — ce sera le guide visuel de toute l'application.
`;

            const designContents: { role: "user" | "model"; parts: any[] }[] = [];
            // Ajoute les images de référence
            const refParts = effectiveReferenceImages.map(img => ({
              inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) }
            }));
            designContents.push({ role: "user", parts: [...refParts, { text: designInput }] });

            try {
              const designOutput = await callWithRetry(
                () => ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents: designContents,
                  config: {
                    systemInstruction: `${basePrompt}\n\n${DESIGN_AGENT_PROMPT}`,
                    temperature: 1.0,
                    maxOutputTokens: 20480,
                    thinkingConfig: { thinkingLevel: "HIGH" as const, includeThoughts: true },
                  },
                }),
                () => {}, // silent — never streams to user
                { maxAttempts: 2, baseDelay: 8000 }
              );

              // Extract the design_reference block (HTML/CSS)
              const designMatch = designOutput.match(/<design_reference>([\s\S]*?)<\/design_reference>/);
              if (designMatch) {
                activeDesignAnchor = buildDesignAnchor(designMatch[1]);
                emit(`\n[DESIGN:READY] ✅ Design de référence généré (${designMatch[1].length} chars)\n`);
              } else {
                // Model may have output code accidentally — log but don't crash
                emit(`\n[DESIGN:SKIP] Balise design_reference absente — design fallback activé.\n`);
              }
            } catch (err: any) {
              emit(`\n[DESIGN:SKIP] Agent design indisponible (${err.message?.slice(0,60)}) — utilise le design existant.\n`);
            }
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 1 — FOUNDATION
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:1/CODE_FOUNDATION]\n");
          await sleep(1000);

          const foundationInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

${projectContext}

Génère la couche fondation complète selon tes instructions.
Types exhaustifs, stores Zustand corrects, tailwind.config.ts obligatoire.
Prends le temps de vérifier chaque store avant d'émettre.
`;

          const foundationOutput = await runAgent(FOUNDATION_PROMPT, foundationInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "FOUNDATION",
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(foundationOutput));
          extractDeps(foundationOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(foundationOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          // Scan des imports pour capturer les packages non déclarés
          parseGeneratedFiles(foundationOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          await sleep(2000);

          // ─────────────────────────────────────────────────────────────
          // PHASE 2 — UI COMPONENTS
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:2/CODE_UI]\n");

          const foundationSummary = allGeneratedFiles
            .map((f) => `=== ${f.path} ===\n${f.content}`)
            .join("\n---\n");

          const uiInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

FICHIERS FONDATION GÉNÉRÉS (résumé) :
${foundationSummary}

${projectContext}

Génère la couche hooks, API routes et composants UI.
Utilise readFile() si tu as besoin du contenu complet d'un fichier de fondation.
Vérifie les noms de champs dans types/index.ts avant de les utiliser.
`;

          const uiOutput = await runAgent(UI_AGENT_PROMPT, uiInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "FEATURES",
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 2) : undefined,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(uiOutput));
          extractDeps(uiOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(uiOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          parseGeneratedFiles(uiOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          await sleep(2000);

          // ─────────────────────────────────────────────────────────────
          // PHASE 3 — VIEWS
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:3/CODE_VIEWS]\n");

          const allPaths = allGeneratedFiles.map((f) => f.path).join("\n");
          const keyFilesSummary = allGeneratedFiles
            .filter((f) =>
              f.path === "types/index.ts" || f.path.includes("store") || f.path.includes("services/")
            )
            .map((f) => `=== ${f.path} ===\n${f.content}`)
            .join("\n---\n");

          const viewsInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

${effectiveReferenceImages.length > 0 ? `⚠️ DES IMAGES DE RÉFÉRENCE SONT JOINTES CI-DESSUS.
Utilise-les pour :
1. VALIDER que ton implémentation reproduit fidèlement chaque section visible
2. COMPARER section par section : hero, navigation, grilles, cards, footer, etc.
3. DÉTECTER ce qui manque ou diffère et le corriger immédiatement
4. Reproduire les micro-détails : gradients, overlays, typographie exacte, espacements
Ton objectif = que l'app finale soit INDISCERNABLE des images de référence.` : ""}

FICHIERS CLÉS DÉJÀ GÉNÉRÉS (types, stores, services) :
${keyFilesSummary}

TOUS LES FICHIERS GÉNÉRÉS :
${allPaths}

${projectContext}

Génère les vues, globals.css, layout et page.tsx.
Utilise readFile() pour consulter n'importe quel fichier existant.
Assure-toi que les noms de champs dans les vues correspondent EXACTEMENT à types/index.ts.
Respecte l'option A ou B pour globals.css (pas de mélange).
Chaque view doit avoir du CONTENU RÉEL et FONCTIONNEL.
`;

          const viewsOutput = await runAgent(VIEWS_AGENT_PROMPT, viewsInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "VIEWS",
            // Pass reference images directly so the agent can compare visually
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 3) : undefined,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(viewsOutput));
          extractDeps(viewsOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(viewsOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          parseGeneratedFiles(viewsOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          // ─────────────────────────────────────────────────────────────
          // PHASE 4 — POLISH (fixer léger si erreurs détectées)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:4/POLISH]\n");

          // Détection légère d'erreurs manifestes
          const obviousErrors = allGeneratedFiles.filter((f) => {
            const c = f.content;
            return (
              // Zustand void; dans le corps du create (hors interface)
              (f.path.endsWith(".ts") && c.includes("create<") &&
                (() => {
                  const withoutInterfaces = c.replace(/interface\s+\w+[\s\S]*?\n\}/g, "");
                  return /:\s*\(\s*\)\s*=>\s*void\s*;/.test(withoutInterfaces);
                })()) ||
              // "use client" manquant sur une view
              (f.path.includes("views/") && !c.includes('"use client"') && !c.includes("'use client'")) ||
              // Export default sur une view
              (f.path.includes("views/") && /export\s+default\s+function/.test(c) && !/export\s+function/.test(c)) ||
              // globals.css avec @apply de classes shadcn sans tailwind config
              (f.path.endsWith("globals.css") && /@apply\s+(border-border|bg-background|text-foreground)/.test(c) &&
                !allGeneratedFiles.some((tf) => tf.path === "tailwind.config.ts" && tf.content.includes('"border"')))
            );
          });

          if (obviousErrors.length > 0) {
            const errorContext = obviousErrors
              .map((f) => `\n=== ${f.path} ===\n${f.content}`)
              .join("\n");

            const polishInput = `
Ces fichiers contiennent des erreurs détectées automatiquement. Corrige-les :

${errorContext}

ERREURS DÉTECTÉES :
${allGeneratedFiles.find((f) => f.path.includes("store") && f.content.includes(": () => void;")) ? "- Zustand: void; trouvé dans le corps create()" : ""}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && !f.content.includes('"use client"')).map((f) => `- "use client" manquant : ${f.path}`).join("\n")}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && /export\s+default/.test(f.content)).map((f) => `- export default au lieu de named export : ${f.path}`).join("\n")}
${allGeneratedFiles.find((f) => f.path.endsWith("globals.css") && /@apply\s+border-border/.test(f.content)) ? "- globals.css: @apply border-border sans tailwind.config.ts" : ""}

Corrige UNIQUEMENT ces fichiers. Renvoie le fichier COMPLET corrigé.
`;

            const polishOutput = await runAgent(FIXER_PROMPT, polishInput, {
              temperature: 0.4,
              maxTokens: 32768,
              agentName: "POLISH",
            });
            flushBuffer();

            mergeGeneratedFiles(parseGeneratedFiles(polishOutput));
            extractDeps(polishOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          } else {
            // Pas d'erreurs détectées — émet un signal vide pour la phase
            emit("\nVérification : aucune erreur manifeste détectée.\n");
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 5 — TSC CHECK E2B (vérification TypeScript réelle)
          // Reproduit ce que Lovable/v0 font : sandbox isolé, tsc --noEmit,
          // boucle de correction automatique si des erreurs sont trouvées.
          // Transparent pour l'utilisateur — ne bloque pas le stream.
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:5/TSC_CHECK]\n");

          if (e2bApiKey) {
            const MAX_TSC_FIX_ROUNDS = 5; // max 5 rounds de correction — sécurité anti-boucle infinie

            // Premier check TSC
            let tscResult = await runTscCheck(allGeneratedFiles, e2bApiKey, emit);
            let round = 0;

            // Boucle : on continue tant qu'il y a des erreurs ET qu'on n'a pas atteint la limite
            while (tscResult.hasErrors && round < MAX_TSC_FIX_ROUNDS) {
              // ── Délai avant le fixer — Gemini a déjà enchaîné 3+ agents ──────────────
              // Sans délai, on risque un 429 / RESOURCE_EXHAUSTED
              const fixerDelay = round === 0 ? 8000 : 5000;
              emit(`\n[TSC:FIXER] Round ${round + 1}/${MAX_TSC_FIX_ROUNDS} — délai ${fixerDelay / 1000}s avant correction...\n`);
              await sleep(fixerDelay);
              emit(`[TSC:FIXER] Appel du Fixer Agent...\n`);

              // ── Identifie les fichiers cassés depuis le rapport errorsByFile ────────
              const brokenPaths = new Set<string>(Object.keys(tscResult.errorsByFile).filter(p => p !== "__global__"));
              const typesFile = allGeneratedFiles.find(f => f.path === "types/index.ts");
              const addLineNumbers = (content: string): string =>
                content.split("\n").map((l, i) => `${String(i + 1).padStart(4, " ")} | ${l}`).join("\n");

              // ── Contexte complet pour le fixer ────────────────────────────────
              // CRITIQUE : le fixer reçoit TOUS les fichiers cassés sans troncature
              // + les fichiers de référence (types, stores, services) pour comprendre les dépendances
              const brokenFilesContext = Array.from(brokenPaths)
                .map(p => {
                  const f = allGeneratedFiles.find(g => g.path === p);
                  if (!f) return `\n// FICHIER INTROUVABLE : ${p}`;
                  const errList = (tscResult.errorsByFile[p] ?? []).join("\n");
                  return (
                    `\n${"=".repeat(60)}\n` +
                    `FICHIER : ${f.path} (${f.content.split("\n").length} lignes)\n` +
                    `ERREURS TSC DANS CE FICHIER :\n${errList}\n` +
                    `${"=".repeat(60)}\n` +
                    addLineNumbers(f.content)
                  );
                })
                .filter(Boolean)
                .join("\n"); // PAS de .slice() — toutes les erreurs, tous les fichiers

              // Fichiers de référence non cassés mais dont dépendent les fichiers cassés
              // (stores, services, utils — indispensables pour corriger les erreurs de types)
              const referencePaths = new Set<string>();
              for (const p of brokenPaths) {
                const f = allGeneratedFiles.find(g => g.path === p);
                if (!f) continue;
                // Cherche les imports @/ dans le fichier cassé
                for (const m of f.content.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)) {
                  const importPath = m[1].replace("@/", "") + ".ts";
                  const importPathTsx = m[1].replace("@/", "") + ".tsx";
                  const found = allGeneratedFiles.find(g =>
                    g.path === importPath || g.path === importPathTsx ||
                    g.path === importPath.replace(".ts", "/index.ts")
                  );
                  if (found && !brokenPaths.has(found.path)) referencePaths.add(found.path);
                }
              }

              const typesContext = typesFile
                ? `\n${"=".repeat(60)}\nRÉFÉRENCE TYPES : ${typesFile.path}\n${"=".repeat(60)}\n${addLineNumbers(typesFile.content)}`
                : "";

              const referenceContext = Array.from(referencePaths)
                .filter(p => p !== "types/index.ts") // déjà dans typesContext
                .map(p => {
                  const f = allGeneratedFiles.find(g => g.path === p)!;
                  return `\n${"─".repeat(60)}\nRÉFÉRENCE (importé par les fichiers cassés) : ${f.path}\n${"─".repeat(60)}\n${f.content}`;
                })
                .join("\n");

              const globalErrors = tscResult.errorsByFile["__global__"]
                ? `\nERREURS GLOBALES :\n${tscResult.errorsByFile["__global__"].join("\n")}`
                : "";

              const tscFixInput = `
Tu es un correcteur TypeScript de précision chirurgicale.
Voici la sortie exacte de "tsc --noEmit" pour les fichiers générés.

COMMENT LIRE LES ERREURS :
- Format : L<ligne>:<colonne> — error TSxxxx: <message>
- Les fichiers sont affichés avec numéros de ligne : "  42 | code ici"
- Navigue jusqu'à la ligne indiquée pour voir le code exact à corriger

ERREURS TYPESCRIPT RÉELLES (${tscResult.errorCount} erreurs) :
${"─".repeat(60)}
${tscResult.errors}
${"─".repeat(60)}
${globalErrors}

FICHIERS CASSÉS (avec numéros de ligne) :
${brokenFilesContext || "(aucun fichier localisé — cherche dans les stores et types)"}
${typesContext}
${referenceContext}

INSTRUCTIONS DE CORRECTION :
1. Lis le numéro de ligne dans l'erreur tsc (ex: L45)
2. Repère la ligne 45 dans le fichier (marquée "  45 | ...")
3. Corrige UNIQUEMENT ce qui est cassé — ne change RIEN d'autre
4. Émets le fichier COMPLET corrigé (sans les numéros de ligne — code propre)

PATTERNS FRÉQUENTS :
- "Property X does not exist on type 'IntrinsicAttributes'" → le composant n'a pas X dans ses Props → ajoute-le
- "Property X does not exist on type Y" → champ mal nommé vs types/index.ts, aligne les noms
- "Module has no exported member X" → export default vs named export, corrige l'import/export
- "Argument of type A is not assignable to parameter of type B" → cast ou correction de type
- "() => void" dans Zustand create() → remplace par l'implémentation réelle avec set()
- "'use client' must be first" → déplace en ligne 1 absolue
`;

              // ── Appel réel du FIXER_AGENT — visible dans le stream ───────────────────
              // noTools: true → le fixer ne peut pas appeler readFile mid-stream.
              // Il reçoit déjà tout le contexte dans le prompt (fichiers cassés + références).
              // Sans noTools, le model appelle readFile, chunk.text devient vide,
              // callWithRetry arrête de collecter → fichier tronqué → 0 fichier parsé → break.
              const tscFixOutput = await runAgent(FIXER_PROMPT, tscFixInput, {
                temperature: 0.2,
                maxTokens: 65536, // augmenté : 32768 pouvait couper les gros fichiers
                agentName: "TSC_FIXER",
                emitOutput: true,
                noTools: true, // ← CRITIQUE : empêche l'interruption mid-stream par tool call
              });

              const fixedFiles = parseGeneratedFiles(tscFixOutput);
              const strReplaceOps = parseStrReplaceOps(tscFixOutput);
              const hasChanges = fixedFiles.length > 0 || strReplaceOps.length > 0;

              if (fixedFiles.length > 0) {
                emit(`\n[TSC:FIXER] ✅ ${fixedFiles.length} fichier(s) réécrits : ${fixedFiles.map(f => f.path).join(", ")}\n`);
                mergeGeneratedFiles(fixedFiles);
                extractDeps(tscFixOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
              }
              if (strReplaceOps.length > 0) {
                const srResult = applyStrReplaceToFiles(allGeneratedFiles, strReplaceOps);
                emit(`\n[TSC:FIXER] ✅ ${srResult.applied} str_replace(s) appliqué(s)\n`);
                if (srResult.failed.length > 0) {
                  emit(`\n[TSC:FIXER] ⚠️ ${srResult.failed.length} str_replace(s) échoué(s) : ${srResult.failed.map(f => f.path + ": " + f.reason).join(", ")}\n`);
                }
              }
              if (!hasChanges) {
                // Pas de fichiers émis — on log mais on NE BREAK PAS.
                // Le re-check TSC déterminera s'il reste vraiment des erreurs.
                emit(`\n[TSC:FIXER] ⚠️ Aucune modification émise par le fixer ce round.\n`);
              }

              round++;

              // Re-run TSC pour vérifier si les corrections ont tout résolu
              if (round < MAX_TSC_FIX_ROUNDS) {
                emit(`\n[TSC:RECHECK] Relance tsc après correction (round ${round})...\n`);
                tscResult = await runTscCheck(allGeneratedFiles, e2bApiKey, emit);
                if (!tscResult.hasErrors) {
                  emit(`\n[TSC:OK] ✅ Plus aucune erreur après ${round} round(s) de correction !\n`);
                }
              }
            }

            if (tscResult.hasErrors && round >= MAX_TSC_FIX_ROUNDS) {
              emit(`\n[TSC:WARN] ⚠️ ${tscResult.errorCount} erreur(s) persistent après ${MAX_TSC_FIX_ROUNDS} rounds — le projet peut encore contenir des erreurs TypeScript.\n`);
            }
          } else {
            emit("[TSC:SKIP] Clé E2B manquante — ajoutez E2B_API_KEY dans vos variables d'environnement pour activer la vérification TypeScript automatique.\n");
          }
          // ─────────────────────────────────────────────────────────────

          // Helper de scan d'imports - capture AUSSI les @scope/package
          // L'ancienne regex [^@./] excluait @radix-ui, @tanstack, etc.
          const scanImports = (c: string) => {
            const pkgRx = /from\s+['"]([^'"]+)['"]/g;
            let pkgM; while ((pkgM = pkgRx.exec(c)) !== null) {
              const raw = pkgM[1];
              if (raw.startsWith('.') || raw.startsWith('@/')) continue;
              const root = raw.startsWith('@') ? raw.split('/').slice(0,2).join('/') : raw.split('/')[0];
              if (root && root !== 'next' && root !== 'react' && root !== 'react-dom') globalPkgs.add(root);
            }
          };
          // Scan final des imports (inclut fichiers corrigés par TSC fixer)
          for (const f of allGeneratedFiles) scanImports(f.content);


          // Émet tous les fichiers
          for (const f of allGeneratedFiles) {
            emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
          }

          // ─────────────────────────────────────────────────────────────
          // PACKAGE.JSON — MERGE INTELLIGENT ET CUMULATIF
          // Règle : on ne perd JAMAIS une dépendance existante.
          // On ajoute uniquement les nouvelles. On ne réécrit jamais l'existant.
          // ─────────────────────────────────────────────────────────────

          // 1. Scan deja fait ci-dessus via scanImports()

          // 2. Packages à exclure des deps (dev-only ou builtin)
          const DEV_ONLY = new Set([
            "typescript", "@types/node", "@types/react", "@types/react-dom",
            "postcss", "tailwindcss", "eslint", "eslint-config-next",
            "autoprefixer", "@types/autoprefixer",
          ]);
          const PACKAGES_TO_IGNORE = new Set(["react", "react-dom", "next", "sharp", "autoprefixer"]);

          // 3. Charge le package.json existant (version complète, pas juste les deps)
          const existPkgFile = (currentProjectFiles ?? []).find((f) => f.path === "package.json");
          let existingPkg: any = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: {},
            devDependencies: {},
          };
          if (existPkgFile) {
            try { existingPkg = JSON.parse(existPkgFile.content); } catch {}
          }

          // 4. Deps de base toujours présentes
          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.475.0", sharp: "0.33.5",
            clsx: "2.1.1", "tailwind-merge": "2.3.0", zustand: "4.5.2",
            "@e2b/code-interpreter": "^1.0.0",
          };

          const baseDev: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
            postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19",
            eslint: "^8", "eslint-config-next": "15.0.3",
          };

          // 5. Commence avec tout ce qui est déjà dans le package.json existant
          const finalDeps: Record<string, string> = {
            ...baseDeps,
            ...(existingPkg.dependencies ?? {}),
          };
          const finalDevDeps: Record<string, string> = {
            ...baseDev,
            ...(existingPkg.devDependencies ?? {}),
          };

          // 6. Résout les nouvelles dépendances détectées (celles qui ne sont pas déjà présentes)
          const newPkgsToResolve = Array.from(globalPkgs).filter(
            (pkg) => pkg && !finalDeps[pkg] && !finalDevDeps[pkg] && !PACKAGES_TO_IGNORE.has(pkg)
          );
          const newDevPkgsToResolve = Array.from(globalDevPkgs).filter(
            (pkg) => pkg && !finalDeps[pkg] && !finalDevDeps[pkg]
          );

          await Promise.all([
            ...newPkgsToResolve.map(async (pkg) => {
              if (DEV_ONLY.has(pkg)) {
                try { const d = await packageJson(pkg); finalDevDeps[pkg] = d.version as string; } catch { finalDevDeps[pkg] = "latest"; }
              } else {
                try { const d = await packageJson(pkg); finalDeps[pkg] = d.version as string; } catch { finalDeps[pkg] = "latest"; }
              }
            }),
            ...newDevPkgsToResolve.map(async (pkg) => {
              try { const d = await packageJson(pkg); finalDevDeps[pkg] = d.version as string; } catch { finalDevDeps[pkg] = "latest"; }
            }),
          ]);

          // 7. Résout les @types automatiques pour les nouvelles deps
          const autoTypes = await resolveTypes(newPkgsToResolve, finalDevDeps);
          Object.assign(finalDevDeps, autoTypes);

          // 8. Émission du package.json fusionné
          const pkgJson = {
            ...existingPkg,
            name: existingPkg.name || "app",
            version: existingPkg.version || "1.0.0",
            private: true,
            scripts: {
              dev: "next dev", build: "next build", start: "next start", lint: "next lint",
              ...(existingPkg.scripts ?? {}),
            },
            dependencies: finalDeps,
            devDependencies: finalDevDeps,
          };
          emit(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);

          // ─────────────────────────────────────────────────────────────
          // PHASE 6 — SUMMARY (résumé utilisateur + variables d'env requises)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:6/SUMMARY]\n");

          const requiredEnvVars = detectEnvVars(allGeneratedFiles);
          const filesSummary = allGeneratedFiles
            .map(f => `- ${f.path}`)
            .join("\n");

          const summaryInput = `
Tu viens de terminer la construction d'une application Next.js pour l'utilisateur.
Voici ce qui a été généré :

FICHIERS CRÉÉS :
${filesSummary}

${requiredEnvVars.length > 0 ? `VARIABLES D'ENVIRONNEMENT REQUISES (détectées dans le code) :
${requiredEnvVars.map(v => `- ${v}`).join("\n")}` : "Aucune variable d'environnement requise détectée."}

DEMANDE ORIGINALE DE L'UTILISATEUR : "${lastUserMsg}"

Écris un message de conclusion structuré avec :
1. Une phrase d'annonce que le projet est prêt
2. Ce que l'application fait concrètement (fonctionnalités utilisateur)
3. Si des variables d'environnement sont requises : une section claire "🔑 Variables d'environnement requises" listant chaque variable avec une courte description de ce qu'elle représente
4. Comment lancer le projet (npm install puis npm run dev)
5. Une invitation à demander des modifications

Format : prose naturelle en français, max 10 phrases. Pas de code. Pas de noms de fichiers techniques.
`;

          let summaryOutput = "";
          try {
            summaryOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: [{ role: "user", parts: [{ text: summaryInput }] }],
                config: {
                  systemInstruction: `${basePrompt}\n\n${PRESENTER_OUTRO_PROMPT}`,
                  temperature: 0.7,
                  maxOutputTokens: 2048,
                  thinkingConfig: { thinkingLevel: "LOW" as const },
                },
              }),
              () => {},
              { maxAttempts: 2, baseDelay: 5000 }
            );
          } catch { summaryOutput = "Ton application est prête ! Lance \`npm install\` puis \`npm run dev\` pour la démarrer."; }

          emit("\n[PRESENTER:OUTRO]\n");
          emit(summaryOutput.trim());
          if (requiredEnvVars.length > 0) {
            emit("\n\n[ENV_VARS]" + JSON.stringify(requiredEnvVars) + "[/ENV_VARS]");
          }
          emit("\n[/PRESENTER:OUTRO]\n");

          flushBuffer();
          // Émet les tokens consommés pour la session
          if (totalTokensUsed > 0) {
            emit(`\n[TOKEN_USAGE]${JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens })}[/TOKEN_USAGE]\n`);
          }
          emit("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Pipeline error:", err);
          // Detect quota errors
          const isQuota = String(err.message).includes("429") || String(err.message).includes("RESOURCE_EXHAUSTED") || String(err.message).includes("quota");
          if (isQuota) {
            emit(`\n[QUOTA_EXCEEDED]${JSON.stringify({ message: err.message, resetHint: "La limite quotidienne Gemini API sera réinitialisée demain à minuit (PST)." })}[/QUOTA_EXCEEDED]\n`);
          }
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
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
