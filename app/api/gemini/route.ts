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
    TON OBJECTIF : Analyser la demande utilisateur et décider de la stratégie.
    
    IMPORTANT : Tu dois commencer ta réponse par une ligne de "CLASSIFICATION" stricte :
    - Si l'utilisateur veut juste discuter, poser une question ou demande une explication : Écris "CLASSIFICATION: CHAT_ONLY" puis réponds-lui.
    - Si l'utilisateur a une petite erreur ou une correction rapide sur des fichiers existants : Écris "CLASSIFICATION: FIX_ACTION" puis cible l'erreur.
    - Si l'utilisateur veut une grosse modification, une nouvelle feature ou créer des fichiers : Écris "CLASSIFICATION: CODE_ACTION" puis décris le plan.
    
    MINI-INSTRUCTION : Ne répète JAMAIS la demande de l'utilisateur. Sois concis et direct.`,
  },
  FIXER: { // Ajout de l'agent Fixer
    name: "FIXER",
    icon: "🛠️",
    prompt: `Tu es l'Expert en Correction Rapide.
    TON RÔLE : Appliquer la correction demandée immédiatement sans créer de nouveaux fichiers inutiles.
    MINI-INSTRUCTION : Ne fais pas d'analyse. Génère directement le code corrigé. Ne répète pas le plan.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Tu es l'Expert Backend (Node.js/Next.js API/DB).
    TON RÔLE : Implémenter la logique serveur définie par l'Architecte.
    RÈGLES : 
    - Si le plan de l'Architecte ne mentionne AUCUN changement backend, réponds simplement "NO_BACKEND_CHANGES".
    - Sinon, génère EXCLUSIVEMENT le code serveur (API, DB).
    - Ne touche PAS au Frontend.
    MINI-INSTRUCTION : Ne répète pas le plan de l'Architecte. Code direct.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Tu es l'Expert Frontend.
    TON RÔLE : Implémenter l'interface utilisateur.
    RÈGLES :
    - Connecte-toi aux APIs créées par l'agent Backend (si applicable).
    - Si le Backend a dit "NO_BACKEND_CHANGES", utilise les APIs existantes ou mockées.
    - Génère le code complet.
    MINI-INSTRUCTION : Ne résume pas le travail des autres. Code l'UI direct.`,
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

    // --- CONSTRUCTION DU CONTEXTE ---
    const buildBaseContents = (extraContext: string = "") => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];

      // 1. Vibe Board
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({
          role: "user",
          parts: [...(styleParts as any), { text: "[SYSTEME VISUEL : VIBE BOARD]" }],
        });
      }

      // 2. Contexte dynamique (Mémoire de travail des agents)
      if (extraContext) {
        contents.push({
          role: "user",
          parts: [{ text: `[HISTORIQUE INTERNE DES AGENTS] :\n${extraContext}` }],
        });
      }

      // 3. Historique conversation
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

    const stream = new ReadableStream({
      async start(controller) {
        
        // --- 1. MODIFICATION: FILTRE DE MASQUAGE ---
        const send = (txt: string) => {
           // Regex pour supprimer les tags techniques avant l'envoi au client
           const sanitized = txt.replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)|NO_BACKEND_CHANGES/gi, "");
           if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        // Mémoire globale de la session de génération
        let globalContextAccumulator = ""; 

        // Fonction d'exécution d'un agent
        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          
          send(`\n\n--- ${agent.icon} [PHASE: ${agent.name}] ---\n\n`);

          let batchBuffer = "";
          let fullAgentOutput = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            
            // Injection du System Prompt spécifique + Base Prompt
            const systemInstruction = `${basePrompt}\n\n=== MODE AGENT ACTIF ===\nTU ES: ${agent.name}\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction },
              generationConfig: {
                temperature: 0.7, // --- 2. MODIFICATION: TEMPÉRATURE 0.7 ---
                maxOutputTokens: 65536,
                thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
              },
            });

            // --- BOUCLE ORIGINALE (POUR ÉVITER L'ERREUR s.text) ---
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
            return `Error in ${agent.name}`; // Fallback
          }
        }

        // --- ORCHESTRATION INTELLIGENTE ---

        try {
          // 1. L'ARCHITECTE ANALYSE
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT DECISION]:\n${architectOutput}\n`;

          // 2. DÉCISION DE ROUTAGE
          const isChatOnly = architectOutput.includes("CLASSIFICATION: CHAT_ONLY");
          const isFixAction = architectOutput.includes("CLASSIFICATION: FIX_ACTION"); // Nouveau flag

          // --- 3. MODIFICATION: LOGIQUE D'ARRÊT & FAST FIX ---
          
          if (isChatOnly) {
            // CAS 1: Discussion seule. On arrête tout ici.
            controller.close();
            return; // IMPORTANT : Empêche l'exécution du reste
          } 
          
          if (isFixAction) {
            // CAS 2: Fix Rapide. On lance UNIQUEMENT le Fixer puis on arrête.
            await runAgent("FIXER", "Applique la correction technique immédiatement.");
            controller.close();
            return; // IMPORTANT : On ne lance pas Backend/Frontend
          }

          // CAS 3: Code Action (Processus complet)
          
          // 3. BACKEND (Conditionnel)
          const backendOutput = await runAgent("BACKEND", "Analyse le plan de l'Architecte. Si rien à faire côté serveur, dis-le.");
          globalContextAccumulator += `\n[BACKEND RESULT]:\n${backendOutput}\n`;

          const noBackendWork = backendOutput.includes("NO_BACKEND_CHANGES");

          // 4. FRONTEND
          await runAgent("FRONTEND", 
            noBackendWork 
              ? "Le Backend n'a pas changé. Concentre-toi sur l'UI/UX pure."
              : "Intègre les nouvelles routes API créées par le Backend ci-dessus."
          );

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
