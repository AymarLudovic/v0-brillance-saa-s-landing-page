import { NextResponse } from "next/server";
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; 

// --- CONFIGURATION ---
const BATCH_SIZE = 128;
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

const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es l'Architecte Technique Principal.
    TON OBJECTIF : Analyser la demande et décider de la stratégie.
    
    IMPORTANT : Commence ta réponse par une ligne de "CLASSIFICATION" :
    - Si c'est juste une discussion/explication : "CLASSIFICATION: CHAT_ONLY".
    - Si c'est un petit fix/correction d'erreur précise : "CLASSIFICATION: FIX_ACTION".
    - Si c'est une modification lourde ou nouvelle feature : "CLASSIFICATION: CODE_ACTION".
    
    RÈGLE : Ne répète JAMAIS la demande de l'utilisateur. Va droit au but.`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Tu es l'Expert en Correction Rapide.
    TON RÔLE : Appliquer la correction demandée immédiatement.
    RÈGLE : Ne ré-explique pas le plan. Génère uniquement le code corrigé.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Tu es l'Expert Backend (Node.js/Next.js).
    RÈGLES : 
    - Si aucun changement backend n'est nécessaire, réponds UNIQUEMENT "NO_BACKEND_CHANGES".
    - Ne répète pas ce que l'Architecte a dit. Génère uniquement le code.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Tu es l'Expert Frontend.
    RÈGLES :
    - Génère le code complet.
    - Ne fais pas de résumé du travail déjà effectué par les autres agents.`,
  },
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();

    const buildBaseContents = (extraContext: string = "") => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[SYSTEME VISUEL : VIBE BOARD]" }] });
      }
      if (extraContext) {
        contents.push({ role: "user", parts: [{ text: `[CONTEXTE INTERNE] :\n${extraContext}` }] });
      }
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        const parts: Part[] = [];
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          uploadedFiles?.forEach((f: any) =>
            parts.push({ inlineData: { data: f.base64Content, mimeType: "text/plain" }, text: `\n[Fichier: ${f.fileName}]` } as any)
          );
        }
        parts.push({ text: msg.content || " " });
        contents.push({ role, parts });
      });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        // --- AMÉLIORATION : FONCTION SEND AVEC MASQUAGE ---
        const send = (txt: string) => {
          // On retire les balises de classification pour l'utilisateur
          const maskedTxt = txt.replace(/CLASSIFICATION:\s*[A-Z_]+|NO_BACKEND_CHANGES/gi, "");
          if (maskedTxt) controller.enqueue(encoder.encode(maskedTxt));
        };
        
        let globalContextAccumulator = ""; 

        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [PHASE: ${agent.name}] ---\n\n`);

          let batchBuffer = "";
          let fullAgentOutput = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            const systemInstruction = `${basePrompt}\n\n=== MODE AGENT ACTIF ===\nTU ES: ${agent.name}\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction },
              generationConfig: {
                temperature: 0.7, // Changé à 0.7 comme demandé
                maxOutputTokens: 65536,
                thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
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
            return fullAgentOutput;
          } catch (e: any) {
            send(`\n[ERROR ${agent.name}]: ${e.message}`);
            return "";
          }
        }

        try {
          // 1. L'ARCHITECTE ANALYSE
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT DECISION]:\n${architectOutput}\n`;

          // 2. ROUTAGE INTELLIGENT
          const isChatOnly = architectOutput.includes("CLASSIFICATION: CHAT_ONLY");
          const isFixAction = architectOutput.includes("CLASSIFICATION: FIX_ACTION");

          if (isChatOnly) {
            // Fin directe
          } else if (isFixAction) {
            // --- AMÉLIORATION : FIX RAPIDE ---
            await runAgent("FIXER", "Applique uniquement le correctif technique sans refaire d'analyse.");
          } else {
            // PROCESSUS COMPLET
            const backendOutput = await runAgent("BACKEND", "Ne répète pas le plan. Produis le code.");
            globalContextAccumulator += `\n[BACKEND RESULT]:\n${backendOutput}\n`;

            const noBackendWork = backendOutput.includes("NO_BACKEND_CHANGES");
            await runAgent("FRONTEND", noBackendWork ? "Concentre-toi sur l'UI pure." : "Intègre le code backend ci-dessus.");
          }

          controller.close();
        } catch (globalError: any) {
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
