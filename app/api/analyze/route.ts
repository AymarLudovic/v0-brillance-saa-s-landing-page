import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const modelId = 'gemini-2.5-flash'; 

    const promptText = `
      Tu es un scanner UI de précision industrielle.
      Tâche : Extraire TOUS les éléments visuels de cette interface.
      
      RÈGLES DE DÉTECTION :
      1. Ne rate RIEN : Détecte chaque icône, chaque petit texte, chaque ligne de séparation, chaque bouton.
      2. Structure : Identifie les conteneurs (Sidebar, Header, Cards) ET leur contenu.
      3. Précision : Les boîtes doivent être serrées sur le contenu visible.
      
      FORMAT DE SORTIE (JSON PUR UNIQUEMENT) :
      {
        "elements": [
          {
            "id": "uuid",
            "type": "container | text | button | icon | input | divider | image",
            "content": "Texte lu ou description brève",
            "box_2d": [ymin, xmin, ymax, xmax] (Normalisé 0-1000)
          }
        ]
      }
      IMPORTANT : Ne mets PAS de balises markdown (\`\`\`json). Renvoie juste le JSON brut.
    `;

    // 1. On demande un STREAM à Gemini
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

    // 2. On transfère ce stream directement à Vercel
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

    // 3. On renvoie la réponse streamée
    return new NextResponse(stream, {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Analyze Error:", error);
    return NextResponse.json({ error: error.message || "Erreur interne" }, { status: 500 });
  }
}
