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

// --- HELPER FUNCTIONS (RESTAURÉES) ---
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

// --- SYSTEM PROMPTS ---
const MANAGER_SYSTEM = `Tu es l'Agent Manager. Tu es l'unique interface avec l'utilisateur.
DIRECTIVES:
1. Analyse la demande : s'agit-il d'une création complète ou d'une simple discussion/fix rapide ?
2. Si c'est une création : réponds obligatoirement par "ACTION_GENERATE: [ton plan]"
3. Si c'est un fix ou une question : réponds directement à l'utilisateur.
Tu es conscient des agents PKG, Backend et UI, mais c'est toi qui pilotes.`;

const PKG_SYSTEM = `Agent PKG: Crée le blueprint (Routes, API, DB).`;
const BACKEND_SYSTEM = `Agent Backend: Génère les fichiers app/api/**/route.ts.`;
const UI_SYSTEM = `Agent UI: Génère les pages et composants React fonctionnels.`;

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
    };

    const ai = new GoogleGenAI({ apiKey });
    const modelName = "gemini-3-flash-preview"; // Flash pour la rapidité de l'orchestration
    const encoder = new TextEncoder();

    // --- FONCTION DE GÉNÉRATION AGENT (RESTAURE TES PARAMÈTRES) ---
    const runAgent = async (systemInstruction: string, userText: string, isStream: boolean = false) => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        
        // Injection Vibe Board & Context
        if (allReferenceImages && allReferenceImages.length > 0) {
            const styleParts = allReferenceImages.map(img => ({
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
            }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "Analyse ce style." }] });
            contents.push({ role: 'model', parts: [{ text: "Style intégré." }] });
        }

        // Historique & Uploads
        const lastIdx = history.length - 1;
        history.forEach((msg, i) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [{ text: msg.content || " " }];
            if (i === lastIdx && msg.role === 'user') {
                if (uploadedImages) uploadedImages.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                if (uploadedFiles) uploadedFiles.forEach(f => {
                    parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' } });
                    parts.push({ text: `\n[Fichier: ${f.fileName}]` });
                });
            }
            contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
        });

        const genModel = ai.getGenerativeModel({ 
            model: modelName, 
            systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + systemInstruction 
        });

        const config = {
            temperature: 1.0,
            topP: 0.95,
            topK: 64,
            maxOutputTokens: 8192,
        };

        if (isStream) {
            return genModel.generateContentStream({ contents, generationConfig: config });
        } else {
            const res = await genModel.generateContent({ contents, generationConfig: config });
            return res.response.text();
        }
    };

    const stream = new ReadableStream({
      async start(controller) {
        const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
        const lastRequest = history[history.length - 1].content;

        try {
            // 1. LE MANAGER DÉCIDE
            const managerResponse = await runAgent(MANAGER_SYSTEM, lastRequest) as string;

            if (!managerResponse.includes("ACTION_GENERATE")) {
                // Fix rapide ou discussion : On renvoie juste la réponse du manager
                send(managerResponse);
            } else {
                // 2. CHAÎNE MULTI-AGENTS
                send("\n[Manager]: Lancement de la génération...\n");
                
                const blueprint = await runAgent(PKG_SYSTEM, `Planifie: ${lastRequest}`) as string;
                send("\n[Architecte]: Blueprint terminé.\n");

                const backend = await runAgent(BACKEND_SYSTEM, `Blueprint: ${blueprint}`) as string;
                send("\n[Backend]: API générée.\n");

                // L'UI Builder voit tout ce qui a été fait avant
                const uiStream = await runAgent(
                    UI_SYSTEM, 
                    `Blueprint: ${blueprint}\n\nBackend: ${backend}\n\nRéalise l'UI maintenant.`, 
                    true
                ) as any;

                let buffer = "";
                for await (const chunk of uiStream.stream) {
                    if (chunk.text()) {
                        buffer += chunk.text();
                        if (buffer.length >= BATCH_SIZE) {
                            send(buffer);
                            buffer = "";
                        }
                    }
                }
                send(buffer);
            }
            controller.close();
        } catch (err: any) {
            send(`\n[SYSTEM ERROR]: ${err.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
    }
