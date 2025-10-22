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

// 🛑 DÉCLARATION DE L'OUTIL readFile 🛑
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
        // currentProjectFiles n'est pas utilisé dans le POST du serveur, mais on le garde en commentaire
        // pour montrer qu'il est bien ignoré ici.
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[], 
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
        // 🛑 projectEmbeddings EST RETIRÉ ICI 🛑
        // projectEmbeddings: any[],
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
            // Le message système est le premier élément (rôle 'user' dans l'historique Gemini)
            // L'injection de basePrompt est critique pour le premier message utilisateur
            // ou un message utilisateur qui fait suite à une réponse d'outil.
            
            // Note: Si le premier message de l'historique est le contexte système,
            // il a déjà le rôle 'user' dans votre structure `contents`.
            
            if (msg === history[history.length - 1] && role === 'user') {
                // INJECTION DE BASEPROMPT UNIQUEMENT pour le dernier message (le prompt réel)
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
    
    // --- APPEL API (SANS TENTATIVES CÔTÉ SERVEUR) ---
    // La gestion des tentatives est gérée côté client (sendChat)
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
        // Vous pouvez envoyer l'erreur au client si vous le souhaitez, mais la connexion sera probablement coupée
        // controller.error(error); 
      }
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8", 
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (err: any) {
    // Gestion des erreurs d'initialisation (e.g., req.json, API Key)
    console.error("[API Gemini] Erreur critique (pré-streaming):", err.message, err);
    return NextResponse.json({ 
        error: "Erreur serveur ou API Gemini: " + err.message,
        details: err.message
    }, { status: 500 })
  }
  }
