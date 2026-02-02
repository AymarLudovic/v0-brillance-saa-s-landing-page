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
  description: "Lecture fichier.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// --- DEFINITION DES ROLES (APPROCHE "SENIOR STAFF") ---
// Plus de checklist. Juste de la pure responsabilité.

const AGENTS = {
  // --- STRATÉGIE ---
  ARCHITECT: {
    name: "CHIEF_ARCHITECT",
    icon: "🏗️",
    prompt: `Tu es le CHIEF ARCHITECT.
    
    TA RESPONSABILITÉ :
    L'utilisateur a une idée floue. Tu dois la transformer en une ARCHITECTURE TECHNICIENNE VIABLE.
    Tu ne codes pas. Tu décides.
    
    TON OUTPUT :
    Un plan technique complet. Tu décides de la stack, des patterns (MVC, Hexagonal?), et des flux de données.
    Si le projet est complexe (Trading, SaaS), tu DOIS imposer une structure robuste.`,
  },

  FIXER: {
    name: "HOTFIX_ENGINEER",
    icon: "🔥",
    prompt: `Tu es le HOTFIX ENGINEER.
    
    TA RESPONSABILITÉ :
    Le système est cassé. Répare-le.
    Tu as tous les droits pour écraser, supprimer ou réécrire n'importe quel fichier pour résoudre le bug rapporté.`,
  },

  // --- BACKEND ---
  BACKEND_LEAD: {
    name: "BACKEND_LEAD",
    icon: "⚙️",
    prompt: `Tu es le LEAD BACKEND DEVELOPER.
    
    TA RESPONSABILITÉ :
    Fournir une infrastructure de données (API + DB) qui fonctionne RÉELLEMENT.
    
    MINDSET :
    Si l'Architecte demande une app de trading, ne fais pas juste un "User Model".
    Fais les transactions, les wallets, les calculs de fees, les webhooks.
    Tu es responsable de la logique invisible.`,
  },

  BACKEND_SEC: {
    name: "SYSTEM_ADMIN",
    icon: "🛡️",
    prompt: `Tu es le SYSTEM ADMINISTRATOR & SECURITY EXPERT.
    
    TA RESPONSABILITÉ :
    Protéger l'infrastructure.
    
    ACTION :
    Repasse sur le code du Backend Lead.
    Si tu vois une faille, tu la combles. Si tu vois du code lent, tu l'optimises.
    Tu es le dernier rempart avant le client.`,
  },

  BACKEND_PKG: {
    name: "DEVOPS_BACKEND",
    icon: "📦",
    prompt: `Tu es le DEVOPS BACKEND.
    
    TA RESPONSABILITÉ :
    Validation finale et Packaging.
    Liste les dépendances backend nécessaires (DEPENDENCIES: ["..."]).`,
  },

  // --- FRONTEND (C'est là qu'on change tout) ---
  
  // Fini le "fais les boutons". Place au "Software Engineer".
  FRONTEND_LOGIC: {
    name: "SENIOR_REACT_ENGINEER",
    icon: "🧠",
    prompt: `Tu es un SENIOR SOFTWARE ENGINEER (Spécialisé React Core).
    
    TA RESPONSABILITÉ :
    Tu construis le CERVEAU de l'interface.
    L'utilisateur se fiche de la couleur du bouton. Il veut que l'application FONCTIONNE.
    
    TON JOB :
    - Implémenter toute la complexité métier côté client (Algorithmes, State Machines, Data Fetching complexe).
    - Si c'est un Dashboard : tu codes les calculs des indicateurs.
    - Si c'est un Jeu : tu codes la physique et les règles.
    
    Tu ne fais PAS de CSS. Tu fais du code qui MARCHE.`,
  },

  FRONTEND_INTERACTION: {
    name: "UX_ENGINEER",
    icon: "⚡",
    prompt: `Tu es un UX ENGINEER (Interaction Specialist).
    
    TA RESPONSABILITÉ :
    Prendre le code "Cerveau" et le rendre VIVANT.
    
    TON JOB :
    Une application statique est une application morte.
    Tu es responsable de l'expérience : Feedback utilisateur, Fluidité, Gestion des erreurs, Modals, Drag & Drop.
    Fais en sorte que l'utilisateur sente que l'application répond à ses doigts.`,
  },

  FRONTEND_VISUAL: {
    name: "UI_DESIGNER_DEV",
    icon: "🎨",
    prompt: `Tu es un CREATIVE TECHNOLOGIST (UI Design).
    
    TA RESPONSABILITÉ :
    L'impact visuel et l'émotion.
    
    TON JOB :
    Prends le code fonctionnel et habille-le.
    Utilise le Design System (Tailwind) pour créer une interface propre, moderne et professionnelle.
    Respecte les images de référence fournies si elles existent.`,
  },

  // --- QUALITY ASSURANCE ---
  
  CODE_REVIEWER: {
    name: "STAFF_ENGINEER_REVIEWER",
    icon: "🧐",
    prompt: `Tu es le STAFF ENGINEER (Reviewer).
    
    TA RESPONSABILITÉ :
    La qualité du code (Maintainability & Clean Code).
    
    ACTION :
    Relis le code intégralement.
    - Imports manquants ?
    - Variables inutilisées ?
    - Logique douteuse ?
    Corrige le tir silencieusement. Rends le code "Production Ready".`,
  },

  FRONTEND_PKG: {
    name: "RELEASE_MANAGER",
    icon: "🚀",
    prompt: `Tu es le RELEASE MANAGER.
    
    TA RESPONSABILITÉ :
    Livrer le produit fini.
    
    ACTION :
    1. Vérifie la cohérence globale.
    2. Liste les dépendances Frontend (DEPENDENCIES: ["..."]).`,
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

    const buildFullHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // Contexte visuel global
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE)]" }] });
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          parts.push({ text: "\n[FICHIERS UPLOADÉS]" });
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
        
        async function runAgent(
            agentKey: keyof typeof AGENTS, 
            briefing: string = "" 
        ) {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            const contents = buildFullHistory();

            // CONTEXTE DE TRAVAIL : On ne donne plus d'ordres, on donne une SITUATION.
            contents.push({
                role: "user",
                parts: [{ text: `
                === SITUATION ACTUELLE DU PROJET ===
                
                TU ES : ${agent.name}
                
                L'ÉTAT ACTUEL (Ce que tes collègues ont fait avant toi) :
                ${briefing}
                
                TA MISSION :
                Agis selon ton rôle d'Expert.
                Ne demande pas la permission. Fais ce qui est nécessaire pour que le projet réussisse.
                Produis le code ou le plan attendu.
                
                ${basePrompt}
                ` }]
            });

            const systemInstruction = `${basePrompt}\n\n=== IDENTITÉ DE L'EXPERT ===\n${agent.prompt}`;
            
            // Températures ajustées : On veut de l'initiative, pas de la répétition.
            let temperature = 0.5;
            if (agentKey === "ARCHITECT") temperature = 0.7; 
            if (agentKey === "FRONTEND_LOGIC") temperature = 0.4; // Équilibre entre rigueur et ingéniosité
            if (agentKey === "CODE_REVIEWER") temperature = 0.2;

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
          // --- 1. PHASE DE CONCEPTION ---
          const architectOutput = await runAgent("ARCHITECT", "Analyse la demande utilisateur.");
          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            controller.close();
            return;
          } else if (decision === "FIX_ACTION") {
            await runAgent("FIXER", `Rapport bug: "${lastUserMessage}"`);
            controller.close();
            return;
          } else if (decision === "CODE_ACTION") {
            
            // --- 2. PHASE ENGINE (BACKEND) ---
            const backend1 = await runAgent("BACKEND_LEAD", `VISION ARCHITECTE:\n${architectOutput}`);
            const backend2 = await runAgent("BACKEND_SEC", `CODE V1:\n${backend1}`);
            const backendFinal = await runAgent("BACKEND_PKG", `CODE V2:\n${backend2}`);
            
            const noBackend = backendFinal.includes("NO_BACKEND_CHANGES");
            const backendContext = noBackend ? "Backend inchangé." : backendFinal;

            // --- 3. PHASE APPLICATION (FRONTEND) ---
            // On sépare Cerveau / Muscles / Peau
            
            // A. Le Cerveau (Logique pure, State, Data)
            const frontBrain = await runAgent("FRONTEND_LOGIC", `VISION ARCHITECTE:\n${architectOutput}\n\nBACKEND:\n${backendContext}`);
            
            // B. Les Muscles (Interactions, Events, UX Flow)
            const frontMuscles = await runAgent("FRONTEND_INTERACTION", `CODE LOGIQUE:\n${frontBrain}\n\nINSTRUCTION: Rends ça utilisable.`);
            
            // C. La Peau (Design, Style)
            const frontSkin = await runAgent("FRONTEND_VISUAL", `CODE FONCTIONNEL:\n${frontMuscles}\n\nINSTRUCTION: Applique le style.`);

            // --- 4. PHASE FINITION ---
            const codeReviewed = await runAgent("CODE_REVIEWER", `CODE COMPLET:\n${frontSkin}`);
            const finalOutput = await runAgent("FRONTEND_PKG", `CODE FINAL:\n${codeReviewed}`);

            // --- 5. DEPENDENCIES ---
            const backendDeps = extractDependenciesFromAgentOutput(backendFinal);
            const frontendDeps = extractDependenciesFromAgentOutput(finalOutput);
            const allDetectedDeps = Array.from(new Set([...backendDeps, ...frontendDeps]));

            if (allDetectedDeps.length > 0 || !noBackend) {
                send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances... ---\n");

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
                    version: "1.0.0",
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
