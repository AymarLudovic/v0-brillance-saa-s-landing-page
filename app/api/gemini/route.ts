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
const FILE_FORMAT = `
RÈGLE DE LANGUE : Réponds toujours dans la langue exacte de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRINCIPE D'EFFICIENCE ABSOLUE (80% LOGIQUE / 20% UI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect". Ton but n'est pas de faire de belles interfaces, mais de construire des MOTEURS FONCTIONNELS PUISSANTS. 
Ton code doit être composé à 80% de logique métier (Hooks complexes, State Machines, API, Data Fetching, Algorithmes internes) et seulement à 20% de JSX (UI).

RÈGLES ANTI-MOCK STRICTES :
1. ZÉRO données hardcodées dans les vues. Tout doit provenir d'un état interne complexe, d'un store (Zustand/Context), ou d'une route API (fetch).
2. ZÉRO actions vides. Chaque clic doit déclencher une vraie logique interne (algorithme de tri, filtre, mutation d'état complexe) ou externe (appel réseau).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 : LA RÉFLEXION ARCHITECTURALE EXHAUSTIVE (<efficiency_planning>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire le moindre code, tu DOIS planifier CHAQUE fonctionnalité individuellement. Pousse ta réflexion au NIVEAU MAXIMUM. Décortique la logique interne complexe et les connexions externes.

<efficiency_planning>

<feature_plan>
1. Feature: [Nom de la fonctionnalité 1 - ex: Moteur de recherche interne]
2. Risque de Mock (UI Theater): [ex: "Faire un simple .filter() sur un tableau hardcodé"]
3. Architecture Réelle & Exécution Exhaustive: [DÉTAILLE LA LOGIQUE PURE. ex: "Création d'un hook useSearch avec debounce, indexation des données en mémoire, gestion des cas 'aucun résultat', et persistance des filtres dans l'URL."]
</feature_plan>

<feature_plan>
1. Feature: [Nom de la fonctionnalité 2 - ex: Dashboard Analytics]
2. Risque de Mock: [ex: "Mettre des fausses données dans Recharts"]
3. Architecture Réelle & Exécution Exhaustive: [DÉTAILLE LE BACKEND ET FRONTEND. Routes API, gestion de l'état asynchrone (loading/error), transformation des données complexes avant rendu.]
</feature_plan>

[... Répéter <feature_plan> pour TOUTES les fonctionnalités majeures ...]

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

BALISES STRICTEMENT INTERDITES :
❌ <read_file />
❌ <file_changes>
❌ <fileschanges>
❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 : L'EXPLICATION POST-GÉNÉRATION ("USER-CENTRIC" & HONNÊTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, explique ce que tu as construit.
- ZÉRO jargon technique (pas de "useState", "React", "Composant").
- Parle UNIQUEMENT des capacités réelles du système.
- Si une clé API externe est requise, indique précisément où la mettre.

✅ EXEMPLE EXIGÉ : 
"J'ai mis en place le moteur complet de votre application.
1. **Moteur de recherche avancé** : J'ai développé un système qui analyse vos requêtes en temps réel. Il inclut un délai intelligent pour ne pas surcharger le système pendant que vous tapez, et sauvegarde vos filtres automatiquement.
2. **Circuit de données** : L'interface est connectée à un véritable circuit serveur. Les données ne sont pas factices. Pour connecter votre propre base, ajoutez simplement vos identifiants dans le fichier de configuration."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si de vraies bibliothèques sont nécessaires ou doivent être supprimées, déclare-les à la TOUTE FIN de ta réponse selon ce format strict :
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

  await Promise.all([
    ...toAdd.map(async p => { if (!pkg.dependencies?.[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (!pkg.devDependencies?.[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

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
            // CORRECTION: Retour au <create_file> robuste pour package.json
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) {
              emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
            }
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
          // CORRECTION: Retour au <create_file> robuste pour package.json
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) {
            emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
          }
        } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
        controller.close();
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
  }import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Dependency helpers ───────────────────────────────────────────────────

const GEMINI_DEFAULT = "gemini-3.1-pro-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── LE CERVEAU UNIQUE : System Prompt pour l'Efficience Absolue ───────────
const FILE_FORMAT = `
RÈGLE DE LANGUE : Réponds toujours dans la langue exacte de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRINCIPE D'EFFICIENCE ABSOLUE (80% LOGIQUE / 20% UI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect". Ton but n'est pas de faire de belles interfaces, mais de construire des MOTEURS FONCTIONNELS PUISSANTS. 
Ton code doit être composé à 80% de logique métier (Hooks complexes, State Machines, API, Data Fetching, Algorithmes internes) et seulement à 20% de JSX (UI).

RÈGLES ANTI-MOCK STRICTES :
1. ZÉRO données hardcodées dans les vues. Tout doit provenir d'un état interne complexe, d'un store (Zustand/Context), ou d'une route API (fetch).
2. ZÉRO actions vides. Chaque clic doit déclencher une vraie logique interne (algorithme de tri, filtre, mutation d'état complexe) ou externe (appel réseau).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 : LA RÉFLEXION ARCHITECTURALE EXHAUSTIVE (<efficiency_planning>)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire le moindre code, tu DOIS planifier CHAQUE fonctionnalité individuellement. Pousse ta réflexion au NIVEAU MAXIMUM. Décortique la logique interne complexe et les connexions externes.

<efficiency_planning>

<feature_plan>
1. Feature: [Nom de la fonctionnalité 1 - ex: Moteur de recherche interne]
2. Risque de Mock (UI Theater): [ex: "Faire un simple .filter() sur un tableau hardcodé"]
3. Architecture Réelle & Exécution Exhaustive: [DÉTAILLE LA LOGIQUE PURE. ex: "Création d'un hook useSearch avec debounce, indexation des données en mémoire, gestion des cas 'aucun résultat', et persistance des filtres dans l'URL."]
</feature_plan>

<feature_plan>
1. Feature: [Nom de la fonctionnalité 2 - ex: Dashboard Analytics]
2. Risque de Mock: [ex: "Mettre des fausses données dans Recharts"]
3. Architecture Réelle & Exécution Exhaustive: [DÉTAILLE LE BACKEND ET FRONTEND. Routes API, gestion de l'état asynchrone (loading/error), transformation des données complexes avant rendu.]
</feature_plan>

[... Répéter <feature_plan> pour TOUTES les fonctionnalités majeures ...]

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

BALISES STRICTEMENT INTERDITES :
❌ <read_file />
❌ <file_changes>
❌ <fileschanges>
❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 : L'EXPLICATION POST-GÉNÉRATION ("USER-CENTRIC" & HONNÊTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, explique ce que tu as construit.
- ZÉRO jargon technique (pas de "useState", "React", "Composant").
- Parle UNIQUEMENT des capacités réelles du système.
- Si une clé API externe est requise, indique précisément où la mettre.

✅ EXEMPLE EXIGÉ : 
"J'ai mis en place le moteur complet de votre application.
1. **Moteur de recherche avancé** : J'ai développé un système qui analyse vos requêtes en temps réel. Il inclut un délai intelligent pour ne pas surcharger le système pendant que vous tapez, et sauvegarde vos filtres automatiquement.
2. **Circuit de données** : L'interface est connectée à un véritable circuit serveur. Les données ne sont pas factices. Pour connecter votre propre base, ajoutez simplement vos identifiants dans le fichier de configuration."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si de vraies bibliothèques sont nécessaires ou doivent être supprimées, déclare-les à la TOUTE FIN de ta réponse selon ce format strict :
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

  await Promise.all([
    ...toAdd.map(async p => { if (!pkg.dependencies?.[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (!pkg.devDependencies?.[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

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
            // CORRECTION: Retour au <create_file> robuste pour package.json
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) {
              emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
            }
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
          // CORRECTION: Retour au <create_file> robuste pour package.json
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) {
            emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
          }
        } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
        controller.close();
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
      }
