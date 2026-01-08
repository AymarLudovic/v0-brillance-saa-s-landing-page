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
        allReferenceImages, // Ici, le CLIENT (Chat) aura déjà envoyé les images filtrées (Landing ou App)
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
    const model = "gemini-2.0-flash-exp"; // Modèle recommandé pour la rapidité/qualité
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    // --- INJECTION DU VIBE BOARD ---
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

        let instructionText = `[DIRECTIVE SYSTÈME - ANALYSE VISUELLE DU VIBE BOARD]
Voici les images de référence sélectionnées pour cette tâche.
1. Analyse le style (Landing ou App) de ces images.
2. Fusionne ce style avec les instructions textuelles.
3. Si l'image est une Landing, force la richesse des sections. Si c'est une App, force la rigueur UI (TopBar 28px).
`;

        if (cssMasterUrl) {
            instructionText += `\n\n4. SOURCE CSS MAÎTRE : L'utilisateur a fourni une URL (${cssMasterUrl}). Récupère son CSS.`;
        }

        styleParts.push({ text: instructionText });

        contents.push({ role: 'user', parts: styleParts });
        contents.push({ role: 'model', parts: [{ text: "Bien reçu. J'active le mode Multi-Agents : Orchestrateur, UI Builder et Backend prêts à intervenir selon les images fournies." }] });
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

    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [{ functionDeclarations: [readFileDeclaration] }],
      config: { systemInstruction: finalSystemInstruction },
      generationConfig: {
        temperature: 1.0, // Ajusté pour équilibre créativité/rigueur
        topP: 0.95, 
        topK: 64, 
        maxOutputTokens: 8192, 
      }
    });

    const encoder = new TextEncoder();
    let batchBuffer = ""; 
    
    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 
        try {
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
        } catch (streamError: any) {
            const errorMessage = `\n\n[SYSTEM ERROR]: Une erreur est survenue pendant la génération.\nDétail: ${streamError.message}`;
            controller.enqueue(encoder.encode(errorMessage));
            controller.close();
        }
      },
      async catch(error) { console.error("Stream Error:", error); }
    })

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } })
  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
      }
