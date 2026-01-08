'use client';

import { useState, useEffect } from 'react';
import { saveImageToVibe, getAllVibes, deleteVibe } from '@/lib/indexedDB';

export default function VibeStudio() {
  const [images, setImages] = useState<any[]>([]);
  // État pour la catégorie sélectionnée lors de l'upload
  const [selectedCategory, setSelectedCategory] = useState<'landing' | 'app' | 'login' | 'other'>('landing');

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    const vibes = await getAllVibes();
    setImages(vibes.sort((a, b) => b.createdAt - a.createdAt));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      // On passe la catégorie sélectionnée
      await saveImageToVibe(e.target.files[0], selectedCategory);
      await loadImages();
    }
  };

  return (
    <div className="p-10 max-w-5xl mx-auto font-sans">
      <h1 className="text-3xl font-bold mb-6">Vibe Coding Studio</h1>
      <p className="mb-8 text-gray-600">
        Ajoutez ici des captures d'écran.
        L'IA sélectionnera automatiquement les images correspondantes (Landing vs App) selon la demande.
      </p>

      {/* ZONE D'UPLOAD AVEC SELECTEUR */}
      <div className="mb-10 bg-gray-50 p-6 rounded-xl border border-gray-100 flex items-end gap-4">
        <div>
          <label className="block text-xs font-bold uppercase text-gray-500 mb-2">Catégorie de l'image</label>
          <select 
            value={selectedCategory} 
            onChange={(e) => setSelectedCategory(e.target.value as any)}
            className="px-4 py-3 rounded-lg border border-gray-300 bg-white"
          >
            <option value="landing">Landing Page</option>
            <option value="app">Application / Dashboard</option>
            <option value="login">Login / Signup</option>
            <option value="other">Autre</option>
          </select>
        </div>

        <label className="bg-black text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-gray-800 transition shadow-lg">
          + Uploader l'image
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        </label>
      </div>
      
      {/* GRILLE D'IMAGES */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {images.map((img) => (
          <div key={img.id} className="relative group border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            {/* Badge de catégorie */}
            <div className="absolute top-2 left-2 bg-white/90 backdrop-blur px-2 py-1 text-[10px] font-bold uppercase rounded shadow-sm z-10">
              {img.category || 'other'}
            </div>
            
            <img src={img.base64} alt="Vibe" className="w-full h-56 object-cover" />
            
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button 
                onClick={async () => { 
                  if(confirm("Supprimer cette inspiration ?")) {
                    await deleteVibe(img.id); 
                    loadImages(); 
                  }
                }}
                className="bg-white text-red-600 font-medium px-4 py-2 rounded-full shadow-lg hover:bg-red-50 transition-colors"
              >
                Retirer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
      }
