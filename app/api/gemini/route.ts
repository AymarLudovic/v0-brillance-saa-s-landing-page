import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"

// --- CONFIGURATION DU PROMPT SYSTÈME (DIRECTEMENT INTÉGRÉ) ---
const FULL_PROMPT_INJECTION = `
### PROTOCOLE DE CONCEPTION : L'ARCHITECTE SUPRÊME
Tu es une unité de production logicielle autonome. Ton but est de générer des logiciels complexes, complets et 100% fonctionnels (niveau Shopify, Discord, Figma).

1. ANALYSE ET RAISONNEMENT : Utilise tes capacités de réflexion profonde pour planifier chaque module. Ne produis jamais de code "exemple".
2. EXHAUSTIVITÉ : Chaque bouton, menu et formulaire doit fonctionner. Génère toutes les pages : Coeur de métier, Paramètres, Profil, 404, et Pages Légales.
3. ARCHITECTURE : Sépare strictement la vue (UI) de la logique (Services). Utilise IndexedDB pour une persistence réelle des données côté client.
4. SÉCURITÉ : Implémente des validations de formulaires strictes, une gestion de session et une protection contre les injections.
5. FORMAT DE FICHIER (OBLIGATOIRE) : Pour chaque fichier, utilise strictement le format XML suivant, sans blocs de code Markdown :

<create_file path="nom/du/fichier.ext">
contenu du code ici
</create_file>
Les chemins du fichier ne doit jamais commencer par src.
Tu utiliseras NextJs 15 + React + Typescript, comme stack de développement.
Interdiction d'écrire du texte inutile. Produis le code immédiatement et explique avant.
 DESIGN PIXEL PERFECT : N'Utilise pas Tailwind CSS et Framer Motion mais directement des classes CSS défini dans le fichier global de style pour absolument chaque élément et des animations créé par toi même pour une interface fluide, réactive et haut de gamme.

`.trim();

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256; 

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
        allReferenceImages,
        cssMasterUrl
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        allReferenceImages?: string[],
        cssMasterUrl?: string
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    // --- INJECTION VISUELLE ---
    if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts: Part[] = [];
        allReferenceImages.forEach((imgBase64) => {
            styleParts.push({
                inlineData: {
                    data: cleanBase64Data(imgBase64),
                    mimeType: getMimeTypeFromBase64(imgBase64)
                }
            });
        });

        let instructionText = `[DIRECTIVE SYSTÈME : ANALYSE VISUELLE PIXEL-PERFECT]
Analyse ces images de référence. Reproduis-les à 100% : mêmes couleurs, espacements, arrondis, et composants. Rien ne doit être laissé au hasard.`;
        
        styleParts.push({ text: instructionText });
        contents.push({ role: 'user', parts: styleParts });
        contents.push({ role: 'model', parts: [{ text: "Compris. Analyse visuelle effectuée. Je vais reproduire ce design au pixel près." }] });
    }

    // --- HISTORIQUE ---
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        
        if (msg.role === 'system') {
            systemContextParts.push({ text: msg.content });
            continue; 
        }

        if (msg.functionResponse) {
            parts.push({ functionResponse: { name: msg.functionResponse.name, response: msg.functionResponse.response } });
        } else {
            if (i === lastUserIndex && role === 'user') {
                if (uploadedImages && uploadedImages.length > 0) {
                    uploadedImages.forEach((dataUrl) => {
                        parts.push({ inlineData: { data: cleanBase64Data(dataUrl), mimeType: getMimeTypeFromBase64(dataUrl) } });
                    });
                }
                if (uploadedFiles && uploadedFiles.length > 0) {
                     uploadedFiles.forEach((file) => {
                        parts.push({ inlineData: { data: file.base64Content, mimeType: 'text/plain' } });
                        parts.push({ text: `\n[Fichier: "${file.fileName}"]` });
                    });
                }
            }
            parts.push({ text: msg.content || ' ' }); 
        }
        if (parts.length > 0) contents.push({ role, parts });
    }

    const finalSystemInstruction = (
        FULL_PROMPT_INJECTION + 
        (systemContextParts.length > 0 ? "\n\n--- CONTEXTE PROJET ---\n" + systemContextParts.map(p => p.text).join('\n') : "")
    );
    
    // --- CONFIGURATION GEMINI AVANCÉE (THINKING + TOOLS) ---
    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [
        { googleSearch: {} }, // Activation de la recherche Google
        { functionDeclarations: [readFileDeclaration] }
      ],
      config: { 
        systemInstruction: finalSystemInstruction,
        thinkingConfig: {
          thinkingLevel: 'HIGH', // Activation du mode réflexion profonde
        }
      }
    })

    const encoder = new TextEncoder();
    let batchBuffer = ""; 
    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 
        for await (const chunk of response) {
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCall = true; 
                controller.enqueue(encoder.encode(JSON.stringify({ functionCall: chunk.functionCalls[0] })));
                break; 
            }
            if (chunk.text) {
              batchBuffer += chunk.text; 
              if (batchBuffer.length >= BATCH_SIZE) {
                controller.enqueue(encoder.encode(batchBuffer));
                batchBuffer = ""; 
              }
            }
        }
        if (!functionCall && batchBuffer.length > 0) controller.enqueue(encoder.encode(batchBuffer));
        controller.close();
      },
      async catch(error) { console.error("Stream Error:", error); }
    })

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } })
  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
  }
