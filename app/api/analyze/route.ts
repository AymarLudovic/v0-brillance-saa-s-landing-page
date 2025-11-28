import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // Modèle demandé
    const model = 'gemini-2.5-flash';

    // Prompt "Vision Laser" renforcé
    const promptText = `
      Tu es un moteur de "Reverse Engineering" UI de précision industrielle.
      Tâche : Scanner cette interface pour en extraire une structure numérique EXACTE.

      RÈGLES DE DÉTECTION IMPÉRATIVES :
      1. GRANULARITÉ EXTRÊME : Ne rate AUCUN élément. Je veux chaque petite icône, chaque texte (même minuscule), chaque ligne de séparation (divider), chaque input, chaque badge.
      2. HIÉRARCHIE : Distingue les conteneurs (Sidebar, Navbar, Cards, Modal) des éléments feuilles (Boutons, Textes).
      3. PRÉCISION GÉOMÉTRIQUE : Les boîtes (box_2d) doivent coller strictement aux bords visibles de l'élément.
      
      FORMAT DE SORTIE (JSON PUR) :
      {
        "elements": [
          {
            "id": "uuid",
            "type": "container | text | button | icon | input | divider | image",
            "content": "Texte lu ou description visuelle brève",
            "box_2d": [ymin, xmin, ymax, xmax] (Échelle normalisée 0-1000)
          }
        ]
      }
      
      IMPORTANT : Renvoie UNIQUEMENT le JSON brut. Pas de markdown, pas de texte d'intro.
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
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
            }
