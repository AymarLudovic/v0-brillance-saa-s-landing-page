import { openDB, DBSchema } from 'idb';

interface VibeDB extends DBSchema {
  vibes: {
    key: string;
    value: {
      id: string;
      base64: string;
      category: 'landing' | 'app' | 'login' | 'other' | 'anti-pattern'; // Ajout anti-pattern
      createdAt: number;
    };
  };
}

const DB_NAME = 'vibe-coding-db';
const STORE_NAME = 'vibes';

// Algorithme de Fisher-Yates pour un vrai mélange aléatoire
function shuffleArray<T>(array: T[]): T[] {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

export async function initDB() {
  return openDB<VibeDB>(DB_NAME, 2, { // Version bumpée à 2
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

export async function saveImageToVibe(
  file: File, 
  category: 'landing' | 'app' | 'login' | 'other' | 'anti-pattern' = 'other'
): Promise<void> {
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

// Récupère uniquement les Anti-Patterns (à bannir)
export async function getAntiPatternVibes(count: number = 2) {
  const all = await getAllVibes();
  const anti = all.filter(v => v.category === 'anti-pattern');
  const shuffled = shuffleArray(anti);
  return shuffled.slice(0, count).map(v => v.base64);
}

// Récupère les inspirations (filtre intelligent + aléatoire strict)
export async function getVibesByIntent(userMessage: string, count: number = 4) {
  const all = await getAllVibes();
  // On exclut les anti-patterns de la sélection d'inspiration
  const validVibes = all.filter(v => v.category !== 'anti-pattern');
  const msg = userMessage.toLowerCase();
  
  let filtered = validVibes;

  if (msg.includes('landing')) {
    filtered = validVibes.filter(v => v.category === 'landing');
  } else if (msg.includes('app') || msg.includes('dashboard') || msg.includes('tableau')) {
    filtered = validVibes.filter(v => v.category === 'app');
  } else if (msg.includes('login') || msg.includes('connexion')) {
    filtered = validVibes.filter(v => v.category === 'login');
  }
  
  if (filtered.length === 0) filtered = validVibes;

  // Utilisation du shuffle Fisher-Yates
  const shuffled = shuffleArray(filtered);
  return shuffled.slice(0, count).map(v => v.base64);
}

// Fonction aléatoire générique (exclut toujours les anti-patterns)
export async function getRandomVibes(count: number = 4) {
  const all = await getAllVibes();
  const validVibes = all.filter(v => v.category !== 'anti-pattern');
  
  if (validVibes.length <= count) return validVibes.map(v => v.base64);
  
  const shuffled = shuffleArray(validVibes);
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
    
