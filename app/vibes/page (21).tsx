"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, User,
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc,
} from "firebase/firestore";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "firebase/storage";
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
const _auth    = getAuth(_fbApp);
const _db      = getFirestore(_fbApp);
const _storage = getStorage(_fbApp);

const ADMIN_EMAIL = "ludovicaymar8@gmail.com";
const VIBES_COL   = "vibes_selection";
const CATS_DOC    = "vibes_categories";
const ACCEPTED    = ".jpg,.jpeg,.png,.webp,.svg,.gif,.avif,.bmp,.ico";
const ACCEPTED_MIME = ["image/jpeg","image/png","image/webp","image/svg+xml","image/gif","image/avif","image/bmp","image/x-icon"];

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
    if (!base64 && v.url) {
      try { base64 = await blobToBase64(await (await fetch(v.url)).blob()); } catch {}
    }
    if (base64) await tx.store.put({ id: v.id, base64, category: v.category, createdAt: Date.now() });
  }
  await tx.done;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface VibeItem {
  id: string;
  name: string;
  url: string;
  base64?: string;
  category: string;
  selected: boolean;
  storagePath: string;
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
  const [uploading, setUploading]     = useState(false);
  const [uploadPct, setUploadPct]     = useState(0);
  const [dragOver, setDragOver]       = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const rows: VibeItem[] = [];
    snap.forEach(d => rows.push(d.data() as VibeItem));
    setItems(rows.sort((a,b) => a.name.localeCompare(b.name)));
  }, []);
  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  // Upload
  const handleFiles = async (files: File[]) => {
    const valid = files.filter(f => ACCEPTED_MIME.includes(f.type) || f.name.endsWith(".svg"));
    if (!valid.length) return;
    setUploading(true); setUploadPct(0);
    const defaultCat = categories[0] ?? "UI";
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      try {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        const path = `vibes/${id}-${file.name}`;
        const sref = storageRef(_storage, path);
        await uploadBytes(sref, file);
        const url = await getDownloadURL(sref);
        const base64 = await blobToBase64(file);
        const item: VibeItem = { id, name: file.name, url, base64, category: defaultCat, selected: false, storagePath: path };
        await setDoc(doc(_db, VIBES_COL, id), { id, name: file.name, url, category: defaultCat, selected: false, storagePath: path });
        setItems(prev => [...prev, item]);
      } catch {}
      setUploadPct(Math.round(((i+1)/valid.length)*100));
    }
    setUploading(false); setUploadPct(0); setSynced(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files));
  };

  const toggleItem  = (id: string) => { setItems(p => p.map(v => v.id===id ? {...v,selected:!v.selected} : v)); setSynced(false); };
  const setCat      = (id: string, cat: string) => { setItems(p => p.map(v => v.id===id ? {...v,category:cat} : v)); setSynced(false); };

  const handleDelete = async (item: VibeItem) => {
    setDeletingId(item.id);
    try {
      await deleteDoc(doc(_db, VIBES_COL, item.id));
      try { await deleteObject(storageRef(_storage, item.storagePath)); } catch {}
      setItems(p => p.filter(v => v.id !== item.id)); setSynced(false);
    } finally { setDeletingId(null); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(_db,"config",CATS_DOC), { categories });
      await Promise.all(items.map(v => setDoc(doc(_db,VIBES_COL,v.id),{ id:v.id,name:v.name,url:v.url,category:v.category,selected:v.selected,storagePath:v.storagePath })));
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

      {/* Upload zone */}
      <div
        className="w-full mb-6 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 cursor-pointer select-none"
        style={{ borderColor: dragOver?"#37322F":"rgba(55,50,47,0.18)", background: dragOver?"rgba(55,50,47,0.04)":"rgba(55,50,47,0.015)", minHeight:130, padding:28 }}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={onDrop}
        onClick={()=>fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple accept={ACCEPTED} className="hidden"
          onChange={e=>{if(e.target.files) handleFiles(Array.from(e.target.files)); e.target.value="";}}/>
        {uploading ? (
          <div className="flex flex-col items-center gap-2 w-full max-w-[220px]">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 16 16" fill="none" style={{color:"rgba(55,50,47,0.4)"}}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity=".3"/>
              <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="w-full h-[3px] rounded-full bg-[rgba(55,50,47,0.10)] overflow-hidden">
              <div className="h-full bg-[#37322F]/50 rounded-full transition-all" style={{width:`${uploadPct}%`}}/>
            </div>
            <p className="text-xs text-[#37322F]/50">Uploading… {uploadPct}%</p>
          </div>
        ) : (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" style={{opacity:0.3,color:"#37322F"}}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium text-[#37322F]/60">Drop images here or <span className="underline">browse</span></p>
              <p className="text-xs text-[#37322F]/30 mt-0.5">JPG · PNG · WebP · SVG · GIF · AVIF · BMP · ICO</p>
            </div>
          </>
        )}
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
                <img src={v.url} alt={v.name}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  onError={e=>{(e.target as HTMLImageElement).style.opacity="0.25";}}/>
              </div>

              {/* Checkmark */}
              {v.selected && (
                <div className="absolute top-2 right-2 w-5 h-5 bg-[#37322F] rounded-full flex items-center justify-center shadow-sm">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l2.5 2.5L10 3" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              )}

              {/* Delete */}
              <button
                className="absolute top-2 left-2 w-5 h-5 bg-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                onClick={e=>{e.stopPropagation(); handleDelete(v);}}
                disabled={deletingId===v.id}>
                {deletingId===v.id
                  ? <svg className="animate-spin w-2.5 h-2.5" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.3)" strokeWidth="1.5"/><path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(55,50,47,0.7)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  : <svg width="7" height="7" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="#37322F" strokeWidth="1.5" strokeLinecap="round"/></svg>
                }
              </button>

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
