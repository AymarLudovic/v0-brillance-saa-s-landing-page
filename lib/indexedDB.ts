import { openDB, DBSchema } from 'idb';

interface VibeDB extends DBSchema {
  vibes: {
    key: string;
    value: {
      id: string;
      base64: string;
      category: string;
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

export async function saveImageToVibe(file: File, category = 'UI'): Promise<void> {
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

/** Returns up to `count` random images as base64 strings */
export async function getRandomVibes(count: number = 4): Promise<string[]> {
  const all = await getAllVibes();
  if (all.length <= count) return all.map(v => v.base64);
  const shuffled = [...all].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(v => v.base64);
}

/**
 * Returns images grouped by category.
 * Also returns the list of category names.
 * Used by sendChat to transmit structured design context to the agent.
 */
export async function getVibesByCategory(maxPerCategory = 2): Promise<{
  byCategory: Record<string, string[]>;
  categoryNames: string[];
}> {
  const all = await getAllVibes();
  const map: Record<string, string[]> = {};
  for (const v of all) {
    const cat = v.category ?? 'UI';
    if (!map[cat]) map[cat] = [];
    map[cat].push(v.base64);
  }
  // Limit to maxPerCategory images per category (random selection)
  const limited: Record<string, string[]> = {};
  for (const [cat, imgs] of Object.entries(map)) {
    const shuffled = [...imgs].sort(() => 0.5 - Math.random());
    limited[cat] = shuffled.slice(0, maxPerCategory);
  }
  return { byCategory: limited, categoryNames: Object.keys(limited) };
}

const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
};
