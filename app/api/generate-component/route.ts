import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

// 🛑 CLÉ: Utilisation de la variable d'environnement pour la sécurité
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const tools = [
  {
    googleSearch: {}
  },
];

const config = {
  // Configuration basée sur votre code original
  thinkingConfig: {
    thinkingBudget: -1,
  },
  imageConfig: {
    imageSize: '1K',
  },
  tools,
};
const model = 'gemini-2.5-flash';

/**
 * Gère les requêtes POST du frontend pour générer du code avec l'IA.
 * L'URL d'appel sera /api/generate-component
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Récupération du prompt structuré envoyé par le frontend
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Le prompt est manquant dans la requête.' }, { status: 400 });
    }

    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: prompt, // Le prompt structuré (Référence HTML/CSS + Instruction)
          },
        ],
      },
    ];

    // 2. Appel à l'API Gemini
    const response = await ai.models.generateContent({
      model,
      config,
      contents,
    });
    
    // Le texte brut généré par Gemini
    const generatedCode = response.text; 

    // 3. Retourne le résultat au client
    return NextResponse.json({ generatedCode });

  } catch (error) {
    console.error('Erreur lors de la génération IA:', error);
    return NextResponse.json({ error: 'Échec de la génération par l\'IA.' }, { status: 500 });
  }
}
