import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
// Assure-toi d'avoir installé: npm install package-json
import packageJson from 'package-json';

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

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

// Fonction : Récupère la liste JSON fournie explicitement par les agents
function extractDependenciesFromAgentOutput(output: string): string[] {
  const match = output.match(/DEPENDENCIES:\s*(\[[^\]]*\])/);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erreur parsing dépendances agent:", e);
      return [];
    }
  }
  return [];
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
// CORRECTION MAJEURE : Ajout explicite de l'instruction XML pour CHAQUE agent codeur.
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    RÈGLES :
    1. Commence par "En tant que ARCHITECTE..."
    2. ⛔ NE PRODUIS PAS DE CODE.
    3. Fais le PLAN.
    
    FORMAT SORTIE :
    CLASSIFICATION: CODE_ACTION
    Plan :
    1. Backend : ...
    2. Frontend : ...
    
    Sinon : CLASSIFICATION: CHAT_ONLY`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur.
    RÈGLE ABSOLUE : Utilise TOUJOURS le format XML pour le code :
    <create_file path="nom_fichier"> ... code ... </create_file>`,
  },

  // --- CHAINE BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend.
    Commence par "En tant que BACKEND_DEV..."
    ⛔ PAS DE PLANNING.
    
    RÈGLE ABSOLUE : Tout fichier de code doit être enveloppé ainsi :
    <create_file path="dossier/fichier.ext">
    ... le code ...
    </create_file>`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior.
    Commence par "En tant que BACKEND_REVIEWER..."
    ⛔ PAS DE PLANNING.
    
    Tâche : Revoir le code. Renvoie le code corrigé/amélioré ENTIER au format :
    <create_file path="..."> ... code ... </create_file>`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend.
    Commence par "En tant que BACKEND_AUDITOR..."
    ⛔ PAS DE PLANNING.
    
    1. Renvoie le code final validé au format : <create_file path="..."> ... </create_file>
    2. À la toute fin (hors XML), liste les paquets :
    DEPENDENCIES: ["zod", "mongoose"]`,
  },

  // --- CHAINE FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend.
    Commence par "En tant que FRONTEND_DEV..."
    ⛔ PAS DE PLANNING.
    
    RÈGLE ABSOLUE : Génère la structure React au format :
    <create_file path="app/page.tsx"> ... code ... </create_file>`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Directeur Artistique.
    Commence par "En tant que FRONTEND_UX..."
    ⛔ PAS DE PLANNING.
    
    Sublime le design. Renvoie TOUT le code au format :
    <create_file path="..."> ... code ... </create_file>`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final.
    Commence par "En tant que FRONTEND_QA..."
    ⛔ PAS DE PLANNING.
    
    1. Renvoie le code UI FINAL complet au format : <create_file path="..."> ... </create_file>
    2. À la toute fin (hors XML), liste les paquets :
    DEPENDENCIES: ["framer-motion", "lucide-react"]`,
  },
};

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;
    const lastUserMessage = history.filter((m: Message) => m.role === "user").pop()?.content || "";

    const ai = new GoogleGenAI({ apiKey });

    // Historique complet UNIQUEMENT pour l'Architecte
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
        // CORRECTION 1 : La fonction SEND
        // On ne supprime PLUS la ligne DEPENDENCIES ici.
        // Si on la supprime via regex sur des chunks, on risque de casser le XML qui suit ou précède.
        // Le client ignorera simplement le texte qui n'est pas dans <create_file>
        send = (txt: string) => {
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
            
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
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
            
            // CORRECTION 2 : Gestion du contexte pour éviter les boucles
            if (useChatHistory) {
                contents = buildHistoryParts();
            } else {
                // On isole totalement l'agent. Il ne voit PAS l'historique complet, 
                // juste son input technique. Ça empêche l'agent de relire "Créé une app" et de recommencer à zéro.
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION SYSTÈME - MODE EXÉCUTION STRICT]
                    CONTEXTE : L'utilisateur a demandé une fonctionnalité. Le plan a été fait.
                    
                    TON INPUT TECHNIQUE :
                    ${taskInput}
                    
                    AGIS EN TANT QUE : ${agent.name}.
                    IMPORTANT : Tu ne dois répondre QUE avec le code demandé et les balises XML <create_file>.
                    Ne fais pas de conversation.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ: ${agent.name} ===\n${agent.prompt}`;
            
            let temperature = 0.5; 
            if (agentKey.includes("BACKEND")) temperature = 0.2; 
            if (agentKey === "ARCHITECT") temperature = 0.3; 
            if (agentKey === "FRONTEND_DESIGNER") temperature = 0.9; 

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
            send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
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
          } else if (decision === "FIX_ACTION") {
            // Le Fixer a besoin de l'historique pour comprendre le contexte du bug
            await runAgent("FIXER", `Correction requise pour: "${lastUserMessage}"`, true);
            controller.close();
            return;
          } else if (decision === "CODE_ACTION") {
            
            // --- WATERFALL (Séquence sans retour arrière) ---
            
            // Backend
            const backend1 = await runAgent("BACKEND", `PLAN:\n${architectOutput}`);
            const backend2 = await runAgent("BACKEND_REVIEWER", `CODE V1:\n${backend1}`);
            const backend3 = await runAgent("BACKEND_AUDITOR", `CODE V2:\n${backend2}`);
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backend3;

            // Frontend
            const frontend1 = await runAgent("FRONTEND", `PLAN:\n${architectOutput}\n\nBACKEND:\n${finalBackendCode}`);
            const frontend2 = await runAgent("FRONTEND_DESIGNER", `CODE STRUCT:\n${frontend1}`);
            const frontendFinal = await runAgent("FRONTEND_FINALIZER", `CODE DESIGN:\n${frontend2}`);

            // --- GESTION PACKAGE.JSON ---
            
            // Extraction
            const backendDeps = extractDependenciesFromAgentOutput(backend3);
            const frontendDeps = extractDependenciesFromAgentOutput(frontendFinal);
            
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                send("\n\n--- 📦 [SYSTEM] Installation des dépendances... ---\n");

                // Socle technique
                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0"
                };

                const newDeps: Record<string, string> = {};

                // Récupération versions NPM
                await Promise.all(allDetectedDeps.map(async (pkg) => {
                    if (!pkg || baseDeps[pkg]) return;
                    try {
                        const data = await packageJson(pkg);
                        newDeps[pkg] = data.version as string;
                    } catch (err) {
                        newDeps[pkg] = "latest";
                    }
                }));

                const finalDependencies = { ...baseDeps, ...newDeps };

                const packageJsonContent = {
                    name: "nextjs-app",
                    private: true,
                    scripts: {
                        dev: "next dev",
                        build: "next build",
                        start: "next start",
                    },
                    dependencies: finalDependencies,
                    devDependencies: {
                        typescript: "5.7.2",
                        "@types/node": "22.10.1",
                        "@types/react": "19.0.1",
                        "@types/react-dom": "19.0.1",
                        postcss: "8",
                        tailwindcss: "3.4.1"
                    },
                };

                // Envoi propre du fichier package.json
                const xmlOutput = `
<create_file path="package.json">
${JSON.stringify(packageJsonContent, null, 2)}
</create_file>
                `;
                
                send(xmlOutput);
            }

            controller.close();
          }
        } catch (err: any) {
          console.error("Stream workflow error:", err);
          send(`\n\n⛔ ERREUR CRITIQUE: ${err.message}`);
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
