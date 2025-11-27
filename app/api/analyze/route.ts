import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

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
    `;

    // Appel à l'IA
    const response = await ai.models.generateContent({
      model: modelId,
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

    // --- CORRECTION DU BUG ---
    // Au lieu de response.text(), on va chercher le texte manuellement
    // La structure brute est toujours : candidates -> content -> parts -> text
    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    let textResponse = part?.text;

    if (!textResponse) {
       console.error("Structure reçue:", JSON.stringify(response, null, 2));
       throw new Error("L'IA a répondu vide ou la structure est inconnue.");
    }

    // --- NETTOYAGE (Même logique qu'avant) ---
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
    
    const firstBrace = textResponse.indexOf('{');
    const lastBrace = textResponse.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
       throw new Error(`Pas de JSON trouvé. Réponse brute: ${textResponse.substring(0, 100)}...`);
    }

    const cleanJson = textResponse.substring(firstBrace, lastBrace + 1);
    const parsedData = JSON.parse(cleanJson);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Server Error Detailed:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne" }, 
      { status: 500 }
    );
  }
             }
