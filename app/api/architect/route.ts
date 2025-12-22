import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// ⚠️ IMPORTANT: Le nom de la fonction doit être POST
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });
    }

    const body = await req.json();
    const { history, allReferenceImages } = body;

    const ai = new GoogleGenAI(apiKey);
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Ton instruction système pour forcer le format XML
    const systemPrompt = "Tu es un architecte. Réponds UNIQUEMENT avec ce format: Explication ||| <plan><task id='1' path='fichier.js'>Action</task></plan>";

    const result = await model.generateContentStream({
      contents: history.map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // On peut aussi passer l'instruction ici selon la version du SDK
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of result.stream) {
          controller.enqueue(encoder.encode(chunk.text()));
        }
        controller.close();
      },
    });

    return new NextResponse(stream);

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
      }
