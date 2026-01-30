import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; 

const BATCH_SIZE = 128;
// Modèle spécifié par l'utilisateur
const MODEL_ID = "gemini-3-flash-preview"; 

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// --- DEFINITION DES AGENTS (EXISTANTS + NOUVEAUX) ---
const AGENTS = {
  // 1. ARCHITECTE (TON ORIGINAL)
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es le CHEF DE PROJET TECHNIQUE (Architecte).
    
    TA MISSION UNIQUE : Analyser la demande et déléguer le travail aux développeurs (Backend et Frontend).
    
    ⛔ INTERDICTIONS FORMELLES (Si tu ne respectes pas, le processus échoue) :
    1. TU NE DOIS PAS ÉCRIRE DE CODE (PAS de HTML, PAS de CSS, PAS de JS, PAS de Python).
    2. Tu ne fais PAS le travail toi-même. Tu donnes des ORDRES.
    3. Tu ne poses pas de questions à l'utilisateur.
    
    FORMAT DE RÉPONSE OBLIGATOIRE :
    Tu dois commencer ta réponse par une ligne de classification, suivie d'un plan textuel.
    
    Choix de classification :
    - "CLASSIFICATION: CHAT_ONLY" -> Pour une discussion générale.
    - "CLASSIFICATION: FIX_ACTION" -> Pour une petite correction sur un fichier existant.
    - "CLASSIFICATION: CODE_ACTION" -> Pour créer une fonctionnalité, une page, ou modifier le code.
    
    Exemple de réponse attendue (Respecte ce format) :
    CLASSIFICATION: CODE_ACTION
    
    Plan d'exécution :
    1. Backend : Créer une route API pour gérer les utilisateurs.
    2. Frontend : Créer une interface avec un tableau et un bouton.`,
  },
  
  // 2. FIXER (TON ORIGINAL AMÉLIORÉ DANS LA LOGIQUE)
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Tu reçois un fichier et une instruction. Renvoie uniquement le code corrigé complet. Pas de markdown inutile, pas d'explications.`,
  },

  // --- CHAÎNE BACKEND ---

  // BACKEND 1 (TON ORIGINAL)
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Next.js / Node).
    Ta tâche : Lire le plan de l'Architecte et implémenter la partie SERVEUR uniquement.
    - Si le plan ne demande que du visuel (HTML/CSS), réponds UNIQUEMENT : "NO_BACKEND_CHANGES".
    - Sinon, fournis le code des API/Server Actions.`,
  },

  // BACKEND 2 (NOUVEAU : REVIEWER & BUILDER)
  BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `Tu es l'Expert Backend Senior chargé de la revue de code et de la complétion.
    TA MISSION : Analyser le code produit par le premier développeur backend et le comparer au plan de l'Architecte.
    
    RÈGLES STRICTES :
    1. Si le premier agent a oublié des fonctionnalités du plan, TU DOIS LES CODER.
    2. Si le code contient des erreurs logiques ou de sécurité, corrige-les.
    3. Si le premier agent a répondu "NO_BACKEND_CHANGES" mais que le plan exigeait du backend, tu dois le faire maintenant.
    4. NE SUPPRIME RIEN de ce qui fonctionne déjà. Tu es là pour CONSTRUIRE et RÉPARER, pas pour réduire.
    5. Renvoie l'intégralité du code Backend final (y compris ce que l'agent précédent a bien fait).`,
  },

  // BACKEND 3 (NOUVEAU : AUDITOR FINAL)
  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `Tu es le Validateur Final Backend.
    TA MISSION : S'assurer que le code backend est prêt pour la production.
    - Vérifie la cohérence totale avec le plan de l'Architecte.
    - Vérifie les imports, les types TypeScript, et la structure des routes API.
    - C'est ta version qui sera transmise au Frontend. Si tout est parfait, renvoie le code tel quel. Sinon, applique les dernières finitions.`,
  },

  // --- CHAÎNE FRONTEND ---

  // FRONTEND 1 (TON ORIGINAL)
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend .
    Ta tâche : Implémenter l'interface utilisateur selon le plan de l'Architecte.
    - Si le Backend a fourni du code, utilise-le.
    - Concentre-toi sur le code JSX/TSX.
    - C'est sur l'utra analyse de l'architecte et le code précédent rédigé par le premier front agent que tu améliore par 100.
    -Ne génère plus aucun plan car l'architecte à déjà fait sortir un plan integral, ton rôle est juste d'implementer tout le UI, page et éléments UI UX lister selon le plan de l'architecte`,
  },

  // FRONTEND 2 (NOUVEAU : UX/UI DESIGNER)
  FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `Tu es l'Expert UX/UI & Motion Design.
    TA MISSION : Sublimer le travail brut du premier développeur Frontend.
      - C'est sur l'utra analyse de l'architecte et le code précédent rédigé par le premier front agent que tu améliore par 100.
    
    TES OBJECTIFS :
    1. Améliorer le design : c'est à toi d'être à chaque fois plus créatif niveau UI, en rajoutant des éléments tellement beau.
    2. Ajouter de la vie : Ajoute des animations natives (CSS transitions, ou Framer Motion si pertinent) pour les interactions (hover, click, loading states).
    3. NE PAS CASSER LA LOGIQUE : Tu dois garder toute la logique fonctionnelle (hooks, states, effects) du code précédent.
    4. Si des pages ou des composants prévus par l'Architecte manquent dans le code précédent, CRÉE-LES.
    5. Ajoute les modals manquants, les états de chargement (skeletons) et les messages d'erreur visuels.`,
  },

  // FRONTEND 3 (NOUVEAU : INTEGRATOR & FINALIZER)
  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `Tu es l'Expert Intégrateur Final (Quality Assurance Code).
    TA MISSION : Livrer la version finale et parfaite du Frontend.
      - C'est sur l'utra analyse de l'architecte et le code précédent rédigé par le premier front agent que tu améliore par 100.
    
    CHECKLIST DE VÉRIFICATION :
    1. Liens fonctionnels : Vérifie que chaque bouton ou lien redirige vers une vraie page ou exécute une action (pas de href="#" morts si une page existe).
    2. Types TypeScript : Corrige toutes les erreurs de typage potentielles (any, interfaces manquantes).
    3. Intégration Backend : Vérifie que les appels API du code Backend sont correctement connectés aux formulaires et boutons.
    4. Exhaustivité : Si l'Architecte a demandé 5 pages et qu'il n'y en a que 3, code les 2 manquantes maintenant.
    5. Renvoie le code UI FINAL, complet et prêt à l'emploi.`,
  },
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();

    const buildBaseContents = (extraContext: string = "") => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // Images de référence (Style)
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
      }
      
      // Contexte Système (Accumulateur de résultats d'agents)
      if (extraContext) {
        contents.push({ role: "user", parts: [{ text: `[CONTEXTE SYSTEME INTERNE - FLUX DE TRAVAIL]:\n${extraContext}` }] });
      }
      
      // Historique
      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => {
          // On nettoie les tags de contrôle pour ne pas polluer l'affichage utilisateur
          const sanitized = txt
            .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
            .replace(/NO_BACKEND_CHANGES/gi, "");
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        let globalContextAccumulator = ""; 

        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            // On injecte le contexte accumulé + l'instruction spécifique de l'étape
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            const systemInstruction = `${basePrompt}\n\n=== RÔLE ACTUEL: ${agent.name} ===\n${agent.prompt}`;

            // Réglage de la température
            // Architecte et Auditeurs finaux = plus stricts (0.3)
            // Créatifs (Designer, Dev V1) = plus ouverts (0.7)
            const temperature = (agentKey === "ARCHITECT" || agentKey.includes("AUDITOR") || agentKey.includes("FINALIZER")) ? 0.7 : 1.2;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction, temperature, maxOutputTokens: 65536 },
            });

            for await (const chunk of response) {
              const txt = chunk.text; 
              if (txt) {
                batchBuffer += txt;
                fullAgentOutput += txt;
                if (batchBuffer.length >= BATCH_SIZE) {
                  send(batchBuffer);
                  batchBuffer = "";
                }
              }
            }
            if (batchBuffer.length > 0) send(batchBuffer);
            return fullAgentOutput;
          } catch (e: any) {
            console.error(`Erreur Agent ${agent.name}:`, e);
            return ""; // En cas d'erreur d'un agent intermédiaire, on continue avec le vide (ou on pourrait throw)
          }
        }

        try {
          // --- ETAPE 1 : ARCHITECTE ---
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[ARCHITECT_PLAN]: ${architectOutput}\n`;

          const match = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = match ? match[1].toUpperCase() : "CHAT_ONLY"; 
          
          if (decision === "CHAT_ONLY") {
            // Fin normale du stream
            controller.close();
            return;
          } 
          
          else if (decision === "FIX_ACTION") {
            // Fixer : On lui donne le contexte de ce qui doit être réparé
            await runAgent("FIXER", "Instruction: Applique le correctif technique sur le fichier concerné en t'assurant de ne pas casser le travail existant.");
            controller.close();
            return;
          } 
          
          else if (decision === "CODE_ACTION") {
            // --- ETAPE 2 : BACKEND CHAIN ---
            
            // 2.1 Backend Dev (Initial)
            const backend1 = await runAgent("BACKEND", "Instruction: Implémente le code serveur basé sur le plan ci-dessus. Si pas de back, réponds NO_BACKEND_CHANGES.");
            
            let currentBackendCode = backend1;
            const noBackendInitially = backend1.includes("NO_BACKEND_CHANGES");
            
            // On continue la chaîne backend même si "NO_BACKEND_CHANGES" pour vérification par le Reviewer
            // car l'Architecte a peut-être demandé du back que le premier agent a raté.
            
            // 2.2 Backend Reviewer
            const backend2 = await runAgent("BACKEND_REVIEWER", 
              `Instruction: Analyse le travail précédent :\n${currentBackendCode}\n\n Vérifie s'il correspond au plan de l'Architecte. Complète les manques, corrige les erreurs. Si le premier agent a dit NO_BACKEND_CHANGES mais que le plan demande du back, CODE-LE.`
            );
            currentBackendCode = backend2; // Le reviewer donne une version plus complète

            // 2.3 Backend Auditor
            const backend3 = await runAgent("BACKEND_AUDITOR", 
              `Instruction: Validation finale backend. Analyse ce code :\n${currentBackendCode}\n\n Est-il parfait et aligné avec le plan ? Nettoie et valide.`
            );
            
            // C'est ce code final qui sera la vérité pour le Frontend
            globalContextAccumulator += `\n[FINAL_BACKEND_CODE]: ${backend3}\n`;
            const finalNoBackend = backend3.includes("NO_BACKEND_CHANGES") && noBackendInitially;


            // --- ETAPE 3 : FRONTEND CHAIN ---
            
            // 3.1 Frontend Dev (Initial)
            // Il reçoit le backend FINAL pour faire son UI
            const frontend1 = await runAgent("FRONTEND", finalNoBackend 
              ? "Instruction: Le backend n'a pas changé. Génère l'UI (React/Tailwind) de base selon le plan." 
              : "Instruction: Intègre le code Backend FINAL fourni juste au-dessus et génère l'UI de base."
            );
            
            // 3.2 Frontend Designer (UX/UI & Animations)
            const frontend2 = await runAgent("FRONTEND_DESIGNER", 
              `Instruction: Prends le code UI ci-dessus :\n${frontend1}\n\n Améliore le design (Tailwind), ajoute des animations, rends-le beau et moderne sans casser la logique.`
            );
            
            // 3.3 Frontend Finalizer (QA & Intégration)
            await runAgent("FRONTEND_FINALIZER", 
              `Instruction: Voici l'UI designée :\n${frontend2}\n\n Vérifie que TOUS les liens, boutons et formulaires fonctionnent. Ajoute les pages manquantes du plan. Finalise le code pour production.`
            );

            // Fin du stream Code Action
            controller.close();
          }

        } catch (err) {
          console.error("Stream error:", err);
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
