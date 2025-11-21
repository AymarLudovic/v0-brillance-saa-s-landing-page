"use client"

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, CheckCircle, ArrowLeft, Loader, ShoppingBag } from 'lucide-react';
import Link from 'next/link';

// --- LOGIQUE DB DÉDIÉE (ISOLÉE) ---
// On utilise une base séparée pour ne pas toucher à ta v2 existante
const IMAGES_DB_NAME = 'StudioCode_Assets';
const IMAGES_DB_VERSION = 1;

const initImageDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGES_DB_NAME, IMAGES_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('refs')) {
        db.createObjectStore('refs', { keyPath: 'id' });
      }
    };
  });
};

const saveRefImage = async (img: { id: string, name: string, base64: string, isActive: boolean }) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('refs', 'readwrite');
    const store = tx.objectStore('refs');
    store.put({ ...img, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getRefImages = async (): Promise<any[]> => {
  const db = await initImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('refs', 'readonly');
    const store = tx.objectStore('refs');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

const deleteRefImage = async (id: string) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('refs', 'readwrite');
    const store = tx.objectStore('refs');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const setAsActiveImage = async (id: string) => {
  const db = await initImageDB();
  const tx = db.transaction('refs', 'readwrite');
  const store = tx.objectStore('refs');
  
  const allImagesRequest = store.getAll();
  
  allImagesRequest.onsuccess = () => {
      const images = allImagesRequest.result;
      images.forEach((img: any) => {
          // On active celle choisie, on désactive les autres
          img.isActive = (img.id === id);
          store.put(img);
      });
  };
  
  return new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
  });
};

// --- COMPOSANT DE PAGE ---

export default function ShopPage() {
    const [images, setImages] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        loadImages();
    }, []);

    const loadImages = async () => {
        try {
            const imgs = await getRefImages();
            // Tri : Active en premier, puis par date
            setImages(imgs.sort((a, b) => (b.isActive === a.isActive) ? b.createdAt - a.createdAt : b.isActive ? 1 : -1));
        } catch (e) { console.error(e); }
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        const reader = new FileReader();
        
        reader.onloadend = async () => {
            const img = new Image();
            img.src = reader.result as string;
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // Optimisation : max 1000px pour ne pas tuer la DB
                const scale = Math.min(1, 1000 / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                
                const newImage = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    base64: optimizedBase64,
                    isActive: false // Par défaut non active
                };
                
                await saveRefImage(newImage);
                await loadImages();
                setIsUploading(false);
            };
        };
        reader.readAsDataURL(file);
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("Supprimer ce style ?")) {
            await deleteRefImage(id);
            loadImages();
        }
    };

    const handleActivate = async (id: string) => {
        await setAsActiveImage(id);
        loadImages();
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10 font-sans">
            
            <div className="max-w-7xl mx-auto mb-8 flex justify-between items-end">
                <div>
                    <Link href="/chat" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4 text-sm font-medium">
                        <ArrowLeft size={16} /> Retour au Chat
                    </Link>
                    <h1 className="text-4xl font-bold flex items-center gap-3">
                        <ShoppingBag className="text-purple-500" size={36} /> Design Shop
                    </h1>
                    <p className="text-gray-500 mt-2 max-w-xl">
                        Activez un style ici. L'IA l'utilisera automatiquement pour vos prochaines créations dans le chat.
                    </p>
                </div>
                
                <label className="flex items-center gap-2 px-5 py-3 bg-white text-black rounded-xl font-bold cursor-pointer hover:bg-gray-200 transition-all hover:scale-105 active:scale-95">
                    {isUploading ? <Loader className="animate-spin" size={20} /> : <Plus size={20} />}
                    <span>Ajouter un Style</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                </label>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {images.map((img) => (
                    <div 
                        key={img.id} 
                        onClick={() => handleActivate(img.id)}
                        className={`group relative aspect-[4/3] rounded-2xl overflow-hidden border-2 cursor-pointer transition-all duration-300 bg-[#111] ${
                            img.isActive 
                            ? 'border-purple-500 ring-4 ring-purple-500/20 scale-[1.02] shadow-2xl shadow-purple-900/20' 
                            : 'border-white/5 hover:border-white/20 hover:-translate-y-1'
                        }`}
                    >
                        <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                        
                        <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-5 transition-opacity ${img.isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <div className="flex justify-between items-end">
                                <div>
                                    <p className="font-bold text-white truncate pr-4">{img.name}</p>
                                    <p className="text-xs text-gray-400">
                                        {img.isActive ? 'Style Actif' : 'Cliquer pour activer'}
                                    </p>
                                </div>
                                {img.isActive && (
                                    <div className="bg-purple-600 text-white p-1.5 rounded-full shadow-lg">
                                        <CheckCircle size={20} fill="currentColor" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <button 
                            onClick={(e) => handleDelete(e, img.id)}
                            className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
  }
