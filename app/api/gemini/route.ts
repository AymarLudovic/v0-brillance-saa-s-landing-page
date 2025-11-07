// app/api/gemini/route.ts 

import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt" // <-- Votre basePrompt existant
// 🛑 NOUVEAU : Importation de la librairie de design
import { DESIGN_STYLE_LIBRARY_PROMPT as designs } from "@/lib/designlibrary"; 


// --- Déclaration du Contexte de Design pour l'IA ---
const DESIGN_CONTEXT_INSTRUCTION = `
---
**CONTEXTE DE STYLE/DESIGN : LIBRAIRIE DE THÈMES**

Les données XML ci-dessous représentent une librairie de thèmes et de styles extraits de sites Web. Tu dois utiliser ces informations comme **référence de style** lorsque l'utilisateur te demande de générer ou de modifier des composants pour correspondre à un style existant. Fais référence aux thèmes et aux sites par leurs balises correspondantes (<theme_site_X>, <site_X>).

${designs}
---
`;

const FULL_PROMPT_INJECTION = `${basePrompt}\n\n${DESIGN_CONTEXT_INSTRUCTION.trim()}`;


// --- TYPES (inchangés) ---
interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: {
        name: string;
        response: any;
    }
}
interface ProjectFile { 
    filePath: string; 
    content: string; 
}

// Utilitaires (inchangés)
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256; 

// 🛑 DÉCLARATION DE L'OUTIL readFile (inchangée) 🛑
const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet par son chemin d'accès (e.g., app/page.tsx, components/button.tsx). Doit être appelé avant de modifier ou d'analyser le contenu d'un fichier. Retourne le contenu du fichier sous forme de chaîne.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: {
        type: Type.STRING,
        description: "Le chemin d'accès complet au fichier à lire (e.g., 'app/page.tsx')."
      }
    },
    required: ["path"],
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ error: "Historique de conversation manquant" }, { status: 400 })
    }
    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: "Clé API Gemini non configurée" }, { status: 500 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; // Le dernier message de l'historique

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user'; 
        let textContent = msg.content;

        // 🛑 TRAITEMENT DES RÉPONSES D'OUTILS (Doit venir en premier si présent)
        if (msg.functionResponse) {
            parts.push({
                functionResponse: {
                    name: msg.functionResponse.name,
                    response: msg.functionResponse.response,
                }
            });
        } 
        // 🛑 TRAITEMENT DU MESSAGE UTILISATEUR/ASSISTANT (et Contexte Système)
        else {
            
            // 1. Injection du prompt complet (basePrompt + designs) et des binaires (uniquement sur le DERNIER message utilisateur)
            if (i === lastUserIndex && role === 'user') {
                
                // Injection du prompt combiné (basePrompt existant + context de design)
                textContent = FULL_PROMPT_INJECTION + "\n\n" + textContent; 
                
                // Gestion des images/fichiers binaires
                if (uploadedImages && uploadedImages.length > 0) {
                    uploadedImages.forEach((dataUrl) => {
                        parts.push({
                            inlineData: {
                                data: cleanBase64Data(dataUrl),
                                mimeType: getMimeTypeFromBase64(dataUrl),
                            },
                        });
                    });
                }
                if (uploadedFiles && uploadedFiles.length > 0) {
                     uploadedFiles.forEach((file) => {
                        parts.push({
                            inlineData: {
                                data: file.base64Content,
                                mimeType: 'text/plain', 
                            },
                        });
                        parts.push({ text: `\n[Le contenu du fichier externe "${file.fileName}" est fourni ci-dessus]` });
                    });
                }
            }
            
            // 2. Assurer que le message texte est toujours présent
            parts.push({ text: textContent || ' ' }); 
        }
        
        // Ajoute le message à 'contents' seulement s'il y a des parties
        if (parts.length > 0) {
            contents.push({ role, parts });
        }
    }
    
    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [{ functionDeclarations: [readFileDeclaration] }],
    })

    // Streaming (inchangé)
    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 

        for await (const chunk of response) {
            
            // 🛑 VÉRIFICATION DES APPELS DE FONCTIONS 🛑
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCall = true; 
                
                controller.enqueue(encoder.encode(JSON.stringify({ 
                    functionCall: chunk.functionCalls[0]
                })));
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
        
        if (!functionCall && batchBuffer.length > 0) {
            controller.enqueue(encoder.encode(batchBuffer));
        }

        controller.close();
      },
      async catch(error) {
        console.error("[API Gemini] Erreur durant le streaming:", error);
      }
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8", 
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (err: any) {
    console.error("[API Gemini] Erreur critique (pré-streaming):", err.message, err);
    return NextResponse.json({ 
        error: "Erreur serveur ou API Gemini: " + err.message,
        details: err.message
    }, { status: 500 })
  }
}
