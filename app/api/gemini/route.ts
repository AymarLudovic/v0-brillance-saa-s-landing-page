import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import packageJson from 'package-json';
// Assure-toi que basePrompt contient bien tes instructions sur les "Bêtes Noires"
import { basePrompt } from "@/lib/prompt";

const BATCH_SIZE = 128;
// On garde ton modèle spécifique
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

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    const ai = new GoogleGenAI({ apiKey });

    // --- LOGIQUE D'EXCLUSION DES IMAGES ---
    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    // Construction de l'historique initial
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      if (allReferenceImages?.length > 0 && !hasUserUploads) {
        const styleParts = allReferenceImages.slice(0, 3).map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }] });
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        if (i === history.length - 1 && role === "user") {
            if (uploadedImages?.length > 0) {
                uploadedImages.forEach((img: string) =>
                    parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
                );
                parts.push({ text: "\n[FICHIERS UPLOADÉS PAR L'UTILISATEUR]" });
            }
            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    try {
                        const content = atob(file.base64Content);
                        parts.push({ text: `\n[CONTENU DU FICHIER ${file.fileName}]:\n${content}\n` });
                    } catch (e) {
                        parts.push({ text: `\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]` });
                    }
                 });
            }
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    // Préparation du System Prompt
    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        dynamicSystemInstruction += `\n\n[CONTEXTE DU PROJET - FICHIERS EXISTANTS]\nTu travailles sur un projet existant. Voici la structure actuelle :\n${JSON.stringify(currentProjectFiles, null, 2)}\nUtilise ce contexte pour respecter l'architecture existante.`;
    }

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
            if (txt) controller.enqueue(encoder.encode(txt));
        };
        
        try {
          const currentHistory = buildInitialHistory();
          let fullSessionOutput = ""; 
          
          let loopCount = 0;
          const MAX_LOOPS = 4;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            if (loopCount > 0) {
                // Notification plus discrète
                send(`\n\n--- 🔄 Finalisation en cours (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(500); 
            }

            const response = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory, 
                tools: [{ functionDeclarations: [readFileDeclaration] }], 
                config: { 
                    systemInstruction: dynamicSystemInstruction, 
                    generationConfig: {
                        temperature: 1.2, 
                        maxOutputTokens: 8536,
                        thinkingConfig: {
                            includeThoughts: true, 
                            thinkingLevel: "high"
                        }
                    }
                },
            });

            let batchBuffer = "";
            let currentIterationOutput = ""; 

            for await (const chunk of response) {
                const txt = chunk.text; 
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

            // --- NOUVELLE LOGIQUE DE BOUCLE NEUTRE ---
            
            if (!currentIterationOutput.includes("[[START]]")) {
                shouldContinue = false;
            } 
            else {
                if (loopCount < MAX_LOOPS - 1) {
                    currentHistory.push({ role: "model", parts: [{ text: currentIterationOutput }] });
                    
                    // Ici, on envoie un prompt neutre juste pour déclencher la suite ("Re-work") 
                    // sans distraire l'IA avec de nouvelles consignes complexes.
                    const neutralContinuePrompt = "Continue l'écriture et la finalisation du code pour t'assurer que tout est complet.";
                    
                    currentHistory.push({ role: "user", parts: [{ text: neutralContinuePrompt }] });
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
          
          // 1. Analyse du package.json existant (si disponible)
          let existingDependencies: string[] = [];
          let currentPackageJsonContent: any = null;

          if (currentProjectFiles && currentProjectFiles["package.json"]) {
              try {
                  currentPackageJsonContent = JSON.parse(currentProjectFiles["package.json"]);
                  existingDependencies = [
                      ...Object.keys(currentPackageJsonContent.dependencies || {}),
                      ...Object.keys(currentPackageJsonContent.devDependencies || {})
                  ];
              } catch (e) {
                  // Erreur silencieuse
              }
          }

          // 2. Détection des VRAIES nouvelles dépendances
          // On ne garde que celles qui ne sont PAS dans le package.json actuel
          const newDependenciesToInstall = allDetectedDeps.filter(dep => !existingDependencies.includes(dep));

          // 3. Condition stricte de création/mise à jour
          // - Soit il y a de nouvelles dépendances à ajouter.
          // - Soit le fichier n'existait pas du tout et on doit le créer.
          // - Si les dépendances détectées sont identiques à celles existantes, on ne fait RIEN.
          const shouldUpdatePackageJson = hasCode && (newDependenciesToInstall.length > 0 || (!currentPackageJsonContent && allDetectedDeps.length > 0));

          if (shouldUpdatePackageJson) {
              send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances... ---\n");

              // Dépendances de base (uniquement si création à zéro)
              const baseDeps: Record<string, string> = {
                  next: "15.1.0",
                  react: "19.0.0",
                  "react-dom": "19.0.0",
                  "lucide-react": "0.561.0"
              };

              let finalDependencies: Record<string, string> = {};
              let finalDevDependencies: Record<string, string> = {};

              if (currentPackageJsonContent) {
                  // On garde l'existant
                  finalDependencies = { ...currentPackageJsonContent.dependencies };
                  finalDevDependencies = { ...currentPackageJsonContent.devDependencies };
              } else {
                  // Création neuve
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

              // On ne cherche les versions que pour les NOUVELLES dépendances
              const depsToFetch = currentPackageJsonContent ? newDependenciesToInstall : [...newDependenciesToInstall, ...Object.keys(baseDeps)];
              
              const newDepsResolved: Record<string, string> = {};
              await Promise.all(depsToFetch.map(async (pkg) => {
                  if (!pkg) return;
                  if (finalDependencies[pkg]) return; // Déjà présent
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
                  scripts: currentPackageJsonContent?.scripts || { dev: "next dev -p 3000 -H 0.0.0.0", build: "next build", start: "next start", lint: "next lint" },
                  dependencies: finalDependencies,
                  devDependencies: finalDevDependencies,
              };

              const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
              send(xmlOutput);
          }

          controller.close();

        } catch (err: any) {
          console.error("Stream error:", err);
          send(`\n\n⛔ ERREUR: ${err.message}`);
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
