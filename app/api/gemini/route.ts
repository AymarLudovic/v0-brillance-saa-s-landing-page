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

// Nouvelle fonction : Récupère la liste JSON fournie explicitement par les agents
function extractDependenciesFromAgentOutput(output: string): string[] {
  // On cherche un pattern du style DEPENDENCIES: ["pkg1", "pkg2"]
  // Le flag 's' permet au point . de matcher les nouvelles lignes si le json est indenté
  const match = output.match(/DEPENDENCIES:\s*(\[[^\]]*\])/);
  
  if (match && match[1]) {
    try {
      // Nettoyage basique au cas où l'IA met des quotes simples ou des virgules traînantes
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

// --- DEFINITION DES AGENTS AVEC INSTRUCTIONS FINALISÉES ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    RÈGLES D'OR :
    1. Commence ta réponse par : "En tant que ARCHITECTE..."
    2. ⛔ TU NE CODES JAMAIS.
    3. C'est TOI et TOI SEUL qui fais le PLAN.
    
    FORMAT DE SORTIE :
    CLASSIFICATION: CODE_ACTION
    Plan d'exécution :
    1. Backend : [Détails API/DB]
    2. Frontend : [Détails UX/UI]
    
    Sinon : CLASSIFICATION: CHAT_ONLY
    Pour correction simple : CLASSIFICATION: FIX_ACTION.`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. 
    1. Commence par "En tant que FIXER..."
    2. Renvoie uniquement le code corrigé.
    3. Ne simplifie pas le fichier. Respecte le travail des autres agents.
    4. Récupère le contexte global et applique la correction demandée.`,
  },

  // --- CHAINE BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend.
    Commence par "En tant que BACKEND_DEV..."
    
    ⛔ INTERDIT : 
    - NE FAIS AUCUN PLANNING. C'est le rôle de l'Architecte.
    - NE TOUCHE PAS AU FRONTEND (UI/CSS).
    
    Ta tâche : Implémenter la logique serveur pure selon le plan reçu.`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Expert Backend Senior.
    Commence par "En tant que BACKEND_REVIEWER..."
    
    ⛔ PAS DE PLANNING. Il y a un agent Architecte qui s'est déjà charger du planning. Toi et les autres agents vous êtes juste des implementeurs de ce plan. Il y a en effet d'autres agents avant et après toi.
    ⛔ 
    ⛔ PAS DE PLANNING. TU EXÉCUTES ET OPTIMISES.
    Ta tâche : Revoir et compléter le code backend.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Validateur Backend.
    Commence par "En tant que BACKEND_AUDITOR..."
    
    TA MISSION FINALE :
    1. Valide le code backend final.
    2. ⛔ PAS DE PLANNING.
    
    ⛔ PAS DE PLANNING. Il y a un agent Architecte qui s'est déjà charger du planning. Toi et les autres agents vous êtes juste des implementeurs de ce plan. Il y a en effet d'autres agents avant et après toi.
    ⛔ 
    IMPORTANT - GESTION DES PAQUETS :
    À la toute fin de ta réponse, tu DOIS lister les paquets NPM que tu as utilisés (zod, mongoose, bcrypt, etc.) sous ce format JSON strict :
    DEPENDENCIES: ["nom-paquet-1", "nom-paquet-2"]
    C'est important que tu retournes ces DEPENDENCIES, qui sont obligés d'être installé.
    N'inclus pas les paquets natifs (fs, path).`,
  },

  // --- CHAINE FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend (React).
    Commence par "En tant que FRONTEND_DEV..."
    
    ⛔ PAS DE PLANNING. Il y a un agent Architecte qui s'est déjà charger du planning. Toi et les autres agents vous êtes juste des implementeurs de ce plan. Il y a en effet d'autres agents avant et après toi.
    ⛔ 
    ⛔ PAS DE PLANNING. Suis le plan de l'Architecte.
    ⛔ PAS DE TAILWIND.
    Ta tâche : Créer la structure React.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Directeur Artistique.
    Commence par "En tant que FRONTEND_UX..."
    
    ⛔ PAS DE PLANNING. Il y a un agent Architecte qui s'est déjà charger du planning. Toi et les autres agents vous êtes juste des implementeurs de ce plan. Il y a en effet d'autres agents avant et après toi.
    ⛔ PAS DE TAILWIND. Utilise du CSS créatif.
    Ta tâche : Sublimer le design.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Intégrateur Final.
    Commence par "En tant que FRONTEND_QA..."
    
    TA MISSION FINALE :
    1. Vérifie tout le code UI. Assemble le tout.
    2. ⛔ PAS DE PLANNING.
    
    ⛔ PAS DE PLANNING. Il y a un agent Architecte qui s'est déjà charger du planning. Toi et les autres agents vous êtes juste des implementeurs de ce plan. Il y a en effet d'autres agents avant et après toi.
    ⛔ 
    IMPORTANT - GESTION DES PAQUETS :
    À la toute fin de ta réponse, tu DOIS lister les paquets NPM externes nécessaires pour le front (framer-motion, lucide-react, axios, etc.) sous ce format JSON strict :
    DEPENDENCIES: ["nom-paquet-1", "nom-paquet-2"]
        C'est important que tu retournes ces DEPENDENCIES, qui sont obligés d'être installé.
    `,

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
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "")
            // On peut choisir de masquer ou non la ligne DEPENDENCIES à l'utilisateur
            // Pour l'instant on laisse, ça fait "log système"
            .replace(/DEPENDENCIES:\s*\[.*?\]/g, ""); 
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
                // Injection du message utilisateur pour le contexte (Zod, etc.) sans l'historique complet
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION STRICTE - MODE EXÉCUTION]
                    Ne planifie RIEN. Exécute seulement.
                    
                    DEMANDE UTILISATEUR ORIGINALE : "${lastUserMessage}"
                    
                    INPUT TECHNIQUE PRÉCÉDENT :
                    ${taskInput}
                    
                    AGIS EN TANT QUE : ${agent.name}.
                    `}] 
                }];
            }

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ: ${agent.name} ===\n${agent.prompt}`;
            
            let temperature = 0.5; 
            if (agentKey.includes("BACKEND")) temperature = 0.2; 
            if (agentKey === "ARCHITECT") temperature = 0.3; 
            if (agentKey === "FRONTEND_DEV") temperature = 0.4;
            if (agentKey === "FRONTEND_DESIGNER") temperature = 0.95; 

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
            await runAgent("FIXER", `Correction requise pour: "${lastUserMessage}"`, true);
            controller.close();
            return;
          } else if (decision === "CODE_ACTION") {
            
            // --- WATERFALL ---
            const backend1 = await runAgent("BACKEND", `PLAN:\n${architectOutput}`);
            const backend2 = await runAgent("BACKEND_REVIEWER", `CODE V1:\n${backend1}`);
            
            // Backend Auditor génère la liste Backend
            const backend3 = await runAgent("BACKEND_AUDITOR", `CODE V2:\n${backend2}`);
            
            const noBackend = backend3.includes("NO_BACKEND_CHANGES");
            const finalBackendCode = noBackend ? "Aucun changement Backend." : backend3;

            const frontend1 = await runAgent("FRONTEND", `PLAN:\n${architectOutput}\n\nBACKEND:\n${finalBackendCode}`);
            const frontend2 = await runAgent("FRONTEND_DESIGNER", `CODE STRUCT:\n${frontend1}`);
            
            // Frontend QA génère la liste Frontend
            const frontendFinal = await runAgent("FRONTEND_FINALIZER", `CODE DESIGN:\n${frontend2}`);

            // --- GESTION PACKAGE.JSON VIA LISTES AGENTS ---
            
            // 1. On extrait les listes fournies par les agents finaux
            const backendDeps = extractDependenciesFromAgentOutput(backend3);
            const frontendDeps = extractDependenciesFromAgentOutput(frontendFinal);
            
            // 2. On fusionne les listes (Set pour éviter doublons)
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                send("\n\n--- 📦 [SYSTEM] Analyse des dépendances requises... ---\n");

                // Dépendances de base (Socle technique)
                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "iconsax-reactjs": "0.0.8",
                    "iconoir-react": "7.11.0",
                    "lucide-react": "0.561.0"
                };

                const newDeps: Record<string, string> = {};

                // 3. On interroge NPM pour avoir les versions exactes des dépendances listées par les agents
                await Promise.all(allDetectedDeps.map(async (pkg) => {
                    if (!baseDeps[pkg]) {
                        try {
                            const data = await packageJson(pkg);
                            newDeps[pkg] = data.version as string;
                        } catch (err) {
                            console.warn(`Package introuvable sur NPM: ${pkg}`);
                            newDeps[pkg] = "latest";
                        }
                    }
                }));

                // 4. Création du fichier final
                const finalDependencies = { ...baseDeps, ...newDeps };

                const packageJsonContent = {
                    name: "nextjs-app",
                    private: true,
                    scripts: {
                        dev: "next dev -p 3000 -H 0.0.0.0",
                        build: "next build",
                        start: "next start -p 3000 -H 0.0.0.0",
                    },
                    dependencies: finalDependencies,
                    devDependencies: {
                        typescript: "5.7.2",
                        "@types/node": "22.10.1",
                        "@types/react": "19.0.1",
                        "@types/react-dom": "19.0.1",
                    },
                };

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
