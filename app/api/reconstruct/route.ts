import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { imageBase64, scannedElements } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const promptText = `
      Génère le code HTML Wireframe (Noir/Blanc, position: absolute) pour reconstruire cette page.
      Renvoie UNIQUEMENT le HTML brut.
      
      DATA: ${JSON.stringify(scannedElements).substring(0, 15000)}
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
