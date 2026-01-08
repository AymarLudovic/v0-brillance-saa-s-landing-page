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

// --- PROMPTS AGENTS ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Agent Manager. Analyse la demande. Si c'est une création d'app, réponds obligatoirement par "ACTION_GENERATE". Sinon, aide l'utilisateur directement pour les corrections rapides.`,
  PKG: `Agent PKG: Crée un blueprint détaillé (Routes, API, Structure DB).`,
  BACKEND: `Agent Backend Builder: Génère UNIQUEMENT les fichiers app/api/**/route.ts basés sur le blueprint.`,
  UI: `Agent UI Builder: Génère les pages (app/page.tsx) et composants fonctionnels en utilisant le backend fourni.`,
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body;

    const ai = new GoogleGenAI({ apiKey });
    const modelId = "gemini-3-flash-preview"; // Utilisation du modèle flash pour l'orchestration

    // --- LOGIQUE DE GÉNÉRATION ORIGINALE ENCAPSULÉE ---
    const callAI = async (systemInstruction: string, customContents: any[], stream = false) => {
      const config = {
        model: modelId,
        contents: customContents,
        tools: [{ functionDeclarations: [readFileDeclaration] }],
        config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + systemInstruction },
        generationConfig: { temperature: 1.0, topP: 0.95, topK: 64, maxOutputTokens: 8192 }
      };
      return stream ? ai.models.generateContentStream(config) : ai.models.generateContent(config);
    };

    // --- PRÉPARATION DES CONTENTS (TON SYSTÈME) ---
    const prepareContents = (additionalContext?: string) => {
      const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
      
      // Vibe Board
      if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts = allReferenceImages.map(img => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
        }));
        contents.push({ role: 'user', parts: [...styleParts as any, { text: "Analyse visuelle requise." }] });
        contents.push({ role: 'model', parts: [{ text: "Mode Multi-Agents activé avec style visuel." }] });
      }

      // Historique + Context additionnel
      history.forEach((msg: Message, i: number) => {
        if (msg.role === 'system') return;
        const parts: Part[] = [{ text: (i === history.length - 1 && additionalContext) ? `${additionalContext}\n\n${msg.content}` : msg.content }];
        
        // Uploads sur le dernier message
        if (i === history.length - 1 && msg.role === 'user') {
          uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
          uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
        }
        contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
      });
      return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));

        try {
          // 1. MANAGER DECISION
          const managerRes = await callAI(AGENT_SYSTEMS.MANAGER, prepareContents()) as any;
          const managerText = managerRes.response.text();

          if (!managerText.includes("ACTION_GENERATE")) {
            send(managerText);
          } else {
            // 2. PKG AGENT
            send("\n[1/3] Planification de l'architecture...\n");
            const pkgRes = await callAI(AGENT_SYSTEMS.PKG, prepareContents("Génère le blueprint.")) as any;
            const blueprint = pkgRes.response.text();

            // 3. BACKEND AGENT
            send("\n[2/3] Construction du Backend API...\n");
            const backRes = await callAI(AGENT_SYSTEMS.BACKEND, prepareContents(`Blueprint: ${blueprint}`)) as any;
            const backendCode = backRes.response.text();

            // 4. UI AGENT (STREAMÉ)
            send("\n[3/3] Création de l'Interface...\n\n");
            const uiStream = await callAI(AGENT_SYSTEMS.UI, prepareContents(`Blueprint: ${blueprint}\n\nBackend Code: ${backendCode}`), true) as any;

            let batchBuffer = "";
            for await (const chunk of uiStream) {
              if (chunk.text) {
                batchBuffer += chunk.text;
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
