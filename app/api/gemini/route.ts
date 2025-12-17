import { NextResponse } from "next/server";
import { GoogleGenAI, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";

const FULL_PROMPT_INJECTION = `${basePrompt}`; 

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { 
        history, 
        uploadedImages, // Images de l'utilisateur (le dessin ou le screenshot cible)
        vibeComponents  // <--- NOUVEAU : Les composants JSON extraits (ton dataset)
    } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-2.5-flash"; // Utilise le modèle le plus rapide et capable (ou 1.5 Pro)
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    
    // --- 1. INJECTION DU CONTEXTE "VIBE" (LE DATASET) ---
    // On prépare le cerveau de l'IA avec tes composants extraits avant même qu'elle ne lise la demande.
    let componentsContext = "";
    
    if (vibeComponents && vibeComponents.length > 0) {
        componentsContext += "\n\n--- BIBLIOTHÈQUE DE COMPOSANTS DE RÉFÉRENCE ---\n";
        componentsContext += "Utilise ces blocs de code comme source de vérité pour le style et la structure.\n";
        
        vibeComponents.forEach((comp: any, index: number) => {
            // On nettoie un peu pour économiser des tokens, mais on garde l'essentiel
            componentsContext += `\n[COMPOSANT #${index + 1} - TYPE: ${comp.type}]\n`;
            componentsContext += `\`\`\`html\n${comp.ai_code || comp.ai_hybrid || comp.html_inlined}\n\`\`\`\n`;
        });
        
        componentsContext += "\n--- FIN DE LA BIBLIOTHÈQUE ---\n";
    }

    // --- 2. CONSTRUCTION DU MESSAGE UTILISATEUR ---
    const lastMessage = history[history.length - 1];
    const userPromptParts: Part[] = [];

    // A. Ajout des images uploadées (Ce que l'utilisateur veut construire)
    if (uploadedImages && uploadedImages.length > 0) {
        uploadedImages.forEach((base64: string) => {
            userPromptParts.push({ 
                inlineData: { 
                    data: base64.split(',')[1], 
                    mimeType: "image/png" 
                } 
            });
        });
        userPromptParts.push({ text: "Analyse cette image. C'est la mise en page cible." });
    }

    // B. Ajout du contexte des composants (La librairie extraite)
    if (componentsContext) {
        userPromptParts.push({ text: componentsContext });
        userPromptParts.push({ text: "Instructions : Reproduis la mise en page cible (image ci-dessus) en assemblant les COMPOSANTS DE RÉFÉRENCE fournis ci-dessus. Ne crée pas de style from scratch si un composant correspondant existe." });
    }

    // C. Ajout du message textuel de l'utilisateur
    userPromptParts.push({ text: lastMessage.content });

    // --- 3. ENVOI À GEMINI ---
    // On ne garde pas tout l'historique brut pour éviter la pollution, on se concentre sur le dernier tour "riche"
    // Si tu veux garder l'historique conversationnel, insère-le avant userPromptParts.
    
    // Ajout du System Instruction (Le Prompt Architecte)
    const finalSystemInstruction = FULL_PROMPT_INJECTION;

    const response = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: userPromptParts }], // On envoie un gros paquet contextuel
        config: { 
            systemInstruction: finalSystemInstruction,
            temperature: 0.2 // Très bas pour forcer la fidélité au code fourni (pas de créativité folle)
        }
    });

    // ... (Reste de ton code de streaming inchangé) ...
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            for await (const chunk of response) {
                if (chunk.text) {
                    controller.enqueue(encoder.encode(chunk.text));
                }
            }
            controller.close();
        }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain" } });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
