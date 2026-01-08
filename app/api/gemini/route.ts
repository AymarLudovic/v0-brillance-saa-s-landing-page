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

// --- UTILITAIRES DE PORTÉE GLOBALE ---
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

// --- CONFIGURATION AGENTS (TONALITÉ UNIQUE & COHÉSION) ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Intelligence Principale. Analyse la demande. 
  Si c'est une création d'application ou de page, réponds UNIQUEMENT par le mot-clé "ACTION_GENERATE". 
  Sinon, aide l'utilisateur avec expertise.`,
  
  PKG: `Phase 1 : ARCHITECTURE. Établis le blueprint technique (Routes, API, Composants). 
  Ne demande pas de validation. Ne te présente pas. Décide de la structure finale et livre-la immédiatement.`,
  
  BACKEND: `Phase 2 : LOGIQUE SERVEUR. Génère l'intégralité des fichiers app/api/**/route.ts. 
  Le code doit être prêt à l'emploi et parfaitement fonctionnel. Silence radio sur ton identité, livre juste le moteur.`,
  
  UI: `Phase finale : ASSEMBLAGE & INTERFACE. Tu es l'agent qui finalise l'œuvre au nom de l'IA principale.
  1. Génère TOUTES les pages, containers, et modales d'action définis dans l'architecture.
  2. Assure-toi que TOUS les menus (sidebar, nav) pointent vers les routes réellement créées.
  3. Intègre et consomme TOUT le code backend (fetch/API) généré juste avant toi.
  4. Respecte scrupuleusement le Design System (Zéro Tailwind, CSS Modules, Zéro gris sale).
  5. Parle comme l'agent principal qui livre un projet fini et fonctionnel.`
};

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

    // --- HELPER DE PRÉPARATION DES MESSAGES ---
    const buildContents = (additionalContext: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        const lastUserIndex = history.length - 1;

        if (allReferenceImages && allReferenceImages.length > 0) {
            const styleParts = allReferenceImages.map(img => ({
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
            }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "[SYSTEME VISUEL CHARGÉ]" }] });
            contents.push({ role: 'model', parts: [{ text: "Esthétique assimilée. Prêt pour la synthèse." }] });
        }

        history.forEach((msg, i) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';

            if (i === lastUserIndex && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
                if (additionalContext) parts.push({ text: `\n\n[INSTRUCTION INTERNE]: ${additionalContext}` });
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
            // 1. DÉCISION (Invisible pour l'utilisateur)
            let managerOutput = "";
            const managerStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("Dois-je générer une application ?"),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of managerStream) { if (chunk.text) managerOutput += chunk.text; }

            if (!managerOutput.includes("ACTION_GENERATE")) {
                send(managerOutput);
            } else {
                // CHAINE DE PRODUCTION UNIFIÉE
                send("### 🏗️ Architecture du Projet\n");
                const blueprint = await runStreamedAgent(AGENT_SYSTEMS.PKG, "Définis le blueprint.");
                send("\n\n---\n");

                send("### ⚙️ Développement du Moteur (Backend)\n");
                const backend = await runStreamedAgent(AGENT_SYSTEMS.BACKEND, `Implémente les API : ${blueprint}`);
                send("\n\n---\n");

                send("### 🎨 Interface & Expérience Utilisateur\n");
                await runStreamedAgent(AGENT_SYSTEMS.UI, `Finalise l'application. Blueprint: ${blueprint}. Backend: ${backend}. 
                Assure la navigation complète et l'intégration des fonctionnalités.${cssMasterUrl ? `\nInspiration CSS : ${cssMasterUrl}` : ""}`);
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
