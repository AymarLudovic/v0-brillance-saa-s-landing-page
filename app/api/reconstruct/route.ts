import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // On reçoit l'image ET les données JSON scannées précédemment
    const { imageBase64, scannedElements } = await req.json();

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const modelId = 'gemini-2.5-flash';

    const promptText = `
      Tu es un Architecte Frontend "Wireframe".
      Ton but : Générer un fichier HTML unique qui reconstruit EXACTEMENT la page fournie, en te basant sur l'image et les données scannées.

      STYLE VISUEL STRICT (WIREFRAME) :
      - Fond de page : BLANC (#FFFFFF).
      - Tous les éléments : Fond BLANC, Bordure NOIRE fine (1px solid #000).
      - Texte : NOIR (#000), police monospace simple.
      - Icônes/Images : Remplacer par des carrés/cercles vides avec bordure noire.
      - AUCUNE COULEUR, AUCUN OMBRAGE. Juste la structure pure.

      RÈGLES TECHNIQUES :
      1. Utilise 'position: absolute' pour placer les éléments. C'est CRUCIAL pour respecter la fidélité.
      2. Base-toi sur les coordonnées 'box_2d' [ymin, xmin, ymax, xmax] (échelle 0-1000) fournies dans le JSON ci-dessous pour calculer les pourcentages (top%, left%, width%, height%).
      3. Génère un code HTML complet (<html><body>...</body></html>) prêt à être affiché dans une iframe.
      4. Si c'est un texte, insère le vrai texte. Si c'est un conteneur, mets juste la bordure.

      DONNÉES SCANNÉES :
      ${JSON.stringify(scannedElements).substring(0, 10000)} // On tronque si trop long pour éviter les limites
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

    const candidate = response.candidates?.[0];
    const textResponse = candidate?.content?.parts?.[0]?.text;

    if (!textResponse) throw new Error("Génération HTML échouée");

    // Nettoyage pour ne garder que le HTML
    const cleanHtml = textResponse.replace(/```html/g, '').replace(/```/g, '');

    return NextResponse.json({ html: cleanHtml });

  } catch (error: any) {
    console.error("Reconstruct Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
        }
