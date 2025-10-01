// lib/rag-utils.ts

// --- Définitions de types ---
export interface IndexedChunk {
    filePath: string;
    chunkIndex: number;
    text: string;
    embedding: number[]; 
}

// Supposons que votre type de fichier ressemble à ceci
interface ProjectFile {
    filePath: string;
    content: string;
}

// --- Fonctions RAG Côté Client ---

/**
 * Appelle l'API /api/embeddings pour vectoriser un fichier.
 * @param file Le fichier du projet (chemin et contenu).
 * @returns Un tableau de IndexedChunk.
 */
export async function indexFileContent(file: ProjectFile): Promise<IndexedChunk[]> {
    if (file.content.length === 0) return [];

    console.log(`[RAG Indexer] Indexing file: ${file.filePath}`);

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
        console.log(`[RAG Indexer] Indexed ${data.chunks.length} chunks for ${file.filePath}`);
        return data.chunks as IndexedChunk[];

    } catch (error) {
        console.error(`[RAG Indexer] Error processing ${file.filePath}:`, error);
        return [];
    }
}

/**
 * Met à jour le tableau d'embeddings du projet après une modification ou création.
 * @param newChunks Le tableau des nouveaux chunks vectorisés à insérer.
 * @param existingEmbeddings Le tableau actuel des embeddings du projet.
 * @returns Le nouveau tableau complet des embeddings.
 */
export function updateProjectEmbeddings(
    newChunks: IndexedChunk[],
    existingEmbeddings: IndexedChunk[]
): IndexedChunk[] {
    if (newChunks.length === 0) return existingEmbeddings;

    // 1. Identifier le fichier affecté
    const filePathToUpdate = newChunks[0].filePath;

    // 2. Filtrer les anciens embeddings de ce fichier
    const filteredEmbeddings = existingEmbeddings.filter(
        (chunk) => chunk.filePath !== filePathToUpdate
    );

    // 3. Ajouter les nouveaux chunks
    return [...filteredEmbeddings, ...newChunks];
        }
              
