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

  for (const r of toRemove) {
    delete pkg.dependencies?.[r];
    delete pkg.devDependencies?.[r];
  }

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
  const chatOnly = /^(bonjour|hello|salut|hi|hey|merci|thanks|thank you|ok|okay|oui|non|yes|no|super|parfait|cool|génial|bien|bonne journée|au revoir|bye|ça va|comment ça|qu'est-ce que|c'est quoi|pourquoi|comment fonctionne|explique|dis moi)/i;
  if (chatOnly.test(lower) && text.length < 120) return false;
  const buildWords = /(build|create|make|add|fix|crée|construis|ajoute|corrige|génère|développe|implement|modifie|change|update|mets|fais|réalise|intègre|rajoute|refait|améliore|dashboard|application|page|component|feature|fonctionnalité)/i;
  return buildWords.test(lower);
}

// ─── THINKING STEP ────────────────────────────────────────────────────────
// A dedicated reasoning-only API call that runs BEFORE any code generation.
// The AI audits its own feature plan against the efficiency principle,
// self-critiques every layer, and produces a binding written commitment.
// This commitment is then injected into the main generation call as context
// the model has already produced — making it impossible to deviate from
// without contradicting itself.
const THINKING_SYSTEM_PROMPT = `You are a senior software architect doing a mandatory pre-build audit. Do NOT write any code yet. Your only job is to reason deeply and produce a rigorous implementation plan.

THE EFFICIENCY PRINCIPLE — apply this to every single feature:
A feature truly exists only when every layer of its chain is real. Not simulated. Not mocked. Not "to be connected later." Real.

Ask yourself for each feature: "If the user opens this app right now and uses this feature, does something real happen end-to-end?"

THE SIMULATION TRAP — these are all failures, recognize them before you commit to them:
- Returning hardcoded strings from an API route pretending to be AI output → FAILURE. Real AI means calling a real LLM API with the user's actual content and streaming back the model's actual response.
- Using setTimeout to fake a loading delay → FAILURE. Real async operations don't need fake delays.
- Storing transcript data as a hardcoded array → FAILURE. Real transcription means audio goes to a real speech-to-text service and timestamped text comes back.
- Writing "// connect real API here for production" → FAILURE. There is no production vs development distinction here. Build it real now.
- Any variable named mockData, fakeResponse, simulatedResult, demoContent → FAILURE by definition.

FOR EVERY FEATURE in the user's request, reason through ALL of these:
1. USER OUTCOME: What does the user actually get when this works? (describe the experience, not the code)
2. FULL CHAIN: What are every layer needed? Frontend component → state management → API route → external service/library → response handling → UI update
3. REAL IMPLEMENTATION: What real tool/library/API/browser API makes each layer real? Name them specifically.
4. SIMULATION CHECK: Is there any layer I'm tempted to fake? If yes — what is the 100% real implementation of that exact layer?
5. PACKAGES NEEDED: What must be installed?
6. SELF-CRITIQUE: Read your plan back. Would a user be satisfied with exactly what this plan produces? If not, revise until yes.

VALID LLM MODELS — if AI integration is needed, use only these exact model strings:
- Gemini: gemini-3-flash-preview | gemini-3.1-pro-preview | gemini-2.5-flash | gemini-2.5-pro
- Anthropic: claude-sonnet-4-6 | claude-opus-4-6
- OpenAI: gpt-4o | gpt-4o-mini
NEVER use: gemini-pro, gemini-1.0, gpt-4-turbo, claude-2, or any deprecated version.

Output a structured FINAL PLAN with:
- Each feature and its exact real implementation (zero simulations)
- Each external integration and why it was chosen
- Complete package list
- Any blocking questions (e.g. "which DB does the user want?")

Be relentlessly honest. If you catch yourself planning a shortcut, stop and replace it with the real thing before continuing.`;

async function thinkBeforeBuilding(
  userRequest: string,
  projectSummary: string,
  geminiKey: string,
  anthropicKey: string,
  isAnthropic: boolean,
  modelId: string
): Promise<string> {
  const input = `User request:\n${userRequest}\n\nProject context:\n${projectSummary || "New project — no existing files."}`;
  try {
    if (isAnthropic && anthropicKey) {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const res = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4000,
        system: THINKING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
      });
      return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    }
    if (geminiKey) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const res = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [{ text: input }] }],
        config: {
          systemInstruction: THINKING_SYSTEM_PROMPT,
          temperature: 0.2,
          maxOutputTokens: 8000,
        },
      });
      return res.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    }
  } catch (err) {
    console.error("[thinking-step] failed:", err);
  }
  return "";
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
- NEVER use start_line=1 and end_line=<last line> — that is a full rewrite. Use create_file instead.
- A typical edit touches 5 to 30 lines. Use multiple small edit_file blocks rather than one giant block.
- action is always "replace"

STRICTLY FORBIDDEN TAGS — these do not exist, never use them:
<read_file />, <file_changes>, <fileschanges>, <write_file>

WHEN TO REGENERATE vs WHEN TO EDIT:
- Bug fix / small change → edit_file surgical only. Touch nothing else.
- New full app or page → create_file as needed.
- Touch ONLY what the request requires.

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
      return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey)
      return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

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

    if (referenceColorMaps.length > 0 || uploadedColorMaps.length > 0) {
      const allColors = [...referenceColorMaps, ...uploadedColorMaps].join("\n");
      systemPrompt += `\n\nPIXEL-EXTRACTED COLOR PALETTE (use these exact hex values — do not invent colors):\n${allColors}`;
    }

    // ─── Extract last user message ────────────────────────────────────────
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

    const allImages = [
      ...(uploadedImages || []),
      ...(allReferenceImages || []),
    ].slice(0, 4);

    // ─── THINKING STEP ────────────────────────────────────────────────────
    // Runs a dedicated reasoning call before any code generation.
    // The resulting plan is injected as context the model has already
    // produced itself — it cannot contradict its own written commitment.
    if (isBuildRequest(lastUserText)) {
      const projectSummary = currentProjectFiles.length > 0
        ? `Existing files: ${currentProjectFiles.map((f: any) => f.path).join(", ")}`
        : "New project";
      const thinkingResult = await thinkBeforeBuilding(
        lastUserText,
        projectSummary,
        geminiKey,
        anthropicKey,
        isAnthropic,
        MODEL_ID
      );
      if (thinkingResult) {
        systemPrompt += `

${"═".repeat(60)}
YOUR PRE-BUILD PLAN — YOU WROTE THIS. YOU ARE BOUND BY IT.
This is the implementation plan you produced after auditing every
feature for real vs simulated implementations. You committed to
zero simulations, zero mock data, zero "connect later" shortcuts.
Every feature below must be built exactly as you planned it.
${"═".repeat(60)}
${thinkingResult}
${"═".repeat(60)}`;
      }
    }

    // ─── GEMINI STREAM ────────────────────────────────────────────────────
    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });

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

    lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
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
