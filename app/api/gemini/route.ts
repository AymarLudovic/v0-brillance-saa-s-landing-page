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
    prompt: `Expert Frontend (React).
    Ta tâche : Créer l'UI de base selon le plan et le code Backend fourni.
    - Utilise le backend existant.
    - Structure les pages et composants.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Expert UX/UI & Motion.
    Ta tâche : Sublimer l'interface précédente.
    - Améliore le design (Tailwind avancé).
    - Ajoute des animations (CSS).
    - Ne casse pas la logique JSX/TSX existante.`,
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

    // Fonction de base pour l'historique pur
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
        
        // --- MODIFICATION MAJEURE ICI : Gestion des contextes ---
        async function runAgent(
            agentKey: keyof typeof AGENTS, 
            taskInput: string = "", 
            useChatHistory: boolean = false // Nouveau paramètre crucial
        ) {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            let contents;

            if (useChatHistory) {
                // 1. CAS ARCHITECTE : On charge tout l'historique de chat
                contents = buildHistoryParts();
                // On peut ajouter une instruction système finale si besoin, mais l'historique suffit souvent
            } else {
                // 2. CAS WORKERS (Backend, Frontend...) : ZERO Historique Chat
                // On crée un tableau de contenu "frais". L'agent ne voit QUE sa tâche.
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION TECHNIQUE STRICTE]
                    Tu es un module d'exécution. Tu ne converses pas.
                    
                    DONNÉES D'ENTRÉE :
                    ${taskInput}
                    
                    TA TÂCHE :
                    Agis en tant que ${agent.name}. Exécute la tâche demandée sur les données d'entrée.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ: ${agent.name} ===\n${agent.prompt}`;
            
            // Température : 0.4 pour être précis si ce n'est pas du design créatif
            const temperature = (agentKey === "FRONTEND_DESIGNER") ? 0.8 : 0.3;

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
          // --- 1. ARCHITECTE (C'est le seul qui a useChatHistory = true) ---
          const architectOutput = await runAgent("ARCHITECT", "", true);

          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          } 
          
          else if (decision === "FIX_ACTION") {
            // Le Fixer a besoin de contexte, on peut lui laisser l'historique ou lui passer le fichier
            await runAgent("FIXER", "Corrige le fichier selon la demande.", true);
            controller.close();
            return;
          } 
          
          else if (decision === "CODE_ACTION") {
            // --- SÉQUENCE STRICTE DE CODE (WATERFALL) ---
            // Tous les agents ci-dessous ont useChatHistory = false (par défaut)
            // Ils ne voient PAS "Bonjour je veux..." de l'utilisateur.

            // Backend 1 : Reçoit le Plan
            const backend1 = await runAgent("BACKEND", `PLAN TECHNIQUE:\n${architectOutput}`);
            
            // Backend 2 : Reçoit Code V1
            const backend2 = await runAgent("BACKEND_REVIEWER", 
              `CONTEXTE:\nPlan Architecte: ${architectOutput}\n\nCODE A REVOIR:\n${backend1}`
            );
            
            // Backend 3 : Reçoit Code V2
            const backend3 = await runAgent("BACKEND_AUDITOR", 
               `CODE A VALIDER:\n${backend2}`
            );
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backend3;

            // Frontend 1 : Reçoit Backend Final + Plan
            const frontend1 = await runAgent("FRONTEND", 
               `PLAN:\n${architectOutput}\n\nBACKEND DISPONIBLE:\n${finalBackendCode}`
            );

            // Frontend 2 : Reçoit UI V1
            const frontend2 = await runAgent("FRONTEND_DESIGNER", 
               `CODE UI BRUT:\n${frontend1}`
            );

            // Frontend 3 : Reçoit UI V2
            await runAgent("FRONTEND_FINALIZER", 
               `CODE UI DESIGNÉ:\n${frontend2}`
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
