// app/api/gemini/route.ts

import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// --- TYPES ---
interface Message { 
    role: "user" | "assistant"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    // Nouveau type pour la réponse d'un outil (functionResponse)
    functionResponse?: {
        name: string;
        response: any;
    }
}
interface ProjectFile { 
    filePath: string; 
    content: string; 
}

// Utilitaires pour les fichiers
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256; 

// 🛑 NOUVEAU: DÉCLARATION DE L'OUTIL readFile 🛑
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
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[], // Reçu mais non utilisé ici
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
        projectEmbeddings: any[],
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ error: "Historique de conversation manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    for (const msg of history) {
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let textContent = msg.content;

        // 🛑 TRAITEMENT DES RÉPONSES D'OUTILS 🛑
        if (msg.functionResponse) {
            parts.push({
                functionResponse: {
                    name: msg.functionResponse.name,
                    response: msg.functionResponse.response,
                }
            });
            // Nous n'ajoutons pas de texte si c'est une réponse d'outil
        } 
        // 🛑 TRAITEMENT DU MESSAGE UTILISATEUR/ASSISTANT 🛑
        else {
            if (msg === history[history.length - 1] && role === 'user') {
                // INJECTION DE BASEPROMPT UNIQUEMENT pour le dernier message
                textContent = basePrompt + "\n\n" + textContent; 
                
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
            parts.push({ text: textContent }); 
        }

        contents.push({ role, parts });
    }
    
    const response = await ai.models.generateContentStream({
      model,
      contents, 
      // 🛑 NOUVEAU: ENREGISTREMENT DE L'OUTIL 🛑
      tools: [{ functionDeclarations: [readFileDeclaration] }],
    })

    // Streaming (inchangé)
    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; // Flag pour détecter si l'IA appelle une fonction

        for await (const chunk of response) {
            
            // 🛑 NOUVEAU: VÉRIFICATION DES APPELS DE FONCTIONS 🛑
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                // L'IA a stoppé le texte pour demander un outil
                functionCall = true; 
                
                // On met en queue l'appel de fonction sous forme JSON sérialisé
                // Le client le lira, exécutera l'outil et renverra le résultat
                controller.enqueue(encoder.encode(JSON.stringify({ 
                    functionCall: chunk.functionCalls[0]
                })));
                break; // Stoppe le stream immédiatement après l'appel d'outil
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
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8", // Utilise text/plain même si on envoie du JSON à la fin
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (err: any) {
    console.error("[API Gemini] Erreur globale:", err)
    return NextResponse.json({ error: err.message || "Erreur Gemini" }, { status: 500 })
  }
            }
                                      
