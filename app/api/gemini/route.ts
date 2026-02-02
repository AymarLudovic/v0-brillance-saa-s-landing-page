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


    
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE.
    ${WORKFLOW_CONTEXT}
    
    TA MISSION UNIQUE :
    L'utilisateur veut une APPLICATION COMPLÈTE (Clé en main).
    Ton plan ne doit pas être vague. Il doit lister TOUTES les fonctionnalités qui devront être codées.
    
    Exemple : Si on demande Spotify, tu ne dis pas "faire un lecteur". Tu dis :
    "- Frontend : Coder la gestion du buffer audio, les arrays de playlists, les boutons play/pause avec gestion d'état booléen, le volume slider avec calcul de gain..."
    
    Sois exhaustif pour que les devs ne puissent rien oublier.
    
    FORMAT :
    CLASSIFICATION: CODE_ACTION(pour lancer le processus de développement des autres agents), les autres agents vont se charger de coder la plateforme, et non toi. Toi tu te limite au planning autres agents.
    CLASSIFICATION: FIX_ACTION: pour appeler l'agent fixer qui va corriger les erreurs et rajouter les petites modifications de l'utilisateur par rapport à la plateforme.
    CLASSIFICATION: CHAT_ONLY: pour uniquement discuter avec l'utilisateur quand il veut juste parler.
    Plan Détaillé : ...`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Développeur Senior - Debugging.
    TON RÔLE : Corriger un bug ou une erreur spécifique.
    Utilise <create_file path="...">...code...</create_file>.`,
  },

  // --- BACKEND (INFRASTRUCTURE & DATA) ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Développeur Fullstack (Focus Data & API).
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Poser les fondations solides (Base de données, Auth, API).
    
    IMPORTANT :
    Tu prépares le terrain pour que le Frontend puisse être une application COMPLÈTE.
    Ne fais pas juste des routes vides. Fais des Server Actions robustes qui traitent vraiment les données.
    
    FORMAT : Utilise <create_file path="...">...code...</create_file>.`,
  },

  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Lead Dev Backend.
    ${WORKFLOW_CONTEXT}
    Valide et optimise le code serveur.
    FORMAT : Renvoie le code complet dans <create_file>.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Auditeur Technique.
    ${WORKFLOW_CONTEXT}
    
    TA MISSION :
    1. Valide le code Backend.
    2. LISTE LES DÉPENDANCES (C'est vital pour que l'app tourne).
    
    FORMAT FIN :
    DEPENDENCIES: ["mongoose", "zod", "bcryptjs"]`,
  },

  // --- FRONTEND (C'EST ICI QUE TOUT SE JOUE) ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "💻",
    prompt: `DÉVELOPPEUR D'APPLICATION (Pas Web Designer).
    ${WORKFLOW_CONTEXT}
    
    ECOUTE BIEN CETTE INSTRUCTION, ELLE EST VITALE :
    L'utilisateur veut une application QUI MARCHE, pas une coquille vide.
    Comme l'a dit le client : "Si je demande une application Spotify, je suis sûr qu'il va créer l'application intégrale".
    
    TA MISSION (L'INTÉGRALE) :
    Tu dois coder l'ensemble des fonctionnalités DIRECTEMENT dans le fichier .tsx.
    
    C'est quoi "L'INTEGRAL" ?
    C'est tout ce qui se passe AVANT le \`return\` du JSX.
    - Si c'est un chat : Tu codes la logique d'envoi, de réception, les tableaux de messages (\`useState\`), la gestion des dates.
    - Si c'est un dashboard : Tu codes les calculs, les tris, les filtres.
    
    NE FAIS PAS SEMBLANT.
    Interdiction de mettre des commentaires du type "// Ici on devrait calculer le total".
    NON. CALCULE LE TOTAL. CODE LA FONCTION.
    
    Tu construis le moteur ET la carrosserie en même temps.
    
    FORMAT : Utilise <create_file path="...">...code...</create_file>.`,
  },

  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Expert UX/UI & Finitions.
    ${WORKFLOW_CONTEXT}

    CONTEXTE :
    Le développeur précédent a codé une application FONCTIONNELLE (logique, états, calculs).
    
    TA MISSION :
    1. Ne casse SURTOUT PAS la logique JavaScript existante (les fonctions qui font marcher l'app).
    2. Si tu vois qu'il manque une fonctionnalité critique demandée (ex: le bouton play ne fait rien), CODE-LA.
    3. Applique un design professionnel (Tailwind, animations fluides).
    
    Rends l'application belle, mais surtout assure-toi qu'elle reste INTELLIGENTE.
    
    FORMAT : Renvoie le code complet dans <create_file>.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Responsable Livraison.
    ${WORKFLOW_CONTEXT}
    
    TON RÔLE : Vérifier que l'application est COMPLÈTE.
    
    CHECKLIST IMPÉRATIVE :
    1. Est-ce que les fonctionnalités sont codées ? (Pas juste affichées).
    2. Est-ce que le code est prêt à l'emploi ?
    
    Si c'est bon, valide tout.
    
    FORMAT OBLIGATOIRE FIN :
    DEPENDENCIES: ["framer-motion", "lucide-react", "clsx", "date-fns"]`,
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
    
    const lastUserMessage = history
        .slice().reverse()
        .find((m: Message) => m.role === "user")?.content || "";

    const ai = new GoogleGenAI({ apiKey });

    // --- CONTEXTE TOTAL (IMAGES + CONSIGNE CLIENT) ---
    const getFullContextParts = (agentName: string, taskInput: string) => {
        const parts: Part[] = [];
        
        // 1. Injection Systématique des Images (Référence + Upload)
        if (allReferenceImages?.length > 0) {
            allReferenceImages.forEach((img: string) => {
                parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } });
            });
            parts.push({ text: "\n[VISUAL REFERENCE]" });
        }
        if (uploadedImages?.length > 0) {
            uploadedImages.forEach((img: string) => {
                parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } });
            });
            parts.push({ text: "\n[USER UPLOADED IMAGES]" });
        }

        // 2. Injection de la consigne "AGENCE" (Le contexte technique)
        parts.push({ text: `
            [MODE AGENCE ACTIVÉ : CODAGE INTÉGRAL]
            
            TÂCHE PRÉCÉDENTE (INPUT) : 
            ${taskInput}
            
            CONSIGNE CLIENT :
            "Je veux l'application INTEGRALE. Avec toutes les fonctionnalités. Pas de maquette. Pas de code vide."
            
            TON RÔLE (${agentName}) :
            Code la solution complète. Backend logic inside Frontend components included.
            Génère le code final dans <create_file>.
        `});

        return parts;
    };

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        async function runAgent(agentKey: keyof typeof AGENTS, taskInput: string = "", useChatHistory: boolean = false) {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            let contents;
            if (useChatHistory) {
                // Pour l'architecte, on garde l'historique complet pour comprendre la nuance de la demande
                const historyParts = history.map((msg: Message) => ({
                    role: msg.role === "assistant" ? "model" : "user",
                    parts: [{ text: msg.content }]
                }));
                // On ajoute les images au dernier message user
                if (allReferenceImages?.length || uploadedImages?.length) {
                    const lastMsg = historyParts[historyParts.length - 1];
                    // (Logique simplifiée pour l'exemple, l'important est que l'Architecte voie tout)
                }
                contents = historyParts; // Simplifié ici pour la clarté, assure-toi d'inclure les images
            } else {
                // Pour les Devs, on donne le contexte "Agency" ciblé
                contents = [{ role: "user", parts: getFullContextParts(agent.name, taskInput) }];
            }

            const systemInstruction = `${basePrompt}\n\n=== RÔLE ===\n${agent.prompt}`;
            
            // Backend : Rigueur (0.2). Frontend : Créativité mais Logic (0.5). Designer : (0.8)
            let temperature = agentKey.includes("BACKEND") ? 0.2 : 0.5; 
            if (agentKey === "FRONTEND_DESIGNER") temperature = 1.3;

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
            send(`\n[Erreur]: ${e.message}\n`);
            return "";
          }
        }

        try {
          // 1. ARCHITECTE
          const architectOutput = await runAgent("ARCHITECT", "", true); // Lit l'historique conversationnel
          
          if (architectOutput.includes("CHAT_ONLY")) {
             controller.close(); return;
          }
          if (architectOutput.includes("FIX_ACTION")) {
             await runAgent("FIXER", `Erreur: ${lastUserMessage}`, true);
             controller.close(); return;
          }

          // 2. BACKEND (Socle)
          const backend1 = await runAgent("BACKEND", `PLAN:\n${architectOutput}`);
          const backend2 = await runAgent("BACKEND_REVIEWER", `CODE V1:\n${backend1}`);
          const backend3 = await runAgent("BACKEND_AUDITOR", `CODE V2:\n${backend2}`);
          const noBackend = backend3.includes("NO_BACKEND_CHANGES");
          const finalBackend = noBackend ? "Pas de changement backend." : backend3;

          // 3. FRONTEND (L'APPLICATION COMPLÈTE)
          // On passe le backend code pour qu'il sache sur quoi se brancher, mais il doit tout coder.
          const frontend1 = await runAgent("FRONTEND", `PLAN:\n${architectOutput}\n\nBACKEND:\n${finalBackend}`);
          const frontend2 = await runAgent("FRONTEND_DESIGNER", `CODE FONCTIONNEL:\n${frontend1}`);
          const frontendFinal = await runAgent("FRONTEND_FINALIZER", `DESIGN:\n${frontend2}`);

          // 4. PACKAGING (Auto-détection)
          const deps = [...extractDependenciesFromAgentOutput(backend3), ...extractDependenciesFromAgentOutput(frontendFinal)];
          if (deps.length > 0 || !noBackend) {
              send("\n\n--- 📦 Installation des dépendances... ---\n");
              // ... Logique de package.json inchangée ...
              // Je te laisse la partie package.json standard ici
               const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0"
                };
                const newDeps: Record<string, string> = {};
                await Promise.all(deps.map(async (pkg) => {
                    if (!pkg || baseDeps[pkg]) return;
                    try { const data = await packageJson(pkg); newDeps[pkg] = data.version as string; } 
                    catch (err) { newDeps[pkg] = "latest"; }
                }));
                const xmlOutput = `<create_file path="package.json">\n${JSON.stringify({
                    name: "app-integrale", version: "1.0.0", private: true, 
                    scripts: { dev: "next dev", build: "next build", start: "next start" },
                    dependencies: { ...baseDeps, ...newDeps },
                    devDependencies: { typescript: "^5", "@types/node": "^20", "@types/react": "^19", postcss: "^8", tailwindcss: "^3.4.1" }
                }, null, 2)}\n</create_file>`;
                send(xmlOutput);
          }

          controller.close();
        } catch (err: any) {
          send(`\n⛔ ERREUR: ${err.message}`);
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
    }
