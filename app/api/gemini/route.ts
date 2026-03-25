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

EDIT AN EXISTING FILE (USE THIS when the file already exists — prefer over create_file for changes):
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>replacement content here</changes_to_apply>
</edit_file>

IMPORTANT ABOUT edit_file:
- action is always "replace"
- start_line and end_line are the exact line numbers from the file shown below
- changes_to_apply contains the full replacement content for those lines
- If you need to make multiple changes to the same file, use multiple <edit_file> blocks
- Prefer edit_file over create_file when the file already exists

STRICTLY FORBIDDEN TAGS — never use these, ever:
<read_file />, <file_changes>, <fileschanges>, <write_file>
Using any of these will break the parser. They do not exist. Only create_file and edit_file are valid.

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

      const functionalityReminder = `[CRITICAL INSTRUCTION — APPLY THIS BEFORE WRITING ANY CODE]

You are not here to render UI. You are here to build a product with real, working features.

The difference: a developer who builds a video player doesn't write "isPlaying state toggled on button click." They build: the actual HTML5 video element with real src, a timeline bar whose width updates every 250ms via timeupdate event, a thumbnail preview system that seeks to different timestamps on hover, a transcription engine wired to a real API that returns subtitles synced to currentTime, a translation layer that converts those subtitles to the user's chosen language in real time. That is a feature. useState is not a feature. It is a detail no user will ever care about.

When you build anything — a player, a form, a generator, a dashboard, a chat, a feed — ask yourself: what will the user actually be able to DO with this when they open it? Build that. Completely. Not the skeleton of it. Not the visual representation of it. The working thing itself.

If you are about to write a handler that only toggles a boolean — stop. What should actually happen when this is triggered? Build that instead.
If you are about to hardcode data — stop. Where should this data come from and where should it be stored? Build that instead.
If you are about to write "simulates an API call" — stop. Make the real API route and call it.
If the feature needs a real browser API (Audio, Video, WebSocket, MediaRecorder, Canvas, SpeechRecognition) — use it. Directly. Not a mock of it.

When you finish, explain what you built in terms of what the USER can do — not what React hooks you used. Say: "I built a video player where you can hover the timeline to see thumbnail previews of any moment in the video. I implemented real-time transcription using the Web Speech API, connected to a translation endpoint so subtitles appear in your chosen language as the video plays. To use it, press play and select your language in the top-right dropdown." That is how a real product is delivered.

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

    const functionalityReminder = `[CRITICAL INSTRUCTION — APPLY THIS BEFORE WRITING ANY CODE]

You are not here to render UI. You are here to build a product with real, working features.

The difference: a developer who builds a video player doesn't write "isPlaying state toggled on button click." They build: the actual HTML5 video element with real src, a timeline bar whose width updates every 250ms via timeupdate event, a thumbnail preview system that seeks to different timestamps on hover, a transcription engine wired to a real API that returns subtitles synced to currentTime, a translation layer that converts those subtitles to the user's chosen language in real time. That is a feature. useState is not a feature. It is a detail no user will ever care about.

When you build anything — a player, a form, a generator, a dashboard, a chat, a feed — ask yourself: what will the user actually be able to DO with this when they open it? Build that. Completely. Not the skeleton of it. Not the visual representation of it. The working thing itself.

If you are about to write a handler that only toggles a boolean — stop. What should actually happen when this is triggered? Build that instead.
If you are about to hardcode data — stop. Where should this data come from and where should it be stored? Build that instead.
If you are about to write "simulates an API call" — stop. Make the real API route and call it.
If the feature needs a real browser API (Audio, Video, WebSocket, MediaRecorder, Canvas, SpeechRecognition) — use it. Directly. Not a mock of it.

When you finish, explain what you built in terms of what the USER can do — not what React hooks you used. Say: "I built a video player where you can hover the timeline to see thumbnail previews of any moment in the video. I implemented real-time transcription using the Web Speech API, connected to a translation endpoint so subtitles appear in your chosen language as the video plays. To use it, press play and select your language in the top-right dropdown." That is how a real product is delivered.

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
