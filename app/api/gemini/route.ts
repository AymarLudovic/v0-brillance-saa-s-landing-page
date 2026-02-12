import { NextResponse } from "next/server";
import OpenAI from "openai"; // On utilise le client OpenAI pour Groq
import packageJson from 'package-json';
// Assure-toi que basePrompt contient bien tes instructions
import { basePrompt } from "@/lib/prompt";

const BATCH_SIZE = 128;

// --- CHOIX DU MODÈLE GROQ ---
// Llama 3.3 70B est excellent : rapide, gratuit, 128k contexte, très bon en code.
const MODEL_ID = "llama-3.3-70b-versatile"; 

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
  // Pour OpenAI/Groq, on garde parfois le préfixe data:..., mais ici on nettoie pour la logique interne
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

// Pour OpenAI/Groq, il faut souvent l'URL complète "data:image/..." dans le payload
function formatImageForOpenAI(base64String: string) {
  if (base64String.startsWith("data:")) return base64String;
  // Si on a juste le raw base64, on suppose que c'est du png ou jpeg, mais mieux vaut avoir le type.
  // Dans ton code actuel, tu as souvent l'URL complète dans uploadedImages.
  return base64String; 
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
    // On récupère la clé. Note : J'ai gardé la logique header mais adapté pour Groq
    const authHeader = req.headers.get("x-gemini-api-key") || req.headers.get("x-gemini-api-key"); // Fallback si tu n'as pas changé le front
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    
    if (!apiKey) return NextResponse.json({ error: "Clé API Groq manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    // Initialisation du client compatible OpenAI pointant vers Groq
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    // --- LOGIQUE D'EXCLUSION DES IMAGES ---
    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    // Préparation du System Prompt
    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        dynamicSystemInstruction += `\n\n[CONTEXTE DU PROJET - FICHIERS EXISTANTS]\nTu travailles sur un projet existant. Voici la structure actuelle :\n${JSON.stringify(currentProjectFiles, null, 2)}\nUtilise ce contexte pour respecter l'architecture existante.`;
    }

    // Construction de l'historique initial pour OpenAI/Groq
    const buildInitialMessages = () => {
      // 1. Le System Prompt est le premier message
      const messages: any[] = [
        { role: "system", content: dynamicSystemInstruction }
      ];
      
      // 2. Images de référence (si pas d'upload user)
      if (allReferenceImages?.length > 0 && !hasUserUploads) {
        // En OpenAI/Groq, on ajoute un message User avec du contenu mixte (texte + images)
        const content: any[] = [{ type: "text", text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }];
        
        allReferenceImages.slice(0, 3).forEach((img: string) => {
           content.push({
             type: "image_url",
             image_url: { url: formatImageForOpenAI(img) }
           });
        });
        messages.push({ role: "user", content });
      }

      // 3. Conversion de l'historique existant
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return; // On a déjà géré le system prompt global
        
        let role = msg.role === "assistant" ? "assistant" : "user";
        
        // Cas spécial : le dernier message utilisateur contient les uploads
        if (i === history.length - 1 && role === "user") {
            const content: any[] = [{ type: "text", text: msg.content || " " }];

            if (uploadedImages?.length > 0) {
                uploadedImages.forEach((img: string) => {
                    content.push({
                        type: "image_url",
                        image_url: { url: formatImageForOpenAI(img) }
                    });
                });
                content.push({ type: "text", text: "\n[FICHIERS UPLOADÉS PAR L'UTILISATEUR]" });
            }

            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    try {
                        const fileContent = atob(file.base64Content);
                        content.push({ type: "text", text: `\n[CONTENU DU FICHIER ${file.fileName}]:\n${fileContent}\n` });
                    } catch (e) {
                        content.push({ type: "text", text: `\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]` });
                    }
                 });
            }
            messages.push({ role, content });
        } else {
            // Message standard (texte simple pour économiser les tokens si pas d'image)
            messages.push({ role, content: msg.content });
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
          const MAX_LOOPS = 1;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            if (loopCount > 0) {
                send(`\n\n--- 🔄 Finalisation en cours (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(500); 
            }

            // Appel API Groq via le SDK OpenAI
            const response = await openai.chat.completions.create({
                model: MODEL_ID,
                messages: currentMessages,
                tools: [readFileTool], // Définition des tools
                tool_choice: "auto",
                temperature: 0.7, // Llama est souvent meilleur avec un temp plus bas que Gemini
                max_tokens: 8000, // Max output par requête
                stream: true, // IMPORTANT
                // Note: Pas de "thinkingConfig" sur Llama, c'est natif au modèle ou non supporté explicitement
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

            // --- LOGIQUE DE BOUCLE NEUTRE ---
            
            if (!currentIterationOutput.includes("[[START]]")) { // Assure-toi que ton Prompt demande bien [[START]] si c'est ta balise de fin
                 // Note: Si tu n'utilises pas [[START]] comme marqueur de fin explicite dans Llama, 
                 // tu peux vérifier si la réponse semble tronquée ou s'arrêter ici.
                 // Pour l'instant, je garde ta logique stricte :
                 shouldContinue = false;
            } 
            else {
                if (loopCount < MAX_LOOPS - 1) {
                    currentMessages.push({ role: "assistant", content: currentIterationOutput });
                    
                    const neutralContinuePrompt = "Continue l'écriture et la finalisation du code pour t'assurer que tout est complet.";
                    
                    currentMessages.push({ role: "user", content: neutralContinuePrompt });
                    loopCount++;
                } else {
                    shouldContinue = false; 
                }
            }
          } // Fin du While

          // =================================================================================
          // GESTION INTELLIGENTE DU PACKAGE.JSON (IDENTIQUE À AVANT)
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
              // Note: packageJson() est une promesse externe, ça marche toujours pareil
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
