import { openDB, DBSchema } from 'idb';

interface VibeDB extends DBSchema {
  vibes: {
    key: string;
    value: {
      id: string;
      base64: string; // Image compressée/optimisée
      createdAt: number;
    };
  };
}

const DB_NAME = 'vibe-coding-db';
const STORE_NAME = 'vibes';

export async function initDB() {
  return openDB<VibeDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export async function saveImageToVibe(file: File): Promise<void> {
  const db = await initDB();
  const base64 = await toBase64(file);
  await db.put(STORE_NAME, {
    id: crypto.randomUUID(),
    base64,
    createdAt: Date.now(),
  });
}

export async function getAllVibes() {
  const db = await initDB();
  return await db.getAll(STORE_NAME);
}

export async function deleteVibe(id: string) {
  const db = await initDB();
  await db.delete(STORE_NAME, id);
}

// L'Algorithme de Créativité : Sélectionne X images au hasard
export async function getRandomVibes(count: number = 4) {
  const all = await getAllVibes();
  if (all.length <= count) return all.map(v => v.base64);
  
  // Mélange de Fisher-Yates pour le chaos créatif
  const shuffled = all.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(v => v.base64);
}

const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};
