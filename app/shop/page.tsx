"use client"

import React, { useEffect, useState, useRef } from 'react';
import { Image as ImageIcon, Plus, Trash2, ArrowLeft, Loader, ShoppingBag, Link as LinkIcon, CheckCircle, X, Terminal, Copy, AlertTriangle, RefreshCcw } from 'lucide-react';
import Link from 'next/link';

// --- LOGIQUE DB DÉDIÉE ---
const IMAGES_DB_NAME = 'StudioCode_Assets';
const IMAGES_DB_VERSION = 2; // 🔥 PASSAGE EN V2 POUR CORRIGER L'ERREUR DE STORE MANQUANT

// Interface pour les logs
interface LogEntry {
    id: string;
    timestamp: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

const initImageDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGES_DB_NAME, IMAGES_DB_VERSION);
    
    request.onerror = () => reject(new Error(`DB Open Error: ${request.error?.message}`));
    
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Création ou vérification des stores
      if (!db.objectStoreNames.contains('refs')) {
        db.createObjectStore('refs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
  });
};

// Fonction d'urgence pour tout effacer si "NO SPACE"
const hardResetDB = async () => {
    return new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(IMAGES_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => console.warn("DB Delete Blocked: Fermez les autres onglets.");
    });
};

const saveRefImage = async (img: { id: string, name: string, base64: string }) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('refs', 'readwrite');
    const store = tx.objectStore('refs');
    const request = store.put({ ...img, createdAt: Date.now() });
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Save Image Error: ${tx.error?.message}`));
  });
};

const getRefImages = async (): Promise<any[]> => {
  const db = await initImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('refs', 'readonly');
    const store = tx.objectStore('refs');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(new Error(`Get Images Error: ${request.error?.message}`));
  });
};

const deleteRefImage = async (id: string) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('refs', 'readwrite');
    const store = tx.objectStore('refs');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Delete Error: ${tx.error?.message}`));
  });
};

const saveCssUrl = async (url: string) => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put(url, 'master_css_url');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Save URL Error: ${tx.error?.message}`));
  });
};

const getCssUrl = async (): Promise<string | null> => {
  const db = await initImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('master_css_url');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error(`Get URL Error: ${request.error?.message}`));
  });
};

const deleteCssUrl = async () => {
  const db = await initImageDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.delete('master_css_url');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Delete URL Error: ${tx.error?.message}`));
  });
};

// --- COMPOSANT PAGE ---

export default function ShopPage() {
    const [images, setImages] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [cssUrl, setCssUrl] = useState("");
    const [savedCssUrl, setSavedCssUrl] = useState<string | null>(null);
    const [isSavingUrl, setIsSavingUrl] = useState(false);
    
    // --- SYSTEME DE LOGS ---
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
        const id = Math.random().toString(36).substr(2, 9);
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { id, timestamp, message, type }]);
    };

    // Scroll automatique des logs
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);

    // Chargement initial
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            addLog("Connexion à la DB (V2)...", "info");
            const imgs = await getRefImages();
            setImages(imgs.sort((a, b) => b.createdAt - a.createdAt));
            
            const url = await getCssUrl();
            if (url) {
                setCssUrl(url);
                setSavedCssUrl(url);
            }
            addLog(`${imgs.length} images chargées avec succès.`, "success");
        } catch (e: any) { 
            addLog(`Erreur critique DB: ${e.message}`, "error");
            if (e.message.includes("store")) {
                addLog("⚠️ La structure de la DB semble corrompue. Essayez le bouton 'Réinitialiser' en bas.", "warning");
            }
        }
    };

    const handleResetDB = async () => {
        if (confirm("ATTENTION : Cela va effacer toutes les images du Shop pour réparer l'erreur 'No Space' ou 'Store Not Found'. Continuer ?")) {
            try {
                addLog("Suppression de la base de données...", "warning");
                await hardResetDB();
                addLog("Base supprimée. Rechargement de la page...", "success");
                setTimeout(() => window.location.reload(), 1000);
            } catch (e: any) {
                addLog(`Erreur Reset: ${e.message}`, "error");
            }
        }
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        addLog(`Upload: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`, "info");
        setIsUploading(true);
        
        const reader = new FileReader();
        
        reader.onerror = () => {
            addLog("Erreur lecture fichier", "error");
            setIsUploading(false);
        };

        reader.onloadend = async () => {
            try {
                const img = new Image();
                img.src = reader.result as string;
                
                img.onload = async () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        // On réduit encore un peu la taille pour éviter le "NO SPACE"
                        const scale = Math.min(1, 800 / img.width); 
                        canvas.width = img.width * scale;
                        canvas.height = img.height * scale;
                        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                        
                        // Compression plus agressive (0.6) pour économiser de la place
                        const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.6);
                        
                        const newImage = {
                            id: crypto.randomUUID(),
                            name: file.name,
                            base64: optimizedBase64
                        };
                        
                        await saveRefImage(newImage);
                        await loadData();
                        addLog("Image sauvegardée !", "success");
                    } catch (innerErr: any) {
                        addLog(`Erreur Save: ${innerErr.message}`, "error");
                        if (innerErr.message.includes("QUOTA") || innerErr.message.includes("SPACE")) {
                            addLog("🚨 DISQUE PLEIN ! Utilisez le bouton 'Réinitialiser' en bas.", "error");
                        }
                    } finally {
                        setIsUploading(false);
                    }
                };
            } catch (err: any) {
                addLog(`Exception: ${err.message}`, "error");
                setIsUploading(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleDeleteImage = async (id: string) => {
        if (confirm("Supprimer ce style ?")) {
            try {
                await deleteRefImage(id);
                await loadData();
                addLog("Image supprimée.", "success");
            } catch (e: any) {
                addLog(`Erreur suppression: ${e.message}`, "error");
            }
        }
    };

    const handleSaveUrl = async () => {
        if (!cssUrl.trim()) return;
        setIsSavingUrl(true);
        try {
            await saveCssUrl(cssUrl);
            setSavedCssUrl(cssUrl);
            addLog("URL CSS sauvegardée.", "success");
        } catch (e: any) {
            addLog(`Erreur URL: ${e.message}`, "error");
        } finally {
            setIsSavingUrl(false);
        }
    };

    const handleDeleteUrl = async () => {
        if (confirm("Supprimer l'URL ?")) {
            try {
                await deleteCssUrl();
                setCssUrl("");
                setSavedCssUrl(null);
                addLog("URL supprimée.", "success");
            } catch (e: any) {
                addLog(`Erreur: ${e.message}`, "error");
            }
        }
    };

    const handleCopyLogs = () => {
        const textLogs = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
        navigator.clipboard.writeText(textLogs);
        addLog("Logs copiés !", "success");
    };

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10 font-sans flex flex-col">
            
            <div className="max-w-7xl mx-auto w-full mb-10">
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

                {/* URL CSS Section */}
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
                            disabled={isSavingUrl}
                            className={`px-6 py-3 bg-white text-black rounded-lg text-sm font-bold hover:bg-gray-200 transition-colors min-w-[100px] flex justify-center ${isSavingUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isSavingUrl ? <Loader size={18} className="animate-spin"/> : 'Sauvegarder'}
                        </button>
                        {savedCssUrl && (
                            <button onClick={handleDeleteUrl} className="p-3 border border-red-500/20 text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"><Trash2 size={18} /></button>
                        )}
                    </div>
                </div>

                {/* Images Section */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <ImageIcon className="text-purple-500" /> Références Visuelles
                    </h2>
                    <label className={`flex items-center gap-2 px-5 py-2 bg-[#111] border border-white/10 text-white rounded-lg font-medium cursor-pointer hover:bg-[#222] transition-colors ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        {isUploading ? <Loader className="animate-spin" size={16} /> : <Plus size={16} />}
                        <span className="text-sm">Ajouter Image</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                    </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {images.map((img) => (
                        <div key={img.id} className="group relative aspect-[4/3] rounded-2xl overflow-hidden border-2 border-white/5 hover:border-white/20 transition-all duration-300 bg-[#111]">
                            <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <p className="font-bold text-white truncate text-sm">{img.name}</p>
                            </div>
                            <button onClick={() => handleDeleteImage(img.id)} className="absolute top-3 right-3 p-2 bg-black/50 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"><Trash2 size={16} /></button>
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

            {/* --- CONSOLE DE DEBUG & RESET --- */}
            <div className="mt-auto border-t border-white/10 pt-4">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-mono text-gray-500 flex items-center gap-2">
                        <Terminal size={12} /> Console Système
                    </h3>
                    <div className="flex gap-2">
                        <button onClick={handleResetDB} className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 bg-red-900/10 border border-red-900/30 px-2 py-1 rounded">
                            <RefreshCcw size={10} /> Réinitialiser (Urgence)
                        </button>
                        <button onClick={handleCopyLogs} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white bg-white/5 px-2 py-1 rounded">
                            <Copy size={10} /> Copier logs
                        </button>
                    </div>
                </div>
                <div className="h-32 bg-black rounded-lg border border-white/10 p-2 overflow-y-auto font-mono text-[10px] space-y-1">
                    {logs.length === 0 && <span className="text-gray-700 italic">En attente...</span>}
                    {logs.map((log) => (
                        <div key={log.id} className={`flex gap-2 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : log.type === 'warning' ? 'text-yellow-400' : 'text-gray-400'}`}>
                            <span className="opacity-50 flex-shrink-0">[{log.timestamp}]</span>
                            <span className="break-all">{log.message}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>

        </div>
    );
                                             }
