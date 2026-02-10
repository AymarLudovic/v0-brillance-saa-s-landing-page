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
    // Ajout de currentProjectFiles dans la récupération
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    const ai = new GoogleGenAI({ apiKey });

    // --- LOGIQUE D'EXCLUSION DES IMAGES ---
    // Si l'utilisateur envoie une image ou un fichier, on NE MET PAS les images de référence globale
    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    // Construction de l'historique initial
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // On ajoute les références SEULEMENT SI aucun upload utilisateur n'est présent
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
            // Gestion des images uploadées par l'user (Prioritaire)
            if (uploadedImages?.length > 0) {
                uploadedImages.forEach((img: string) =>
                    parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
                );
                parts.push({ text: "\n[FICHIERS UPLOADÉS PAR L'UTILISATEUR]" });
            }
            // Gestion des fichiers texte/code uploadés
            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    // On décode le base64 pour le donner en texte à l'IA (si c'est du code)
                    // Note: Si ce sont des binaires, il faut adapter, mais pour du code c'est mieux en texte
                    try {
                        const content = atob(file.base64Content);
                        parts.push({ text: `\n[CONTENU DU FICHIER ${file.fileName}]:\n${content}\n` });
                    } catch (e) {
                        // Fallback si ce n'est pas du texte
                        parts.push({ text: `\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]` });
                    }
                 });
            }
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    // Préparation du System Prompt avec le contexte du projet
    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        // On donne à l'IA la structure actuelle pour éviter qu'elle ne réinvente la roue ou écrase aveuglément
        // On peut passer soit la liste des noms, soit un résumé. Ici on passe l'objet JSON stringifié (attention à la taille)
        // Ou juste la liste des chemins si l'objet est trop gros.
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
                contents: currentHistory, 
                tools: [{ functionDeclarations: [readFileDeclaration] }], 
                config: { 
                    systemInstruction: dynamicSystemInstruction, 
                    generationConfig: {
                        temperature: 1.2, // RÉDUIT À 0.8 pour plus de stabilité et moins d'erreurs de syntaxe
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
                // Si pas de code généré, on arrête la boucle
                shouldContinue = false;
            } 
            else {
                // Code détecté : On lance l'analyse critique
                if (loopCount < MAX_LOOPS - 1) {
                    currentHistory.push({ role: "model", parts: [{ text: currentIterationOutput }] });
                    
                    // --- CORRECTION PROMPT RENFORCÉ ---
                    const correctionPrompt = `⛔ STOP. MODE CRITIQUE : VERIFICATION DE LAZINESS & LOGIQUE.
                    
                    Tu viens de générer du code. Avant de finir, tu dois passer ce test de qualité strict. Cherche ces erreurs fatales dans ton code actuel :

                    1. **UI Padding / Lazy Mocking** : As-tu créé des boutons ou des menus purement décoratifs ? Si oui, IMPLÉMENTE LEUR LOGIQUE.
                    2. **Ghost Navigation** : Les liens chargent-ils vraiment de nouvelles vues ? Si non, CRÉE CES VUES.
                    3. **Interactive Impotence** : Tes boutons (Like, Filtre, Search) changent-ils vraiment un état ? Si c'est juste visuel, C'EST REFUSÉ.
                    
                    --- NOUVELLES RÈGLES STRICTES (ANTI-GHOSTING) ---
                    
                    4. **INTERDICTION DE TEXTE GÉNÉRIQUE** : Si je trouve une phrase du type :
                       - "This view is part of the X module"
                       - "Connected to core system engine"
                       - "Ready for data integration"
                       -> **C'EST UN ÉCHEC.** Tu dois supprimer ce texte et le remplacer par de VRAIS composants (Tableaux remplis, Graphiques statiques, Cartes d'info).
                       
                    5. **CLONE WARS (Vue Dupliquée)** : Si "Insights" ressemble exactement à "Action Queue" avec juste le titre qui change :
                       -> **REFUSÉ.** Une vue "Insights" DOIT contenir des graphiques (recharts ou div CSS). Une vue "Action" DOIT contenir une liste interactive.
                       
                    6. **ZOMBIE MODALS** : Si tu as un bouton "Create Task", il doit :
                       - Ouvrir une vraie modale (state isOpen).
                       - Contenir un vrai formulaire.
                       - **Au Submit : Ajouter visuellement l'item dans la liste (setItems([...items, newItem])).** Ne fais pas juste un console.log !
                    
                    **RÈGLE D'OR :** Si tu n'as pas de backend, tu es OBLIGÉ d'utiliser des **Mock Data riches** et des \`useState\` pour simuler TOUTE la vie de l'application.
                    
                    Réécris UNIQUEMENT les fichiers fautifs pour qu'ils soient 100% fonctionnels et différents les uns des autres. Si tout est parfait, dis "TERMINE".
                    Ici j'ai pris l'exemple d'une application mais en fait c'est pour l'application actuelle que l'utilisateur t'a demandé de générer que tu dois faire cela et réfléchir ainsi en tout point et corriger.`;
                    
                    currentHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });
                    loopCount++;
                } else {
                    shouldContinue = false; // Max loops atteints
                }
            }
          } // Fin du While

          // --- GESTION DES DÉPENDANCES ---
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
