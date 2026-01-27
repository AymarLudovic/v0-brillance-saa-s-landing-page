import { NextResponse } from "next/server";
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; 

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
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

const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es l'Architecte Décideur. Ton rôle est de CLASSER et de PLANIFIER.
    
    RÈGLES ABSOLUES :
    1. Tu ne poses JAMAIS de questions à l'utilisateur (pas de "Valides-tu ?", pas de "Qu'en penses-tu ?").
    2. Tu ne demandes JAMAIS de validation. Tu es le chef, tu décides.
    3. Si tu as déjà fait une analyse dans l'historique, ne la répète pas : passe directement à la CLASSIFICATION.
    
    FORMAT DE RÉPONSE :
    - Commencer par "CLASSIFICATION: CHAT_ONLY", "CLASSIFICATION: FIX_ACTION" ou "CLASSIFICATION: CODE_ACTION".
    - Si CODE_ACTION : Donne le plan technique et arrête-toi là. L'équipe technique prendra le relais automatiquement après toi.`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Applique la modif sur les fichiers existants. Pas de blabla, juste le code corrigé. Ne répète pas l'analyse du manager.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend. Si rien à faire : "NO_BACKEND_CHANGES". Sinon, code serveur uniquement. Ne répète rien, produis du code.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend. Produis l'UI. Ne répète pas le travail du backend ou de l'architecte.`,
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
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
      }
      if (extraContext) {
        contents.push({ role: "user", parts: [{ text: `[SYSTEM CONTEXT]:\n${extraContext}` }] });
      }
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => {
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        let globalContextAccumulator = ""; 

        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            const systemInstruction = `${basePrompt}\n\nTU ES: ${agent.name}\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction },
              generationConfig: { temperature: 0.7, maxOutputTokens: 65536 },
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
            return "";
          }
        }

        try {
          // 1. L'Architecte lance le bal
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT_DECIDED]: ${architectOutput}\n`;

          // 2. Analyse de la décision (on passe en majuscule pour être sûr)
          const decision = architectOutput.toUpperCase();
          
          if (decision.includes("CLASSIFICATION: CHAT_ONLY")) {
            // Fin du flux
          } 
          else if (decision.includes("CLASSIFICATION: FIX_ACTION")) {
            await runAgent("FIXER", "Applique le fix maintenant sans discuter.");
          } 
          else {
            // MODE CODE_ACTION : On force la suite sans demander d'avis
            const backendOutput = await runAgent("BACKEND", "Le manager a validé le plan. Produis le code API maintenant.");
            globalContextAccumulator += `\n[BACKEND_CODE]: ${backendOutput}\n`;

            const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");
            await runAgent("FRONTEND", noBackend ? "Code l'UI uniquement." : "Intègre le backend fourni ci-dessus.");
          }

          controller.close();
        } catch (err) {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
                                          }
