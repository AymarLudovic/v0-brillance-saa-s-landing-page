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

// --- 1. DÉFINITION DU FLUX DE TRAVAIL (Pour que chaque agent connaisse sa place) ---
const WORKFLOW_CONTEXT = `
CONTEXTE GLOBAL DE L'ÉQUIPE (Chaîne de production) :
1. ARCHITECTE (Chef) : Définit le plan.
2. BACKEND_DEV : Crée le serveur/API (Node/Next.js).
3. BACKEND_REVIEWER : Optimise le code serveur.
4. BACKEND_AUDITOR : Valide le serveur et liste les paquets npm backend.
   --- BARRIÈRE : Le Backend s'arrête ici ---
5. FRONTEND_DEV : Crée la structure React (utilise les API du Backend).
6. FRONTEND_UX : Ajoute le style et les animations.
7. FRONTEND_QA : Valide l'UI et liste les paquets npm frontend.
`;

// --- UTILITAIRES ---

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

// Extraction robuste des dépendances (JSON strict ou souple)
function extractDependenciesFromAgentOutput(output: string): string[] {
  // Regex pour capturer DEPENDENCIES: ["a", "b"] ou DEPENDENCIES: ['a', 'b']
  // Le flag 'i' rend insensible à la casse, 's' permet le multiline
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  
  if (match && match[1]) {
    try {
      // Normalisation des quotes (remplace ' par ")
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erreur parsing dépendances:", e);
      // Tentative de fallback manuel si le JSON est mal formé
      const manualExtract = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      if (manualExtract) return manualExtract.map(s => s.replace(/"/g, ''));
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

// --- DEFINITION DES AGENTS AVEC ROLES STRICTS ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET (Architecte).
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Analyser la demande et produire un PLAN.
    RÈGLES :
    1. Tu es l'étape 1. Personne n'est avant toi. L'équipe Backend te suit.
    2. ⛔ NE PRODUIS JAMAIS DE CODE.
    
    FORMAT DE SORTIE :
    CLASSIFICATION: CODE_ACTION
    Plan :
    - Backend : ...
    - Frontend : ...`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur.
    TON RÔLE : Intervenir ponctuellement pour corriger un fichier précis.
    Utilise <create_file path="...">...code...</create_file>.`,
  },

  // --- ÉQUIPE BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 2. Tu reçois le PLAN de l'Architecte.
    SUIVANT : Le Reviewer repassera sur ton code.
    
    ⛔ INTERDICTION FORMELLE : 
    - NE TOUCHE PAS au Frontend (pas de JSX, pas de React components, pas de CSS).
    - Ton domaine c'est : API Routes, Server Actions, Database, Zod schemas.
    
    FORMAT : Utilise <create_file path="...">...code...</create_file>.`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 3. Tu valides le code du BACKEND_DEV.
    PRÉCÉDENT : Backend Dev. SUIVANT : Backend Auditor.
    
    ⛔ INTERDICTION : Pas de Frontend. Reste sur le serveur.
    FORMAT : Renvoie le code complet corrigé dans <create_file>.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend & Gestionnaire de Paquets.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 4 (FIN DU BACKEND). Tu valides tout avant de passer la main au Frontend.
    
    TA MISSION CRUCIALE :
    1. Renvoie le code backend final dans <create_file>.
    2. LISTE LES DÉPENDANCES pour le fichier package.json.
    
    ⚠️ FORMAT OBLIGATOIRE À LA TOUTE FIN DE TA RÉPONSE :
    DEPENDENCIES: ["mongoose", "zod", "bcryptjs"]
    (Ne mets QUE les paquets externes, pas 'fs' ou 'path')`,
  },

  // --- ÉQUIPE FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend (React/Next.js).
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 5. Tu récupères le relais après l'équipe Backend.
    PRÉCÉDENT : Backend Auditor. SUIVANT : UX Designer.
    
    ⛔ INTERDICTION FORMELLE :
    - NE MODIFIE PAS LE BACKEND. Si une API manque, fais avec ou mock-la, mais ne réécris pas le serveur.
    - Ton domaine : Pages (.tsx), Components, Hooks.
    
    FORMAT : Utilise <create_file path="...">...code...</create_file>.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Directeur Artistique.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 6. Tu sublimes le travail du FRONTEND_DEV.
    PRÉCÉDENT : Frontend Dev. SUIVANT : Frontend QA.
    
    Tâche : Ajoute du style (Tailwind/CSS) et des animations.
    FORMAT : Renvoie le code complet dans <create_file>.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final & Gestionnaire de Paquets.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Étape 7 (FIN DU PROJET). Tu livres le produit fini.
    
    TA MISSION CRUCIALE :
    1. Vérifie que tout le code UI est dans <create_file>.
    2. LISTE LES DÉPENDANCES FRONTEND pour le package.json.
    
    ⚠️ FORMAT OBLIGATOIRE À LA TOUTE FIN DE TA RÉPONSE :
    DEPENDENCIES: ["framer-motion", "lucide-react", "clsx"]
    (N'oublie pas les paquets d'animation ou d'icônes utilisés)`,
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

    // --- Historique (visible uniquement par l'Architecte) ---
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
        send = (txt: string) => {
          // On masque les instructions de classification à l'utilisateur
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
          
          // NOTE : On ne masque PAS "DEPENDENCIES: [...]" ici, pour que l'utilisateur voit ce qui se passe.
          // De toute façon, ce n'est pas du XML, donc le parser de fichiers du client l'ignorera.
            
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
            if (useChatHistory) {
                contents = buildHistoryParts();
            } else {
                // --- INJECTION DU CONTEXTE STRICT POUR ÉVITER LES MÉLANGES ---
                // On rappelle à l'agent qui il est et ce qu'il doit faire UNIQUEMENT.
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION SYSTÈME - MODE EXÉCUTION STRICT]
                    
                    TÂCHE EN COURS : Le projet est en cours de création.
                    TON INPUT TECHNIQUE (Données reçues de l'agent précédent) :
                    ${taskInput}
                    
                    TES INSTRUCTIONS SPÉCIFIQUES :
                    1. Tu es ${agent.name}.
                    2. Réfère-toi au contexte global de l'équipe défini dans ton prompt système.
                    3. Ne fais PAS le travail des autres agents.
                    4. Génère le code demandé dans <create_file>.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ ET FLUX DE TRAVAIL ===\n${agent.prompt}`;
            
            // Températures ajustées pour éviter les hallucinations
            let temperature = 0.5; 
            if (agentKey.includes("BACKEND")) temperature = 0.2; // Très rigoureux pour le backend
            if (agentKey === "ARCHITECT") temperature = 0.4; 
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
            await runAgent("FIXER", `Contexte erreur: "${lastUserMessage}"`, true);
            controller.close();
            return;
          } else if (decision === "CODE_ACTION") {
            
            // --- 2. CASCADE BACKEND ---
            const backend1 = await runAgent("BACKEND", `PLAN ARCHITECTE:\n${architectOutput}`);
            const backend2 = await runAgent("BACKEND_REVIEWER", `CODE V1 (Backend Dev):\n${backend1}`);
            // L'auditor est instruit pour sortir DEPENDENCIES: [...]
            const backend3 = await runAgent("BACKEND_AUDITOR", `CODE V2 (Backend Reviewer):\n${backend2}`);
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backend3;

            // --- 3. CASCADE FRONTEND ---
            // On passe le backend final au frontend pour qu'il sache quelles API appeler
            const frontend1 = await runAgent("FRONTEND", `PLAN:\n${architectOutput}\n\nCONTEXTE BACKEND (APIs disponibles):\n${finalBackendCode}`);
            const frontend2 = await runAgent("FRONTEND_DESIGNER", `STRUCTURE REACT (Frontend Dev):\n${frontend1}`);
            // Le finalizer est instruit pour sortir DEPENDENCIES: [...]
            const frontendFinal = await runAgent("FRONTEND_FINALIZER", `DESIGN UX (Frontend UX):\n${frontend2}`);

            // --- 4. GESTION AUTOMATIQUE DES PAQUETS (NPM) ---
            
            // On récupère les sorties COMPLÈTES des agents finaux
            const backendDeps = extractDependenciesFromAgentOutput(backend3);
            const frontendDeps = extractDependenciesFromAgentOutput(frontendFinal);
            
            // Fusion des listes
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                send("\n\n--- 📦 [SYSTEM] Génération du package.json... ---\n");

                // Socle de base (ne change jamais)
                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0"
                };

                const newDeps: Record<string, string> = {};

                // Interrogation de NPM via le module 'package-json'
                // Cela garantit que le fichier package.json contient les VRAIES versions actuelles
                await Promise.all(allDetectedDeps.map(async (pkg) => {
                    // Ignorer les paquets vides ou déjà dans le socle
                    if (!pkg || baseDeps[pkg]) return;
                    
                    try {
                        const data = await packageJson(pkg);
                        newDeps[pkg] = data.version as string;
                    } catch (err) {
                        console.warn(`Package introuvable: ${pkg}`);
                        newDeps[pkg] = "latest"; // Fallback safe
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
                        tailwindcss: "^3.4.1",
                        eslint: "^8",
                        "eslint-config-next": "15.0.3"
                    },
                };

                // Envoi de l'artifact final pour package.json
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
