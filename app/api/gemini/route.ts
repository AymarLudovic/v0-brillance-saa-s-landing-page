import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 
const BATCH_SIZE = 256; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
}

// --- UTILITAIRES ---
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

// --- ARMADA D'AGENTS AVEC INJECTION NATIVE DU BASEPROMPT ---
const AGENT_SYSTEMS = {
  MANAGER: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le CERVEAU DE PILOTAGE. Dirige vers ACTION_GENERATE ou ACTION_FIX.`,
  
  PKG: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es l'ARCHITECTE. Liste les routes, dossiers et fichiers. Définis les props et schémas.`,
  
  // --- BACKEND CHAIN ---
  BACKEND_1: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le BUILDER BACKEND (Alpha). Génère les fichiers API de base.`,
  BACKEND_2: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es l'EXPERT LOGIQUE (Beta). Ajoute la logique métier complexe et les filtres.`,
  BACKEND_3: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le GARDIEN DE LA SÉCURITÉ (Gamma). Ajoute try/catch et validations.`,
  BACKEND_4: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le FINALISEUR BACKEND (Omega). Finalise les types et assure la robustesse.`,
  
  // --- UI CHAIN ---
  UI_1: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es l'INTÉGRATEUR STRUCTURE (Alpha). Génère pages et layouts.`,
  UI_2: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le DESIGNER VIBE-BOARD (Beta). Applique le style pixel-perfect des images.`,
  UI_3: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es l'EXPERT INTERACTIVITÉ (Gamma). Crée toutes les modales et les états cliquables.`,
  UI_4: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es le QA UX FINAL (Omega). Zéro lien mort, zéro bouton inutile. Polissage total.`,

  FIXER: `${FULL_PROMPT_INJECTION}\n\nMISSION: Tu es l'AGENT DE MAINTENANCE. Applique les corrections demandées précisément.`
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages } = body;
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; // Note: Assurez-vous que ce modèle supporte thinkingConfig

    const buildContents = (context: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            const parts: Part[] = [];
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                if (context) parts.push({ text: `\n\n[CONSOLIDATION PRÉCÉDENTE]:\n${context}` });
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

        const runAgent = async (agentKey: keyof typeof AGENT_SYSTEMS, workContext: string) => {
            const res = await ai.models.generateContentStream({
                model,
                contents: buildContents(workContext),
                config: { systemInstruction: AGENT_SYSTEMS[agentKey] },
                generationConfig: {
                  temperature: 1.5, 
                  maxOutputTokens: 8192,
                  thinkingConfig: {     
                    includeThoughts: true,
                    thinkingLevel: "high" 
                  }
                }
            });
            let fullText = "";
            for await (const chunk of res) {
                // On capture le texte. Si thinkingConfig est actif, certains SDK renvoient les pensées dans chunk.thought
                const content = chunk.text;
                if (content) {
                    fullText += content;
                    batchBuffer += content;
                    if (batchBuffer.length >= BATCH_SIZE) { send(batchBuffer); batchBuffer = ""; }
                }
            }
            return fullText;
        };

        try {
            let decision = "";
            const mStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("DÉCISION"),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of mStream) { if (chunk.text) decision += chunk.text; }

            if (decision.includes("ACTION_FIX")) {
                send("### 🛠️ Mode Correctif Appliqué\n");
                await runAgent("FIXER", "Applique le fix.");
            } else {
                send("### 🏗️ Phase Architecture\n");
                const plan = await runAgent("PKG", "Blueprint initial.");

                send("\n---\n### ⚙️ Pipeline Backend (Intensité Haute)\n");
                const b1 = await runAgent("BACKEND_1", `Plan: ${plan}`);
                const b2 = await runAgent("BACKEND_2", `Alpha: ${b1}`);
                const b3 = await runAgent("BACKEND_3", `Beta: ${b2}`);
                const b4 = await runAgent("BACKEND_4", `Gamma: ${b3}`);

                send("\n---\n### 🎨 Pipeline UI/UX (Intensité Haute)\n");
                const u1 = await runAgent("UI_1", `Plan: ${plan}\nBackend: ${b4}`);
                const u2 = await runAgent("UI_2", `Structure: ${u1}`);
                const u3 = await runAgent("UI_3", `Design: ${u2}`);
                await runAgent("UI_4", `Interactivité: ${u3}`);
            }

            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();
        } catch (e: any) {
            send(`\n\n[FATAL ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
          }
