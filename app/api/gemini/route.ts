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

// --- DEFINITION DES AGENTS ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    // Prompt modifié pour être plus humain et planifier une seule fois
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    TON RÔLE : Tu es un humain, un expert senior. Tu discutes avec l'utilisateur pour comprendre son besoin.
    
    RÈGLES D'OR :
    1. ⛔ TU NE CODES JAMAIS. C'est interdit. Pas de balises de code.
    2. Ton ton est professionnel, empathique et direct.
    3. Si l'utilisateur veut créer quelque chose, tu dois sortir un PLAN.
    
    FORMAT DE SORTIE (Si demande de création) :
    CLASSIFICATION: CODE_ACTION
    
    Plan d'exécution :
    1. Backend : [Détails techniques précis]
    2. Frontend : [Détails UI/UX précis]
    
    Si l'utilisateur dit juste "Bonjour" ou pose une question simple :
    CLASSIFICATION: CHAT_ONLY
    [Ta réponse normale]`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Tu reçois un fichier et une instruction. Renvoie uniquement le code corrigé complet. Pas de markdown inutile.`,
  },

  // --- CHAINE BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Next.js / Node).
    Ta tâche : Lire le plan et implémenter le SERVEUR.
    - Si le plan ne demande que du visuel, réponds : "NO_BACKEND_CHANGES".
    - Sinon, fournis le code API/Server Actions.`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior (Review).
    Ta tâche : Analyser le code précédent et le comparer au Plan de l'Architecte.
    - COMPLÈTE le code manquant.
    - CORRIGE les erreurs.
    - Renvoie TOUT le code backend (l'ancien corrigé + le nouveau).`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Final Backend.
    Ta tâche : Validation finale avant envoi au front.
    - Vérifie types, imports, sécurité.
    - Renvoie le code final propre.`,
  },

  // --- CHAINE FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend ().
    Ta tâche : Créer l'UI de base selon le plan et le code Backend fourni.
    - Utilise le backend existant.
    - Structure les pages et composants.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Expert UX/UI & Motion.
    Ta tâche : Sublimer l'interface précédente.
    - Améliore le design ( avancé).
    - Ajoute des animations ( CSS).
    - Ne casse pas la logique  existante.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final.
    Ta tâche : Vérification finale et mise en production.
    - Vérifie que tous les liens et boutons fonctionnent.
    - Vérifie qu'il ne manque aucune page du plan.
    - Renvoie le code UI FINAL complet.`,
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

    // Fonction de base pour l'historique pur (sans contexte interne injecté ici)
    const buildHistoryParts = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // Images de référence
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
      }
      
      // Historique de conversation
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        // Ajout des images uniquement au dernier message utilisateur réel
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

        // --- C'EST ICI QUE LA MAGIE OPÈRE POUR ÉVITER LA BOUCLE ---
        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            // 1. On récupère l'historique de chat "pur"
            const contents = buildHistoryParts();

            // 2. LOGIQUE CRUCIALE : Si ce n'est PAS l'architecte, on injecte le contexte APRES l'historique
            // Cela force le modèle à agir sur le contexte immédiat et non sur le dernier message utilisateur
            if (agentKey !== "ARCHITECT") {
              const taskContext = `
              [CONTEXTE TECHNIQUE INTERNE - NE PAS RÉPONDRE À L'UTILISATEUR MAIS À CETTE INSTRUCTION]
              
              HISTORIQUE DU PROJET JUSQU'À PRÉSENT :
              ${globalContextAccumulator}
              
              ------------------------------------------
              
              TON INSTRUCTION IMMÉDIATE (${agent.name}) :
              ${contextOverride}
              
              Agis UNIQUEMENT selon cette instruction. Ne salue pas l'utilisateur. Génère le code/contenu demandé.
              `;
              
              // On ajoute cela comme un nouveau message "user" simulé à la fin
              contents.push({ role: "user", parts: [{ text: taskContext }] });
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ ACTUELLE: ${agent.name} ===\n${agent.prompt}`;

            // Température : Basse pour Architecte/QA, Haute pour Créatifs
            const temperature = (agentKey === "ARCHITECT" || agentKey.includes("FINALIZER") || agentKey.includes("AUDITOR")) ? 0.4 : 0.95;

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
            console.error(`Erreur Agent ${agent.name}:`, e);
            return "";
          }
        }

        try {
          // --- 1. ARCHITECTE (Seul à voir l'historique comme une conversation normale) ---
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[PLAN_ARCHITECTE]: ${architectOutput}\n`;

          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          } 
          
          else if (decision === "FIX_ACTION") {
            await runAgent("FIXER", "Instruction: Corrige le fichier fourni par l'utilisateur.");
            controller.close();
            return;
          } 
          
          else if (decision === "CODE_ACTION") {
            // --- SÉQUENCE STRICTE DE CODE ---
            // À partir d'ici, runAgent injecte le contexte à la FIN, empêchant la boucle

            // Backend 1
            const backend1 = await runAgent("BACKEND", "Instruction: Basé sur le plan Architecte, génère le code serveur V1.");
            
            // Backend 2 (Reviewer) - Reçoit le code V1
            const backend2 = await runAgent("BACKEND_REVIEWER", 
              `Code V1 : ${backend1}\n\nInstruction: Analyse, complète et corrige le code V1 pour qu'il colle parfaitement au plan.`
            );
            
            // Backend 3 (Auditor) - Reçoit le code V2
            const backend3 = await runAgent("BACKEND_AUDITOR", 
              `Code V2 : ${backend2}\n\nInstruction: Validation finale technique. Nettoie le code pour le front.`
            );
            
            globalContextAccumulator += `\n[BACKEND_FINAL]: ${backend3}\n`;
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");

            // Frontend 1
            const frontend1 = await runAgent("FRONTEND", noBackend
              ? "Instruction: Backend inchangé. Génère l'UI V1 selon le plan."
              : "Instruction: Utilise le [BACKEND_FINAL] ci-dessus. Génère l'UI V1 (Structure)."
            );

            // Frontend 2 (Designer) - Reçoit UI V1
            const frontend2 = await runAgent("FRONTEND_DESIGNER", 
              `UI V1 : ${frontend1}\n\nInstruction: Transforme cette UI V1 en UI Premium (Design, Animations). Ne change pas la logique.`
            );

            // Frontend 3 (Finalizer) - Reçoit UI V2
            await runAgent("FRONTEND_FINALIZER", 
              `UI Designée : ${frontend2}\n\nInstruction: Vérifie les liens, les types et finalise le code pour production.`
            );

            controller.close();
          }

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
