"use client";

import React, { useState, useEffect, useCallback } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import { openDB } from "idb";

// ── Firebase config (même que dans page.tsx) ─────────────────────────────────
const _fbApp =
  getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey: "AIzaSyCXpAhtaaQsBrNcMBMvKaGRgYQkYg88buY",
        authDomain: "studio-code-4c7d1.firebaseapp.com",
        projectId: "studio-code-4c7d1",
        storageBucket: "studio-code-4c7d1.firebasestorage.app",
        messagingSenderId: "988099987755",
        appId: "1:988099987755:web:49848934cfdb81ed3d1d6e",
      });
const _auth = getAuth(_fbApp);
const _db = getFirestore(_fbApp);

// ── Seul email autorisé ───────────────────────────────────────────────────────
const ADMIN_EMAIL = "ludovicaymar8@gmail.com";

// ── Firestore collections ─────────────────────────────────────────────────────
const VIBES_COL = "vibes_selection";   // doc par image : { name, category, selected, path }
const CATS_DOC  = "vibes_categories";  // doc unique : { categories: string[] }

// ── IndexedDB helper (même DB que indexedDB.ts) ───────────────────────────────
const IDB_NAME  = "vibe-coding-db";
const IDB_STORE = "vibes";

async function getIDB() {
  return openDB(IDB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(IDB_STORE))
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
    },
  });
}

async function syncToIDB(selected: VibeItem[]) {
  const db = await getIDB();
  const tx = db.transaction(IDB_STORE, "readwrite");
  await tx.store.clear();
  for (const v of selected) {
    // Fetch the image from /public and convert to base64
    try {
      const res = await fetch(v.path);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      await tx.store.put({ id: v.id, base64, category: v.category, createdAt: Date.now() });
    } catch {
      // silently skip images that fail to load
    }
  }
  await tx.done;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface VibeItem {
  id: string;         // e.g. "hero-bg.jpg"
  name: string;       // display name
  path: string;       // e.g. "/images/hero-bg.jpg" (relative to /public)
  category: string;
  selected: boolean;
}

// ── List of images available in /public ──────────────────────────────────────
// We read them from a static manifest file (app/vibes/manifest.json) that you
// keep updated, OR we fallback to a hardcoded list.
// To generate manifest.json automatically: add a script to package.json that
// scans the /public folder and writes app/vibes/manifest.json.
async function loadPublicImages(): Promise<{ name: string; path: string }[]> {
  try {
    const res = await fetch("/vibes-manifest.json");
    if (res.ok) return await res.json();
  } catch {}
  // Fallback: scan common extensions by attempting to load a known list
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VibesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [items, setItems] = useState<VibeItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(false);

  // ── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(_auth, (u) => {
      setUser(u?.email === ADMIN_EMAIL ? u : null);
      setAuthLoading(false);
    });
  }, []);

  // ── Load data from Firestore ───────────────────────────────────────────────
  const loadFromFirestore = useCallback(async (publicImgs: { name: string; path: string }[]) => {
    // Load categories
    const catSnap = await getDoc(doc(_db, "config", CATS_DOC));
    const savedCats: string[] = catSnap.exists() ? (catSnap.data().categories ?? []) : ["UI", "Background", "Icons"];
    setCategories(savedCats);

    // Load selection
    const selSnap = await getDocs(collection(_db, VIBES_COL));
    const saved: Record<string, { category: string; selected: boolean }> = {};
    selSnap.forEach((d) => { saved[d.id] = d.data() as any; });

    const merged: VibeItem[] = publicImgs.map((img) => ({
      id: img.name,
      name: img.name,
      path: img.path,
      category: saved[img.name]?.category ?? (savedCats[0] ?? "UI"),
      selected: saved[img.name]?.selected ?? false,
    }));
    setItems(merged);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadPublicImages().then((imgs) => loadFromFirestore(imgs));
  }, [user, loadFromFirestore]);

  // ── Toggle selection ───────────────────────────────────────────────────────
  const toggleItem = (id: string) => {
    setItems((prev) => prev.map((v) => v.id === id ? { ...v, selected: !v.selected } : v));
    setSynced(false);
  };

  const setCategory = (id: string, cat: string) => {
    setItems((prev) => prev.map((v) => v.id === id ? { ...v, category: cat } : v));
    setSynced(false);
  };

  // ── Save to Firestore + sync IndexedDB ─────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      // Save categories
      await setDoc(doc(_db, "config", CATS_DOC), { categories });
      // Save each item
      await Promise.all(
        items.map((v) =>
          setDoc(doc(_db, VIBES_COL, v.id), {
            name: v.name,
            path: v.path,
            category: v.category,
            selected: v.selected,
          })
        )
      );
      // Sync selected items to local IndexedDB
      await syncToIDB(items.filter((v) => v.selected));
      setSynced(true);
    } finally {
      setSaving(false);
    }
  };

  // ── Add category ───────────────────────────────────────────────────────────
  const addCategory = () => {
    const name = newCatName.trim();
    if (!name || categories.includes(name)) return;
    setCategories((p) => [...p, name]);
    setNewCatName("");
    setSynced(false);
  };

  const removeCategory = (cat: string) => {
    setCategories((p) => p.filter((c) => c !== cat));
    // move items in this category to first category
    const fallback = categories.find((c) => c !== cat) ?? "UI";
    setItems((prev) => prev.map((v) => v.category === cat ? { ...v, category: fallback } : v));
    setSynced(false);
  };

  const selectedCount = items.filter((v) => v.selected).length;
  const filtered = filter === "all" ? items : items.filter((v) => v.category === filter);

  // ── Login screen ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f4ed]">
        <div className="w-5 h-5 border-2 border-[#37322F]/20 border-t-[#37322F]/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f4ed] p-4">
        <div className="w-full max-w-[340px] bg-white rounded-2xl border border-[rgba(55,50,47,0.12)] shadow-sm p-8 flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className="w-10 h-10 bg-[#37322F] rounded-xl flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M10 4v12" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <p className="text-base font-bold text-[#37322F]">Vibes Admin</p>
            <p className="text-xs text-[#37322F]/40">Restricted access</p>
          </div>
          <input
            type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none focus:border-[rgba(55,50,47,0.4)]"
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
            className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none focus:border-[rgba(55,50,47,0.4)]"
          />
          {authError && <p className="text-xs text-red-500 -mt-2">{authError}</p>}
          <button
            onClick={handleLogin}
            className="h-10 bg-[#37322F] hover:bg-[rgba(55,50,47,0.85)] text-white rounded-xl text-sm font-semibold"
          >
            Sign in
          </button>
        </div>
      </div>
    );

    async function handleLogin() {
      setAuthError("");
      try {
        const cred = await signInWithEmailAndPassword(_auth, email, password);
        if (cred.user.email !== ADMIN_EMAIL) {
          await signOut(_auth);
          setAuthError("Access denied.");
        }
      } catch (e: any) {
        setAuthError(e.message);
      }
    }
  }

  // ── Admin UI ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f7f4ed] p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#37322F]">Vibes Admin</h1>
          <p className="text-xs text-[#37322F]/50 mt-0.5">{selectedCount} image{selectedCount !== 1 ? "s" : ""} selected · {items.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-8 px-4 bg-[#37322F] hover:bg-[rgba(55,50,47,0.85)] disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            {saving ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/><path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
            ) : synced ? (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 7l3 3 7-6" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : null}
            {saving ? "Saving…" : synced ? "Saved" : "Save & Sync"}
          </button>
          <button onClick={() => signOut(_auth)} className="h-8 px-3 text-xs text-[#37322F]/50 hover:text-[#37322F] border border-[rgba(55,50,47,0.12)] rounded-lg">
            Sign out
          </button>
        </div>
      </div>

      {/* Categories manager */}
      <div className="bg-white rounded-xl border border-[rgba(55,50,47,0.10)] p-4 mb-6">
        <p className="text-xs font-semibold text-[#37322F]/50 uppercase tracking-widest mb-3">Categories</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map((cat) => (
            <span key={cat} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(55,50,47,0.07)", color: "#37322F" }}>
              {cat}
              <button onClick={() => removeCategory(cat)} className="text-[#37322F]/30 hover:text-[#37322F]/70 ml-0.5">✕</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text" placeholder="New category…" value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            className="flex-1 h-8 px-3 rounded-lg border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none"
          />
          <button onClick={addCategory} className="h-8 px-3 bg-[#37322F] text-white rounded-lg text-xs font-semibold">Add</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["all", ...categories].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className="h-7 px-3 rounded-full text-xs font-semibold transition-all"
            style={{
              background: filter === cat ? "#37322F" : "rgba(55,50,47,0.07)",
              color: filter === cat ? "#fff" : "rgba(55,50,47,0.6)",
            }}
          >
            {cat === "all" ? "All" : cat}
          </button>
        ))}
      </div>

      {/* Images grid */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-[#37322F]/40">
          <p className="text-sm font-medium mb-1">No images found</p>
          <p className="text-xs">Add a <code className="bg-[rgba(55,50,47,0.08)] px-1 rounded">public/vibes-manifest.json</code> file listing your images.</p>
          <p className="text-xs mt-1 opacity-70">Format: <code className="bg-[rgba(55,50,47,0.08)] px-1 rounded">{"[{\"name\":\"bg.jpg\",\"path\":\"/images/bg.jpg\"}]"}</code></p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map((v) => (
            <div
              key={v.id}
              className="relative rounded-xl overflow-hidden cursor-pointer group"
              style={{ border: v.selected ? "2px solid #37322F" : "2px solid transparent", background: "rgba(55,50,47,0.06)" }}
              onClick={() => toggleItem(v.id)}
            >
              {/* Image */}
              <div className="aspect-square w-full overflow-hidden">
                <img
                  src={v.path}
                  alt={v.name}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>

              {/* Selected checkmark */}
              {v.selected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-[#37322F] rounded-full flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              )}

              {/* Bottom bar */}
              <div className="p-1.5" onClick={(e) => e.stopPropagation()}>
                <p className="text-[10px] font-medium text-[#37322F]/60 truncate mb-1">{v.name}</p>
                <select
                  value={v.category}
                  onChange={(e) => setCategory(v.id, e.target.value)}
                  className="w-full text-[10px] bg-white/70 border border-[rgba(55,50,47,0.12)] rounded-md px-1 py-0.5 text-[#37322F] outline-none"
                >
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
