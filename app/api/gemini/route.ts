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
  // Regex pour capturer le tableau de dépendances
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      // Fallback manuel si le JSON est mal formé
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

  // Fonction utilitaire pour le délai (pause entre les appels)
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles, currentPlan } = body;

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
          // On initialise l'historique mutable
          const currentHistory = buildInitialHistory();
          let fullSessionOutput = ""; 
          let hasGeneratedCode = false; // Flag pour savoir si on active la phase 2
          
          // =================================================================================
          // PHASE 1 : GÉNÉRATION & ANTI-GHOSTING (Boucle Initiale de 3 tours)
          // =================================================================================
          let loopCount = 0;
          const MAX_LOOPS = 3;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            // Si ce n'est pas le premier tour, on notifie le client qu'on relance une vérification
            if (loopCount > 0) {
                send(`\n\n--- 🔄 CYCLE DE VÉRIFICATION ANTI-GHOSTING (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(2000); // Petit délai pour laisser respirer l'API
            }

            const response = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory, // On passe l'historique à jour
                tools: [{ functionDeclarations: [readFileDeclaration] }], 
                config: { 
                    systemInstruction: basePrompt, 
                    generationConfig: {
                        temperature: 1.5, 
                        maxOutputTokens: 65536,
                        thinkingConfig: {
                            includeThoughts: true, 
                            thinkingLevel: "high"
                        }
                    }
                },
            });

            let batchBuffer = "";
            let currentIterationOutput = ""; // Pour analyser ce tour spécifique

            for await (const chunk of response) {
                const txt = chunk.text; 
                if (txt) {
                    batchBuffer += txt;
                    fullSessionOutput += txt; // Cumul global pour les dépendances finales
                    currentIterationOutput += txt; // Cumul local pour la vérification

                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            if (batchBuffer.length > 0) send(batchBuffer);

            // --- VÉRIFICATION DU BESOIN DE CORRECTION (PHASE 1) ---
            if (currentIterationOutput.includes("[[START]]")) {
                hasGeneratedCode = true; // On marque que du code a été produit

                if (loopCount < MAX_LOOPS - 1) {
                    // On met à jour l'historique pour le prochain tour
                    currentHistory.push({ role: "model", parts: [{ text: currentIterationOutput }] });
                    
                    // --- TON PROMPT ORIGINAL EXACT ---
                    const correctionPrompt = `Tu as utilisé [[START]], donc tu as généré du code. 
                    Vérifie bien si tous les problèmes de "ghosting" (code incomplet) et de "laziness" sont traités. 
                    C'est pour te redonner la chance de tout corriger afin que l'on atteigne l'objectif absolu de zéro erreurs de ce type.
                    Si tu vois [[FINISH]], relis ton code et réécris les parties manquantes ou simplifiées à l'excès. Attention, il ne s'agit pas de faire des corrections en recréant inutilement des fichiers déjà créé et en oubliant qu'il existe même et en te mettant à créer de nouveaux, Non ce n'est pas ça.
                    C'est corrigé les fichiers qui existe déjà et créé uniquement ceux qui sont appelés par ces fichiers existant. C'est pour que l'on évite de se retrouver avec des trentaines de fichier inutiles, pour peut être même 
                    des erreurs qui se trouve dans le jsx à cause d'un élément mal importer ou de mauvais types.
                    C'est tout cela aussi que la correction du ghosting et lazyness concerne en plus de ceux que je t'ai defini dans tes instructions`;
                    
                    currentHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });
                    loopCount++;
                } else {
                    shouldContinue = false; // Fin des essais anti-ghosting
                }
            } else {
                // Pas de code généré ou pas de tag start -> On arrête la boucle
                shouldContinue = false;
            }
          } // Fin du While Phase 1


          // =================================================================================
          // PHASE 2 : DEEP QA & SECURITY (Fonctionnel + Sécurité) - Uniquement si code généré
          // =================================================================================
          
          if (hasGeneratedCode) {
            // S'assurer que la dernière sortie de l'IA est bien dans l'historique avant de continuer
            // (Si on est sorti de la boucle au tour 0 ou sans faire de push manuel)
            const lastMsg = currentHistory[currentHistory.length - 1];
            if (lastMsg.role !== "model") {
                 // Note: ceci est une sécurité. Normalement la boucle gère, mais si on sort au 1er tour:
                 // On ajoute tout ce qui a été généré jusqu'ici comme context pour la suite.
                 // Pour simplifier, on n'ajoute que si nécessaire.
                 // Dans la logique ci-dessus, si loopCount=0, history n'a pas la réponse.
                 if (loopCount === 0) {
                     currentHistory.push({ role: "model", parts: [{ text: fullSessionOutput }] });
                 }
            }

            // --- ÉTAPE 1 : VÉRIFICATION FONCTIONNELLE (READY TO PROD) ---
            await wait(3000); // Délai de "réflexion" et pour éviter le rate limit
            send(`\n\n--- 🌟 VÉRIFICATION FONCTIONNELLE (READY TO PROD) ---\n`);

            const functionalPrompt = `Maintenant que le code de base est là, je veux vérifier si l'IA a construit la plateforme demandée par l'utilisateur de façon totalement fonctionnelle par rapport à la requête envoyée.
            Vérifie véritablement que toutes les fonctionnalités demandées ont été effectuées avec succès et qu'elles marchent effectivement bien.
            ATTENTION : Pas de MVP. Je veux une version "Ready to Production" dans l'optique d'avoir les 1450 premiers utilisateurs satisfaits de chacune des fonctionnalités.
            Si une fonctionnalité a été négligée, simplifiée ou oubliée, corrige-la MAINTENANT pour atteindre cet objectif de satisfaction totale.
            Attention, il ne s'agit pas de faire des corrections en recréant inutilement des fichiers déjà créé et en oubliant qu'il existe même et en te mettant à créer de nouveaux, Non ce n'est pas ça.
                    C'est corrigé les fichiers qui existe déjà et créé uniquement ceux qui sont appelés par ces fichiers existant. C'est pour que l'on évite de se retrouver avec des trentaines de fichier inutiles, pour peut être même 
                    des erreurs qui se trouve dans le jsx à cause d'un élément mal importer ou de mauvais types.
                    C'est tout cela aussi que la correction du ghosting et lazyness concerne en plus de ceux que je t'ai defini dans tes instructions`;
                    

            currentHistory.push({ role: "user", parts: [{ text: functionalPrompt }] });

            const funcResponse = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory,
                tools: [{ functionDeclarations: [readFileDeclaration] }],
                config: { 
                    systemInstruction: basePrompt, 
                    generationConfig: {
                        temperature: 1.5, 
                        maxOutputTokens: 65536,
                        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" }
                    }
                },
            });

            let funcBuffer = "";
            let funcOutput = "";
            for await (const chunk of funcResponse) {
                const txt = chunk.text; 
                if (txt) {
                    funcBuffer += txt;
                    fullSessionOutput += txt;
                    funcOutput += txt;
                    if (funcBuffer.length >= BATCH_SIZE) { send(funcBuffer); funcBuffer = ""; }
                }
            }
            if (funcBuffer.length > 0) send(funcBuffer);
            currentHistory.push({ role: "model", parts: [{ text: funcOutput }] });


            // --- ÉTAPE 2 : VÉRIFICATION SÉCURITÉ & ROBUSTESSE ---
            await wait(3000); // Délai supplémentaire
            send(`\n\n--- 🛡️ VÉRIFICATION SÉCURITÉ & ROBUSTESSE ---\n`);

            const securityPrompt = `Deuxièmement, vérifie si toutes les fonctionnalités ont été faites et qu'aucune n'a été négligée ou faite de façon légère et insécurisée.
            L'objectif est d'éviter des attaques de hackeurs et de contournement via le DOM du navigateur. Tout doit être vraiment solide côté intégration.
            Vérifie aussi scrupuleusement si aucun fichier n'a d'erreurs quelconques et qu'ils sont tous bien faits sans erreurs, ni d'erreurs d'appel ou de syntaxe.
            Si tu trouves la moindre faille, code fragile ou erreur, corrige-le IMMÉDIATEMENT dans ta réponse.
          Attention, il ne s'agit pas de faire des corrections en recréant inutilement des fichiers déjà créé et en oubliant qu'il existe même et en te mettant à créer de nouveaux, Non ce n'est pas ça.
                    C'est corrigé les fichiers qui existe déjà et créé uniquement ceux qui sont appelés par ces fichiers existant. C'est pour que l'on évite de se retrouver avec des trentaines de fichier inutiles, pour peut être même 
                    des erreurs qui se trouve dans le jsx à cause d'un élément mal importer ou de mauvais types.
                    C'est tout cela aussi que la correction du ghosting et lazyness concerne en plus de ceux que je t'ai defini dans tes instructions`;
                    

            currentHistory.push({ role: "user", parts: [{ text: securityPrompt }] });

            const secResponse = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory,
                tools: [{ functionDeclarations: [readFileDeclaration] }],
                config: { 
                    systemInstruction: basePrompt, 
                    generationConfig: {
                        temperature: 1.5, // Un peu plus strict pour la sécurité
                        maxOutputTokens: 65536,
                        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" }
                    }
                },
            });

            let secBuffer = "";
            for await (const chunk of secResponse) {
                const txt = chunk.text; 
                if (txt) {
                    secBuffer += txt;
                    fullSessionOutput += txt;
                    if (secBuffer.length >= BATCH_SIZE) { send(secBuffer); secBuffer = ""; }
                }
            }
            if (secBuffer.length > 0) send(secBuffer);
          }


          // --- GESTION DES DÉPENDANCES (Sur la totalité de la sortie : Phase 1 + Phase 2) ---
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
