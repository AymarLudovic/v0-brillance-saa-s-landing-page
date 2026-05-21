'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { auth, db, googleProvider } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, getDocs, addDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';


// ─── Types ─────────────────────────────────────────────────────────────────────

interface Site { id: string; name: string; url: string; siteId: string; ownerId: string; }
interface PageViewDoc {
  page: string; country: string; countryCode: string; city: string;
  referrer: string; sessionId: string; visitorId?: string; isNew?: boolean;
  title: string; userAgent: string; timestamp: string;
}
interface LiveVisitor {
  sessionId: string; page: string; lastSeen: string;
  country: string; countryCode: string; isNew: boolean;
}

// ─── Logo ──────────────────────────────────────────────────────────────────────

function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="350 60 560 115" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="420" cy="120" rx="58" ry="32" fill="currentColor" transform="rotate(-18 430 120)" />
      <text x="500" y="150" fontSize="100" fontFamily="Inter,Helvetica,Arial,sans-serif"
        fontWeight="400" fill="currentColor" letterSpacing="-4">Artbox.</text>
    </svg>
  );
}

// ─── UA parsers ────────────────────────────────────────────────────────────────

function parseDevice(ua: string) {
  if (!ua) return 'Desktop';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  if (/mobile|android|iphone|ipod/i.test(ua)) return 'Mobile';
  return 'Desktop';
}
function parseBrowser(ua: string) {
  if (!ua) return 'Other';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  return 'Other';
}
function parseOS(ua: string) {
  if (!ua) return 'Other';
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x/i.test(ua) && !/iphone/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'GNU/Linux';
  return 'Other';
}
function parseSource(ref: string) {
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    if (/google\./i.test(h)) return 'google.com';
    if (/facebook\.com|fb\./i.test(h)) return 'facebook.com';
    if (/twitter\.com|t\.co/i.test(h)) return 'twitter.com';
    if (/instagram\.com/i.test(h)) return 'instagram.com';
    if (/tiktok\.com/i.test(h)) return 'tiktok.com';
    if (/linkedin\.com/i.test(h)) return 'linkedin.com';
    if (/bing\.com/i.test(h)) return 'bing.com';
    if (/youtube\.com|youtu\.be/i.test(h)) return 'youtube.com';
    if (/reddit\.com/i.test(h)) return 'reddit.com';
    return h;
  } catch { return 'Unknown'; }
}

function topN(arr: string[], n = 8) {
  const m = new Map<string, number>();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
}
function pctChange(a: number, b: number) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 100);
}
function periodToDays(p: string) { return p === '7d' ? 7 : p === '90d' ? 90 : 30; }
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Google icon ───────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ─── Globe icon ────────────────────────────────────────────────────────────────

function GlobeIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg style={{ width: size, height: size }} className={`fill-[#171717] shrink-0 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
      <path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/>
    </svg>
  );
}

// ─── Favicon ───────────────────────────────────────────────────────────────────

function SiteFavicon({ url, name, size = 18 }: { url: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  const domain = (() => {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname; }
    catch { return ''; }
  })();
  if (!domain || err) return <GlobeIcon size={size} />;
  return (
    <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      width={size} height={size} alt={name} className="rounded-sm shrink-0 object-contain"
      onError={() => setErr(true)} />
  );
}

function Flag({ code }: { code: string }) {
  const [err, setErr] = useState(false);
  if (!code || code.length !== 2 || err) return <span className="text-sm">🌐</span>;
  return (
    <img src={`https://flagcdn.com/w20/${code.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/w40/${code.toLowerCase()}.png 2x`}
      width={16} height={12} alt={code} className="rounded-[2px] object-cover shrink-0"
      onError={() => setErr(true)} />
  );
}

// ─── Avatar dropdown ───────────────────────────────────────────────────────────

function AvatarMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-gray-100 transition-colors">
        {user.photoURL
          ? <img src={user.photoURL} alt="avatar" className="w-7 h-7 rounded-full object-cover border border-gray-200" />
          : <div className="w-7 h-7 rounded-full bg-[#181818] text-white text-xs font-bold flex items-center justify-center">{(user.displayName?.[0] || 'U').toUpperCase()}</div>
        }
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-[#e0e0e0] rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-[#181818] truncate">{user.displayName || 'User'}</div>
            <div className="text-xs text-[#989898] truncate">{user.email}</div>
          </div>
          <div className="p-1">
            <button onClick={() => { signOut(auth); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg w-full transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${copied ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-[#686868] border-[#e0e0e0] hover:bg-gray-50'}`}>
      {copied ? '✓ Copied!' : label}
    </button>
  );
}

// ─── Script block ──────────────────────────────────────────────────────────────

function ScriptBlock({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<'next' | 'html'>('next');
  const code = tab === 'next'
    ? `import Script from 'next/script'\n\n<Script\n  src="https://v0vibebeta.vercel.app/poyne.js"\n  data-site-id="${siteId}"\n  strategy="afterInteractive"\n/>`
    : `<script\n  src="https://v0vibebeta.vercel.app/poyne.js"\n  data-site-id="${siteId}"\n  defer\n></script>`;
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-[#e0e0e0]">
      <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-[#e0e0e0]">
        <div className="flex gap-1">
          {(['next', 'html'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${tab === t ? 'bg-white text-[#181818] shadow-sm border border-[#e0e0e0]' : 'text-[#989898] hover:text-[#181818]'}`}>
              {t === 'next' ? 'Next.js' : 'HTML'}
            </button>
          ))}
        </div>
        <CopyBtn text={code} />
      </div>
      <div className="bg-[#0d0d0d] px-4 py-3 overflow-x-auto">
        <pre className="text-xs text-green-400 font-mono whitespace-pre leading-relaxed">{code}</pre>
      </div>
    </div>
  );
}

// ─── Add site modal ────────────────────────────────────────────────────────────

function AddSiteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (site: Site) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl]   = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Site | null>(null);
  const user = auth.currentUser;

  function toSiteId(n: string) {
    return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);
  }
  async function handleCreate() {
    if (!user || !name.trim()) return;
    setSaving(true);
    const siteId = toSiteId(name);
    const ref = await addDoc(collection(db, 'sites'), { name: name.trim(), url: url.trim(), siteId, ownerId: user.uid, createdAt: serverTimestamp() });
    const newSite: Site = { id: ref.id, name: name.trim(), url: url.trim(), siteId, ownerId: user.uid };
    setSaving(false); setDone(newSite); onSuccess(newSite);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-[15px] font-bold text-[#181818]">{done ? '✓ Site created' : 'Add a site'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#989898] hover:text-[#181818] hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-5">
          {!done ? (
            <>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#989898] uppercase tracking-wider mb-1.5">Site name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="My Website"
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    className="w-full px-3 py-2.5 border border-[#e0e0e0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#181818] transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#989898] uppercase tracking-wider mb-1.5">URL (optional)</label>
                  <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mysite.com"
                    className="w-full px-3 py-2.5 border border-[#e0e0e0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#181818] transition-all" />
                  <p className="text-[11px] text-[#989898] mt-1">Used to display the favicon and site URL</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={onClose} className="px-4 py-2 text-sm text-[#989898] hover:text-[#181818] transition-colors">Cancel</button>
                <button onClick={handleCreate} disabled={!name.trim() || saving}
                  className="flex items-center gap-2 px-5 py-2 bg-[#181818] text-white rounded-xl text-sm font-bold hover:bg-[#333] transition-colors disabled:opacity-50">
                  {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl mb-4">
                <SiteFavicon url={done.url || ''} name={done.name} size={32} />
                <div>
                  <p className="text-sm font-bold text-emerald-900">{done.name}</p>
                  <p className="text-xs text-emerald-600 font-mono">{done.siteId}</p>
                </div>
              </div>
              <p className="text-sm text-[#686868] mb-3 font-medium">Add this script to start tracking:</p>
              <ScriptBlock siteId={done.siteId} />
              <div className="flex justify-end mt-5">
                <button onClick={() => { onSuccess(done); onClose(); }}
                  className="px-5 py-2 bg-[#181818] text-white rounded-xl text-sm font-bold hover:bg-[#333] transition-colors">
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Site card (user's design) ─────────────────────────────────────────────────

function SiteCard({ site, onSelect, onShowScript }: {
  site: Site;
  onSelect: () => void;
  onShowScript: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const displayUrl = site.url ? site.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : site.siteId;

  return (
    <div className="bg-white border border-[#e0e0e0] rounded-xl p-4 flex flex-col gap-4 hover:shadow-sm hover:border-gray-300 transition-all">
      {/* Top row: favicon + name + visit link */}
      <div className="w-full flex items-center justify-between">
        <span className="flex items-center gap-2 min-w-0">
          <SiteFavicon url={site.url || site.siteId} name={site.name} size={18} />
          <span className="font-semibold text-sm text-[#171717] truncate">{site.name}</span>
          <span className="text-xs text-[#989898] truncate hidden sm:block">{displayUrl}</span>
        </span>
        {site.url && (
          <a href={site.url.startsWith('http') ? site.url : `https://${site.url}`} target="_blank" rel="noopener"
            className="flex items-center gap-1 text-xs text-[#989898] hover:text-[#181818] transition-colors shrink-0">
            <svg className="w-4 h-4" viewBox="0 -960 960 960" fill="currentColor">
              <path d="M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z"/>
            </svg>
            visit
          </a>
        )}
      </div>

      {/* Bottom row: Analytics button + Ellipsis menu */}
      <div className="flex items-center gap-2">
        <button onClick={onSelect}
          className="flex items-center gap-1.5 px-3 h-[32px] rounded-[25px] bg-[#e6e6e6] text-sm text-[#171717] font-medium hover:bg-[#d4d4d4] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
          Analytics
        </button>

        <div ref={menuRef} className="relative">
          <button onClick={() => setMenuOpen(o => !o)}
            className="flex items-center justify-center w-[32px] h-[32px] rounded-full hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-[#e0e0e0] rounded-xl shadow-lg z-20 overflow-hidden">
              <div className="p-1">
                <button onClick={() => { onSelect(); setMenuOpen(false); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[#181818] hover:bg-gray-50 rounded-lg w-full transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                  Analytics
                </button>
                <button onClick={() => { onShowScript(); setMenuOpen(false); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[#181818] hover:bg-gray-50 rounded-lg w-full transition-colors">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  Script tag
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ForensicAnalytics (design de l'utilisateur + vraies données) ──────────────

function TableFooter() {
  return (
    <div className="p-3 border-t border-gray-100 flex justify-center">
      <div className="flex bg-gray-100 rounded-[25px] p-0.5">
        <button className="px-2 py-1 hover:bg-white rounded-[25px] transition-colors">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#989898" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
        <button className="px-2 py-1 border-l border-gray-200 hover:bg-white rounded-[25px] transition-colors">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#989898" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </button>
      </div>
    </div>
  );
}

interface AnalyticsViewProps {
  site: Site;
  onBack: () => void;
  liveCount: number;
  liveVisitors: LiveVisitor[];
}

function AnalyticsView({ site, onBack, liveCount, liveVisitors }: AnalyticsViewProps) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d');
  const [current, setCurrent] = useState<PageViewDoc[]>([]);
  const [previous, setPrevious] = useState<PageViewDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [deviceTab, setDeviceTab] = useState<'Devices' | 'Browsers'>('Devices');

  useEffect(() => { setMounted(true); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const days = periodToDays(period);
    try {
      const [rCur, rPrev] = await Promise.all([
        fetch(`/api/analytics/${encodeURIComponent(site.siteId)}?days=${days}`),
        fetch(`/api/analytics/${encodeURIComponent(site.siteId)}?days=${days}&offset=${days}`),
      ]);
      const { pageviews: cur }  = await rCur.json();
      const { pageviews: prev } = rPrev.ok ? await rPrev.json() : { pageviews: [] };
      setCurrent(cur || []); setPrevious(prev || []);
    } catch { setCurrent([]); }
    finally { setLoading(false); }
  }, [site.siteId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const days = periodToDays(period);

  const stats = useMemo(() => {
    const sessions = (arr: PageViewDoc[]) => new Set(arr.map(p => p.sessionId).filter(Boolean)).size;
    const bounce = (arr: PageViewDoc[]) => {
      const m = new Map<string, number>();
      arr.forEach(p => { if (p.sessionId) m.set(p.sessionId, (m.get(p.sessionId) || 0) + 1); });
      return m.size ? Math.round([...m.values()].filter(c => c === 1).length / m.size * 100) : 0;
    };
    return {
      visitors:    sessions(current),  visitorsPct:  pctChange(sessions(current), sessions(previous)),
      pageviews:   current.length,     pvPct:        pctChange(current.length, previous.length),
      bounce:      bounce(current),    bouncePct:    pctChange(bounce(current), bounce(previous)),
    };
  }, [current, previous]);

  const chartData = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), new Set());
    }
    for (const p of current) {
      const day = new Date(p.timestamp ?? '').toISOString().slice(0, 10);
      if (map.has(day) && p.sessionId) map.get(day)!.add(p.sessionId);
    }
    return [...map.entries()].map(([date, s]) => ({ name: fmtDate(date), value: s.size }));
  }, [current, days]);

  const topPages    = useMemo(() => topN(current.map(p => p.page)), [current]);
  const topSources  = useMemo(() => topN(current.map(p => parseSource(p.referrer))), [current]);
  const codeFor     = (n: string) => current.find(p => p.country === n)?.countryCode || '';
  const countries   = useMemo(() => topN(current.map(p => p.country || 'Unknown'), 5).map(({ name, count }) => ({ name, count, code: codeFor(name) })), [current]);
  const devices     = useMemo(() => topN(current.map(p => parseDevice(p.userAgent || ''))), [current]);
  const browsers    = useMemo(() => topN(current.map(p => parseBrowser(p.userAgent || ''))), [current]);
  const os          = useMemo(() => topN(current.map(p => parseOS(p.userAgent || ''))), [current]);
  const total       = Math.max(stats.visitors, 1);

  const displayUrl = site.url ? site.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : `${site.siteId}`;

  return (
    <div className="flex-1 overflow-y-auto bg-white min-h-0 flex flex-col">

      {/* Forensic header bar */}
      <div className="h-[48px] px-6 flex items-center justify-between border-b border-[#f0f0f0] flex-shrink-0">
        <div className="flex items-center gap-3 text-[13px]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-[#989898] hover:text-[#181818] transition-colors mr-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex items-center gap-2 text-[#989898]">
            <SiteFavicon url={site.url || ''} name={site.name} size={14} />
            <span className="font-medium text-[#181818]">{displayUrl}</span>
            {site.url && (
              <a href={site.url.startsWith('http') ? site.url : `https://${site.url}`} target="_blank" rel="noopener"
                className="hover:text-[#181818] transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            )}
          </div>
          <div className="h-3 w-[1px] bg-gray-200" />
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${liveCount > 0 ? 'bg-green-500' : 'bg-gray-300'}`}>
              {liveCount > 0 && <div className="w-2 h-2 rounded-full bg-green-500 animate-ping" />}
            </div>
            <span className="font-medium text-[#181818]">{liveCount} online</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-[#e0e0e0] rounded-lg px-3 bg-white text-[12px] font-semibold text-[#181818] h-[32px] cursor-pointer hover:bg-gray-50">
            <svg className="w-3.5 h-3.5 text-[#989898] mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth={2}/><line x1="16" y1="2" x2="16" y2="6" strokeWidth={2}/><line x1="8" y1="2" x2="8" y2="6" strokeWidth={2}/><line x1="3" y1="10" x2="21" y2="10" strokeWidth={2}/>
            </svg>
            <select value={period} onChange={e => setPeriod(e.target.value as '7d'|'30d'|'90d')}
              className="bg-transparent outline-none cursor-pointer text-[12px] font-semibold">
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
            </select>
          </div>
          <button onClick={fetchData} className="flex items-center border border-[#e0e0e0] rounded-lg px-2 bg-white h-[32px] text-[#989898] hover:bg-gray-50 hover:text-[#181818] transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 overflow-y-auto">
        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border border-[#e0e0e0] rounded-lg bg-white mb-6 overflow-hidden">
          {[
            { label: 'Visitors',   value: stats.visitors,  pct: stats.visitorsPct,  fmt: (v: number) => v.toLocaleString(), active: true },
            { label: 'Page Views', value: stats.pageviews, pct: stats.pvPct,        fmt: (v: number) => v.toLocaleString(), active: false },
            { label: 'Bounce Rate',value: stats.bounce,    pct: stats.bouncePct,    fmt: (v: number) => `${v}%`,           active: false },
          ].map(({ label, value, pct, fmt, active }) => (
            <div key={label} className={`p-5 sm:border-r border-b sm:border-b-0 border-[#e0e0e0] last:border-0 relative ${active ? 'after:absolute after:bottom-0 after:left-0 after:w-full after:h-[2px] after:bg-[#181818]' : ''}`}>
              <div className="text-[13px] text-[#989898] mb-1 font-medium">{label}</div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-3xl font-bold tracking-tight text-[#181818]">{loading ? '—' : fmt(value)}</span>
                {!loading && pct !== null && (
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${pct >= 0 ? 'bg-[#e0f8e0] text-[#38a080]' : 'bg-[#f8d8d8] text-[#d84848]'}`}>
                    {pct >= 0 ? '+' : ''}{pct}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="bg-white border border-[#e0e0e0] rounded-lg p-4 sm:p-6 mb-6">
          <div className="h-[260px] w-full relative">
            {!mounted || loading ? (
              <div className="w-full h-full bg-gray-50 animate-pulse rounded-lg" />
            ) : (
              <ResponsiveContainer width="99%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1870d8" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#1870d8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false}
                    tick={{ fontSize: 10, fill: '#989898', fontWeight: 500 }} dy={10}
                    interval="preserveStartEnd" minTickGap={36} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#989898' }}
                    allowDecimals={false} tickFormatter={(v: number) => String(Math.round(v))}
                    domain={[0, (max: number) => Math.max(Math.ceil(max), 1)]} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e0e0e0', fontSize: '12px' }}
                    formatter={(v: number) => [v, 'Visitors']} />
                  <Area type="linear" dataKey="value" stroke="#1870d8" strokeWidth={2.5}
                    fillOpacity={1} fill="url(#blueGrad)" isAnimationActive dot={false}
                    activeDot={{ r: 4, fill: '#1870d8', stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Pages */}
          <div className="bg-white border border-[#e0e0e0] rounded-lg flex flex-col" style={{ minHeight: 320 }}>
            <div className="flex items-center justify-between px-4 border-b border-gray-100 h-[48px]">
              <span className="text-[13px] font-bold text-[#181818]">Pages</span>
              <span className="text-[11px] font-bold text-[#989898] uppercase tracking-wider">Visitors</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading
                ? [1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-50 rounded-md animate-pulse mb-1.5" />)
                : topPages.length === 0
                  ? <div className="flex items-center justify-center h-full text-[#989898] text-sm py-8">No data</div>
                  : topPages.map(r => (
                    <div key={r.name} className="flex items-center justify-between px-2 py-2.5 text-[13px] border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded-md transition-colors">
                      <span className="text-[#181818] truncate max-w-[75%]">{r.name}</span>
                      <span className="font-bold text-[#181818]">{r.count}</span>
                    </div>
                  ))
              }
            </div>
            <TableFooter />
          </div>

          {/* Referrers */}
          <div className="bg-white border border-[#e0e0e0] rounded-lg flex flex-col" style={{ minHeight: 320 }}>
            <div className="flex items-center justify-between px-4 border-b border-gray-100 h-[48px]">
              <span className="text-[13px] font-bold text-[#181818]">Referrers</span>
              <span className="text-[11px] font-bold text-[#989898] uppercase tracking-wider">Visitors</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading
                ? [1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-50 rounded-md animate-pulse mb-1.5" />)
                : topSources.length === 0
                  ? <div className="flex items-center justify-center h-full text-[#989898] text-sm py-8">No data</div>
                  : topSources.map(r => (
                    <div key={r.name} className="flex items-center justify-between px-2 py-2.5 text-[13px] border-b border-gray-50 last:border-0 hover:bg-gray-50 rounded-md transition-colors">
                      <div className="flex items-center gap-2 max-w-[75%]">
                        {r.name !== 'Direct'
                          ? <img src={`https://www.google.com/s2/favicons?domain=${r.name}&sz=16`} className="w-4 h-4 rounded-sm shrink-0" alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#989898" strokeWidth="2"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
                        }
                        <span className="text-[#181818] truncate">{r.name}</span>
                      </div>
                      <span className="font-bold text-[#181818]">{r.count}</span>
                    </div>
                  ))
              }
            </div>
            <TableFooter />
          </div>
        </div>

        {/* 3-col: Countries | Devices+Browsers | OS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Countries */}
          <div className="bg-white border border-[#e0e0e0] rounded-lg flex flex-col" style={{ minHeight: 260 }}>
            <div className="flex items-center justify-between px-4 border-b border-gray-100 h-[48px]">
              <span className="text-[13px] font-semibold text-[#686868]">Countries</span>
              <span className="text-[11px] font-bold text-[#989898] uppercase tracking-wider">Visitors</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading
                ? [1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse mb-1.5" />)
                : countries.map(c => (
                  <div key={c.name} className="flex items-center justify-between px-2 py-2 text-[13px] border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-2">
                      <Flag code={c.code} />
                      <span className="text-[#181818]">{c.name}</span>
                    </div>
                    <span className="font-bold text-[#181818] tabular-nums">
                      {total > 0 ? `${Math.round((c.count / total) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))
              }
            </div>
            <TableFooter />
          </div>

          {/* Devices + Browsers (tabbed) */}
          <div className="bg-white border border-[#e0e0e0] rounded-lg flex flex-col" style={{ minHeight: 260 }}>
            <div className="flex items-center justify-between px-4 border-b border-gray-100 h-[48px]">
              <div className="flex gap-5 h-full items-center text-[13px] font-semibold text-[#686868]">
                {(['Devices', 'Browsers'] as const).map(t => (
                  <button key={t} onClick={() => setDeviceTab(t)}
                    className={`h-full flex items-center cursor-pointer transition-colors ${deviceTab === t ? 'border-b-2 border-[#181818] text-[#181818]' : 'hover:text-[#181818]'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-bold text-[#989898] uppercase tracking-wider">Visitors</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading
                ? [1,2,3].map(i => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse mb-1.5" />)
                : (deviceTab === 'Devices' ? devices : browsers).map(d => (
                  <div key={d.name} className="flex items-center justify-between px-2 py-2 text-[13px] border-b border-gray-50 last:border-0">
                    <span className="text-[#181818]">{d.name}</span>
                    <span className="font-bold text-[#181818] tabular-nums">
                      {total > 0 ? `${Math.round((d.count / total) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))
              }
            </div>
            <TableFooter />
          </div>

          {/* OS */}
          <div className="bg-white border border-[#e0e0e0] rounded-lg flex flex-col" style={{ minHeight: 260 }}>
            <div className="flex items-center justify-between px-4 border-b border-gray-100 h-[48px]">
              <span className="text-[13px] font-semibold text-[#686868]">Operating Systems</span>
              <span className="text-[11px] font-bold text-[#989898] uppercase tracking-wider">Visitors</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading
                ? [1,2,3,4,5].map(i => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse mb-1.5" />)
                : os.map(o => (
                  <div key={o.name} className="flex items-center justify-between px-2 py-2 text-[13px] border-b border-gray-50 last:border-0">
                    <span className="text-[#181818]">{o.name}</span>
                    <span className="font-bold text-[#181818] tabular-nums">
                      {total > 0 ? `${Math.round((o.count / total) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))
              }
            </div>
            <TableFooter />
          </div>
        </div>

        {/* Live visitors (si connectés) */}
        {liveVisitors.length > 0 && (
          <div className="bg-white border border-[#e0e0e0] rounded-lg mb-6">
            <div className="flex items-center gap-2 px-4 border-b border-gray-100 h-[48px]">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[13px] font-semibold text-[#686868]">Live — {liveCount} online now</span>
            </div>
            <div className="p-2">
              {liveVisitors.map(v => {
                const s = Math.floor((Date.now() - new Date(v.lastSeen).getTime()) / 1000);
                const statusCls = s < 35 ? 'text-green-600 bg-green-50' : s < 70 ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50';
                return (
                  <div key={v.sessionId} className="flex items-center gap-3 px-2 py-2 border-b border-gray-50 last:border-0 text-[13px]">
                    <Flag code={v.countryCode} />
                    <span className="text-[#181818] flex-1 truncate font-mono">{v.page}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${v.isNew ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{v.isNew ? 'new' : 'return'}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${statusCls}`}>{s < 35 ? 'active' : s < 70 ? '~1min' : 'leaving'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Live hook ─────────────────────────────────────────────────────────────────

function useLiveVisitors(siteId: string | null) {
  const [visitors, setVisitors] = useState<LiveVisitor[]>([]);
  const refresh = useCallback(async () => {
    if (!siteId) return;
    try {
      const r = await fetch(`/api/presence/${encodeURIComponent(siteId)}`);
      if (r.ok) { const { visitors: v } = await r.json(); setVisitors(v || []); }
    } catch { /* */ }
  }, [siteId]);
  useEffect(() => {
    if (!siteId) return;
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh, siteId]);
  return visitors;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [user, setUser]         = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sites, setSites]       = useState<Site[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [showAdd, setShowAdd]   = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [scriptSite, setScriptSite] = useState<Site | null>(null);

  const liveVisitors = useLiveVisitors(selectedSite?.siteId || null);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }), []);

  const loadSites = useCallback(async (uid: string) => {
    setLoadingSites(true);
    try {
      const snap = await getDocs(query(collection(db, 'sites'), where('ownerId', '==', uid)));
      setSites(snap.docs.map(d => ({ id: d.id, ...d.data() } as Site)));
    } finally { setLoadingSites(false); }
  }, []);

  useEffect(() => { if (user) loadSites(user.uid); else setSites([]); }, [user, loadSites]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-6 h-6 border-2 border-gray-200 border-t-[#181818] rounded-full animate-spin" />
    </div>
  );

  // ── Sign in ────────────────────────────────────────────────────────────────
  if (!user) return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-100 px-6 py-4">
        <Logo className="h-7 w-auto text-[#181818]" />
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <Logo className="h-12 w-auto text-[#181818] mx-auto mb-5" />
          <p className="text-[#989898] text-sm mb-6 leading-relaxed">
            Simple, privacy-friendly analytics<br />for your websites.
          </p>
          <div className="bg-white rounded-2xl border border-[#e0e0e0] p-5 shadow-sm">
            <button onClick={() => signInWithPopup(auth, googleProvider).catch(() => {})}
              className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-[#e0e0e0] text-[#181818] rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all shadow-sm">
              <GoogleIcon /> Continue with Google
            </button>
          </div>
          <p className="text-xs text-[#989898] mt-4">Free · No credit card required</p>
        </div>
      </div>
    </div>
  );

  // ── Authenticated ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col">

      {/* Global nav */}
      <nav className="bg-[#fafafa] border-b border-[#e8e8e8] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedSite && (
              <button onClick={() => setSelectedSite(null)}
                className="flex items-center gap-1 text-[#989898] hover:text-[#181818] transition-colors text-sm mr-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            )}
            <Logo className="h-[11px] w-auto text-[#171717]" />
          </div>
          <AvatarMenu user={user} />
        </div>
      </nav>

      {selectedSite ? (
        /* ── Analytics view ─────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col min-h-0 max-w-5xl w-full mx-auto px-0 sm:px-4 py-0 sm:py-4">
          <div className="flex-1 bg-white sm:border sm:border-[#e0e0e0] sm:rounded-xl overflow-hidden flex flex-col min-h-0" style={{ height: 'calc(100vh - 56px)' }}>
            <AnalyticsView
              site={selectedSite}
              onBack={() => setSelectedSite(null)}
              liveCount={liveVisitors.length}
              liveVisitors={liveVisitors}
            />
          </div>
        </div>
      ) : (
        /* ── Site list view ─────────────────────────────────────────────── */
        <div className="max-w-5xl mx-auto w-full px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#171717]">My Sites</h1>
              <p className="text-sm text-[#989898] mt-0.5">
                {sites.length === 0 ? 'No sites yet.' : `${sites.length} site${sites.length > 1 ? 's' : ''} tracked`}
              </p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 h-[38px] bg-[#171717] text-white text-sm font-medium hover:bg-[#333] transition-colors rounded-[25px] shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add a site
            </button>
          </div>

          {loadingSites ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-[#181818] rounded-full animate-spin" />
            </div>
          ) : sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
                <GlobeIcon size={28} className="fill-gray-400" />
              </div>
              <h3 className="text-sm font-semibold text-[#181818]">Add your first website</h3>
              <p className="text-xs text-[#989898]">Start tracking your visitors for free</p>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#171717] text-white text-sm font-medium hover:bg-[#333] transition-colors rounded-[25px] mt-1 shadow-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New site
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sites.map(site => (
                <SiteCard
                  key={site.id}
                  site={site}
                  onSelect={() => setSelectedSite(site)}
                  onShowScript={() => setScriptSite(site)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add site modal */}
      {showAdd && (
        <AddSiteModal
          onClose={() => setShowAdd(false)}
          onSuccess={site => { setSites(prev => [...prev, site]); setShowAdd(false); }}
        />
      )}

      {/* Script modal */}
      {scriptSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setScriptSite(null)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-[#181818]">Script tag — {scriptSite.name}</h3>
              <button onClick={() => setScriptSite(null)} className="p-1.5 rounded-lg text-[#989898] hover:text-[#181818] hover:bg-gray-100">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <ScriptBlock siteId={scriptSite.siteId} />
          </div>
        </div>
      )}
    </div>
  );
}
