// app/api/gemini/route.ts
import { NextResponse } from "next/server"
import { GoogleGenAI, Part } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

interface IndexedChunk { filePath: string; chunkIndex: number; text: string; embedding: number[]; }
interface Message { role: "user" | "assistant"; content: string; images?: string[]; externalFiles?: { fileName: string; base64Content: string }[]; mentionedFiles?: string[]; }
interface ProjectFile { filePath: string; content: string; }

// --- Cosine similarity utils ---
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

// --- RAG retrieval ---
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
  const relevantChunks = rankedChunks.slice(0, TOP_K).filter(c => c.similarity > 0.8);

  if (relevantChunks.length === 0) return "";

  let context = "\n\n--- CODE CONTEXTUEL RÉCUPÉRÉ (RAG) ---\n";
  relevantChunks.forEach(chunk => {
    context += `// File: ${chunk.filePath} (Score: ${chunk.similarity.toFixed(2)})\n`;
    context += `${chunk.text}\n// ---\n`;
  });
  context += "--- END RAG CONTEXT ---\n\n";
  return context;
}

// Utils base64
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
      currentProjectFiles
    } = await req.json() as {
      history: Message[],
      currentProjectFiles: ProjectFile[],
      uploadedImages: string[],
      uploadedFiles: { fileName: string; base64Content: string }[],
      projectEmbeddings: IndexedChunk[],
    }

    if (!history || history.length === 0) {
      return NextResponse.json({ error: "Missing conversation history" }, { status: 400 })
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
    const model = "gemini-2.5-flash"

    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];

    for (const msg of history) {
      const parts: Part[] = [];
      const role = msg.role === 'assistant' ? 'model' : 'user';
      let textContent = msg.content;

      if (msg === history[history.length - 1] && role === 'user') {
        const userPrompt = msg.content;

        // --- 1. RAG context
        const relevantContext = await retrieveRelevantContext(userPrompt, projectEmbeddings || [], ai);

        // --- 2. Preview context
        let filesContext = "";
        if (currentProjectFiles && currentProjectFiles.length > 0) {
          const maxFilesPreview = 3;
          const charsPerFile = 5000;
          const preview = currentProjectFiles.slice(0, maxFilesPreview);
          preview.forEach((f) => {
            filesContext += `\n\n--- FILE PREVIEW: ${f.filePath} ---\n${f.content.substring(0, charsPerFile)}\n--- END FILE PREVIEW ---\n`;
          });
        }

        // --- 3. Detect file mentions in user prompt
        let extraContext = "";
        if (/app\/page\.tsx|app\/globals\.css/.test(userPrompt)) {
          const targetFile = userPrompt.includes("globals.css") ? "app/globals.css" : "app/page.tsx";
          const file = currentProjectFiles?.find(f => f.filePath === targetFile);
          if (file) {
            // Chunk on the fly
            const chunkSize = 4000;
            const chunks: string[] = [];
            for (let i = 0; i < Math.min(file.content.length, 20000); i += chunkSize) {
              chunks.push(file.content.substring(i, i + chunkSize));
            }
            extraContext += `\n\n--- ON-DEMAND FILE (${targetFile}) ---\n${chunks.join("\n")}\n--- END FILE ---\n`;
          }
        }

        textContent = basePrompt + relevantContext + filesContext + extraContext + "\n\n" + userPrompt;

        // Images & files inline (inchangé)
        if (uploadedImages?.length) {
          uploadedImages.forEach((dataUrl) => {
            parts.push({
              inlineData: {
                data: cleanBase64Data(dataUrl),
                mimeType: getMimeTypeFromBase64(dataUrl),
              },
            });
          });
        }
        if (uploadedFiles?.length) {
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

    // Streaming
    const response = await ai.models.generateContentStream({ model, contents })
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
          if (batchBuffer.length > 0) controller.enqueue(encoder.encode(batchBuffer));
        } catch (err) {
          console.error("[API Gemini] Stream error:", err)
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
    console.error("[API Gemini] Fatal error:", err)
    return NextResponse.json({ error: err.message || "Gemini error" }, { status: 500 })
  }
      }
    
