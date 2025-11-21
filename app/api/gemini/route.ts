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
  description: "Lit le contenu d'un fichier du projet par son chemin d'accès (e.g., app/page.tsx).",
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
        referenceImageBase64 // <-- On reçoit l'image ici
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        referenceImageBase64?: string 
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-2.5-flash"; 
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    // --- INJECTION DU DESIGN SYSTÈME (IMAGE REFERENCE) ---
    if (referenceImageBase64) {
        contents.push({
            role: 'user',
            parts: [
                { 
                    inlineData: { 
                        data: cleanBase64Data(referenceImageBase64), 
                        mimeType: getMimeTypeFromBase64(referenceImageBase64) 
                    } 
                },
                { 
                    text: `[SYSTEM DIRECTIVE: VISUAL CLONING REQUIRED]
The image above is your VISUAL MASTER REFERENCE (The "Design System").
Ignore your default style preferences. You MUST adopt the style of this image.

ANALYZE AND REPLICATE:
1. Color Palette (Backgrounds, Accents, Text).
2. Component Shapes (Border-radius, Shadow depth, Borders).
3. Layout Density (Spacing, Margins).
4. Typography Vibe (Serif/Sans, Weights).

Apply this EXACT visual style to the code you generate below, regardless of the functional request.`
                }
            ]
        });
        
        contents.push({
            role: 'model',
            parts: [{ text: "Understood. I have analyzed the visual master reference. I will strictly clone its design system (colors, shapes, spacing) for all generated code." }]
        });
    }
    // ----------------------------------------------------

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
                        parts.push({ text: `\n[Fichier joint: "${file.fileName}"]` });
                    });
                }
            }
            parts.push({ text: msg.content || ' ' }); 
        }
        
        if (parts.length > 0) contents.push({ role, parts });
    }

    const finalSystemInstruction = (
        FULL_PROMPT_INJECTION + 
        (systemContextParts.length > 0 ? "\n\n--- CONTEXTE ---\n" + systemContextParts.map(p => p.text).join('\n') : "")
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
