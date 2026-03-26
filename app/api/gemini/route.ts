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
  const chatOnly = /^(bonjour|hello|salut|hi|hey|merci|thanks|ok|okay|oui|non|yes|no|super|parfait|cool|génial|bien|au revoir|bye|ça va|comment ça|c'est quoi|pourquoi|explique|dis moi)/i;
  if (chatOnly.test(lower) && text.length < 120) return false;
  const buildWords = /(build|create|make|add|fix|crée|construis|ajoute|corrige|génère|développe|implement|modifie|change|update|mets|fais|réalise|intègre|rajoute|refait|améliore|dashboard|application|page|component|feature|fonctionnalité)/i;
  return buildWords.test(lower);
}

// ─── Critic agent system prompt ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
// MULTI-AGENT EFFICIENCY PIPELINE
// Each agent inherits the full reasoning of the previous one and goes
// further. They work in cascade: Agent 2 reviews Agent 1's corrections,
// Agent 3 reviews Agent 2's enrichments. Each one upgrades the work
// of the one before until the output reaches perfect efficiency.
// ═══════════════════════════════════════════════════════════════════

// ─── Agent 1 : Connections — "is it real or simulated?" ───────────────────
const AGENT1_SYSTEM = `Tu es le premier agent d'un pipeline de revue en cascade. Ton rôle : détecter tout ce qui est simulé, mocké, ou hardcodé dans le code généré, et produire un rapport de violations précis.

LE PRINCIPE D'EFFICIENCE (fondement de tout le pipeline) :
Une fonctionnalité existe vraiment seulement quand CHAQUE couche de sa chaîne est réelle et fonctionnelle de bout en bout. Pas simulée. Pas hardcodée. Pas "à connecter plus tard". Ce principe s'applique à N'IMPORTE QUEL type de projet — les exemples ci-dessous montrent la direction du raisonnement, pas une liste exhaustive.

TON FOCUS : les connexions. Pour chaque feature, vérifie que chaque couche technique est réelle :
- IA/génération → vrai appel LLM (gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-2.5-flash, gemini-2.5-pro, claude-sonnet-4-6, claude-opus-4-6, gpt-4o, gpt-4o-mini) — jamais mockResponses ou setTimeout
- Transcription → vrai service (Whisper, Gemini multimodal, AssemblyAI) — jamais tableau hardcodé
- Paiement → vrai Stripe/LemonSqueezy avec webhook — jamais bouton qui change un boolean
- Blockchain → vrai ethers.js/viem avec transaction on-chain — jamais console.log
- Exécution de code → vrai E2B sandbox — jamais simulation
- Auth → vrai NextAuth/Clerk — jamais isLoggedIn = true
- TOUTE autre feature : même raisonnement — remonte la chaîne et vérifie que chaque couche est réelle

Patterns qui signalent toujours une violation : mockResponses, setTimeout pour simuler, tableaux hardcodés présentés comme dynamiques, API routes sans appel externe réel, commentaires "// connecter ici" ou "// TODO: vraie API".

FORMAT : liste les violations sous la forme "FICHIER: X — PROBLÈME: Y — SOLUTION: Z" ou réponds "AGENT1_OK" si tout est connecté.`;

// ─── Agent 2 : Depth — "is it complete or just minimal?" ──────────────────
const AGENT2_SYSTEM = `Tu es le deuxième agent d'un pipeline de revue en cascade. L'Agent 1 a déjà vérifié que les connexions sont réelles. Ton travail : vérifier que chaque feature est COMPLÈTE et PROFONDE du point de vue de l'utilisateur — pas seulement connectée, mais vraiment aboutie.

LE PRINCIPE D'EFFICIENCE (hérité de l'Agent 1, tu vas plus loin) :
Une feature connectée mais superficielle n'est pas une feature complète. L'utilisateur ne veut pas la version minimale — il veut la version qui lui donne vraiment ce qu'il attendait. Ce principe s'applique à N'IMPORTE QUEL type de projet.

TON FOCUS : la profondeur et la complétude. Pour chaque feature, demande-toi : "Qu'est-ce qu'un utilisateur exigeant attendrait naturellement de cette feature ?" Si ce qui a été construit est la version minimaliste d'une feature qui méritait d'être riche — c'est incomplet.

Exemples de raisonnement (même logique pour tout type de projet) :
- Lecteur vidéo : play/pause seul = incomplet. Complet = timeline interactive synchronisée, thumbnails au hover sur la barre, scrubbing précis, contrôle vitesse, volume, plein écran, temps actuel/durée totale
- Transcription : texte affiché seul = incomplet. Complet = synchronisation avec timestamps, surbrillance du segment actif, clic pour sauter au moment, choix de langue pour traduction temps réel, export
- Dashboard : cartes avec chiffres = incomplet. Complet = filtres de période, graphiques interactifs, export, actualisation réelle
- Auth : login/logout = incomplet. Complet = inscription, récupération mot de passe, gestion session, protection routes, profil
- TOUTE autre feature : même raisonnement — qu'est-ce que l'utilisateur attendait vraiment ?

FORMAT : liste les manques sous la forme "FEATURE: X — MANQUE: Y — AJOUT: Z" ou réponds "AGENT2_OK" si tout est suffisamment complet.`;

// ─── Agent 3 : Synthesis — "does it all come together perfectly?" ──────────
const AGENT3_SYSTEM = `Tu es le troisième et dernier agent d'un pipeline de revue en cascade. L'Agent 1 a vérifié les connexions. L'Agent 2 a vérifié la profondeur. Ton travail : faire la synthèse finale — vérifier qu'il ne reste aucune faille d'efficience, et que l'explication donnée à l'utilisateur lui parle vraiment.

LE PRINCIPE D'EFFICIENCE (hérité des deux agents précédents, tu fais la synthèse) :
Tu vérifies les deux dimensions en une seule passe — connexions ET profondeur — pour t'assurer qu'aucune violation n'a échappé aux agents précédents. Puis tu évalues la communication finale.

TON FOCUS 1 — Vérification finale des connexions et de la profondeur :
Relis le code final (après les corrections des agents 1 et 2). Y a-t-il encore des simulations ou des features superficielles qui ont échappé ? Si oui, liste-les.

TON FOCUS 2 — La communication finale avec l'utilisateur :
L'explication donnée à la fin doit parler à l'utilisateur en termes de ce qu'il peut FAIRE — pas en termes de code.

INACCEPTABLE dans l'explication : useState, useRef, useEffect, hooks, noms de fichiers comme accomplissement, "gestion d'état", "props", "la structure est prête pour", "vous pourrez connecter plus tard"

ATTENDU dans l'explication : décrire action par action ce que l'utilisateur peut faire ("Appuyez sur Play, la barre avance. Survolez la timeline pour voir un aperçu. Cliquez sur une ligne de transcription pour sauter à ce moment exact."), expliquer chaque service intégré dans ses mots ("j'ai branché un service qui écoute l'audio de votre vidéo et le retranscrit automatiquement avec les timestamps — vous n'avez rien à configurer"), parler comme à un ami.

FORMAT :
- Si tu trouves encore des violations de connexion ou profondeur : "RESTE: [description précise]"
- Si l'explication finale est technique ou insuffisante : fournis le texte de remplacement complet commençant par "Voici ce que vous pouvez faire maintenant :"
- Si tout est parfait : réponds "AGENT3_OK"`;

async function runAgent(
  agentSystem: string,
  currentOutput: string,
  userRequest: string,
  callAI: (sys: string, msgs: any[]) => Promise<string>,
  okToken: string
): Promise<string> {
  if (!currentOutput || currentOutput.length < 200) return okToken;
  try {
    return await callAI(agentSystem, [{
      role: "user",
      content: `Demande originale : "${userRequest}"\n\nCode et output à analyser :\n${currentOutput.slice(0, 40000)}`
    }]);
  } catch {
    return okToken;
  }
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

          const callGeminiNonStream = async (sys: string, msgs: any[]): Promise<string> => {
            const res = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
              config: { systemInstruction: sys, temperature: 0.1, maxOutputTokens: 4000 },
            });
            return res.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
          };

          try {
            // ── Pass 1 : génération principale ──────────────────────────
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: { systemInstruction: systemPrompt, temperature: 1.0, maxOutputTokens: 65536 },
            });
            let currentOutput = "";
            for await (const chunk of response) {
              const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
              if (text) { emit(text); currentOutput += text; }
            }

            if (isBuildRequest(lastUserText)) {
              // Runs a correction stream and appends result to currentOutput
              const applyCorrection = async (report: string, label: string, instruction: string): Promise<void> => {
                const corrContents = [
                  ...contents,
                  { role: "model", parts: [{ text: currentOutput }] },
                  { role: "user", parts: [{ text: `${instruction}\n\nRAPPORT :\n${report}` }] },
                ];
                emit(`\n\n<!-- ${label} -->\n`);
                const s = await ai.models.generateContentStream({
                  model: MODEL_ID, contents: corrContents,
                  config: { systemInstruction: systemPrompt, temperature: 0.7, maxOutputTokens: 32000 },
                });
                for await (const c of s) {
                  const t = c.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
                  if (t) { emit(t); currentOutput += t; }
                }
              };

              // Agent 1 reads original output → fixes simulations
              const a1 = await runAgent(AGENT1_SYSTEM, currentOutput, lastUserText, callGeminiNonStream, "AGENT1_OK");
              if (a1 && !a1.includes("AGENT1_OK")) {
                await applyCorrection(a1, "AGENT1 — EFFICIENCY CORRECTION",
                  "L'Agent 1 a détecté des simulations et des connexions manquantes. Corrige chaque violation : remplace les mocks par de vraies intégrations, supprime les setTimeout, connecte les vraies APIs. Utilise edit_file. Ne touche que ce qui est listé.");
              }

              // Agent 2 reads Agent 1's corrected output → adds depth
              const a2 = await runAgent(AGENT2_SYSTEM, currentOutput, lastUserText, callGeminiNonStream, "AGENT2_OK");
              if (a2 && !a2.includes("AGENT2_OK")) {
                await applyCorrection(a2, "AGENT2 — DEPTH ENRICHMENT",
                  "L'Agent 2 a détecté des fonctionnalités trop superficielles. Pour chaque manque : ajoute les sous-features manquantes. Utilise edit_file pour enrichir ce qui existe. Ne génère que ce qui est listé.");
              }

              // Agent 3 reads Agent 2's enriched output → final check + communication
              const a3 = await runAgent(AGENT3_SYSTEM, currentOutput, lastUserText, callGeminiNonStream, "AGENT3_OK");
              if (a3 && !a3.includes("AGENT3_OK")) {
                if (a3.includes("RESTE:")) {
                  await applyCorrection(a3, "AGENT3 — FINAL CORRECTION",
                    "L'Agent 3 a détecté des violations résiduelles après les deux premiers agents. Corrige-les maintenant. Utilise edit_file.");
                }
                const commPart = a3.replace(/RESTE:[^\n]*\n?/g, "").trim();
                if (commPart && commPart.length > 50) {
                  emit("\n\n---\n" + commPart);
                }
              }
            }

            const pkgResult = await buildPackageJson(currentOutput, currentProjectFiles || []);
            if (pkgResult) emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
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

        const callAnthropicNonStream = async (sys: string, msgs: any[]): Promise<string> => {
          const res = await anthropic.messages.create({
            model: MODEL_ID,
            max_tokens: 4000,
            system: sys,
            messages: msgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          });
          return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        };

        try {
          // ── Pass 1 : génération principale ────────────────────────────
          const response = await anthropic.messages.stream({
            model: MODEL_ID, max_tokens: 16000, system: systemPrompt, messages,
          });
          let currentOutput = "";
          for await (const chunk of response) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              emit(chunk.delta.text);
              currentOutput += chunk.delta.text;
            }
          }

          if (isBuildRequest(lastUserText)) {
            const applyCorrection = async (report: string, label: string, instruction: string): Promise<void> => {
              const corrMsgs = [
                ...messages,
                { role: "assistant", content: currentOutput },
                { role: "user", content: `${instruction}\n\nRAPPORT :\n${report}` },
              ];
              emit(`\n\n<!-- ${label} -->\n`);
              const s = await anthropic.messages.stream({
                model: MODEL_ID, max_tokens: 16000, system: systemPrompt, messages: corrMsgs,
              });
              for await (const c of s) {
                if (c.type === "content_block_delta" && c.delta.type === "text_delta") {
                  emit(c.delta.text);
                  currentOutput += c.delta.text;
                }
              }
            };

            // Agent 1 reads original output → fixes simulations
            const a1 = await runAgent(AGENT1_SYSTEM, currentOutput, lastUserText, callAnthropicNonStream, "AGENT1_OK");
            if (a1 && !a1.includes("AGENT1_OK")) {
              await applyCorrection(a1, "AGENT1 — EFFICIENCY CORRECTION",
                "L'Agent 1 a détecté des simulations et des connexions manquantes. Corrige chaque violation : remplace les mocks par de vraies intégrations, supprime les setTimeout, connecte les vraies APIs. Utilise edit_file. Ne touche que ce qui est listé.");
            }

            // Agent 2 reads Agent 1's corrected output → adds depth
            const a2 = await runAgent(AGENT2_SYSTEM, currentOutput, lastUserText, callAnthropicNonStream, "AGENT2_OK");
            if (a2 && !a2.includes("AGENT2_OK")) {
              await applyCorrection(a2, "AGENT2 — DEPTH ENRICHMENT",
                "L'Agent 2 a détecté des fonctionnalités trop superficielles. Pour chaque manque : ajoute les sous-features manquantes. Utilise edit_file pour enrichir ce qui existe. Ne génère que ce qui est listé.");
            }

            // Agent 3 reads Agent 2's enriched output → final check + communication
            const a3 = await runAgent(AGENT3_SYSTEM, currentOutput, lastUserText, callAnthropicNonStream, "AGENT3_OK");
            if (a3 && !a3.includes("AGENT3_OK")) {
              if (a3.includes("RESTE:")) {
                await applyCorrection(a3, "AGENT3 — FINAL CORRECTION",
                  "L'Agent 3 a détecté des violations résiduelles après les deux premiers agents. Corrige-les maintenant. Utilise edit_file.");
              }
              const commPart = a3.replace(/RESTE:[^\n]*\n?/g, "").trim();
              if (commPart && commPart.length > 50) {
                emit("\n\n---\n" + commPart);
              }
            }
          }

          const pkgResult = await buildPackageJson(currentOutput, currentProjectFiles || []);
          if (pkgResult) emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
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
