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
    prompt: `Tu es le Manager et l'Architecte Principal.
    TON OBJECTIF : Analyser et orienter. Tu es le SEUL à décider de la classification.
    
    IMPORTANT : Tu dois impérativement commencer par :
    - "CLASSIFICATION: CHAT_ONLY" : Si l'utilisateur discute (Bonjour, questions, explications).
    - "CLASSIFICATION: FIX_ACTION" : Si c'est une petite correction ou modif sur un fichier existant.
    - "CLASSIFICATION: CODE_ACTION" : Si c'est une nouvelle fonctionnalité complexe.
    
    INTERDICTION : Ne génère JAMAIS de blocs de code. Ne répète pas le travail des autres agents. Si tu es en mode CHAT_ONLY, réponds simplement. Si tu es en mode technique, donne uniquement le PLAN.`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Tu es l'Expert Correcteur. 
    TON RÔLE : Appliquer la correction demandée sur les fichiers existants.
    RÈGLE : Ne fais pas de discours, ne répète pas le manager. Donne directement le code corrigé.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Tu es l'Expert Backend.
    RÈGLES : Si l'Architecte n'a pas prévu de Backend, réponds "NO_BACKEND_CHANGES". Sinon, génère le code serveur uniquement.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Tu es l'Expert Frontend.
    RÈGLES : Implémente l'interface. Ne répète pas ce qu'a fait le Backend. Code directement l'UI.`,
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
        contents.push({ role: "user", parts: [{ text: `[HISTORIQUE INTERNE] :\n${extraContext}` }] });
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [];

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
        const send = (txt: string) => {
          // --- MASQUAGE DES TAGS TECHNIQUES ---
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
            
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
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
                temperature: 0.7, 
                maxOutputTokens: 65536,
                thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
              },
            });

            // --- SYNTAXE NOUVEAU SDK (chunk.text) ---
            for await (const chunk of response) {
              if (chunk.text) {
                const txt = chunk.text; // Utilisation de la propriété text
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

        // --- ORCHESTRATION ---

        try {
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT DECISION]:\n${architectOutput}\n`;

          const isChatOnly = architectOutput.includes("CLASSIFICATION: CHAT_ONLY");
          const isFixAction = architectOutput.includes("CLASSIFICATION: FIX_ACTION");

          if (isChatOnly) {
             // Fin immédiate pour le chat
          } else if (isFixAction) {
             // Fix rapide : Un seul agent puis fin
             await runAgent("FIXER", "Applique la correction technique immédiatement.");
          } else {
            // Processus complet
            const backendOutput = await runAgent("BACKEND", "Analyse le plan. Si rien à faire, dis NO_BACKEND_CHANGES.");
            globalContextAccumulator += `\n[BACKEND RESULT]:\n${backendOutput}\n`;

            const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");

            await runAgent("FRONTEND", noBackend ? "UI pure." : "Intègre le backend précédent.");
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
