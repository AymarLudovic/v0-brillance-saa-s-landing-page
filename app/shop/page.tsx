"use client";

import { useState } from "react";

const DB_NAME = "VibeCodingDB";
const STORE_BAD = "bad_examples";
const STORE_GOOD = "good_examples";

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_BAD)) db.createObjectStore(STORE_BAD, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE_GOOD)) db.createObjectStore(STORE_GOOD, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e);
  });
};

const storeImage = async (storeName: string, file: File) => {
  const db = await openDB();
  const reader = new FileReader();
  return new Promise<void>((resolve, reject) => {
    reader.onload = () => {
      const base64 = reader.result as string;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).add({ content: base64, name: file.name, date: new Date() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    reader.readAsDataURL(file);
  });
};

const clearStore = async (storeName: string) => {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  return new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
};

export default function VibeStudioPage() {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, storeName: string) => {
    if (!e.target.files) return;
    setUploading(true);
    await clearStore(storeName);
    
    for (let i = 0; i < e.target.files.length; i++) {
      await storeImage(storeName, e.target.files[i]);
    }
    setUploading(false);
    alert("Images sauvegardées");
  };

  return (
    <div className="p-10 space-y-10 bg-black text-white min-h-screen">
      <div className="grid grid-cols-2 gap-10">
        <div className="border border-red-500 p-5 rounded-xl">
          <h2 className="text-xl font-bold text-red-500 mb-4">Mauvais Designs (Anti-Patterns)</h2>
          <input 
            type="file" multiple accept="image/*" 
            onChange={(e) => handleUpload(e, STORE_BAD)} 
            className="block w-full text-sm text-gray-500"
          />
        </div>

        <div className="border border-green-500 p-5 rounded-xl">
          <h2 className="text-xl font-bold text-green-500 mb-4">Vibe Board (Référence Absolue)</h2>
          <input 
            type="file" multiple accept="image/*" 
            onChange={(e) => handleUpload(e, STORE_GOOD)}
            className="block w-full text-sm text-gray-500"
          />
        </div>
      </div>
    </div>
  );
      }
    
