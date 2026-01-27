"use client";

import { useState, useEffect } from "react";

const DB_NAME = "VibeCodingDB";
const STORES = { BAD: "bad_examples", GOOD: "good_examples" };

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      Object.values(STORES).forEach(s => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id", autoIncrement: true });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject("Error opening DB");
  });
};

export default function VibeStudioPage() {
  const [badImages, setBadImages] = useState<any[]>([]);
  const [goodImages, setGoodImages] = useState<any[]>([]);

  const loadImages = async () => {
    const db = await openDB();
    Object.entries(STORES).forEach(([key, storeName]) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => {
        if (key === "BAD") setBadImages(request.result);
        else setGoodImages(request.result);
      };
    });
  };

  useEffect(() => { loadImages(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, storeName: string) => {
    if (!e.target.files) return;
    const db = await openDB();
    for (const file of Array.from(e.target.files)) {
      const reader = new FileReader();
      reader.onload = async () => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).add({ content: reader.result, name: file.name });
        tx.oncomplete = () => loadImages();
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteImage = async (id: number, storeName: string) => {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => loadImages();
  };

  return (
    <div className="p-10 bg-black text-white min-h-screen space-y-10">
      <div className="grid grid-cols-2 gap-10">
        {[ { title: "Anti-Patterns (Bad)", store: STORES.BAD, data: badImages, color: "red" },
           { title: "Vibe Board (Good)", store: STORES.GOOD, data: goodImages, color: "green" }
        ].map((cat) => (
          <div key={cat.store} className={`border border-${cat.color}-500 p-5 rounded-xl`}>
            <h2 className={`text-xl font-bold text-${cat.color}-500 mb-4`}>{cat.title}</h2>
            <input type="file" multiple accept="image/*" onChange={(e) => handleUpload(e, cat.store)} className="mb-4 text-xs" />
            <div className="grid grid-cols-4 gap-2">
              {cat.data.map((img) => (
                <div key={img.id} className="relative group">
                  <img src={img.content} className="w-full h-20 object-cover rounded border border-gray-700" />
                  <button onClick={() => deleteImage(img.id, cat.store)} className="absolute top-0 right-0 bg-red-600 text-[10px] p-1 rounded-bl opacity-0 group-hover:opacity-100">X</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
                                    }
                                      
