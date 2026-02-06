import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
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

// --- 1. DÉFINITION DU FLUX DE TRAVAIL SIMPLIFIÉ ---
const WORKFLOW_CONTEXT = `
ICI il vous ais présenté l'ensemble des agents 
CONTEXTE GLOBAL DE L'ÉQUIPE :
1. ARCHITECTE : Planification.
2. BACKEND_DEV : API & Database.
3. BACKEND_AUDITOR : Sécurité & Dépendances Backend.
   --- BARRIÈRE : Le Backend s'arrête ici ---
4. FRONTEND_DEV : Logique, Structure React & Connexion API.
5. FRONTEND_LEAD : Design (Tailwind), UI Polish, Validation & Dépendances Frontend.
`;

// --- UTILITAIRES ---

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDependenciesFromAgentOutput(output: string): string[] {
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
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

// --- DEFINITION DES AGENTS (Frontend réduit) ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET (Architecte).
    ${WORKFLOW_CONTEXT}
    RÈGLES : Pas de code, juste un PLAN solide. Décide de la stack et des routes API.
    Quand tu veux lancer la phase de code c'est à dire vu que tu es uniquement l'architecte ce sont les autres agents qui se charge de code  tu vas seulement mentionné dans ta réponse ceci:
    FORMAT DE SORTIE :
    CLASSIFICATION: CODE_ACTION

    Si l'utilisateur veux juste discuter sans généré du code tu met ceci dans ta réponse: 
   FORMAT DE SORTIE :
    CLASSIFICATION: CHAT_ONLY
    

    Si il y a eu une erreur ou que l'utilisateur veux faire juste de légère modification localisé tu vas appeler l'agent fixed pour le faire en mettant ceci dans ta réponse :
    FORMAT DE SORTIE:
    CLASSIFICATION : FIX_ACTION
    
    
    `,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Corrige le bug précis. Utilise <create_file>.`,
  },

  // --- BACKEND (Inchangé) ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Node/Next.js).
    ${WORKFLOW_CONTEXT}
    TON RÔLE : Coder les API Routes, DB Schemas, Server Actions.
    ⛔ Pas de Frontend.
    FORMAT : <create_file path="...">...code...</create_file>.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend.
    ${WORKFLOW_CONTEXT}
    TON RÔLE : Relis le code Backend, corrige les failles et liste les paquets.
    FORMAT SORTIE : Code dans <create_file> puis DEPENDENCIES: ["pkg1", "pkg2"] à la fin.`,
  },

  // --- FRONTEND (Réduit à 2 Agents puissants) ---
  
  // Fusionne l'ancien FRONTEND_DEV et une partie de la logique
  FRONTEND_DEV: {
    name: "FRONTEND_DEV",
    icon: "💻", // Icône changée pour différencier
    prompt: `Expert Frontend Senior (React/Next.js Logic).
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Tu es le "Moteur". Tu construis la structure, le routing, les contexts et les appels API.
    
    INSTRUCTIONS :
    1. Base-toi sur le plan de l'Architecte et le code du Backend Auditor.
    2. Crée les fichiers .tsx fonctionnels.
    3. Ne t'attarde pas sur le "joli", concentre-toi sur le "fonctionnel" et la data.

    Petit tips pour toi vu que tu utilises directement tailwind css ca te donne le temps maintenant de te concentrer sur l'intégration complète des fonctionnalités pour ne pas avoir des éléments mort dans ton front end
    En effet là tu peux mieux travailler les layouts tels que les sidebars afin que même le plus petit menu et modals puisse fonctionner pour la raison pour laquelle on l'appelle.
    Même au niveau des inputs c'est la même chose et de tout autre élément du front end. Là tu n'as plus de raison pour ne pas le faire bien.
    ou de ne pas communiquer avec le code backend que les agents du backend a fait, car en effet tu as l'ensemble des fichiers qui ont été créé dans le projet et donc tu vois toute la logique.
    
    
    FORMAT : Utilise <create_file path="...">...code...</create_file>.`,
  },

  // Fusionne UX, Design et Finalizer en un seul "Lead"
  FRONTEND_LEAD: {

    name: "FRONTEND_LEAD",
    icon: "🎨", // Icône Designer
    prompt: `Lead Frontend & UI/UX Designer.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Tu es la "Peau" et la "Validation". 
    Tu prends le code fonctionnel du FRONTEND_DEV et tu le rends magnifique et production-ready.
    
    INSTRUCTIONS :
    1. Applique le design (Tailwind CSS), les animations (Framer Motion) et l'UX.
    2. Vérifie qu'il ne manque aucun import.
    3. LISTE LES DÉPENDANCES FRONTEND à la fin.
    
    Petit tips pour toi vu que tu utilises directement tailwind css ca te donne le temps maintenant de te concentrer sur l'intégration complète des fonctionnalités pour ne pas avoir des éléments mort dans ton front end
    En effet là tu peux mieux travailler les layouts tels que les sidebars afin que même le plus petit menu et modals puisse fonctionner pour la raison pour laquelle on l'appelle.
    Même au niveau des inputs c'est la même chose et de tout autre élément du front end. Là tu n'as plus de raison pour ne pas le faire bien.
    ou de ne pas communiquer avec le code backend que les agents du backend a fait, car en effet tu as l'ensemble des fichiers qui ont été créé dans le projet et donc tu vois toute la logique.
    
    ⚠️ IMPORTANT : Renvoie le code complet mis à jour.
    
    FORMAT OBLIGATOIRE À LA FIN :
    DEPENDENCIES: ["lucide-react", "framer-motion", "clsx", "tailwind-merge"]`,
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
    const { history, uploadedImages, allReferenceImages, currentProjectFiles, currentPlan, uploadedFiles} = body;
    const lastUserMessage = history.filter((m: Message) => m.role === "user").pop()?.content || "";

    const ai = new GoogleGenAI({ apiKey });

    // Construction de l'historique
    const buildHistoryParts = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE & VIBES]" }] });
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
          // Nettoyage soft : on enlève juste les tags de classification interne
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
            
            // INSTRUCTION CRITIQUE POUR L'EXTRACTION CÔTÉ CLIENT
            // On force l'IA à ne PAS mettre de markdown autour du XML
            const noMarkdownInstruction = `
            ⚠️ RÈGLE STRICTE D'OUTPUT XML :
            N'utilise JAMAIS de blocs markdown (\`\`\`xml ... \`\`\`) pour entourer la balise <create_file>.
            Écris le code XML DIRECTEMENT.
            Exemple VALIDE :
            <create_file path="lib/utils.ts">...</create_file>
            Exemple INTERDIT :
            \`\`\`xml
            <create_file...>...</create_file>
            \`\`\`
            `;

            if (useChatHistory) {
                contents = buildHistoryParts();
                // On injecte la consigne "No Markdown" dans le dernier message
                const lastMsg = contents[contents.length - 1];
                lastMsg.parts.push({ text: `\n[SYSTEM: ${noMarkdownInstruction}]` });
            } else {
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [CONTEXTE STRICT]
                    INPUT PRÉCÉDENT : ${taskInput}
                    
                    ${noMarkdownInstruction}
                    
                    TES INSTRUCTIONS :
                    Tu es ${agent.name}.
                    Génère le code demandé dans <create_file>.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== RÔLE : ${agent.name} ===\n${agent.prompt}`;
            
            // Température basse pour éviter le "bavardage" qui casse le parsing
            let temperature = 0.4; 
            if (agentKey === "FRONTEND_LEAD") temperature = 0.7; // Un peu de créativité pour le design

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
            
            // --- 2. BACKEND (2 Agents) ---
            const backend1 = await runAgent("BACKEND", `PLAN ARCHITECTE:\n${architectOutput}`);
            const backendFinal = await runAgent("BACKEND_AUDITOR", `CODE V1 (Backend Dev):\n${backend1}`);
            
            const noBackend = backendFinal.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backendFinal;

            // --- 3. FRONTEND (2 Agents) ---
            // Le Dev fait le gros œuvre
            const frontend1 = await runAgent("FRONTEND_DEV", `PLAN:\n${architectOutput}\n\nBACKEND:\n${finalBackendCode}`);
            // Le Lead fait le design, le polish et les dépendances
            const frontendFinal = await runAgent("FRONTEND_LEAD", `CODE BRUT (Frontend Dev):\n${frontend1}`);

            // --- 4. GESTION PAQUETS ---
            const backendDeps = extractDependenciesFromAgentOutput(backendFinal);
            const frontendDeps = extractDependenciesFromAgentOutput(frontendFinal);
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                send("\n\n--- 📦 [SYSTEM] Configuration package.json... ---\n");

                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0"
                };
                const newDeps: Record<string, string> = {};

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
                    version: "0.1.0",
                    private: true,
                    scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
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

                const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
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
