'use client';

import { useState, useEffect } from 'react';
import { saveImageToVibe, getAllVibes, deleteVibe } from '@/lib/indexedDB';

export default function VibeStudio() {
  const [images, setImages] = useState<any[]>([]);

  useEffect(() => {
    loadImages();
  }, []);

  const loadImages = async () => {
    const vibes = await getAllVibes();
    // Tri par date décroissante pour voir les derniers ajouts
    setImages(vibes.sort((a, b) => b.createdAt - a.createdAt));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await saveImageToVibe(e.target.files[0]);
      await loadImages();
    }
  };

  return (
    <div className="p-10 max-w-4xl mx-auto font-sans">
      <h1 className="text-3xl font-bold mb-6">Vibe Coding Studio</h1>
      <p className="mb-8 text-gray-600">
        Ajoutez ici des captures d'écran (Mobbin, Dribbble). 
        L'IA en piochera <span className="font-bold text-black">4 au hasard</span> à chaque message 
        pour inventer un style unique.
      </p>

      <div className="mb-8">
        <label className="bg-black text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-gray-800 transition">
          + Ajouter une inspiration
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        </label>
      </div>

      
<div className="grid grid-cols-2 md:grid-cols-4 gap-6">
  {images.map((img) => (
    <div key={img.id} className="relative group border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <img src={img.base64} alt="Vibe" className="w-full h-56 object-cover" />
      
      {/* Overlay de suppression au survol */}
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
          Retirer l'image
        </button>
      </div>
    </div>
  ))}
</div>
    </div>
  );
    }
