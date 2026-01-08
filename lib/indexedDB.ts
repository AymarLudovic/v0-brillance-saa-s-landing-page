import { openDB, DBSchema } from 'idb';

interface VibeDB extends DBSchema {
  vibes: {
    key: string;
    value: {
      id: string;
      base64: string; // Image compressée/optimisée
      category: 'landing' | 'app' | 'login' | 'other'; // <-- AJOUT IMPORTANT
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

// Fonction de sauvegarde mise à jour avec catégorie
export async function saveImageToVibe(file: File, category: 'landing' | 'app' | 'login' | 'other' = 'other'): Promise<void> {
  const db = await initDB();
  const base64 = await toBase64(file);
  await db.put(STORE_NAME, {
    id: crypto.randomUUID(),
    base64,
    category,
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

// ALGORITHME DE FILTRAGE INTELLIGENT (Côté Client)
// C'est cette fonction que ta page de Chat doit appeler avant d'envoyer à l'API
export async function getVibesByIntent(userMessage: string, count: number = 4) {
  const all = await getAllVibes();
  const msg = userMessage.toLowerCase();
  
  let filtered = all;

  if (msg.includes('landing')) {
    filtered = all.filter(v => v.category === 'landing');
  } else if (msg.includes('app') || msg.includes('dashboard') || msg.includes('tableau')) {
    filtered = all.filter(v => v.category === 'app');
  } else if (msg.includes('login') || msg.includes('connexion')) {
    filtered = all.filter(v => v.category === 'login');
  }
  
  // Si aucun filtre ne correspond ou si vide, on prend tout (fallback)
  if (filtered.length === 0) filtered = all;

  // Mélange de Fisher-Yates
  const shuffled = filtered.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(v => v.base64);
}

export async function getRandomVibes(count: number = 4) {
  const all = await getAllVibes();
  if (all.length <= count) return all.map(v => v.base64);
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
