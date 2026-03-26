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
PRINCIPE D'EFFICIENCE ABSOLUE (ZÉRO "UI THEATER")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un ingénieur logiciel de niveau "Staff" / "Principal Architect". Ton but n'est pas de faire des maquettes visuelles (UI), mais des FONCTIONNALITÉS RÉELLES ET EXÉCUTABLES. 
Il est STRICTEMENT INTERDIT de simuler (mock), stuber, ou utiliser des setTimeout pour imiter des actions asynchrones. TOUT DOIT ÊTRE RÉEL.

EXEMPLES DE RÉFLEXION EFFICIENTE EXIGÉE :
- L'utilisateur veut un "player vidéo" ? Tu implémentes une VRAIE balise <video> HTML5 avec ontimeupdate, des contrôles réels, et un scrubbing fonctionnel.
- L'utilisateur veut une "transcription/IA" ? Tu intègres un VRAI appel API LLM. (Modèles Gemini exclusifs à utiliser : gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash, gemini-2.5-pro).
- L'utilisateur veut "exécuter du code Next.js dans l'app" ? Tu intègres l'API E2B (@e2b/code-interpreter) pour un vrai sandbox.
- L'utilisateur veut un "système d'abonnement/paiement" ? Tu intègres Stripe.js + API Route, avec vérification réelle et sauvegarde dans la base de données (ou localStorage par défaut si non spécifié).
- L'utilisateur veut "acheter des cryptos/trader" ? Tu intègres ethers.js, connexion MetaMask ou API Coinbase réelle.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 OBLIGATOIRE : LE PLAN D'EFFICIENCE PROFOND (<efficiency_planning>) - THINKING LEVEL: MAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire ou de modifier le moindre fichier, tu DOIS écrire un bloc de planification exhaustif. Pousse ta réflexion au maximum (Thinking Level: High). Ne te contente pas de la surface, anticipe la gestion des erreurs, le flux de données réel et les cas limites.

<efficiency_planning>
1. Feature: [Nom]
2. Objectif & Valeur: [Quel est le but réel pour l'utilisateur ?]
3. Risque de Mock (UI Theater): [Comment un dev paresseux simulerait ça ? ex: "utiliser un setTimeout de 2s"]
4. Architecture Réelle & Exécution Exhaustive: [Décris précisément et techniquement comment tu vas créé la fonctionnalité, l'implémenter de bout en bout : appels API réels, gestion d'état complète, persistance des données, et surtout la GESTION DES ERREURS (try/catch, edge cases). Mais surtout comment tu vas créé la fonctionnalité de façon integral, réel, efficiente et parfait]
5. Dépendances requises: [ex: stripe, @stripe/stripe-js]
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
ÉTAPE 2 OBLIGATOIRE : L'EXPLICATION POST-GÉNÉRATION ("USER-CENTRIC")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, tu dois expliquer ce que tu as fait à l'utilisateur.
RÈGLE D'OR : INTERDICTION ABSOLUE de parler de code ou de technique (ZÉRO mention de "useState", "useEffect", "API", "composant", "React", "état"). 
Parle UNIQUEMENT de ce que le produit accompli réellement pour lui et de ce qu'il peut faire avec.

✅ EXEMPLE EXIGÉ (Centré utilisateur & Preuve d'efficience) : 
"J'ai créé et intégré votre propre lecteur vidéo de bout en bout. 
1. **Lecteur Vidéo** : Vous pouvez lire votre vidéo, et une timeline connectée à la durée réelle progresse avec celle-ci. Ce player vous affiche même des miniatures des différentes étapes de la vidéo en cours de lecture pour que vous puissiez savoir ce qui se passera dans la suite.
2. **Transcription en temps réel** : J'ai rajouté une fonctionnalité de transcription IA basée sur Gemini. Si vous appuyez sur le bouton 'Traduire' que j'ai créé, l'IA écoute la vidéo et vous donne les sous-titres traduits dans la langue de votre choix, parfaitement synchronisés avec l'image.

Testez-le tout de suite en appuyant sur le bouton Play ou en cliquant sur la barre temporelle !"

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
