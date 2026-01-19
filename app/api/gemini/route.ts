import { NextResponse } from "next/server";
import { GoogleGenAI, Tool, Type } from "@google/genai";
import { basePrompt } from "@/lib/prompt";

// --- CONFIGURATION ---
// Utilise le modèle Thinking pour la logique complexe
const MODEL_NAME = "gemini-3-flash-preview"; 
const BATCH_SIZE = 100;

// --- DÉFINITION DES RÔLES & RESTRICTIONS ---
// C'est ici qu'on empêche le Backend de faire du Frontend
const ROLES = {
  ARCHITECTE: {
    name: "ARCHITECTE",
    restriction: "TÂCHE: Analyse et Planification uniquement. INTERDICTION DE CODER. Sortie: Liste Markdown des fichiers.",
    tools: [] // Seul lui a accès au web pour vérifier les docs
  },
  BACKEND_BUILDER: {
    name: "BACKEND_BUILDER",
    restriction: "TÂCHE: Uniquement API routes, Database, Zod schemas. INTERDICTION D'ÉCRIRE DU JSX/REACT. Si tu vois des instructions UI dans le basePrompt, IGNORE-LES.",
    tools: []
  },
  UI_BUILDER: {
    name: "UI_BUILDER",
    restriction: "TÂCHE: Uniquement Components React, Pages, Tailwind. Utilise les API créées par le Backend. INTERDICTION DE TOUCHER AU BACKEND.",
    tools: []
  },
  REPORTER: {
    name: "REPORTER",
    restriction: "TÂCHE: Synthèse finale pour l'utilisateur. Ton ton est encourageant et professionnel.",
    tools: []
  }
};

// --- STRUCTURES ---
interface ProjectFile {
  path: string;
  code: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
}

// --- HELPERS ---
function cleanBase64(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function getMimeType(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

// --- CONSTRUCTEUR DE PROMPT INTELLIGENT ---
// C'est le secret : On donne à l'agent SEULEMENT ce dont il a besoin + le contexte du projet
function buildSystemPrompt(roleKey: keyof typeof ROLES, projectState: ProjectFile[]) {
  const role = ROLES[roleKey];
  
  // On formate l'état actuel du projet (les fichiers déjà créés)
  let stateContext = "";
  if (projectState.length > 0) {
    stateContext = `\n\n--- 📂 ÉTAT ACTUEL DU PROJET (Code existant) ---\n` +
      projectState.map(f => `// FICHIER: ${f.path}\n${f.code.substring(0, 1500)}... (tronqué si trop long)`).join("\n\n");
  }

  return `
  ${basePrompt}

  ================================================
  🛑 INTERVENTION PRIORITAIRE : RÈGLES DE RÔLE 🛑
  ================================================
  TU ES L'AGENT : ${role.name}
  ${role.restriction}

  TON OBJECTIF : Continuer le travail de l'équipe.
  ${stateContext}

  RÈGLE D'OR : 
  1. Si tu es Backend, tes fichiers doivent aller dans /app/api ou /lib/db.
  2. Si tu es UI, tes fichiers vont dans /components ou /app/(routes).
  3. Lis le "Code existant" ci-dessus pour assurer la cohérence (imports, noms de variables).
  `;
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API Key" }, { status: 401 });

    const { history, uploadedImages, allReferenceImages } = await req.json();
    const ai = new GoogleGenAI({ apiKey });

    // --- STATE MANAGEMENT ---
    // On garde en mémoire tout ce que les agents produisent
    let globalProjectFiles: ProjectFile[] = [];

    // Fonction de construction des contenus (multimodal)
    const getContents = (userInstruction: string) => {
      const parts: any[] = [{ text: userInstruction }];
      
      // Ajout des images de référence au contexte
      if (allReferenceImages?.length) {
        allReferenceImages.forEach((img: string) => {
          parts.push({ inlineData: { mimeType: getMimeType(img), data: cleanBase64(img) } });
        });
        parts.push({ text: "\n[Ci-dessus : Images de référence du Vibe Board]" });
      }

      // Ajout de l'historique récent (limité pour ne pas saturer)
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        parts.push({ text: `\nDEMANDE UTILISATEUR : ${lastMsg.content}` });
      }

      return [{ role: "user", parts }];
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let buffer = "";

        // --- ORCHESTRATEUR ---
        const runAgent = async (agentKey: keyof typeof ROLES, specificTask: string, isSilent: boolean = true) => {
          const roleConfig = ROLES[agentKey];
          const systemInstruction = buildSystemPrompt(agentKey, globalProjectFiles);

          // Si c'est un builder, on force le format de sortie code
          const taskPrompt = isSilent 
            ? `${specificTask}\nIMPORTANT: Ne parle pas. Génère UNIQUEMENT le code. Format: \`// FILE: nom_du_fichier\` suivi du code.` 
            : specificTask;

          const res = await ai.models.generateContentStream({
            model: MODEL_NAME,
            contents: getContents(taskPrompt),
            config: { 
              systemInstruction,
              tools: roleConfig.tools // Active Google Search uniquement pour l'Architecte
            },
            generationConfig: {
              temperature: 1.0,
              maxOutputTokens: 8192,
              // Thinking config (si le modèle le supporte)
              thinkingConfig: { includeThoughts: true, thinkingLevel: "high" }
            }
          });

          let fullOutput = "";
          
          if (!isSilent) {
             // L'architecte et le Reporter parlent
             for await (const chunk of res) {
                if (chunk.text) { send(chunk.text); fullOutput += chunk.text; }
             }
          } else {
             // Les Builders sont silencieux (Logs visuels seulement)
             send(`\n> [${roleConfig.name}] est au travail... 🔨\n`);
             for await (const chunk of res) {
                if (chunk.text) {
                   fullOutput += chunk.text;
                   buffer += chunk.text;
                   if (buffer.length > BATCH_SIZE) { send(buffer); buffer = ""; }
                }
             }
             if (buffer) { send(buffer); buffer = ""; }
          }

          // --- MEMORY UPDATE ---
          // Simulation simple : on ajoute tout le blob de texte au state global
          // Dans une vraie app, il faudrait parser le string pour extraire proprement les fichiers
          globalProjectFiles.push({ path: `Output_${agentKey}`, code: fullOutput });
          
          return fullOutput;
        };

        try {
          // 1. MANAGER (Classification rapide)
          // Note : On pourrait utiliser un petit modèle ici pour aller vite, mais restons sur le gros pour la précision
          
          send("### 🧠 Phase 1 : Analyse & Architecture\n");
          // L'Architecte utilise Google Search si besoin pour vérifier les versions
          const plan = await runAgent("ARCHITECTE", 
            "Analyse la demande. Si besoin, cherche sur le web les docs récentes. Fais la liste des fichiers.", 
            false
          );

          if (plan.includes("ACTION_FIX")) {
             // Branche de maintenance (simplifiée pour l'exemple)
             await runAgent("BACKEND_BUILDER", "Corrige le code selon la demande.", false);
          } else {
             // Branche Création V0
             
             send("\n---\n### ⚙️ Phase 2 : Backend Construction\n");
             // Le Backend reçoit le Plan de l'architecte dans son contexte
             const backendCode = await runAgent("BACKEND_BUILDER", 
               "Génère TOUTE la structure API et DB. Ne fais PAS de Frontend.", 
               true
             );

             send("\n---\n### 🎨 Phase 3 : UI Construction\n");
             // Le Frontend reçoit le Plan + Le Code Backend
             // Il sait donc exactement quelles routes fetcher
             await runAgent("UI_BUILDER", 
               "Génère les composants et pages. Connecte-toi aux API du Backend existant.", 
               true
             );

             send("\n---\n### ✅ Finalisation\n");
             await runAgent("REPORTER", 
               "Fais le récapitulatif final. Liste les fonctionnalités prêtes.", 
               false
             );
          }

          controller.close();

        } catch (e: any) {
          console.error(e);
          send(`\n\n[ERREUR CRITIQUE]: ${e.message}`);
          controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Server Error: " + err.message }, { status: 500 });
  }
  }
