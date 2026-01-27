import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; 

const BATCH_SIZE = 128;
// Modèle spécifié par l'utilisateur
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
    // Prompt durci : On lui interdit techniquement de produire du code exécutable
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    TA MISSION UNIQUE : Analyser la demande et déléguer le travail aux développeurs (Backend et Frontend).
    
    ⛔ INTERDICTIONS FORMELLES (Si tu ne respectes pas, le processus échoue) :
    1. TU NE DOIS PAS ÉCRIRE DE CODE (PAS de HTML, PAS de CSS, PAS de JS, PAS de Python).
    2. Tu ne fais PAS le travail toi-même. Tu donnes des ORDRES.
    3. Tu ne poses pas de questions à l'utilisateur.
    
    FORMAT DE RÉPONSE OBLIGATOIRE :
    Tu dois commencer ta réponse par une ligne de classification, suivie d'un plan textuel.
    
    Choix de classification :
    - "CLASSIFICATION: CHAT_ONLY" -> Pour une discussion générale.
    - "CLASSIFICATION: FIX_ACTION" -> Pour une petite correction sur un fichier existant.
    - "CLASSIFICATION: CODE_ACTION" -> Pour créer une fonctionnalité, une page, ou modifier le code.
    
    Exemple de réponse attendue (Respecte ce format) :
    CLASSIFICATION: CODE_ACTION
    
    Plan d'exécution :
    1. Backend : Créer une route API pour gérer les utilisateurs.
    2. Frontend : Créer une interface avec un tableau et un bouton.`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Tu reçois un fichier et une instruction. Renvoie uniquement le code corrigé complet. Pas de markdown inutile, pas d'explications.`,
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
      
      // Images de référence (Style)
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
      }
      
      // Contexte Système (Accumulateur de résultats d'agents)
      if (extraContext) {
        contents.push({ role: "user", parts: [{ text: `[CONTEXTE SYSTEME INTERNE]:\n${extraContext}` }] });
      }
      
      // Historique
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
          // On nettoie les tags de contrôle pour ne pas polluer l'affichage utilisateur
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

            // Réglage de la température : L'Architecte doit être froid (0.1) pour respecter les règles
            // Les Devs peuvent être un peu plus créatifs (0.7)
            const temperature = agentKey === "ARCHITECT" ? 0.3 : 0.7;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction, temperature, maxOutputTokens: 65536 },
            });

            for await (const chunk of response) {
              // Avec le nouveau SDK, on vérifie la présence de texte
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
            console.error(`Erreur Agent ${agent.name}:`, e);
            return "";
          }
        }

        try {
          // 1. L'Architecte PLANIFIE (avec température basse pour obéir)
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT_PLAN]: ${architectOutput}\n`;

          // 2. Détection robuste de la classification
          // On utilise une regex pour trouver la clé même si l'architecte met du texte autour
          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; // Par défaut si échec
          
          if (decision === "CHAT_ONLY") {
            // Fin
          } 
          else if (decision === "FIX_ACTION") {
            await runAgent("FIXER", "Instruction: Applique le correctif technique sur le fichier concerné.");
          } 
          else if (decision === "CODE_ACTION") {
            // MODE CODE : On force l'exécution séquentielle
            
            // Backend
            const backendOutput = await runAgent("BACKEND", "Instruction: Implémente le code serveur basé sur le plan ci-dessus. Si pas de back, réponds NO_BACKEND_CHANGES.");
            globalContextAccumulator += `\n[BACKEND_CODE]: ${backendOutput}\n`;
            
            const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");
            
            // Frontend (Reçoit le contexte global incluant le code backend)
            await runAgent("FRONTEND", noBackend 
              ? "Instruction: Le backend n'a pas changé. Génère l'UI (React/Tailwind) selon le plan." 
              : "Instruction: Intègre le code Backend fourni juste au-dessus et génère l'UI complète."
            );
          }

          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
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
