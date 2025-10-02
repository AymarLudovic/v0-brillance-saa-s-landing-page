// app/api/gemini/route.ts

import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt" // Assurez-vous que ce chemin est correct

// --- TYPES ---
interface Message { 
    role: "user" | "assistant"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
}
interface ProjectFile { 
    filePath: string; 
    content: string; 
}

// Utilitaires pour les fichiers
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    // Si c'est un data-url, on retire le préfixe
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256; 

export async function POST(req: Request) {
  try {
    const { 
        history, 
        currentProjectFiles, // ✅ Reçu du client pour l'injection de contexte
        uploadedImages,
        uploadedFiles,
        // projectEmbeddings n'est plus utilisé/traité
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[], 
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
        projectEmbeddings: any[], // Gardé uniquement pour la déstructuration si le client l'envoie toujours
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ error: "Historique de conversation manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash" // ✨ Modèle essentiel pour la grande fenêtre de contexte
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    for (const msg of history) {
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let textContent = msg.content;

        // 🛑 LOGIQUE D'INJECTION DE CONTEXTE COMPLET
        // On injecte le contexte de code uniquement sur le dernier message utilisateur
        if (msg === history[history.length - 1] && role === 'user') {
            
            let fileContext = "\n\n--- FICHIERS PROJET ACTUELS ---\n";
            
            // 1. Concaténation des fichiers du projet
            currentProjectFiles.forEach(file => {
                fileContext += `// Fichier: ${file.filePath} (Longueur: ${file.content.length} caractères)\n`;
                fileContext += file.content + "\n";
                fileContext += `// ---\n`;
            });
            fileContext += "--- FIN FICHIERS PROJET ---\n\n";

            // 2. Construction du prompt final (BasePrompt + Fichiers + Prompt Utilisateur)
            // L'ordre est important : le contexte de fichiers sert de référence avant la requête de l'utilisateur.
            textContent = basePrompt + fileContext + "\n\n" + textContent; 
            
            // 3. Gestion des images/fichiers binaires (votre logique originale)
            if (uploadedImages && uploadedImages.length > 0) {
                uploadedImages.forEach((dataUrl) => {
                    parts.push({
                        inlineData: {
                            data: cleanBase64Data(dataUrl),
                            mimeType: getMimeTypeFromBase64(dataUrl),
                        },
                    });
                });
            }
            if (uploadedFiles && uploadedFiles.length > 0) {
                 uploadedFiles.forEach((file) => {
                    parts.push({
                        inlineData: {
                            data: file.base64Content,
                            mimeType: 'text/plain', 
                        },
                    });
                    parts.push({ text: `\n[Le contenu du fichier externe "${file.fileName}" est fourni ci-dessus]` });
                });
            }
        }
        
        parts.push({ text: textContent }); // Ajout du texte final (qui inclut le contexte pour le dernier message)
        contents.push({ role, parts });
    }
    
    const response = await ai.models.generateContentStream({
      model,
      contents, 
    })

    // Streaming (Logique inchangée)
    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (chunk.text) {
              batchBuffer += chunk.text; 
              
              if (batchBuffer.length >= BATCH_SIZE) {
                controller.enqueue(encoder.encode(batchBuffer));
                batchBuffer = ""; 
              }
            }
          }
          
          if (batchBuffer.length > 0) {
             controller.enqueue(encoder.encode(batchBuffer));
          }

        } catch (err) {
          console.error("[API Gemini] Erreur de streaming:", err)
          controller.enqueue(encoder.encode(`[Stream error: ${(err as Error).message}]`))
        } finally {
          controller.close();
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
    
