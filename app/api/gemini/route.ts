import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE — MODE SINGLE PAGE NO-FAIL
 ... (Tes directives habituelles) ...
`; 

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
    
    // --- CONSTRUCTION DES CONTENTS (TON CODE ORIGINAL) ---
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts: Part[] = [];
        allReferenceImages.forEach((imgBase64) => {
            styleParts.push({ inlineData: { data: cleanBase64Data(imgBase64), mimeType: getMimeTypeFromBase64(imgBase64) } });
        });
        let instructionText = `[DIRECTIVE SYSTÈME : ANALYSE VISUELLE CROISÉE] ... (Ton texte original) ...`;
        styleParts.push({ text: instructionText });
        contents.push({ role: 'user', parts: styleParts });
        contents.push({ role: 'model', parts: [{ text: "Compris. J'ai analysé les références visuelles." }] });
    }

    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        if (msg.role === 'system') { systemContextParts.push({ text: msg.content }); continue; }
        if (msg.functionResponse) {
            parts.push({ functionResponse: { name: msg.functionResponse.name, response: msg.functionResponse.response } });
        } else {
            if (i === lastUserIndex && role === 'user') {
                if (uploadedImages && uploadedImages.length > 0) {
                    uploadedImages.forEach((dataUrl) => { parts.push({ inlineData: { data: cleanBase64Data(dataUrl), mimeType: getMimeTypeFromBase64(dataUrl) } }); });
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

    const finalSystemInstruction = (FULL_PROMPT_INJECTION + (systemContextParts.length > 0 ? "\n\n--- CONTEXTE PROJET ---\n" + systemContextParts.map(p => p.text).join('\n') : ""));

    const encoder = new TextEncoder();
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));

        try {
          // --- AJOUT LOGIQUE MULTI-AGENTS (Utilisant ai.models.generateContent) ---
          
          // 1. MANAGER
          const managerRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Explique brièvement ton plan pour : ${history[lastUserIndex].content}` }] }],
            config: { systemInstruction: "Tu es le Manager. Réponds par une phrase courte et stylée." }
          });
          send(`[MANAGER]: ${managerRes.candidates[0].content.parts[0].text}\n\n`);

          // 2. PKG
          send("→ 🏗️ Agent PKG : Établissement de la structure...\n");
          const pkgRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: history[lastUserIndex].content }] }],
            config: { systemInstruction: "Tu es l'Agent PKG. Liste les sections techniques nécessaires en Markdown." }
          });
          send(`\n`);

          // --- 3. GÉNÉRATION FINALE (TON FLUX INITIAL) ---
          const response = await ai.models.generateContentStream({
            model,
            contents, 
            tools: [{ functionDeclarations: [readFileDeclaration] }],
            config: { systemInstruction: finalSystemInstruction }
          });

          let functionCall = false; 
          for await (const chunk of response) {
              if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                  functionCall = true; 
                  send(JSON.stringify({ functionCall: chunk.functionCalls[0] }));
                  break; 
              }
              if (chunk.text) {
                batchBuffer += chunk.text; 
                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = ""; 
                }
              }
          }
          if (!functionCall && batchBuffer.length > 0) send(batchBuffer);
          controller.close();

        } catch (error: any) {
          console.error("Stream Error:", error);
          send("\nErreur d'orchestration: " + error.message);
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } })
  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
                         }
