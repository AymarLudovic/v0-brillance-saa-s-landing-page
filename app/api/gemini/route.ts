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

// Extraction robuste des dépendances depuis la sortie de l'agent
function extractDependenciesFromAgentOutput(output: string): string[] {
  const match = output.match(/DEPENDENCIES:\s*(\[[^\]]*\])/);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erreur parsing dépendances:", e);
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

// --- DEFINITION DES AGENTS (INSTRUCTIONS STRICTES) ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    RÈGLES D'OR :
    1. Commence par : "En tant que ARCHITECTE..."
    2. ⛔ TU NE CODES JAMAIS (Pas de blocs de code).
    3. C'est TOI qui fais le PLAN.
    
    FORMAT DE SORTIE :
    CLASSIFICATION: CODE_ACTION
    Plan d'exécution :
    1. Backend : [Détails API/DB]
    2. Frontend : [Détails UX/UI]
    
    Sinon : CLASSIFICATION: CHAT_ONLY (pour discussion) ou FIX_ACTION (pour correction).`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. 
    1. Commence par "En tant que FIXER..."
    2. Renvoie le code corrigé complet dans un artifact XML <create_file>.
    3. Ne casse pas le travail des autres.`,
  },

  // --- BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend.
    Commence par "En tant que BACKEND_DEV..."
    ⛔ PAS DE PLANNING. Exécute le plan.
    Utilise la balise <create_file path="..."> pour chaque fichier.`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior.
    Commence par "En tant que BACKEND_REVIEWER..."
    ⛔ PAS DE PLANNING.
    Revois le code reçu. Si tout est bon, renvoie-le tel quel ou amélioré dans les balises XML.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend.
    Commence par "En tant que BACKEND_AUDITOR..."
    ⛔ PAS DE PLANNING.
    
    TA MISSION :
    1. Renvoie le code final propre dans des balises <create_file>.
    2. À la toute fin, liste les paquets NPM (hors natifs) :
    DEPENDENCIES: ["zod", "mongoose"]`,
  },

  // --- FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend.
    Commence par "En tant que FRONTEND_DEV..."
    ⛔ PAS DE PLANNING.
    ⛔ PAS DE TAILWIND (Sauf si demandé explicitement, sinon CSS Modules).
    Génère la structure dans des balises <create_file>.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Directeur Artistique.
    Commence par "En tant que FRONTEND_UX..."
    ⛔ PAS DE PLANNING.
    Sublime le design (CSS, Animations). Renvoie le code complet dans <create_file>.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final.
    Commence par "En tant que FRONTEND_QA..."
    ⛔ PAS DE PLANNING.
    
    TA MISSION :
    1. Renvoie le code UI final complet (JSX + CSS) dans des balises <create_file>.
    2. À la toute fin, liste les paquets NPM front requis :
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

    // Historique complet (Seulement pour l'Architecte)
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
        // --- FONCTION SEND CORRIGÉE ---
        // Elle ne supprime plus agressivement les XML. Elle supprime juste les balises de contrôle internes.
        send = (txt: string) => {
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "")
            // On masque la ligne DEPENDENCIES pour l'utilisateur final car ce n'est pas du code
            .replace(/DEPENDENCIES:\s*\[.*?\]/g, ""); 
            
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        // --- WORKFLOW AGENT OPTIMISÉ ---
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
                // L'architecte a besoin de tout l'historique pour comprendre la nuance
                contents = buildHistoryParts();
            } else {
                // LES BUILDERS : Contexte ISOLÉ pour éviter les boucles et hallucinations
                // On injecte la demande initiale + le travail de l'agent précédent
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION TECHNIQUE - NE PAS DISCUTER]
                    
                    CONTRAINTES UTILISATEUR : "${lastUserMessage}"
                    
                    INPUT À TRAITER (Code précédent ou Plan) :
                    ${taskInput}
                    
                    TOI : ${agent.name}.
                    ACTION : Exécute ta tâche définie dans le système. Produis le code XML.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== RÔLE: ${agent.name} ===\n${agent.prompt}`;
            
            // Température adaptative
            let temperature = 0.5; 
            if (agentKey.includes("BACKEND")) temperature = 0.2; // Rigueur
            if (agentKey === "ARCHITECT") temperature = 0.4; 
            if (agentKey === "FRONTEND_DESIGNER") temperature = 0.9; // Créativité

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
                // On envoie par petits paquets pour la fluidité
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
            return ""; // On continue même si erreur pour ne pas casser le stream
          }
        }

        try {
          // 1. ARCHITECTE : Analyse et Planifie
          const architectOutput = await runAgent("ARCHITECT", "", true);

          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          } 
          
          else if (decision === "FIX_ACTION") {
            // Pour le Fixer, on lui donne l'historique pour qu'il comprenne le contexte "Ce bouton ne marche pas"
            await runAgent("FIXER", `Corrige selon : "${lastUserMessage}"`, true);
            controller.close();
            return;
          } 
          
          else if (decision === "CODE_ACTION") {
            // 2. CHAÎNE DE PRODUCTION (Waterfall)
            
            // --- BACKEND ---
            const backend1 = await runAgent("BACKEND", `PLAN VALIDÉ:\n${architectOutput}`);
            const backend2 = await runAgent("BACKEND_REVIEWER", `CODE BACKEND V1:\n${backend1}`);
            // L'auditor sortira DEPENDENCIES: [...]
            const backend3 = await runAgent("BACKEND_AUDITOR", `CODE BACKEND V2:\n${backend2}`);
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backend3;

            // --- FRONTEND ---
            const frontend1 = await runAgent("FRONTEND", `PLAN:\n${architectOutput}\n\nCONTEXTE BACKEND:\n${finalBackendCode}`);
            const frontend2 = await runAgent("FRONTEND_DESIGNER", `CODE UI STRUCT:\n${frontend1}`);
            // Le finalizer sortira DEPENDENCIES: [...]
            const frontendFinal = await runAgent("FRONTEND_FINALIZER", `CODE UI DESIGN:\n${frontend2}`);

            // --- 3. GÉNÉRATION AUTOMATIQUE PACKAGE.JSON ---
            
            // Extraction des listes fournies par les agents AUDITOR et FINALIZER
            const backendDeps = extractDependenciesFromAgentOutput(backend3);
            const frontendDeps = extractDependenciesFromAgentOutput(frontendFinal);
            
            // Fusion unique
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                // Petit message système pour l'UX
                send("\n\n--- 📦 [SYSTEM] Configuration des dépendances (NPM)... ---\n");

                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.454.0" // Version stable
                };

                const newDeps: Record<string, string> = {};

                // Requêtes NPM en parallèle
                await Promise.all(allDetectedDeps.map(async (pkg) => {
                    // On ignore les paquets déjà présents ou vides
                    if (!pkg || baseDeps[pkg]) return;
                    
                    try {
                        const data = await packageJson(pkg);
                        newDeps[pkg] = data.version as string;
                    } catch (err) {
                        // Fallback si le paquet n'existe pas ou erreur réseau
                        newDeps[pkg] = "latest";
                    }
                }));

                const finalDependencies = { ...baseDeps, ...newDeps };

                const packageJsonContent = {
                    name: "nextjs-app",
                    version: "0.1.0",
                    private: true,
                    scripts: {
                        dev: "next dev",
                        build: "next build",
                        start: "next start",
                        lint: "next lint"
                    },
                    dependencies: finalDependencies,
                    devDependencies: {
                        typescript: "^5",
                        "@types/node": "^20",
                        "@types/react": "^19",
                        "@types/react-dom": "^19",
                        postcss: "^8",
                        tailwindcss: "^3.4.1", // Si jamais utilisé par erreur, on l'a
                        eslint: "^8",
                        "eslint-config-next": "15.0.3"
                    },
                };

                // Envoi de l'artifact XML final pour le package.json
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
          console.error("Workflow error:", err);
          send(`\n\n⛔ ERREUR: ${err.message}`);
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
