import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { imageBase64, scannedElements } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const model = 'gemini-2.5-flash';

    // Prompt "Architecte Wireframe" renforcé
    const promptText = `
      Tu es un Architecte Frontend expert en reconstruction Pixel-Perfect.
      Ton but : Générer un fichier HTML unique qui reconstruit EXACTEMENT la page fournie, en te basant sur l'image et les données scannées.

      STYLE VISUEL STRICT (WIREFRAME) :
      - Fond de page : BLANC (#FFFFFF).
      - Tous les éléments : Fond BLANC, Bordure NOIRE fine (1px solid #000).
      - Texte : NOIR (#000), police monospace simple (Courier/Consolas).
      - Icônes/Images : Remplacer par des carrés/cercles vides avec bordure noire diagonale.
      - AUCUNE COULEUR, AUCUN OMBRAGE. Juste la structure pure pour validation technique.

      RÈGLES TECHNIQUES :
      1. Utilise 'position: absolute' pour placer les éléments. C'est CRUCIAL pour respecter la fidélité.
      2. Base-toi sur les coordonnées 'box_2d' [ymin, xmin, ymax, xmax] (échelle 0-1000) fournies dans le JSON.
      3. Génère un code HTML complet (<html><body>...</body></html>) prêt à être affiché dans une iframe.
      4. Si c'est un texte, insère le vrai texte détecté.

      DONNÉES SCANNÉES :
      ${JSON.stringify(scannedElements).substring(0, 15000)}
    `;

    const response = await ai.models.generateContentStream({
      model,
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
          for await (const chunk of response) {
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
      headers: { 'Content-Type': 'text/html' },
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
            }
