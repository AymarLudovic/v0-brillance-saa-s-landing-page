import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { imageBase64, scannedElements } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const promptText = `
      Génère le code HTML Wireframe (Noir et Blanc, position: absolute) pour reconstruire cette page.
      Utilise les données scannées ci-dessous.
      Renvoie UNIQUEMENT le code HTML. Pas de balises markdown.
      
      DATA: ${JSON.stringify(scannedElements).substring(0, 5000)}
    `;

    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
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

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of responseStream.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      },
    });

    return new NextResponse(stream, { headers: { 'Content-Type': 'text/html' } });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
                                       }
