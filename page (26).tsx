"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, User,
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, getDoc, collection, getDocs,
} from "firebase/firestore";
import { openDB } from "idb";

// ── Firebase ──────────────────────────────────────────────────────────────────
const _fbApp = getApps().length ? getApps()[0] : initializeApp({
  apiKey: "AIzaSyCXpAhtaaQsBrNcMBMvKaGRgYQkYg88buY",
  authDomain: "studio-code-4c7d1.firebaseapp.com",
  projectId: "studio-code-4c7d1",
  storageBucket: "studio-code-4c7d1.firebasestorage.app",
  messagingSenderId: "988099987755",
  appId: "1:988099987755:web:49848934cfdb81ed3d1d6e",
});
const _auth = getAuth(_fbApp);
const _db   = getFirestore(_fbApp);

const ADMIN_EMAIL = "ludovicaymar8@gmail.com";
const VIBES_COL   = "vibes_selection";
const CATS_DOC    = "vibes_categories";

// ── IDB helpers ───────────────────────────────────────────────────────────────
async function getIDB() {
  return openDB("vibe-coding-db", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("vibes"))
        db.createObjectStore("vibes", { keyPath: "id" });
    },
  });
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
async function syncToIDB(selected: VibeItem[]) {
  const db = await getIDB();
  const tx = db.transaction("vibes", "readwrite");
  await tx.store.clear();
  for (const v of selected) {
    let base64 = v.base64 ?? "";
    // Fetch from /public path
    if (!base64 && v.path) {
      try { base64 = await blobToBase64(await (await fetch(v.path)).blob()); } catch {}
    }
    if (base64) await tx.store.put({ id: v.id, base64, category: v.category, createdAt: Date.now() });
  }
  await tx.done;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface VibeItem {
  id: string;      // filename slug e.g. "hero-bg-jpg"
  name: string;    // original filename e.g. "hero-bg.jpg"
  path: string;    // public path e.g. "/images/hero-bg.jpg"
  base64?: string; // cached in memory for IDB sync
  category: string;
  selected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VibesPage() {
  const [user, setUser]               = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [authError, setAuthError]     = useState("");

  const [items, setItems]             = useState<VibeItem[]>([]);
  const [categories, setCategories]   = useState<string[]>(["UI", "Background", "Icons"]);
  const [newCat, setNewCat]           = useState("");
  const [filter, setFilter]           = useState("all");
  const [saving, setSaving]           = useState(false);
  const [synced, setSynced]           = useState(false);
  const [scanning, setScanning]       = useState(false);

  // Auth
  useEffect(() => onAuthStateChanged(_auth, u => {
    setUser(u?.email === ADMIN_EMAIL ? u : null);
    setAuthLoading(false);
  }), []);

  // Load
  const loadData = useCallback(async () => {
    const catSnap = await getDoc(doc(_db, "config", CATS_DOC));
    if (catSnap.exists()) setCategories(catSnap.data().categories ?? ["UI","Background","Icons"]);
    const snap = await getDocs(collection(_db, VIBES_COL));
    const saved: Record<string, { category: string; selected: boolean }> = {};
    snap.forEach(d => { saved[d.id] = d.data() as any; });
    // Scan /public for images via API route
    try {
      const res = await fetch("/api/vibes/scan");
      if (res.ok) {
        const publicImages: { id: string; name: string; path: string }[] = await res.json();
        setItems(publicImages.map(img => ({
          ...img,
          category: saved[img.id]?.category ?? (["UI","Background","Icons"][0]),
          selected: saved[img.id]?.selected ?? false,
        })));
      }
    } catch {}
  }, []);
  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  // Rescan /public for new images
  const scanPublic = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/vibes/scan");
      if (!res.ok) return;
      const publicImages: { id: string; name: string; path: string }[] = await res.json();
      setItems(prev => {
        const existing = Object.fromEntries(prev.map(v => [v.id, v]));
        return publicImages.map(img => ({
          ...img,
          category: existing[img.id]?.category ?? (categories[0] ?? "UI"),
          selected: existing[img.id]?.selected ?? false,
        }));
      });
      setSynced(false);
    } finally { setScanning(false); }
  };

  const toggleItem = async (id: string) => {
    const item = items.find(v => v.id === id);
    if (!item) return;
    const newSelected = !item.selected;
    setItems(p => p.map(v => v.id === id ? { ...v, selected: newSelected } : v));
    // Si on décoche → mettre à jour Firestore immédiatement
    try {
      if (!newSelected) {
        await setDoc(doc(_db, VIBES_COL, id), {
          id, name: item.name, path: item.path,
          category: item.category, selected: false,
        });
      }
    } catch { /* silently fail */ }
    setSynced(false);
  };
  const setCat     = (id: string, cat: string) => { setItems(p => p.map(v => v.id===id ? {...v,category:cat} : v)); setSynced(false); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(_db,"config",CATS_DOC), { categories });
      await Promise.all(items.map(v =>
        setDoc(doc(_db, VIBES_COL, v.id), {
          id: v.id, name: v.name, path: v.path,
          category: v.category, selected: v.selected,
        })
      ));
      await syncToIDB(items.filter(v => v.selected));
      setSynced(true);
    } finally { setSaving(false); }
  };

  const addCat = () => {
    const n = newCat.trim();
    if (!n || categories.includes(n)) return;
    setCategories(p => [...p,n]); setNewCat(""); setSynced(false);
  };
  const removeCat = (cat: string) => {
    const fb = categories.find(c => c!==cat) ?? "UI";
    setCategories(p => p.filter(c => c!==cat));
    setItems(p => p.map(v => v.category===cat ? {...v,category:fb} : v));
    setSynced(false);
  };

  const selectedCount = items.filter(v => v.selected).length;
  const filtered = filter==="all" ? items : items.filter(v => v.category===filter);

  // ── Login ─────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f7f4ed]">
      <div className="w-5 h-5 border-2 border-[#37322F]/20 border-t-[#37322F]/60 rounded-full animate-spin"/>
    </div>
  );

  if (!user) {
    const login = async () => {
      setAuthError("");
      try {
        const c = await signInWithEmailAndPassword(_auth, email, password);
        if (c.user.email !== ADMIN_EMAIL) { await signOut(_auth); setAuthError("Access denied."); }
      } catch (e:any) { setAuthError(e.message); }
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f4ed] p-4">
        <div className="w-full max-w-[340px] bg-white rounded-2xl border border-[rgba(55,50,47,0.12)] shadow-sm p-8 flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className="w-10 h-10 bg-[#37322F] rounded-xl flex items-center justify-center mb-1">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M10 4v12" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <p className="text-base font-bold text-[#37322F]">Vibes Admin</p>
            <p className="text-xs text-[#37322F]/40">Restricted access</p>
          </div>
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}
            className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none"/>
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") login(); }}
            className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none"/>
          {authError && <p className="text-xs text-red-500 -mt-2">{authError}</p>}
          <button onClick={login} className="h-10 bg-[#37322F] hover:bg-[rgba(55,50,47,0.85)] text-white rounded-xl text-sm font-semibold transition-colors">Sign in</button>
        </div>
      </div>
    );
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f7f4ed] p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#37322F]">Vibes Admin</h1>
          <p className="text-xs text-[#37322F]/50 mt-0.5">{selectedCount} selected · {items.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving}
            className="h-8 px-4 bg-[#37322F] hover:bg-[rgba(55,50,47,0.85)] disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors">
            {saving ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/><path d="M8 2a6 6 0 0 1 6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
            ) : synced ? "✓" : null}
            {saving ? "Saving…" : synced ? "Saved" : "Save & Sync"}
          </button>
          <button onClick={()=>signOut(_auth)}
            className="h-8 px-3 text-xs text-[#37322F]/50 hover:text-[#37322F] border border-[rgba(55,50,47,0.12)] rounded-lg transition-colors">
            Sign out
          </button>
        </div>
      </div>

      {/* Scan button + auto-scan info */}
      <div className="w-full mb-6 flex items-center justify-between bg-white rounded-xl border border-[rgba(55,50,47,0.10)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#37322F]">Images from <code className="text-xs bg-[rgba(55,50,47,0.07)] px-1.5 py-0.5 rounded font-mono">/public</code></p>
          <p className="text-xs text-[#37322F]/45 mt-0.5">All image files in your public folder are listed below. Click to select.</p>
        </div>
        <button onClick={scanPublic} disabled={scanning}
          className="h-8 px-3 border border-[rgba(55,50,47,0.15)] rounded-lg text-xs font-semibold text-[#37322F]/70 hover:text-[#37322F] hover:border-[rgba(55,50,47,0.3)] flex items-center gap-1.5 transition-colors disabled:opacity-50">
          {scanning
            ? <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity=".3"/><path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            : <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M14 2v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {/* Categories manager */}
      <div className="bg-white rounded-xl border border-[rgba(55,50,47,0.10)] p-4 mb-5">
        <p className="text-[10px] font-bold text-[#37322F]/40 uppercase tracking-widest mb-3">Categories</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {categories.map(cat => (
            <span key={cat} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{background:"rgba(55,50,47,0.07)",color:"#37322F"}}>
              {cat}
              <button onClick={()=>removeCat(cat)} className="leading-none text-[#37322F]/25 hover:text-[#37322F]/60 transition-colors">✕</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="New category…" value={newCat} onChange={e=>setNewCat(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter") addCat();}}
            className="flex-1 h-8 px-3 rounded-lg border border-[rgba(55,50,47,0.15)] text-sm text-[#37322F] outline-none"/>
          <button onClick={addCat} className="h-8 px-3 bg-[#37322F] text-white rounded-lg text-xs font-semibold hover:bg-[rgba(55,50,47,0.85)] transition-colors">Add</button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {["all",...categories].map(cat => (
          <button key={cat} onClick={()=>setFilter(cat)}
            className="h-7 px-3 rounded-full text-xs font-semibold transition-all"
            style={{background:filter===cat?"#37322F":"rgba(55,50,47,0.07)",color:filter===cat?"#fff":"rgba(55,50,47,0.6)"}}>
            {cat==="all" ? `All (${items.length})` : `${cat} (${items.filter(v=>v.category===cat).length})`}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-[#37322F]/35">
          <p className="text-sm font-medium">No images yet</p>
          <p className="text-xs mt-1">{items.length > 0 ? "Switch filter or upload more." : "Upload some images above."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map(v => (
            <div key={v.id} className="relative rounded-xl overflow-hidden group"
              style={{border:v.selected?"2px solid #37322F":"2px solid rgba(55,50,47,0.08)",background:"rgba(55,50,47,0.04)",cursor:"pointer"}}
              onClick={()=>toggleItem(v.id)}>

              {/* Thumb */}
              <div className="aspect-square w-full overflow-hidden flex items-center justify-center bg-[rgba(55,50,47,0.03)]">
                <img src={v.path} alt={v.name}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  onError={e=>{(e.target as HTMLImageElement).style.opacity="0.25";}}/>
              </div>

              {/* Checkmark */}
              {v.selected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-[#37322F] rounded-full flex items-center justify-center shadow-sm">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              )}

              {/* Info */}
              <div className="p-1.5" onClick={e=>e.stopPropagation()}>
                <p className="text-[10px] font-medium text-[#37322F]/55 truncate mb-1" title={v.name}>{v.name}</p>
                <select value={v.category} onChange={e=>setCat(v.id,e.target.value)}
                  className="w-full text-[10px] bg-white/80 border border-[rgba(55,50,47,0.12)] rounded-md px-1 py-0.5 text-[#37322F] outline-none">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
