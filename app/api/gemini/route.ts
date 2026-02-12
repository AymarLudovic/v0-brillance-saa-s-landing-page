import { NextResponse } from "next/server";
import OpenAI from "openai"; 
import packageJson from 'package-json';
import { basePrompt } from "@/lib/prompt";

const BATCH_SIZE = 128;

// --- CHOIX DU MODÈLE GROQ ---
// Je te conseille vivement celui-ci pour la stabilité et le code.
// Si tu veux utiliser un modèle Vision plus tard, change juste cet ID par "llama-3.2-90b-vision-preview"
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
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function formatImageForOpenAI(base64String: string) {
  if (base64String.startsWith("data:")) return base64String;
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
    const authHeader = req.headers.get("x-gemini-api-key") || req.headers.get("x-gemini-api-key"); 
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    
    if (!apiKey) return NextResponse.json({ error: "Clé API Groq manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        dynamicSystemInstruction += `\n\n[CONTEXTE DU PROJET - FICHIERS EXISTANTS]\nTu travailles sur un projet existant. Voici la structure actuelle :\n${JSON.stringify(currentProjectFiles, null, 2)}\nUtilise ce contexte pour respecter l'architecture existante.`;
    }

    // --- CORRECTION MAJEURE DANS LA CONSTRUCTION DES MESSAGES ---
    const buildInitialMessages = () => {
      const messages: any[] = [
        { role: "system", content: dynamicSystemInstruction }
      ];
      
      // Gestion des images de référence
      if (allReferenceImages?.length > 0 && !hasUserUploads) {
        // Pour les modèles Text-Only, on ne peut pas envoyer d'images.
        // Si MODEL_ID contient "vision", on envoie le tableau, sinon on ignore les images pour éviter le crash.
        const isVisionModel = MODEL_ID.includes("vision");
        
        if (isVisionModel) {
            const content: any[] = [{ type: "text", text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }];
            allReferenceImages.slice(0, 3).forEach((img: string) => {
               content.push({ type: "image_url", image_url: { url: formatImageForOpenAI(img) } });
            });
            messages.push({ role: "user", content });
        } else {
             // Si modèle texte, on prévient juste qu'il y a des refs mais on ne les envoie pas pour éviter l'erreur 400
             messages.push({ role: "user", content: "[Note: L'utilisateur a des images de référence mais le modèle actuel ne supporte pas la vision.]" });
        }
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return; 
        
        let role = msg.role === "assistant" ? "assistant" : "user";
        
        // Dernier message (contenant potentiellement les uploads)
        if (i === history.length - 1 && role === "user") {
            // On prépare le contenu sous forme de tableau d'abord
            const contentArray: any[] = [{ type: "text", text: msg.content || " " }];

            if (uploadedImages?.length > 0) {
                uploadedImages.forEach((img: string) => {
                    contentArray.push({
                        type: "image_url",
                        image_url: { url: formatImageForOpenAI(img) }
                    });
                });
                contentArray.push({ type: "text", text: "\n[FICHIERS UPLOADÉS PAR L'UTILISATEUR]" });
            }

            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    try {
                        const fileContent = atob(file.base64Content);
                        contentArray.push({ type: "text", text: `\n[CONTENU DU FICHIER ${file.fileName}]:\n${fileContent}\n` });
                    } catch (e) {
                        contentArray.push({ type: "text", text: `\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]` });
                    }
                 });
            }

            // --- LE FIX MAGIQUE ---
            // On vérifie si on a VRAIMENT des images à envoyer
            const hasActualImages = contentArray.some(item => item.type === "image_url");
            
            if (hasActualImages) {
                // Si on a des images, on envoie le tableau (Risque d'erreur 400 si le modèle n'est pas Vision, mais nécessaire pour les images)
                messages.push({ role, content: contentArray });
            } else {
                // S'il n'y a PAS d'images (juste du texte et des fichiers convertis en texte),
                // ON CONVERTIT TOUT EN STRING SIMPLE.
                // C'est ça qui empêche l'erreur "must be a string".
                const fullString = contentArray.map(item => item.text || "").join("");
                messages.push({ role, content: fullString });
            }

        } else {
            // Messages historiques simples
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
          const MAX_LOOPS = 4;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            if (loopCount > 0) {
                send(`\n\n--- 🔄 Finalisation en cours (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(500); 
            }

            const response = await openai.chat.completions.create({
                model: MODEL_ID,
                messages: currentMessages,
                tools: [readFileTool], 
                tool_choice: "auto",
                temperature: 0.7, 
                max_tokens: 8000, 
                stream: true, 
                parallel_tool_calls: false // Sécurité pour Llama 3 sur Groq
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

            
            if (!currentIterationOutput.includes("[[START]]")) { 
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
          } 

          // --- PACKAGE.JSON LOGIC ---
          
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
