import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// On maximise le temps d'exécution autorisé
export const maxDuration = 60; 
export const dynamic = 'force-dynamic'; // Force le mode dynamique pour éviter les erreurs de cache 405

export async function POST(req: Request) {
  try {
    // Lecture du corps de la requête
    const body = await req.json();
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "Image manquante" }, { status: 400 });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const modelId = 'gemini-2.5-flash';

    const promptText = `
      Tu es un scanner UI de précision absolue.
      Analyse cette image. Extrais TOUS les éléments (Sidebar, Header, Buttons, Text, Inputs).
      Sois précis sur les boîtes (box_2d).
      
      FORMAT JSON STRICT (Sans Markdown) :
      {
        "elements": [
          {
            "id": "uuid",
            "type": "container | text | button | icon | input",
            "box_2d": [ymin, xmin, ymax, xmax]
          }
        ]
      }
    `;

    // Appel en Streaming pour la vitesse
    const responseStream = await ai.models.generateContentStream({
      model: modelId,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            { inlineData: { mimeType: 'image/png', data: imageBase64.split(',')[1] } },
          ],
        },
      ],
    });

    // Création du flux de réponse pour Next.js
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of responseStream.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      headers: { 
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache' 
      },
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
                     }
