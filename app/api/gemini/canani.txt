import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
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
RÔLE 1 — DÉCISION (toujours en premier)
══════════════════════════════════════════════════════════════════════

Lis le message de l'utilisateur et décide :

▸ CODE_ACTION  — l'utilisateur veut créer ou reconstruire une application
▸ FIX_ACTION   — l'utilisateur signale une erreur, un bug, veut modifier quelque chose de précis
▸ CHAT_ONLY    — l'utilisateur pose une question, discute, demande des conseils

Place LE MOT-CLÉ EXACT sur une ligne seule au tout début de ta réponse, AVANT tout texte.
Exemple valide :
CODE_ACTION
Super, je m'occupe de tout...

══════════════════════════════════════════════════════════════════════
RÔLE 2 — INTRO (si CODE_ACTION)
══════════════════════════════════════════════════════════════════════

Après CODE_ACTION, écris un message d'accueil chaleureux (3-4 phrases MAX).
- Confirme que tu as compris la demande
- Décris en une phrase ce que tu vas construire (côté utilisateur, pas technique)
- Annonce que tu commences

INTERDIT : listes, étapes, phases, agents, Next.js/React/TypeScript, emojis excessifs.
Tu parles en "je", tu ES l'assistant qui fait tout.

══════════════════════════════════════════════════════════════════════
RÔLE 3 — CHAT (si CHAT_ONLY)
══════════════════════════════════════════════════════════════════════

Réponds naturellement, avec expertise, de façon conversationnelle.
Tu peux donner des conseils techniques, expliquer des concepts, suggérer des approches.

══════════════════════════════════════════════════════════════════════
RÔLE 4 — FIX INTRO (si FIX_ACTION)
══════════════════════════════════════════════════════════════════════

Après FIX_ACTION, écris 1-2 phrases : tu as identifié le problème et tu vas le corriger.
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
PROCESSUS DE VÉRIFICATION OBLIGATOIRE avant d'émettre chaque fichier :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pour CHAQUE fichier .tsx avec hooks → vérifie "use client" ligne 1
Pour CHAQUE store Zustand → vérifie virgules dans create(), pas de void; dans l'objet
Pour CHAQUE view → vérifie export function NomView() (named, pas default)
Pour CHAQUE import interne → vérifie @/ pas ../../
Pour CHAQUE .map() → vérifie key={...}
Pour CHAQUE usage de type → vérifie que le nom de champ correspond à l'interface
Pour globals.css → vérifie qu'il n'y a pas de @apply border-border sans tailwind.config.ts correspondant
Pour les route handlers → vérifie export GET/POST nommés

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

"Property X does not exist on type Y" :
  Cas A : pos.quantity mais interface déclare qty
  → Remplace pos.quantity par pos.qty partout dans ce fichier
  
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
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();

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
        const emit = (txt: string) => {
          const sanitized = txt
            .replace(/\bCLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)\s*/gi, "")
            .replace(/\b(CODE_ACTION|FIX_ACTION|CHAT_ONLY)\s*\n?/g, "");
          if (sanitized.trim()) controller.enqueue(encoder.encode(sanitized));
        };

        let buffer = "";
        function onChunk(txt: string) {
          buffer += txt;
          if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
        }
        function flushBuffer() {
          if (buffer.trim()) { emit(buffer); buffer = ""; }
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
          // ÉTAPE 1 — PRESENTER : décision + intro (avec historique chat)
          // ═══════════════════════════════════════════════════════════════

          emit("\n[PRESENTER:INTRO]\n");

          const presenterInput = `
${projectContext}

DEMANDE DE L'UTILISATEUR : "${lastUserMsg}"

DÉCIDE et RÉPONDS selon ton rôle.
Commence ta réponse par le mot-clé de décision sur une ligne seule.
`;

          const presenterSystemPrompt = `${PRESENTER_PROMPT}\n\n${projectContext}`;

          let rawPresenterOutput = "";
          const presenterContents = buildHistoryParts();

          // Ajoute le contexte projet au dernier message
          const lastPart = presenterContents[presenterContents.length - 1];
          if (lastPart && lastPart.role === "user") {
            lastPart.parts.push({ text: `\n\n[CONTEXTE PROJET]\n${projectContext}` });
          }

          try {
            rawPresenterOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: presenterContents,
                config: {
                  systemInstruction: `${basePrompt}\n\n${PRESENTER_PROMPT}`,
                  temperature: 1.6,
                  maxOutputTokens: 1024,
                },
              }),
              onChunk,
              { maxAttempts: 3, baseDelay: 8000 }
            );
          } catch (e: any) {
            rawPresenterOutput = "CODE_ACTION\nJe m'occupe de votre application tout de suite.";
            onChunk(rawPresenterOutput);
          }

          flushBuffer();
          emit("\n[/PRESENTER:INTRO]\n");

          // Détecte la décision
          const decisionMatch = rawPresenterOutput.match(/^(CODE_ACTION|FIX_ACTION|CHAT_ONLY)/m);
          const decision = decisionMatch ? decisionMatch[1] : "CHAT_ONLY";

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

            // Package.json si nouvelles dépendances
            const fixDeps = extractDeps(fixOutput);
            if (fixDeps.length > 0) {
              const existPkg = (currentProjectFiles ?? []).find((f) => f.path === "package.json");
              const existDeps = existPkg ? JSON.parse(existPkg.content).dependencies ?? {} : {};
              const baseDeps: Record<string, string> = { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.475.0", ...existDeps };
              const newDeps: Record<string, string> = {};
              await Promise.all(fixDeps.map(async (pkg) => {
                if (!pkg || baseDeps[pkg]) return;
                try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; } catch { newDeps[pkg] = "latest"; }
              }));
              if (Object.keys(newDeps).length > 0) {
                const existPkgContent = existPkg ? JSON.parse(existPkg.content) : { name: "app", version: "1.0.0", private: true, scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" } };
                existPkgContent.dependencies = { ...baseDeps, ...newDeps };
                emit(`<create_file path="package.json">\n${JSON.stringify(existPkgContent, null, 2)}\n</create_file>`);
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
          // ÉMISSION FINALE DE TOUS LES FICHIERS
          // ─────────────────────────────────────────────────────────────

          // Scan final des imports
          for (const f of allGeneratedFiles) {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".") && pkg !== "next" && pkg !== "react" && pkg !== "react-dom") {
                globalPkgs.add(pkg);
              }
            }
          }

          // Émet tous les fichiers
          for (const f of allGeneratedFiles) {
            emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
          }

          // ─────────────────────────────────────────────────────────────
          // PACKAGE.JSON
          // ─────────────────────────────────────────────────────────────
          const existPkg = (currentProjectFiles ?? []).find((f) => f.path === "package.json");
          const existDeps = existPkg ? (JSON.parse(existPkg.content).dependencies ?? {}) : {};
          const existDev = existPkg ? (JSON.parse(existPkg.content).devDependencies ?? {}) : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.475.0", sharp: "0.33.5",
            clsx: "2.1.1", "tailwind-merge": "2.3.0", zustand: "4.5.2",
            ...existDeps,
          };

          const newDeps: Record<string, string> = {};
          await Promise.all(Array.from(globalPkgs).map(async (pkg) => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));

          const autoTypes = await resolveTypes(Array.from(globalPkgs), existDev);
          const newDevDeps: Record<string, string> = {};
          await Promise.all(Array.from(globalDevPkgs).map(async (pkg) => {
            if (newDevDeps[pkg] || existDev[pkg]) return;
            try { const d = await packageJson(pkg); newDevDeps[pkg] = d.version as string; }
            catch { newDevDeps[pkg] = "latest"; }
          }));

          const finalDev: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
            postcss: "^8", tailwindcss: "^3.4.1", eslint: "^8", "eslint-config-next": "15.0.3",
            ...existDev, ...autoTypes, ...newDevDeps,
          };

          const pkgJson = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: { ...baseDeps, ...newDeps },
            devDependencies: finalDev,
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
