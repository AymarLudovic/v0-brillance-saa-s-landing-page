import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
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

// --- DEFINITION DES AGENTS AVEC PROMPTS BLINDÉS ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    // Prompt durci pour bien séparer FIX et CODE
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    TA MISSION : Analyser la demande et choisir la BONNE voie d'exécution.
    
    RÈGLES DE DÉCISION STRICTES :
    1. Si l'utilisateur veut juste DISCUTER ou une explication -> "CLASSIFICATION: CHAT_ONLY"
    2. Si l'utilisateur signale une ERREUR, un BUG ou demande une CORRECTION sur un fichier précis -> "CLASSIFICATION: FIX_ACTION" (Ceci est prioritaire sur le code action).
    3. Si l'utilisateur veut CRÉER une nouvelle fonctionnalité, une page ou MODIFIER une structure -> "CLASSIFICATION: CODE_ACTION"
    
    ⛔ INTERDICTIONS :
    - TU NE DOIS PAS ÉCRIRE DE CODE.
    - Tu ne poses pas de questions.
    
    FORMAT DE RÉPONSE OBLIGATOIRE (Commence par ceci) :
    CLASSIFICATION: [TON_CHOIX]
    
    Plan d'exécution :
    [Ton explication textuelle ici]`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Tu reçois un fichier et une instruction d'erreur.
    Ta mission : Renvoyer UNIQUEMENT le code complet corrigé du fichier.
    - Pas d'explication textuelle avant ou après (ou très peu).
    - Pas de markdown inutile si possible, juste le bloc de code.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Next.js / Node).
    Ta tâche : Lire le plan de l'Architecte et implémenter la partie SERVEUR uniquement.
    - Si le plan ne demande que du visuel (HTML/CSS), réponds UNIQUEMENT : "NO_BACKEND_CHANGES".
    - Sinon, fournis le code des API/Server Actions.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend (React / Tailwind).
    Ta tâche : Implémenter l'interface utilisateur selon le plan de l'Architecte.
    - Si le Backend a fourni du code, utilise-le.
    - Concentre-toi sur le code JSX/TSX.`,
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
        contents.push({ role: "user", parts: [{ text: `[CONTEXTE SYSTEME INTERNE]:\n${extraContext}` }] });
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
            const systemInstruction = `${basePrompt}\n\n=== RÔLE ACTUEL: ${agent.name} ===\n${agent.prompt}`;

            const temperature = agentKey === "ARCHITECT" ? 0.3 : 0.7;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction, temperature, maxOutputTokens: 65536 },
            });

            for await (const chunk of response) {
              const txt = chunk.text; 
              if (txt) {
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
            // CORRECTION PRINCIPALE ICI : On capture l'erreur et on l'envoie au client
            const errorMsg = `\n\n⚠️ [ERREUR ${agent.name}]: ${e.message || "Erreur inconnue"}\n`;
            console.error(errorMsg, e);
            send(errorMsg); // Affiche l'erreur dans le chat
            return errorMsg; // Retourne l'erreur pour que le flux continue proprement ou s'arrête
          }
        }

        try {
          // 1. L'Architecte PLANIFIE
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT_PLAN]: ${architectOutput}\n`;

          // 2. Détection de la classification
          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY";
          
          // DEBUG : On peut décommenter ceci si tu veux voir la décision dans la console serveur
          // console.log("DECISION ARCHITECTE:", decision);

          if (decision === "CHAT_ONLY") {
            // Fin normale
          } 
          else if (decision === "FIX_ACTION") {
            // MODE FIX : Uniquement le Fixer. Le Backend ne DOIT PAS s'exécuter après.
            await runAgent("FIXER", "Instruction: Applique le correctif technique sur le fichier concerné.");
          } 
          else if (decision === "CODE_ACTION") {
            // MODE CODE : Backend -> Frontend
            
            const backendOutput = await runAgent("BACKEND", "Instruction: Implémente le code serveur basé sur le plan ci-dessus. Si pas de back, réponds NO_BACKEND_CHANGES.");
            globalContextAccumulator += `\n[BACKEND_CODE]: ${backendOutput}\n`;
            
            const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");
            
            await runAgent("FRONTEND", noBackend 
              ? "Instruction: Le backend n'a pas changé. Génère l'UI (React/Tailwind) selon le plan." 
              : "Instruction: Intègre le code Backend fourni juste au-dessus et génère l'UI complète."
            );
          }

          controller.close();
        } catch (err: any) {
          // Erreur globale du stream (hors agents)
          const criticalError = `\n\n🚨 [SYSTEM ERROR]: ${err.message}`;
          console.error(criticalError);
          send(criticalError);
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
