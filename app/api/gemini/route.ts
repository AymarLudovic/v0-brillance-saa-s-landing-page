import { NextResponse } from "next/server"
import { GoogleGenAI, Part, Type, Tool } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// ============================================================================
// 1. CONFIGURATION & CONSTANTES
// ============================================================================
const FULL_PROMPT_INJECTION = `${basePrompt}`; 
const BATCH_SIZE = 128; // Buffer réduit pour un effet "streaming" plus fluide
const MODEL_NAME = "gemini-3-flash-preview"; // Modèle rapide pour le reasoning

// ============================================================================
// 2. DÉFINITION DES RÔLES & SYSTÈMES (Placé EN HAUT pour la clarté)
// ============================================================================
const AGENT_SYSTEMS = {
  MANAGER: `${FULL_PROMPT_INJECTION}
  MISSION: Tu es le ROUTEUR INTELLIGENT. Analyse la demande.
  OUTPUT: Réponds uniquement "ACTION_GENERATE" (création) ou "ACTION_FIX" (modification).`,

  FIXER: `${FULL_PROMPT_INJECTION}
  MISSION: Tu es l'AGENT DE MAINTENANCE RAPIDE.
  CONTEXTE: L'utilisateur veut une correction précise.
  ACTION: Analyse le code fourni et ne renvoie QUE les fichiers corrigés.`
};

// Texte descriptif de l'équipe pour donner une conscience collective aux agents
const TEAM_ROSTER = `
VOICI L'ÉQUIPE DE DÉVELOPPEMENT (TU ES L'UN D'EUX) :
1. [ARCHITECTE] : Cerveau du projet. Défini la structure, les fichiers et les dépendances.
2. [BACKEND_ALPHA] : Maçon. Crée les routes API de base.
3. [BACKEND_OMEGA] : Ingénieur Sécurité. Ajoute la logique complexe, sécu et types.
4. [UI_ALPHA] : Charpentier. Crée les composants visuels et pages.
5. [UI_OMEGA] : Décorateur & Electricien. Connecte tout (fetch), gère les états, et polit le design.
6. [REPORTER] : Chef de projet. Valide et présente le résultat final

À TOUT AGENT ICI NOMMÉ QUI VEUT CRÉER UN FICHIER QUELCONQUE VOICI LE FORMAT XML QUE VOUS UTILISERER SURTOUT SANS MARKDOWN À L'EXTÉRIEUR COMME À L'INTÉRIEUR DU XML:

<create_file path="app/page.tsx(exemple de chemin du fichier)">code_fichier</create_file>

* Éviter les markdown et ne commencer pas les directory des fichiers par "src/"

${FULL_PROMPT_INJECTION}
`;

// ============================================================================
// 3. TYPES & INTERFACES
// ============================================================================
interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
}

interface ProjectFile {
    path: string;
    content: string;
    createdBy: string;
}

// ============================================================================
// 4. UTILITAIRES
// ============================================================================
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

// Générateur de Prompt Dynamique : C'est ici que la magie de la coordination opère
const getSystemPrompt = (role: string, objective: string, contextRules: string) => {
    return `
${FULL_PROMPT_INJECTION}

--- CONTEXTE D'ÉQUIPE (TEAM ROSTER) ---
${TEAM_ROSTER}

--- TON IDENTITÉ ACTUELLE : [${role}] ---
OBJECTIF PRINCIPAL : ${objective}

--- RÈGLES DE COLLABORATION STRICTES ---
1. ANALYSE LE "PROJECT STATE" : Tu dois construire par-dessus le code de tes collègues.
2. COHÉRENCE : Si l'Architecte a prévu "auth/route.ts", tu NE CRÉES PAS "login/route.ts". Suis le plan.
3. ${contextRules}
`;
};

// ============================================================================
// 5. LOGIQUE PRINCIPALE (API ROUTE)
// ============================================================================
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;
    const ai = new GoogleGenAI({ apiKey });

    // --- MÉMOIRE D'ÉTAT PARTAGÉE (Le Cerveau du Projet) ---
    // Cette variable va accumuler tout le code généré par la chaîne d'agents
    let currentProjectFiles: ProjectFile[] = []; 

    // Construction du contexte pour Gemini
    const buildContents = (additionalContext: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        
        // 1. Injection du Vibe Board (Style)
        if (allReferenceImages?.length > 0) {
            const styleParts = allReferenceImages.map((img: string) => ({ 
                inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } 
            }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "[REFERENCE VISUELLE PRIORITAIRE]" }] });
            contents.push({ role: 'model', parts: [{ text: "Bien reçu. Je copierai ce style visuel." }] });
        }

        // 2. Historique de conversation
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            if (i === history.length - 1 && msg.role === 'user' && uploadedImages) {
                uploadedImages.forEach((img: string) => parts.push({ 
                    inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } 
                }));
            }
            parts.push({ text: msg.content || ' ' });
            contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
        });

        // 3. INJECTION DU CODE EXISTANT (Le relai entre agents)
        if (currentProjectFiles.length > 0) {
            let filesContext = "\n\n--- 📂 ÉTAT ACTUEL DU PROJET (Code généré par l'équipe) ---\n";
            filesContext += "Tu dois utiliser ces fichiers comme base. Ne les réécris pas sauf si nécessaire, mais importe-les.\n";
            currentProjectFiles.forEach(f => {
                // On injecte le chemin et un extrait significatif (ou tout le contenu si possible)
                filesContext += `\n> FICHIER: ${f.path} (Auteur: ${f.createdBy})\n\`\`\`typescript\n${f.content}\n\`\`\`\n`; 
            });
            additionalContext += filesContext;
        }

        if (additionalContext) {
            contents.push({ role: 'user', parts: [{ text: additionalContext }] });
        }

        return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let batchBuffer = "";

        // --- ORCHESTRATEUR D'AGENT ---
        const runAgent = async (
            roleName: string, 
            objective: string, 
            specificRules: string, 
            isSilentBuilder: boolean = true
        ) => {
            // Création du prompt système unique pour cet agent
            const systemInstruction = getSystemPrompt(roleName, objective, specificRules);
            
            // Directive de fin pour forcer le format
            const outputDirectives = isSilentBuilder 
                ? "ATTENTION: Tu es en mode BUILDER. Ne dis PAS 'Voici le code'. Affiche DIRECTEMENT les blocs de code. Format attendu: `// FILE: path/to/file.ts` suivi du code." 
                : "Tu es en mode REPORTER. Parle naturellement à l'utilisateur pour lui expliquer ce qui a été fait.";

            const res = await ai.models.generateContentStream({
                model: MODEL_NAME,
                contents: buildContents(outputDirectives),
                config: { systemInstruction },
                generationConfig: { 
                    temperature: 1.0, 
                    maxOutputTokens: 8192 
                }
            });

            let fullAgentOutput = "";
            
            if (!isSilentBuilder) {
                // Le Reporter parle directement au client
                for await (const chunk of res) {
                    if (chunk.text) { send(chunk.text); fullAgentOutput += chunk.text; }
                }
            } else {
                // Les Builders travaillent en silence (on affiche juste un indicateur visuel)
                send(`\n> [${roleName}] est en train de coder...\n`);
                
                for await (const chunk of res) {
                    if (chunk.text) {
                        fullAgentOutput += chunk.text;
                        batchBuffer += chunk.text;
                        // On envoie par paquets pour éviter de saturer le réseau
                        if (batchBuffer.length >= BATCH_SIZE) { send(batchBuffer); batchBuffer = ""; }
                    }
                }
                if (batchBuffer.length > 0) { send(batchBuffer); batchBuffer = ""; }
            }

            // --- SAUVEGARDE DE L'ÉTAT ---
            // On ajoute la production de cet agent à la "mémoire commune" pour le suivant
            // (Note: Dans une version prod, on parserait mieux le code pour séparer les fichiers proprement)
            currentProjectFiles.push({ 
                path: `Output_Session_${roleName}`, // Idéalement, parser le nom du fichier réel
                content: fullAgentOutput, 
                createdBy: roleName 
            });

            return fullAgentOutput;
        };

        try {
            // ÉTAPE 0 : DÉCISION MANAGER
            let decision = "";
            const mStream = await ai.models.generateContentStream({
                model: MODEL_NAME,
                contents: buildContents("Analyse la demande : Création complète ou petite correction ? Réponds ACTION_GENERATE ou ACTION_FIX."),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of mStream) { if (chunk.text) decision += chunk.text; }

            if (decision.includes("ACTION_FIX")) {
                // --- MODE CORRECTION (Rapide) ---
                send("### 🛠️ Mode Maintenance Activé\n");
                await runAgent("FIXER", "Corrige le bug ou applique la modification demandée.", AGENT_SYSTEMS.FIXER, false);
            
            } else {
                // --- MODE GÉNÉRATION V0 (Pipeline Complet) ---
                
                // 1. ARCHITECTE
                send("### 🏗️ Phase 1 : Architecture & Design\n");
                const plan = await runAgent("ARCHITECTE", 
                    "Analyse le Vibe Board et dresse le blueprint structurel.", 
                    "Sortie : Liste Markdown des fichiers à créer. Ne code pas encore.", false);

                // 2. BACKEND SWARM
                send("\n---\n### ⚙️ Phase 2 : Développement Backend\n");
                await runAgent("BACKEND_ALPHA", 
                    `Implémente les routes API de base selon ce plan : ${plan}`, 
                    "Concentre-toi sur les CRUD simples. Code pur.", true);
                
                await runAgent("BACKEND_OMEGA", 
                    "Finalise le Backend (Sécurité, Types, Gestion d'erreurs).", 
                    "Reprends le code de Alpha et rends-le robuste pour la prod.", true);

                // 3. UI SWARM
                send("\n---\n### 🎨 Phase 3 : Interface & Intégration\n");
                await runAgent("UI_ALPHA", 
                    "Crée la structure UI (Pages, Layout, Sidebar).", 
                    "Connecte les composants mais laisse la logique complexe pour après.", true);

                await runAgent("UI_OMEGA", 
                    "Sublime l'UI (Pixel-Perfect Vibe Board) et rends tout interactif.", 
                    "Chaque bouton doit fonctionner. Vérifie les imports. C'est la version finale.", true);

                // 4. REPORTER FINAL
                send("\n---\n### ✅ Finalisation\n");
                await runAgent("REPORTER", 
                    "Fais le bilan.", 
                    "Annonce à l'utilisateur que son app est prête. Donne des instructions de démarrage.", false);
            }

            controller.close();
        } catch (e: any) {
            send(`\n\n[SYSTEM FAILURE]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
    }
