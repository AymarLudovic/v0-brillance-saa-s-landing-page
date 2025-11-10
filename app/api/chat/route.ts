import { GoogleGenAI, Content } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const tools = [
  { googleSearch: {} },
];
const config = {
  thinkingConfig: { thinkingBudget: -1 },
  tools,
};
const model = 'gemini-2.5-flash';

export async function POST(req: NextRequest) {
  try {
    const { history, currentMessage } = await req.json() as { history: Content[], currentMessage: string };

    if (!currentMessage) {
      return NextResponse.json({ error: 'Message manquant.' }, { status: 400 });
    }

    // 🛑 Instruction Système CLÉ : Rôle strict pour la génération d'applications
    const systemInstruction: Content = {
        role: "system",
        parts: [{ 
            text: `Tu es un développeur Full-stack AI expert en Next.js. Ta mission est de générer des fichiers React/TypeScript et CSS de qualité. 
            Ton objectif est de créer des structures de VRAIES PAGES D'APPLICATION (Settings, Dashboard, etc.) en t'inspirant uniquement du style (couleurs, polices, ombres) des références fournies par l'utilisateur, mais en utilisant une architecture de logiciel moderne et sémantique.
            
            RÈGLES DE SORTIE:
            1. RÉPOND UNIQUEMENT avec le code des fichiers que tu veux créer/modifier, en utilisant le format Markdown.
            2. Chaque bloc de code doit être suivi d'un commentaire indiquant le chemin du fichier affecté : // Path: app/mon-composant.tsx
            3. Si tu dois corriger une erreur (ex: après un log E2B), tu dois donner le code corrigé d'abord, puis t'excuser brièvement.`
        }]
    };
    
    const contents: Content[] = [
        systemInstruction, 
        ...history, 
        { role: "user", parts: [{ text: currentMessage }] }
    ];

    const response = await ai.models.generateContent({
      model,
      config,
      contents,
    });
    
    const generatedResponse = response.text; 

    return NextResponse.json({ generatedResponse });

  } catch (error) {
    console.error('Erreur lors de la génération IA:', error);
    return NextResponse.json({ error: 'Échec de la génération par l\'IA.' }, { status: 500 });
  }
  }
