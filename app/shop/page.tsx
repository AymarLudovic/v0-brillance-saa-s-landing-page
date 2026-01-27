"use client";

import { useState, useEffect } from "react";

const DB_NAME = "VibeCodingDB";
const STORES = { BAD: "bad_examples", GOOD: "good_examples" };

// --- LOGIQUE BASE DE DONNÉES ---
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    // On s'assure qu'on est côté client
    if (typeof window === "undefined") return;

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.BAD)) db.createObjectStore(STORES.BAD, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.GOOD)) db.createObjectStore(STORES.GOOD, { keyPath: "id", autoIncrement: true });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => {
      console.error("Erreur ouverture DB:", e);
      reject("Erreur IndexDB");
    };
  });
};

// Fonction utilitaire pour lire un fichier en Promesse (évite le callback hell)
const readFileAsUrl = (file: File): Promise<{ name: string; content: string | ArrayBuffer | null }> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, content: reader.result });
    reader.readAsDataURL(file);
  });
};

export default function VibeStudioPage() {
  const [badImages, setBadImages] = useState<any[]>([]);
  const [goodImages, setGoodImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshImages = async () => {
    try {
      const db = await openDB();
      if (!db) return;

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
    } catch (err) {
      console.error("Erreur refresh:", err);
    }
  };

  useEffect(() => {
    refreshImages();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, storeName: string) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setLoading(true);

    try {
      const files = Array.from(e.target.files);
      
      // 1. On lit tous les fichiers d'abord (en parallèle)
      const fileDataList = await Promise.all(files.map(readFileAsUrl));

      // 2. On ouvre la DB une seule fois
      const db = await openDB();
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);

      // 3. On ajoute tout dans la même transaction
      fileDataList.forEach((fileData) => {
        store.add({
          content: fileData.content,
          name: fileData.name,
          timestamp: Date.now(),
        });
      });

      // 4. On attend que la transaction soit finie pour rafraichir
      tx.oncomplete = () => {
        refreshImages();
        setLoading(false);
      };
      
      tx.onerror = (err) => {
        console.error("Erreur transaction:", err);
        setLoading(false);
      };

    } catch (error) {
      console.error("Erreur upload:", error);
      setLoading(false);
    }
  };

  const deleteImage = async (id: number, storeName: string) => {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => refreshImages();
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-8">
      {/* HEADER */}
      <header className="max-w-6xl mx-auto mb-12 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-2 text-gray-900">
          VIBE STUDIO
        </h1>
        <p className="text-gray-500 uppercase text-xs tracking-[0.2em] font-medium">
          Interface de calibration visuelle
        </p>
      </header>

      {loading && (
        <div className="fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg animate-pulse z-50">
          Traitement en cours...
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
        
        {/* SECTION ANTI-PATTERNS (Light Theme) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-red-600 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-600"></span>
              Don't (À éviter)
            </h2>
            <label className="bg-white border border-gray-300 hover:border-red-400 hover:text-red-500 text-gray-600 px-4 py-2 rounded-md cursor-pointer text-xs font-bold transition shadow-sm">
              + AJOUTER
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleUpload(e, STORES.BAD)} />
            </label>
          </div>
          
          <div className="p-6 bg-gray-50/30 flex-grow">
            <div className="grid grid-cols-3 gap-4">
              {badImages.map((img) => (
                <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden shadow-sm group bg-white">
                  <img src={img.content} alt="Preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-red-900/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <button 
                      onClick={() => deleteImage(img.id, STORES.BAD)}
                      className="bg-white text-red-600 px-3 py-1 rounded shadow-md text-xs font-bold hover:bg-red-50"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
              {badImages.length === 0 && (
                <div className="col-span-3 py-12 text-center border-2 border-dashed border-gray-200 rounded-lg">
                  <p className="text-gray-400 text-sm">La galerie est vide.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SECTION VIBE BOARD (Light Theme) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
          <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-emerald-600 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              Do (Inspiration)
            </h2>
            <label className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md cursor-pointer text-xs font-bold transition shadow-sm shadow-emerald-200">
              + AJOUTER
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleUpload(e, STORES.GOOD)} />
            </label>
          </div>

          <div className="p-6 bg-gray-50/30 flex-grow">
            <div className="grid grid-cols-3 gap-4">
              {goodImages.map((img) => (
                <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden shadow-sm group bg-white">
                  <img src={img.content} alt="Preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-emerald-900/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <button 
                      onClick={() => deleteImage(img.id, STORES.GOOD)}
                      className="bg-white text-red-600 px-3 py-1 rounded shadow-md text-xs font-bold hover:bg-red-50"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
              {goodImages.length === 0 && (
                <div className="col-span-3 py-12 text-center border-2 border-dashed border-gray-200 rounded-lg">
                  <p className="text-gray-400 text-sm">La galerie est vide.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
                                                                                         }
                                      
