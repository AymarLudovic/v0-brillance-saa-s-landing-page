"use client"

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, ArrowLeft, Loader, ShoppingBag, Link as LinkIcon, CheckCircle, X } from 'lucide-react';
import Link from 'next/link';

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
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
  });
};

const saveRefImage = async (img: { id: string, name: string, base64: string }) => {
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

const saveCssUrl = async (url: string) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put(url, 'master_css_url');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getCssUrl = async (): Promise<string | null> => {
  const db = await initImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('master_css_url');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
};

const deleteCssUrl = async () => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.delete('master_css_url');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export default function ShopPage() {
    const [images, setImages] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [cssUrl, setCssUrl] = useState("");
    const [savedCssUrl, setSavedCssUrl] = useState<string | null>(null);
    const [isSavingUrl, setIsSavingUrl] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const imgs = await getRefImages();
            setImages(imgs.sort((a, b) => b.createdAt - a.createdAt));
            
            const url = await getCssUrl();
            if (url) {
                setCssUrl(url);
                setSavedCssUrl(url);
            }
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
                const scale = Math.min(1, 1000 / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                
                const newImage = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    base64: optimizedBase64
                };
                
                await saveRefImage(newImage);
                await loadData();
                setIsUploading(false);
            };
        };
        reader.readAsDataURL(file);
    };

    const handleDeleteImage = async (id: string) => {
        if (confirm("Supprimer ce style ?")) {
            await deleteRefImage(id);
            loadData();
        }
    };

    const handleSaveUrl = async () => {
        if (!cssUrl.trim()) return;
        setIsSavingUrl(true);
        await saveCssUrl(cssUrl);
        setSavedCssUrl(cssUrl);
        setTimeout(() => setIsSavingUrl(false), 1000);
    };

    const handleDeleteUrl = async () => {
        if (confirm("Supprimer l'URL source de CSS ?")) {
            await deleteCssUrl();
            setCssUrl("");
            setSavedCssUrl(null);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10 font-sans">
            
            <div className="max-w-7xl mx-auto mb-10">
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <Link href="/chat" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4 text-sm font-medium">
                            <ArrowLeft size={16} /> Retour au Chat
                        </Link>
                        <h1 className="text-4xl font-bold flex items-center gap-3">
                            <ShoppingBag className="text-purple-500" size={36} /> Design Studio
                        </h1>
                    </div>
                </div>

                <div className="bg-[#111] border border-white/10 rounded-xl p-6 mb-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                                <LinkIcon size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Source CSS Maître</h3>
                                <p className="text-xs text-gray-500">L'IA extraira les couleurs exactes et polices de ce site.</p>
                            </div>
                        </div>
                        {savedCssUrl && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle size={12}/> Actif</span>}
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <input 
                                type="url" 
                                value={cssUrl}
                                onChange={(e) => setCssUrl(e.target.value)}
                                placeholder="https://linear.app"
                                className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>
                        <button 
                            onClick={handleSaveUrl}
                            className="px-6 py-3 bg-white text-black rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors min-w-[100px]"
                        >
                            {isSavingUrl ? <Loader size={18} className="animate-spin mx-auto"/> : 'Sauvegarder'}
                        </button>
                        {savedCssUrl && (
                            <button 
                                onClick={handleDeleteUrl}
                                className="p-3 border border-red-500/20 text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                                title="Supprimer l'URL"
                            >
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <ImageIcon className="text-purple-500" /> Références Visuelles
                    </h2>
                    <label className="flex items-center gap-2 px-5 py-2 bg-[#111] border border-white/10 text-white rounded-lg font-medium cursor-pointer hover:bg-[#222] transition-colors">
                        {isUploading ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                        <span className="text-sm">Ajouter Image</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {images.map((img) => (
                        <div key={img.id} className="group relative aspect-[4/3] rounded-2xl overflow-hidden border-2 border-white/5 bg-[#111]">
                            <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="font-bold text-white truncate text-sm">{img.name}</p>
                            </div>
                            <button 
                                onClick={() => handleDeleteImage(img.id)}
                                className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}
                    
                    {images.length === 0 && !isUploading && (
                        <div className="col-span-full py-16 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.02]">
                            <ImageIcon size={32} className="text-gray-600 mx-auto mb-3" />
                            <p className="text-gray-500 text-sm">Aucune référence visuelle.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
                     }
