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

// On s'assure que c'est bien "export async function POST"
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    
    // Sécurité au cas où l'API KEY est absente
    if (!apiKey) {
      return NextResponse.json({ error: "API Key missing" }, { status: 401 });
    }

    const body = await req.json();
    const { history, allReferenceImages } = body;

    // Ton code initial
    const ai = new (GoogleGenAI as any)({ apiKey });
    
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

    const response = await (ai as any).models.generateContentStream({
      model: "gemini-3-flash-preview", 
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
    // Si l'erreur 500 revient, c'est que la syntaxe "ai.models" n'est pas supportée par ton SDK actuel
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
      }
