import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Dependency helpers ───────────────────────────────────────────────────

const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── LE CERVEAU UNIQUE : System Prompt pour l'Efficience Absolue ───────────


// ─── LE CERVEAU UNIQUE : System Prompt pour l'Efficience Absolue ───────────
const FILE_FORMAT = `
RÈGLE DE LANGUE : Réponds toujours dans la langue exacte de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRINCIPE D'EFFICIENCE ABSOLUE (ZÉRO "UI THEATER" & FULL-STACK OBLIGATOIRE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect". Ton but est de construire des FONCTIONNALITÉS RÉELLES ET EXÉCUTABLES de bout en bout (Backend + Frontend).
Il est STRICTEMENT INTERDIT de simuler (mock), stuber, ou utiliser des setTimeout pour imiter des actions asynchrones. TOUT DOIT ÊTRE RÉEL.

RÈGLE ANTI-MOCK DE DONNÉES (TRÈS IMPORTANT) :
- INTERDICTION de hardcoder des tableaux de données (ex: const data = [...]) directement dans les composants UI pour faire "joli".
- Si l'utilisateur demande un Dashboard, un E-commerce ou une app basée sur des données : Tu DOIS créer l'architecture de récupération de données. 
- Tu DOIS implémenter une vraie route API Next.js (ex: app/api/sales/route.ts) ou une vraie Server Action, faire un vrai appel fetch() dans le front-end, et gérer les vrais états de chargement (isLoading) et d'erreur.
- Si tu n'as pas l'API externe (ex: Shopify, Stripe, Base de données), tu crées la VRAIE structure de l'appel API. Tu peux renvoyer des données temporaires depuis LA ROUTE API (backend), mais le composant Front-end, lui, doit croire qu'il parle à un vrai serveur distant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 OBLIGATOIRE : LE PLAN D'EFFICIENCE PROFOND (<efficiency_planning>) - THINKING LEVEL: MAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire ou de modifier le moindre fichier, tu DOIS écrire un bloc de planification exhaustif. Pousse ta réflexion au maximum (Thinking Level: High). Pense BACKEND et FLUX DE DONNÉES avant de penser Interface.

<efficiency_planning>
1. Feature: [Nom]
2. Objectif & Valeur: [Quel est le but réel pour l'utilisateur ?]
3. Risque de Mock (UI Theater): [Comment un dev paresseux simulerait ça ? ex: "Mettre des fausses données dans le composant React"]
4. Architecture Full-Stack & Logique Métier (LE COMMENT) : [DÉTAILLE LE BACKEND. Comment l'application va-t-elle chercher, traiter et stocker la donnée ? Précise les routes API Next.js, les appels fetch, les webhooks, et la structure de la base de données ou de l'API externe ciblée. Anticipe les try/catch et les edge cases.]
5. Dépendances requises: [ex: stripe, @stripe/stripe-js, recharts]
6. Dépendances à supprimer: [si un package n'est plus utilisé]
</efficiency_planning>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POUR CRÉER :
<create_file path="relative/path/to/file.tsx">
[code complet]
</create_file>

POUR ÉDITER (Utilise CECI si le fichier existe déjà) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M]
</changes_to_apply>
</edit_file>

BALISES STRICTEMENT INTERDITES (NE JAMAIS UTILISER SOUS PEINE D'ÉCHEC CRITIQUE) :
❌ <read_file />
❌ <file_changes>
❌ <fileschanges>
❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 OBLIGATOIRE : L'EXPLICATION POST-GÉNÉRATION ("USER-CENTRIC" & HONNÊTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, explique ce que tu as construit.
RÈGLES D'EXPLICATION :
- INTERDICTION de parler de code ou de technique (ZÉRO mention de "useState", "composant", "React").
- Parle de ce que le produit accomplit et de l'architecture réelle (LE COMMENT EN TERMES DE SYSTÈME).
- SOIS HONNÊTE SUR LES CONNEXIONS MANQUANTES : Si la fonctionnalité nécessite une clé API (Stripe, Shopify, OpenAI) ou une base de données, dis-lui EXACTEMENT où la configurer pour que le système prenne vie.

✅ EXEMPLE EXIGÉ : 
"J'ai mis en place l'architecture complète de votre Dashboard e-commerce.
1. **Moteur de données en temps réel** : J'ai créé le circuit complet d'échange de données. L'interface que vous voyez n'est pas statique ; elle interroge continuellement le serveur via la nouvelle route sécurisée '/api/analytics' que j'ai implémentée. 
2. **Visualisation Interactive** : Les graphiques réagissent instantanément aux données reçues du serveur, avec gestion du survol pour voir les détails précis des ventes.
3. **Prochaine étape pour vous** : Actuellement, le serveur renvoie des données de démonstration sécurisées pour que vous puissiez tester l'interface. Pour connecter vos vraies ventes, il vous suffit d'insérer votre clé API Shopify dans le fichier sécurisé de configuration que j'ai préparé, et les vrais chiffres apparaîtront automatiquement."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si de vraies bibliothèques sont nécessaires (stripe, ethers, etc.) ou doivent être supprimées, déclare-les à la TOUTE FIN de ta réponse selon ce format strict :
DEPENDENCIES: ["nom-du-package"]
DEVDEPENDENCIES: ["@types/nom"]
REMOVEDEPENDENCIES: ["ancien-package"]
`;

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch { const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g); return r ? r.map(s => s.replace(/"/g, "")) : []; }
  }
  return [];
}

async function resolveVersion(pkg: string): Promise<string> {
  try { const d = await packageJson(pkg); return `^${d.version}`; }
  catch { return "latest"; }
}

async function buildPackageJson(
  aiOutput: string,
  existing: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  const toAdd = extractDeps(aiOutput, "DEPENDENCIES");
  const toAddDev = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRemove = extractDeps(aiOutput, "REMOVEDEPENDENCIES");

  if (toAdd.length === 0 && toAddDev.length === 0 && toRemove.length === 0) return null;

  const pkgFile = existing.find(f => f.path === "package.json");
  let pkg: any = pkgFile
    ? JSON.parse(pkgFile.content)
    : {
        name: "app", version: "1.0.0", private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "14.2.16", react: "^18", "react-dom": "^18" },
        devDependencies: { 
          typescript: "^5", 
          "@types/node": "^20", 
          "@types/react": "^19",
          tailwindcss: "^3.4.1",
          postcss: "^8",
          autoprefixer: "^10.0.1"
        },
      };

  // Ajout des nouvelles dépendances
  await Promise.all([
    ...toAdd.map(async p => { if (!pkg.dependencies?.[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (!pkg.devDependencies?.[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  // Suppression des dépendances demandées
  toRemove.forEach(p => {
    if (pkg.dependencies && pkg.dependencies[p]) delete pkg.dependencies[p];
    if (pkg.devDependencies && pkg.devDependencies[p]) delete pkg.devDependencies[p];
  });

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

export async function POST(req: Request) {
  try {
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey) return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

    const body = await req.json();
    const { history = [], uploadedImages = [], allReferenceImages = [], currentProjectFiles = [], uploadedFiles = [] } = body;

    let systemPrompt = FILE_FORMAT;

    if (currentProjectFiles && currentProjectFiles.length > 0) {
      const addLineNums = (content: string) => content.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
      const fileList = currentProjectFiles.map((f: { path: string; content: string }) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`).join("\n\n");
      systemPrompt += `\n\nEXISTING PROJECT FILES (with line numbers for edit_file reference):\n${fileList.slice(0, 80000)}`;
    }

    const lastHistory = history[history.length - 1];
    const lastUserText = lastHistory?.role === "user" ? (typeof lastHistory.content === "string" ? lastHistory.content : lastHistory.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "") : "";
    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);

    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const contents: any[] = [];

      for (const msg of history.slice(0, -1)) {
        const role = msg.role === "assistant" ? "model" : "user";
        const text = typeof msg.content === "string" ? msg.content : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) contents.push({ role, parts: [{ text }] });
      }

      const lastParts: any[] = [];
      for (const img of allImages) {
        try {
          const raw = img.includes(",") ? img.split(",")[1] : img;
          if (!raw || raw.length < 100) continue;
          const mime = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
          lastParts.push({ inlineData: { data: raw, mimeType: mime } });
        } catch {}
      }
      
      for (const f of uploadedFiles || []) {
        if (f.base64Content && f.fileName) lastParts.push({ inlineData: { data: f.base64Content, mimeType: "application/pdf" } });
      }

      lastParts.push({ text: lastUserText || "Aide-moi." });
      contents.push({ role: "user", parts: lastParts });

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const emit = (t: string) => controller.enqueue(enc.encode(t));
          try {
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: { systemInstruction: systemPrompt, temperature: 0.7, maxOutputTokens: 65536 },
            });
            let fullOutput = "";
            for await (const chunk of response) {
              const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "")?.join("") ?? "";
              if (text) { emit(text); fullOutput += text; }
            }
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) emit(`\n\n<edit_file path="${pkgResult.path}" action="replace">\n<start_line>1</start_line>\n<end_line>999</end_line>\n<changes_to_apply>\n${pkgResult.content}\n</changes_to_apply>\n</edit_file>`);
          } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
          controller.close();
        },
      });

      return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
    }

    // Anthropic Stream
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const messages: any[] = [];
    
    for (let i = 0; i < history.length - 1; i++) {
      const msg = history[i];
      const role = msg.role === "assistant" ? "assistant" : "user";
      const text = typeof msg.content === "string" ? msg.content : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
      if (text.trim()) messages.push({ role, content: text });
    }

    const lastContent: any[] = [];
    for (const img of allImages) {
      try {
        const raw = img.includes(",") ? img.split(",")[1] : img;
        if (!raw || raw.length < 100) continue;
        const mt = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
        lastContent.push({ type: "image", source: { type: "base64", media_type: mt, data: raw } });
      } catch {}
    }
    lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
    messages.push({ role: "user", content: lastContent });

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));
        try {
          const response = await anthropic.messages.stream({ model: MODEL_ID, max_tokens: 8192, system: systemPrompt, messages });
          let fullOutput = "";
          for await (const chunk of response) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") { emit(chunk.delta.text); fullOutput += chunk.delta.text; }
          }
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) emit(`\n\n<edit_file path="${pkgResult.path}" action="replace">\n<start_line>1</start_line>\n<end_line>999</end_line>\n<changes_to_apply>\n${pkgResult.content}\n</changes_to_apply>\n</edit_file>`);
        } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
        controller.close();
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
      }
