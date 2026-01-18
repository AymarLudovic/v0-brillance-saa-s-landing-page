import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// --- DEFINITION STRICTE DES AGENTS (BasePrompt injecté dans CHACUN) ---
const AGENTS = {
  PM: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : PROJECT MANAGER (CHEF D'ORCHESTRE).
    TA TÂCHE : Analyser la demande. 
    - Si c'est une petite modif : Fais-la toi-même immédiatement.
    - Si c'est une création/feature : Définis le plan technique pour les autres agents.
    IMPORTANT : Tu es le premier à parler.
  `,
  
  BACKEND_1: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : BACKEND DEVELOPER (SCAFFOLDING).
    TA TÂCHE : Générer la structure brute du code serveur (API, BD, Types). Ne t'occupe pas de la beauté, juste de la fondation.
  `,

  BACKEND_2: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : SENIOR SECURITY ENGINEER.
    TA TÂCHE : Relire le code du Backend 1. AJOUTER : Validation Zod, Auth, Gestion d'erreurs, Sécurité. 
  `,

  BACKEND_3: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : LEAD ARCHITECT (OPTIMIZATION).
    TA TÂCHE : Finaliser le Backend. AJOUTER : Caching, Logs, Performance. C'est la version finale du serveur.
  `,

  UI_1: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : UI STRUCTURE (SKELETON).
    TA TÂCHE : Créer les composants React basiques connectés au Backend 3. Structure HTML sémantique uniquement.
  `,

  UI_2: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : VIBE DESIGNER (CREATIVE).
    TA TÂCHE : Appliquer le style visuel.
    INSTRUCTION VISUELLE : Utilise les [INSPIRATIONS] fournies. ÉVITE ABSOLUMENT les [ANTI-PATTERNS].
    Ajoute : Tailwind avancé, Gradients, Glassmorphism.
  `,

  UI_3: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : FRONTEND POLISHER (UX).
    TA TÂCHE : Micro-interactions, Animations (Framer Motion), Accessibilité. C'est le code final pour l'utilisateur.
  `,
  
  FINAL_REPORTER: `
    ${basePrompt}
    ---
    TON RÔLE ACTUEL : RAPPORTEUR.
    TA TÂCHE : Résumer ce qui a été fait par l'équipe pour l'utilisateur final. Sois concis et pro.
  `
};

// Prompt Système qui force la séquence
const ORCHESTRATOR_INSTRUCTION = `
TU ES LE MOTEUR D'EXÉCUTION SÉQUENTIELLE MULTI-AGENTS.
Tu vas recevoir un contexte. Tu dois simuler une chaîne de travail SANS T'ARRÊTER.

RÈGLE D'AFFICHAGE OBLIGATOIRE :
Avant que chaque agent ne commence à générer ou réfléchir, tu DOIS écrire sa balise exacte en gras sur une nouvelle ligne :
**[🛑 AGENT: NOM_DE_L_AGENT]**

SÉQUENCE À SUIVRE (Sauf si le PM décide que c'est une tâche mineure) :
1. **[🛑 AGENT: PM]** -> Analyse.
2. **[🛑 AGENT: BACKEND_1]** -> Code.
3. **[🛑 AGENT: BACKEND_2]** -> Amélioration.
4. **[🛑 AGENT: BACKEND_3]** -> Finalisation.
5. **[🛑 AGENT: UI_1]** -> Structure.
6. **[🛑 AGENT: UI_2]** -> Design (Vibe).
7. **[🛑 AGENT: UI_3]** -> Polish.
8. **[🛑 AGENT: FINAL_REPORTER]** -> Message de fin.

Pour chaque étape, l'agent DOIT appliquer son PROMPT SPÉCIFIQUE (défini ci-dessus dans ta mémoire) et ignorer les personnalités précédentes.
`;

const BATCH_SIZE = 100; // Buffer plus petit pour voir les agents réagir vite

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
}

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, antiPatternImages } = body;
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    const buildContents = () => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        
        // 1. INJECTIONS VISUELLES
        const visualParts: Part[] = [];
        if (allReferenceImages?.length > 0) {
            allReferenceImages.forEach((img: string) => 
                visualParts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
            visualParts.push({ text: "REFERENTIEL VISUEL (INSPIRATION): Copie ce style." });
        }
        if (antiPatternImages?.length > 0) {
            antiPatternImages.forEach((img: string) => 
                visualParts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
            visualParts.push({ text: "REFERENTIEL NEGATIF (ANTI-PATTERN): Ne fais surtout pas ça." });
        }
        if (visualParts.length > 0) contents.push({ role: 'user', parts: visualParts });

        // 2. HISTORIQUE
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach((img: string) => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                uploadedFiles?.forEach((f: any) => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier: ${f.fileName}]` } as any));
                
                // INJECTION DES DEFINITIONS D'AGENTS DANS LE DERNIER MESSAGE
                // Cela force le modèle à charger les personnalités maintenant
                const definitions = Object.entries(AGENTS).map(([name, prompt]) => `DEFINITION AGENT ${name}: ${prompt}`).join('\n\n');
                parts.push({ text: `\n\n${definitions}\n\n[ACTION]: Lance la séquence définie dans l'instruction système.` });
            }
            parts.push({ text: msg.content || ' ' });
            contents.push({ role, parts });
        });
        return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let batchBuffer = "";

        try {
            const response = await ai.models.generateContentStream({
                model,
                contents: buildContents(),
                tools: [{ functionDeclarations: [readFileDeclaration] }],
                config: { 
                    systemInstruction: ORCHESTRATOR_INSTRUCTION // Le chef d'orchestre
                },
                generationConfig: {
                  temperature: 1.0, 
                  maxOutputTokens: 8192,
                  thinkingConfig: {     
                    includeThoughts: true,
                    thinkingLevel: "high" 
                  }
                }
            });

            for await (const chunk of response) {
                if (chunk.text) {
                    batchBuffer += chunk.text;
                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();

        } catch (e: any) {
            send(`\n\n[SYSTEM ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
    }
