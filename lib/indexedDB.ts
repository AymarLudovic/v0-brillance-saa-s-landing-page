import { openDB, DBSchema } from 'idb';

// On définit deux stores séparés
interface VibeDB extends DBSchema {
  'good_vibes': {
    key: string;
    value: { id: string; base64: string; createdAt: number; };
  };
  'bad_vibes': {
    key: string;
    value: { id: string; base64: string; createdAt: number; };
  };
}

const DB_NAME = 'vibe-coding-db-v2'; // J'ai changé le nom pour repartir sur une base propre

export type VibeType = 'good' | 'bad';

export async function initDB() {
  return openDB<VibeDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('good_vibes')) {
        db.createObjectStore('good_vibes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('bad_vibes')) {
        db.createObjectStore('bad_vibes', { keyPath: 'id' });
      }
    },
  });
}

// Fonction générique pour sauvegarder selon le type
export async function saveImageToVibe(file: File, type: VibeType): Promise<void> {
  const db = await initDB();
  const base64 = await toBase64(file);
  const storeName = type === 'good' ? 'good_vibes' : 'bad_vibes';
  
  await db.put(storeName, {
    id: crypto.randomUUID(),
    base64,
    createdAt: Date.now(),
  });
}

// Récupérer toutes les images d'un type
export async function getAllVibes(type: VibeType) {
  const db = await initDB();
  const storeName = type === 'good' ? 'good_vibes' : 'bad_vibes';
  return await db.getAll(storeName);
}

// Supprimer une image spécifique
export async function deleteVibe(id: string, type: VibeType) {
  const db = await initDB();
  const storeName = type === 'good' ? 'good_vibes' : 'bad_vibes';
  await db.delete(storeName, id);
}

// L'ALGO DE CRÉATIVITÉ (Uniquement pour les GOOD vibes généralement)
export async function getRandomGoodVibes(count: number = 4) {
  const all = await getAllVibes('good');
  if (all.length <= count) return all.map(v => v.base64);
  
  const shuffled = all.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(v => v.base64);
}

// Pour récupérer TOUS les BAD examples (pour dire à l'IA ce qu'il ne faut pas faire)
export async function getAllBadVibes() {
  const all = await getAllVibes('bad');
  return all.map(v => v.base64);
}

const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};
          
