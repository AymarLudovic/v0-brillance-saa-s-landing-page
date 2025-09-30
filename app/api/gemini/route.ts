import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt" 

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

export async function POST(req: Request) {
  try {
    // 🛑 MISE À JOUR : Récupération de tous les nouveaux champs
    const { message, uploadedImages, uploadedFiles, mentionedFiles } = await req.json() as { 
        message: string, 
        uploadedImages: string[], 
        uploadedFiles: { fileName: string; base64Content: string }[],
        mentionedFiles: string[], // Les chemins de fichiers déjà dans le projet
    }

    if (!message && (!uploadedImages || uploadedImages.length === 0) && (!uploadedFiles || uploadedFiles.length === 0)) {
        return NextResponse.json({ error: "Message ou contenu manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"

    // 🛑 MISE À JOUR : Construction du tableau 'contents'
    const userParts: Part[] = []

    // 1. Ajouter les images (Base64)
    if (uploadedImages && uploadedImages.length > 0) {
        uploadedImages.forEach((dataUrl) => {
            userParts.push({
                inlineData: {
                    data: cleanBase64Data(dataUrl),
                    mimeType: getMimeTypeFromBase64(dataUrl),
                },
            });
        });
    }
    
    // 2. Ajouter les fichiers externes (Base64)
    if (uploadedFiles && uploadedFiles.length > 0) {
        uploadedFiles.forEach((file) => {
            userParts.push({
                inlineData: {
                    data: file.base64Content,
                    mimeType: getMimeTypeFromBase64(`data:text/plain;base64,${file.base64Content}`), // Tente d'estimer le mime type
                },
            });
            // Ajoute le nom du fichier comme contexte textuel pour l'IA
            userParts.push({ text: `[FILE NAME: ${file.fileName}]` });
        });
    }

    // 3. Ajouter la mention des fichiers internes
    let mentionContext = "";
    if (mentionedFiles && mentionedFiles.length > 0) {
        mentionContext = `\n[MENTIONED PROJECT FILES: ${mentionedFiles.join(', ')}]`;
    }
    
    // 4. Ajouter le prompt texte
    const fullPrompt = basePrompt + mentionContext + "\n\n" + message
    userParts.push({ text: fullPrompt });

    // 5. Construire la requête contents
    const contents = [{
        role: "user",
        parts: userParts,
    }];

    const response = await ai.models.generateContentStream({
      model,
      contents,
    })

    const encoder = new TextEncoder()
    
    // 🛑 NOUVEAU: Logique de Batching pour regrouper les chunks 🛑
    const BATCH_SIZE = 256; // Seuil de regroupement des caractères
    let batchBuffer = ""; // Buffer interne au serveur

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (chunk.text) {
              batchBuffer += chunk.text; // Accumuler le texte du chunk
              
              // VÉRIFICATION DU SEUIL: Envoi du batch si la taille est atteinte
              if (batchBuffer.length >= BATCH_SIZE) {
                controller.enqueue(encoder.encode(batchBuffer));
                batchBuffer = ""; // Réinitialiser le buffer après envoi
              }
            }
          }
          
          // FIN DU STREAM: S'assurer que le contenu restant est envoyé
          if (batchBuffer.length > 0) {
             controller.enqueue(encoder.encode(batchBuffer));
          }

        } catch (err) {
          console.error("[API Gemini] Erreur de streaming:", err)
          controller.enqueue(encoder.encode(`[Stream error: ${(err as Error).message}]`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    })
  } catch (err: any) {
    console.error("[API Gemini] Erreur globale:", err)
    return NextResponse.json({ error: err.message || "Erreur Gemini" }, { status: 500 })
  }
                }
                  
