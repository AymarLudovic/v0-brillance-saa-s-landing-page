import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Essaie Gemini 3 Pro en premier (le plus puissant, preview gratuite)
// Si quota dépassé → fallback automatique sur Gemini 2.5 Pro (free tier stable)
const PRIMARY_MODEL = "gemini-3-pro-preview";
const FALLBACK_MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT =
  "Tu es un assistant intelligent, précis et bienveillant. Réponds toujours en français sauf si l'utilisateur écrit dans une autre langue.";

async function callGemini(modelName: string, history: object[], lastContent: string) {
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = model.startChat({
    history: history as Parameters<typeof model.startChat>[0]["history"],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
  });

  const result = await chat.sendMessage(lastContent);
  return result.response.text();
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages invalides" }, { status: 400 });
    }

    // Historique au format Gemini (role: "user" | "model")
    const history = messages.slice(0, -1).map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const lastContent = messages[messages.length - 1].content;

    let content: string;
    let usedModel = PRIMARY_MODEL;

    try {
      content = await callGemini(PRIMARY_MODEL, history, lastContent);
    } catch (primaryErr) {
      console.warn(`⚠️ ${PRIMARY_MODEL} failed, falling back to ${FALLBACK_MODEL}:`, primaryErr);
      usedModel = FALLBACK_MODEL;
      content = await callGemini(FALLBACK_MODEL, history, lastContent);
    }

    return NextResponse.json({ content, model: usedModel });
  } catch (error: unknown) {
    console.error("Erreur API Gemini:", error);
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
