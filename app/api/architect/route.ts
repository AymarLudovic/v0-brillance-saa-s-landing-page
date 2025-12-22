import { NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"

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
    const apiKey = (authHeader && authHeader !== "null") ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Clé API non trouvée" }, { status: 401 });
    }

    const body = await req.json();
    const { history, allReferenceImages } = body;

    const genAI = new GoogleGenAI(apiKey);
    
    // CORRECTION ICI : Utilisation de getGenerativeModel
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash", // Utilise 2.0 ou 1.5 pour la stabilité du SDK standard
      systemInstruction: FULL_PROMPT_INJECTION,
    });

    const contents: any[] = [];
    
    // Images de référence (Shop)
    if (allReferenceImages?.length > 0) {
        contents.push({ 
          role: 'user', 
          parts: allReferenceImages.slice(0, 5).map((img: string) => ({ 
            inlineData: { data: img.split(',')[1], mimeType: 'image/png' } 
          })) 
        });
        contents.push({ role: 'model', parts: [{ text: "Analyse visuelle prête." }] });
    }

    // Historique
    history.forEach((msg: any) => {
        if (msg.role !== 'system' && msg.content) {
            contents.push({ 
              role: msg.role === 'assistant' ? 'model' : 'user', 
              parts: [{ text: msg.content }] 
            });
        }
    });

    // Appel du stream
    const result = await model.generateContentStream({
      contents,
      // Note: Le SDK standard GoogleGenAI gère le search via les tools différemment selon la version
      tools: [{ googleSearchRetrieval: {} } as any], 
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          if (chunkText) {
            controller.enqueue(encoder.encode(chunkText));
          }
        }
        controller.close();
      },
    });

    return new NextResponse(stream);
  } catch (err: any) {
    console.error("DEBUG ARCHITECT ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  }
