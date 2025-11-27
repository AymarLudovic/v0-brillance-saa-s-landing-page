import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // On reste sur Flash pour la vitesse, mais avec un prompt "Vision Laser"
    const modelId = 'gemini-2.5-flash'; 

    const promptText = `
      Tu es un scanner UI de précision industrielle.
      Tâche : Extraire TOUS les éléments visuels de cette interface pour une reconstruction Pixel-Perfect.
      
      RÈGLES DE DÉTECTION :
      1. Ne rate RIEN : Détecte chaque icône, chaque petit texte, chaque ligne de séparation (dividers), chaque bouton.
      2. Structure : Identifie les conteneurs (Sidebar, Header, Cards) ET leur contenu.
      3. Précision : Les boîtes doivent être serrées sur le contenu visible.
      
      FORMAT DE SORTIE (JSON PUR) :
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
    `;

    const response = await ai.models.generateContent({
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

    // Extraction manuelle (Méthode blindée)
    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    let textResponse = part?.text;

    if (!textResponse) throw new Error("Réponse vide de l'IA");

    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
    const firstBrace = textResponse.indexOf('{');
    const lastBrace = textResponse.lastIndexOf('}');
    
    if (firstBrace === -1) throw new Error("JSON invalide reçu");

    const cleanJson = textResponse.substring(firstBrace, lastBrace + 1);
    const parsedData = JSON.parse(cleanJson);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Analyze Error:", error);
    return NextResponse.json({ error: error.message || "Erreur interne" }, { status: 500 });
  }
}
