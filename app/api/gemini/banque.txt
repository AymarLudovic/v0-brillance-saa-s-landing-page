import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";
import { Sandbox } from "@e2b/code-interpreter";

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
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  return files;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
- Des balises XML ou HTML (<create_file>, <div>, etc.)
- Des blocs de code markdown (\`\`\`typescript ... \`\`\`)
- Des imports de modules
- Des extraits de fichiers

Tu parles UNIQUEMENT en prose naturelle, en français.
Si tu te surprends à écrire "import" ou "export" ou "<" dans ta réponse → ARRÊTE.
Ton rôle est de PARLER à l'utilisateur, pas de coder.

══════════════════════════════════════════════════════════════════════
RÔLE 1 — DÉCISION (toujours en premier, sur une ligne seule)
══════════════════════════════════════════════════════════════════════

Lis le message de l'utilisateur et décide :

▸ CODE_ACTION  — l'utilisateur veut créer ou reconstruire une application
▸ FIX_ACTION   — l'utilisateur signale une erreur, un bug, veut modifier quelque chose
▸ CHAT_ONLY    — l'utilisateur pose une question, discute, demande des conseils

Place LE MOT-CLÉ EXACT sur la première ligne de ta réponse, seul.
Ensuite écris ta réponse en prose.

Exemple de réponse valide :
CODE_ACTION
Super, je comprends ce que tu veux construire. Je vais créer une application de gestion...

Exemple INVALIDE (ne jamais faire ça) :
CODE_ACTION
import { NextResponse } from 'next/server';   ← INTERDIT, c'est du code

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
RÔLE 4 — FIX INTRO (si FIX_ACTION, 1-2 phrases)
══════════════════════════════════════════════════════════════════════

Dis que tu as identifié le problème et que tu vas le corriger. Rien d'autre.
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

const FOUNDATION_PROMPT = `
Tu es un Architecte Full Stack Senior — Expert TypeScript, Zustand, et Next.js 15.
Tu génères la couche fondation d'une application : types, utilitaires, services, stores.

${ERROR_PREVENTION_BIBLE}

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

Utilise UNIQUEMENT ce format. JAMAIS de blocs markdown autour.
<create_file path="types/index.ts">
... code complet ...
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
`;

// =============================================================================
// PHASE 3 — VIEWS_AGENT
// components/views/*.tsx, components/Modals.tsx, app/globals.css, app/layout.tsx, app/page.tsx
// =============================================================================

const VIEWS_AGENT_PROMPT = `
Tu es un Lead Frontend Designer + Engineer — Expert UI/UX, React, Tailwind, animations.
Tu génères les vues finales, le layout et la page principale.

${ERROR_PREVENTION_BIBLE}

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

5. app/page.tsx
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

<create_file path="components/views/DashboardView.tsx">
"use client";
import { useDashboardStore } from '@/stores/useDashboardStore';
... code complet fonctionnel ...
export function DashboardView() { ... }
</create_file>

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
Tu es un compilateur TypeScript/ESLint de précision chirurgicale.
Tu reçois une erreur de build précise et les fichiers cassés.
Ta mission : corriger UNIQUEMENT l'erreur signalée, rien de plus.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
PROCESSUS DE CORRECTION
══════════════════════════════════════════════════════════════════════

1. Lis l'erreur exacte
2. Identifie le fichier et la ligne coupable
3. Applique la correction minimale
4. Vérifie que la correction ne casse rien d'autre

RÈGLE ABSOLUE : Émet le fichier COMPLET corrigé, jamais de diff ou de "...".
RÈGLE ABSOLUE : Ne change RIEN d'autre que l'erreur identifiée.
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

FORMAT :
<create_file path="chemin/fichier.tsx">
... fichier entier corrigé ...
</create_file>

Rapport de correction en 2-3 lignes.
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
    const tscRun = await sbx.commands.run("npx tsc --noEmit 2>&1 || true", { timeoutMs: 90_000 });
    const rawOutput = (tscRun.stdout ?? "") + (tscRun.stderr ?? "");

    // ── DEBUG : affiche la sortie brute tsc si elle est longue (aide au diagnostic) ──
    const rawLines = rawOutput.trim().split("\n").filter(Boolean);
    if (rawLines.length > 0 && rawLines.length <= 8) {
      onProgress(`[TSC:RAW] Sortie tsc : ${rawOutput.trim()}\n`);
    } else if (rawLines.length > 8) {
      onProgress(`[TSC:RAW] ${rawLines.length} lignes de sortie tsc (premières : ${rawLines.slice(0, 3).join(" | ")})\n`);
    }

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
    function buildHistoryParts(): { role: "user" | "model"; parts: Part[] }[] {
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
    function handleReadFile(path: string): string {
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

        let buffer = "";
        function onChunk(txt: string) {
          buffer += txt;
          if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
        }
        function flushBuffer() {
          if (buffer.trim()) { emit(buffer); buffer = ""; }
        }

        // Collecte silencieusement sans émettre (pour le PRESENTER et agents internes)
        function makeSilentCollector(): { collect: (txt: string) => void; getOutput: () => string } {
          let output = "";
          return {
            collect: (txt: string) => { output += txt; },
            getOutput: () => output,
          };
        }

        // ─── Agent runner avec support tool use (readFile) ─────────────────
        async function runAgent(
          systemPrompt: string,
          userContent: string,
          opts: {
            temperature?: number;
            maxTokens?: number;
            useChatHistory?: boolean;
            emitOutput?: boolean;
          } = {}
        ): Promise<string> {
          const { temperature = 1.0, maxTokens = 65536, useChatHistory = false, emitOutput = true } = opts;

          let contents: { role: "user" | "model"; parts: Part[] }[];

          if (useChatHistory) {
            contents = buildHistoryParts();
          } else {
            contents = [{ role: "user", parts: [{ text: userContent }] }];
          }

          let fullOutput = "";

          const callOnce = async (): Promise<string> => {
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDecl] }],
              config: {
                systemInstruction: `${basePrompt}\n\n${systemPrompt}`,
                temperature,
                maxOutputTokens: maxTokens,
              },
            });

            for await (const chunk of response) {
              // Handle tool calls (readFile)
              if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                for (const call of chunk.functionCalls) {
                  if (call.name === "readFile") {
                    const path = (call.args as any)?.path ?? "";
                    const fileContent = handleReadFile(path);
                    // Injecte le résultat dans les contents pour le prochain turn
                    contents.push({ role: "model", parts: [{ functionCall: call } as any] });
                    contents.push({ role: "user", parts: [{ functionResponse: { name: "readFile", response: { content: fileContent } } } as any] });
                  }
                }
                // Continue la génération avec le tool result
                const continueResponse = await ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents,
                  tools: [{ functionDeclarations: [readFileDecl] }],
                  config: {
                    systemInstruction: `${basePrompt}\n\n${systemPrompt}`,
                    temperature,
                    maxOutputTokens: maxTokens,
                  },
                });
                for await (const cont of continueResponse) {
                  const txt = cont.text;
                  if (txt) { fullOutput += txt; if (emitOutput) onChunk(txt); }
                }
                return fullOutput;
              }

              const txt = chunk.text;
              if (txt) { fullOutput += txt; if (emitOutput) onChunk(txt); }
            }
            return fullOutput;
          };

          try {
            return await callWithRetry(
              async () => {
                const r = await ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents,
                  tools: [{ functionDeclarations: [readFileDecl] }],
                  config: {
                    systemInstruction: `${basePrompt}\n\n${systemPrompt}`,
                    temperature,
                    maxOutputTokens: maxTokens,
                  },
                });
                return r as any;
              },
              emitOutput ? onChunk : () => {},
              { maxAttempts: 4, baseDelay: 12000 }
            );
          } catch (e: any) {
            if (emitOutput) onChunk(`\n[Erreur agent: ${e.message}]\n`);
            return "";
          }
        }

        try {
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

          const presenterCollector = makeSilentCollector();
          let rawPresenterOutput = "";

          try {
            rawPresenterOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: presenterContents,
                config: {
                  systemInstruction: `${basePrompt}\n\n${PRESENTER_PROMPT}`,
                  temperature: 1.2,
                  maxOutputTokens: 512,
                },
              }),
              presenterCollector.collect, // ← SILENCIEUX, jamais dans onChunk
              { maxAttempts: 3, baseDelay: 8000 }
            );
          } catch {
            rawPresenterOutput = "CODE_ACTION\nJe m'occupe de votre application tout de suite.";
          }

          // Extrait la décision
          const decisionMatch = rawPresenterOutput.match(/^(CODE_ACTION|FIX_ACTION|CHAT_ONLY)/m);
          const decision = decisionMatch ? decisionMatch[1] : "CHAT_ONLY";

          // Extrait UNIQUEMENT le texte visible — tout ce qui vient après le mot-clé de décision
          // ET qui n'est pas du code (pas de <create_file>, import, export, etc.)
          const visibleText = rawPresenterOutput
            .replace(/^(CODE_ACTION|FIX_ACTION|CHAT_ONLY)\s*/m, "")
            .replace(/<create_file[\s\S]*?<\/create_file>/g, "")
            .replace(/^import\s.+$/gm, "")
            .replace(/^export\s.+$/gm, "")
            .replace(/^const\s.+$/gm, "")
            .replace(/```[\s\S]*?```/g, "")
            .trim();

          // Émet le presenter intro visible
          emit("\n[PRESENTER:INTRO]\n");
          if (visibleText) emit(visibleText);
          emit("\n[/PRESENTER:INTRO]\n");

          // ═══════════════════════════════════════════════════════════════
          // MODE CHAT — fin simple
          // ═══════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // MODE FIX — agent fixer uniquement
          // ═══════════════════════════════════════════════════════════════
          if (decision === "FIX_ACTION") {
            emit("\n[PHASE:1/POLISH]\n");

            const brokenFiles = parseBrokenFiles(lastUserMsg);
            const brokenContext = brokenFiles.length > 0
              ? brokenFiles.map((fp) => {
                  const f = (currentProjectFiles ?? []).find((cf) => cf.path === fp || cf.path === `./${fp}`);
                  return f ? `\n=== ${f.path} ===\n${f.content}` : `\n=== ${fp} === (introuvable)`;
                }).join("\n")
              : "";

            const fixInput = `
ERREUR / DEMANDE DE MODIFICATION :
${lastUserMsg}

${brokenContext ? `FICHIERS CONCERNÉS :\n${brokenContext.slice(0, 24000)}` : projectContext.slice(0, 24000)}
`;

            const fixOutput = await runAgent(FIXER_PROMPT, fixInput, { temperature: 0.4, maxTokens: 32768 });
            flushBuffer();

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
                emit(`<create_file path="package.json">\n${JSON.stringify(existingPkg2, null, 2)}\n</create_file>`);
              }
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

          function mergeGeneratedFiles(files: { path: string; content: string }[]) {
            for (const f of files) {
              const idx = allGeneratedFiles.findIndex((g) => g.path === f.path);
              if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
            }
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 1 — FOUNDATION
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:1/CODE_FOUNDATION]\n");
          await sleep(1000);

          const foundationInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${designAnchor}

${projectContext}

Génère la couche fondation complète selon tes instructions.
Types exhaustifs, stores Zustand corrects, tailwind.config.ts obligatoire.
Prends le temps de vérifier chaque store avant d'émettre.
`;

          const foundationOutput = await runAgent(FOUNDATION_PROMPT, foundationInput, {
            temperature: 1.4,
            maxTokens: 65536,
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
            .map((f) => `=== ${f.path} ===\n${f.content.slice(0, 800)}`)
            .join("\n---\n");

          const uiInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${designAnchor}

FICHIERS FONDATION GÉNÉRÉS (résumé) :
${foundationSummary.slice(0, 12000)}

${projectContext}

Génère la couche hooks, API routes et composants UI.
Utilise readFile() si tu as besoin du contenu complet d'un fichier de fondation.
Vérifie les noms de champs dans types/index.ts avant de les utiliser.
`;

          const uiOutput = await runAgent(UI_AGENT_PROMPT, uiInput, {
            temperature: 1.4,
            maxTokens: 65536,
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

${designAnchor}

FICHIERS CLÉS DÉJÀ GÉNÉRÉS (types, stores, services) :
${keyFilesSummary.slice(0, 16000)}

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

${errorContext.slice(0, 20000)}

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
              const tscFixOutput = await runAgent(FIXER_PROMPT, tscFixInput, {
                temperature: 0.2,
                maxTokens: 32768,
                emitOutput: true,  // ← VISIBLE : on voit ce que le fixer produit
              });

              const fixedFiles = parseGeneratedFiles(tscFixOutput);
              if (fixedFiles.length > 0) {
                emit(`\n[TSC:FIXER] ✅ ${fixedFiles.length} fichier(s) corrigé(s) : ${fixedFiles.map(f => f.path).join(", ")}\n`);
                mergeGeneratedFiles(fixedFiles);
                extractDeps(tscFixOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
              } else {
                emit(`\n[TSC:FIXER] Aucun fichier émis par le fixer — les erreurs restantes ne peuvent pas être corrigées automatiquement.\n`);
                break; // fixer bloqué, on sort
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
          // PRESENTER OUTRO — résumé fonctionnel final
          // ─────────────────────────────────────────────────────────────
          emit("\n[PRESENTER:OUTRO]\n");

          const builtFeatures = allGeneratedFiles
            .filter((f) => f.path.includes("views/"))
            .map((f) => f.path.split("/").pop()?.replace(".tsx", ""))
            .filter(Boolean)
            .join(", ");

          try {
            await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: [{ role: "user", parts: [{ text: `Demande originale : "${lastUserMsg}"\nVues construites : ${builtFeatures}\nFichiers : ${allGeneratedFiles.length}` }] }],
                config: {
                  systemInstruction: `${basePrompt}\n\n${PRESENTER_OUTRO_PROMPT}`,
                  temperature: 1.6,
                  maxOutputTokens: 512,
                },
              }),
              onChunk,
              { maxAttempts: 3, baseDelay: 8000 }
            );
          } catch {}

          flushBuffer();
          emit("\n[/PRESENTER:OUTRO]\n");
          emit("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Pipeline error:", err);
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
