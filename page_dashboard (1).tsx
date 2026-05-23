'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth, db, googleProvider } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, getDocs, addDoc, query, where, serverTimestamp } from 'firebase/firestore';
import Link from 'next/link';
import { Space_Grotesk } from 'next/font/google';
import { Ellipsis, ArrowUpRight } from 'lucide-react';
const font = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });


// ─── Logo SVG ──────────────────────────────────────────────────────────────────

function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="350 60 560 115" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="420" cy="120" rx="58" ry="32" fill="currentColor" transform="rotate(-18 430 120)" />
      <text x="500" y="150" fontSize="100" fontFamily="Inter, Helvetica, Arial, sans-serif"
        fontWeight="400" fill="currentColor" letterSpacing="-4"></text>
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Site { id: string; name: string; url: string; siteId: string; ownerId: string; }

// ─── Google icon ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ─── Favicon component (Google Favicons API) ──────────────────────────────────

function SiteFavicon({ url, name }: { url: string; name: string }) {
  const [err, setErr] = useState(false);
  const domain = (() => {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname; }
    catch { return ''; }
  })();

  if (!domain || err) {
    return (
      <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white font-bold text-sm shrink-0">
        {name[0]?.toUpperCase()}
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-xl border border-gray-100 bg-white hidden items-center justify-center shrink-0 overflow-hidden shadow-sm">
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt={name}
        width={18} height={18}
        className="object-contain"
        onError={() => setErr(true)}
      />
    </div>
  );
}

// ─── Avatar dropdown ──────────────────────────────────────────────────────────

function AvatarMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 p-1 rounded-xl hover:bg-gray-100 transition-colors">
        {user.photoURL ? (
          <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full object-cover border border-gray-200" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">
            {(user.displayName?.[0] || 'U').toUpperCase()}
          </div>
        )}
        
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900 truncate">{user.displayName || 'User'}</div>
            <div className="text-xs text-gray-400 truncate">{user.email}</div>
          </div>
          <div className="p-1">
            <button onClick={() => { signOut(auth); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors w-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
        copied ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}>
      {copied ? (
        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copié !</>
      ) : (
        <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier</>
      )}
    </button>
  );
}

// ─── Script block ─────────────────────────────────────────────────────────────

type FrameworkTab = 'next' | 'remix' | 'vue' | 'vite' | 'nuxt' | 'svelte' | 'astro' | 'html';

const FRAMEWORK_LABELS: Record<FrameworkTab, string> = {
  next:   'Next.js',
  remix:  'Remix',
  vue:    'Vue',
  vite:   'Vite',
  nuxt:   'Nuxt',
  svelte: 'Svelte',
  astro:  'Astro',
  html:   'HTML',
};

function getFrameworkInstruction(tab: FrameworkTab): string {
  switch (tab) {
    case 'next':   return 'Add to your _app.tsx or layout.tsx';
    case 'remix':  return 'Add inside <head> in your root.tsx';
    case 'vue':    return 'Add inside <head> in your index.html';
    case 'vite':   return 'Add inside <head> in your index.html';
    case 'nuxt':   return 'Add to your nuxt.config.ts';
    case 'svelte': return 'Add inside <head> in src/app.html';
    case 'astro':  return 'Add inside <head> in your layout component';
    case 'html':
    default:       return 'Paste before </body> or inside <head>';
  }
}

function getFrameworkCode(tab: FrameworkTab, siteId: string): string {
  const src = 'https://v0vibebeta.vercel.app/poyne.js';
  const scriptTag = `<script\n  src="${src}"\n  data-site-id="${siteId}"\n  defer\n></script>`;
  switch (tab) {
    case 'next':
      return `import Script from 'next/script'\n\n<Script\n  src="${src}"\n  data-site-id="${siteId}"\n  strategy="afterInteractive"\n/>`;
    case 'nuxt':
      return `export default defineNuxtConfig({\n  app: {\n    head: {\n      script: [{\n        src: '${src}',\n        'data-site-id': '${siteId}',\n        defer: true,\n      }],\n    },\n  },\n})`;
    case 'remix':
    case 'vue':
    case 'vite':
    case 'svelte':
    case 'astro':
    case 'html':
    default:
      return scriptTag;
  }
}

function ScriptBlock({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<FrameworkTab>('next');
  const code = getFrameworkCode(tab, siteId);
  const instruction = getFrameworkInstruction(tab);
  const tabs = Object.keys(FRAMEWORK_LABELS) as FrameworkTab[];

  return (
    <div className="mt-4 rounded-xl overflow-hidden border border-gray-200">
      <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-gray-200 flex-wrap gap-y-1">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                tab === t ? 'bg-white text-gray-900 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {FRAMEWORK_LABELS[t]}
            </button>
          ))}
        </div>
        <CopyBtn text={code} />
      </div>
      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <p className="text-[11px] text-gray-400">{instruction}</p>
      </div>
      <div className="bg-gray-950 px-4 py-3 overflow-x-auto">
        <pre className="text-xs text-green-400 font-mono whitespace-pre leading-relaxed">{code}</pre>
      </div>
    </div>
  );
}

// ─── Script modal ─────────────────────────────────────────────────────────────

function ScriptModal({ site, onClose }: { site: Site; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Installation script</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{site.siteId}</p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-1 font-medium">Add this script to start tracking:</p>
          <ScriptBlock siteId={site.siteId} />
        </div>
      </div>
    </div>
  );
}

// ─── Site card ────────────────────────────────────────────────────────────────

function SiteCard({ site }: { site: Site }) {
  const [showScript, setShowScript] = useState(false);

  return (
    <>
      <div className="bg-transparent flex flex-col gap-6 border-[#b0b0b0] p-2 hover:shadow-md hover:border-gray-300 transition-all">
        <div className="w-full flex items-center justify-between">
          <span className="flex items-center gap-1 truncate">
            <svg className="h-[18px] fill-[#171717] flex w-[18px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
            {site.name}
          </span>
          <div className="flex items-center gap-1">
            <a href={`${site.url}`} className="text-sm underline-dashed flex items-center gap-1 text-decoration">
              <svg className="h-[18px] fill-[#171717] flex w-[18px]" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"/></svg>
              visit
            </a>
          </div>
        </div>
        <div className="flex items-center w-[180px] gap-1">
          <a href={`/dashboard/${site.siteId}`} className="text-sm flex items-center gap-1 px-1 py-3 w-[100px] h-[32px] rounded-[25px] bg-[#e6e6e6]">
            <ArrowUpRight size={16} />
            Analitycs
          </a>
          <button onClick={() => setShowScript(true)} className="px-1 py-1 rounded-md hover:bg-gray-100 transition-colors" title="Installation script">
            <Ellipsis size={16} />
          </button>
        </div>
      </div>

      {showScript && <ScriptModal site={site} onClose={() => setShowScript(false)} />}
    </>
  );
}

// ─── siteId generator ─────────────────────────────────────────────────────────

function toSiteId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
    + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── Add site modal ────────────────────────────────────────────────────────────

function AddSiteModal({ onClose, onSuccess }: {
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
      name: name.trim(), url: url.trim(), siteId,
      ownerId: user.uid, createdAt: serverTimestamp(),
    });
    const newSite: Site = { id: ref.id, name: name.trim(), url: url.trim(), siteId, ownerId: user.uid };
    setSaving(false);
    setDone(newSite);
    onSuccess(newSite);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {done ? '✓ Site created' : 'Add a site'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
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
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Site name *
                  </label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Website"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    URL (optional)
                  </label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mysite.com"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all" />
                  <p className="text-[11px] text-gray-400 mt-1">Used to display the favicon and site URL</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={!name.trim() || saving}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50">
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl mb-4">
                <div className="w-10 h-10 rounded-xl bg-white border border-emerald-200 flex items-center justify-center">
                  <SiteFavicon url={done.url || ''} name={done.name} />
                  <svg className="h-[16px] fill-white flex w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
         
           
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-900">{done.name}</p>
                  <p className="text-xs text-emerald-600 font-mono">{done.siteId}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3 font-medium">Add this script to start tracking:</p>
              <ScriptBlock siteId={done.siteId} />
              <div className="flex justify-end mt-5">
                <a href={`/dashboard/${done.siteId}`} onClick={onClose}
                  className="px-5 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors">
                  View Analytics
                </a>
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
  const [showAuth, setShowAuth] = useState(false);

  const handleNewSite = () => user ? setShowAdd(true) : setShowAuth(true);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); }), []);

  const loadSites = useCallback(async (uid: string) => {
    setLoadingSites(true);
    try {
      const q = query(collection(db, 'sites'), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Site)));
    } finally { setLoadingSites(false); }
  }, []);

  useEffect(() => { if (user) loadSites(user.uid); else setSites([]); }, [user, loadSites]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className={`${font.className} min-h-screen flex items-center justify-center bg-white`}>
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  // ── Always render the app — auth modal overlays on top when signed out ──────
  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Nav */}
      <nav className=" bg-[#fafafa] sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Logo className="h-7 font-semibold w-auto text-[#171717]" />
          {user && <AvatarMenu user={user} />}
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="hidden">
        <div className="max-w-4xl mx-auto px-4 py-2 text-xs text-gray-500">
          <span className="font-medium text-gray-700">
            {user?.displayName?.split(' ')[0] || user?.email}
          </span>
          <span className="mx-1">›</span>
          All website
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#171717]">All website</h1>
            <p className="text-sm hidden text-gray-400 mt-0.5">
              {sites.length === 0
                ? 'No sites yet.'
                : `${sites.length} site${sites.length > 1 ? 's' : ''} tracked`}
            </p>
          </div>
          <button onClick={handleNewSite}
            className={`flex fixed bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap justify-center rounded-[25px] items-center gap-1 px-4 py-2 bg-[#171717] text-white text-sm font-medium hover:bg-gray-700 transition-colors shadow-sm ${sites.length === 0 ? 'hidden' : ''}`}>
            <svg className="h-[16px] fill-white flex w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
         
           
            New site
          </button>
        </div>

        {loadingSites ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : sites.length === 0 ? (
          <div className="h-full w-full mt-2 flex flex-col items-center justify-center py-24 gap-5 text-center">
            <img src="/templates/3dicons-link-front-clay.png" className="object-cover h-[100px] w-[100px]" alt="image" />
            <h3 className="text-1xl font-semibold">Add your first website</h3>
            <button onClick={handleNewSite}
            className="flex justify-center rounded-[25px] items-center gap-1 px-3 py-2 bg-[#171717] text-white  text-sm font-medium hover:bg-gray-700 transition-colors shadow-sm">
            <svg className="h-[16px] fill-white flex w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
         
           
            New site
          </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sites.map((site) => <SiteCard key={site.id} site={site} />)}
            <button onClick={handleNewSite}
              className="border-2 border-dashed border-gray-200 rounded-2xl p-8 hover:border-gray-400 hover:bg-gray-50 transition-all hidden flex-col items-center justify-center gap-2 min-h-[140px]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span className="text-sm text-gray-400 font-medium">Add a site</span>
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddSiteModal
          onClose={() => setShowAdd(false)}
          onSuccess={(site) => setSites((prev) => [...prev, site])}
        />
      )}

      {/* ── Auth modal — triggered on New site click when signed out ──────────── */}
      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-8 sm:pb-0">
          <div className="absolute inset-0 bg-white/70 backdrop-blur-md" onClick={() => setShowAuth(false)} />
          <div className="relative z-10 bg-white rounded-2xl border border-gray-200 shadow-2xl p-7 w-full max-w-xs text-center">
            <Logo className="h-9 w-auto text-gray-900 mx-auto mb-2" />
            <p className="text-gray-500 text-sm leading-relaxed mb-7">
              Sign in to add and track<br />your websites.
            </p>
            <button
              onClick={() => signInWithPopup(auth, googleProvider).catch(() => {})}
              className="w-full flex items-center justify-center gap-2.5 h-11 bg-[#171717] text-white rounded-[25px] text-sm font-semibold hover:bg-gray-800 transition-colors whitespace-nowrap">
              <GoogleIcon />
              Continue with Google
            </button>
            <p className="text-xs text-gray-400 mt-4">Free · No credit card required</p>
          </div>
        </div>
      )}
    </div>
  );
}
