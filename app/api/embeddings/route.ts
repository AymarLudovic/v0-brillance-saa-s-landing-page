// app/api/embeddings/route.ts

import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const EMBEDDING_MODEL = "text-embedding-004"; 
const CHUNK_SIZE = 4000; 

function chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
}

export async function POST(req: Request) {
    try {
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
        
        const embedRequests = chunks.map(chunk => ({
            model: EMBEDDING_MODEL,
            content: chunk,
        }));

        const batchResults = await ai.embed.batchEmbedContents(embedRequests);

        batchResults.embeddings.forEach((embedding, i) => {
            indexedChunks.push({
                filePath: filePath,
                chunkIndex: i,
                text: chunks[i],
                embedding: embedding.values,
            });
        });

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
                
