import { NextResponse } from "next/server";
import OpenAI from "openai"; // On utilise le client OpenAI pour Groq
import packageJson from 'package-json';
// Assure-toi que basePrompt contient bien tes instructions
import { basePrompt } from "@/lib/prompt";

const BATCH_SIZE = 128;

// --- CHOIX DU MODÈLE GROQ ---
// On utilise le modèle VISION (90B) pour supporter les images et le code complexe.
const MODEL_ID = "llama-3.2-90b-vision-preview"; 

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// --- UTILITAIRES ---

// Fonction pour s'assurer que l'image a bien le format Data URL complet pour OpenAI/Groq
// Ex: "data:image/png;base64,..."
function ensureDataUrl(data: string) {
  if (data.startsWith("data:")) return data;
  // Si on a juste le raw base64, on devine un mime type générique (souvent suffisant)
  return `data:image/jpeg;base64,${data}`;
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

// Définition de l'outil (Tool) au format OpenAI
const readFileTool = {
  type: "function" as const,
  function: {
    name: "readFile",
    description: "Lecture fichier.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"],
    },
  },
};

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // On récupère la clé.
    const authHeader = req.headers.get("x-gemini-api-key") || req.headers.get("x-gemini-api-key"); 
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    
    if (!apiKey) return NextResponse.json({ error: "Clé API Groq manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    // Initialisation du client compatible OpenAI pointant vers Groq
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    // Préparation du System Prompt
    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        dynamicSystemInstruction += `\n\n[CONTEXTE DU PROJET - FICHIERS EXISTANTS]\nTu travailles sur un projet existant. Voici la structure actuelle :\n${JSON.stringify(currentProjectFiles, null, 2)}\nUtilise ce contexte pour respecter l'architecture existante.`;
    }

    // --- CONSTRUCTION DES MESSAGES (CORRECTION ERREUR 400) ---
    const buildInitialMessages = () => {
      // 1. System Prompt
      const messages: any[] = [
        { role: "system", content: dynamicSystemInstruction }
      ];
      
      // 2. Images de référence (si pas d'upload user)
      if (allReferenceImages?.length > 0 && !hasUserUploads) {
        // Ici on force le mode "contenu mixte" (Array) car on a des images
        const content: any[] = [{ type: "text", text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }];
        
        allReferenceImages.slice(0, 3).forEach((img: string) => {
           content.push({
             type: "image_url",
             image_url: { url: ensureDataUrl(img) }
           });
        });
        messages.push({ role: "user", content });
      }

      // 3. Historique et dernier message
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return; 
        
        let role = msg.role === "assistant" ? "assistant" : "user";
        
        // C'est le dernier message utilisateur ? (C'est là qu'on gère les uploads)
        if (i === history.length - 1 && role === "user") {
            
            // On prépare d'abord tout le texte
            let textContent = msg.content || " ";

            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    try {
                        const fileContent = atob(file.base64Content);
                        textContent += `\n\n[CONTENU DU FICHIER ${file.fileName}]:\n${fileContent}\n`;
                    } catch (e) {
                        textContent += `\n\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]`;
                    }
                 });
            }

            // A-t-on des images à uploader ?
            const hasImages = uploadedImages?.length > 0;

            if (hasImages) {
                // CAS 1: IMAGES PRÉSENTES -> On envoie un Tableau (Mixed Content)
                const content: any[] = [{ type: "text", text: textContent }];
                
                uploadedImages.forEach((img: string) => {
                    content.push({
                        type: "image_url",
                        image_url: { url: ensureDataUrl(img) }
                    });
                });
                content.push({ type: "text", text: "\n[FICHIERS IMAGES UPLOADÉS]" });
                
                messages.push({ role, content });
            } else {
                // CAS 2: PAS D'IMAGES -> On envoie une SIMPLE STRING
                // C'est ICI que l'erreur 400 est corrigée. Groq déteste les tableaux sans images.
                messages.push({ role, content: textContent });
            }

        } else {
            // Messages historiques normaux : Simple String
            messages.push({ role, content: msg.content || "" });
        }
      });

      return messages;
    };


    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
            if (txt) controller.enqueue(encoder.encode(txt));
        };
        
        try {
          const currentMessages = buildInitialMessages();
          let fullSessionOutput = ""; 
          
          let loopCount = 0;
          const MAX_LOOPS = 4;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            if (loopCount > 0) {
                send(`\n\n--- 🔄 Finalisation en cours (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(500); 
            }

            // Appel API Groq
            const response = await openai.chat.completions.create({
                model: MODEL_ID,
                messages: currentMessages,
                tools: [readFileTool], 
                tool_choice: "auto",
                temperature: 0.7, 
                max_tokens: 8000, 
                stream: true, 
            });

            let batchBuffer = "";
            let currentIterationOutput = ""; 

            for await (const chunk of response) {
                const txt = chunk.choices[0]?.delta?.content || ""; 
                if (txt) {
                    batchBuffer += txt;
                    fullSessionOutput += txt; 
                    currentIterationOutput += txt; 

                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            if (batchBuffer.length > 0) send(batchBuffer);

            // --- LOGIQUE DE BOUCLE ---
            // Si la réponse ne contient pas le marqueur de fin (ex: [[START]] ou balise XML de fin), on boucle.
            // Note: Adapte la condition selon ton prompt. Ici je garde ta logique [[START]].
            if (!currentIterationOutput.includes("[[START]]")) { 
                 shouldContinue = false;
            } 
            else {
                if (loopCount < MAX_LOOPS - 1) {
                    currentMessages.push({ role: "assistant", content: currentIterationOutput });
                    
                    // IMPORTANT : Le prompt de continuation doit être une string simple
                    const neutralContinuePrompt = "Continue l'écriture et la finalisation du code pour t'assurer que tout est complet.";
                    currentMessages.push({ role: "user", content: neutralContinuePrompt });
                    
                    loopCount++;
                } else {
                    shouldContinue = false; 
                }
            }
          } // Fin du While

          // =================================================================================
          // GESTION INTELLIGENTE DU PACKAGE.JSON
          // =================================================================================
          
          const hasCode = fullSessionOutput.includes("<create_file");
          const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
          
          let existingDependencies: string[] = [];
          let currentPackageJsonContent: any = null;

          if (currentProjectFiles && currentProjectFiles["package.json"]) {
              try {
                  currentPackageJsonContent = JSON.parse(currentProjectFiles["package.json"]);
                  existingDependencies = [
                      ...Object.keys(currentPackageJsonContent.dependencies || {}),
                      ...Object.keys(currentPackageJsonContent.devDependencies || {})
                  ];
              } catch (e) { }
          }

          const newDependenciesToInstall = allDetectedDeps.filter(dep => !existingDependencies.includes(dep));
          const shouldUpdatePackageJson = hasCode && (newDependenciesToInstall.length > 0 || (!currentPackageJsonContent && allDetectedDeps.length > 0));

          if (shouldUpdatePackageJson) {
              send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances (Groq)... ---\n");

              const baseDeps: Record<string, string> = {
                  next: "15.1.0",
                  react: "19.0.0",
                  "react-dom": "19.0.0",
                  "lucide-react": "0.561.0"
              };

              let finalDependencies: Record<string, string> = {};
              let finalDevDependencies: Record<string, string> = {};

              if (currentPackageJsonContent) {
                  finalDependencies = { ...currentPackageJsonContent.dependencies };
                  finalDevDependencies = { ...currentPackageJsonContent.devDependencies };
              } else {
                  finalDependencies = { ...baseDeps };
                  finalDevDependencies = {
                      typescript: "^5",
                      "@types/node": "^20",
                      "@types/react": "^19",
                      "@types/react-dom": "^19",
                      postcss: "^8",
                      tailwindcss: "^3.4.1",
                      "autoprefixer": "^10.4.19",
                      eslint: "^8",
                      "eslint-config-next": "15.0.3"
                  };
              }

              const depsToFetch = currentPackageJsonContent ? newDependenciesToInstall : [...newDependenciesToInstall, ...Object.keys(baseDeps)];
              
              const newDepsResolved: Record<string, string> = {};
              
              await Promise.all(depsToFetch.map(async (pkg) => {
                  if (!pkg) return;
                  if (finalDependencies[pkg]) return;
                  try {
                      const data = await packageJson(pkg);
                      newDepsResolved[pkg] = data.version as string;
                  } catch (err) {
                      newDepsResolved[pkg] = "latest";
                  }
              }));

              finalDependencies = { ...finalDependencies, ...newDepsResolved };
              
              const packageJsonContent = {
                  name: currentPackageJsonContent?.name || "nextjs-app",
                  version: currentPackageJsonContent?.version || "1.0.0",
                  private: true,
                  scripts: currentPackageJsonContent?.scripts || { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
                  dependencies: finalDependencies,
                  devDependencies: finalDevDependencies,
              };

              const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
              send(xmlOutput);
          }

          controller.close();

        } catch (err: any) {
          console.error("Stream error:", err);
          send(`\n\n⛔ ERREUR GROQ: ${err.message}`);
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
