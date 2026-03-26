import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

export const maxDuration = 250;
export const dynamic = "force-dynamic";

const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── Dependency helpers ───────────────────────────────────────────────────
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
  const toRemove = new Set(extractDeps(aiOutput, "REMOVE_DEPENDENCIES"));

  if (toAdd.length === 0 && toAddDev.length === 0 && toRemove.size === 0) return null;

  const pkgFile = existing.find(f => f.path === "package.json");
  let pkg: any = pkgFile
    ? JSON.parse(pkgFile.content)
    : {
        name: "app", version: "1.0.0", private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
        dependencies: {
          next: "14.2.16", react: "^18", "react-dom": "^18",
          "clsx": "latest", "tailwind-merge": "latest", "zustand": "latest",
        },
        devDependencies: {
          typescript: "^5", "@types/node": "^20", "@types/react": "^19",
          "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1",
          autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3",
        },
      };

  // Remove flagged packages
  for (const r of toRemove) {
    delete pkg.dependencies?.[r];
    delete pkg.devDependencies?.[r];
  }

  // Add new packages with resolved versions
  await Promise.all([
    ...toAdd.map(async p => { if (!pkg.dependencies?.[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (!pkg.devDependencies?.[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// ─── Intent detection ─────────────────────────────────────────────────────
function isBuildRequest(text: string): boolean {
  if (!text || text.trim().length < 3) return false;
  const lower = text.toLowerCase().trim();
  const chatOnly = /^(bonjour|hello|salut|hi|hey|merci|thanks|thank you|ok|okay|oui|non|yes|no|super|parfait|cool|génial|bien|bonne journée|au revoir|bye|ça va|comment ça|c'est quoi|pourquoi|comment fonctionne|explique|dis moi)/i;
  if (chatOnly.test(lower) && text.length < 120) return false;
  const buildWords = /(build|create|make|add|fix|crée|construis|ajoute|corrige|génère|développe|implement|modifie|change|update|mets|fais|réalise|intègre|rajoute|refait|améliore|dashboard|application|page|component|feature|fonctionnalité)/i;
  return buildWords.test(lower);
}

// ─── Thinking loop ────────────────────────────────────────────────────────
// Runs a self-critique loop using the same AI client, WITHIN the same request.
// The AI builds a reasoning chain where it plans each feature, then a critic
// pass checks for any simulations/mocks. If found, it loops and corrects.
// The resulting clean plan is injected as context before code generation.
// Max 3 iterations to stay within maxDuration budget.

const THINKING_SYSTEM = `Tu es un architecte logiciel senior en train de faire un audit obligatoire AVANT d'écrire du code. Tu ne dois PAS écrire de code maintenant. Tu dois uniquement raisonner et produire un plan d'implémentation.

LE PRINCIPE D'EFFICIENCE — applique-le à chaque feature sans exception :
Une feature existe vraiment seulement quand CHAQUE couche de sa chaîne est réelle. Pas simulée. Pas hardcodée. Pas "à connecter plus tard".

PIÈGES À DÉTECTER ET ÉLIMINER dans ton plan :
- Retourner une chaîne hardcodée depuis une API route en prétendant que c'est de l'IA → ÉCHEC. La vraie IA envoie le contenu de l'utilisateur à un vrai LLM et retourne sa vraie réponse.
- Utiliser setTimeout pour simuler un délai de chargement → ÉCHEC. Les vraies opérations async n'ont pas besoin de faux délais.
- Stocker des données de transcription dans un tableau hardcodé → ÉCHEC. La vraie transcription envoie l'audio à un vrai service (Whisper, Gemini multimodal, AssemblyAI) et récupère les vrais timestamps.
- Écrire "// connecter la vraie API ici plus tard" → ÉCHEC ABSOLU. Il n'y a pas de "plus tard". C'est maintenant ou jamais.
- Toute variable nommée mockData, fakeResponse, simulatedResult, demoContent → ÉCHEC par définition.

POUR CHAQUE FEATURE demandée par l'utilisateur, raisonne sur :
1. RÉSULTAT UTILISATEUR : Qu'est-ce que l'utilisateur obtient concrètement quand ça marche ?
2. CHAÎNE COMPLÈTE : Quelles sont toutes les couches nécessaires ? (composant → state → API route → service externe → réponse → mise à jour UI)
3. IMPLÉMENTATION RÉELLE : Quel outil/librairie/API/navigateur rend chaque couche réelle ? Nomme-les précisément.
4. VÉRIFICATION SIMULATION : Y a-t-il une couche que je serais tenté de simuler ? Si oui — quelle est l'implémentation 100% réelle de cette couche exacte ?
5. PACKAGES NÉCESSAIRES : Qu'est-ce qui doit être installé ?

MODÈLES LLM VALIDES — si intégration IA nécessaire, utilise uniquement ces chaînes exactes :
- Gemini : gemini-3-flash-preview | gemini-3.1-pro-preview | gemini-2.5-flash | gemini-2.5-pro
- Anthropic : claude-sonnet-4-6 | claude-opus-4-6
- OpenAI : gpt-4o | gpt-4o-mini
JAMAIS : gemini-pro, gemini-1.0, gpt-4-turbo, claude-2, ou toute version dépréciée.

Produis un PLAN FINAL structuré avec :
- Chaque feature et son implémentation réelle exacte (zéro simulation)
- Chaque intégration externe et pourquoi elle a été choisie
- Liste complète des packages
Sois impitoyablement honnête. Si tu te surprends à planifier un raccourci, arrête et remplace-le par le vrai truc.`;

const CRITIC_MESSAGE = `Relis ton plan ci-dessus. Cherche activement :
- Y a-t-il une feature dont l'implémentation contient encore une simulation, un mock, un hardcode, un setTimeout, ou un commentaire "connecter plus tard" ?
- Y a-t-il une feature qui "ressemble" à fonctionner sans vraiment fonctionner de bout en bout ?
- Y a-t-il un modèle LLM déprécié utilisé ?

Si OUI à l'une de ces questions : réécris UNIQUEMENT les parties problématiques du plan avec l'implémentation réelle correcte.
Si NON : réponds uniquement "PLAN VALIDÉ — aucune simulation détectée." et arrête.`;

async function runThinkingLoop(
  userRequest: string,
  projectSummary: string,
  callGemini: (messages: any[]) => Promise<string>,
  callAnthropic: (messages: any[]) => Promise<string>,
  isAnthropic: boolean,
  maxIterations = 3
): Promise<string> {
  const callAI = isAnthropic ? callAnthropic : callGemini;
  const thinkingHistory: Array<{ role: string; content: string }> = [];
  let finalPlan = "";

  // Initial reasoning
  thinkingHistory.push({
    role: "user",
    content: `Demande utilisateur :\n${userRequest}\n\nContexte projet :\n${projectSummary || "Nouveau projet — aucun fichier existant."}`
  });

  try {
    const initialPlan = await callAI(thinkingHistory);
    thinkingHistory.push({ role: "assistant", content: initialPlan });
    finalPlan = initialPlan;

    // Self-critique loop
    for (let i = 0; i < maxIterations - 1; i++) {
      thinkingHistory.push({ role: "user", content: CRITIC_MESSAGE });
      const critique = await callAI(thinkingHistory);
      thinkingHistory.push({ role: "assistant", content: critique });

      if (critique.includes("PLAN VALIDÉ")) {
        break;
      }
      finalPlan = critique; // updated plan after critique
    }
  } catch (err) {
    console.error("[thinking-loop] error:", err);
    return "";
  }

  return finalPlan;
}

// ─── File format instructions injected into every system prompt ───────────
const FILE_FORMAT = `
LANGUAGE: Always respond in the same language the user writes in. If the user writes in Arabic, respond in Arabic. If in Chinese, respond in Chinese. If in French, respond in French. Match their language exactly.

INTENT DETECTION — Read the user's message carefully before doing anything:
- If the user is greeting, asking a question, discussing, or chatting → respond conversationally, do NOT generate code or files
- If the user explicitly asks to build, create, add a feature, fix a bug, or modify something → then generate files
- When in doubt, ask a clarifying question rather than generating unwanted code
- Examples of chat (no code): "hello", "what can you do?", "how does X work?", "thanks"
- Examples of code requests: "build me a dashboard", "add a login page", "fix the button", "create a todo app"

You are an expert full-stack Next.js / TypeScript / Tailwind CSS developer.

CREATE A NEW FILE:
<create_file path="relative/path/to/file.tsx">
// full file content here — complete, no truncation
</create_file>

EDIT AN EXISTING FILE — USE THIS for any modification to an existing file:
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>replacement content here</changes_to_apply>
</edit_file>

CRITICAL RULES FOR edit_file:
- edit_file is a SURGICAL tool. It targets a specific block of lines, NOT the whole file.
- NEVER use start_line=1 and end_line=<total lines> — that is a full rewrite disguised as an edit. Use create_file if you must rewrite the whole file.
- A typical edit touches 5 to 30 lines. If your edit spans more than 60 lines, ask yourself if you are doing too much at once.
- Use multiple small edit_file blocks on the same file rather than one giant block covering everything.
- action is always "replace"

STRICTLY FORBIDDEN TAGS — never use these, ever:
<read_file />, <file_changes>, <fileschanges>, <write_file>
These do not exist. Only create_file and edit_file are valid file operations.

WHEN TO REGENERATE FILES vs WHEN TO EDIT:
- User asks to fix a bug → edit_file on the affected lines only. Do NOT regenerate other files.
- User asks to change a color, a label, a style → edit_file on those lines only.
- User asks to add a small feature → edit_file to insert the new code. Only create a new file if the feature genuinely requires one.
- User asks to build a full new app or page → create_file as needed.
- Touch ONLY what the request requires. Leave everything else untouched.

CODE QUALITY RULES:
- "use client" must be the very first line of any React component using hooks or browser APIs
- Named exports for views: export function DashboardView() {}
- Default export only for app/page.tsx and app/layout.tsx
- key prop on every .map(): items.map(item => <div key={item.id}>)
- @/ alias for all internal imports: import { X } from "@/components/ui/X"
- No tailwindcss-animate in tailwind.config.ts plugins[]
- App layout must fill the viewport: className="flex h-screen w-screen overflow-hidden"
- Never leave onClick empty — every button must trigger real logic
- Use Recharts for all charts, never fake charts with height divs
- Avatars: https://api.dicebear.com/7.x/avataaars/svg?seed=NAME — never emojis or person icons
- Tabler Icons (outline) for nav/UI: <i className="ti ti-home" />
- Iconsax (filled) for colorful card icons: import { Home } from 'iconsax-react'
- app/layout.tsx must include: <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />

DECLARE PACKAGE CHANGES (add at end of response if needed):
DEPENDENCIES: ["recharts", "date-fns"]
DEVDEPENDENCIES: ["@types/lodash"]
REMOVE_DEPENDENCIES: ["bad-package"]
`;

export async function POST(req: Request) {
  try {
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey =
      req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "";
    const anthropicKey =
      req.headers.get("x-anthropic-api-key") ||
      process.env.ANTHROPIC_API_KEY ||
      "";

    if (isAnthropic && !anthropicKey)
      return NextResponse.json(
        { error: "Anthropic API key missing" },
        { status: 401 }
      );
    if (!isAnthropic && !geminiKey)
      return NextResponse.json(
        { error: "Gemini API key missing" },
        { status: 401 }
      );

    const body = await req.json();
    const {
      history = [],
      uploadedImages = [],
      allReferenceImages = [],
      currentProjectFiles = [],
      uploadedFiles = [],
      referenceColorMaps = [],
      uploadedColorMaps = [],
    } = body;

    // ─── Build system prompt ──────────────────────────────────────────────
    let systemPrompt = FILE_FORMAT;

    // Inject existing project files with line numbers so AI can use edit_file precisely
    if (currentProjectFiles && currentProjectFiles.length > 0) {
      const addLineNums = (content: string) =>
        content.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");

      const fileList = currentProjectFiles
        .map((f: { path: string; content: string }) =>
          `\n=== ${f.path} ===\n${addLineNums(f.content)}`
        )
        .join("\n\n");
      systemPrompt += `\n\nEXISTING PROJECT FILES (with line numbers for edit_file reference — do NOT include line number prefixes in old_str):\n${fileList.slice(0, 80000)}`;
    }

    // Inject color palette data if available
    if (referenceColorMaps.length > 0 || uploadedColorMaps.length > 0) {
      const allColors = [...referenceColorMaps, ...uploadedColorMaps].join("\n");
      systemPrompt += `\n\nPIXEL-EXTRACTED COLOR PALETTE (use these exact hex values — do not invent colors):\n${allColors}`;
    }

    // ─── Build message contents ───────────────────────────────────────────
    // Last user message with images
    const lastHistory = history[history.length - 1];
    const lastUserText =
      lastHistory?.role === "user"
        ? typeof lastHistory.content === "string"
          ? lastHistory.content
          : lastHistory.content
              ?.filter((p: any) => p.type === "text")
              ?.map((p: any) => p.text)
              ?.join("\n") ?? ""
        : "";

    // All images to attach (uploaded + reference vibes)
    const allImages = [
      ...(uploadedImages || []),
      ...(allReferenceImages || []),
    ].slice(0, 4);

    // ─── THINKING LOOP ────────────────────────────────────────────────────
    // Same AI client, same request — no separate endpoint.
    // The AI plans each feature, then a critic pass hunts for simulations.
    // It loops until the plan is clean (max 3 passes).
    // The resulting reasoning is injected into systemPrompt so the model
    // cannot deviate from its own written commitments during generation.
    if (isBuildRequest(lastUserText)) {
      const projectSummary = currentProjectFiles.length > 0
        ? `Fichiers existants : ${currentProjectFiles.map((f: any) => f.path).join(", ")}`
        : "Nouveau projet";

      // Shared non-streaming callers using the same keys already validated above
      const callGeminiThink = async (msgs: any[]): Promise<string> => {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const geminiMsgs = msgs.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: geminiMsgs,
          config: { systemInstruction: THINKING_SYSTEM, temperature: 0.2, maxOutputTokens: 3000 },
        });
        return res.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
      };

      const callAnthropicThink = async (msgs: any[]): Promise<string> => {
        const anthropicClient = new Anthropic({ apiKey: anthropicKey });
        const res = await anthropicClient.messages.create({
          model: MODEL_ID,
          max_tokens: 3000,
          system: THINKING_SYSTEM,
          messages: msgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        });
        return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      };

      const thinkingPlan = await runThinkingLoop(
        lastUserText,
        projectSummary,
        callGeminiThink,
        callAnthropicThink,
        isAnthropic
      );

      if (thinkingPlan) {
        systemPrompt += `

${"═".repeat(64)}
TON PLAN PRÉ-BUILD — TU L'AS ÉCRIT TOI-MÊME. TU Y ES LIÉ.
Tu viens de raisonner feature par feature et de t'engager sur des
implémentations réelles, sans simulation, sans mock, sans "plus tard".
Tu dois maintenant écrire le code qui correspond EXACTEMENT à ce plan.
Toute déviation — mock, hardcode, setTimeout, commentaire "connecter ici"
— est une contradiction de ton propre engagement écrit ci-dessous.
${"═".repeat(64)}
${thinkingPlan}
${"═".repeat(64)}`;
      }
    }

    // ─── GEMINI STREAM ────────────────────────────────────────────────────
    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Build Gemini contents from history
      const contents: any[] = [];

      for (const msg of history.slice(0, -1)) {
        const role = msg.role === "assistant" ? "model" : "user";
        const text =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                ?.filter((p: any) => p.type === "text")
                ?.map((p: any) => p.text)
                ?.join("\n") ?? "";
        if (text.trim()) {
          contents.push({ role, parts: [{ text }] });
        }
      }

      // Last user message with images
      const lastParts: any[] = [];

      for (const img of allImages) {
        try {
          const raw = img.includes(",") ? img.split(",")[1] : img;
          if (!raw || raw.length < 100) continue;
          const mime = img.startsWith("data:image/png")
            ? "image/png"
            : img.startsWith("data:image/webp")
            ? "image/webp"
            : "image/jpeg";
          lastParts.push({ inlineData: { data: raw, mimeType: mime } });
        } catch {}
      }

      for (const f of uploadedFiles || []) {
        if (f.base64Content && f.fileName) {
          lastParts.push({
            inlineData: { data: f.base64Content, mimeType: "application/pdf" },
          });
        }
      }

      const functionalityReminder = `[⚠️ INSTRUCTION ABSOLUE — LIRE EN PREMIER, AVANT TOUT]

TU AS UN DÉFAUT CRITIQUE QUE TU DOIS CORRIGER MAINTENANT : tu construis des apparences de fonctionnalités au lieu de fonctionnalités réelles. Tu crois avoir construit une feature parce que tu as écrit du code pour elle. Mais il y a une différence énorme entre écrire du code qui représente une feature et écrire du code qui fait vraiment fonctionner cette feature.

VOICI TON PATTERN ACTUEL — C'EST CE QUE TU FAIS MAL :
Tu dois construire une transcription vidéo → tu crées un tableau de données texte hardcodées appelé "transcriptData" et tu l'affiches. Ce n'est pas de la transcription. C'est du texte que tu as inventé.
Tu dois construire un générateur IA → tu mets un état "isLoading" puis tu affiches une réponse que tu as écrite toi-même dans le code. Ce n'est pas de l'IA. C'est du théâtre.
Tu dois construire un lecteur vidéo avec vraie progression → tu fais un div stylé avec une largeur en pourcentage fixe. Ce n'est pas un player. C'est une barre CSS.

VOICI CE QUE TU DOIS FAIRE À LA PLACE — LE PRINCIPE D'EFFICIENCE :
Pour chaque feature, pose-toi cette seule question : "Qu'est-ce qui doit réellement se passer pour que cette feature existe vraiment ?" Puis remonte toute la chaîne jusqu'au bout.

La transcription vidéo existe vraiment quand : l'audio de la vidéo est envoyé à un vrai service de transcription (Gemini multimodal, Whisper d'OpenAI, AssemblyAI) via une vraie API route, et le texte retourné avec les vrais timestamps alimente l'interface. Pas quand tu écris toi-même le texte dans un tableau.

La génération IA existe vraiment quand : le contenu de l'utilisateur est envoyé à un vrai LLM via fetch('/api/generate'), le modèle le traite et retourne une vraie réponse, et cette réponse s'affiche. Pas quand tu mets une réponse hardcodée après un setTimeout.

Une feature qui nécessite une capacité externe existe vraiment quand : tu identifies quel outil ou service possède vraiment cette capacité, tu l'intègres complètement, et tu câbles sa vraie sortie à ton interface. C'est ça l'efficience : chaque couche de la feature est réelle. Aucune couche n'est simulée, inventée, ou "à connecter plus tard".

MODÈLES LLM VALIDES AUJOURD'HUI — utilise uniquement ces versions exactes, les autres sont dépréciées et rejetées par les APIs :
- Gemini : gemini-3-flash-preview | gemini-3.1-pro-preview | gemini-2.5-flash | gemini-2.5-pro
- Anthropic : claude-sonnet-4-6 | claude-opus-4-6
- OpenAI : gpt-4o | gpt-4o-mini

QUAND TU AS FINI : explique à l'utilisateur ce qu'il peut faire concrètement, quel vrai service tu as branché et pourquoi, comment il s'en sert — dans ses mots, pas les tiens de développeur. Jamais de liste de hooks ou d'états React.

DÉTECTION D'INTENTION :
→ Discussion / question → réponds en texte, zéro fichier.
→ Correction / petite modif → edit_file chirurgical sur les lignes concernées uniquement.
→ Nouveau build → applique tout ce qui précède, construis vraiment.
]\n\n`;
      lastParts.push({ text: functionalityReminder + (lastUserText || "Aide-moi.") });
      contents.push({ role: "user", parts: lastParts });

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const emit = (t: string) => controller.enqueue(enc.encode(t));
          try {
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: {
                systemInstruction: systemPrompt,
                temperature: 1.0,
                maxOutputTokens: 65536,
              },
            });
            let fullOutput = "";
            for await (const chunk of response) {
              const text = chunk.candidates?.[0]?.content?.parts
                ?.map((p: any) => p.text ?? "")
                ?.join("") ?? "";
              if (text) { emit(text); fullOutput += text; }
            }
            // Generate/update package.json if AI declared new dependencies
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) {
              emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
            }
          } catch (err: any) {
            emit(`\n[ERROR] ${err.message}`);
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "X-Accel-Buffering": "no",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        },
      });
    }

    // ─── ANTHROPIC STREAM ─────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Build Anthropic messages from history
    const messages: any[] = [];

    for (let i = 0; i < history.length - 1; i++) {
      const msg = history[i];
      const role = msg.role === "assistant" ? "assistant" : "user";
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              ?.filter((p: any) => p.type === "text")
              ?.map((p: any) => p.text)
              ?.join("\n") ?? "";
      if (text.trim()) {
        messages.push({ role, content: text });
      }
    }

    // Last user message with images
    const lastContent: any[] = [];

    for (const img of allImages) {
      try {
        const raw = img.includes(",") ? img.split(",")[1] : img;
        if (!raw || raw.length < 100) continue;
        const mt = img.startsWith("data:image/png")
          ? "image/png"
          : img.startsWith("data:image/webp")
          ? "image/webp"
          : "image/jpeg";
        lastContent.push({
          type: "image",
          source: { type: "base64", media_type: mt, data: raw },
        });
      } catch {}
    }

    const functionalityReminder = `[⚠️ INSTRUCTION ABSOLUE — LIRE EN PREMIER, AVANT TOUT]

TU AS UN DÉFAUT CRITIQUE QUE TU DOIS CORRIGER MAINTENANT : tu construis des apparences de fonctionnalités au lieu de fonctionnalités réelles. Tu crois avoir construit une feature parce que tu as écrit du code pour elle. Mais il y a une différence énorme entre écrire du code qui représente une feature et écrire du code qui fait vraiment fonctionner cette feature.

VOICI TON PATTERN ACTUEL — C'EST CE QUE TU FAIS MAL :
Tu dois construire une transcription vidéo → tu crées un tableau de données texte hardcodées appelé "transcriptData" et tu l'affiches. Ce n'est pas de la transcription. C'est du texte que tu as inventé.
Tu dois construire un générateur IA → tu mets un état "isLoading" puis tu affiches une réponse que tu as écrite toi-même dans le code. Ce n'est pas de l'IA. C'est du théâtre.
Tu dois construire un lecteur vidéo avec vraie progression → tu fais un div stylé avec une largeur en pourcentage fixe. Ce n'est pas un player. C'est une barre CSS.

VOICI CE QUE TU DOIS FAIRE À LA PLACE — LE PRINCIPE D'EFFICIENCE :
Pour chaque feature, pose-toi cette seule question : "Qu'est-ce qui doit réellement se passer pour que cette feature existe vraiment ?" Puis remonte toute la chaîne jusqu'au bout.

La transcription vidéo existe vraiment quand : l'audio de la vidéo est envoyé à un vrai service de transcription (Gemini multimodal, Whisper d'OpenAI, AssemblyAI) via une vraie API route, et le texte retourné avec les vrais timestamps alimente l'interface. Pas quand tu écris toi-même le texte dans un tableau.

La génération IA existe vraiment quand : le contenu de l'utilisateur est envoyé à un vrai LLM via fetch('/api/generate'), le modèle le traite et retourne une vraie réponse, et cette réponse s'affiche. Pas quand tu mets une réponse hardcodée après un setTimeout.

Une feature qui nécessite une capacité externe existe vraiment quand : tu identifies quel outil ou service possède vraiment cette capacité, tu l'intègres complètement, et tu câbles sa vraie sortie à ton interface. C'est ça l'efficience : chaque couche de la feature est réelle. Aucune couche n'est simulée, inventée, ou "à connecter plus tard".

MODÈLES LLM VALIDES AUJOURD'HUI — utilise uniquement ces versions exactes, les autres sont dépréciées et rejetées par les APIs :
- Gemini : gemini-3-flash-preview | gemini-3.1-pro-preview | gemini-2.5-flash | gemini-2.5-pro
- Anthropic : claude-sonnet-4-6 | claude-opus-4-6
- OpenAI : gpt-4o | gpt-4o-mini

QUAND TU AS FINI : explique à l'utilisateur ce qu'il peut faire concrètement, quel vrai service tu as branché et pourquoi, comment il s'en sert — dans ses mots, pas les tiens de développeur. Jamais de liste de hooks ou d'états React.

DÉTECTION D'INTENTION :
→ Discussion / question → réponds en texte, zéro fichier.
→ Correction / petite modif → edit_file chirurgical sur les lignes concernées uniquement.
→ Nouveau build → applique tout ce qui précède, construis vraiment.
]\n\n`;
    lastContent.push({ type: "text", text: functionalityReminder + (lastUserText || "Aide-moi.") });
    messages.push({ role: "user", content: lastContent });

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));
        try {
          const response = await anthropic.messages.stream({
            model: MODEL_ID,
            max_tokens: 16000,
            system: systemPrompt,
            messages,
          });
          let fullOutput = "";
          for await (const chunk of response) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta"
            ) {
              emit(chunk.delta.text);
              fullOutput += chunk.delta.text;
            }
          }
          // Generate/update package.json if AI declared new dependencies
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) {
            emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
          }
        } catch (err: any) {
          emit(`\n[ERROR] ${err.message}`);
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
