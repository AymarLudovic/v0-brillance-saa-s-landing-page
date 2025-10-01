import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Modèle d'embeddings
const EMBEDDING_MODEL = "text-embedding-004"; 
// Taille de morceau de code (chunk)
const CHUNK_SIZE = 4000; 

// Fonctions utilitaires à placer dans ce fichier ou dans un fichier à part
function chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    // Utiliser le saut de ligne comme séparateur pourrait être mieux pour le code, 
    // mais la version simple par caractère est suffisante pour le POC.
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
}

export async function POST(req: Request) {
    try {
        // Le client envoie un fichier à indexer
        const { filePath, content } = await req.json() as { 
            filePath: string, 
            content: string 
        };

        if (!filePath || !content) {
            return NextResponse.json({ error: "Missing filePath or content" }, { status: 400 });
        }

        const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY!,
        });

        const chunks = chunkText(content, CHUNK_SIZE);
        const indexedChunks = [];
        
        // Gemini permet d'intégrer plusieurs contenus à la fois
        const embedRequests = chunks.map(chunk => ({
            model: EMBEDDING_MODEL,
            content: chunk,
        }));

        // 🛑 Utiliser l'appel batch pour plus d'efficacité
        const batchResults = await ai.embed.batchEmbedContents(embedRequests);

        batchResults.embeddings.forEach((embedding, i) => {
            indexedChunks.push({
                filePath: filePath,
                chunkIndex: i,
                text: chunks[i],
                embedding: embedding.values, // Le vecteur lui-même
            });
        });

        // Retourner les morceaux vectorisés. Le client devra les stocker.
        return NextResponse.json({ 
            message: `Successfully indexed ${indexedChunks.length} chunks for ${filePath}`,
            chunks: indexedChunks 
        });

    } catch (err: any) {
        console.error("[API Embeddings] Erreur de vectorisation:", err);
        return NextResponse.json({ 
            error: "Failed to generate embeddings: " + err.message 
        }, { status: 500 });
    }
         }
          
