import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

// ─── Vercel config ─────────────────────────────────────────────────────────────
export const maxDuration = 250;
export const dynamic = "force-dynamic";

const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES   = 5;
const BASE_DELAY_MS = 1200; // 1.2s → 2.4s → 4.8s → 9.6s → 19.2s

/**
 * Détecte si une erreur est retryable (503, overloaded, rate limit…).
 * Gère les formats Anthropic (status / error.type) et Gemini (message).
 */
function isRetryable(err: any): boolean {
  // Anthropic SDK expose `status` et `error.type`
  if (err?.status === 503 || err?.status === 529 || err?.status === 529) return true;
  if (err?.status === 429) return true;  // rate limit
  const msg: string = (err?.message ?? err?.error?.message ?? "").toLowerCase();
  return (
    msg.includes("overloaded") ||
    msg.includes("overload")   ||
    msg.includes("503")        ||
    msg.includes("529")        ||
    msg.includes("rate limit") ||
    msg.includes("quota")      ||
    msg.includes("too many")   ||
    msg.includes("unavailable")
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exécute l'appel IA (Anthropic ou Gemini) avec retry exponentiel.
 * `onChunk` est appelé pour chaque fragment de texte streamé.
 * Retourne `false` si tous les essais ont échoué.
 */
async function runWithRetry(opts: {
  isAnthropic: boolean;
  anthropic: Anthropic | null;
  geminiKey: string;
  modelId: string;
  systemContext: string;
  msgs: { role: "user" | "assistant"; content: string }[];
  onChunk: (text: string) => void;
  onRetry?: (attempt: number, delay: number, err: any) => void;
}): Promise<void> {
  const { isAnthropic, anthropic, geminiKey, modelId, systemContext, msgs, onChunk, onRetry } = opts;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (isAnthropic && anthropic) {
        const r = await anthropic.messages.stream({
          model: modelId,
          max_tokens: 900,
          system: systemContext,
          messages: msgs,
        });
        for await (const chunk of r) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            onChunk(chunk.delta.text);
          }
        }
      } else {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const contents = msgs.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
        const r = await ai.models.generateContentStream({
          model: modelId,
          contents: contents as any,
          config: {
            systemInstruction: systemContext || undefined,
            temperature: 0.9,
            maxOutputTokens: 900,
          },
        });
        for await (const chunk of r) {
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (!(p as any).thought && p.text) onChunk(p.text);
          }
        }
      }
      return; // succès → on sort de la boucle
    } catch (err: any) {
      const retryable = isRetryable(err);
      const lastAttempt = attempt === MAX_RETRIES;

      if (!retryable || lastAttempt) throw err; // erreur fatale ou épuisement des essais

      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), 20000);
      onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
}

/**
 * Endpoint léger — stream UNE réponse IA pour le système de reasoning côté client.
 * Body: { question: string, conversation: {role, content}[], systemContext: string }
 */
export async function POST(req: Request) {
  try {
    const MODEL_ID    = req.headers.get("x-model-id") ?? "gemini-3-flash-preview";
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);
    const geminiKey   = req.headers.get("x-gemini-api-key")    || process.env.GEMINI_API_KEY    || "";
    const anthKey     = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthKey)   return new Response("Anthropic API key missing", { status: 401 });
    if (!isAnthropic && !geminiKey) return new Response("Gemini API key missing",   { status: 401 });

    const { question, conversation = [], systemContext = "" } = await req.json();
    if (!question) return new Response("question required", { status: 400 });

    const anthropic = isAnthropic ? new Anthropic({ apiKey: anthKey }) : null;

    const msgs: { role: "user" | "assistant"; content: string }[] = [
      ...conversation.map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: String(m.content),
      })),
      { role: "user", content: question },
    ];

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (t: string) => controller.enqueue(new TextEncoder().encode(t));

        try {
          await runWithRetry({
            isAnthropic,
            anthropic,
            geminiKey,
            modelId: MODEL_ID,
            systemContext,
            msgs,
            onChunk: (text) => emit(text),
            onRetry: (attempt, delay, err) => {
              // On informe le client du retry via un marqueur filtrable
              const errMsg = (err?.message ?? "overloaded").slice(0, 80);
              emit(`[RETRY:${attempt}/${MAX_RETRIES}] Modèle surchargé (${errMsg}) — nouvel essai dans ${Math.round(delay / 1000)}s…\n`);
            },
          });
        } catch (err: any) {
          // Tous les retries épuisés ou erreur non-retryable
          emit(`[REASONING_ERROR] ${err?.message ?? "Erreur inconnue"}`);
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type":    "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "Cache-Control":   "no-cache, no-transform",
        "Connection":      "keep-alive",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

