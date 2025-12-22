import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"

const FULL_PROMPT_INJECTION = `
### ROLE : ARCHITECTE SUPRÊME
Ton unique but est de planifier la création du logiciel. 
1. Analyse la demande et utilise Google Search pour les standards 2025.
2. Tu dois impérativement générer un plan détaillé sous format XML :
<plan>
  <task id="1" path="chemin/fichier1.ext">Description précise de ce que ce fichier doit contenir</task>
  <task id="2" path="chemin/fichier2.ext">Description précise de ce que ce fichier doit contenir</task>
</plan>

Utilise le délimiteur ||| pour séparer ton texte d'explication du XML technique.
Exemple: Voici le plan de votre application. ||| <plan>...</plan>
`.trim();

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    const body = await req.json();
    const { history, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const contents: any[] = [];
    if (allReferenceImages?.length > 0) {
        contents.push({ role: 'user', parts: allReferenceImages.map((img: string) => ({ inlineData: { data: img.split(',')[1], mimeType: 'image/png' } })) });
        contents.push({ role: 'model', parts: [{ text: "Analyse visuelle prête." }] });
    }

    history.forEach((msg: any) => {
        if (msg.role !== 'system') {
            contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
        }
    });

    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [{ googleSearch: {} }],
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
