import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt" 

// Fonctions utilitaires inchangées
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

// 🛑 Définition du type pour l'historique
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

// 🛑 TAILLE DE BATCH (pour éviter le flash du code)
const BATCH_SIZE = 256; 

export async function POST(req: Request) {
  try {
    const { 
        history, // L'historique complet (user + assistant)
        currentProjectFiles, // Fichiers du projet (pour la RAG-lite)
        uploadedImages, // Images du message actuel
        uploadedFiles, // Fichiers externes du message actuel
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[],
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ error: "Historique de conversation manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"
    
    // 🛑 1. CONVERSION DE L'HISTORIQUE EN FORMAT GEMINI (contents) 🛑
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    // On parcourt tout l'historique
    for (const msg of history) {
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user';

        // Texte principal (y compris le prompt final de l'utilisateur)
        let textContent = msg.content;

        // Si c'est le DERNIER message (le message utilisateur actuel)
        if (msg === history[history.length - 1] && role === 'user') {
            
            // --- INJECTION DU CONTEXTE RAG-LITE (Liste des fichiers) ---
            let projectContext = "\n--- PROJECT FILE LIST ---\n";
            // Ceci est la RAG-lite : seulement la liste des fichiers, pas le contenu !
            // Pour les fichiers de 500k lignes, seul le chemin est envoyé ici.
            projectContext += currentProjectFiles.map(f => f.filePath).join('\n');
            projectContext += "\n--- END PROJECT FILE LIST ---\n";
            
            // On injecte le BasePrompt + le contexte du projet + le message actuel de l'utilisateur
            textContent = basePrompt + projectContext + "\n\n" + textContent;
            
            // --- INJECTION DES IMAGES/FICHIERS UPLOADÉS ---
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
                            mimeType: getMimeTypeFromBase64(`data:text/plain;base64,${file.base64Content}`),
                        },
                    });
                    parts.push({ text: `[EXTERNAL FILE: ${file.fileName}]` });
                });
            }
        }
        
        parts.push({ text: textContent });
        contents.push({ role, parts });
    }
    
    // 🛑 2. APPEL À L'API AVEC L'HISTORIQUE COMPLET 🛑
    const response = await ai.models.generateContentStream({
      model,
      contents, // L'historique complet est ici !
    })

    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (chunk.text) {
              batchBuffer += chunk.text; 
              
              // VÉRIFICATION DU SEUIL
              if (batchBuffer.length >= BATCH_SIZE) {
                controller.enqueue(encoder.encode(batchBuffer));
                batchBuffer = ""; 
              }
            }
          }
          
          // FIN DU STREAM
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
            
