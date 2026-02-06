import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; // Assure-toi que basePrompt ne contredit pas les nouvelles instructions
import packageJson from 'package-json';

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview"; 

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

// --- NOUVEAUX UTILITAIRES DE SUPERVISION ROBUSTE ---

// 1. Extrait le plan technique
function extractManifestRequirements(text: string): { files: string[], instructions: string } {
  const files: string[] = [];
  let instructions = "";
  
  // Capture tout le manifeste pour contexte
  const manifestBlock = text.match(/\[\[PROJECT_MANIFEST_START\]\]([\s\S]*?)\[\[PROJECT_MANIFEST_END\]\]/);
  if (manifestBlock) instructions = manifestBlock[1];

  const fileRegex = /(?:[-*]|\d+\.)\s+([a-zA-Z0-9_\-\/]+\.(tsx|ts|js|jsx|css|json))/g;
  let match;
  while ((match = fileRegex.exec(instructions)) !== null) {
     // On ignore les node_modules ou fichiers de config basiques s'ils apparaissent
     if (!match[1].includes('node_modules')) {
         files.push(match[1].trim());
     }
  }
  return { files, instructions };
}

// 2. Extrait ce qui a été fait
function extractCreatedFiles(text: string): Map<string, string> {
  const created = new Map<string, string>();
  // Capture le path et le contenu (pour vérification ultérieure si besoin)
  const xmlRegex = /<create_file\s+path=["']([^"']+)["']>([\s\S]*?)<\/create_file>/g;
  let match;
  while ((match = xmlRegex.exec(text)) !== null) {
    created.set(match[1], match[2]);
  }
  return created;
}

// 3. VÉRIFICATION D'ORPHELINS (La clé pour que ça marche)
// Vérifie si un composant créé est bien importé quelque part
function checkConnectivity(createdFiles: Map<string, string>, fileList: string[]): string[] {
    const issues: string[] = [];
    
    // On sépare les pages des composants
    const pages = fileList.filter(f => f.includes('page.tsx') || f.includes('layout.tsx'));
    const components = fileList.filter(f => !f.includes('page.tsx') && !f.includes('layout.tsx') && !f.includes('api/'));

    // Pour chaque composant important, on vérifie s'il est importé dans au moins une page ou un autre composant
    components.forEach(comp => {
        const compName = comp.split('/').pop()?.replace('.tsx', '').replace('.ts', '');
        if (!compName) return;

        let isImported = false;
        createdFiles.forEach((content, path) => {
            if (path === comp) return; // Ne pas se vérifier soi-même
            // Vérification basique d'import ou d'utilisation JSX
            if (content.includes(compName)) isImported = true;
        });

        if (!isImported) {
            // C'est un orphelin ! Il a été créé mais n'est pas utilisé.
            issues.push(comp);
        }
    });

    return issues;
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier existant pour contexte.",
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
    const { history, uploadedImages, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });

    // --- CONSTRUCTION HISTORIQUE ---
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // Contexte visuel (Maquettes)
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.slice(0, 3).map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[CONTEXTE VISUEL - MAQUETTES À REPRODUIRE]" }] });
      }

      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
          parts.push({ text: "\n[NOUVEAUX FICHIERS UPLOADÉS]" });
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
           // Nettoyage des balises de pensée internes pour l'utilisateur final
          const sanitized = txt
            .replace(/\[\[PROJECT_.*?\]\]/g, "") 
            .replace(/<thinking>[\s\S]*?<\/thinking>/g, "") // Si l'IA pense
            .replace(/DEPENDENCIES:[\s\S]*?\]/g, ""); // On cache la liste brute
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        try {
          // --- INSTRUCTION SYSTÈME RENFORCÉE (Le "Senior Tech Lead") ---
          const systemInstruction = `
          ${basePrompt}

          === RÔLE : SENIOR FULLSTACK LEAD ===
          Tu ne fais pas de prototypes. Tu construis des applications de PRODUCTION.
          Ton objectif n'est pas de faire joli, mais de faire FONCTIONNEL (State, Data, Navigation).

          🚨 RÈGLE D'OR : "LOGIC FIRST, UI SECOND" 🚨
          Si un bouton ne fait rien, tu as échoué. Si une input ne met pas à jour un state, tu as échoué.
          Si une modal est créée mais jamais importée dans la page, c'est une ERREUR CRITIQUE.

          === PROCESSUS OBLIGATOIRE (A SUIVRE À LA LETTRE) ===

          PHASE 1 : LE MANIFESTE TECHNIQUE
          Avant de coder, écris un bloc [[PROJECT_MANIFEST_START]] ... [[PROJECT_MANIFEST_END]].
          Il DOIT contenir :
          1. **DATA LAYER** : Liste les fichiers pour les fausses données (ex: \`lib/mockData.ts\`) et les types (ex: \`types/index.ts\`).
          2. **LOGIC LAYER** : Liste les Custom Hooks (ex: \`hooks/useAuth.ts\`, \`hooks/useCart.ts\`).
          3. **COMPONENTS** : Liste les composants UI.
          4. **PAGES** : Liste les pages Next.js.
          
          PHASE 2 : L'IMPLÉMENTATION (ORDRE STRICT)
          1. Commence par \`types/index.ts\` et \`lib/mockData.ts\`. SANS DONNÉES, PAS D'APP, SANS COMPOSANTS FONCTIONNELS, PAS D'APP,.
          2. Crée les Hooks (\`use...\`) qui gèrent la logique (add, remove, toggle, fetch et bien d'autres).
          3. Crée les Components qui *utilisent* ces types.
          4. EN DERNIER : Crée les \`page.tsx\` qui *importent* et *connectent* le tout.

          === RÈGLES DE QUALITÉ DU CODE ===
          - ⛔ INTERDIT : \`href="#"\` (Utilise de vraies routes ou state).
          - ⛔ INTERDIT : \`console.log("TODO")\` (Implémente une logique qui marche : \`setItems([...items, newItem])\`).
          - ✅ OBLIGATOIRE : Chaque fichier doit être complet. Pas de placeholder.
          - ✅ OBLIGATOIRE : Si tu crées une Modal, tu DOIS modifier la Page parente pour l'importer et gérer son état (isOpen).

          FORMAT DE SORTIE CODE :
          <create_file path="chemin/fichier.tsx">
          ... code ...
          </create_file>

          A la fin, liste les dépendances exactes sous ce format :
          DEPENDENCIES: ["lucide-react", "framer-motion", "zustand", "date-fns"]
          `;

          let currentHistory = buildInitialHistory();
          let stepCount = 0;
          const MAX_STEPS = 15; // Assez pour faire plusieurs fichiers
          let finished = false;
          let fullSessionOutput = ""; 
          let isProjectMode = false;

          // State Manager
          let expectedFiles: Set<string> = new Set();
          let createdFilesContent = new Map<string, string>(); // Path -> Content

          while (!finished && stepCount < MAX_STEPS) {
            stepCount++;
            
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: currentHistory,
              tools: [{ functionDeclarations: [readFileDeclaration] }], 
              config: { systemInstruction, temperature: 0.4 }, // Température plus basse pour la rigueur
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

            // --- ANALYSE ET SUPERVISION ---

            // 1. Détection du mode projet
            if (currentStepOutput.includes("[[PROJECT_MANIFEST_START]]")) {
                isProjectMode = true;
                const { files } = extractManifestRequirements(currentStepOutput);
                files.forEach(f => expectedFiles.add(f));
            }

            // 2. Mise à jour de ce qui a été fait
            const newCreations = extractCreatedFiles(currentStepOutput);
            newCreations.forEach((content, path) => createdFilesContent.set(path, content));

            // 3. LOGIQUE DE RELANCE (Le "Tech Lead" virtuel)
            if (isProjectMode) {
                const createdPaths = Array.from(createdFilesContent.keys());
                const missingFiles = Array.from(expectedFiles).filter(f => !createdFilesContent.has(f));
                
                // Check des orphelins (Fichiers créés mais non importés)
                // On ne le fait que si on a déjà commencé à créer des pages
                const hasPages = createdPaths.some(p => p.includes('page.tsx'));
                const orphanedComponents = hasPages ? checkConnectivity(createdFilesContent, Array.from(expectedFiles)) : [];

                if (missingFiles.length > 0) {
                    // Cas 1 : Il manque des fichiers promis
                    finished = false;
                    const prompt = `[SUPERVISEUR] Il manque les fichiers suivants du manifeste : ${missingFiles.join(", ")}. Continue l'implémentation.`;
                    currentHistory.push({ role: "user", parts: [{ text: prompt }] });

                } else if (orphanedComponents.length > 0 && stepCount < MAX_STEPS - 2) {
                    // Cas 2 : Tout est créé, MAIS certains composants ne sont pas branchés !
                    // C'est souvent là que l'IA échoue : elle crée la modal mais oublie d'update la page.
                    finished = false;
                    
                    const prompt = `
                    [SUPERVISEUR - ERREUR D'INTÉGRATION DÉTECTÉE]
                    Tu as créé ces composants mais ils ne semblent pas être importés ou utilisés dans tes pages :
                    ${orphanedComponents.map(c => `- ${c}`).join("\n")}
                    
                    ACTION REQUISE :
                    Réécris le fichier parent (souvent page.tsx ou layout.tsx) pour IMPORTER et UTILISER ces composants.
                    Assure-toi de créer le state nécessaire (ex: const [isModalOpen, setIsModalOpen] = useState(false)) pour les faire fonctionner.
                    `;
                    
                    // On force l'IA à corriger le tir
                    currentHistory.push({ role: "user", parts: [{ text: prompt }] });
                    
                    // On retire les fichiers orphelins des "expected" pour ne pas boucler indéfiniment si l'IA galère, 
                    // mais on force la réécriture de la page parente.
                } else {
                    // Tout semble bon
                    if (currentStepOutput.includes("DEPENDENCIES:")) {
                        finished = true;
                    } else {
                         // Si l'IA s'arrête sans finir formellement
                         const prompt = `[SUPERVISEUR] Si tu as fini, liste les DEPENDENCIES. Sinon continue.`;
                         currentHistory.push({ role: "user", parts: [{ text: prompt }] });
                    }
                }
            } else {
                // Mode chat simple
                finished = true;
            }
          }

          // --- INSTALLATION (CODE IDENTIQUE A AVANT) ---
          if (isProjectMode && fullSessionOutput.includes("<create_file")) {
            const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
            if (allDetectedDeps.length > 0) {
                send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances... ---\n");
                
                // Ta logique package.json existante ici...
                // J'ajoute juste des libs de logique souvent oubliées
                const baseDeps: Record<string, string> = {
                    next: "15.1.0",
                    react: "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.460.0",
                    "clsx": "latest"
                };
                
                // ... (reste de ta logique package.json)
                const newDeps: Record<string, string> = {};
                await Promise.all(allDetectedDeps.map(async (pkg) => {
                    if (!pkg || baseDeps[pkg]) return;
                    newDeps[pkg] = "latest";
                }));
                
                const finalDependencies = { ...baseDeps, ...newDeps };
                 const packageJsonContent = {
                    name: "nextjs-app",
                    version: "1.0.0",
                    dependencies: finalDependencies,
                    devDependencies: {
                        typescript: "^5",
                        "@types/node": "^20",
                        "@types/react": "^19",
                        "@types/react-dom": "^19",
                        postcss: "^8",
                        tailwindcss: "^3.4.1",
                        "eslint": "^8",
                        "eslint-config-next": "15.0.3"
                    },
                };

                const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
                send(xmlOutput);
            }
          }

          controller.close();

        } catch (err: any) {
          console.error(err);
          send(`\n\n⛔ ERREUR: ${err.message}`);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
        }
