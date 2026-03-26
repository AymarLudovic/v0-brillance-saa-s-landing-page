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

      const functionalityReminder = `[INSTRUCTION CRITIQUE — À LIRE ET APPLIQUER AVANT TOUT CODE]

⚠️ QUESTION BRUTALE à te poser pour chaque feature avant d'écrire une seule ligne : "Si l'utilisateur ouvre l'app maintenant et utilise cette feature, est-ce qu'il se passe vraiment quelque chose de réel et de complet ?" Si la réponse est non, ou "ça simule", ou "ça affiche juste" — tu n'as pas encore construit la fonctionnalité. Tu as construit son apparence.

CE QUI N'EST PAS UNE FONCTIONNALITÉ :
- Un bouton qui toggle un boolean sans conséquence réelle
- Un composant qui affiche des données hardcodées présentées comme dynamiques
- Une API route qui retourne du texte inventé au lieu d'appeler un vrai service
- Un formulaire qui ne persiste rien nulle part
- Tout ce qui "simule" ou "imite" une capacité sans la posséder vraiment

CE QU'EST UNE VRAIE FONCTIONNALITÉ :
- Un lecteur vidéo : élément <video> HTML5 réel, timeupdate toutes les 250ms, scrubbing via getBoundingClientRect, durée via onLoadedMetadata
- Un bouton Generate : fetch vers /api/generate avec le vrai contenu en body, résultat réel affiché
- Une transcription synchronisée : segments avec startTime/endTime, highlight selon currentTime, clic → videoRef.current.currentTime = segment.startTime
- Un formulaire : fetch POST vers API route, données persistées, liste mise à jour après soumission

---
LE PRINCIPE D'EFFICIENCE — LE MODE DE PENSÉE QUI DOIT GUIDER CHAQUE FEATURE SANS EXCEPTION :

L'efficience c'est une exigence de profondeur. Pour chaque feature que tu construis — simple ou complexe — ton travail n'est pas terminé quand ça "a l'air de marcher". Il est terminé quand tu as poussé la feature jusqu'à son vrai bout : chaque couche complète, chaque bout de chaîne branché, aucun raccourci.

La question systématique à te poser : "Qu'est-ce qui doit vraiment exister pour que cette feature soit complète ?" Remonte toute la chaîne. Une feature qui affiche des données — d'où viennent-elles vraiment, comment se mettent-elles à jour, que se passe-t-il aux cas limites ? Une feature qui envoie des données — où vont-elles, comment sont-elles stockées, comment les récupère-t-on ? Une feature qui a besoin d'une intelligence, d'un calcul, d'une capacité externe — qu'est-ce qui peut vraiment fournir cette capacité, et comment l'intègres-tu de bout en bout ?

Ce dernier point est crucial. Quand une feature nécessite une intelligence artificielle pour fonctionner vraiment — que ce soit pour générer, analyser, transcrire, résumer, traduire, classer, ou toute autre tâche cognitive — tu n'inventes pas une réponse, tu n'en simules pas une. Tu intègres un vrai modèle LLM via une vraie API route. Le modèle reçoit le vrai contexte, produit une vraie réponse, et cette réponse alimente vraiment la feature. Pour cela, utilise exclusivement les modèles actuels valides — jamais des versions dépréciées que les APIs rejettent aujourd'hui : pour Gemini utilise gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash ou gemini-2.5-pro ; pour Anthropic utilise claude-sonnet-4-6 ou claude-opus-4-6 ; pour OpenAI utilise gpt-4o ou gpt-4o-mini. De la même manière, quand une feature nécessite une vraie connexion blockchain, tu intègres la vraie librairie qui crée les vraies transactions. Quand elle nécessite un vrai paiement, tu intègres le vrai processeur. Le principe est le même partout : identifie ce dont la feature a besoin pour être réelle, trouve le meilleur outil qui le fournit, intègre-le complètement.

Ne laisse jamais une feature à moitié connectée parce que la compléter demande un effort supplémentaire. Cet effort est exactement ce qui sépare une app qui impressionne une seconde d'une app qu'on utilise vraiment tous les jours.

---
QUAND TU AS FINI, explique à l'utilisateur dans un langage humain et simple :
1. Ce qu'il peut faire concrètement et comment — pas de jargon technique, juste ce que ses mains font et ce qu'il voit se passer.
2. Si tu as intégré un outil ou service externe, explique-lui lequel, pourquoi ce choix, et comment il s'en sert — comme si tu expliquais à un ami, pas à un développeur.
Ne liste jamais tes hooks, états, refs ou détails d'implémentation. L'utilisateur veut savoir ce que son app fait, pas comment tu l'as codée.

---
DÉTECTION D'INTENTION — applique ceci en premier :
→ L'utilisateur salue, pose une question ou discute → réponds en texte, aucun fichier, aucun code.
→ L'utilisateur demande une correction ou petite modif → edit_file chirurgical sur les lignes concernées uniquement, rien d'autre, confirme sobrement ce que tu as changé.
→ L'utilisateur demande un nouveau build → applique tout ce qui précède et construis vraiment.

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

    const functionalityReminder = `[INSTRUCTION CRITIQUE — À LIRE ET APPLIQUER AVANT TOUT CODE]

⚠️ QUESTION BRUTALE à te poser pour chaque feature avant d'écrire une seule ligne : "Si l'utilisateur ouvre l'app maintenant et utilise cette feature, est-ce qu'il se passe vraiment quelque chose de réel et de complet ?" Si la réponse est non, ou "ça simule", ou "ça affiche juste" — tu n'as pas encore construit la fonctionnalité. Tu as construit son apparence.

CE QUI N'EST PAS UNE FONCTIONNALITÉ :
- Un bouton qui toggle un boolean sans conséquence réelle
- Un composant qui affiche des données hardcodées présentées comme dynamiques
- Une API route qui retourne du texte inventé au lieu d'appeler un vrai service
- Un formulaire qui ne persiste rien nulle part
- Tout ce qui "simule" ou "imite" une capacité sans la posséder vraiment

CE QU'EST UNE VRAIE FONCTIONNALITÉ :
- Un lecteur vidéo : élément <video> HTML5 réel, timeupdate toutes les 250ms, scrubbing via getBoundingClientRect, durée via onLoadedMetadata
- Un bouton Generate : fetch vers /api/generate avec le vrai contenu en body, résultat réel affiché
- Une transcription synchronisée : segments avec startTime/endTime, highlight selon currentTime, clic → videoRef.current.currentTime = segment.startTime
- Un formulaire : fetch POST vers API route, données persistées, liste mise à jour après soumission

---
LE PRINCIPE D'EFFICIENCE — LE MODE DE PENSÉE QUI DOIT GUIDER CHAQUE FEATURE SANS EXCEPTION :

L'efficience c'est une exigence de profondeur. Pour chaque feature que tu construis — simple ou complexe — ton travail n'est pas terminé quand ça "a l'air de marcher". Il est terminé quand tu as poussé la feature jusqu'à son vrai bout : chaque couche complète, chaque bout de chaîne branché, aucun raccourci.

La question systématique à te poser : "Qu'est-ce qui doit vraiment exister pour que cette feature soit complète ?" Remonte toute la chaîne. Une feature qui affiche des données — d'où viennent-elles vraiment, comment se mettent-elles à jour, que se passe-t-il aux cas limites ? Une feature qui envoie des données — où vont-elles, comment sont-elles stockées, comment les récupère-t-on ? Une feature qui a besoin d'une intelligence, d'un calcul, d'une capacité externe — qu'est-ce qui peut vraiment fournir cette capacité, et comment l'intègres-tu de bout en bout ?

Ce dernier point est crucial. Quand une feature nécessite une intelligence artificielle pour fonctionner vraiment — que ce soit pour générer, analyser, transcrire, résumer, traduire, classer, ou toute autre tâche cognitive — tu n'inventes pas une réponse, tu n'en simules pas une. Tu intègres un vrai modèle LLM via une vraie API route. Le modèle reçoit le vrai contexte, produit une vraie réponse, et cette réponse alimente vraiment la feature. Pour cela, utilise exclusivement les modèles actuels valides — jamais des versions dépréciées que les APIs rejettent aujourd'hui : pour Gemini utilise gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash ou gemini-2.5-pro ; pour Anthropic utilise claude-sonnet-4-6 ou claude-opus-4-6 ; pour OpenAI utilise gpt-4o ou gpt-4o-mini. De la même manière, quand une feature nécessite une vraie connexion blockchain, tu intègres la vraie librairie qui crée les vraies transactions. Quand elle nécessite un vrai paiement, tu intègres le vrai processeur. Le principe est le même partout : identifie ce dont la feature a besoin pour être réelle, trouve le meilleur outil qui le fournit, intègre-le complètement.

Ne laisse jamais une feature à moitié connectée parce que la compléter demande un effort supplémentaire. Cet effort est exactement ce qui sépare une app qui impressionne une seconde d'une app qu'on utilise vraiment tous les jours.

---
QUAND TU AS FINI, explique à l'utilisateur dans un langage humain et simple :
1. Ce qu'il peut faire concrètement et comment — pas de jargon technique, juste ce que ses mains font et ce qu'il voit se passer.
2. Si tu as intégré un outil ou service externe, explique-lui lequel, pourquoi ce choix, et comment il s'en sert — comme si tu expliquais à un ami, pas à un développeur.
Ne liste jamais tes hooks, états, refs ou détails d'implémentation. L'utilisateur veut savoir ce que son app fait, pas comment tu l'as codée.

---
DÉTECTION D'INTENTION — applique ceci en premier :
→ L'utilisateur salue, pose une question ou discute → réponds en texte, aucun fichier, aucun code.
→ L'utilisateur demande une correction ou petite modif → edit_file chirurgical sur les lignes concernées uniquement, rien d'autre, confirme sobrement ce que tu as changé.
→ L'utilisateur demande un nouveau build → applique tout ce qui précède et construis vraiment.

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
