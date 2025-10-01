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

// 🛑 Définition des types
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

// 🛑 NOUVEAU : Type pour les morceaux de code vectorisés
interface IndexedChunk {
    filePath: string;
    chunkIndex: number;
    text: string;
    embedding: number[]; // Le vecteur
}

// 🛑 NOUVEAU : Fonction de Récupération du Contexte (Placeholder/Concept)
// C'est ici que la magie de la RAG se produira.
async function retrieveRelevantContext(
    prompt: string, 
    allEmbeddings: IndexedChunk[], 
    ai: GoogleGenAI
): Promise<string> {
    // Si la liste des embeddings est vide, on ne peut rien récupérer
    if (allEmbeddings.length === 0) return "";
    
    // --- Étape 1: Vectoriser la question de l'utilisateur (Query) ---
    const queryEmbeddingResponse = await ai.embed.embedContent({
        model: "text-embedding-004", // Utiliser le modèle d'embeddings
        content: prompt,
    });
    const queryVector = queryEmbeddingResponse.embedding.values;

    // --- Étape 2: Calculer la Similarité (Simplicité : on ne le fait pas vraiment ici, 
    // car le calcul de similarité entre tous les vecteurs est lourd en Node.js.
    // Cette étape serait idéale dans une vraie DB Vectorielle).

    // Pour le POC, on va juste injecter la liste complète des fichiers (RAG-lite)
    // et s'assurer que si un fichier est mentionné, son contenu est injecté (si petit).
    
    let context = "";
    // Ici, vous auriez le code de calcul de similarité pour récupérer les Top N chunks.
    
    // Simplicité : Retourner la liste des fichiers comme RAG-lite
    const fileList = allEmbeddings.map(e => e.filePath).filter((v, i, a) => a.indexOf(v) === i).join('\n');
    context += "\n--- CONTEXTE DE FICHIERS DISPONIBLES (Structure du projet) ---\n";
    context += fileList;
    context += "\n--- FIN DU CONTEXTE ---\n";

    // Si vous aviez le contenu pertinent, vous l'ajouteriez ici :
    // context += "\n--- CODE PERTINENT RÉCUPÉRÉ ---\n" + retrievedChunks.join('\n') + "\n---\n";

    return context;
}

// 🛑 TAILLE DE BATCH (pour éviter le flash du code)
const BATCH_SIZE = 256; 

export async function POST(req: Request) {
  try {
    const { 
        history, 
        currentProjectFiles,
        uploadedImages,
        uploadedFiles,
        projectEmbeddings // 🛑 NOUVEAU: Les vecteurs indexés par le client
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[],
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
        projectEmbeddings: IndexedChunk[], // Les vecteurs (pour la RAG)
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
        let textContent = msg.content;

        // Si c'est le DERNIER message (le message utilisateur actuel)
        if (msg === history[history.length - 1] && role === 'user') {
            
            // --- INJECTION DU CONTEXTE RAG (Liste des fichiers + Code Pertinent) ---
            
            // 🛑 ÉTAPE RAG : Récupération du contexte pertinent
            const userPrompt = msg.content;
            const relevantContext = await retrieveRelevantContext(userPrompt, projectEmbeddings, ai);

            // On injecte le BasePrompt + le contexte du projet + le message actuel de l'utilisateur
            textContent = basePrompt + relevantContext + "\n\n" + textContent;
            
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

    // ... (Le streaming et la gestion des BATCH_SIZE sont inchangés) ...
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
