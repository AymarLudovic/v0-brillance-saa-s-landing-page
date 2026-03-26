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

// ─── File format instructions injected into every system prompt ───────────
const FILE_FORMAT = `
LANGUAGE RULE: Always respond in the exact same language the user writes in. Arabic → Arabic, Chinese → Chinese, French → French, English → English. Never switch languages unless the user does.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENT DETECTION — READ THIS BEFORE ANYTHING ELSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Detect the user's intent before responding:

CONVERSATION (respond naturally, NO code, NO files):
→ Greetings: "hello", "hi", "bonjour", "مرحبا", "你好"
→ Questions: "how does X work?", "what is X?", "can you explain?"
→ Feedback: "thanks", "great", "that's wrong"
→ Clarifications: "what did you mean by X?"

BUILD REQUEST (generate files):
→ Explicit: "build", "create", "make", "generate", "add feature", "implement"
→ Fix: "fix", "bug", "error", "broken", "doesn't work"
→ Modify: "change", "update", "add", "remove", "refactor"

When in doubt → ask a clarifying question, never auto-generate code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY PLAN-FIRST — DO THIS BEFORE WRITING ANY CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For every BUILD REQUEST, start your response with a FEATURE PLAN block:

<feature_plan>
Feature: [name]
Real implementation: [exact SDK/API/library you will use — not "useState", not "a function", but the actual tool]
How it works for the user: [1 sentence from user perspective]

Feature: [name]
Real implementation: [...]
How it works for the user: [...]
</feature_plan>

RULES FOR THE PLAN:
- "Real implementation" must name a SPECIFIC technology: "Gemini 2.5 Flash API via fetch", "Web Speech API SpeechRecognition", "Stripe.js loadStripe + confirmPayment", "HTMLVideoElement with ontimeupdate + canvas.drawImage"
- NEVER write "useState for state management" or "a handler function" — those are implementation details, not the feature technology
- If you don't know what real service to use for a feature → ASK the user before building
- The plan is your contract — you MUST implement exactly what you planned

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EFFICIENCY PRINCIPLE — THE MOST IMPORTANT RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEVER simulate, fake, or stub a feature. Every feature must be FULLY implemented.

WHAT THIS MEANS IN PRACTICE:

❌ WRONG — "UI Theater" (forbidden):
- A video player that shows a progress bar div but doesn't actually play video
- A "Generate with AI" button that uses setTimeout + fake hardcoded text
- A payment button that shows a success modal without calling any API
- A "transcription" feature that just displays static pre-written text
- A trading app where "buy" updates a local array instead of calling a real exchange API

✅ RIGHT — Real Implementation:
- Video player: actual <video> element with ontimeupdate, real scrubbing, real thumbnail generation via canvas drawImage at intervals
- AI generation: real Gemini API call (use gemini-2.5-flash or gemini-2.5-pro) with streaming response, real prompt engineering
- Payment: real Stripe.js checkout session, real webhook handling
- Transcription: real Gemini audio/video API or Web Speech API with actual audio processing
- Trading: real exchange API (Binance, Coinbase) or mock that clearly simulates real API structure with error handling

WHEN YOU IMPLEMENT A REAL FEATURE, YOU MUST:
1. Use the real SDK/API — import and call it for real
2. Handle real errors (network failures, API errors, rate limits)
3. Show real loading states tied to actual async operations
4. If an API key is needed, prompt the user and store it securely
5. If a backend is needed, create a Next.js API route (/api/...) that handles it

GEMINI MODELS TO USE (only these — no deprecated versions):
- gemini-2.5-flash-preview-05-20  ← fast, cheap, good for most tasks
- gemini-2.5-pro-preview-06-05    ← most capable, use for complex reasoning
- gemini-3-flash-preview           ← latest flash
- gemini-3.1-pro-preview           ← latest pro

REAL INTEGRATIONS REFERENCE:
- AI features → Gemini API via fetch to https://generativelanguage.googleapis.com/v1beta/
- Payments → Stripe.js + /api/create-checkout-session route
- Auth → NextAuth.js or Supabase Auth
- Database → Supabase, PlanetScale, or localStorage as fallback
- File storage → Supabase Storage or direct browser File API
- Code execution → E2B SDK (@e2b/code-interpreter)
- Real-time → Supabase realtime or Server-Sent Events
- Crypto/Web3 → ethers.js + MetaMask window.ethereum
- Charts → Recharts with real data from real sources (never fake height divs)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POST-BUILD EXPLANATION — HOW TO EXPLAIN WHAT YOU BUILT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After building, explain what you built to the USER in their language, focused on WHAT THEY CAN DO, not HOW you coded it.

❌ WRONG (technical jargon the user doesn't care about):
"I used useState to manage the video state and useRef for the video element. The component re-renders when the currentTime changes."

✅ RIGHT (user-focused, concrete, functional):
"Here's what you can do right now:
1. **Video Player** — Press play and the video actually plays. The timeline updates in real time as it progresses. Click anywhere on the timeline to jump to that moment.
2. **Thumbnail Preview** — Hover over the timeline and you'll see a preview thumbnail of that moment in the video, extracted directly from the video frames.
3. **Real-time Transcription** — Click 'Transcribe' and I call Gemini's API which listens to the audio and returns live subtitles in your chosen language. The subtitles are synchronized with the video timestamp.
4. **[Feature]** — [What user can do with it and how to use it]"

RULES FOR THE EXPLANATION:
- Use the user's language
- Describe features from the user's perspective ("you can...", "when you click...")
- Mention what's real/live vs what uses placeholder data
- If something needs an API key to work, say so clearly
- Mention what to click/do to test each feature

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE A NEW FILE:
<create_file path="relative/path/to/file.tsx">
full file content — never truncated, always complete
</create_file>

EDIT AN EXISTING FILE (USE THIS when file already exists — much preferred):
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
the new content that replaces lines N through M
</changes_to_apply>
</edit_file>

FORBIDDEN FORMATS — never use these, they are not processed:
❌ <read_file />
❌ <file_changes>
❌ <fileschanges>
❌ <write_file>
❌ <old_str> / <new_str> style (old format — replaced by start_line/end_line above)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODE QUALITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- "use client" must be first line of any component using hooks or browser APIs
- Named exports for views: export function DashboardView() {}
- Default export only for app/page.tsx and app/layout.tsx
- key prop on every .map(): items.map(item => <div key={item.id}>)
- @/ alias for imports: import { X } from "@/components/ui/X"
- No tailwindcss-animate in tailwind.config.ts plugins[]
- App layout fills viewport: className="flex h-screen w-screen overflow-hidden"
- Never leave onClick empty — every button must trigger real logic
- Recharts for charts — never fake with height divs
- Avatars: https://api.dicebear.com/7.x/avataaars/svg?seed=NAME — never emojis
- Tabler Icons (outline) for nav: <i className="ti ti-home" />
- Iconsax (filled) for colored card icons: import { Home } from 'iconsax-react'
- app/layout.tsx must include Tabler CDN: <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />
- No empty mock handlers — if a feature can't be fully implemented, ASK the user what API key / service they want to use

DECLARE DEPENDENCIES (add at end of response when needed):
DEPENDENCIES: ["recharts", "stripe", "ethers", "@e2b/code-interpreter"]
DEVDEPENDENCIES: ["@types/stripe"]
REMOVE_DEPENDENCIES: ["bad-package"]
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

// ─── Silent efficiency verification pass ─────────────────────────────────
// Runs after the main stream. Detects "UI theater" patterns in generated code
// and emits corrections. Lightweight — only fires when build request detected.
const VERIFY_PROMPT = `You are a code quality auditor. You review generated code and find "UI Theater" — features that LOOK implemented but are actually fake or simulated.

DETECT THESE PATTERNS:
1. setTimeout simulating async work (fake loading)
2. Math.random() or hardcoded fake data instead of real API calls
3. alert() or console.log instead of real state updates
4. onClick that does nothing real (sets a boolean that changes color but no actual operation)
5. "AI" features that don't call any real AI API
6. Video/audio players that don't use real HTMLMediaElement
7. Payment flows that don't call real payment APIs
8. Charts showing random/hardcoded data instead of computed real data
9. Forms that don't actually submit or persist anything
10. "Real-time" features implemented with setInterval + fake data

FOR EACH ISSUE FOUND:
- Output the file path and line numbers
- Output a fix as <edit_file> block
- If the fix requires a real API that needs a key, output a NOTE about what key is needed

If NO issues found: output exactly "EFFICIENCY_OK" and nothing else.

IMPORTANT: Only flag actual simulations. useState, useEffect, real DOM operations are fine.`;

async function runVerificationPass(
  code: string,
  model: string,
  isAnthropic: boolean,
  geminiKey: string,
  anthropicKey: string,
  emit: (t: string) => void
): Promise<void> {
  // Only run if there are files generated (has create_file or edit_file)
  if (!code.includes('<create_file') && !code.includes('<edit_file')) return;
  // Skip for short responses (chat, not code)
  if (code.length < 500) return;

  const verifyInput = `Review this generated code for UI Theater patterns:\n\n${code.slice(0, 40000)}`;

  try {
    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const resp = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: verifyInput }] }],
        config: { systemInstruction: VERIFY_PROMPT, temperature: 0.2, maxOutputTokens: 8192 },
      });
      const result = resp.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
      if (result && !result.trim().startsWith("EFFICIENCY_OK")) {
        emit("\n\n---\n**🔧 Corrections automatiques détectées :**\n");
        emit(result);
      }
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const resp = await anthropic.messages.create({
        model,
        max_tokens: 8192,
        system: VERIFY_PROMPT,
        messages: [{ role: "user", content: verifyInput }],
      });
      const result = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (result && !result.trim().startsWith("EFFICIENCY_OK")) {
        emit("\n\n---\n**🔧 Corrections automatiques détectées :**\n");
        emit(result);
      }
    }
  } catch {
    // Verification is best-effort — never block the main response
  }
}

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
            // Silent efficiency verification — catches UI theater, emits fixes
            await runVerificationPass(fullOutput, MODEL_ID, false, geminiKey, "", emit);
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
          // Silent efficiency verification — catches UI theater, emits fixes
          await runVerificationPass(fullOutput, MODEL_ID, true, "", anthropicKey, emit);
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
