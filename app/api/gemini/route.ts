import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt" 
import { IndexedChunk } from "@/lib/rag-utils" // Import du type

// ... (vos fonctions utilitaires : getMimeTypeFromBase64, cleanBase64Data, vos types Message et ProjectFile) ...

// --- FONCTIONS MATHÉMATIQUES POUR LA SIMILARITÉ COSINE ---
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

// --- FONCTION DE RÉCUPÉRATION (RETRIEVAL) RAG ---
async function retrieveRelevantContext(
    prompt: string, 
    allEmbeddings: IndexedChunk[], 
    ai: GoogleGenAI
): Promise<string> {
    if (allEmbeddings.length === 0) return "";
    
    const EMBEDDING_MODEL = "text-embedding-004";
    
    // 1. Vectoriser la question de l'utilisateur (Query)
    const queryEmbeddingResponse = await ai.embed.embedContent({
        model: EMBEDDING_MODEL, 
        content: prompt,
    });
    const queryVector = queryEmbeddingResponse.embedding.values;

    // 2. Calculer la Similarité et classer
    const rankedChunks = allEmbeddings.map(chunk => ({
        ...chunk,
        similarity: cosineSimilarity(queryVector, chunk.embedding),
    })).sort((a, b) => b.similarity - a.similarity);

    // 3. Sélectionner les 5 morceaux de code les plus pertinents (Top K)
    const TOP_K = 5;
    // Utiliser un seuil de pertinence minimal de 0.8 pour un code très spécifique
    const relevantChunks = rankedChunks.slice(0, TOP_K).filter(chunk => chunk.similarity > 0.8); 
    
    if (relevantChunks.length === 0) return "";

    // 4. Augmentation: Formater le contexte pour l'IA
    let context = "\n\n--- CODE CONTEXTUEL RÉCUPÉRÉ (Pour la modification ou référence) ---\n";
    relevantChunks.forEach(chunk => {
        context += `// Fichier: ${chunk.filePath} (Pertinence: ${chunk.similarity.toFixed(2)})\n`;
        context += `${chunk.text}\n`;
        context += `// ---\n`;
    });
    context += "--- FIN DU CONTEXTE DE CODE RÉCUPÉRÉ ---\n\n";

    return context;
}

const BATCH_SIZE = 256; 

export async function POST(req: Request) {
  try {
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
        projectEmbeddings // Les vecteurs indexés par le client
    } = await req.json() as { 
        history: Message[], 
        currentProjectFiles: ProjectFile[], // Non utilisé ici, car RAG est prioritaire
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
    
    // 1. CONVERSION DE L'HISTORIQUE EN FORMAT GEMINI (contents)
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    for (const msg of history) {
        const parts: Part[] = [];
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let textContent = msg.content;

        if (msg === history[history.length - 1] && role === 'user') {
            
            // 🛑 ÉTAPE RAG : Récupération du contexte pertinent
            const userPrompt = msg.content;
            const relevantContext = await retrieveRelevantContext(userPrompt, projectEmbeddings, ai);

            // On injecte le BasePrompt + le contexte du projet (RAG) + le message actuel de l'utilisateur
            textContent = basePrompt + relevantContext + "\n\n" + textContent;
            
            // ... (Injection des images/fichiers inchangée) ...
            if (uploadedImages && uploadedImages.length > 0) {
                // ... (logic) ...
            }
            if (uploadedFiles && uploadedFiles.length > 0) {
                 // ... (logic) ...
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

    // ... (Le streaming, le BATCH_SIZE, et le retour sont inchangés) ...
    const encoder = new TextEncoder()
    let batchBuffer = ""; 

    const stream = new ReadableStream({
      async start(controller) {
        // ... (Streaming logic) ...
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
                                     
