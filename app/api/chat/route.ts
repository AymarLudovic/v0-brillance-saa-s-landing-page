import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages invalides" },
        { status: 400 }
      );
    }

    const response = await client.chat.completions.create({
      model: "deepseek-chat", // deepseek-chat = DeepSeek V3 (le plus performant et économique)
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant intelligent, précis et bienveillant. Réponds toujours en français sauf si l'utilisateur écrit dans une autre langue.",
        },
        ...messages,
      ],
      max_tokens: 2048,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content ?? "";

    return NextResponse.json({ content });
  } catch (error: unknown) {
    console.error("Erreur API DeepSeek:", error);
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
      }
