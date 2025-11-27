import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // 1. CONFIGURATION STANDARD (PAS DE THINKING)
    // On utilise le modèle Flash standard qui est rapide et gratuit
    const modelId = 'gemini-2.5-flash'; 

    const promptText = `
      Agis comme un moteur d'extraction UI technique.
      Analyse cette image d'interface. Détecte les éléments interactifs (Boutons, Inputs, Cards).
      
      RÈGLES IMPÉRATIVES :
      1. Réponds UNIQUEMENT avec un objet JSON pur. Pas de Markdown (\`\`\`json), pas de texte avant/après.
      2. Le JSON doit suivre ce format exact :
      {
        "elements": [
          {
            "id": "gen_id_1",
            "type": "button",
            "label": "Login",
            "box_2d": [ymin, xmin, ymax, xmax]
          }
        ]
      }
      3. Pour "box_2d", utilise une échelle normalisée de 0 à 1000.
      Exemple: [0, 0, 1000, 1000] couvre toute l'image.
      [0, 0, 500, 500] couvre le quart haut-gauche.
      
      Sois précis sur les bordures visuelles.
    `;

    // 2. APPEL SIMPLE
    const response = await ai.models.generateContent({
      model: modelId,
      // Pas de thinkingConfig ici -> ça résout ton erreur 400
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            { 
              inlineData: { 
                mimeType: 'image/png', 
                data: imageBase64.split(',')[1] // Nettoyage du header base64
              } 
            },
          ],
        },
      ],
    });

    // 3. EXTRACTION ROBUSTE DU JSON
    // Flash est bavard, il met souvent des ```json ... ```. On nettoie tout ça.
    let textResponse = response.text();
    
    // On enlève les balises markdown si elles existent
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
    
    // On cherche le premier '{' et le dernier '}'
    const firstBrace = textResponse.indexOf('{');
    const lastBrace = textResponse.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
       throw new Error(`Format invalide reçu de l'IA : ${textResponse.substring(0, 50)}...`);
    }

    const cleanJson = textResponse.substring(firstBrace, lastBrace + 1);
    
    // Parsing final
    const parsedData = JSON.parse(cleanJson);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json(
      { error: error.message || "Erreur de traitement interne" }, 
      { status: 500 }
    );
  }
          }
