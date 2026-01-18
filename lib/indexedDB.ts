import { openDB, DBSchema } from 'idb';

// --- CONFIGURATION ET TYPES ---

interface VibeDB extends DBSchema {
  vibes: {
    key: string;
    value: {
      id: string;
      base64: string;
      category: 'landing' | 'app' | 'login' | 'other' | 'anti-pattern';
      createdAt: number;
    };
  };
}

const DB_NAME = 'vibe-coding-db';
const STORE_NAME = 'vibes';

// --- UTILITAIRES ---

// Algorithme de mélange Fisher-Yates (plus performant que .sort())
function shuffleArray<T>(array: T[]): T[] {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};

// --- FONCTIONS CORE ---

export async function initDB() {
  // On passe en version 2 pour supporter les nouvelles catégories si nécessaire
  return openDB<VibeDB>(DB_NAME, 2, {
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

// --- LOGIQUE IA (Inspirations + Anti-Patterns) ---

/**
 * Récupère le contexte complet pour l'IA :
 * 1. Filtre les inspirations par intention (landing, app, etc.)
 * 2. Récupère des anti-patterns au hasard pour dire à l'IA ce qu'il ne faut PAS faire.
 */
export async function getContextForAI(userMessage: string, count: number = 3) {
  const allVibes = await getAllVibes();
  const msg = userMessage.toLowerCase();

  // 1. Sélection des Anti-Patterns (Max 2)
  const antiPatterns = allVibes.filter(v => v.category === 'anti-pattern');
  const selectedAnti = shuffleArray(antiPatterns).slice(0, 2);

  // 2. Sélection des Inspirations (Tout sauf anti-pattern)
  let inspirations = allVibes.filter(v => v.category !== 'anti-pattern');

  // Filtrage intelligent par mots-clés
  if (msg.includes('landing') || msg.includes('site')) {
    inspirations = inspirations.filter(v => v.category === 'landing');
  } else if (msg.includes('app') || msg.includes('dashboard') || msg.includes('admin')) {
    inspirations = inspirations.filter(v => v.category === 'app');
  } else if (msg.includes('login') || msg.includes('auth') || msg.includes('connexion')) {
    inspirations = inspirations.filter(v => v.category === 'login');
  }

  // Fallback : si aucun match, on reprend toutes les inspirations
  if (inspirations.length === 0) {
    inspirations = allVibes.filter(v => v.category !== 'anti-pattern');
  }

  const selectedInspirations = shuffleArray(inspirations).slice(0, count);

  return {
    referenceImages: selectedInspirations.map(v => v.base64),
    antiPatternImages: selectedAnti.map(v => v.base64)
  };
    }
     
