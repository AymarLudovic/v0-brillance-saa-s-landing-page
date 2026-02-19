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

interface ImageColorPalette {
  dominantColors: string[];
  backgroundColor: string;
  textColor: string;
  accentColors: string[];
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

// =============================================================================
// SERVER-SIDE COLOR EXTRACTION (Sharp — remplace l'imageAnalysis navigateur)
// Extraction pixel par pixel côté serveur, précise et fiable.
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

async function extractColorsFromBase64(base64Image: string): Promise<ImageColorPalette> {
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

    const sorted = Object.entries(colorCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([color]) => color);

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

// Construit le contexte design complet à partir de toutes les images disponibles
async function buildDesignStylePrompt(
  uploadedImages: string[],
  allReferenceImages: string[]
): Promise<string> {
  const allImages = [...(allReferenceImages ?? []), ...(uploadedImages ?? [])];
  if (allImages.length === 0) {
    return `
=== 🎨 DESIGN (MODE CRÉATIF LIBRE) ===
Aucune image de référence. Choisis un style distinctif, mémorable et cohérent avec
le projet. Évite le générique (pas d'Inter/Arial, pas de purple-gradient banal).
Varie entre dark/light, typographies caractérielles, effets visuels élaborés.
`;
  }

  const palettes = await Promise.all(allImages.slice(0, 3).map(extractColorsFromBase64));
  const merged = palettes[0];

  // On récupère les couleurs supplémentaires des autres images
  const allAccents = palettes
    .flatMap((p) => [...p.dominantColors, ...p.accentColors])
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 6);

  return `
=== 🎨 SYSTÈME DE DESIGN (EXTRACTION PIXEL SERVEUR — AUTORITÉ ABSOLUE) ===
Ces codes hexadécimaux ont été extraits pixel par pixel des images de référence.
Tu les utilises OBLIGATOIREMENT via Tailwind arbitrary values.

PALETTE EXACTE :
  • Fond principal      : ${merged.backgroundColor}  → bg-[${merged.backgroundColor}]
  • Texte principal     : ${merged.textColor}         → text-[${merged.textColor}]
  • Couleur primaire    : ${merged.dominantColors[0] ?? "à dériver de l'image"}
  • Couleur secondaire  : ${merged.dominantColors[1] ?? "à dériver de l'image"}
  • Accents disponibles : ${allAccents.join(", ")}

ANALYSE DE STYLE (tu décris cela comme TON choix créatif — ne jamais révéler les images) :
Tu as mémorisé le style des images. Dans le code que tu génères, tu transposes :
  1. La STRUCTURE de composition (grilles, espacements, hiérarchie visuelle)
  2. Les EFFETS de surface (glassmorphism, gradients, ombres, textures, borders)
  3. La TYPOGRAPHIE (style serif/sans, poids, contrastes de taille)
  4. Les MICRO-INTERACTIONS (hover states, transitions, animations d'entrée)
  5. La DENSITÉ et le rythme visuel (compact dashboard vs spacieux landing)

RÈGLE : Ces images ne sont pas mentionnées à l'utilisateur. Tu présentes ce style
        comme étant ta vision créative pour son projet.
`;
}

// =============================================================================
// AUTO @TYPES RESOLVER — Élimine les erreurs "Could not find declaration file"
// =============================================================================

// Packages avec types intégrés — pas besoin de @types/
const BUNDLED_TYPES = new Set([
  "next","react","react-dom","typescript","sharp",
  "stripe","openai","@anthropic-ai/sdk","@google/genai",
  "next-auth","@clerk/nextjs","drizzle-orm","prisma",
  "ioredis","@upstash/redis","@vercel/postgres",
  "zod","zustand","swr","@tanstack/react-query","@tanstack/react-table",
  "lucide-react","framer-motion","motion","tailwindcss",
  "resend","axios","socket.io","socket.io-client",
  "livekit-client","@livekit/components-react",
  "lightweight-charts","recharts","chart.js","react-chartjs-2","d3",
  "wavesurfer.js","tone","react-player","react-hook-form",
  "@aws-sdk/client-s3","@aws-sdk/lib-storage",
  "pusher","pusher-js","twilio",
  "replicate","langchain","@pinecone-database/pinecone",
  "mux-node","@mux/mux-node",
  "react-leaflet","@vis.gl/react-google-maps",
  "@googlemaps/google-maps-services-js",
  "finnhub","finnhub-node","yahoo-finance2",
  "@alpacahq/alpaca-trade-api",
  "playwright","date-fns","dayjs","luxon",
  "@react-pdf/renderer","pdf-lib","exceljs",
  "@react-email/components","react-email",
  "jose","bcryptjs","@paralleldrive/cuid2",
]);

// Mapping explicite package → @types correspondant
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
};

async function resolveTypesPackages(
  packages: string[],
  existingDevDeps: Record<string, string>
): Promise<Record<string, string>> {
  const typesNeeded: Record<string, string> = {};

  await Promise.all(
    packages.map(async (pkg) => {
      if (!pkg || BUNDLED_TYPES.has(pkg)) return;

      // Check explicit map
      if (TYPES_MAP[pkg]) {
        const tp = TYPES_MAP[pkg];
        if (!existingDevDeps[tp]) {
          try {
            const d = await packageJson(tp);
            typesNeeded[tp] = d.version as string;
          } catch {
            typesNeeded[tp] = "latest";
          }
        }
        return;
      }

      // Try @types/packagename automatiquement pour les packages inconnus
      const cleanPkg = pkg.startsWith("@") ? pkg.split("/")[1] : pkg;
      const tp = `@types/${cleanPkg}`;
      if (!existingDevDeps[tp]) {
        try {
          const d = await packageJson(tp);
          typesNeeded[tp] = d.version as string;
        } catch {
          // Pas de @types disponible — le package a probablement ses propres types
        }
      }
    })
  );

  return typesNeeded;
}

// =============================================================================
// XML BLUEPRINT FILTER — Filtre les artefacts techniques du flux client
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
  // Analyse la demande, mappe chaque feature sur un service/package réel,
  // analyse les images de design, produit le contrat technique complet.
  // Son output XML n'est JAMAIS affiché brut à l'utilisateur.
  // ─────────────────────────────────────────────────────────────────────────
  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    icon: "🧠",
    prompt: `
Tu es un Architecte Logiciel Senior avec 20 ans d'expérience.
Tu n'écris pas de code. Tu produis le Blueprint technique qui sera la loi pour le Builder.

═══════════════════════════════════════════════════════════
ÉTAPE 1 — CLASSIFICATION (obligatoire, toute première ligne)
═══════════════════════════════════════════════════════════
  CLASSIFICATION: CHAT_ONLY    → question, discussion, aucun code
  CLASSIFICATION: FIX_ACTION   → correction de bug sur projet existant
  CLASSIFICATION: CODE_ACTION  → création ou ajout de fonctionnalités

═══════════════════════════════════════════════════════════
ÉTAPE 2 — FEATURE BLUEPRINT (si CODE_ACTION ou FIX_ACTION)
═══════════════════════════════════════════════════════════

Pour CHAQUE fonctionnalité de la demande, une fiche <feature> complète :

<feature id="F01" name="[nom]" priority="CORE|HIGH|MEDIUM">
  <what>Ce que l'utilisateur obtient concrètement (1 phrase claire)</what>
  <real_package>package npm exact à installer</real_package>
  <real_service>Stripe / Finnhub / OpenAI / Alpaca / etc. si applicable</real_service>
  <env_vars>NOM_VAR_1, NOM_VAR_2</env_vars>
  <real_implementation>
    Méthode exacte d'implémentation :
    - Quel SDK ou classe utiliser
    - Quel endpoint ou méthode appeler
    - Quel pattern : REST / WebSocket / OAuth / Webhook / SSE
    Exemple précis : "stripe.paymentIntents.create({amount, currency:'eur'})"
    Exemple précis : "new Howl({src:[url], html5:true, onend:handleNext})"
    Exemple précis : "openai.chat.completions.create({model,messages,stream:true})"
  </real_implementation>
  <forbidden>
    Ce que le Builder ne doit PAS faire — explicite et détaillé :
    "Ne pas simuler avec setTimeout ou Math.random"
    "Ne pas hardcoder des données dans un array statique"
    "Ne pas remplacer la map par une div grise"
  </forbidden>
  <typescript_requirements>
    Types supplémentaires nécessaires (crucial pour éviter les build errors) :
    Ex: "howler n'embarque pas ses types → @types/howler en devDependency obligatoire"
    Ex: "leaflet → @types/leaflet en devDependency"
    Ex: "Utiliser le type Session depuis 'next-auth', jamais le redéclarer"
  </typescript_requirements>
  <architecture_patterns>
    Patterns obligatoires pour éviter les erreurs classiques :
    Ex: "NextAuth : authOptions dans lib/auth.ts UNIQUEMENT, jamais dans route.ts"
    Ex: "Stripe webhook : raw body via stripe.webhooks.constructEvent"
    Ex: "Toutes les env vars validées dans lib/env.ts au démarrage"
    Ex: "Route handlers Next.js : export named GET/POST, jamais export default"
  </architecture_patterns>
  <files_to_create>lib/stripe.ts, app/api/checkout/route.ts, hooks/useCheckout.ts</files_to_create>
</feature>

═══════════════════════════════════════════════════════════
RÉFÉRENTIEL SERVICES RÉELS (connais-les parfaitement)
═══════════════════════════════════════════════════════════

TRADING & FINANCE :
  Charts temps réel       → lightweight-charts (TradingView open source)
  Prix live WebSocket     → finnhub-node → wss://ws.finnhub.io
  Indicateurs techniques  → technicalindicators (RSI, MACD, BB, EMA, SMA...)
  Exécution d'ordres      → @alpacahq/alpaca-trade-api (paper trading gratuit)
  Historique de prix      → yahoo-finance2 ou finnhub REST API

MUSIQUE / AUDIO :
  Playback audio          → howler (Howl class) [nécessite @types/howler]
  Visualisation waveform  → wavesurfer.js
  Catalogue Spotify       → spotify-web-api-node [nécessite @types/spotify-web-api-node]
  Paiements artistes      → stripe Connect (marketplace model)

MAPS & GÉOLOCALISATION :
  Carte gratuite          → react-leaflet + leaflet [nécessite @types/leaflet]
  Carte premium           → @vis.gl/react-google-maps
  Geocoding               → node-geocoder [nécessite @types/node-geocoder]

IA & LLM :
  Chat avec streaming     → openai (stream:true) ou @anthropic-ai/sdk (stream)
  Génération d'images     → openai (DALL-E) ou replicate
  Transcription audio     → openai (Whisper API)
  Embeddings & RAG        → openai + @pinecone-database/pinecone

PAIEMENTS :
  Paiement one-shot       → stripe paymentIntents
  Abonnements             → stripe subscriptions + webhooks
  Marketplace             → stripe Connect
  PayPal                  → @paypal/paypal-server-sdk

AUTHENTIFICATION :
  OAuth complet           → next-auth [authOptions TOUJOURS dans lib/auth.ts]
  Auth simple             → @clerk/nextjs
  JWT custom              → jose (jamais jsonwebtoken côté serveur Next.js)

TEMPS RÉEL :
  WebSocket bidirectionnel → socket.io + socket.io-client
  Live simple             → pusher + pusher-js
  DB temps réel           → @supabase/supabase-js Realtime

CONTRÔLE ORDINATEUR :
  Souris & clavier        → @nut-tree/nut-js
  Screenshots             → screenshot-desktop
  Automation navigateur   → playwright
  Fichiers système        → fs (Node.js natif, aucun package)

EMAILS :
  Envoi transactionnel    → resend
  Templates React         → @react-email/components

BASE DE DONNÉES :
  PostgreSQL (serverless) → drizzle-orm + @vercel/postgres
  ORM complet             → prisma
  MongoDB                 → mongoose
  SQLite                  → better-sqlite3 [nécessite @types/better-sqlite3]
  Cache/Sessions          → ioredis ou @upstash/redis

FICHIERS & MÉDIAS :
  Upload S3               → @aws-sdk/client-s3 + presigned URLs
  PDF                     → @react-pdf/renderer
  Excel                   → exceljs

═══════════════════════════════════════════════════════════
ÉTAPE 3 — VARIABLES D'ENVIRONNEMENT
═══════════════════════════════════════════════════════════

<env_file_required>
# .env.local — Copier et remplir avec vos clés réelles
DATABASE_URL=postgresql://user:password@host:5432/dbname
NEXTAUTH_SECRET=générer avec: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
</env_file_required>

<build_order>F01, F02, F03, ...</build_order>

DEPENDENCIES: ["package1", "package2"]
DEVDEPENDENCIES: ["@types/package1"]
    `,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT 2 — FULL STACK BUILDER
  // Reçoit le Blueprint + contexte design. Génère TOUT le code.
  // Aucune simulation. Zéro erreur TypeScript tolérée.
  // ─────────────────────────────────────────────────────────────────────────
  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    icon: "⚡",
    prompt: `
Tu es un Développeur Full Stack Senior spécialisé Next.js 15 App Router, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint (contrat technique) et un contexte design (palette extraite des images).
Ces deux éléments sont des LOIS ABSOLUES.

════════════════════════════════════════════════════════════════════
LOI 1 — REAL IMPLEMENTATION ONLY (aucune simulation jamais)
════════════════════════════════════════════════════════════════════

✅ IMPLÉMENTATION RÉELLE :
   stripe.paymentIntents.create({ amount: price * 100, currency: "eur" })
   new Howl({ src: [track.preview_url], html5: true, onend: playNext })
   openai.chat.completions.create({ model, messages, stream: true })
   L.map("map-container").setView([lat, lng], 13).addLayer(L.tileLayer(...))
   finnhubClient.connectTo("wss://ws.finnhub.io?token=...", onMessage)

❌ ABSOLUMENT INTERDIT :
   setTimeout(() => setData([...fakeItems]), 800)           // simulation réseau
   Math.random() * 100                                      // prix fictifs
   const mockSongs = [{ title: "Song", artist: "Artist" }] // données hardcodées
   <div className="bg-gray-300 h-64">Map ici</div>          // placeholder visuel
   console.log("Paiement traité")                           // simulation action
   fetch("/api/fake") ou return { ok: true }                // mock réponse

════════════════════════════════════════════════════════════════════
LOI 2 — ZÉRO ERREUR TYPESCRIPT (protocole de build propre)
════════════════════════════════════════════════════════════════════

RÈGLE 2.1 — lib/env.ts TOUJOURS EN PREMIER FICHIER CRÉÉ :
\`\`\`typescript
// lib/env.ts — Validation centralisée de toutes les variables d'environnement
const requireEnv = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(\`Variable d'environnement manquante: \${key}\`);
  return val;
};
export const env = {
  databaseUrl: requireEnv("DATABASE_URL"),
  stripeSecretKey: requireEnv("STRIPE_SECRET_KEY"),
  // Ajoute toutes les vars du projet ici
} as const;
\`\`\`
Importe TOUJOURS depuis \`@/lib/env\` — jamais process.env directement dans les fichiers.

RÈGLE 2.2 — NEXTAUTH PATTERN OBLIGATOIRE (évite l'erreur handler/circular import) :
\`\`\`typescript
// lib/auth.ts — authOptions ICI et UNIQUEMENT ICI
import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
export const authOptions: NextAuthOptions = { providers: [...], ... };

// app/api/auth/[...nextauth]/route.ts — SEULEMENT ces 3 lignes
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
\`\`\`

RÈGLE 2.3 — @TYPES OBLIGATOIRES (évite "Could not find declaration file") :
Ajoute TOUJOURS dans DEVDEPENDENCIES à la fin de ta sortie :
   howler                  → @types/howler
   leaflet                 → @types/leaflet
   bcrypt                  → @types/bcrypt
   pg                      → @types/pg
   nodemailer              → @types/nodemailer
   uuid                    → @types/uuid
   multer                  → @types/multer
   express                 → @types/express
   cors                    → @types/cors
   jsonwebtoken            → @types/jsonwebtoken
   spotify-web-api-node    → @types/spotify-web-api-node
   better-sqlite3          → @types/better-sqlite3
   node-geocoder           → @types/node-geocoder
   Si doute sur un package → vérifie dans typescript_requirements du Blueprint

RÈGLE 2.4 — IMPORTS UNIQUEMENT DEPUIS FILE SYSTEM MANIFEST :
   Si tu as besoin d'un fichier → crée-le d'abord, importe-le ensuite.
   Ne jamais importer depuis un path inexistant dans le manifest.

RÈGLE 2.5 — COHÉRENCE EXPORTS/IMPORTS :
   export const foo  → import { foo } from "..."    ✅
   export default foo → import foo from "..."        ✅
   export const foo  → import foo from "..."         ❌ INTERDIT
   Ne mélange jamais named et default pour le même symbol.

RÈGLE 2.6 — ROUTE HANDLERS NEXT.JS 15 :
   export async function GET(req: Request) { ... }    ✅
   export async function POST(req: Request) { ... }   ✅
   export default async function handler() { ... }    ❌ INTERDIT

RÈGLE 2.7 — TYPES EXPLICITES, PAS DE \`any\` :
   Déclare les interfaces dans types/ ou inline.
   Pour les réponses API externes, type le retour attendu.
   \`as any\` seulement si justification commentée inline.

RÈGLE 2.8 — GESTION D'ERREURS RÉELLE :
   Chaque appel API externe dans try/catch.
   Route handlers : return NextResponse.json({ error }, { status: 400|401|500 })
   Gère : 401 (auth), 429 (rate limit), 500 (erreur serveur).

RÈGLE 2.9 — CLEANUP ABSOLU :
   Zéro console.log de debug.
   Zéro commentaire "TODO" ou "à implémenter".
   Toutes les balises JSX fermées.
   Tous les useEffect avec tableau de dépendances complet.
   Tous les Promise/async/await avec gestion d'erreur.

════════════════════════════════════════════════════════════════════
LOI 3 — DESIGN (palette extraite + style visuel)
════════════════════════════════════════════════════════════════════

Le DESIGN CONTEXT injecté dans ton contexte contient la palette extraite côté serveur.
Tu l'appliques via Tailwind arbitrary values : bg-[#HEX], text-[#HEX], border-[#HEX].

Règles de design systématiques :
  • Typographie — jamais Arial/Inter par défaut. Utilise next/font avec :
    Geist Mono, DM Sans, Syne, Outfit, Cabinet Grotesk, Clash Display selon l'ambiance.
  • Effets de surface : glassmorphism (bg-white/10 backdrop-blur-xl border border-white/20),
    gradients (bg-gradient-to-br from-[#c1] to-[#c2]), ombres colorées (shadow-[#color]/20)
  • Micro-interactions : transition-all duration-200 ease-out, hover:scale-[1.02],
    hover:shadow-lg sur les éléments interactifs
  • Layouts élaborés : asymétrie, chevauchements, grilles 12 colonnes, sections alternées
  • États complets : loading skeletons, états vides (empty states), états d'erreur stylisés
  • Dark/light cohérent basé sur la palette extraite

════════════════════════════════════════════════════════════════════
LOI 4 — STRUCTURE NEXT.JS 15 OBLIGATOIRE
════════════════════════════════════════════════════════════════════

  lib/env.ts              ← TOUJOURS premier fichier créé
  lib/auth.ts             ← authOptions NextAuth exclusivement
  lib/[service].ts        ← clients initialisés (stripe, openai, db, finnhub...)
  app/api/[route]/route.ts ← handlers avec exports named GET/POST
  app/(routes)/[page]/page.tsx ← pages
  hooks/use[Feature].ts   ← logique métier client
  components/[Name].tsx   ← composants réutilisables
  types/index.ts          ← types TypeScript globaux
  .env.example            ← documentation des variables

════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
════════════════════════════════════════════════════════════════════

<create_file path="lib/env.ts">
... code complet ...
</create_file>

<create_file path="lib/stripe.ts">
... code complet ...
</create_file>

(Tous les fichiers dans l'ordre logique, du plus fondamental au plus applicatif)

DEPENDENCIES: ["stripe", "howler", "lightweight-charts", ...]
DEVDEPENDENCIES: ["@types/howler", "@types/leaflet", ...]
    `,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT FIXER — Correction de bugs ciblée et chirurgicale
  // ─────────────────────────────────────────────────────────────────────────
  FIXER: {
    name: "Bug Fixer",
    icon: "🔧",
    prompt: `
Tu es un expert en débogage Next.js / TypeScript.
Tu reçois une codebase complète et un rapport de bug précis.

PROTOCOLE CHIRURGICAL :
1. Lis TOUS les fichiers fournis avant de toucher quoi que ce soit.
2. Identifie la CAUSE RACINE (jamais le symptôme).
3. Modifie SEULEMENT les fichiers impactés.
4. Si tu changes une interface TypeScript → répercute dans TOUS les fichiers qui l'utilisent.
5. Applique toutes les règles TypeScript (Lois 2.1 à 2.9 du Builder).

ERREURS CLASSIQUES ET LEURS SOLUTIONS :
  "Could not find declaration file for 'howler'"
    → Ajouter @types/howler dans DEVDEPENDENCIES

  "'handler' is not exported from '@/app/api/auth/[...nextauth]/route'"
    → Déplacer authOptions dans lib/auth.ts
    → Route handler = seulement "const handler = NextAuth(authOptions); export { handler as GET, handler as POST }"

  "export 'X' was not found" ou mismatch default/named
    → Corriger l'export dans le fichier source ET l'import dans tous les fichiers qui l'utilisent

  "process.env.X is undefined"
    → Créer/mettre à jour lib/env.ts avec requireEnv("X")

  "Type 'any' is not assignable"
    → Déclarer l'interface TypeScript correcte

FORMAT : <create_file path="...">...</create_file> pour chaque fichier modifié.
DEPENDENCIES: ["nouveau-package"] si nouveaux packages nécessaires
DEVDEPENDENCIES: ["@types/X"] si types manquants
    `,
  },
};

// =============================================================================
// API ROUTE HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string, filterXml?: boolean) => void = () => {};

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
      uploadedFiles,
    } = body;

    const lastUserMessage =
      history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    // ── Extraction couleurs serveur + contexte design ──────────────────────
    const designStylePrompt = await buildDesignStylePrompt(
      uploadedImages ?? [],
      allReferenceImages ?? []
    );

    // ── Règles compilateur virtuel (injectées dans chaque agent) ───────────
    const VIRTUAL_COMPILER_RULES = `
=== 🛡️ COMPILATEUR VIRTUEL TypeScript (auto-vérification obligatoire) ===
Avant d'écrire la moindre ligne, vérifie mentalement :
  ✓ Chaque import → fichier dans FILE SYSTEM MANIFEST ou package npm listé
  ✓ Exports cohérents : named↔named, default↔default (jamais mixé)
  ✓ Chaque appel API externe → try/catch avec gestion erreur réelle
  ✓ Zéro console.log debug, zéro TODO, toutes balises JSX fermées
  ✓ Env vars → toujours via lib/env.ts, jamais process.env directement
  ✓ NextAuth → authOptions dans lib/auth.ts, handler = 3 lignes dans route.ts
  ✓ Route handlers → export named GET/POST uniquement, jamais export default
  ✓ @types requis : howler→@types/howler, leaflet→@types/leaflet, pg→@types/pg, etc.
  ✓ useEffect → tableau de dépendances complet obligatoire
`;

    // ── Suivi du système de fichiers (manifeste) ───────────────────────────
    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) {
      currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    }

    // ── Construction de l'historique de conversation ───────────────────────
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
            parts.push({
              inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
            })
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

    // ══════════════════════════════════════════════════════════════════════
    // STREAM
    // ══════════════════════════════════════════════════════════════════════
    const stream = new ReadableStream({
      async start(controller) {
        // send() nettoie automatiquement les artefacts techniques
        send = (txt: string, filterXml = false) => {
          let out = txt
            .replace(/```xml/gi, "").replace(/```tsx/gi, "").replace(/```ts/gi, "")
            .replace(/```html/gi, "").replace(/```css/gi, "").replace(/```json/gi, "")
            .replace(/```/g, "");

          if (filterXml) out = filterBlueprintXml(out);

          if (out.trim()) controller.enqueue(encoder.encode(out));
        };

        const globalPackages: Set<string> = new Set();
        const globalDevPackages: Set<string> = new Set();

        // ── runAgent ───────────────────────────────────────────────────────
        async function runAgent(
          agentKey: keyof typeof AGENTS,
          briefing: string,
          projectContext: string,
          options: { silent?: boolean; filterXml?: boolean } = {}
        ) {
          const { silent = false, filterXml = false } = options;
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
(JAMAIS de markdown, JAMAIS de backticks)
                `,
              }],
            });

            const temperature =
              agentKey === "MASTER_BLUEPRINT" ? 0.15
              : agentKey === "FIXER" ? 0.2
              : 0.25;

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

            // Mise à jour du manifeste
            for (const m of fullOutput.matchAll(/<create_file path="(.*?)">/g)) {
              if (m[1]) createdFilePaths.add(m[1]);
            }

            // Capture des packages
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

        // ══════════════════════════════════════════════════════════════════
        // ORCHESTRATION PRINCIPALE
        // ══════════════════════════════════════════════════════════════════
        try {
          // ── PHASE 1 : MASTER BLUEPRINT (silencieux) ──────────────────────
          send(`\n\n--- 🧠 [Analyse et cartographie du projet...] ---\n\n`);

          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse cette demande et produis le Blueprint technique complet.
             Demande utilisateur : "${lastUserMessage}"`,
            "",
            { silent: true } // XML jamais streamé au client
          );

          const classMatch = blueprintOutput.match(
            /CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i
          );
          const decision = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          // ── CHAT ONLY ────────────────────────────────────────────────────
          if (decision === "CHAT_ONLY") {
            send(filterBlueprintXml(blueprintOutput));
            controller.close();
            return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g) ?? []).length;
          send(
            `✅ ${featureCount} fonctionnalité${featureCount > 1 ? "s" : ""} analysée${featureCount > 1 ? "s" : ""} — services réels mappés.\n`
          );

          // ── FIX ACTION ────────────────────────────────────────────────────
          if (decision === "FIX_ACTION") {
            const codeContext = currentProjectFiles
              ? currentProjectFiles.map((f: any) => `\n--- ${f.path} ---\n${f.content}`).join("\n")
              : "";

            await runAgent(
              "FIXER",
              `Bug signalé : "${lastUserMessage}"\nCorrige selon le Blueprint ci-dessous.`,
              `${blueprintOutput}\n\n=== CODEBASE ACTUELLE ===\n${codeContext}`
            );

            const autoTypes = await resolveTypesPackages(
              Array.from(globalPackages),
              {}
            );
            Object.keys(autoTypes).forEach((t) => globalDevPackages.add(t));

            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ── CODE ACTION : FULL STACK BUILDER ─────────────────────────────
          await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint reçu. Implémente CHAQUE feature avec le package/service EXACT spécifié.
             PREMIER FICHIER OBLIGATOIRE : lib/env.ts
             Aucune simulation. Aucun placeholder. Code production-ready.`,
            `=== 📐 BLUEPRINT OFFICIEL (LOI ABSOLUE) ===\n${blueprintOutput}`
          );

          // ── PHASE 3 : RÉSOLUTION AUTOMATIQUE DES PACKAGES ────────────────
          globalPackages.add("autoprefixer");
          globalPackages.add("sharp"); // toujours inclus pour le server-side image processing

          const existingPkg = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps = existingPkg
            ? JSON.parse(existingPkg.content).dependencies ?? {}
            : {};
          const existingDevDeps = existingPkg
            ? JSON.parse(existingPkg.content).devDependencies ?? {}
            : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0",
            react: "19.0.0",
            "react-dom": "19.0.0",
            "lucide-react": "0.561.0",
            sharp: "0.33.5",
            ...existingDeps,
          };

          send("\n\n--- 📦 [Résolution des packages réels + types TypeScript...] ---\n");

          // Résolution versions runtime
          const newDeps: Record<string, string> = {};
          await Promise.all(
            Array.from(globalPackages).map(async (pkg) => {
              if (!pkg || baseDeps[pkg]) return;
              try {
                const d = await packageJson(pkg);
                newDeps[pkg] = d.version as string;
              } catch {
                newDeps[pkg] = "latest";
              }
            })
          );

          // Auto-résolution @types pour chaque package runtime
          const autoTypesDeps = await resolveTypesPackages(
            Array.from(globalPackages),
            existingDevDeps
          );

          // Résolution versions pour les @types manuels déclarés par le Builder
          const allDevTypes = { ...autoTypesDeps };
          await Promise.all(
            Array.from(globalDevPackages).map(async (pkg) => {
              if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
              try {
                const d = await packageJson(pkg);
                allDevTypes[pkg] = d.version as string;
              } catch {
                allDevTypes[pkg] = "latest";
              }
            })
          );

          const finalDevDeps: Record<string, string> = {
            typescript: "^5",
            "@types/node": "^20",
            "@types/react": "^19",
            "@types/react-dom": "^19",
            postcss: "^8",
            tailwindcss: "^3.4.1",
            eslint: "^8",
            "eslint-config-next": "15.0.3",
            ...existingDevDeps,
            ...allDevTypes,
          };

          const pkgJson = {
            name: "app",
            version: "1.0.0",
            private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: { ...baseDeps, ...newDeps },
            devDependencies: finalDevDeps,
          };

          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);

          const runtimeCount = Object.keys(newDeps).length;
          const typesCount = Object.keys(allDevTypes).length;
          send(`\n✅ ${runtimeCount} package(s) runtime + ${typesCount} @types résolu(s) automatiquement.\n`);

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
