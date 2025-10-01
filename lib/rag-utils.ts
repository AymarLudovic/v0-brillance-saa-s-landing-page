// lib/rag-utils.ts

export interface IndexedChunk {
    filePath: string;
    chunkIndex: number;
    text: string;
    embedding: number[]; 
}

interface ProjectFile {
    filePath: string;
    content: string;
}

export async function indexFileContent(file: ProjectFile): Promise<IndexedChunk[]> {
    if (file.content.length === 0) return [];

    try {
        const res = await fetch('/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filePath: file.filePath,
                content: file.content,
            }),
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || `Failed to index file ${file.filePath}`);
        }

        const data = await res.json();
        return data.chunks as IndexedChunk[];

    } catch (error) {
        console.error(`[RAG Indexer] Error processing ${file.filePath}:`, error);
        return [];
    }
}

export function updateProjectEmbeddings(
    newChunks: IndexedChunk[],
    existingEmbeddings: IndexedChunk[]
): IndexedChunk[] {
    if (newChunks.length === 0) return existingEmbeddings;

    const filePathToUpdate = newChunks[0].filePath;

    const filteredEmbeddings = existingEmbeddings.filter(
        (chunk) => chunk.filePath !== filePathToUpdate
    );

    return [...filteredEmbeddings, ...newChunks];
}
