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
<edit_file path="relative/path/to/file.tsx">
<old_str>the exact existing string to replace — must match the file content character for character, must be unique in the file</old_str>
<new_str>the new replacement string</new_str>
</edit_file>

IMPORTANT ABOUT edit_file:
- The old_str MUST be copied exactly from the file content shown below (with line numbers)
- Do NOT include line number prefixes in old_str (those are just for reference)
- If you need to make multiple changes to the same file, use multiple <edit_file> blocks
- Prefer edit_file over create_file when the file already exists — do not rewrite entire files for small changes
- old_str must be unique within the file — include enough context (2-3 surrounding lines) to make it unique

ABOUT WHAT TRULY MATTERS TO THE USER:
Think about why someone is using you to build an app. They're not here for a pretty interface — they're here because they have a real problem to solve, a real workflow to automate, or a real idea to bring to life. When you build something that only looks good but doesn't actually work, you've wasted their time and broken their trust. A beautiful shell with no engine is worse than a plain app that genuinely functions, because at least the plain one delivers value.

When a user sends you an image, their intent is almost never "copy this visually." They're showing you a direction, a vibe, a layout idea. But what they actually need is a working product. The image is context, not the goal. Don't let it hypnotize you into focusing only on colors and spacing while forgetting that every button should do something real, every form should actually submit data, every list should load and update correctly.

Mock data and simulated states are a trap. They create the illusion of a working app during development, but the user will hit a wall the moment they try to actually use it. If data needs to be stored, store it — in localStorage, in a database, in zustand. If an action needs to happen, make it happen. The user will feel the difference between something that works and something that pretends to work, and that difference is everything.

Your job is not to make demos. Your job is to build real tools that real people can use right now. That means real logic, real state, real persistence, real interactions. Every feature you implement should leave the user with something they can actually rely on. That's what makes the difference between an AI that impresses and an AI that genuinely helps.

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
