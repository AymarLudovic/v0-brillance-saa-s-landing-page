// app/api/gemini/route.ts
import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt" // instructions globales

// Fonction utilitaire pour extraire le mime type de l'URL Base64
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'image/jpeg';
}

// Fonction utilitaire pour nettoyer l'URL Base64
function cleanBase64Data(dataUrl: string): string {
    return dataUrl.split(',')[1];
}

export async function POST(req: Request) {
  try {
    // 🛑 MISE À JOUR : Récupération des images uploadées
    const { message, uploadedImages } = await req.json() as { message: string, uploadedImages: string[] }

    if (!message) {
      return NextResponse.json({ error: "Message manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"

    // 🛑 MISE À JOUR : Construction du tableau 'contents'
    // 1. Initialiser le tableau des parties (pour le user)
    const userParts: Part[] = []

    // 2. Ajouter les images (s'il y en a)
    if (uploadedImages && uploadedImages.length > 0) {
        uploadedImages.forEach((dataUrl) => {
            userParts.push({
                inlineData: {
                    data: cleanBase64Data(dataUrl),
                    mimeType: getMimeTypeFromBase64(dataUrl),
                },
            });
        });
    }

    // 3. Ajouter le prompt texte (instructions globales + message utilisateur)
    const fullPrompt = basePrompt + "\n\n" + message
    userParts.push({ text: fullPrompt });

    // 4. Construire la requête contents
    const contents = [{
        role: "user",
        parts: userParts,
    }];

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
                               
