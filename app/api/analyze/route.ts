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
      Agis comme un moteur de "Reverse Engineering" UI.
      Je veux une analyse structurelle COMPLÈTE de cette interface.
      
      RÈGLES STRICTES :
      1. Découpe l'interface en deux catégories :
         - "layout": Sidebar, Navbar, Header, Main Container, Cards.
         - "element": Boutons, Inputs, Textes, Icônes, Charts.
      
      2. Pour chaque élément, estime sa position. Même si c'est approximatif, le client corrigera les pixels.
      
      3. Format JSON attendu :
      {
        "elements": [
          {
            "id": "unique_id",
            "category": "layout" ou "element",
            "type": "sidebar | button | text | card | chart | input",
            "label": "Nom de l'élément",
            "box_2d": [ymin, xmin, ymax, xmax] (Échelle 0-1000)
          }
        ]
      }
      
      IMPORTANT : N'oublie AUCUN texte, même petit. Délimite bien la Sidebar et la Topbar.
    `;

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

    // Extraction manuelle robuste
    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    let textResponse = part?.text;

    if (!textResponse) throw new Error("Réponse vide de l'IA");

    // Nettoyage JSON
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
    const firstBrace = textResponse.indexOf('{');
    const lastBrace = textResponse.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
       throw new Error("Format JSON invalide");
    }

    const cleanJson = textResponse.substring(firstBrace, lastBrace + 1);
    const parsedData = JSON.parse(cleanJson);

    return NextResponse.json(parsedData);

  } catch (error: any) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: error.message || "Erreur interne" }, 
      { status: 500 }
    );
  }
      }
