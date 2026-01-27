import { NextResponse } from "next/server";
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai";
import { basePrompt } from "@/lib/prompt"; 

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview"; // Je recommande le 2.0 Flash si dispo, sinon 1.5 Flash

// ... (Gardons tes interfaces et helpers inchangés) ...

// --- DEFINITION DES AGENTS (C'est ici que tout se joue) ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `Tu es l'Architecte Technique Principal. 
    
    TA MISSION UNIQUE : Analyser la demande et définir un PLAN D'ACTION technique étape par étape.
    
    ⛔ INTERDICTION FORMELLE DE GÉNÉRER DU CODE (HTML, CSS, JS, REACT, ETC).
    ⛔ TU NE DOIS PAS RÉPONDRE À LA PLACE DES DÉVELOPPEURS.
    
    Si l'utilisateur demande de générer une page ou une fonctionnalité, tu DOIS déléguer.
    
    FORMAT DE RÉPONSE OBLIGATOIRE (Respecte scrupuleusement) :
    
    1. Commence TOUJOURS ta réponse par une seule ligne contenant la classification :
       "CLASSIFICATION: CHAT_ONLY" -> Pour une simple discussion.
       "CLASSIFICATION: FIX_ACTION" -> Pour une correction de bug mineur sur un fichier existant.
       "CLASSIFICATION: CODE_ACTION" -> Pour toute création de page, fonctionnalité ou modification complexe.
    
    2. Ensuite, saute une ligne et donne le PLAN TECHNIQUE pour les développeurs (Quels composants créer ? Quelle structure de données ?).
    
    Exemple de réponse attendue :
    CLASSIFICATION: CODE_ACTION
    
    Plan technique :
    1. Backend : Créer une route API pour...
    2. Frontend : Créer le composant Hero...`,
  },
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `Expert Correcteur. Tu interviens UNIQUEMENT si l'Architecte a classé en FIX_ACTION. Ton but est de corriger le fichier existant.`,
  },
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `Expert Backend (Next.js API).
    Ton rôle : Lire le plan de l'Architecte et implémenter la partie SERVEUR/API uniquement.
    Si le plan ne nécessite pas de backend (juste du visuel), réponds EXACTEMENT : "NO_BACKEND_CHANGES".
    Sinon, fournis le code complet des routes API.`,
  },
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `Expert Frontend (React/Tailwind/Shadcn).
    Ton rôle : Implémenter l'interface utilisateur basée sur le plan de l'Architecte et, si disponible, intégrer les API créées par le Backend.
    Utilise Lucide-React pour les icônes. Sois créatif et précis.`,
  },
};

export async function POST(req: Request) {
  try {
    // ... (Récupération API KEY et Body inchangés) ...
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });
    const encoder = new TextEncoder();

    // ... (buildBaseContents inchangé) ...
    const buildBaseContents = (extraContext: string = "") => {
        // (Garde ta logique existante ici)
        const contents: { role: "user" | "model"; parts: Part[] }[] = [];
        if (allReferenceImages?.length > 0) {
          const styleParts = allReferenceImages.map((img: string) => ({
            inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
          }));
          contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
        }
        if (extraContext) {
          contents.push({ role: "user", parts: [{ text: `[SYSTEM CONTEXT]:\n${extraContext}` }] });
        }
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
          // On nettoie les tags internes pour l'utilisateur, mais on garde le reste
          const sanitized = txt
            .replace(/CLASSIFICATION: (CHAT_ONLY|CODE_ACTION|FIX_ACTION)/g, "") // Regex plus stricte
            .replace("NO_BACKEND_CHANGES", "");
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };
        
        let globalContextAccumulator = ""; 

        async function runAgent(agentKey: keyof typeof AGENTS, contextOverride: string = "") {
          const agent = AGENTS[agentKey];
          // Petit séparateur visuel pour le debug ou l'UI
          send(`\n\n--- ${agent.icon} [${agent.name}] ---\n\n`);
          
          let fullAgentOutput = "";
          let batchBuffer = "";

          try {
            const contents = buildBaseContents(globalContextAccumulator + "\n" + contextOverride);
            const systemInstruction = `${basePrompt}\n\nRÔLE ACTUEL: ${agent.name}\n${agent.prompt}`;

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction },
              // On baisse la température pour l'Architecte pour qu'il respecte le format
              generationConfig: { temperature: agentKey === 'ARCHITECT' ? 0.4 : 0.7, maxOutputTokens: 8192 }, 
            });

            for await (const chunk of response) {
              if (chunk.text) {
                const txt = chunk.text;
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
            console.error(e);
            return "";
          }
        }

        try {
          // 1. L'ARCHITECTE PLANIFIE (avec interdiction de coder)
          const architectOutput = await runAgent("ARCHITECT");
          globalContextAccumulator += `\n[PLAN_ARCHITECTE]: ${architectOutput}\n`;

          // 2. EXTRACTION ROBUSTE DE LA DÉCISION
          // On cherche la ligne exacte, peu importe la casse ou les espaces autour
          const decisionMatch = architectOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/i);
          const decision = decisionMatch ? decisionMatch[1].toUpperCase() : "CHAT_ONLY"; // Fallback safe

          console.log("DECISION PRISE:", decision);

          if (decision === "CHAT_ONLY") {
            // On s'arrête là
          } 
          else if (decision === "FIX_ACTION") {
            // Mode "Fixer" simple
            await runAgent("FIXER", "L'Architecte a identifié un correctif. Applique-le sur le code existant.");
          } 
          else if (decision === "CODE_ACTION") {
            // Mode "Génération complète"
            // On force le BACKEND même si l'architecte a trop parlé
            const backendOutput = await runAgent("BACKEND", "Instructions: Analyse le plan de l'Architecte. Si des routes API sont nécessaires, code-les. Sinon réponds NO_BACKEND_CHANGES.");
            globalContextAccumulator += `\n[BACKEND_OUTPUT]: ${backendOutput}\n`;

            const noBackend = backendOutput.includes("NO_BACKEND_CHANGES");
            
            // On force le FRONTEND ensuite
            await runAgent("FRONTEND", noBackend 
              ? "Instructions: Le backend n'a pas changé. Concentre-toi sur le code UI (React/Tailwind) selon le plan de l'Architecte." 
              : "Instructions: Intègre les routes API fournies par le Backend ci-dessus et crée l'UI React complète."
            );
          }

          controller.close();
        } catch (err) {
            console.error(err);
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
