import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}\n\n`; 

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
        injectedCSS
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        allReferenceImages?: string[],
        injectedCSS?: string
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-2.5-flash"; 
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

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

        let instructionText = `[SYSTEM DIRECTIVE: HYBRID DESIGN ENGINE]
You are an expert UI/UX Engineer capable of fusing visual references with raw code styles.

SOURCE 1: VISUAL REFERENCES (Attached Images)
- USE THESE FOR: Layout structure, Component shapes, Spacing, and Hierarchy.
- Pick the best image that matches the user's intent.

SOURCE 2: CSS STYLE SYSTEM (Injected Code below)
- USE THESE FOR: Exact Color Palette (Hex codes), Typography, Gradients.
- Extract variables from this CSS.

YOUR MISSION:
Combine the structure of the images with the colors/fonts of the CSS to build the user's app.`;

        if (injectedCSS) {
            instructionText += `\n\n--- INJECTED CSS SYSTEM ---\n${injectedCSS.substring(0, 20000)}`;
        }

        styleParts.push({ text: instructionText });

        contents.push({ role: 'user', parts: styleParts });
        contents.push({ role: 'model', parts: [{ text: "Understood. I will fuse the visual structure of the reference images with the provided CSS system." }] });
    }

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
      config: { systemInstruction: finalSystemInstruction }
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
