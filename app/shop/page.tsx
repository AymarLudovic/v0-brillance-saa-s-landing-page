"use client";

import { useState, useEffect } from "react";

const DB_NAME = "VibeCodingDB";
const STORES = { BAD: "bad_examples", GOOD: "good_examples" };

// --- LOGIQUE BASE DE DONNÉES ---
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.BAD)) db.createObjectStore(STORES.BAD, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.GOOD)) db.createObjectStore(STORES.GOOD, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject("Erreur IndexDB");
  });
};

export default function VibeStudioPage() {
  const [badImages, setBadImages] = useState<any[]>([]);
  const [goodImages, setGoodImages] = useState<any[]>([]);

  // Récupérer les images au chargement et après chaque action
  const refreshImages = async () => {
    const db = await openDB();
    
    const getFromStore = (name: string) => {
      return new Promise<any[]>((resolve) => {
        const tx = db.transaction(name, "readonly");
        const store = tx.objectStore(name);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });
    };

    const bads = await getFromStore(STORES.BAD);
    const goods = await getFromStore(STORES.GOOD);
    setBadImages(bads);
    setGoodImages(goods);
  };

  useEffect(() => {
    refreshImages();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, storeName: string) => {
    if (!e.target.files) return;
    const db = await openDB();
    const files = Array.from(e.target.files);

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async () => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).add({
          content: reader.result,
          name: file.name,
          timestamp: Date.now()
        });
        tx.oncomplete = () => refreshImages();
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteImage = async (id: number, storeName: string) => {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => refreshImages();
  };

  return (
    <div className="p-8 bg-[#0a0a0a] min-h-screen text-white font-sans">
      <h1 className="text-2xl font-bold mb-10 text-center border-b border-gray-800 pb-4">
        VIBE STUDIO : CALIBRATION DESIGN
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* SECTION ANTI-PATTERNS */}
        <div className="bg-[#111] border border-red-900/30 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-red-500 font-bold uppercase tracking-widest text-sm">1. Anti-Patterns (Toxique)</h2>
            <label className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg cursor-pointer text-xs font-bold transition">
              UPLOAD
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleUpload(e, STORES.BAD)} />
            </label>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {badImages.map((img) => (
              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-800 group">
                <img src={img.content} alt="Preview" className="w-full h-full object-cover" />
                <button 
                  onClick={() => deleteImage(img.id, STORES.BAD)}
                  className="absolute inset-0 bg-red-600/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-white font-bold"
                >
                  SUPPRIMER
                </button>
              </div>
            ))}
            {badImages.length === 0 && <div className="col-span-3 py-10 text-center text-gray-600 text-xs italic">Aucune image toxique</div>}
          </div>
        </div>

        {/* SECTION VIBE BOARD */}
        <div className="bg-[#111] border border-green-900/30 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-green-500 font-bold uppercase tracking-widest text-sm">2. Vibe Board (Divin)</h2>
            <label className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg cursor-pointer text-xs font-bold transition">
              UPLOAD
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleUpload(e, STORES.GOOD)} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {goodImages.map((img) => (
              <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-800 group">
                <img src={img.content} alt="Preview" className="w-full h-full object-cover" />
                <button 
                  onClick={() => deleteImage(img.id, STORES.GOOD)}
                  className="absolute inset-0 bg-green-600/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-white font-bold"
                >
                  SUPPRIMER
                </button>
              </div>
            ))}
            {goodImages.length === 0 && <div className="col-span-3 py-10 text-center text-gray-600 text-xs italic">Aucune image divine</div>}
          </div>
        </div>

      </div>
    </div>
  );
                                   }
    
