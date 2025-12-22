import { NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"

const FULL_PROMPT_INJECTION = `
### ROLE : DÉVELOPPEUR SUPRÊME
Tu dois exécuter une tâche spécifique de codage.
1. Utilise strictement : <create_file path="chemin/fichier.ext">code</create_file>
2. Produis un code 100% fonctionnel et complet.
3. Sépare ton texte du code avec |||.
`.trim();

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    const body = await req.json();
    const { history, currentTask, plan } = body;

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const response = await ai.models.generateContentStream({
      model,
      contents: [
          { role: 'user', parts: [{ text: `Voici le plan global : ${plan}` }] },
          ...history.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          { role: 'user', parts: [{ text: `Exécute maintenant cette tâche : ${currentTask}` }] }
      ],
      systemInstruction: FULL_PROMPT_INJECTION,
      config: { thinkingConfig: { thinkingLevel: 'HIGH' } }
    });

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of response.stream) {
          controller.enqueue(new TextEncoder().encode(chunk.text()));
        }
        controller.close();
      },
    });

    return new NextResponse(stream);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
            }
