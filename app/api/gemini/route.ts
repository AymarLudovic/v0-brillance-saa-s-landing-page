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

// --- DEFINITION DES ROLES ---





export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });

    // Construction de l'historique initial
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // Contexte visuel global (LIMITÉ AUX 3 PREMIÈRES IMAGES)
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
          // On cache les tags techniques pour l'utilisateur final
          const sanitized = txt
            .replace(/\[\[PROJECT_START\]\]/g, "") 
            .replace(/\[\[PROJECT_FINISHED\]\]/g, "")
            .replace(/\[\[PROJECT_PAGES\]\][\s\S]*?(\n|$)/g, "") // Optionnel: Cacher le plan technique si tu veux
            .replace(/\[\[PROJECT_MODALS\]\][\s\S]*?(\n|$)/g, "")
            .replace(/\[\[PROJECT_MODALS_ROLES\]\][\s\S]*?(\n|$)/g, "")
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "");
          
          // On envoie le texte nettoyé (l'annonce reste visible, mais pas les balises internes)
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        try {
          // --- CONFIGURATION DU MODE AUTONOME AVEC RIGUEUR ---
          const systemInstruction = `${basePrompt}

          === MODE DÉVELOPPEUR AUTONOME (ITERATIF & RIGOUREUX) ===
          Tu es un expert Fullstack Senior. Tu ne fais pas de "mockups", tu fais du code de production.
          
          🚨 DÉCISION CRITIQUE AU DÉMARRAGE 🚨
          1. **SIMPLE DISCUSSION** : Réponds normalement.
          2. **PROJET / CODE** :
             - COMMENCE ta réponse par : [[PROJECT_START]]
             - Fais une ANNONCE courte à l'utilisateur.
             - ENSUITE, établis ton **MANIFESTE TECHNIQUE** (Voir ci-dessous).
             - ENFIN, commence à coder.

          === LE MANIFESTE TECHNIQUE (OBLIGATOIRE) ===
          Dès que tu lances un projet, tu dois lister ce que tu vas faire dans ces blocs précis :

          1. [[PROJECT_PAGES]]
             - Liste chaque PAGE (route) à créer.
             - Liste ses fonctionnalités clés.
             - Liste ses dépendances (Quels composants elle appelle ?).

          2. [[PROJECT_MODALS]]
             - Liste TOUS les fichiers Components, Modals, Utils, et Hooks nécessaires.
             - ⛔ INTERDICTION d'importer un fichier si tu ne le listes pas ici pour création.
             - Si tu importes "Header", tu DOIS créer "Header".

          3. [[PROJECT_MODALS_ROLES]]
             - Pour chaque composant listé, décris sa LOGIQUE (pas juste le UI).
             - Ex: "AuthModal: Doit gérer le submit, l'erreur API, le loading state, et la redirection".

          === RÈGLES D'EXÉCUTION ===
          - Procède par étapes. Ne coupe pas le XML au milieu.
          - À chaque étape de relance, VÉRIFIE ton Manifeste.
          - TANT QUE tout le manifeste n'est pas codé (Fichiers créés + Logique implémentée), tu continues.
          - QUAND TU AS TOUT FINI (et vérifié que tout est vert), écris : [[PROJECT_FINISHED]]

          FORMAT DE FICHIER :
          <create_file path="...">
          ... code brut ...
          </create_file>
          `;

          // On initialise l'historique
          let currentHistory = buildInitialHistory();
          
          // Variables de contrôle
          let stepCount = 0;
          const MAX_STEPS = 20; // Augmenté car le mode rigoureux demande plus d'étapes
          let finished = false;
          let fullSessionOutput = ""; 
          let isProjectMode = false;

          // --- BOUCLE PRINCIPALE ---
          while (!finished && stepCount < MAX_STEPS) {
            stepCount++;
            
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: currentHistory,
              tools: [{ functionDeclarations: [readFileDeclaration] }], 
              config: { systemInstruction, temperature: 0.5, maxOutputTokens: 65536 },
            });

            let currentStepOutput = "";
            let batchBuffer = "";

            for await (const chunk of response) {
              const txt = chunk.text; 
              
              if (txt) {
                batchBuffer += txt;
                currentStepOutput += txt;
                fullSessionOutput += txt;

                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = "";
                }
              }
            }
            if (batchBuffer.length > 0) send(batchBuffer);

            // --- ANALYSE ET SUPERVISION ---
            currentHistory.push({ role: "model", parts: [{ text: currentStepOutput }] });

            // 1. Détection initiale
            if (stepCount === 1) {
                if (currentStepOutput.includes("[[PROJECT_START]]")) {
                    isProjectMode = true;
                } else {
                    finished = true; // Chat simple
                }
            }

            // 2. Logique de relance (Le "Superviseur")
            if (isProjectMode) {
                if (currentStepOutput.includes("[[PROJECT_FINISHED]]")) {
                  finished = true;
                } else if (!finished) {
                  // C'est ici que la magie opère. On force l'IA à se relire.
                  const supervisorPrompt = `
                  [SYSTÈME DE VÉRIFICATION]
                  1. Relis tes listes [[PROJECT_PAGES]] et [[PROJECT_MODALS]] du début.
                  2. As-tu créé TOUS les fichiers listés ?
                  3. As-tu implémenté TOUTE la logique décrite dans [[PROJECT_MODALS_ROLES]] ?
                  4. Vérifie tes imports : est-ce que les fichiers importés existent réellement maintenant ?
                  
                  Si il reste du travail, CONTINUE immédiatement. Ne t'arrête pas.
                  Si tout est 100% complet et fonctionnel, affiche [[PROJECT_FINISHED]].
                  `;
                  
                  currentHistory.push({ role: "user", parts: [{ text: supervisorPrompt }] });
                }
            }
          }

          // --- INSTALLATION DES DÉPENDANCES ---
          const hasCode = fullSessionOutput.includes("<create_file");
          
          if (isProjectMode && hasCode) {
            const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
            
            if (allDetectedDeps.length > 0) {
                send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances complètes... ---\n");

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
                        eslint: "^8",
                        "eslint-config-next": "15.0.3"
                    },
                };

                const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
                send(xmlOutput);
            }
          }

          controller.close();

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
