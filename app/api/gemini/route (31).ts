import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from 'package-json';

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// --- UTILITAIRES ---
function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDependenciesFromAgentOutput(output: string): string[] {
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch (e) {
      const manualExtract = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      if (manualExtract) return manualExtract.map(s => s.replace(/"/g, ''));
      return [];
    }
  }
  return [];
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// =============================================================================
// ██████╗ ███████╗███████╗██╗███╗   ██╗██╗████████╗██╗ ██████╗ ███╗   ██╗
// ██╔══██╗██╔════╝██╔════╝██║████╗  ██║██║╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║  ██║█████╗  █████╗  ██║██╔██╗ ██║██║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║  ██║██╔══╝  ██╔══╝  ██║██║╚██╗██║██║   ██║   ██║██║   ██║██║╚██╗██║
// ██████╔╝███████╗██║     ██║██║ ╚████║██║   ██║   ██║╚██████╔╝██║ ╚████║
// ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
//  DES 2 AGENTS
// =============================================================================

const AGENTS = {

  // ============================================================
  // AGENT 1 — MASTER BLUEPRINT
  // Rôle : Comprendre le projet dans sa totalité et produire
  // un blueprint technique complet AVANT qu'une seule ligne
  // de code soit écrite. Il résout le problème "sandbox" à la
  // racine en forçant le mapping de chaque fonctionnalité vers
  // un service/package réel. Il classe aussi la demande.
  // ============================================================
  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    icon: "🧠",
    prompt: `
Tu es un Architecte Logiciel Senior avec 20 ans d'expérience. Tu as construit des plateformes
utilisées par des millions d'utilisateurs. Tu connais PARFAITEMENT l'écosystème npm, les APIs
tierces, les SaaS, les SDKs officiels de chaque domaine.

═══════════════════════════════════════════════════════════
MISSION CRITIQUE — CLASSIFICATION & BLUEPRINT RÉEL
═══════════════════════════════════════════════════════════

ÉTAPE 1 — CLASSIFICATION (OBLIGATOIRE, première ligne de ta réponse) :
Détermine la nature de la demande et émets exactement l'un de ces tokens :
  CLASSIFICATION: CHAT_ONLY     → Question/discussion, aucun code nécessaire
  CLASSIFICATION: FIX_ACTION    → Correction de bug sur code existant
  CLASSIFICATION: CODE_ACTION   → Création ou ajout de fonctionnalités

ÉTAPE 2 — BLUEPRINT COMPLET (seulement si CODE_ACTION ou FIX_ACTION)

Pour CHAQUE fonctionnalité identifiée dans la demande, tu DOIS produire une fiche <feature>.
C'est le contrat que le Builder devra respecter à la lettre.

RÈGLE ABSOLUE DU BLUEPRINT :
Chaque fonctionnalité = 1 service/package réel npm.
JAMAIS de simulation. JAMAIS de placeholder. JAMAIS de "on verra plus tard".

Si la fonctionnalité existe dans l'industrie, il existe un package ou une API pour la faire.
Ton rôle est de le trouver et de le spécifier.

FORMAT DE CHAQUE FICHE :

<feature id="F01" name="[Nom de la fonctionnalité]" priority="CORE|HIGH|MEDIUM">
  <what>Description précise de ce que ça fait pour l'utilisateur final</what>
  <real_package>Nom exact du package npm à installer</real_package>
  <real_service>Nom du service tiers si applicable (Stripe, Finnhub, OpenAI, etc.)</real_service>
  <env_vars>STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET</env_vars>
  <real_implementation>
    Description technique précise : quel SDK utiliser, quel endpoint appeler,
    quelle méthode, quel pattern d'intégration (REST/WebSocket/OAuth/Webhook).
    Exemple : "Utiliser alpaca-trade-api avec generateContentStream() pour
    les prix live via WebSocket wss://stream.data.alpaca.markets"
  </real_implementation>
  <forbidden>
    Ce que le Builder NE DOIT PAS faire pour cette feature :
    ex: "Ne pas simuler avec setTimeout ou Math.random"
    ex: "Ne pas hardcoder des prix fictifs dans un array"
    ex: "Ne pas afficher une div grise à la place de la map"
  </forbidden>
  <files_to_create>
    Liste des fichiers qui devront exister pour cette feature.
    ex: lib/stripe.ts, app/api/webhooks/stripe/route.ts, hooks/usePayment.ts
  </files_to_create>
</feature>

═══════════════════════════════════════════════════════════
RÉFÉRENTIEL DE MAPPING — Tu dois connaître et utiliser ces mappings :
═══════════════════════════════════════════════════════════

DOMAINE TRADING / FINANCE :
  Prix temps réel          → finnhub-node (WebSocket live) ou @alpacahq/alpaca-trade-api
  Charts financiers        → lightweight-charts (librairie officielle TradingView, open source)
  Indicateurs techniques   → technicalindicators (RSI, MACD, Bollinger, EMA, SMA, etc.)
  Exécution d'ordres       → @alpacahq/alpaca-trade-api (paper trading gratuit disponible)
  Données historiques      → yahoo-finance2 ou Polygon.io API
  Carnet d'ordres          → @alpacahq/alpaca-trade-api stream WebSocket
  Screener d'actions       → finnhub-node (stock screener endpoint)

DOMAINE MUSIQUE / AUDIO :
  Streaming audio          → howler (lecture), Web Audio API (native)
  Catalogue musical        → Spotify Web API (oauth2, recherche, playlists)
  Waveform visualisation   → wavesurfer.js
  Paiement artistes        → stripe (Connect pour marketplace de paiements)
  Upload audio             → @aws-sdk/client-s3 + presigned URLs
  Recommandations          → Spotify Web API /recommendations endpoint

DOMAINE MAPS / GÉOLOCALISATION :
  Carte interactive        → react-leaflet + OpenStreetMap (100% gratuit) OU @react-google-maps/api
  Geocoding                → node-geocoder ou Google Maps Geocoding API
  Calcul d'itinéraires     → openrouteservice-js (gratuit) ou Google Directions API
  Places / POI             → @googlemaps/google-maps-services-js

DOMAINE IA / LLM :
  Chat IA                  → openai (GPT-4) ou @anthropic-ai/sdk (Claude) avec streaming réel
  Image génération         → openai (DALL-E) ou replicate
  Transcription audio      → openai (Whisper API)
  Embeddings               → openai (text-embedding-ada) + pgvector
  RAG / Recherche          → langchain ou @pinecone-database/pinecone

DOMAINE PAIEMENTS :
  Paiements one-shot       → stripe (PaymentIntent)
  Abonnements              → stripe (Subscriptions + webhooks)
  Marketplace              → stripe (Connect)
  PayPal                   → @paypal/paypal-server-sdk

DOMAINE AUTH :
  Authentification         → next-auth ou @clerk/nextjs
  JWT                      → jose
  OAuth providers          → next-auth (Google, GitHub, Apple, Discord...)

DOMAINE TEMPS RÉEL :
  WebSocket                → socket.io ou pusher-js
  Notifications push       → web-push
  Live updates             → @supabase/supabase-js (Realtime)

DOMAINE CONTRÔLE ORDINATEUR / DESKTOP :
  Contrôle souris/clavier  → @nut-tree/nut-js
  Screenshots              → screenshot-desktop ou @nut-tree/nut-js
  Automation browser       → playwright ou puppeteer
  Lecture écran            → @nut-tree/nut-js (screen reader)
  File system              → fs (native Node.js)
  Processus système        → execa ou child_process (native)

DOMAINE EMAIL / COMMUNICATION :
  Envoi emails             → resend ou nodemailer + smtp
  Templates email          → @react-email/components
  SMS                      → twilio

DOMAINE BASE DE DONNÉES :
  PostgreSQL               → @vercel/postgres ou pg + drizzle-orm
  MongoDB                  → mongoose
  SQLite                   → better-sqlite3
  Redis (cache/sessions)   → ioredis ou @upstash/redis
  ORM                      → drizzle-orm ou prisma

DOMAINE FICHIERS / MÉDIAS :
  Upload                   → @aws-sdk/client-s3 (S3 presigned URLs)
  CDN Images               → next/image (optimisation auto)
  PDF                      → @react-pdf/renderer ou pdf-lib
  Excel                    → xlsx ou exceljs

DOMAINE VIDEO / STREAMING :
  Video player             → react-player ou video.js
  Live streaming           → livekit-client ou daily-js
  Video upload             → @mux/mux-node

═══════════════════════════════════════════════════════════
À LA FIN DE TON BLUEPRINT, tu dois émettre :
═══════════════════════════════════════════════════════════

<env_file_required>
# Liste complète de TOUTES les variables d'environnement nécessaires
# Le Builder créera le .env.example avec ça
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
</env_file_required>

<build_order>
  Ordre dans lequel le Builder doit implémenter les features.
  Les features CORE d'abord, puis HIGH, puis MEDIUM.
  Format : F01, F02, F03, F04...
</build_order>

DEPENDENCIES: ["package1", "package2", "package3"]
    `
  },

  // ============================================================
  // AGENT 2 — FULL STACK BUILDER
  // Rôle : Prendre le Blueprint du Master et générer TOUT le code
  // de l'application. Il est le seul à écrire du code.
  // Il suit le Blueprint comme une loi. Aucune déviation permise.
  // ============================================================
  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    icon: "⚡",
    prompt: `
Tu es un Développeur Full Stack Senior expert Next.js / TypeScript / Tailwind.
Tu reçois un Blueprint signé par le Master Architect. Ce Blueprint est LA LOI.

═══════════════════════════════════════════════════════════
RÈGLES ABSOLUES — VIOLATION = SORTIE INVALIDE
═══════════════════════════════════════════════════════════

RÈGLE 1 — REAL IMPLEMENTATION ONLY
Pour chaque <feature> du Blueprint, tu utilises EXACTEMENT le package et service spécifiés.
Tu n'es pas autorisé à substituer par une simulation, un placeholder ou une approximation.

  ✅ AUTORISÉ  : Appeler l'API Stripe réelle avec stripe.paymentIntents.create()
  ✅ AUTORISÉ  : Connecter le WebSocket Finnhub avec finnhub.ws.connect()
  ✅ AUTORISÉ  : Utiliser openai.chat.completions.create() avec stream: true
  
  ❌ INTERDIT  : setTimeout(() => setData(fakeData), 1000)
  ❌ INTERDIT  : const prices = [100, 102, 98, 105] // données fictives
  ❌ INTERDIT  : <div style={{background:"gray"}}>Map ici</div>
  ❌ INTERDIT  : console.log("Paiement traité") à la place d'un vrai appel Stripe
  ❌ INTERDIT  : Math.random() pour simuler des prix ou des données
  ❌ INTERDIT  : fetch("/api/fake-endpoint")
  ❌ INTERDIT  : const mockUser = { name: "John", balance: 1000 }

RÈGLE 2 — ENV VARS ASSUMED AVAILABLE
Tu assumes que TOUTES les variables d'environnement du Blueprint sont disponibles.
Tu les utilises directement avec process.env.NOM_VAR.
Tu crées un fichier .env.example documenté.
Tu ne codes JAMAIS de valeur par défaut pour des secrets.

RÈGLE 3 — NO HALLUCINATED IMPORTS
Tu n'importes que :
  a) Des fichiers que TU as créé dans cette session (listés dans FILE SYSTEM MANIFEST)
  b) Des packages npm standards ou listés dans le Blueprint
  c) Des composants React natifs (div, button, input...)

RÈGLE 4 — FULL FEATURE COMPLETENESS
Chaque feature du Blueprint doit être entièrement implémentée.
  - Si une feature nécessite un webhook handler → tu le crées
  - Si une feature nécessite un cron job → tu le crées
  - Si une feature nécessite un middleware d'auth → tu le crées
  - Si une feature nécessite une migration DB → tu la crées
  
  Rien ne peut être "à implémenter plus tard".

RÈGLE 5 — ARCHITECTURE PROPRE
Structure obligatoire Next.js App Router :
  app/                    → Pages et layouts
  app/api/               → Route handlers backend
  components/            → Composants réutilisables
  lib/                   → Clients de services (stripe.ts, openai.ts, db.ts...)
  hooks/                 → Hooks React custom
  types/                 → Types TypeScript
  .env.example           → Variables d'environnement documentées

RÈGLE 6 — QUALITÉ DU CODE
  - TypeScript strict partout (pas de any sauf cas extrême justifié)
  - Gestion d'erreurs réelle sur chaque appel API externe (try/catch + codes HTTP)
  - Loading states réels (pas de données qui apparaissent instantanément)
  - Variables d'environnement validées au démarrage dans lib/env.ts
  - Pas de console.log oubliés
  - Toutes les balises JSX fermées

RÈGLE 7 — BLOCKER PROTOCOL
Si et seulement si une feature est TECHNIQUEMENT IMPOSSIBLE sans infrastructure
que tu ne peux pas générer (ex: serveur physique colocalisé en bourse pour HFT),
tu émets :
<blocker feature="F01">
  Raison précise pourquoi cette feature ne peut pas être générée en code seul.
  Alternative proposée : [ce que tu fais à la place qui s'en approche le plus]
</blocker>

Sinon : tu implémentes. Toujours.

═══════════════════════════════════════════════════════════
FORMAT DE SORTIE OBLIGATOIRE
═══════════════════════════════════════════════════════════

<create_file path="lib/env.ts">
// Validation de toutes les env vars au démarrage
...
</create_file>

<create_file path=".env.example">
# Toutes les variables requises documentées
...
</create_file>

<create_file path="lib/stripe.ts">
// Client Stripe initialisé avec la vraie clé
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {...});
...
</create_file>

(Ainsi de suite pour TOUS les fichiers nécessaires)

DEPENDENCIES: ["stripe", "openai", "finnhub-node", "lightweight-charts", ...]
    `
  },

  // ============================================================
  // AGENT FIXER — Conservé de ton architecture originale
  // ============================================================
  FIXER: {
    name: "Bug Fixer",
    icon: "🔧",
    prompt: `
Tu es un expert en débogage. Tu reçois une codebase existante et un rapport de bug.

RÈGLES :
1. Lis ATTENTIVEMENT tous les fichiers fournis avant de modifier quoi que ce soit.
2. Identifie la cause racine du bug (pas juste les symptômes).
3. Ne réécris QUE les fichiers qui doivent être modifiés.
4. Ne casse rien qui fonctionnait avant.
5. Vérifie que tes imports correspondent à des fichiers qui existent réellement.
6. Si tu modifies une interface TypeScript, répercute partout où elle est utilisée.

FORMAT : <create_file path="..."> pour chaque fichier corrigé.
    `
  }
};

// =============================================================================
// API ROUTE
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

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
      uploadedFiles,
      imageAnalysis
    } = body;

    const lastUserMessage = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    let visualConstraints = "";
    if (imageAnalysis) {
      visualConstraints = `
      === 🎨 CHARTE GRAPHIQUE IMPÉRATIVE (NE PAS INVENTER) ===
      L'analyseur pixel a déterminé ces codes exacts. Utilise-les STRICTEMENT dans Tailwind (ex: bg-[#AABBCC]).
      
      - Couleur Principale (Primaire) : ${imageAnalysis.dominantColors?.[0] || "Non défini"}
      - Couleur Secondaire : ${imageAnalysis.dominantColors?.[1] || "Non défini"}
      - Couleur de Fond : ${imageAnalysis.backgroundColor || "white"}
      - Couleur de Texte : ${imageAnalysis.textColor || "black"}
      - Accents : ${imageAnalysis.accentColors?.join(", ") || "Non défini"}
      
      RÈGLE D'OR : Si tu dois appliquer une couleur, vérifie cette liste d'abord.
      `;
    }

    const VIRTUAL_COMPILER_RULES = `
    === 🛡️ PROTOCOLE DE SÉCURITÉ DU CODE (COMPILATEUR VIRTUEL) ===
    Tu agis comme un compilateur TypeScript strict. Avant d'écrire le moindre caractère de code :
    
    1. 🚫 NO HALLUCINATED IMPORTS : N'importe JAMAIS un composant non créé ou non listé dans le FILE SYSTEM MANIFEST.
    2. 🔗 COHÉRENCE DES EXPORTS : Vérifie export named vs export default.
    3. 📦 DEPENDENCIES CHECK : Utilise uniquement les packages listés dans le Blueprint.
    4. 🧹 CLEANUP : Pas de console.log. Pas de TODO. Ferme toutes les balises JSX.
    `;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) {
      currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    }

    const buildFullHistory = (extraContext: string = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[DOCUMENTS DE RÉFÉRENCE]" }] });
      }

      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];

        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          parts.push({ text: "\n[FICHIERS UPLOADÉS]" });
        }
        contents.push({ role, parts });
      });

      if (extraContext) {
        contents.push({
          role: "user",
          parts: [{ text: `\n\n=== 🧠 MÉMOIRE DU PROJET (CONTEXTE PARTAGÉ) ===\n${extraContext}` }]
        });
      }

      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
          let sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");

          sanitized = sanitized
            .replace(/```xml/gi, "")
            .replace(/```tsx/gi, "")
            .replace(/```ts/gi, "")
            .replace(/```html/gi, "")
            .replace(/```css/gi, "");

          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };

        const globalDetectedPackages: Set<string> = new Set();

        async function runAgent(
          agentKey: keyof typeof AGENTS,
          briefing: string = "",
          projectContext: string = ""
        ) {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);

          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            const contents = buildFullHistory(projectContext);

            const fileSystemState = Array.from(createdFilePaths).length > 0
              ? `FILES CURRENTLY EXIST IN PROJECT:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES CREATED YET.";

            contents.push({
              role: "user",
              parts: [{ text: `
              === SITUATION & MISSION (${agent.name}) ===
              ${briefing}
              
              === 📂 FILE SYSTEM MANIFEST ===
              ${fileSystemState}
              
              ${visualConstraints}
              ${VIRTUAL_COMPILER_RULES}
              
              FORMAT DE SORTIE OBLIGATOIRE :
              <create_file path="chemin/fichier.ext">
              ... code ...
              </create_file>
              (PAS DE MARKDOWN, PAS DE \`\`\`)
              ` }]
            });

            const systemInstruction = `=== IDENTITÉ ===\n${agent.prompt}`;

            // Blueprint = rigueur maximale / Builder = précision technique
            const temperature = agentKey === "MASTER_BLUEPRINT" ? 0.2 : 0.3;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction, temperature, maxOutputTokens: 65536 },
            });

            for await (const chunk of response) {
              const txt = chunk.text;
              if (txt) {
                batchBuffer += txt;
                fullAgentOutput += txt;
                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = "";
                }
              }
            }
            if (batchBuffer.length > 0) send(batchBuffer);

            const fileMatches = fullAgentOutput.matchAll(/<create_file path="(.*?)">/g);
            for (const match of fileMatches) {
              if (match[1]) createdFilePaths.add(match[1]);
            }

            const deps = extractDependenciesFromAgentOutput(fullAgentOutput);
            deps.forEach(d => globalDetectedPackages.add(d));

            return fullAgentOutput;

          } catch (e: any) {
            console.error(`Erreur Agent ${agent.name}:`, e);
            send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        try {
          // ══════════════════════════════════════════════
          // PHASE 1 — MASTER BLUEPRINT
          // Produit le blueprint complet avec tous les
          // services réels avant qu'une ligne soit écrite.
          // ══════════════════════════════════════════════
          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse la demande suivante et produis le Blueprint complet.
             Demande : "${lastUserMessage}"`,
            ""
          );

          const match = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          }

          if (decision === "FIX_ACTION") {
            let codeBaseContext = "";
            if (currentProjectFiles) {
              codeBaseContext = currentProjectFiles
                .map((f: any) => `\n--- FICHIER: ${f.path} ---\n${f.content}`)
                .join("\n");
            }

            await runAgent(
              "FIXER",
              `Bug signalé : "${lastUserMessage}"\nNe modifie QUE ce qui est nécessaire.`,
              `${blueprintOutput}\n\n=== CODEBASE ACTUELLE ===\n${codeBaseContext}`
            );

            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ══════════════════════════════════════════════
          // PHASE 2 — FULL STACK BUILDER
          // Reçoit le Blueprint comme loi absolue et génère
          // TOUT le code avec de vraies intégrations.
          // ══════════════════════════════════════════════
          await runAgent(
            "FULL_STACK_BUILDER",
            `Tu reçois le Blueprint signé par le Master Architect.
             Implémente CHAQUE feature listée avec le package/service EXACT spécifié.
             Aucune simulation. Aucun placeholder. Chaque feature = code réel.`,
            `=== 📐 BLUEPRINT OFFICIEL (LOI ABSOLUE) ===\n${blueprintOutput}`
          );

          // ══════════════════════════════════════════════
          // PHASE 3 — PACKAGE.JSON AUTOMATIQUE
          // ══════════════════════════════════════════════
          globalDetectedPackages.add("autoprefixer");

          const existingPkg = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps = existingPkg ? JSON.parse(existingPkg.content).dependencies || {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies || {} : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0",
            react: "19.0.0",
            "react-dom": "19.0.0",
            "lucide-react": "0.561.0",
            ...existingDeps
          };

          const newDeps: Record<string, string> = {};
          let newPackageNeeded = false;

          send("\n\n--- 📦 [DEP CHECK] Résolution des packages réels... ---\n");

          await Promise.all(Array.from(globalDetectedPackages).map(async (pkg) => {
            if (!pkg || baseDeps[pkg] || existingDevDeps[pkg]) return;
            newPackageNeeded = true;
            try {
              const data = await packageJson(pkg);
              newDeps[pkg] = data.version as string;
            } catch {
              newDeps[pkg] = "latest";
            }
          }));

          if (newPackageNeeded || !existingPkg) {
            const packageJsonContent = {
              name: "app",
              version: "1.0.0",
              private: true,
              scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
              dependencies: { ...baseDeps, ...newDeps },
              devDependencies: {
                typescript: "^5",
                "@types/node": "^20",
                "@types/react": "^19",
                "@types/react-dom": "^19",
                postcss: "^8",
                tailwindcss: "^3.4.1",
                eslint: "^8",
                "eslint-config-next": "15.0.3",
                ...existingDevDeps
              },
            };
            send(`<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`);
          }

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
