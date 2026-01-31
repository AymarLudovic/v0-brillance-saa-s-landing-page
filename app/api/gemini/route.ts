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

// --- DEFINITION DES AGENTS AVEC INSTRUCTIONS RENFORCÉES ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    RÈGLES D'OR :
    1. Commence ta réponse par : "En tant que ARCHITECTE..."
    2. ⛔ TU NE CODES JAMAIS.
    3. Si demande de création -> PLAN D'ACTION PRÉCIS.
    
    FORMAT DE SORTIE :
    CLASSIFICATION: CODE_ACTION
    Plan d'exécution :
    1. Backend : [Détails API/DB]
    2. Frontend : [Détails UX/UI]
    
    Sinon : CLASSIFICATION: CHAT_ONLY
    Pour de simple correction d'erreurs ou des demandes spécifiques de l'utilisateur sur son projet
    utilise le format de sortie CLASSIFICATION: FIX_ACTION l'agent fixer va s'occuper de faire la modif. Oui en effet il y a plusieurs agents après toi qui se charge de coder ce que tu planifies ce sont les 
    builders car en effet tu es l'architecte, celui qui fait le plan, et ce n'est pas à toi de rédiger un code quelconque ni créé aucun fichier les autres agents vont s'en occuper.
    `,
    
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. 
    1. Commence par "En tant que FIXER..."
    2. Renvoie uniquement le code corrigé.
    Ne simplifie pas le fichier que tu dois corriger car en effet il y a plusieurs agents qui ont travaillé sur ce code, tu dois le reprendre exactement comme tel ligne par ligne juste en corrigeant les erreurs reçus ou en implementant la requête de l'utilisateur. 
    Il y a plusieurs agents coordonnées.
    `,
    
  },

  // --- CHAINE BACKEND (STRICTE) ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Next.js / Node).
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que BACKEND_DEV..."
    
    PERIMÈTRE STRICT :
    ✅ Fichiers autorisés : /app/api/*, Server Actions, /lib/*, /db/*, /context/* (Logique).
    ⛔ INTERDIT : Ne touche JAMAIS aux composants UI, pages.tsx (rendu), ou CSS.
    
    Ta tâche : Lire le plan et implémenter la logique serveur pure.
    Si le plan est purement visuel, réponds : "NO_BACKEND_CHANGES".`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior.
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que BACKEND_REVIEWER..."
    
    Ta tâche : Optimiser le code Backend fourni.
    - Vérifie la sécurité et les performances.
    - NE TOUCHE PAS AU FRONTEND.
    - Renvoie tout le code backend complet.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend.
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que BACKEND_AUDITOR..."
    
    Ta tâche : Validation finale avant envoi à l'équipe Front.
    - Vérifie qu'aucun code UI (React Components) n'a fuité ici.
    - Tu te concentres sur le backend uniquement 
    - Renvoie le code final propre.`,
  },

  // --- CHAINE FRONTEND (CRÉATIVE & PURE CSS) ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend (React).
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que FRONTEND_DEV..."
    
    RÈGLES CRITIQUES :
    1. ⛔ INTERDICTION FORMELLE D'UTILISER TAILWIND CSS.
       concentre toi uniquement sur le frontend
    2. Utilise du CSS Classique (styles.css) ou CSS Modules.
    3. Tu es un EXÉCUTANT. Ne fais pas de nouveau plan. Suis le plan de l'Architecte.
    4. Intègre le code Backend fourni (Server Actions/API).`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Directeur Artistique & Motion Designer.
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que FRONTEND_UX..."
    
    TON OBJECTIF : L'EFFET "WOW".
    - Sois EXTRÊMEMENT CRÉATIF. Prends des risques visuels.
    - ⛔ PAS DE TAILWIND. Utilise du CSS Pur avancé (Gradients, Glassmorphism, Animations keyframes).
    - Ne casse pas la logique et les codes reçu mais rajoute des éléments composans pages creatives pour absolument sublimer, mais sublime le rendu visuel.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final.
    
    INSTRUCTION OBLIGATOIRE : Commence par "En tant que FRONTEND_QA..."
    
    Ta tâche :
    - Vérifie que tout est fonctionnel.
    - Assemble le CSS et le JSX.
    - Renvoie le code UI FINAL complet prêt pour la production.`,
  },
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();

    // Fonction de base pour l'historique pur
    const buildHistoryParts = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
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
        
        // --- LOGIQUE D'EXÉCUTION DES AGENTS ---
        async function runAgent(
            agentKey: keyof typeof AGENTS, 
            taskInput: string = "", 
            useChatHistory: boolean = false 
        ) {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            let contents;

            if (useChatHistory) {
                // ARCHITECTE : Historique complet
                contents = buildHistoryParts();
            } else {
                // WORKERS : Contexte Isolé (Pas de pollution)
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION TECHNIQUE STRICTE]
                    CONTEXTE ENTRANT :
                    ${taskInput}
                    
                    TA MISSION :
                    Agis en tant que ${agent.name}.
                    Respecte scrupuleusement tes contraintes (Backend vs Frontend).
                    Présente-toi ("En tant que...") et exécute.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ: ${agent.name} ===\n${agent.prompt}`;
            
            // --- GESTION FINE DE LA TEMPÉRATURE ---
            let temperature = 0.5; // Défaut
            
            if (agentKey.includes("BACKEND")) temperature = 0.2; // Très rigoureux, pas d'hallucination
            if (agentKey === "ARCHITECT") temperature = 0.3; // Stable pour le plan
            if (agentKey === "FRONTEND_DEV") temperature = 0.5; // Équilibré pour la structure
            if (agentKey === "FRONTEND_DESIGNER") temperature = 0.95; // MAX CRÉATIVITÉ pour le CSS/Anim

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
          // --- 1. ARCHITECTE ---
          const architectOutput = await runAgent("ARCHITECT", "", true);

          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          } 
          
          else if (decision === "FIX_ACTION") {
            await runAgent("FIXER", "Corrige le fichier selon la demande.", true);
            controller.close();
            return;
          } 
          
          else if (decision === "CODE_ACTION") {
            // --- WATERFALL STRICTE ---

            // Backend 1
            const backend1 = await runAgent("BACKEND", `PLAN TECHNIQUE VALIDÉ:\n${architectOutput}`);
            
            // Backend 2
            const backend2 = await runAgent("BACKEND_REVIEWER", 
              `PLAN:\n${architectOutput}\n\nCODE BACKEND V1:\n${backend1}`
            );
            
            // Backend 3
            const backend3 = await runAgent("BACKEND_AUDITOR", 
               `CODE BACKEND V2:\n${backend2}`
            );
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend requis." : backend3;

            // Frontend 1 (Structure)
            const frontend1 = await runAgent("FRONTEND", 
               `PLAN:\n${architectOutput}\n\nBACKEND FINALISÉ (API/ACTIONS):\n${finalBackendCode}`
            );

            // Frontend 2 (Design & Wow Effect)
            const frontend2 = await runAgent("FRONTEND_DESIGNER", 
               `CODE UI STRUCTUREL:\n${frontend1}`
            );

            // Frontend 3 (QA & Finalisation)
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
