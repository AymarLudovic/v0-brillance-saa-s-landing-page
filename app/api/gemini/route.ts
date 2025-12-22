import { NextResponse } from "next/server";
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";

// Déclaration de l'outil de lecture de fichier (gardé pour la cohérence du projet)
const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier existant pour analyse ou modification.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

export async function POST(req: Request) {
  try {
    // Gestion flexible de la clé API (Header ou Env)
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    // Configuration avec Thinking Level HIGH et Google Search pour les standards actuels
    const model = "gemini-3-flash-preview"; 
    const config = {
      thinkingConfig: { thinkingLevel: 'HIGH' },
      tools: [{ googleSearch: {} }, { functionDeclarations: [readFileDeclaration] }],
      systemInstruction: `
### PROTOCOLE QUANTUM ARCHITECT : PRODUCTION LOGICIELLE SOUVERAINE
Tu es l'unité de production logicielle finale. Ton objectif est la création de systèmes complets, complexes et 100% fonctionnels.

1. ANALYSE CRITIQUE : Avant de coder, analyse les standards du marché (ex: Shopify, Discord). Ton produit doit être indiscernable de ces leaders en termes de fonctionnalités et de profondeur algorithmique.
2. ZÉRO PLACEHOLDER : Chaque bouton, menu et formulaire doit fonctionner. Si une page "Paramètres" est mentionnée, elle doit être générée avec sa logique de persistence.
3. ARCHITECTURE : Utilise le pattern Service Layer. Sépare la vue de la logique. Utilise IndexedDB pour une persistence réelle des données côté client.
4. SÉCURITÉ & ROBUSTESSE : Implémente des validations strictes, une gestion d'authentification robuste (même simulée en local) et une gestion d'erreurs via notifications (Toasts).
5. DESIGN PIXEL PERFECT : N'Utilise pas Tailwind CSS et Framer Motion mais directement des classes CSS défini dans le fichier global de style pour absolument chaque élément et des animations créé par toi même pour une interface fluide, réactive et haut de gamme.

### RÈGLES D'ÉCRITURE DES FICHIERS
Pour toute création ou modification de fichier, tu DOIS utiliser strictement la balise XML suivante, sans aucun bloc de code Markdown :

<create_file path="chemin/du/fichier.ext">
contenu du code ici
</create_file>

Ne commente pas ton code avec des "ajoutez la logique ici". ÉCRIS LA LOGIQUE.
`.trim(),
    };

    // Préparation des contenus (History + Current inputs)
    const contents: any[] = history.map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Ajout des images et fichiers récents au dernier message si présents
    if (uploadedImages?.length > 0 || uploadedFiles?.length > 0) {
      const lastParts = contents[contents.length - 1].parts;
      uploadedImages?.forEach((img: string) => {
        lastParts.push({ inlineData: { data: img.split(',')[1], mimeType: 'image/jpeg' } });
      });
      uploadedFiles?.forEach((file: any) => {
        lastParts.push({ inlineData: { data: file.base64Content, mimeType: 'text/plain' } });
      });
    }

    const responseStream = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of responseStream) {
          if (chunk.text) {
            controller.enqueue(encoder.encode(chunk.text));
          }
        }
        controller.close();
      },
    });

    return new Response(stream, { 
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    console.error("Gemini API Error:", err);
    return NextResponse.json({ error: "Erreur Serveur: " + err.message }, { status: 500 });
  }
      }
