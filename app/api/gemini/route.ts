import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 

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
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return NextResponse.json({ error: "Clé API Gemini non configurée (ni dans ENV, ni dans LocalStorage)" }, { status: 401 })
    }

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

    const ai = new GoogleGenAI({
      apiKey: apiKey,
    })

    const model = "gemini-2.5-flash"
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 

    const systemContextParts: Part[] = []; 

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        let role: 'user' | 'model'; 
        let textContent = msg.content;

        if (msg.role === 'system') {
            systemContextParts.push({ text: textContent });
            continue; 
        }
        
        role = msg.role === 'assistant' ? 'model' : 'user'; 
        
        if (msg.functionResponse) {
            parts.push({
                functionResponse: {
                    name: msg.functionResponse.name,
                    response: msg.functionResponse.response,
                }
            });
        } 
        else {
            if (i === lastUserIndex && role === 'user') {
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
            parts.push({ text: textContent || ' ' }); 
        }
        
        if (parts.length > 0) {
            contents.push({ role, parts });
        }
    }

    const finalSystemInstruction = (
        FULL_PROMPT_INJECTION + 
        (systemContextParts.length > 0 
            ? "\n\n--- CONTEXTE DE FICHIERS DE PROJET ---\n" + systemContextParts.map(p => p.text).join('\n')
            : ""
        )
    );
    
    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [{ functionDeclarations: [readFileDeclaration] }],
      config: {
          systemInstruction: finalSystemInstruction 
      }
    })

    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 

        for await (const chunk of response) {
            
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
