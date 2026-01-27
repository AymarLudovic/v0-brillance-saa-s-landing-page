import { NextResponse } from "next/server";
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; // On garde ton import, mais on l'utilisera par morceaux ou comme base globale

// --- CONFIGURATION ---
const BATCH_SIZE = 128; // Réduit un peu pour plus de fluidité visuelle
const MODEL_ID = "gemini-3-flash-preview";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// --- UTILITAIRES ---
function getMimeTypeFromBase64(dataUrl: string): string {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string): string {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// --- DÉFINITION DES AGENTS (PERSONAS) ---
// Chaque agent a une responsabilité unique pour éviter la confusion.

const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es l'Architecte Technique Principal.
    TON RÔLE : Analyser la demande, le "Vibe Board", et établir le plan d'action technique.
    OUTPUT ATTENDU : Une analyse brève et structurée. Tu ne codes PAS encore, tu décides QUOI coder.
    Si la demande est simple (ex: "Bonjour"), réponds simplement et indique "NO_CODE_REQUIRED".
    Sinon, liste les fichiers backend et frontend à créer/modifier.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Tu es l'Expert Backend (Node.js/Next.js API/DB).
    TON RÔLE : Générer EXCLUSIVEMENT le code côté serveur (API Routes, Database Schema, Server Actions) basé sur le plan de l'Architecte.
    RÈGLES : 
    - Ne génère PAS de composants React (UI).
    - Sois robuste, gère les erreurs (try/catch).
    - Utilise les fichiers existants via l'outil si nécessaire.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Tu es l'Expert Frontend .
    TON RÔLE : Générer l'interface utilisateur qui se connecte au Backend créé précédemment.
    RÈGLES :
    - Respecte le "Vibe Board" (images de référence) au pixel près.
    - Utilise des composants modernes.
    - Connecte les appels API au backend généré par l'agent précédent.`,
  },
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles, currentPlan } = body;

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();

    // --- CONSTRUCTION DU CONTEXTE DE BASE (PARTAGÉ) ---
    // Cette fonction prépare les éléments communs (images, fichiers, historique)
    const buildBaseContents = (extraContext: string = "") => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];

      // 1. Injection du Vibe Board
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({
          role: "user",
          parts: [...(styleParts as any), { text: "[SYSTEME VISUEL : VIBE BOARD - REFERENCE ABSOLUE]" }],
        });
      }

      // 2. Contexte dynamique accumulé (ce que les agents précédents ont dit)
      if (extraContext) {
        contents.push({
          role: "user",
          parts: [{ text: `[CONTEXTE TECHNIQUE PRÉCÉDENT / OUTPUT DES AUTRES AGENTS] :\n${extraContext}` }],
        });
      }

      // 3. Historique standard
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        const parts: Part[] = [];
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";

        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          uploadedFiles?.forEach((f: any) =>
            parts.push({
              inlineData: { data: f.base64Content, mimeType: "text/plain" },
              text: `\n[Fichier existant: ${f.fileName}]`,
            } as any)
          );
        }
        parts.push({ text: msg.content || " " });
        contents.push({ role, parts });
      });

      return contents;
    };

    // --- LE STREAM ORCHESTRÉ ---
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        
        // Variable pour accumuler tout ce qui est généré pour le passer à l'agent suivant
        let globalContextAccumulator = ""; 

        // Fonction générique pour exécuter un agent
        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          
          // Marqueur visuel pour le frontend (pour que tu voies le changement d'agent)
          send(`\n\n--- ${agent.icon} [PHASE: ${agent.name}] ---\n\n`);

          let batchBuffer = "";
          let fullAgentOutput = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            
            // On ajoute l'instruction spécifique de l'agent à la fin ou en System Instruction
            // Pour Gemini 3, le systemInstruction est puissant.
            const systemInstruction = `${basePrompt}\n\n[ACTUELLEMENT TU ES L'AGENT: ${agent.name}]\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: {
                systemInstruction: systemInstruction,
              },
              generationConfig: {
                temperature: 0.7, // Un peu plus précis pour le code
                maxOutputTokens: 65536,
                // On garde thinkingConfig activé surtout pour l'architecte, peut-être moins pour les autres pour aller vite ?
                // Gardons-le partout pour la puissance du modèle 3.
                thinkingConfig: {
                  includeThoughts: true,
                  thinkingLevel: "high", 
                },
              },
            });

            for await (const chunk of response) {
              if (chunk.text) {
                const txt = chunk.text;
                batchBuffer += txt;
                fullAgentOutput += txt;

                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = "";
                }
              }
            }
            if (batchBuffer.length > 0) send(batchBuffer);
            
            // On retourne le résultat complet pour l'ajouter à la mémoire globale
            return fullAgentOutput;

          } catch (e: any) {
            send(`\n[ERROR ${agent.name}]: ${e.message}`);
            return `Error in ${agent.name}`;
          }
        }

        // --- EXÉCUTION DU PIPELINE (LA LOGIQUE MULTI-AGENTS) ---

        try {
          // ÉTAPE 1 : L'ARCHITECTE
          // Il analyse tout et décide.
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT PLAN]:\n${architectOutput}\n`;

          // Logique de branchement simple
          const isSimpleChat = architectOutput.includes("NO_CODE_REQUIRED");

          if (!isSimpleChat) {
            // ÉTAPE 2 : LE BACKEND DEV
            // Il voit le plan de l'architecte et génère l'API.
            const backendOutput = await runAgent("BACKEND", "Base-toi STRICTEMENT sur le plan de l'Architecte ci-dessus.");
            globalContextAccumulator += `\n[BACKEND IMPLEMENTATION]:\n${backendOutput}\n`;

            // ÉTAPE 3 : LE FRONTEND DEV
            // Il voit le plan ET le code backend généré pour faire les bons fetchs.
            await runAgent("FRONTEND", "Connecte-toi au Backend ci-dessus et respecte le style visuel.");
          }

          // Fin du stream
          controller.close();

        } catch (globalError: any) {
          send(`\n\n[SYSTEM CRITICAL ERROR]: ${globalError.message}`);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
      }
