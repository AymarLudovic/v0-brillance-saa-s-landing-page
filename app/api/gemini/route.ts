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

const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Agent Manager (Gemini 3). Analyse la demande. Si c'est une création d'app, réponds OBLIGATOIREMENT par "ACTION_GENERATE". Sinon, aide l'utilisateur directement.`,
  PKG: `Agent PKG: Crée un blueprint détaillé (Routes, API, Structure DB).`,
  BACKEND: `Agent Backend: Génère les fichiers app/api/**/route.ts.`,
  UI: `Agent UI: Génère les pages et composants React en utilisant le backend fourni.`
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body;

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    // --- HELPER DE GÉNÉRATION (TA LOGIQUE EXACTE) ---
    const callAI = async (systemInstruction: string, additionalContext: string, stream = false) => {
      const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
      
      // Vibe Board Injection
      if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts = allReferenceImages.map(img => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
        }));
        contents.push({ role: 'user', parts: [...styleParts as any, { text: "Référence visuelle chargée." }] });
        contents.push({ role: 'model', parts: [{ text: "Bien reçu, style visuel intégré." }] });
      }

      // Re-construction des contents avec historique et fichiers
      history.forEach((msg: Message, i: number) => {
        if (msg.role === 'system') return;
        const parts: Part[] = [{ text: (i === history.length - 1) ? `${additionalContext}\n\n${msg.content}` : msg.content }];
        
        if (i === history.length - 1 && msg.role === 'user') {
          uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
          uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
        }
        contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
      });

      const config = {
        model,
        contents,
        tools: [{ functionDeclarations: [readFileDeclaration] }],
        config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + systemInstruction },
        generationConfig: { temperature: 1.0, topP: 0.95, topK: 64, maxOutputTokens: 8192 }
      };

      return stream ? ai.models.generateContentStream(config) : ai.models.generateContent(config);
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));

        try {
          // 1. MANAGER DÉCIDE
          const managerRes = await callAI(AGENT_SYSTEMS.MANAGER, "Analyse l'intention.") as any;
          const managerText = managerRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

          if (!managerText.includes("ACTION_GENERATE")) {
            send(managerText);
          } else {
            send("\n[Manager]: Plan de génération activé...\n");

            // 2. PKG AGENT
            const pkgRes = await callAI(AGENT_SYSTEMS.PKG, "Génère le blueprint.") as any;
            const blueprint = pkgRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            send("\n[PKG]: Blueprint OK.\n");

            // 3. BACKEND AGENT
            const backRes = await callAI(AGENT_SYSTEMS.BACKEND, `Blueprint: ${blueprint}`) as any;
            const backendCode = backRes.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            send("\n[Backend]: API OK.\n");

            // 4. UI AGENT (STREAMING FINAL)
            send("\n[UI Builder]: Génération des composants...\n\n");
            const uiStream = await callAI(AGENT_SYSTEMS.UI, `Blueprint: ${blueprint}\n\nBackend: ${backendCode}`, true) as any;

            let batchBuffer = "";
            for await (const chunk of uiStream) {
              // Sécurité : Vérifier si chunk.text est une fonction ou une propriété
              const chunkText = typeof chunk.text === 'function' ? chunk.text() : (chunk.candidates?.[0]?.content?.parts?.[0]?.text || "");
              
              if (chunkText) {
                batchBuffer += chunkText;
                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = "";
                }
              }
            }
            send(batchBuffer);
          }
          controller.close();
        } catch (e: any) {
          send(`\n\n[ERREUR AGENT]: ${e.message}`);
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
}
