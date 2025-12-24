import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"

// Ton prompt d'injection reste la référence absolue pour l'agent final
const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE — MODE SINGLE PAGE NO-FAIL
 STACK TECHNIQUE OBLIGATOIRE : Next.js, React, CSS NATIF (AUCUN Tailwind).
 
`;

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

// Helpers mime-type
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
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;

    const ai = new GoogleGenAI(apiKey);
    const modelId = "gemini-3-flash-preview"; 

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const sendUpdate = (text: string) => controller.enqueue(encoder.encode(text));

        try {
          // --- 1. AGENT MANAGER : Analyse & Vibe ---
          sendUpdate("\n");
          const managerModel = ai.getGenerativeModel({ 
            model: modelId, 
            systemInstruction: "Tu es le Manager. Réponds par une seule phrase courte sur ce que tu vas orchestrer." 
          });
          const managerRes = await managerModel.generateContent(history[history.length - 1].content);
          sendUpdate(`\n\n`);

          // --- 2. AGENT PKG : Architecture ---
          sendUpdate("\n");
          const pkgModel = ai.getGenerativeModel({ 
            model: modelId, 
            systemInstruction: "Tu es l'architecte. Liste les fonctionnalités clés nécessaires pour ce composant unique." 
          });
          const pkgRes = await pkgModel.generateContent(history[history.length - 1].content);
          const blueprint = pkgRes.response.text();

          // --- 3. AGENT GÉNÉRATEUR (FINAL) : Ton flux initial ---
          // On prépare les contenus avec les images et le blueprint injecté
          const contents: any[] = [];
          
          // Ajout du blueprint comme contexte
          contents.push({ role: 'user', parts: [{ text: `Voici le blueprint à suivre : ${blueprint}` }] });
          contents.push({ role: 'model', parts: [{ text: "Bien reçu. Je vais générer le code Pixel-Perfect en suivant ce plan." }] });

          // Mapping de l'historique original
          history.forEach((msg: Message) => {
             contents.push({
               role: msg.role === 'assistant' ? 'model' : 'user',
               parts: [{ text: msg.content }]
             });
          });

          // Appel du flux final avec tes directives No-Fail
          const responseStream = await ai.models.generateContentStream({
            model: modelId,
            contents,
            tools: [{ functionDeclarations: [readFileDeclaration] }],
            config: { systemInstruction: FULL_PROMPT_INJECTION }
          });

          for await (const chunk of responseStream) {
            if (chunk.text) {
              sendUpdate(chunk.text);
            }
          }

          controller.close();
        } catch (err: any) {
          sendUpdate(`\nERREUR_ORCHESTRATION: ${err.message}`);
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
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
            }
