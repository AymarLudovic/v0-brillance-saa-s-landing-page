import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";

// ─── Vercel config ─────────────────────────────────────────────────────────────
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

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

    if (isAnthropic && !anthKey)  return new Response("Anthropic API key missing", { status: 401 });
    if (!isAnthropic && !geminiKey) return new Response("Gemini API key missing", { status: 401 });

    const { question, conversation = [], systemContext = "" } = await req.json();

    if (!question) return new Response("question required", { status: 400 });

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (t: string) =>
          controller.enqueue(new TextEncoder().encode(t));

        try {
          // Build message list: conversation history + current question
          const msgs: { role: "user" | "assistant"; content: string }[] = [
            ...conversation.map((m: any) => ({
              role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
              content: String(m.content),
            })),
            { role: "user", content: question },
          ];

          if (isAnthropic) {
            const anthropic = new Anthropic({ apiKey: anthKey });
            const r = await anthropic.messages.stream({
              model: MODEL_ID,
              max_tokens: 900,
              system: systemContext,
              messages: msgs,
            });
            for await (const chunk of r) {
              if (
                chunk.type === "content_block_delta" &&
                chunk.delta.type === "text_delta"
              ) {
                emit(chunk.delta.text);
              }
            }
          } else {
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const contents = msgs.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));
            const r = await ai.models.generateContentStream({
              model: MODEL_ID,
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
                if (!(p as any).thought && p.text) emit(p.text);
              }
            }
          }
        } catch (err: any) {
          emit(`[REASONING_ERROR] ${err.message}`);
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
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
