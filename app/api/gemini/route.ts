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
    prompt: `Tu es le Manager du projet.
    TON OBJECTIF : Analyser la demande et diriger le trafic.
    
    RÈGLES DE DÉCISION STRICTES (Choisis-en UNE seule) :
    
    1. CAS "DISCUSSION" (Bonjour, questions, explications) :
       - Écris "CLASSIFICATION: CHAT_ONLY".
       - Réponds simplement à l'utilisateur de manière conviviale.
       - NE FAIS AUCUN PLAN TECHNIQUE.
       
    2. CAS "MODIFICATION / CORRECTION" (Changer une couleur, corriger un bug, modifier un texte, ajouter un petit champ) :
       - Écris "CLASSIFICATION: FIX_ACTION".
       - Identifie juste le fichier concerné et ce qu'il faut faire.
       - C'est pour des tâches qui touchent des fichiers existants.
       
    3. CAS "NOUVELLE FEATURE COMPLEXE" (Créer une nouvelle page entière, une nouvelle table DB + API + Frontend) :
       - Écris "CLASSIFICATION: CODE_ACTION".
       - Décris le plan complet (Backend + Frontend).
    
    IMPORTANT : Privilégie toujours FIX_ACTION si la demande est petite ou moyenne. N'utilise CODE_ACTION que pour les gros chantiers.`,
  },
  FIXER: {
    name: "DEV_SOLO",
    icon: "⚡", // Icone éclair pour la rapidité
    prompt: `Tu es un Développeur Fullstack autonome.
    TON RÔLE : Effectuer la modification ou la correction demandée immédiatement.
    RÈGLES :
    - Tu es capable de toucher au Backend ET au Frontend.
    - Ne fais pas de plan.
    - Génère directement le code du fichier modifié complet.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Node/DB).
    RÈGLES : Si l'Architecte n'a prévu aucun changement backend, réponds "NO_BACKEND_CHANGES". Sinon, génère le code.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend.
    RÈGLES : Génère le code UI complet en intégrant le backend si nécessaire.`,
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

      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[VIBE BOARD]" }] });
      }

      if (extraContext) {
        contents.push({ role: "user", parts: [{ text: `[CONTEXTE AGENT]:\n${extraContext}` }] });
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
        // --- FILTRE VISUEL (Invisible pour l'utilisateur) ---
        const send = (txt: string) => {
          // On retire les tags de classification et le message technique du backend
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
          
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        let globalContextAccumulator = ""; 

        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          
          // On n'affiche l'icône de l'agent QUE si ce n'est pas l'Architecte en mode Chat (géré plus bas)
          // ou on l'affiche toujours pour le style, à toi de voir. Ici je le laisse.
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);

          let batchBuffer = "";
          let fullAgentOutput = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            const systemInstruction = `${basePrompt}\n\n=== ROLE: ${agent.name} ===\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction },
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 65536,
              },
            });

            for await (const chunk of response) {
              const txt = chunk.text();
              batchBuffer += txt;
              fullAgentOutput += txt;
              if (batchBuffer.length >= BATCH_SIZE) {
                send(batchBuffer);
                batchBuffer = "";
              }
            }
            if (batchBuffer.length > 0) send(batchBuffer);
            
            return fullAgentOutput;

          } catch (e: any) {
            send(`\n[Erreur ${agent.name}]: ${e.message}`);
            return "";
          }
        }

        // --- ORCHESTRATION ---

        try {
          // 1. L'Architecte décide
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT]:\n${architectOutput}\n`;

          // 2. Analyse de la décision
          const isChatOnly = architectOutput.includes("CLASSIFICATION: CHAT_ONLY");
          const isFixAction = architectOutput.includes("CLASSIFICATION: FIX_ACTION");

          if (isChatOnly) {
            // CAS 1: Discussion simple. 
            // L'Architecte a déjà répondu via le stream. On coupe.
            controller.close();
            return;
          } 
          
          if (isFixAction) {
            // CAS 2: Modification/Correction (Mode Solo)
            // On lance uniquement le FIXER (Dev Solo)
            await runAgent("FIXER", "Exécute la modification demandée sur les fichiers existants.");
            controller.close();
            return;
          }

          // CAS 3: Grosse Feature (Mode Team)
          // On lance la chaîne complète Backend -> Frontend
          const backendOutput = await runAgent("BACKEND", "Implémente la logique serveur.");
          globalContextAccumulator += `\n[BACKEND]:\n${backendOutput}\n`;

          const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");
          
          await runAgent("FRONTEND", 
            noBackend 
              ? "Pas de changement backend. Modifie l'UI uniquement." 
              : "Intègre le code backend ci-dessus."
          );

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
