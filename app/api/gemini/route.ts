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

// --- UTILITAIRES ---
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

// --- SYSTEM PROMPTS : SÉGRÉGATION STRICTE ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Intelligence de Pilotage. 
  - Si c'est un nouveau projet ou une demande de création majeure : réponds "ACTION_GENERATE".
  - Si c'est une demande de correction, de changement de couleur ou d'ajout d'une fonction précise sur un code existant : réponds "ACTION_FIX".
  - Sinon, aide l'utilisateur normalement.`,
  
  PKG: `Tu es l'ARCHITECTE. Ton rôle est de définir le plan de vol. 
  INTERDICTION : Ne génère aucun code source de fichier.
  MISSION : Liste uniquement les routes, la structure des dossiers et les noms des fichiers nécessaires (ex: app/api/auth, components/ui/Modal). Définis les props et les schémas de données. 
  Ton blueprint sera la seule source de vérité pour les builders.`,
  
  BACKEND: `Tu es le BUILDER BACKEND. 
  INTERDICTION : Ne génère JAMAIS de fichiers React (.tsx), de CSS ou de composants UI.
  MISSION : Génère uniquement le contenu des fichiers dans "app/api/**/*.ts" basés sur le blueprint. Assure la logique métier et la sécurité.`,
  
  UI: `Tu es le BUILDER UI & INTÉGRATEUR. 
  INTERDICTION : Ne génère jamais de routes API (/api/...).
  MISSION : Génère TOUT le reste (.tsx, .css). Tu dois créer les pages, la sidebar, les modales d'action et les menus de navigation. 
  NAVIGATION : Assure-toi que les liens (href) correspondent aux pages créées.
  INTÉGRATION : Utilise fetch() pour appeler les API générées par le Backend. Livre une application où chaque clic fonctionne.`,

  FIXER: `Tu es l'Agent de Maintenance. L'utilisateur veut modifier un point précis. Analyse le code existant (via l'historique) et ne génère QUE les modifications demandées pour les fichiers concernés. Sois rapide et précis.`
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

    const buildContents = (context: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        if (allReferenceImages?.length > 0) {
            const styleParts = allReferenceImages.map(img => ({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "[STYLE_REF]" }] });
            contents.push({ role: 'model', parts: [{ text: "Vibe Board assimilé." }] });
        }
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                if (context) parts.push({ text: `\n\n[DIRECTIVE]: ${context}` });
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

        const runAgent = async (instr: string, ctx: string, isFinal: boolean = false) => {
            const res = await ai.models.generateContentStream({
                model,
                contents: buildContents(ctx),
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + instr },
                generationConfig: { temperature: isFinal ? 1.4 : 1.0, maxOutputTokens: 8192 }
            });
            let fullText = "";
            for await (const chunk of res) {
                if (chunk.text) {
                    fullText += chunk.text;
                    batchBuffer += chunk.text;
                    if (batchBuffer.length >= BATCH_SIZE) { send(batchBuffer); batchBuffer = ""; }
                }
            }
            return fullText;
        };

        try {
            // 1. DÉCISION DU MANAGER
            let decision = "";
            const mStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("Décide du mode : ACTION_GENERATE ou ACTION_FIX"),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of mStream) { if (chunk.text) decision += chunk.text; }

            if (decision.includes("ACTION_FIX")) {
                send("### 🛠️ Correction en cours...\n");
                await runAgent(AGENT_SYSTEMS.FIXER, "Applique la correction demandée immédiatement.");
            } else if (decision.includes("ACTION_GENERATE")) {
                // PIPELINE COMPLET
                send("### 🏗️ Architecture\n");
                const plan = await runAgent(AGENT_SYSTEMS.PKG, "Dresse le blueprint sans code.");
                send("\n---\n### ⚙️ Logic (API)\n");
                const back = await runAgent(AGENT_SYSTEMS.BACKEND, `Code les routes API selon ce plan : ${plan}`);
                send("\n---\n### 🎨 Interface & Intégration\n");
                await runAgent(AGENT_SYSTEMS.UI, `Livre l'UI complète. Connecte-toi à : ${back}. Assure la navigation et les modales.`, true);
            } else {
                send(decision);
            }

            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();
        } catch (e: any) {
            send(`\n\n[ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
        }
