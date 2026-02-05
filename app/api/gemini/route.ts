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

// --- NOUVEAUX UTILITAIRES DE SUPERVISION ---

// 1. Extrait les fichiers promis dans les blocs [[PROJECT_...]]
function extractManifestRequirements(text: string): string[] {
  const requirements: string[] = [];
  // Capture le contenu des blocs PROJECT_PAGES ou PROJECT_MODALS
  const manifestRegex = /\[\[PROJECT_(?:PAGES|MODALS)\]\]([\s\S]*?)(?=\[\[|$)/g;
  let match;
  
  while ((match = manifestRegex.exec(text)) !== null) {
    const content = match[1];
    // Cherche des lignes type "- src/components/Header.tsx" ou "1. app/page.tsx"
    // Regex flexible pour capturer les chemins avec extensions communes
    const fileLines = content.match(/(?:[-*]|\d+\.)\s+([a-zA-Z0-9_\-\/]+\.(tsx|ts|js|jsx|css|json))/g);
    
    if (fileLines) {
      fileLines.forEach(line => {
        // Nettoyage pour garder juste le chemin
        const cleanPath = line.replace(/(?:[-*]|\d+\.)\s+/, "").trim();
        requirements.push(cleanPath);
      });
    }
  }
  return requirements;
}

// 2. Extrait les fichiers réellement créés via XML
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
             - Format ligne: - app/nom_page/page.tsx
             - Liste ses fonctionnalités clés.

          2. [[PROJECT_MODALS]]
             - Liste TOUS les fichiers Components, Modals, Utils, et Hooks nécessaires.
             - Format ligne: - components/NomComponent.tsx
             - ⛔ INTERDICTION d'importer un fichier si tu ne le listes pas ici pour création.

          3. [[PROJECT_MODALS_ROLES]]
             - Pour chaque composant listé, décris sa LOGIQUE (pas juste le UI).
             - Ex: "AuthModal: Doit gérer le submit, l'erreur API, le loading state, et la redirection".

          === RÈGLES D'EXÉCUTION STRICTES ===
          - Le système surveille tes fichiers.
          - TANT QUE tu n'as pas généré de balise <create_file> pour CHAQUE fichier listé dans le manifeste, tu ne peux pas finir.
          - QUAND TU AS TOUT FINI (et vérifié que tout est vert), écris : [[PROJECT_FINISHED]]

          FORMAT DE FICHIER :
          <create_file path="...">
          ... code brut ...
          </create_file>
          `;

          let currentHistory = buildInitialHistory();
          
          let stepCount = 0;
          const MAX_STEPS = 25; // Augmenté pour la robustesse
          let finished = false;
          let fullSessionOutput = ""; 
          let isProjectMode = false;

          // --- STATE MANAGER (SUIVI DE PROJET) ---
          let expectedFiles: Set<string> = new Set();
          let createdFiles: Set<string> = new Set();

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

            currentHistory.push({ role: "model", parts: [{ text: currentStepOutput }] });

            // 1. Détection initiale
            if (stepCount === 1) {
                if (currentStepOutput.includes("[[PROJECT_START]]")) {
                    isProjectMode = true;
                } else {
                    finished = true;
                }
            }

            // 2. Logique de relance ROBUSTE (Le "Superviseur Automatique")
            if (isProjectMode) {
                
                // A. Mise à jour de l'état (Promesses vs Réalité)
                const newPromises = extractManifestRequirements(currentStepOutput);
                newPromises.forEach(p => expectedFiles.add(p));

                const newCreations = extractCreatedFiles(currentStepOutput);
                newCreations.forEach(c => createdFiles.add(c));

                // B. Calcul du différentiel (Le "Gap")
                // On regarde quels fichiers attendus ne sont PAS dans les fichiers créés
                const missingFiles = Array.from(expectedFiles).filter(f => !createdFiles.has(f));
                
                const aiSaysFinished = currentStepOutput.includes("[[PROJECT_FINISHED]]");

                if (missingFiles.length > 0) {
                    // CAS CRITIQUE : Il manque des fichiers. 
                    // On IGNORE le fait que l'IA dise "Finished". On force la boucle.
                    finished = false;

                    const supervisorPrompt = `
                    [SYSTÈME DE VÉRIFICATION AUTOMATIQUE]
                    ⛔ INTERDICTION DE FINIR.
                    
                    Tu as listé ces fichiers dans ton plan, mais tu ne les as pas encore générés (balises XML manquantes) :
                    ${missingFiles.map(f => `- ${f}`).join("\n")}
                    
                    ACTION REQUISE :
                    1. Génère le code complet pour ces fichiers manquants maintenant.
                    2. IMPORTANT : Pour chaque fichier, réfère-toi à [[PROJECT_MODALS_ROLES]] pour implémenter TOUTE la logique (pas de coquilles vides).
                    `;

                    // Petit feedback visuel pour l'utilisateur (optionnel, via send)
                    // send(`\n\n🛠️ [Système] ${missingFiles.length} fichiers restants détectés, continuation du travail...\n`);

                    currentHistory.push({ role: "user", parts: [{ text: supervisorPrompt }] });

                } else if (aiSaysFinished && missingFiles.length === 0) {
                    // Tout est bon : Liste vide et IA satisfaite
                    finished = true;
                } else {
                    // L'IA n'a pas fini et il reste peut-être des choses, ou elle attend des instructions
                    // Si elle n'a pas dit finished, on la laisse continuer ou on la relance si elle s'arrête sans code
                    if (!currentStepOutput.trim().endsWith("</create_file>") && !aiSaysFinished) {
                         const continuePrompt = `[SYSTÈME] Continue ton implémentation selon le manifeste. Ne t'arrête pas.`;
                         currentHistory.push({ role: "user", parts: [{ text: continuePrompt }] });
                    }
                    // Sinon, la boucle while continuera naturellement car finished est false
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
  
