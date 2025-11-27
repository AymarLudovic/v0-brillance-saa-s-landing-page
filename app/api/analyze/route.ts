import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// Configuration pour Vercel (Timeouts longs car le modèle réfléchit)
export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    // 1. Initialisation avec la nouvelle SDK @google/genai
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // 2. Configuration du "Thinking" Process
    const config = {
      thinkingConfig: {
        thinkingLevel: 'HIGH', // Le modèle prend le temps de réfléchir
      },
    };

    // Note: Utilise le modèle disponible. Si 'gemini-3' est en preview privée, 
    // utilise 'gemini-2.0-flash-thinking-exp' qui est très puissant pour ça.
    const modelId = 'gemini-3.0-pro'; 

    // 3. Prompt de Vision Technique
    const promptText = `
      Analyse cette interface utilisateur (UI) avec une précision d'ingénieur.
      Je veux extraire les coordonnées EXACTES de chaque élément (Boutons, Inputs, Images, Cartes).
      
      RÈGLES STRICTES :
      1. Retourne UNIQUEMENT un objet JSON valide. Pas de markdown, pas de texte avant/après.
      2. La structure doit être :
      {
        "elements": [
          {
            "id": "unique_id",
            "type": "button | input | card | text | image",
            "label": "Texte visible ou description courte",
            "box_2d": [ymin, xmin, ymax, xmax] (Coordonnées normalisées entre 0 et 1000)
          }
        ]
      }
      3. Sois pixel-perfect sur les bordures.
    `;

    // 4. Appel au modèle (non-streaming pour simplifier le parsing JSON final)
    const response = await ai.models.generateContent({
      model: modelId,
      config: config,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            { 
              inlineData: { 
                mimeType: 'image/png', 
                data: imageBase64.split(',')[1] // On enlève le header data:image/...
              } 
            },
          ],
        },
      ],
    });

    // 5. Extraction et Nettoyage du JSON
    // Les modèles Thinking peuvent inclure leurs pensées dans la réponse textuelle
    // On cherche le bloc JSON pur.
    const textResponse = response.text();
    
    // Regex pour trouver le JSON même s'il y a du texte autour
    const jsonMatch = textResponse?.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error("Aucun JSON valide trouvé dans la réponse de l'IA");
    }

    const parsedData = JSON.parse(jsonMatch[0]);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
