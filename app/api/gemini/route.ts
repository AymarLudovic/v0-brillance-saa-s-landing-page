import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE — MODE SINGLE PAGE NO-FAIL
 ... (Tes directives habituelles : CSS Natif, XML strict, Zéro bouton mort) ...
`; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

const BATCH_SIZE = 256; 

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
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    // --- CONSTRUCTION DU CONTEXTE DE BASE ---
    const lastUserPrompt = history[history.length - 1].content;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));

        try {
          // --- AGENT 1: MANAGER (La Vibe) ---
          const managerRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Explique ton plan pour : ${lastUserPrompt}` }] }],
            config: { systemInstruction: "Tu es le Manager. Réponds par une phrase courte, stylée et rassurante." }
          });
          const managerText = managerRes.candidates[0].content.parts[0].text;
          send(`[MANAGER]: ${managerText}\n\n`);

          // --- AGENT 2: PKG (Architecture) ---
          send("→ 🏗️ Agent PKG : Établissement de la structure...\n");
          const pkgRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: lastUserPrompt }] }],
            config: { systemInstruction: "Tu es l'Agent PKG. Liste les fonctionnalités et les fichiers nécessaires (Blueprint)." }
          });
          const blueprint = pkgRes.candidates[0].content.parts[0].text;
          send(`\n`);

          // --- AGENT 3: BACKEND BUILDER (Logique & Data) ---
          send("→ ⚙️ Agent Backend : Génération de la logique et persistance...\n");
          const backendRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nBlueprint: ${blueprint}` }] }],
            config: { systemInstruction: "Tu es l'Agent Backend. Génère la logique TypeScript (State, LocalStorage). Utilise le format XML <create_file path='...'>code</create_file>." }
          });
          const backendCode = backendRes.candidates[0].content.parts[0].text;
          send(`${backendCode}\n`);

          // --- AGENT 4: UI BUILDER (L'Interface) ---
          send("→ 🎨 Agent UI : Design Pixel-Perfect et intégration...\n");
          // On utilise ici generateContentStream pour la partie visible du code
          const uiStream = await ai.models.generateContentStream({
            model,
            contents: [
                { role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nLogique existante: ${backendCode}` }] }
            ],
            config: { systemInstruction: FULL_PROMPT_INJECTION } // Ton prompt d'injection ultra-strict
          });

          let fullCode = backendCode;
          for await (const chunk of uiStream) {
            if (chunk.text) {
              fullCode += chunk.text;
              send(chunk.text);
            }
          }

          // --- AGENT 5: VERIFICATOR (Analyse de conformité) ---
          send("\n→ 🔍 Agent Verificator : Analyse de conformité et erreurs...\n");
          const validatorRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Vérifie ce code par rapport au blueprint : ${blueprint}\n\nCode généré:\n${fullCode}` }] }],
            config: { systemInstruction: "Tu es le Verificator. Si tout est ok, dis 'CONFIRME'. Sinon liste les manques ou erreurs TS." }
          });
          const validationReport = validatorRes.candidates[0].content.parts[0].text;
          send(`[VALIDATOR]: ${validationReport}\n\n`);

          // --- AGENT 6: CORRECTOR (Le Fixer) ---
          if (!validationReport.includes("CONFIRME")) {
            send("→ 🛠️ Agent Fixer : Correction finale en cours...\n");
            const fixerRes = await ai.models.generateContentStream({
              model,
              contents: [{ role: 'user', parts: [{ text: `Corrige ces erreurs: ${validationReport} dans le code suivant : ${fullCode}` }] }],
              config: { systemInstruction: FULL_PROMPT_INJECTION }
            });
            for await (const chunk of fixerRes) {
              if (chunk.text) send(chunk.text);
            }
          }

          send("\n✅ Système prêt. Orchestration réussie.");
          controller.close();

        } catch (error: any) {
          send("\nERREUR_ORCHESTRATION: " + error.message);
          controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { 
            "Content-Type": "text/plain; charset=utf-8", 
            "Transfer-Encoding": "chunked" 
        } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
   }
