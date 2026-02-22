import type { Chat, ChatMessage, ProjectFile } from './types';
import { getLanguage } from './types';

const DB_NAME = 'gemini-platform';
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { _db = req.result; resolve(req.result); };
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('chats')) {
        const s = db.createObjectStore('chats', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const s = db.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('chatId', 'chatId');
        s.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('chatFiles')) {
        db.createObjectStore('chatFiles', { keyPath: 'chatId' });
      }
    };
  });
}

function tx<T>(
  store: string, mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ─── Chats ────────────────────────────────────────────────────────────────────

export async function getChats(): Promise<Chat[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('chats', 'readonly');
    const req = t.objectStore('chats').index('updatedAt').getAll();
    req.onsuccess = () => resolve((req.result as Chat[]).reverse());
    req.onerror = () => reject(req.error);
  });
}

export async function getChat(id: string): Promise<Chat | undefined> {
  return tx<Chat>('chats', 'readonly', s => s.get(id));
}

export async function addChat(chat: Chat): Promise<void> {
  await tx('chats', 'readwrite', s => s.put(chat));
}

export async function updateChat(id: string, patch: Partial<Chat>): Promise<void> {
  const existing = await getChat(id);
  if (!existing) return;
  await tx('chats', 'readwrite', s => s.put({ ...existing, ...patch }));
}

export async function deleteChat(id: string): Promise<void> {
  await tx('chats', 'readwrite', s => s.delete(id));
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getMessages(chatId: string): Promise<ChatMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const req = t.objectStore('messages').index('chatId').getAll(chatId);
    req.onsuccess = () => {
      const msgs = (req.result as ChatMessage[]).sort((a, b) => a.timestamp - b.timestamp);
      resolve(msgs);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function addMessage(msg: ChatMessage): Promise<void> {
  await tx('messages', 'readwrite', s => s.put(msg));
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
  const db = await openDB();
  const existing = await new Promise<ChatMessage>((resolve, reject) => {
    const t = db.transaction('messages', 'readonly');
    const req = t.objectStore('messages').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!existing) return;
  await tx('messages', 'readwrite', s => s.put({ ...existing, ...patch }));
}

export async function deleteMessages(chatId: string): Promise<void> {
  const msgs = await getMessages(chatId);
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('messages', 'readwrite');
    let pending = msgs.length;
    if (pending === 0) { resolve(); return; }
    msgs.forEach(m => {
      const req = t.objectStore('messages').delete(m.id);
      req.onsuccess = () => { if (--pending === 0) resolve(); };
      req.onerror = () => reject(req.error);
    });
  });
}

// ─── Files ────────────────────────────────────────────────────────────────────

export async function getFiles(chatId: string): Promise<ProjectFile[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const t = db.transaction('chatFiles', 'readonly');
    const req = t.objectStore('chatFiles').get(chatId);
    req.onsuccess = () => resolve(req.result?.files ?? []);
    req.onerror = () => resolve([]);
  });
}

export async function setFiles(chatId: string, files: ProjectFile[]): Promise<void> {
  await tx('chatFiles', 'readwrite', s => s.put({ chatId, files, updatedAt: Date.now() }));
}

export async function upsertFile(chatId: string, path: string, content: string): Promise<void> {
  const existing = await getFiles(chatId);
  const language = getLanguage(path);
  const idx = existing.findIndex(f => f.path === path);
  if (idx >= 0) existing[idx] = { path, content, language };
  else existing.push({ path, content, language });
  await setFiles(chatId, existing);
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
