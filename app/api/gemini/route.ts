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

// --- NOUVEAUX UTILITAIRES DE SUPERVISION ET DE QUALITÉ ---

// 1. Extrait les fichiers promis
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

// 2. Extrait les fichiers réellement créés
function extractCreatedFiles(text: string): string[] {
  const created: string[] = [];
  const xmlRegex = /<create_file\s+path=["']([^"']+)["']/g;
  let match;
  while ((match = xmlRegex.exec(text)) !== null) {
    created.push(match[1]);
  }
  return created;
}

// 3. NOUVELLE FONCTION CRITIQUE : Analyseur de Qualité et de Fonctionnalité
// Cette fonction scanne le code pour détecter la "paresse" de l'IA.
function validateCodeQuality(text: string): string[] {
  const issues: string[] = [];
  
  // Regex pour capturer le contenu des fichiers
  const fileContentRegex = /<create_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/create_file>/g;
  let match;

  while ((match = fileContentRegex.exec(text)) !== null) {
    const fileName = match[1];
    const content = match[2];

    // Check 1: Liens morts (href="#")
    if ((content.includes('href="#"') || content.includes("href='#'")) && !fileName.includes("layout")) {
      issues.push(`Le fichier ${fileName} contient des liens morts (href="#"). Utilise de vraies routes Next.js.`);
    }

    // Check 2: Commentaires de paresse "TODO"
    if (content.match(/\/\/\s*TODO/i) || content.match(/\/\/\s*Implement/i)) {
      issues.push(`Le fichier ${fileName} contient des commentaires "TODO". Implémente la VRAIE logique maintenant.`);
    }

    // Check 3: Handlers vides ou alert()
    if (content.match(/onClick=\{?\(\)\s*=>\s*\{\}?\}?/)) {
      issues.push(`Le fichier ${fileName} a des onClick vides. Connecte les états ou les appels API.`);
    }
    if (content.includes("alert(")) {
      issues.push(`Le fichier ${fileName} utilise 'alert()'. C'est interdit. Utilise un vrai UI (Toast/Modal) ou console.error.`);
    }

    // Check 4: Absence de gestion d'état pour les inputs (Basic check)
    if (content.includes("<input") && !content.includes("onChange") && !content.includes("register")) {
      // On ignore si c'est du pur HTML statique, mais rare dans une app React
      issues.push(`Le fichier ${fileName} a des inputs sans gestion d'état (onChange/React Hook Form).`);
    }
  }

  return issues;
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
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles, currentPlan } = body;

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
        send = (txt: string) => {
          const sanitized = txt
            .replace(/\[\[PROJECT_START\]\]/g, "") 
            .replace(/\[\[PROJECT_FINISHED\]\]/g, "")
            .replace(/\[\[PROJECT_PAGES\]\][\s\S]*?(\n|$)/g, "") 
            .replace(/\[\[PROJECT_MODALS\]\][\s\S]*?(\n|$)/g, "")
            .replace(/\[\[PROJECT_MODALS_ROLES\]\][\s\S]*?(\n|$)/g, "")
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "");
          
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        try {
          // --- INSTRUCTION SYSTÈME RENFORCÉE (CONSTITUTION DE PRODUCTION) ---
          const systemInstruction = `${basePrompt}

          === MODE DÉVELOPPEUR FULLSTACK SENIOR (NIVEAU PRODUCTION) ===
          Tu es un architecte logiciel travaillant pour une startup de haut niveau (type Uber/Airbnb).
          
          🚨 RÈGLE D'OR : "NO HOLLOW UI" (PAS DE COQUILLE VIDE) 🚨
          Chaque fichier que tu crées doit être FONCTIONNEL.
          - ⛔ INTERDIT : href="#"
          - ⛔ INTERDIT : onClick={() => {}} ou console.log("TODO")
          - ⛔ INTERDIT : Modals qui ne s'ouvrent pas ou ne soumettent rien.
          - ⛔ INTERDIT : Inputs de recherche qui ne filtrent rien.

          ✅ OBLIGATOIRE :
          - Utilise 'useState', 'useEffect', 'useRouter' pour rendre les composants vivants.
          - Si tu crées une SearchBar, elle DOIT filtrer une liste de données (même mockée proprement).
          - Si tu crées un Login, il doit gérer le loading state et l'erreur.
          - Si tu crées une Navigation, les liens doivent pointer vers les vraies routes (/dashboard, /settings...).

          === PROTOCOLE DE DÉMARRAGE ===
          1. **SIMPLE DISCUSSION** : Réponds normalement.
          2. **PROJET / CODE** :
             - COMMENCE par : [[PROJECT_START]]
             - Établis ton MANIFESTE TECHNIQUE.
             - CODE tout de A à Z.

          === LE MANIFESTE TECHNIQUE ===
          Avant de coder, liste ton plan dans ces blocs :

          1. [[PROJECT_PAGES]]
             - Format : - app/route/page.tsx
          
          2. [[PROJECT_MODALS]]
             - Liste TOUS les composants/utils.
             - Format : - components/Nom.tsx

          3. [[PROJECT_MODALS_ROLES]]
             - ⚠️ CRUCIAL : Pour chaque fichier, définis sa logique MÉTIER.
             - Ex: "Header.tsx : Doit inclure un state pour le menu mobile, et des liens actifs via usePathname."
             - Ex: "TradeModal.tsx : Doit valider l'input (zod), calculer le total en temps réel, et simuler l'appel API."

          === RÈGLES D'EXÉCUTION ===
          - Le système vérifie ton code. Si tu es paresseux (href="#", TODO), tu seras rejeté.
          - Utilise <create_file path="...">... code ...</create_file>
          - QUAND TU AS FINI : [[PROJECT_FINISHED]]
          - DEPENDENCIES: ["package", "autre"] à la fin.


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

          // --- BOUCLE PRINCIPALE AVEC AUDITEUR DE QUALITÉ ---
          while (!finished && stepCount < MAX_STEPS) {
            stepCount++;
            
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: currentHistory,
              tools: [{ functionDeclarations: [readFileDeclaration] }], 
              config: { systemInstruction, temperature: 0.4, maxOutputTokens: 65536 }, // Température baissée pour la rigueur
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

            // 1. Détection initiale
            if (stepCount === 1) {
                if (currentStepOutput.includes("[[PROJECT_START]]")) {
                    isProjectMode = true;
                } else {
                    finished = true;
                }
            }

            // 2. LE SUPERVISEUR + AUDITEUR DE QUALITÉ
            if (isProjectMode) {
                
                // A. Tracking des fichiers
                const newPromises = extractManifestRequirements(currentStepOutput);
                newPromises.forEach(p => expectedFiles.add(p));

                const newCreations = extractCreatedFiles(currentStepOutput);
                newCreations.forEach(c => createdFiles.add(c));

                // B. Analyse des écarts (Fichiers manquants)
                const missingFiles = Array.from(expectedFiles).filter(f => !createdFiles.has(f));
                
                // C. ANALYSE DE LA QUALITÉ DU CODE (Le "Functionality Check")
                // On scanne uniquement ce qui vient d'être produit pour voir si c'est "creux"
                const qualityIssues = validateCodeQuality(currentStepOutput);

                const aiSaysFinished = currentStepOutput.includes("[[PROJECT_FINISHED]]");

                // --- LOGIQUE DE DÉCISION DU SUPERVISEUR ---
                
                if (qualityIssues.length > 0) {
                    // CAS 1 : Le code est là, mais il est mauvais (Mockup/Paresseux)
                    finished = false;
                    const qualityPrompt = `
                    [ALERTE QUALITÉ - REFUS DE VALIDATION]
                    Ton code a été rejeté car il manque de fonctionnalités réelles. Corrige immédiatement les fichiers suivants :
                    
                    ${qualityIssues.map(issue => `❌ ${issue}`).join("\n")}
                    
                    RAPPEL : Je ne veux pas de mockups. Je veux du code fonctionnel (States, Handlers, Validations).
                    Réécris les fichiers concernés MAINTENANT avec la logique complète.
                    `;
                    currentHistory.push({ role: "user", parts: [{ text: qualityPrompt }] });
                    // send(`\n\n⚠️ [Qualité] ${qualityIssues.length} problèmes de logique détectés. L'IA corrige...\n`);

                } else if (missingFiles.length > 0) {
                    // CAS 2 : Il manque des fichiers
                    finished = false;
                    const missingPrompt = `
                    [SYSTÈME] Tu as oublié des fichiers promis dans le manifeste.
                    Fichiers manquants : ${missingFiles.join(", ")}
                    
                    Génère-les maintenant. N'oublie pas : CODE COMPLET ET FONCTIONNEL (pas de coquilles vides).
                    `;
                    currentHistory.push({ role: "user", parts: [{ text: missingPrompt }] });

                } else if (aiSaysFinished && missingFiles.length === 0 && qualityIssues.length === 0) {
                    // CAS 3 : Tout est parfait
                    finished = true;
                } else {
                    // CAS 4 : En cours...
                    if (!currentStepOutput.trim().endsWith("</create_file>") && !aiSaysFinished) {
                         const continuePrompt = `[SYSTÈME] Continue l'implémentation. Assure-toi que chaque composant est interactif.`;
                         currentHistory.push({ role: "user", parts: [{ text: continuePrompt }] });
                    }
                }
            }
          }

          // --- DEPENDENCIES ---
          const hasCode = fullSessionOutput.includes("<create_file");
          
          if (isProjectMode && hasCode) {
            const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
            
            if (allDetectedDeps.length > 0) {
                send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances complètes... ---\n");

                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.561.0",
                    "clsx": "^2.1.0",
                    "tailwind-merge": "^2.2.1"
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
