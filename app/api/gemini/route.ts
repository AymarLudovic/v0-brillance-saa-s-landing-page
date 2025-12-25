import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const STACK_INFO = "STACK: Next.js (App Router), React, TypeScript. INTERDICTION de Tailwind CSS. Utilise uniquement du CSS NATIF (.css).";

const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE — MODE SINGLE PAGE NO-FAIL
 ${STACK_INFO}
 
 ARCHITECTURE :
 - UNE SEULE PAGE (app/page.tsx)
 - CSS NATIF UNIQUEMENT (app/globals.css)
 - Persistance : LocalStorage uniquement.
 
 SORTIE OBLIGATOIRE — FORMAT STRICT XML :
 <create_file path="app/page.tsx">
 CODE TSX COMPLET
 </create_file>
 
 <create_file path="app/globals.css">
 CSS COMPLET
 </create_file>

 INTERDICTION TOTALE : Markdown, explications, commentaires hors code, et texte de politesse. Produis UNIQUEMENT le XML.
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
    
    const lastUserPrompt = history[history.length - 1].content;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));

        try {
          // --- AGENT 1: MANAGER (Le seul qui parle normalement) ---
          const managerRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Planifie : ${lastUserPrompt}` }] }],
            config: { systemInstruction: `Tu es le Manager. Réponds de manière chaleureuse et concise. Explique ce que tu vas construire. INTERDICTION de générer du code ici.` }
          });
          const managerText = managerRes.candidates[0].content.parts[0].text;
          send(`[MANAGER]: ${managerText}\n\n`);

          // --- AGENT 2: PKG (Architecture - Invisible) ---
          send("→ 🏗️ Analyse des structures...\n");
          const pkgRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: lastUserPrompt }] }],
            config: { systemInstruction: `Agent PKG. ${STACK_INFO} Liste les composants techniques. NE GÉNÈRE AUCUN CODE ET AUCUN TEXTE POUR L'UTILISATEUR.` }
          });
          const blueprint = pkgRes.candidates[0].content.parts[0].text;

          // --- AGENT 3: BACKEND BUILDER (Logique pure) ---
          send("→ ⚙️ Configuration de la logique...\n");
          const backendRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nBlueprint: ${blueprint}` }] }],
            config: { systemInstruction: `Agent Backend. Génère la logique TypeScript (State/Storage) UNIQUEMENT en format XML <create_file>. INTERDICTION d'écrire du texte ou des explications.` }
          });
          const backendCode = backendRes.candidates[0].content.parts[0].text;
          send(`${backendCode}\n`);

          // --- AGENT 4: UI BUILDER (Interface pure) ---
          send("→ 🎨 Finalisation du design...\n");
          const uiStream = await ai.models.generateContentStream({
            model,
            contents: [
                { role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nLogique existante: ${backendCode}` }] }
            ],
            config: { systemInstruction: FULL_PROMPT_INJECTION }
          });

          let fullCode = backendCode;
          for await (const chunk of uiStream) {
            if (chunk.text) {
              fullCode += chunk.text;
              send(chunk.text);
            }
          }

          // --- AGENT 5: VERIFICATOR (Binaire) ---
          send("\n→ 🔍 Vérification finale...\n");
          const validatorRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Vérifie ce code. Stack: ${STACK_INFO}. Code:\n${fullCode}` }] }],
            config: { systemInstruction: "Verificator. Si OK, réponds UNIQUEMENT '[VALIDATOR]: CONFIRME'. Sinon, liste les erreurs brièvement." }
          });
          const validationReport = validatorRes.candidates[0].content.parts[0].text;
          send(`${validationReport}\n\n`);

          // --- AGENT 6: CORRECTOR ---
          if (!validationReport.includes("CONFIRME")) {
            const fixerRes = await ai.models.generateContentStream({
              model,
              contents: [{ role: 'user', parts: [{ text: `Corrige: ${validationReport} dans : ${fullCode}` }] }],
              config: { systemInstruction: FULL_PROMPT_INJECTION }
            });
            for await (const chunk of fixerRes) {
              if (chunk.text) send(chunk.text);
            }
          }

          send("\n✅ Prêt.");
          controller.close();

        } catch (error: any) {
          send("\nERREUR_ORCHESTRATION: " + error.message);
          controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
}
