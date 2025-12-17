"use client";

import { useState, useEffect } from "react";
import { Upload, Trash, FileJson, RefreshCw, Database } from "lucide-react";

// --- UTILITAIRE INDEXEDDB ---
const DB_NAME = "VibeDesignDB";
const STORE_NAME = "components";

const openDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export default function DesignManager() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Charger les données au montage
  const loadItems = async () => {
    setLoading(true);
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => {
      setItems(request.result);
      setLoading(false);
    };
  };

  useEffect(() => { loadItems(); }, []);

  // Fonction d'importation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Le JSON peut être un tableau (Dataset complet) ou un objet unique
        const dataToImport = Array.isArray(json) ? json : (json.components ? json.components : [json]);
        
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);

        let count = 0;
        dataToImport.forEach((item: any) => {
            // On s'assure d'avoir un ID unique
            if(!item.id) item.id = crypto.randomUUID();
            store.put(item);
            count++;
        });

        tx.oncomplete = () => {
            alert(`${count} composants importés dans la mémoire locale !`);
            loadItems();
        };
      } catch (err) {
        alert("Erreur de lecture du JSON. Vérifie le format.");
      }
    };
    reader.readAsText(file);
  };

  const deleteItem = async (id: string) => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => loadItems();
  };

  const clearDB = async () => {
    if(!confirm("Tout effacer ?")) return;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => loadItems();
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center border-b border-white/10 pb-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <Database className="text-purple-500" />
                    Mémoire Design (IndexedDB)
                </h1>
                <p className="text-neutral-400 text-sm mt-1">C'est ici que l'IA viendra piocher ses références.</p>
            </div>
            <div className="flex gap-4">
                <button onClick={clearDB} className="text-red-500 text-xs hover:underline">Tout vider</button>
                <label className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg cursor-pointer flex items-center gap-2 text-sm font-bold transition">
                    <Upload size={16}/>
                    IMPORTER JSON
                    <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                </label>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((item) => (
                <div key={item.id} className="bg-neutral-900 border border-white/5 p-4 rounded-xl flex flex-col gap-3 group relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <span className="bg-neutral-800 text-neutral-300 text-[10px] px-2 py-1 rounded uppercase font-mono">{item.type}</span>
                        <button onClick={() => deleteItem(item.id)} className="text-neutral-600 hover:text-red-500"><Trash size={14}/></button>
                    </div>
                    
                    {/* Preview Rapide du Code (CSS ou HTML) */}
                    <div className="h-24 bg-black/50 rounded-lg p-2 overflow-hidden text-[10px] font-mono text-neutral-500">
                        {item.css_clean || item.isolatedCss || item.ai_html || "Pas de preview CSS"}
                    </div>

                    <div className="text-xs text-neutral-400 truncate">
                        ID: {item.id}
                    </div>
                </div>
            ))}
            {items.length === 0 && (
                <div className="col-span-full text-center py-20 text-neutral-600 border-2 border-dashed border-neutral-800 rounded-xl">
                    Aucun composant en mémoire. Importe un JSON depuis l'Extracteur.
                </div>
            )}
        </div>

      </div>
    </div>
  );
      }
