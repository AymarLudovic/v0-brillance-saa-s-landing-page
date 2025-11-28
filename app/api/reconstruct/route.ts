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
      Tu es un Architecte Frontend "Wireframe".
      Ton but : Générer un fichier HTML unique qui reconstruit EXACTEMENT la page.
      
      STYLE VISUEL STRICT (WIREFRAME) :
      - Fond de page : BLANC (#FFFFFF).
      - Tous les éléments : Fond BLANC, Bordure NOIRE fine (1px solid #000).
      - Texte : NOIR (#000), police monospace simple.
      - Utilise 'position: absolute' basé sur les 'box_2d' [ymin, xmin, ymax, xmax] (0-1000) fournies.
      - Si c'est un texte, mets le vrai texte.
      - Renvoie UNIQUEMENT le code HTML brut (pas de markdown).

      DONNÉES SCANNÉES :
      ${JSON.stringify(scannedElements).substring(0, 15000)}
    `;

    // Streaming pour bypasser le timeout 504
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
        try {
            for await (const chunk of responseStream.stream) {
                const text = chunk.text();
                if (text) controller.enqueue(encoder.encode(text));
            }
            controller.close();
        } catch(e) {
            controller.error(e);
        }
      },
    });

    return new NextResponse(stream, { headers: { 'Content-Type': 'text/html' } });

  } catch (error: any) {
    console.error("Reconstruct Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
                                                  }
