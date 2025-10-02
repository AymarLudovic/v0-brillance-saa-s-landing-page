// app/api/gemini/route.ts
import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// Types nécessaires pour la RAG et le contexte
interface IndexedChunk { filePath: string; chunkIndex: number; text: string; embedding: number[]; }
interface Message { role: "user" | "assistant"; content: string; images?: string[]; externalFiles?: { fileName: string; base64Content: string }[]; mentionedFiles?: string[]; }
interface ProjectFile { filePath: string; content: string; }

// --- FONCTIONS MATHÉMATIQUES POUR LA SIMILARITÉ COSINE (inchangées) ---
function dotProduct(vecA: number[], vecB: number[]): number {
    return vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
}
function magnitude(vec: number[]): number {
    return Math.sqrt(vec.reduce((acc, val) => acc + val * val, 0));
}
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const product = dotProduct(vecA, vecB);
    const magA = magnitude(vecA);
    const magB = magnitude(vecB);

    if (magA === 0 || magB === 0) return 0;

    return product / (magA * magB);
}

// --- FONCTION DE RÉCUPÉRATION (RETRIEVAL) RAG (inchangée) ---
async function retrieveRelevantContext(
    prompt: string,
    allEmbeddings: IndexedChunk[],
    ai: GoogleGenAI
): Promise<string> {
    if (!allEmbeddings || allEmbeddings.length === 0) return "";

    const EMBEDDING_MODEL = "text-embedding-004";

    const queryEmbeddingResponse = await ai.embed.embedContent({
        model: EMBEDDING_MODEL,
        content: prompt,
    });
    const queryVector = queryEmbeddingResponse.embedding.values;

    const rankedChunks = allEmbeddings.map(chunk => ({
        ...chunk,
        similarity: cosineSimilarity(queryVector, chunk.embedding),
    })).sort((a, b) => b.similarity - a.similarity);

    const TOP_K = 5;
    const relevantChunks = rankedChunks.slice(0, TOP_K).filter(chunk => chunk.similarity > 0.8);

    if (relevantChunks.length === 0) return "";

    let context = "\n\n--- CODE CONTEXTUEL RÉCUPÉRÉ (RAG) ---\n";
    relevantChunks.forEach(chunk => {
        context += `// Fichier: ${chunk.filePath} (Pertinence: ${chunk.similarity.toFixed(2)})\n`;
        context += `${chunk.text}\n`;
        context += `// ---\n`;
    });
    context += "--- FIN DU CONTEXTE DE CODE RÉCUPÉRÉ ---\n\n";

    return context;
}

// Utilitaires pour les fichiers (inchangé)
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}
function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256;

export async function POST(req: Request) {
  try {
    const {
        history,
        uploadedImages,
        uploadedFiles,
        projectEmbeddings,
        currentProjectFiles // <-- maintenant attendu côté serveur
    } = await req.json() as {
        history: Message[],
        currentProjectFiles: ProjectFile[],
        uploadedImages: string[],
        uploadedFiles: { fileName: string; base64Content: string }[],
        projectEmbeddings: IndexedChunk[],
    }

    if (!history || history.length === 0) {
        return NextResponse.json({ error: "Historique de conversation manquant" }, { status: 400 })
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    })

    const model = "gemini-2.5-flash"

    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    for (const msg of history) {
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let textContent = msg.content;

        // ON TRAITE LE DERNIER MESSAGE UTILISATEUR: on injecte RAG + preview fichiers
        if (msg === history[history.length - 1] && role === 'user') {

            const userPrompt = msg.content;

            // --- 1) Contexte RAG (à partir des embeddings)
            const relevantContext = await retrieveRelevantContext(userPrompt, projectEmbeddings || [], ai);

            // --- 2) Contexte "preview" des fichiers bruts (limités) pour que Gemini sache "quels fichiers existent"
            let filesContext = "";
            if (currentProjectFiles && currentProjectFiles.length > 0) {
                // Limite: maxFilesPreview et charsPerFile (ajustables)
                const maxFilesPreview = 3;
                const charsPerFile = 5000; // 5k chars preview par fichier
                const filesToPreview = currentProjectFiles.slice(0, maxFilesPreview);

                filesToPreview.forEach((file) => {
                    const safePreview = file.content ? file.content.substring(0, charsPerFile) : "";
                    filesContext += `\n\n--- FILE PREVIEW: ${file.filePath} ---\n${safePreview}\n--- END FILE PREVIEW ---\n`;
                });

                // Si il y a plus de fichiers, on informe le modèle
                if (currentProjectFiles.length > maxFilesPreview) {
                    filesContext += `\n[NOTE] Project contains ${currentProjectFiles.length} files. Only previews of the first ${maxFilesPreview} files were included here. Use RAG (provided embeddings) to retrieve more context.`;
                }
            }

            textContent = basePrompt + relevantContext + filesContext + "\n\n" + userPrompt;

            // Gestion des images/fichiers inline (inchangé)
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

    // 2. APPEL À L'API AVEC L'HISTORIQUE COMPLET
    const response = await ai.models.generateContentStream({
      model,
      contents,
    })

    // Streaming (ta logique existante, inchangée)
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
