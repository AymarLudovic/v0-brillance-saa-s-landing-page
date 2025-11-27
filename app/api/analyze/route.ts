import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// On laisse du temps car le mode "Thinking" réfléchit pendant 10-20 secondes
export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // CONFIGURATION CRITIQUE
    // Seuls les modèles "thinking-exp" supportent ce paramètre.
    // Si tu changes le modelId, tu dois enlever ce bloc thinkingConfig.
    const config = {
      thinkingConfig: {
        thinkingLevel: 'HIGH', 
      },
    };

    // C'EST CE MODÈLE QUI EST INTELLIGENT (ET PAS UN AUTRE)
    // Ne mets pas 'gemini-1.5-flash' ici sinon ça plante avec l'erreur 400
    const modelId = 'gemini-2.0-flash-thinking-exp-01-21'; 

    const promptText = `
      Tu es un moteur d'analyse UI "Pixel Perfect".
      Analyse cette image. Je veux les coordonnées de chaque élément interactif.
      
      RÈGLES DE SORTIE :
      1. Réponds UNIQUEMENT avec un objet JSON valide.
      2. Ne mets PAS de markdown (pas de \`\`\`json).
      3. Structure obligatoire :
      {
        "elements": [
          {
            "id": "uuid",
            "type": "button | input | card | text",
            "label": "Texte court",
            "box_2d": [ymin, xmin, ymax, xmax] (Note: Coordonnées normalisées 0-1000)
          }
        ]
      }
    `;

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
                data: imageBase64.split(',')[1] 
              } 
            },
          ],
        },
      ],
    });

    // NETTOYAGE DE LA RÉPONSE (CRUCIAL POUR LES MODÈLES THINKING)
    // Le modèle peut "penser" à haute voix, on ne veut que le JSON final.
    let textResponse = response.text();
    
    // On cherche le début '{' et la fin '}' du JSON
    const firstBrace = textResponse.indexOf('{');
    const lastBrace = textResponse.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
       throw new Error("L'IA n'a pas renvoyé de JSON valide.");
    }

    // On extrait juste le JSON propre
    const cleanJson = textResponse.substring(firstBrace, lastBrace + 1);
    const parsedData = JSON.parse(cleanJson);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Server Error:", error);
    // On renvoie l'erreur en JSON pour que ton téléphone l'affiche proprement
    return NextResponse.json(
      { error: error.message || "Erreur interne du modèle" }, 
      { status: 500 }
    );
  }
                  }
