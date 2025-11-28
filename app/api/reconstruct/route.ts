import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// Note: Sur le plan Hobby Vercel, maxDuration est souvent plafonné à 10s ou 60s max
export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64, scannedElements } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const modelId = 'gemini-2.5-flash';

    const promptText = `
      Tu es un Architecte Frontend "Wireframe".
      Ton but : Générer un fichier HTML unique qui reconstruit EXACTEMENT la page.
      
      RÈGLES IMPORTANTES :
      - NE METS PAS de balises markdown comme \`\`\`html ou \`\`\`.
      - Renvoie DIRECTEMENT le code HTML brut.
      - Utilise 'position: absolute' basé sur les box_2d fournies.
      - Fond blanc, bordures noires, style wireframe strict.
      
      DONNÉES SCANNÉES :
      ${JSON.stringify(scannedElements).substring(0, 15000)}
    `;

    // 1. On utilise generateContentStream au lieu de generateContent
    const response = await ai.models.generateContentStream({
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

    // 2. On crée un Stream pour envoyer les bouts de texte au fur et à mesure
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of response.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    // 3. On retourne la réponse en mode Stream
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error: any) {
    console.error("Reconstruct Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
            }
