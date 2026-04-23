"use client";
import React, { useEffect, useRef, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";

// ── Firebase init (même config que page.tsx) ──────────────────────────────────
const _fbApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        apiKey: "AIzaSyAVoDcDQJyPkHj5SAzdeUDqg3GbSV3Xu1U",
        authDomain: "myapp-cbf8d.firebaseapp.com",
        projectId: "myapp-cbf8d",
        storageBucket: "myapp-cbf8d.firebasestorage.app",
        messagingSenderId: "215809852481",
        appId: "1:215809852481:web:32035e4ac0a4700b0d32c0",
        measurementId: "G-C49XQRMEQL",
      });

const _auth = getAuth(_fbApp);
const _db = getFirestore(_fbApp);
const _storage = getStorage(_fbApp);
const _googleProvider = new GoogleAuthProvider();

// ── Types ─────────────────────────────────────────────────────────────────────
interface SlideItem {
  id: string;
  imageUrl: string;
  storagePath: string;
  title: string;
  category: string;
  order: number;
  createdAt: number;
}

// ── Catégories disponibles ────────────────────────────────────────────────────
const CATEGORIES = [
  "SaaS App",
  "E-commerce",
  "Landing Page",
  "Dashboard",
  "Mobile App",
  "Portfolio",
  "Blog",
  "Social Media",
  "Marketplace",
  "Autre",
];

// ── Composant principal ───────────────────────────────────────────────────────
export default function SliderAdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Toast auto-dismiss ───────────────────────────────────────────────────────
  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Auth listener ────────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(_auth, (u) => setUser(u));
  }, []);

  // ── Slides listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(
      collection(_db, "showcase_slides"),
      orderBy("order", "asc")
    );
    return onSnapshot(q, (snap) => {
      setSlides(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as SlideItem))
      );
    });
  }, []);

  // ── File selection ───────────────────────────────────────────────────────────
  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      showToast("Seules les images sont acceptées.", "err");
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      showToast("Image trop lourde (max 8 Mo).", "err");
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Upload ───────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file || !title.trim()) {
      showToast("Titre et image requis.", "err");
      return;
    }
    const finalCategory = category === "Autre" ? customCategory.trim() || "Autre" : category;

    setUploading(true);
    setUploadProgress(0);

    try {
      const ext = file.name.split(".").pop();
      const path = `showcase_slides/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const sRef = storageRef(_storage, path);
      const task = uploadBytesResumable(sRef, file);

      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (snap) => {
            setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          },
          reject,
          resolve
        );
      });

      const imageUrl = await getDownloadURL(sRef);
      await addDoc(collection(_db, "showcase_slides"), {
        imageUrl,
        storagePath: path,
        title: title.trim(),
        category: finalCategory,
        order: slides.length,
        createdAt: Date.now(),
      });

      showToast("✅ Slide ajouté avec succès !");
      setFile(null);
      setPreview(null);
      setTitle("");
      setCategory(CATEGORIES[0]);
      setCustomCategory("");
      setUploadProgress(0);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      showToast("❌ Erreur upload : " + err.message, "err");
    } finally {
      setUploading(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (slide: SlideItem) => {
    if (!confirm(`Supprimer "${slide.title}" ?`)) return;
    try {
      await deleteDoc(doc(_db, "showcase_slides", slide.id));
      if (slide.storagePath) {
        try {
          await deleteObject(storageRef(_storage, slide.storagePath));
        } catch {}
      }
      showToast("Slide supprimé.");
    } catch (err: any) {
      showToast("Erreur suppression : " + err.message, "err");
    }
  };

  // ── Inline edit ──────────────────────────────────────────────────────────────
  const startEdit = (slide: SlideItem) => {
    setEditingId(slide.id);
    setEditTitle(slide.title);
    setEditCategory(slide.category);
  };
  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(_db, "showcase_slides", id), {
        title: editTitle.trim(),
        category: editCategory.trim(),
      });
      setEditingId(null);
      showToast("Modifié !");
    } catch (err: any) {
      showToast("Erreur : " + err.message, "err");
    }
  };

  // ── Reorder (up/down) ────────────────────────────────────────────────────────
  const moveSlide = async (idx: number, dir: -1 | 1) => {
    const newSlides = [...slides];
    const target = idx + dir;
    if (target < 0 || target >= newSlides.length) return;
    [newSlides[idx], newSlides[target]] = [newSlides[target], newSlides[idx]];
    await Promise.all([
      updateDoc(doc(_db, "showcase_slides", newSlides[idx].id), { order: idx }),
      updateDoc(doc(_db, "showcase_slides", newSlides[target].id), { order: target }),
    ]);
  };

  // ── Auth guard ───────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-[#f8f7f3] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-[rgba(55,50,47,0.1)] p-10 flex flex-col items-center gap-5 w-full max-w-sm">
          <div className="w-12 h-12 rounded-full bg-[#37322F] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="white" strokeWidth="1.8"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#37322F]">Admin — Slider</h1>
          <p className="text-sm text-[rgba(55,50,47,0.5)] text-center">Connecte-toi avec le compte Google autorisé pour gérer les slides.</p>
          <button
            onClick={() => signInWithPopup(_auth, _googleProvider)}
            className="w-full h-11 bg-[#37322F] text-white rounded-xl font-semibold text-sm hover:bg-[rgba(55,50,47,0.85)] transition-colors flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="white"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="white"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="white"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="white"/>
            </svg>
            Connexion Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7f3] font-sans text-[#37322F]">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white transition-all animate-in slide-in-from-top-3 ${
            toast.type === "ok" ? "bg-[#37322F]" : "bg-red-500"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-[rgba(55,50,47,0.08)] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#37322F] flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 30 30" fill="none">
              <ellipse cx="15" cy="15" rx="12" ry="6" fill="white" transform="rotate(-18 15 15)" />
            </svg>
          </div>
          <span className="font-bold text-[15px]">Slider Admin</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[rgba(55,50,47,0.08)] text-[rgba(55,50,47,0.5)] font-medium">
            {slides.length} slide{slides.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[rgba(55,50,47,0.5)] hidden sm:block">
            {user.displayName || user.email}
          </span>
          <button
            onClick={() => signOut(_auth)}
            className="text-xs px-3 py-1.5 rounded-lg border border-[rgba(55,50,47,0.12)] hover:bg-[rgba(55,50,47,0.06)] transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">

        {/* ── Upload form ─────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-[rgba(55,50,47,0.1)] shadow-sm p-6 flex flex-col gap-5">
          <h2 className="font-bold text-base">Ajouter un slide</h2>

          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
              dragging
                ? "border-[#37322F] bg-[rgba(55,50,47,0.04)]"
                : "border-[rgba(55,50,47,0.15)] hover:border-[rgba(55,50,47,0.35)]"
            }`}
            style={{ minHeight: 180 }}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {preview ? (
              <div className="relative w-full rounded-xl overflow-hidden" style={{ aspectRatio: "16/7" }}>
                <img src={preview} alt="preview" className="w-full h-full object-cover" />
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors text-sm"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-12 gap-2 pointer-events-none">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-[rgba(55,50,47,0.3)]">
                  <path d="M12 16V8M12 8L9 11M12 8l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M20 16.7A4 4 0 0 0 18 9h-1.26A7 7 0 1 0 4 15.65" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                <p className="text-sm font-medium text-[rgba(55,50,47,0.5)]">Glisse une image ici ou clique pour choisir</p>
                <p className="text-xs text-[rgba(55,50,47,0.3)]">JPG, PNG, WebP — max 8 Mo</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[rgba(55,50,47,0.5)] uppercase tracking-wider">Titre</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: Dashboard Analytics Pro"
                className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] bg-[#f8f7f3] text-sm outline-none focus:border-[rgba(55,50,47,0.4)] transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[rgba(55,50,47,0.5)] uppercase tracking-wider">Catégorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] bg-[#f8f7f3] text-sm outline-none focus:border-[rgba(55,50,47,0.4)] transition-colors appearance-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {category === "Autre" && (
            <input
              type="text"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Nom de la catégorie personnalisée"
              className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] bg-[#f8f7f3] text-sm outline-none focus:border-[rgba(55,50,47,0.4)] transition-colors"
            />
          )}

          {/* Progress bar */}
          {uploading && (
            <div className="w-full h-1.5 rounded-full bg-[rgba(55,50,47,0.08)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#37322F] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={uploading || !file || !title.trim()}
            className="h-11 rounded-xl bg-[#37322F] text-white font-semibold text-sm hover:bg-[rgba(55,50,47,0.85)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Envoi en cours… {uploadProgress}%
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 16V8M12 8L9 11M12 8l3 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>
                Ajouter au slider
              </>
            )}
          </button>
        </section>

        {/* ── Slides list ──────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          <h2 className="font-bold text-base">
            Slides actuels
            <span className="ml-2 text-xs font-medium text-[rgba(55,50,47,0.4)]">
              (glisser les flèches pour réordonner)
            </span>
          </h2>

          {slides.length === 0 && (
            <div className="bg-white rounded-2xl border border-[rgba(55,50,47,0.08)] p-10 text-center text-sm text-[rgba(55,50,47,0.4)]">
              Aucun slide pour l'instant. Ajoute-en un ci-dessus !
            </div>
          )}

          <div className="flex flex-col gap-3">
            {slides.map((slide, idx) => (
              <div
                key={slide.id}
                className="bg-white rounded-2xl border border-[rgba(55,50,47,0.1)] shadow-sm overflow-hidden flex flex-col sm:flex-row"
              >
                {/* Thumbnail */}
                <div className="w-full sm:w-48 flex-shrink-0 bg-[#f0ede5]" style={{ aspectRatio: "16/7" }}>
                  <img
                    src={slide.imageUrl}
                    alt={slide.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                {/* Info / edit */}
                <div className="flex-1 p-4 flex flex-col gap-2 min-w-0">
                  {editingId === slide.id ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="h-9 px-3 rounded-lg border border-[rgba(55,50,47,0.2)] text-sm bg-[#f8f7f3] outline-none"
                        placeholder="Titre"
                      />
                      <input
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="h-9 px-3 rounded-lg border border-[rgba(55,50,47,0.2)] text-sm bg-[#f8f7f3] outline-none"
                        placeholder="Catégorie"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(slide.id)}
                          className="h-8 px-4 rounded-lg bg-[#37322F] text-white text-xs font-semibold hover:bg-[rgba(55,50,47,0.85)] transition-colors"
                        >
                          Sauvegarder
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="h-8 px-4 rounded-lg border border-[rgba(55,50,47,0.15)] text-xs font-medium hover:bg-[rgba(55,50,47,0.04)] transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="font-semibold text-sm truncate">{slide.title}</p>
                        <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-widest text-[rgba(55,50,47,0.5)] bg-[rgba(55,50,47,0.07)] rounded-full px-2 py-0.5">
                          {slide.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-[rgba(55,50,47,0.35)]">
                        Ordre : {slide.order} · Ajouté le {new Date(slide.createdAt).toLocaleDateString("fr-FR")}
                      </p>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex sm:flex-col items-center justify-end gap-1 p-3 border-t sm:border-t-0 sm:border-l border-[rgba(55,50,47,0.07)]">
                  {/* Move up */}
                  <button
                    onClick={() => moveSlide(idx, -1)}
                    disabled={idx === 0}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(55,50,47,0.06)] transition-colors disabled:opacity-30"
                    title="Monter"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 5L5 12M12 5l7 7" stroke="#37322F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {/* Move down */}
                  <button
                    onClick={() => moveSlide(idx, 1)}
                    disabled={idx === slides.length - 1}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(55,50,47,0.06)] transition-colors disabled:opacity-30"
                    title="Descendre"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M12 19l7-7M12 19l-7-7" stroke="#37322F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {/* Edit */}
                  <button
                    onClick={() => startEdit(slide)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[rgba(55,50,47,0.06)] transition-colors"
                    title="Modifier"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#37322F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#37322F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(slide)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 transition-colors"
                    title="Supprimer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6M14 11v6" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Live preview ─────────────────────────────────────────────────── */}
        {slides.length > 0 && (
          <section className="bg-white rounded-2xl border border-[rgba(55,50,47,0.1)] shadow-sm p-6">
            <h2 className="font-bold text-base mb-4">Aperçu live du slider</h2>
            <LiveSliderPreview slides={slides} />
          </section>
        )}
      </main>
    </div>
  );
}

// ── Mini live preview (même logique infinite que le slider principal) ──────────
function LiveSliderPreview({ slides }: { slides: SlideItem[] }) {
  const [index, setIndex] = React.useState(0);
  const [transitioning, setTransitioning] = React.useState(true);
  const autoRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const total = slides.length;
  const displayed = total > 0 ? [slides[total - 1], ...slides, slides[0]] : [];

  const goTo = React.useCallback((fn: (i: number) => number) => {
    setTransitioning(true);
    setIndex(fn);
  }, []);

  React.useEffect(() => {
    if (total < 2) return;
    autoRef.current = setInterval(() => goTo((i) => i + 1), 3500);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [total, goTo]);

  const handleEnd = React.useCallback(() => {
    if (index === total) { setTransitioning(false); setIndex(0); }
    else if (index === -1) { setTransitioning(false); setIndex(total - 1); }
  }, [index, total]);

  const next = () => { if (autoRef.current) clearInterval(autoRef.current); goTo((i) => i + 1); };
  const prev = () => { if (autoRef.current) clearInterval(autoRef.current); goTo((i) => i - 1); };

  return (
    <div className="relative select-none rounded-xl overflow-hidden">
      <div className="overflow-hidden rounded-xl">
        <div
          onTransitionEnd={handleEnd}
          style={{
            display: "flex",
            transform: `translateX(${-(index + 1) * 100}%)`,
            transition: transitioning ? "transform 0.55s cubic-bezier(0.4,0,0.2,1)" : "none",
            willChange: "transform",
          }}
        >
          {displayed.map((s, i) => (
            <div key={`${s.id}-${i}`} className="flex-shrink-0 w-full relative" style={{ aspectRatio: "16/7" }}>
              <img src={s.imageUrl} alt={s.title} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                <span className="inline-block text-[9px] font-bold uppercase tracking-widest text-white/70 bg-white/10 border border-white/20 rounded-full px-2 py-0.5 mb-0.5">{s.category}</span>
                <p className="text-white font-semibold text-xs">{s.title}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-[rgba(0,0,0,0.08)] flex items-center justify-center hover:bg-[#f3f3f1]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="#37322F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white shadow-md border border-[rgba(0,0,0,0.08)] flex items-center justify-center hover:bg-[#f3f3f1]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#37322F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <div className="flex justify-center gap-1.5 mt-2">
        {slides.map((_, i) => (
          <span key={i} className={`rounded-full transition-all duration-300 ${i === ((index % total + total) % total) ? "w-4 h-1.5 bg-[#37322F]" : "w-1.5 h-1.5 bg-[rgba(55,50,47,0.2)]"}`} />
        ))}
      </div>
    </div>
  );
}
