import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 
const BATCH_SIZE = 256; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Agent Manager. Analyse la demande. Si c'est une création d'app, réponds OBLIGATOIREMENT par "ACTION_GENERATE". Sinon, aide l'utilisateur directement.`,
  PKG: `Agent PKG: Crée un blueprint technique détaillé (Routes, API, Structure DB).`,
  BACKEND: `Agent Backend Builder: Génère UNIQUEMENT les fichiers app/api/**/route.ts basés sur le blueprint.`,
  UI: `Agent UI Builder: Génère les pages et composants React en utilisant le backend fourni.`
};

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

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
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        allReferenceImages?: string[],
        cssMasterUrl?: string
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 

    // --- PREPARATION DES CONTENUS (Reprise de ta logique) ---
    const buildContents = (additionalContext: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        const lastUserIndex = history.length - 1;

        if (allReferenceImages && allReferenceImages.length > 0) {
            const styleParts = allReferenceImages.map(img => ({
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
            }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "Vibe Board chargé." }] });
            contents.push({ role: 'model', parts: [{ text: "Style intégré." }] });
        }

        history.forEach((msg, i) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';

            if (i === lastUserIndex && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
                if (additionalContext) parts.push({ text: `\n\n[CONTEXTE AGENT]: ${additionalContext}` });
            }
            parts.push({ text: msg.content || ' ' });
            contents.push({ role, parts });
        });
        return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let batchBuffer = "";

        const runStreamedAgent = async (agentInstruction: string, context: string = "") => {
            let fullText = "";
            const response = await ai.models.generateContentStream({
                model,
                contents: buildContents(context),
                tools: [{ functionDeclarations: [readFileDeclaration] }],
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + agentInstruction },
                generationConfig: { temperature: 1.5, topP: 0.98, topK: 60, maxOutputTokens: 8192 }
            });

            for await (const chunk of response) {
                if (chunk.text) {
                    const txt = chunk.text;
                    fullText += txt;
                    batchBuffer += txt;
                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            return fullText;
        };

        try {
            // 1. MANAGER
            let managerOutput = "";
            const managerStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("Analyse si l'utilisateur veut générer une application."),
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + AGENT_SYSTEMS.MANAGER }
            });

            for await (const chunk of managerStream) {
                if (chunk.text) managerOutput += chunk.text;
            }

            if (!managerOutput.includes("ACTION_GENERATE")) {
                send(managerOutput);
            } else {
                // 2. PKG
                send("### 🏗️ Architecture\n");
                const blueprint = await runStreamedAgent(AGENT_SYSTEMS.PKG, "Génère le blueprint.");
                send("\n\n---\n");

                // 3. BACKEND
                send("### ⚙️ Backend\n");
                const backend = await runStreamedAgent(AGENT_SYSTEMS.BACKEND, `Blueprint: ${blueprint}`);
                send("\n\n---\n");

                // 4. UI
                send("### 🎨 Interface\n");
                await runStreamedAgent(AGENT_SYSTEMS.UI, `Blueprint: ${blueprint}\nBackend: ${backend}${cssMasterUrl ? `\nCSS: ${cssMasterUrl}` : ""}`);
            }

            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();
        } catch (e: any) {
            send(`\n\n[SYSTEM ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
  }
