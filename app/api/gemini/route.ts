import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
// Assure-toi d'avoir installé ce package: npm install package-json
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

// Fonction pour extraire les imports du code généré
function extractImports(code: string): string[] {
  const regex = /from\s+['"]([^'"]+)['"]/g;
  const imports = new Set<string>();
  let match;
  while ((match = regex.exec(code)) !== null) {
    const lib = match[1];
    // On exclut les imports relatifs (./, ../, @/) et les modules node natifs
    if (!lib.startsWith(".") && !lib.startsWith("/") && !lib.startsWith("@/") && 
        !['fs', 'path', 'os', 'util', 'crypto', 'stream', 'http', 'https', 'zlib'].includes(lib)) {
       // Cas spécial pour les sous-modules (ex: lucide-react/icons) -> on garde juste le package
       const pkgName = lib.startsWith("@") ? lib.split("/").slice(0, 2).join("/") : lib.split("/")[0];
       imports.add(pkgName);
    }
  }
  return Array.from(imports);
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
    utilise le format de sortie CLASSIFICATION: FIX_ACTION l'agent fixer va s'occuper de faire la modif. 
    Tu es l'architecte, celui qui fait le plan, et ce n'est pas à toi de rédiger un code quelconque ni créer aucun fichier, les autres agents (Builders) vont s'en occuper.`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. 
    1. Commence par "En tant que FIXER..."
    2. Renvoie uniquement le code corrigé.
    Ne simplifie pas le fichier que tu dois corriger car en effet il y a plusieurs agents qui ont travaillé sur ce code.
    Tu dois le reprendre exactement comme tel ligne par ligne juste en corrigeant les erreurs reçues ou en implémentant la requête de l'utilisateur.
    Attention : Ne détruis pas le travail des autres agents.`,
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
    
    Ta tâche : Lire le plan + les contraintes utilisateur et implémenter la logique serveur pure.
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
    - Tu te concentres sur le backend uniquement.
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
       Concentre toi uniquement sur le frontend.
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
    - Ne casse pas la logique et les codes reçus mais rajoute des éléments, composants, pages créatives pour absolument sublimer le rendu visuel.`,
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
  const encoder = new TextEncoder();
  // On définit 'send' ici pour qu'il soit accessible dans le catch global
  let send: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;

    // Récupération de la dernière demande utilisateur pour l'injecter aux agents
    const lastUserMessage = history.filter((m: Message) => m.role === "user").pop()?.content || "";

    const ai = new GoogleGenAI({ apiKey });

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
        send = (txt: string) => {
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
                // ARCHITECTE & FIXER (Parfois) : Historique complet
                contents = buildHistoryParts();
            } else {
                // WORKERS : Contexte Isolé + Injection de la demande Utilisateur
                // C'est ici qu'on résout le problème "Zod" : on force l'agent à voir la contrainte utilisateur brute
                contents = [{ 
                    role: "user", 
                    parts: [{ text: `
                    [INSTRUCTION TECHNIQUE STRICTE]
                    
                    1. CONTRAINTES UTILISATEUR DIRECTES (CRITIQUE : Tu dois respecter ceci par dessus tout) :
                    "${lastUserMessage}"
                    
                    2. CONTEXTE TECHNIQUE PROVENANT DES AUTRES AGENTS :
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
            const errorMsg = `\n[Erreur interne Agent ${agent.name}]: ${e.message}\n`;
            console.error(errorMsg);
            send(errorMsg);
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
            // Le Fixer a besoin de contexte pour ne pas tout casser
            await runAgent("FIXER", `Instruction Utilisateur: ${lastUserMessage}`, true);
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
            const frontendFinal = await runAgent("FRONTEND_FINALIZER", 
               `CODE UI DESIGNÉ:\n${frontend2}`
            );

            // --- GESTION INTELLIGENTE DES DÉPENDANCES (package.json) ---
            // On analyse uniquement si du code a été produit
            if (frontendFinal || finalBackendCode) {
              const allGeneratedCode = finalBackendCode + "\n" + frontendFinal;
              const detectedImports = extractImports(allGeneratedCode);

              // Dépendances de base requises
              const baseDeps: Record<string, string> = {
                next: "15.1.0",
                react: "19.0.0",
                "react-dom": "19.0.0",
                "iconsax-reactjs": "0.0.8",
                "iconoir-react": "7.11.0",
                "lucide-react": "0.561.0"
              };

              const newDeps: Record<string, string> = {};
              
              // On vérifie les versions sur NPM pour les nouvelles dépendances trouvées
              if (detectedImports.length > 0) {
                 send("\n\n--- 📦 [SYSTEM] Vérification des dépendances... ---\n");
                 
                 // On utilise Promise.all pour faire les requêtes en parallèle (rapide)
                 await Promise.all(detectedImports.map(async (pkg) => {
                    if (!baseDeps[pkg]) { // Si pas déjà dans la base
                        try {
                            const data = await packageJson(pkg);
                            newDeps[pkg] = data.version as string;
                        } catch (err) {
                            console.warn(`Package introuvable: ${pkg}`);
                            // Fallback version si erreur
                            newDeps[pkg] = "latest"; 
                        }
                    }
                 }));
              }

              // Fusion des dépendances
              const allDependencies = { ...baseDeps, ...newDeps };
              
              // Si de nouvelles dépendances ont été ajoutées par rapport à la base, on génère le fichier
              const hasNewDeps = Object.keys(newDeps).length > 0;

              // NOTE : On régénère le package.json si on est en mode création (CODE_ACTION) 
              // pour s'assurer que l'utilisateur a tout ce qu'il faut.
              
              const packageJsonContent = {
                  name: "nextjs-app",
                  private: true,
                  scripts: {
                    dev: "next dev -p 3000 -H 0.0.0.0",
                    build: "next build",
                    start: "next start -p 3000 -H 0.0.0.0",
                  },
                  dependencies: allDependencies,
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
          send(`\n\n⛔ ERREUR CRITIQUE DU FLUX : ${err.message}`);
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
