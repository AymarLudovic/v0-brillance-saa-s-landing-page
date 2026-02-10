import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import packageJson from 'package-json';
// Assure-toi que basePrompt contient bien tes instructions sur les "Bêtes Noires"
import { basePrompt } from "@/lib/prompt";

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

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });

    // Construction de l'historique initial
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.slice(0, 3).map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }] });
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
            if (txt) controller.enqueue(encoder.encode(txt));
        };
        
        try {
          const currentHistory = buildInitialHistory();
          let fullSessionOutput = ""; 
          
          // =================================================================================
          // PHASE UNIQUE : GÉNÉRATION & CORRECTION INTENSIVE (Boucle de 4 tours max)
          // =================================================================================
          let loopCount = 0;
          const MAX_LOOPS = 4;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            // Notification visuelle pour l'utilisateur
            if (loopCount > 0) {
                send(`\n\n--- 🚨 ANALYSE ANTI-GHOSTING & FINALISATION (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(1000); 
            }

            const response = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory, // Toujours l'historique complet
                tools: [{ functionDeclarations: [readFileDeclaration] }], 
                config: { 
                    systemInstruction: basePrompt, 
                    generationConfig: {
                        temperature: 1.0, // Température baissée légèrement pour plus de rigueur
                        maxOutputTokens: 65536,
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

            // --- LOGIQUE CRITIQUE DE BOUCLE ---
            
            if (!currentIterationOutput.includes("[[START]]")) {
                // Si pas de code généré, on arrête la boucle (c'est probablement une réponse textuelle simple)
                shouldContinue = false;
            } 
            else {
                // Code détecté : On lance l'analyse critique
                if (loopCount < MAX_LOOPS - 1) {
                    currentHistory.push({ role: "model", parts: [{ text: currentIterationOutput }] });
                    
                    // LE PROMPT "TUEUR" DE GHOSTING
                    const correctionPrompt = `⛔ STOP. ANALYSE STRICTE REQUISE.
                    
                    Tu viens de générer du code. Maintenant, avant de considérer que tu as fini, relis tes propres fichiers et chasse tes "Bêtes Noires" :
                    
                    1. **UI Padding / Lazy Mocking** : As-tu créé des boutons ou des menus purement décoratifs ? Si oui, IMPLÉMENTE LEUR LOGIQUE MAINTENANT.
                    2. **Ghost Navigation** : Les liens de ta sidebar chargent-ils vraiment de nouvelles vues distinctes ? Si non, CRÉE CES VUES MAINTENANT.
                    3. **Interactive Impotence** : Tes boutons (Like, Filtre, Search) changent-ils vraiment un état ou une liste ? Si c'est juste visuel, C'EST REFUSÉ. Ajoute le useState et la logique de tri/filtre réelle.
                    
                    **RÈGLE D'OR :** - Si tu as mis un commentaire "// Logic to be implemented", tu as ÉCHOUÉ. Remplace-le par du code.
                    - Si tu n'as pas de backend, utilise des MOCK DATA complets (tableaux d'objets riches) pour simuler parfaitement le fonctionnement.
                    
                    Réécris UNIQUEMENT les fichiers qui nécessitent une correction pour être 100% fonctionnels et interactifs. Si tout est parfait (ce qui est rare), dis simplement "TERMINE".`;
                    
                    currentHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });
                    loopCount++;
                } else {
                    shouldContinue = false; // Max loops atteints
                }
            }
          } // Fin du While

          // --- GESTION DES DÉPENDANCES (Uniquement si du code a été produit à la fin) ---
          const hasCode = fullSessionOutput.includes("<create_file");
          const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
          
          if (hasCode && allDetectedDeps.length > 0) {
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
                  scripts: { dev: "next dev -p 3000 -H 0.0.0.0", build: "next build", start: "next start", lint: "next lint" },
                  dependencies: finalDependencies,
                  devDependencies: {
                      typescript: "^5",
                      "@types/node": "^20",
                      "@types/react": "^19",
                      "@types/react-dom": "^19",
                      postcss: "^8",
                      tailwindcss: "^3.4.1",
                      "autoprefixer": "^10.4.19",
                      eslint: "^8",
                      "eslint-config-next": "15.0.3"
                  },
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
