import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 
const BATCH_SIZE = 256; 

// --- CONFIGURATION AGENTS (COORDONNÉS ET SILENCIEUX) ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es le cerveau de l'opération. Analyse la demande. 
  Si l'utilisateur veut créer ou modifier une app/page, réponds UNIQUEMENT "ACTION_GENERATE". 
  Sinon, réponds avec expertise et chaleur comme un partenaire de pensée unique.`,

  PKG: `Tu es l'Architecte. Ton rôle est de définir la structure technique (Blueprint). 
  Établis : 1. Les routes Next.js. 2. Le schéma des données. 3. Les composants nécessaires. 
  Sois précis, car le Backend et l'UI vont se baser aveuglément sur tes choix. Ne demande pas de validation, décide.`,

  BACKEND: `Tu es le Logic Builder. En te basant sur le Blueprint du PKG, génère TOUTES les routes API (app/api/...) nécessaires. 
  Assure-toi que les endpoints sont robustes. Ton code doit être prêt à être consommé immédiatement par l'agent UI. 
  Ne parle pas de toi, livre le code.`,

  UI: `Tu es le Master Weaver (Intégrateur Final). Ta mission est de livrer l'application COMPLÈTE. 
  1. Crée TOUTES les pages, la sidebar, et les menus de navigation. 
  2. Les liens doivent réellement diriger vers les pages créées.
  3. Intègre TOUTES les fonctions et API générées par l'agent Backend (appels fetch/swr).
  4. Implémente les modales d'action (création, édition) et les menus contextuels.
  5. Respecte le Design System : Layout Type 1, CSS Modules, Plus Jakarta Sans, Zéro gris sale, Zéro Tailwind.
  Ton but est de fournir un projet où tout "clique" ensemble. Agis comme si tu étais le seul agent, livre le résultat final parfait.`
};

// ... (fonctions utilitaires getMimeTypeFromBase64, cleanBase64Data, readFileDeclaration restent identiques)

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body;

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    const buildContents = (additionalContext: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        if (allReferenceImages?.length > 0) {
            const styleParts = allReferenceImages.map(img => ({
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) }
            }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "Vibe Board chargé." }] });
            contents.push({ role: 'model', parts: [{ text: "Esthétique assimilée." }] });
        }

        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
                if (additionalContext) parts.push({ text: `\n\n[CONTEXTE PIPELINE]: ${additionalContext}` });
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

        const runStreamedAgent = async (agentInstruction: string, context: string = "", isFinal: boolean = false) => {
            let fullText = "";
            const response = await ai.models.generateContentStream({
                model,
                contents: buildContents(context),
                tools: isFinal ? [{ functionDeclarations: [readFileDeclaration] }] : [],
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + agentInstruction },
                generationConfig: { temperature: isFinal ? 1.5 : 1.0, topP: 0.98, topK: 60, maxOutputTokens: 8192 }
            });

            for await (const chunk of response) {
                if (chunk.text) {
                    fullText += chunk.text;
                    batchBuffer += chunk.text;
                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            return fullText;
        };

        try {
            // 1. MANAGER (Invisible si ACTION_GENERATE)
            let managerOutput = "";
            const managerStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("DÉCISION: Génération d'app nécessaire ?"),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of managerStream) { if (chunk.text) managerOutput += chunk.text; }

            if (!managerOutput.includes("ACTION_GENERATE")) {
                send(managerOutput);
            } else {
                // PHASE D'EXÉCUTION UNIFIÉE
                send("### 🏗️ Planification de l'Architecture\n");
                const blueprint = await runStreamedAgent(AGENT_SYSTEMS.PKG, "Initialise le blueprint du projet.");
                send("\n\n---\n### ⚙️ Développement du Moteur (Backend)\n");
                
                const backend = await runStreamedAgent(AGENT_SYSTEMS.BACKEND, `Implémente les APIs basées sur ce blueprint : ${blueprint}`);
                send("\n\n---\n### 🎨 Assemblage de l'Interface & Intégration\n");
                
                // L'UI prend tout le contexte précédent pour une fusion parfaite
                await runStreamedAgent(AGENT_SYSTEMS.UI, 
                    `Livre l'UI complète. Utilise le Blueprint: ${blueprint} et connecte-toi au Backend: ${backend}. 
                    N'oublie aucune page, aucune modale, et assure la navigation fluide.`, true);
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
