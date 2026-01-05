import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
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
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
        allReferenceImages, // C'est ici que tes images aléatoires (3 à 5 max) arrivent
        cssMasterUrl 
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        allReferenceImages?: string[],
        cssMasterUrl?: string
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    // --- INJECTION VISUELLE HYBRIDE (Modifié pour gérer la performance) ---
    // Note: Le client doit envoyer un sous-ensemble aléatoire (ex: 3-5 images) via 'allReferenceImages'
    // pour garantir la vitesse. Gemini traitera ces images comme le "Vibe" du moment.
    if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts: Part[] = [];

        // On itère sur les images reçues (déjà filtrées par le client pour la perf)
        allReferenceImages.forEach((imgBase64) => {
            styleParts.push({
                inlineData: {
                    data: cleanBase64Data(imgBase64),
                    mimeType: getMimeTypeFromBase64(imgBase64)
                }
            });
        });

        let instructionText = `[DIRECTIVE SYSTÈME : ANALYSE VISUELLE CROISÉE & INSPIRATION]
Les images ci-dessus sont ta source d'inspiration (Vibe Board).
1. ANALYSE : Observe les patterns communs dans ces images (rondeur, palette, densité d'information).
2. FUSION : Combine ces éléments visuels avec le concept aléatoire défini dans le prompt textuel.
3. APPLICATION : Utilise ces références pour briser tes habitudes de design standard. Si tu vois du sombre, fais du sombre. Si tu vois du néon, fais du néon.

RÈGLE D'OR : Ne copie pas bêtement une seule image. Crée une synthèse de ces images qui respecte le système de design Mobbin (grille parfaite, espacement) mais avec l'âme visuelle de ces références.

Si l'utilisateur demande une reproduction spécifique, ignore la fusion et reproduis fidèlement (Pixel Perfect). Sinon, sois CRÉATIF.
`;

        if (cssMasterUrl) {
            instructionText += `\n\n4. SOURCE CSS MAÎTRE : L'utilisateur a fourni une URL (${cssMasterUrl}). Lance immédiatement l'outil 'inspirationUrl' pour récupérer son code CSS exact.`;
        }

        styleParts.push({ text: instructionText });

        contents.push({ role: 'user', parts: styleParts });
        // On pré-conditionne le modèle pour qu'il accepte ce style
        contents.push({ role: 'model', parts: [{ text: "Compris. J'ai intégré le Vibe Board visuel. Je vais fusionner ces esthétiques avec la logique structurelle demandée." }] });
    }

    // --- HISTORIQUE ---
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        
        if (msg.role === 'system') {
            systemContextParts.push({ text: msg.content });
            continue; 
        }

        if (msg.functionResponse) {
            parts.push({ functionResponse: { name: msg.functionResponse.name, response: msg.functionResponse.response } });
        } else {
            if (i === lastUserIndex && role === 'user') {
                if (uploadedImages && uploadedImages.length > 0) {
                    uploadedImages.forEach((dataUrl) => {
                        parts.push({ inlineData: { data: cleanBase64Data(dataUrl), mimeType: getMimeTypeFromBase64(dataUrl) } });
                    });
                }
                if (uploadedFiles && uploadedFiles.length > 0) {
                     uploadedFiles.forEach((file) => {
                        parts.push({ inlineData: { data: file.base64Content, mimeType: 'text/plain' } });
                        parts.push({ text: `\n[Fichier: "${file.fileName}"]` });
                    });
                }
            }
            parts.push({ text: msg.content || ' ' }); 
        }
        
        if (parts.length > 0) contents.push({ role, parts });
    }

    const finalSystemInstruction = (
        FULL_PROMPT_INJECTION + 
        (systemContextParts.length > 0 ? "\n\n--- CONTEXTE PROJET ---\n" + systemContextParts.map(p => p.text).join('\n') : "")
    );

    // Appel à l'API Gemini
    const response = await ai.models.generateContentStream({
      model,
      contents, 
      tools: [{ functionDeclarations: [readFileDeclaration] }],
      config: { systemInstruction: finalSystemInstruction }
    });

    const encoder = new TextEncoder();
    let batchBuffer = ""; 
    
    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 
        try {
            for await (const chunk of response) {
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    functionCall = true; 
                    controller.enqueue(encoder.encode(JSON.stringify({ functionCall: chunk.functionCalls[0] })));
                    break; 
                }
                if (chunk.text) {
                  batchBuffer += chunk.text; 
                  if (batchBuffer.length >= BATCH_SIZE) {
                    controller.enqueue(encoder.encode(batchBuffer));
                    batchBuffer = ""; 
                  }
                }
            }
            if (!functionCall && batchBuffer.length > 0) controller.enqueue(encoder.encode(batchBuffer));
            controller.close();
        } catch (streamError: any) {
            // GESTION D'ERREUR EN STREAM (Quota, Timeout, etc.)
            // Au lieu de crasher, on envoie le message d'erreur directement dans le chat
            const errorMessage = `\n\n[SYSTEM ERROR]: Une erreur est survenue pendant la génération (probablement Quota ou Filtre).\nDétail: ${streamError.message}`;
            controller.enqueue(encoder.encode(errorMessage));
            controller.close();
        }
      },
      // Le catch ici gère les erreurs d'initialisation du stream lui-même
      async catch(error) { console.error("Stream Error:", error); }
    })

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } })
  } catch (err: any) {
    // Fallback si l'initialisation complète échoue avant même le stream
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
  }
