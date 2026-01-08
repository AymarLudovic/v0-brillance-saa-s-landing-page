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

// --- CONFIGURATION AGENTS ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Agent Manager. Analyse la demande. Si c'est une création d'app, de page ou de composant, réponds UNIQUEMENT par "ACTION_GENERATE". Sinon, aide l'utilisateur directement.`,
  PKG: `Agent PKG: Crée un blueprint technique détaillé (Routes, API, Structure DB).`,
  BACKEND: `Agent Backend Builder: Génère UNIQUEMENT le code des API (ex: app/api/**/route.ts) et la logique serveur.`,
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
    
    const getPreparedContents = (extraContext: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        const lastUserIndex = history.length - 1;

        if (allReferenceImages && allReferenceImages.length > 0) {
            const styleParts: Part[] = allReferenceImages.map(img => ({
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
            }));
            styleParts.push({ text: `[STYLE REFERENCE] ${extraContext}` });
            contents.push({ role: 'user', parts: styleParts });
            contents.push({ role: 'model', parts: [{ text: "Vibe Board intégré." }] });
        }

        for (let i = 0; i < history.length; i++) {
            const msg = history[i];
            if (msg.role === 'system') continue;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            
            if (msg.functionResponse) {
                parts.push({ functionResponse: { name: msg.functionResponse.name, response: msg.functionResponse.response } });
            } else {
                if (i === lastUserIndex && role === 'user') {
                    uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                    uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
                }
                parts.push({ text: msg.content || ' ' }); 
            }
            if (parts.length > 0) contents.push({ role, parts });
        }
        return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let batchBuffer = "";

        try {
            // 1. MANAGER
            const managerRes = await ai.models.generateContent({
                model,
                contents: getPreparedContents("Analyse l'intention."),
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + AGENT_SYSTEMS.MANAGER }
            });
            // Sécurité ici : on vérifie si la réponse contient du texte
            const managerText = managerRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (!managerText.includes("ACTION_GENERATE")) {
                send(managerText || "Désolé, je ne peux pas traiter cette demande.");
            } else {
                // 2. PKG
                send("### 🏗️ Architecture\n");
                const pkgRes = await ai.models.generateContent({
                    model,
                    contents: getPreparedContents("Génère le blueprint."),
                    config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + AGENT_SYSTEMS.PKG }
                });
                const blueprint = pkgRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur lors de la génération du blueprint.";
                send(blueprint + "\n\n---\n");

                // 3. BACKEND
                send("### ⚙️ Backend\n");
                const backRes = await ai.models.generateContent({
                    model,
                    contents: getPreparedContents(`Blueprint: ${blueprint}`),
                    config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + AGENT_SYSTEMS.BACKEND }
                });
                const backendCode = backRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur lors de la génération du backend.";
                send(backendCode + "\n\n---\n");

                // 4. UI (STREAMÉ)
                send("### 🎨 Interface\n");
                const uiResponse = await ai.models.generateContentStream({
                    model,
                    contents: getPreparedContents(`Blueprint: ${blueprint}\n\nBackend: ${backendCode}${cssMasterUrl ? `\n\nCSS: ${cssMasterUrl}` : ""}`),
                    tools: [{ functionDeclarations: [readFileDeclaration] }],
                    config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + AGENT_SYSTEMS.UI },
                    generationConfig: { temperature: 1.5, topP: 0.98, topK: 60, maxOutputTokens: 8192 }
                });

                for await (const chunk of uiResponse) {
                    // chunk.text() est aussi risqué s'il n'y a pas de texte
                    const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    if (chunkText) {
                        batchBuffer += chunkText;
                        if (batchBuffer.length >= BATCH_SIZE) {
                            send(batchBuffer);
                            batchBuffer = "";
                        }
                    }
                }
                if (batchBuffer.length > 0) send(batchBuffer);
            }
            controller.close();
        } catch (streamError: any) {
            send(`\n\n[SYSTEM ERROR]: ${streamError.message}`);
            controller.close();
        }
      },
      async catch(error) { console.error("Stream Error:", error); }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
  }
