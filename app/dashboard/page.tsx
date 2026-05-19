'use client';

import { useState, useEffect, useCallback } from 'react';
import { auth, db, googleProvider } from '@/lib/firebase';
import {
  onAuthStateChanged, signInWithPopup, signOut, User,
} from 'firebase/auth';
import {
  collection, getDocs, addDoc, query, where, serverTimestamp,
} from 'firebase/firestore';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Site {
  id: string;
  name: string;
  url: string;
  siteId: string;
  ownerId: string;
}

// ─── Google logo SVG ──────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ─── Script tag generator ─────────────────────────────────────────────────────

function scriptTag(siteId: string) {
  return `<Script\n  src="https://v0vibebeta.vercel.app/poyne.js"\n  data-site-id="${siteId}"\n  strategy="afterInteractive"\n/>`;
}

function scriptTagHtml(siteId: string) {
  return `<script src="https://v0vibebeta.vercel.app/poyne.js" data-site-id="${siteId}" defer></script>`;
}

// ─── Slug generator ───────────────────────────────────────────────────────────

function toSiteId(name: string) {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) +
    '-' + Math.random().toString(36).slice(2, 6)
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        copied
          ? 'bg-green-100 text-green-700 border border-green-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
      }`}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
      {copied ? 'Copié !' : label}
    </button>
  );
}

// ─── Script tag block ─────────────────────────────────────────────────────────

function ScriptBlock({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<'nextjs' | 'html'>('nextjs');
  const code = tab === 'nextjs' ? scriptTag(siteId) : scriptTagHtml(siteId);
  return (
    <div className="mt-4">
      <div className="flex gap-1 mb-2">
        {(['nextjs', 'html'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'
            }`}>
            {t === 'nextjs' ? 'Next.js' : 'HTML'}
          </button>
        ))}
      </div>
      <div className="relative bg-gray-950 rounded-xl p-4 font-mono text-xs text-green-400 leading-relaxed overflow-x-auto">
        <pre className="whitespace-pre-wrap break-all">{code}</pre>
        <div className="absolute top-2 right-2">
          <CopyBtn text={code} />
        </div>
      </div>
      {tab === 'nextjs' && (
        <p className="text-xs text-gray-400 mt-2">
          Ajoute cet import dans ton <code className="bg-gray-100 px-1 rounded">app/layout.tsx</code> :{' '}
          <code className="bg-gray-100 px-1 rounded text-gray-700">import Script from &apos;next/script&apos;</code>
        </p>
      )}
      {tab === 'html' && (
        <p className="text-xs text-gray-400 mt-2">
          Colle ce tag dans la balise <code className="bg-gray-100 px-1 rounded">&lt;head&gt;</code> ou avant{' '}
          <code className="bg-gray-100 px-1 rounded">&lt;/body&gt;</code>.
        </p>
      )}
    </div>
  );
}

// ─── Site card ────────────────────────────────────────────────────────────────

function SiteCard({ site, onDelete }: { site: Site; onDelete: () => void }) {
  const [showScript, setShowScript] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-md transition-shadow">
      <div className="flex w-full items-center justify-between">
        <p className="font-semibold">{site.name}</p>
        <Link
          href={`/dashboard/${site.siteId}`}
          className="flex items-center gap-1 underline-dashed text-sm"
        >
          
          Analytics
        </Link>
      </div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white font-bold text-sm shrink-0">
            {site.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate">
              {site.name}
              <img src={`https://google.com{site.url}&sz=32`} alt="image" />
              
                </div>
            {site.url && (
              <div className="text-xs text-gray-400 truncate">{site.url}</div>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-2 py-1 rounded-lg shrink-0">
          {site.siteId}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/dashboard/${site.siteId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-700 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
          </svg>
          Analytics
        </Link>
        <button
          onClick={() => setShowScript((s) => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          Script tag
        </button>
      </div>

      {showScript && <ScriptBlock siteId={site.siteId} />}
    </div>
  );
}

// ─── Add site modal ───────────────────────────────────────────────────────────

function AddSiteModal({
  onClose, onSuccess,
}: {
  onClose: () => void;
  onSuccess: (site: Site) => void;
}) {
  const [name, setName]   = useState('');
  const [url, setUrl]     = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone]   = useState<Site | null>(null);

  const user = auth.currentUser;

  async function handleCreate() {
    if (!user || !name.trim()) return;
    setSaving(true);
    const siteId = toSiteId(name);
    const ref = await addDoc(collection(db, 'sites'), {
      name: name.trim(),
      url: url.trim(),
      siteId,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });
    const newSite: Site = { id: ref.id, name: name.trim(), url: url.trim(), siteId, ownerId: user.uid };
    setSaving(false);
    setDone(newSite);
    onSuccess(newSite);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {done ? '🎉 Site ajouté !' : 'Ajouter un site'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-5">
          {!done ? (
            <>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">
                    Nom du site *
                  </label>
                  <input
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Mon super site"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                  {name && (
                    <p className="text-[11px] text-gray-400 mt-1 font-mono">
                      ID : {toSiteId(name).replace(/-[a-z0-9]{4}$/, '-xxxx')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">
                    URL (optionnel)
                  </label>
                  <input
                    value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://monsite.com"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
                  Annuler
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!name.trim() || saving}
                  className="px-5 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                    </svg>
                  )}
                  Créer
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-100 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <div>
                  <p className="text-sm font-semibold text-green-800">{done.name}</p>
                  <p className="text-xs text-green-600 font-mono">ID : {done.siteId}</p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-3">
                Colle ce script dans ton projet pour commencer à tracker :
              </p>
              <ScriptBlock siteId={done.siteId} />

              <div className="flex justify-end mt-5">
                <Link
                  href={`/dashboard/${done.siteId}`}
                  className="px-5 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
                  onClick={onClose}
                >
                  Voir les analytics →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardIndex() {
  const [user, setUser]         = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sites, setSites]       = useState<Site[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [showAdd, setShowAdd]   = useState(false);

  // Auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
  }, []);

  const loadSites = useCallback(async (uid: string) => {
    setLoadingSites(true);
    try {
      const q = query(collection(db, 'sites'), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Site)));
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadSites(user.uid);
    else setSites([]);
  }, [user, loadSites]);

  async function handleSignIn() {
    try { await signInWithPopup(auth, googleProvider); } catch { /* annulé */ }
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fcfcfc]">
        <svg className="animate-spin w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </div>
    );
  }

  // ── Not authenticated → Sign-in screen ───────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Poyne Analytics</h1>
            <p className="text-gray-500 text-sm">Visualise tes visiteurs en temps réel.</p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <button
              onClick={handleSignIn}
              className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm"
            >
              <GoogleIcon />
              Continuer avec Google
            </button>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            Gratuit · Aucune carte requise
          </p>
        </div>
      </div>
    );
  }

  // ── Authenticated ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#2596be]">
      {/* Nav */}
      <nav className="bg-[#2596be]  sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Poyne</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="flex items-center gap-2">
              {user.photoURL ? (
                <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white text-xs font-bold">
                  {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
                </div>
              )}
              <span className="text-sm text-gray-700 hidden sm:block">
                {user.displayName || user.email}
              </span>
            </div>
            <button
              onClick={() => signOut(auth)}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Se déconnecter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Mes sites</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {sites.length === 0 ? 'Aucun site pour l\'instant.' : `${sites.length} site${sites.length > 1 ? 's' : ''} suivi${sites.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Ajouter un site
          </button>
        </div>

        {/* Sites grid */}
        {loadingSites ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin w-6 h-6 text-gray-300" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
        ) : sites.length === 0 ? (
          <div
            onClick={() => setShowAdd(true)}
            className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
          >
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            <p className="text-gray-500 text-sm font-medium">Ajouter ton premier site</p>
            <p className="text-gray-400 text-xs mt-1">Clique pour commencer à tracker les visiteurs</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                onDelete={() => loadSites(user.uid)}
              />
            ))}
            {/* Add another */}
            <button
              onClick={() => setShowAdd(true)}
              className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center hover:border-gray-400 hover:bg-white transition-all flex flex-col items-center justify-center gap-2 min-h-[120px]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="text-sm text-gray-400">Ajouter un site</span>
            </button>
          </div>
        )}
      </div>

      {/* Add site modal */}
      {showAdd && (
        <AddSiteModal
          onClose={() => setShowAdd(false)}
          onSuccess={(site) => {
            setSites((prev) => [...prev, site]);
          }}
        />
      )}
    </div>
  );
}
