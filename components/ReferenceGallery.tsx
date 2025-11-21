import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, CheckCircle, X, Loader } from 'lucide-react';

// --- LOGIQUE DB DÉDIÉE (SEPARÉE DE LA DB PRINCIPALE POUR RESTER EN V2 AILLEURS) ---
const IMAGES_DB_NAME = 'StudioCode_Assets'; // Une DB à part juste pour ça
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

// --- COMPOSANT UI ---

interface ReferenceGalleryProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (imageObj: any | null) => void; // Renvoie l'objet image complet ou null
    selectedImageId: string | null;
}

export default function ReferenceGallery({ isOpen, onClose, onSelect, selectedImageId }: ReferenceGalleryProps) {
    const [images, setImages] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        if (isOpen) loadImages();
    }, [isOpen]);

    const loadImages = async () => {
        try {
            const imgs = await getRefImages();
            setImages(imgs.sort((a, b) => b.createdAt - a.createdAt));
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
                // Compression pour performance
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const scale = Math.min(1, 1200 / img.width); // Max 1200px large
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.7); // Qualité 70%
                
                const newImage = {
                    id: crypto.randomUUID(),
                    name: file.name,
                    base64: optimizedBase64
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
        if (confirm("Supprimer cette image ?")) {
            await deleteRefImage(id);
            if (selectedImageId === id) onSelect(null);
            loadImages();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-5xl h-[85vh] bg-[#0f0f0f] rounded-2xl border border-white/10 flex flex-col overflow-hidden shadow-2xl">
                
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#141414]">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <ImageIcon className="text-purple-500" /> Bibliothèque de Styles
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">Sélectionne une image pour que l'IA copie son design (couleurs, formes, layout).</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-6 bg-[#0a0a0a]">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        
                        {/* Upload Card */}
                        <label className="aspect-video border-2 border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group relative">
                            {isUploading ? (
                                <Loader className="animate-spin text-purple-500" />
                            ) : (
                                <>
                                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-2 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                                        <Plus size={24} />
                                    </div>
                                    <span className="text-xs font-medium text-gray-400 group-hover:text-white">Ajouter Image</span>
                                </>
                            )}
                            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                        </label>

                        {/* Images List */}
                        {images.map((img) => {
                            const isSelected = selectedImageId === img.id;
                            return (
                                <div 
                                    key={img.id} 
                                    onClick={() => onSelect(isSelected ? null : img)}
                                    className={`relative group rounded-xl overflow-hidden border-2 transition-all cursor-pointer aspect-video bg-black ${
                                        isSelected
                                        ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.2)]' 
                                        : 'border-white/5 hover:border-white/20'
                                    }`}
                                >
                                    <img src={img.base64} alt={img.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                    
                                    {/* Info Overlay */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                                        <p className="text-xs text-white truncate font-medium">{img.name}</p>
                                    </div>

                                    {/* Selected Badge */}
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 bg-purple-500 text-white p-1.5 rounded-full shadow-lg z-10 animate-in zoom-in">
                                            <CheckCircle size={16} fill="currentColor" />
                                        </div>
                                    )}

                                    {/* Delete Button */}
                                    <button 
                                        onClick={(e) => handleDelete(e, img.id)}
                                        className="absolute top-2 left-2 bg-red-500/90 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all z-20"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/5 bg-[#141414] flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{images.length} styles disponibles</span>
                    </div>
                    <button 
                        onClick={onClose}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-colors ${
                            selectedImageId 
                            ? 'bg-purple-600 text-white hover:bg-purple-500' 
                            : 'bg-white text-black hover:bg-gray-200'
                        }`}
                    >
                        {selectedImageId ? 'Valider la Sélection' : 'Fermer'}
                    </button>
                </div>
            </div>
        </div>
    );
                     }
