import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60; // On demande 60s, le streaming aide à les obtenir

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const modelId = 'gemini-2.5-flash';

    const promptText = `
      Tu es un scanner UI.
      Extrais TOUS les éléments (Sidebar, Header, Buttons, Text, Inputs).
      Sois précis sur les boîtes (box_2d).
      
      FORMAT JSON STRICT :
      {
        "elements": [
          {
            "id": "uuid",
            "type": "container | text | button | icon",
            "box_2d": [ymin, xmin, ymax, xmax] (0-1000)
          }
        ]
      }
      Ne mets PAS de markdown. Juste le JSON brut.
    `;

    // 1. ON LANCE LE STREAM
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

    // 2. ON CRÉE UN "READABLE STREAM" POUR VERCEL
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of responseStream.stream) {
            const text = chunk.text();
            if (text) {
              // On envoie chaque morceau de texte dès qu'il arrive
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    // 3. ON RENVOIE LA RÉPONSE EN FLUX CONTINU
    return new NextResponse(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error: any) {
    console.error("Stream Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
            }
