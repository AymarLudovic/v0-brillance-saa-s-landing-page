// app/api/gemini/route.ts
import { NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"
import { basePrompt } from "@/lib/prompt" // instructions globales

export async function POST(req: Request) {
  try {
    const { message } = await req.json()

    if (!message) {
      return NextResponse.json({ error: "Message manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash" // ou "gemini-pro" si tu préfères un modèle plus grand

    // Le `basePrompt` contient déjà les instructions pour les deux phases.
    // L'IA recevra TOUJOURS le même prompt global et décidera de sa réponse.
    // Le client sera responsable de PARSER cette réponse.
    const contents = [
      {
        role: "user",
        // Nous fusionnons le basePrompt et le message de l'utilisateur.
        // C'est au modèle de décider de son comportement basé sur le basePrompt.
        // Le client saura détecter si c'est une URL ou un tableau de fichiers.
        parts: [{ text: basePrompt + "\n\n" + message }],
      },
    ]

    const response = await ai.models.generateContentStream({
      model,
      contents,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (chunk.text) {
              controller.enqueue(encoder.encode(chunk.text))
            }
          }
        } catch (err) {
          console.error("[API Gemini] Erreur de streaming:", err)
          controller.enqueue(encoder.encode(`[Stream error: ${(err as Error).message}]`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (err: any) {
    console.error("[API Gemini] Erreur globale:", err)
    return NextResponse.json({ error: err.message || "Erreur Gemini" }, { status: 500 })
  }
}
