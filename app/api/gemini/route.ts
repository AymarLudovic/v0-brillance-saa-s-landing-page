import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from 'package-json';

const BATCH_SIZE = 128;
// Utilise un modèle valide (Flash 2.0 est excellent pour la vitesse/qualité)
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

// --- UTILITAIRES DE SUPERVISION ---
function extractManifestRequirements(text: string): string[] {
  const requirements: string[] = [];
  const manifestRegex = /\[\[PROJECT_(?:PAGES|MODALS)\]\]([\s\S]*?)(?=\[\[|$)/g;
  let match;
  while ((match = manifestRegex.exec(text)) !== null) {
    const content = match[1];
    const fileLines = content.match(/(?:[-*]|\d+\.)\s+([a-zA-Z0-9_\-\/]+\.(tsx|ts|js|jsx|css|json))/g);
    if (fileLines) {
      fileLines.forEach(line => {
        const cleanPath = line.replace(/(?:[-*]|\d+\.)\s+/, "").trim();
        requirements.push(cleanPath);
      });
    }
  }
  return requirements;
}

function extractCreatedFiles(text: string): string[] {
  const created: string[] = [];
  const xmlRegex = /<create_file\s+path=["']([^"']+)["']/g;
  let match;
  while ((match = xmlRegex.exec(text)) !== null) {
    created.push(match[1]);
  }
  return created;
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

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });

    // Construction de l'historique
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.slice(0, 3).map((img: string) => ({
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
        // --- CORRECTION CRITIQUE ICI ---
        // On ne supprime plus le contenu qui suit les balises, seulement les balises elles-mêmes.
        // Cela évite d'avaler le code XML s'il est collé au texte.
        send = (txt: string) => {
          const sanitized = txt
            .replace(/\[\[PROJECT_START\]\]/g, "") 
            .replace(/\[\[PROJECT_FINISHED\]\]/g, "")
            // On enlève juste le titre, on laisse le contenu (la liste des fichiers) visible pour l'utilisateur
            // C'est mieux pour l'UX et ça évite les bugs de suppression de code.
            .replace(/\[\[PROJECT_PAGES\]\]/g, "**Plan des Pages :**") 
            .replace(/\[\[PROJECT_MODALS\]\]/g, "**Composants & Utils :**")
            .replace(/\[\[PROJECT_MODALS_ROLES\]\]/g, "") // Celui-là on peut le cacher si on veut, ou le laisser
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "");
          
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        try {
          const systemInstruction = `${basePrompt}

          === MODE DÉVELOPPEUR FULLSTACK PRO ===
          Tu es un expert Senior. Tu ne fais pas de mockups, tu codes pour la production.
          
          🚨 RÈGLE ABSOLUE : FONCTIONNALITÉS RÉELLES 🚨
          - PAS de href="#" -> Utilise de vraies routes Next.js.
          - PAS de boutons vides -> Connecte les événements (onClick, onSubmit).
          - PAS de "TODO" -> Implémente la logique maintenant.
          
          === PROTOCOLE PROJET ===
          1. **ANALYSE** : Si la demande implique du code, commence par [[PROJECT_START]].
          2. **MANIFESTE** : Liste les fichiers que tu vas créer (Pages, Composants).
             - Utilise les blocs : [[PROJECT_PAGES]] et [[PROJECT_MODALS]].
             - DANS [[PROJECT_MODALS_ROLES]], décris la logique métier de chaque fichier.
          3. **EXÉCUTION** : Génère le code dans des balises XML.
             <create_file path="chemin/fichier.tsx"> ...code... </create_file>

          4. **DÉPENDANCES** : À la toute fin, liste les libs externes  les package que tu utiliseras loste les:
             DEPENDENCIES: ["zod", "autre"]

             Pourquoi tout ceci, en fait je t'explique ma vision que je redoute de toi pour la création des applications des utilisateur: ils me paie des milliers de dollars par mois pour que tu construise des applications solides et non des mvg, voici plus de détails :
          Okay ça semble déjà être bon j'apprécie juste qu'il faut le rendre encore plus robuste. Et même il faut y rajouter quelques choses dont je vais t'en parler maintenant : En effet elle fait déjà presque tout ce qu'elle oublie mais le soucis est que son UI ne s'adapte pas et elle ne code en rien les fonctionnalités réel, elle fait juste disons 2 sur 50, fonctionnalités que l'on s'entend. Quand je parle de fonctionnalités je veux dire imagine un Spotify qui est juste du UI qui ne fait absolument aucune fonctionnalités mais peut être juste le lecteur de musique donne mais le reste non, imagine un peu les millions de dollars qu'il perdent. Et même son UI si elle a créé les fichiers modals, elle ne fait pas que son UI appel par exemple ses modals, c'est à dire que si au départ elle a mis que l'URL dans la sidebar ou un menu de navigation à # elle ne va jamais chercher à mettre la route. Elle ne va jamais chercher à ce que une input par exemple de recherche face son putain de travail. Si l'utilisateur à demander qu'il veux une plateforme de trading, elle ne fait que juste de légère fonctionnalités et pas un level de logiciels du niveau d'une startup comme Uber, Apple Google même. Les modals créé oui sont créé mais sont juste créé et n'ont aucune utilité. 

"Le code que tu as déjà fait pallie légèrement déjà ça signale aussi à l'IA quand elle a oublié des fichiers. Mais tout ce ci n'est pas au niveau encore à cause des fonctionnalités. On ne peut pas compter sur l'IA pour faire ça comme tu l'as toi même dis mais il faut ce que tu as dis mais disons et fait dans mon code mais 100 fois plus efficace encore pour absolument pallier à tout ce problème et s'élever au niveau de ces grandes entreprises. Ce n'est pas juste que tu vas indiqué à l'IA que oui mais tu es développeur, n'oublie pas non ta méthode que tu m'as sorti ici la est bien mais elle doit encore être plus robuste ou tu rajoutes même encore une fonction qui va le faire avec une perfection absolue "
c'est le problème dont je me plains avec vous les llm et les modèles lite même. Je met toute ma confiance en toi pour réellement résoudre se problème 
          
          `;

          let currentHistory = buildInitialHistory();
          
          let stepCount = 0;
          const MAX_STEPS = 25; 
          let finished = false;
          let fullSessionOutput = ""; 
          let isProjectMode = false;

          // --- STATE MANAGER ---
          let expectedFiles: Set<string> = new Set();
          let createdFiles: Set<string> = new Set();

          while (!finished && stepCount < MAX_STEPS) {
            stepCount++;
            
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: currentHistory,
              tools: [{ functionDeclarations: [readFileDeclaration] }], 
              config: { systemInstruction, temperature: 0.4, maxOutputTokens: 65536 },
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

            currentHistory.push({ role: "model", parts: [{ text: currentStepOutput }] });

            // 1. Détection initiale (Plus souple : si on voit du XML, c'est un projet)
            if (stepCount === 1) {
                if (currentStepOutput.includes("[[PROJECT_START]]") || currentStepOutput.includes("<create_file")) {
                    isProjectMode = true;
                } else {
                    finished = true;
                }
            }

            // 2. Le Superviseur
            if (isProjectMode) {
                const newPromises = extractManifestRequirements(currentStepOutput);
                newPromises.forEach(p => expectedFiles.add(p));

                const newCreations = extractCreatedFiles(currentStepOutput);
                newCreations.forEach(c => createdFiles.add(c));

                const missingFiles = Array.from(expectedFiles).filter(f => !createdFiles.has(f));
                const aiSaysFinished = currentStepOutput.includes("[[PROJECT_FINISHED]]");

                if (missingFiles.length > 0) {
                    // Force la création des oublis
                    finished = false;
                    const supervisorPrompt = `[SYSTÈME] Tu as oublié de générer ces fichiers promis : ${missingFiles.join(", ")}. Génère-les maintenant avec leur logique complète.`;
                    currentHistory.push({ role: "user", parts: [{ text: supervisorPrompt }] });
                } else if (aiSaysFinished) {
                    finished = true;
                } else {
                    // Si l'IA s'arrête au milieu sans dire FINISHED
                    if (!currentStepOutput.trim().endsWith("</create_file>") && !aiSaysFinished) {
                         currentHistory.push({ role: "user", parts: [{ text: "Continue le code." }] });
                    }
                }
            }
          }

          // --- INSTALLATION DES DÉPENDANCES ---
          const hasCode = fullSessionOutput.includes("<create_file");
          
          if (isProjectMode && hasCode) {
            const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
            
            if (allDetectedDeps.length > 0) {
                send("\n\n--- 📦 [AUTO-INSTALL] Configuration... ---\n");

                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0",
                    "clsx": "^2.1.0",
                    "tailwind-merge": "^2.2.1"
                };
                const newDeps: Record<string, string> = {};

                // Gestion d'erreur pour package-json pour ne pas casser le stream
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
          }

          controller.close();

        } catch (err: any) {
          console.error("Workflow error:", err);
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
