'use client';

import { useState, useEffect } from 'react';
import { saveImageToVibe, getAllVibes, deleteVibe, VibeType } from '@/lib/indexedDB';

export default function VibeStudio() {
  const [goodImages, setGoodImages] = useState<any[]>([]);
  const [badImages, setBadImages] = useState<any[]>([]);

  useEffect(() => {
    refreshAll();
  }, []);

  const refreshAll = async () => {
    // On charge les deux catégories en parallèle
    const [goods, bads] = await Promise.all([
      getAllVibes('good'),
      getAllVibes('bad')
    ]);
    
    // Tri par date (plus récent en premier)
    setGoodImages(goods.sort((a, b) => b.createdAt - a.createdAt));
    setBadImages(bads.sort((a, b) => b.createdAt - a.createdAt));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: VibeType) => {
    if (e.target.files && e.target.files[0]) {
      await saveImageToVibe(e.target.files[0], type);
      await refreshAll();
    }
  };

  const handleDelete = async (id: string, type: VibeType) => {
    if (confirm("Supprimer cette image ?")) {
      await deleteVibe(id, type);
      await refreshAll();
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 p-8 font-sans text-neutral-900">
      <header className="mb-12 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl font-black tracking-tight mb-4">Vibe Coding Studio</h1>
        <p className="text-neutral-600">
          Calibrez l'IA avec vos goûts. Les "Inspirations" sont injectées aléatoirement pour la créativité, 
          les "Anti-Patterns" servent de garde-fous constants.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-7xl mx-auto">
        
        {/* --- COLONNE ANTI-PATTERNS (BAD) --- */}
        <div className="bg-white p-6 rounded-3xl border border-red-100 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-red-600 font-bold flex items-center gap-2">
              ⛔ ANTI-PATTERNS
              <span className="text-xs bg-red-100 px-2 py-1 rounded-full">{badImages.length}</span>
            </h2>
            <label className="bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg cursor-pointer text-sm font-bold transition">
              + Ajouter "Bad"
              <input type="file" accept="image/*" onChange={(e) => handleUpload(e, 'bad')} className="hidden" />
            </label>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {badImages.map((img) => (
              <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-red-50">
                <img src={img.base64} className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 transition" />
                <button 
                  onClick={() => handleDelete(img.id, 'bad')}
                  className="absolute inset-0 bg-red-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-bold transition"
                >
                  Supprimer
                </button>
              </div>
            ))}
            {badImages.length === 0 && <div className="col-span-full py-8 text-center text-gray-400 text-sm italic">Aucun exemple à éviter</div>}
          </div>
        </div>

        {/* --- COLONNE INSPIRATIONS (GOOD) --- */}
        <div className="bg-white p-6 rounded-3xl border border-blue-100 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-blue-600 font-bold flex items-center gap-2">
              ✨ INSPIRATIONS (VIBES)
              <span className="text-xs bg-blue-100 px-2 py-1 rounded-full">{goodImages.length}</span>
            </h2>
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg cursor-pointer text-sm font-bold transition shadow-lg shadow-blue-200">
              + Ajouter Inspiration
              <input type="file" accept="image/*" onChange={(e) => handleUpload(e, 'good')} className="hidden" />
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {goodImages.map((img) => (
              <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                <img src={img.base64} className="w-full h-full object-cover" />
                <button 
                  onClick={() => handleDelete(img.id, 'good')}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-bold transition"
                >
                  Supprimer
                </button>
              </div>
            ))}
             {goodImages.length === 0 && <div className="col-span-full py-8 text-center text-gray-400 text-sm italic">La galerie est vide</div>}
          </div>
        </div>

      </div>
    </div>
  );
                             }
                            
