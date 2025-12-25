import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const STACK_INFO = "STACK: Next.js (App Router), React, TypeScript. INTERDICTION de Tailwind CSS. Utilise uniquement du CSS NATIF (.css).";

const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE —  NO-FAIL
 ${STACK_INFO}
 
 ARCHITECTURE :
 
 
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
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    // Récupération de l'historique pour la mémoire
    const lastUserPrompt = history[history.length - 1].content;
    const conversationContext = history.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    const encoder = new TextEncoder();
    const createdFiles = new Set<string>(); // Pour éviter les doublons

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => {
            // Logique anti-doublon simple pour les balises de création de fichiers
            const match = txt.match(/<create_file path="([^"]+)">/);
            if (match && createdFiles.has(match[1])) return; 
            if (match) createdFiles.add(match[1]);
            controller.enqueue(encoder.encode(txt));
        };

        try {
          // --- AGENT 1: MANAGER (Décisionnaire) ---
          const managerRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `CONTEXTE PRÉCÉDENT: ${conversationContext}\n\nREQUÊTE ACTUELLE: ${lastUserPrompt}` }] }],
            config: { systemInstruction: `Tu es le Manager. Analyse si la requête est une "CRÉATION" complète ou une "MODIFICATION" légère. 
            Si c'est une modification, réponds par '[MODE: FAST]'. Sinon, planifie normalement. Réponds brièvement.` }
          });
          const managerDecision = managerRes.candidates[0].content.parts[0].text;
          const isFastMode = managerDecision.includes("[MODE: FAST]");
          
          send(`[MANAGER]: ${managerDecision.replace("[MODE: FAST]", "Appliquons ces modifications...")}\n\n`);

          let fullCode = "";
          let blueprint = "Utiliser l'existant";

          if (!isFastMode) {
            // --- AGENT 2: PKG (Uniquement en mode création/grosse modif) ---
            send("→ 🏗️ Analyse structurelle profonde...\n");
            const pkgRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: `Historique: ${conversationContext}\nPrompt: ${lastUserPrompt}` }] }],
                config: { systemInstruction: `Agent PKG. ${STACK_INFO} Liste les composants techniques requis.` }
            });
            blueprint = pkgRes.candidates[0].content.parts[0].text;

            // --- AGENT 3: BACKEND BUILDER ---
            send("→ ⚙️ Génération de la logique métier...\n");
            const backendRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nBlueprint: ${blueprint}` }] }],
                config: { systemInstruction: `Agent Backend. XML UNIQUEMENT.` }
            });
            fullCode = backendRes.candidates[0].content.parts[0].text;
            send(`${fullCode}\n`);
          }

          // --- AGENT 4: UI BUILDER (Appelé systématiquement mais avec le contexte) ---
          send(isFastMode ? "→ ⚡ Modification rapide du code...\n" : "→ 🎨 Finalisation du design...\n");
          const uiStream = await ai.models.generateContentStream({
            model,
            contents: [
                { role: 'user', parts: [{ text: `HISTORIQUE COMPLET: ${conversationContext}\nLOGIQUE: ${fullCode}\nACTION: ${lastUserPrompt}` }] }
            ],
            config: { systemInstruction: FULL_PROMPT_INJECTION }
          });

          for await (const chunk of uiStream) {
            if (chunk.text) {
              fullCode += chunk.text;
              send(chunk.text);
            }
          }

          // --- AGENT 5: VERIFICATOR ---
          send("\n→ 🔍 Validation...\n");
          const validatorRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `Code final à vérifier:\n${fullCode}` }] }],
            config: { systemInstruction: "Réponds 'CONFIRME' si le code respecte le XML et la stack, sinon liste les erreurs." }
          });
          const validationReport = validatorRes.candidates[0].content.parts[0].text;

          if (!validationReport.includes("CONFIRME")) {
            send("→ 🛠️ Correction automatique...\n");
            const fixerRes = await ai.models.generateContentStream({
              model,
              contents: [{ role: 'user', parts: [{ text: `Corrige ces erreurs: ${validationReport} dans ce code: ${fullCode}` }] }],
              config: { systemInstruction: FULL_PROMPT_INJECTION }
            });
            for await (const chunk of fixerRes) {
              if (chunk.text) send(chunk.text);
            }
          }

          send("\n✅ Opération terminée.");
          controller.close();

        } catch (error: any) {
          send("\nERREUR: " + error.message);
          controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Server Error: " + err.message }, { status: 500 })
  }
                                             }
