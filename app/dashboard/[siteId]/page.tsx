'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { auth, db, googleProvider } from '@/lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { Space_Grotesk } from 'next/font/google';

const font = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' });

// ─── Logo SVG ─────────────────────────────────────────────────────────────────

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

interface PageViewDoc {
  page: string; country: string; countryCode: string; city: string;
  referrer: string; sessionId: string; visitorId?: string; isNew?: boolean;
  title: string; userAgent: string; timestamp: string;
}
interface LiveVisitor {
  sessionId: string; visitorId: string; isNew: boolean; page: string;
  title: string; lastSeen: string; country: string; countryCode: string; city: string;
}
interface SiteInfo { name: string; url: string; siteId: string; }

// ─── Parsers ──────────────────────────────────────────────────────────────────

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

// ─── Utilities ────────────────────────────────────────────────────────────────

function topN(arr: string[], n = 6) {
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

// ─── Flag ─────────────────────────────────────────────────────────────────────

function Flag({ code }: { code: string }) {
  const [err, setErr] = useState(false);
  if (!code || code.length !== 2 || err) return <span className="text-base leading-none">🌐</span>;
  return (
    <img
      src={`https://flagcdn.com/w20/${code.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/w40/${code.toLowerCase()}.png 2x`}
      width={20} height={14} alt={code}
      className="rounded-[2px] object-cover shrink-0"
      onError={() => setErr(true)}
    />
  );
}

// ─── Source icon ──────────────────────────────────────────────────────────────

function SourceIcon({ domain }: { domain: string }) {
  const [err, setErr] = useState(false);
  if (domain === 'Direct' || !domain || err) return <span className="text-gray-400 text-xs">↗</span>;
  return (
    <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      width={14} height={14} alt={domain} className="rounded-sm shrink-0" onError={() => setErr(true)} />
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {up ? '+' : ''}{value}%
    </span>
  );
}

// ─── Live hook ────────────────────────────────────────────────────────────────

function useLiveVisitors(siteId: string) {
  const [visitors, setVisitors] = useState<LiveVisitor[]>([]);
  const [ts, setTs] = useState<Date | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/presence/${encodeURIComponent(siteId)}`);
      if (r.ok) { const { visitors: v } = await r.json(); setVisitors(v || []); setTs(new Date()); }
    } catch { /* */ }
  }, [siteId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, [refresh]);
  return { visitors, ts, refresh };
}

// ─── Avatar dropdown ──────────────────────────────────────────────────────────

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
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 p-1 rounded-xl hover:bg-gray-100 transition-colors">
        {user.photoURL
          ? <img src={user.photoURL} alt="avatar" className="w-7 h-7 rounded-full object-cover border border-gray-200" />
          : <div className="w-7 h-7 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">{(user.displayName?.[0] || 'U').toUpperCase()}</div>
        }
        
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-40 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900 truncate">{user.displayName || 'User'}</div>
            <div className="text-xs text-gray-400 truncate">{user.email}</div>
          </div>
          <div className="p-1">
            <Link href="/" onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg w-full">
              <Logo className="h-3 w-auto" />
              My websites
            </Link>
            <button onClick={() => { signOut(auth); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-[#171717] text-decoration underline-dashed hover:bg-red-50 rounded-lg w-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live panel ───────────────────────────────────────────────────────────────

function LivePanel({ siteId }: { siteId: string }) {
  const { visitors, ts, refresh } = useLiveVisitors(siteId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  function actStatus(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 35) return { label: 'active', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' };
    if (s < 70) return { label: '~1min',  cls: 'text-amber-600 bg-amber-50 border-amber-200' };
    return { label: 'leaving', cls: 'text-red-500 bg-red-50 border-red-200' };
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <span className="relative flex h-2 w-2">
          {visitors.length > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${visitors.length > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        </span>
        {visitors.length} online
      </button>
      {open && (
        <div className="fixed bottom-0 left-0 w-full rounded-tl-[25px] rounded-tr-[25px] h-[50%]  w-72 bg-white border border-gray-200   z-40">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-700">Live visitors</span>
            <div className="flex items-center gap-2">
              {ts && <span className="text-[10px] text-gray-400 font-mono">{ts.toLocaleTimeString()}</span>}
              <button onClick={refresh} className="text-gray-400 hover:text-gray-700">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              </button>
            </div>
          </div>
          {visitors.length === 0
            ? <div className="px-4 py-6 text-center text-gray-400 text-xs">No active visitors right now</div>
            : <div className="divide-y divide-gray-50 max-h-60 overflow-y-auto">
                {visitors.map(v => {
                  const s = actStatus(v.lastSeen);
                  return (
                    <div key={v.sessionId} className="flex items-center gap-2.5 px-4 py-2 hover:bg-gray-50">
                      <Flag code={v.countryCode} />
                      <span className="text-xs font-mono text-gray-700 flex-1 truncate">{v.page}</span>
                      <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${v.isNew ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-purple-200 text-purple-600 bg-purple-50'}`}>{v.isNew ? 'new' : 'return'}</span>
                      <span className={`text-[10px] border rounded px-1 py-0.5 ${s.cls}`}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      )}
    </div>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function VisitorsChart({ data }: { data: { label: string; visitors: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af', fontFamily: 'inherit' }} tickLine={false} axisLine={false} interval={Math.max(Math.floor(data.length / 5) - 1, 0)} />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af', fontFamily: 'inherit' }} tickLine={false} axisLine={false} width={32} allowDecimals={false} tickFormatter={(v: number) => String(Math.round(v))} domain={[0, (max: number) => Math.max(Math.ceil(max), 1)]} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontFamily: 'inherit' }} labelStyle={{ color: '#6b7280' }} itemStyle={{ color: '#374151' }} formatter={(v: number) => [v, 'Visitors']} />
          <Area type="monotone" dataKey="visitors" stroke="#3b82f6" strokeWidth={2} fill="url(#grad)" dot={false} activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Table row (Pages / Referrers) ────────────────────────────────────────────

function TRow({ name, count, icon, maxCount }: { name: string; count: number; icon?: React.ReactNode; maxCount: number }) {
  const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
      {icon && <span className="shrink-0 w-4 flex items-center justify-center">{icon}</span>}
      <div className="flex-1 min-w-0 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-gray-100 rounded transition-all" style={{ width: `${pct}%` }} />
        <span className="relative text-sm text-gray-700 font-medium truncate block pr-1">{name}</span>
      </div>
      <span className="text-sm font-semibold text-gray-900 shrink-0 tabular-nums">{count.toLocaleString()}</span>
    </div>
  );
}

// ─── Breakdown section card ───────────────────────────────────────────────────
// Chaque card prend 100% de la largeur sur mobile, 50% sur sm, 25% sur md

function BreakdownCard({ title, items, total, showFlag }: {
  title: string;
  items: { name: string; count: number; code?: string }[];
  total: number;
  showFlag?: boolean;
}) {
  const max = items[0]?.count || 1;
  return (
    <div className="border-t border-gray-100 pt-4 w-full">
      <div className="flex items-center justify-between mb-3 px-0">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{title}</span>
        <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Visitors</span>
      </div>
      <div className="space-y-2">
        {items.length === 0
          ? <p className="text-xs text-gray-300 py-2">No data</p>
          : items.map(item => {
              const p = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <div key={item.name} className="flex items-center gap-2 group">
                  {showFlag && (
                    <span className="w-5 shrink-0 flex items-center">
                      {item.code ? <Flag code={item.code} /> : <span className="text-sm">🌐</span>}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-700 truncate font-medium">{item.name}</span>
                      <span className="text-[10px] text-gray-400 ml-2 shrink-0 tabular-nums">{p}%</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-300 rounded-full transition-all duration-500" style={{ width: `${Math.round((item.count / max) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 shrink-0 w-6 text-right tabular-nums">{item.count}</span>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ─── Google icon ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// ─── BetaPlus AI Panel ────────────────────────────────────────────────────────

function SpinnerIcon() {
  return (
    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function BetaplusPanel({
  siteUrl,
  onAnalyze, onInspect,
  aiInsight, aiInsightLoading,
  inspectionResult, inspectionLoading, inspectionSteps,
  debugLogs, onClearLogs,
}: {
  siteUrl: string | null;
  onAnalyze: () => void;
  onInspect: () => void;
  aiInsight: string | null;
  aiInsightLoading: boolean;
  inspectionResult: string | null;
  inspectionLoading: boolean;
  inspectionSteps: string[];
  debugLogs: DebugLog[];
  onClearLogs: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'insights' | 'inspect'>('insights');

  return (
    <div className="py-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gray-900 flex items-center justify-center shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-gray-900">Betaplus AI</span>
          <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100">
            gemini-3.5-flash
          </span>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
          {(['insights', 'inspect'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'insights' ? 'Analytics Insights' : 'Site Inspector'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Analytics Insights ── */}
      {activeTab === 'insights' && (
        <div className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-gray-900 mb-0.5">Analytics Insights</div>
              <div className="text-[11px] text-gray-400">AI reads your data and tells you what to fix</div>
            </div>
            <button
              onClick={onAnalyze}
              disabled={aiInsightLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 shrink-0"
            >
              {aiInsightLoading ? <SpinnerIcon /> : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
              {aiInsightLoading ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-700 leading-relaxed min-h-[160px] max-h-[320px] overflow-y-auto flex items-start">
            {aiInsightLoading
              ? <span className="text-gray-400 animate-pulse">Gemini is reading your analytics…</span>
              : aiInsight
                ? <span className="whitespace-pre-wrap">{aiInsight}</span>
                : <span className="text-gray-300">Click Analyze to get AI insights on your traffic</span>
            }
          </div>
        </div>
      )}

      {/* ── Tab: Site Inspector ── */}
      {activeTab === 'inspect' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Browser frame */}
          <div className="border border-gray-200 rounded-2xl overflow-hidden flex flex-col">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
              <div className="flex gap-1.5 shrink-0">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 flex items-center gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-1 min-w-0">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span className="text-[11px] text-gray-500 truncate font-mono">
                  {siteUrl ? siteUrl.replace(/^https?:\/\//, '') : 'no url configured'}
                </span>
              </div>
            </div>
            {/* iframe — the real browser */}
            <div className="flex-1 min-h-[280px] bg-gray-50 relative">
              {siteUrl ? (
                <iframe
                  src={siteUrl}
                  title="Site preview"
                  className="w-full h-full border-0 absolute inset-0"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-300">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  <span className="text-xs">Site URL not configured</span>
                </div>
              )}
            </div>
          </div>

          {/* AI analysis panel */}
          <div className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-gray-900 mb-0.5">AI Report</div>
                <div className="text-[11px] text-gray-400 leading-tight">
                  Gemini visits your URL and reports what blocks users
                </div>
              </div>
              <button
                onClick={onInspect}
                disabled={inspectionLoading || !siteUrl}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 shrink-0"
              >
                {inspectionLoading ? <SpinnerIcon /> : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                )}
                {inspectionLoading ? 'Visiting…' : 'Inspect'}
              </button>
            </div>

            {/* Step-by-step log */}
            {inspectionSteps.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {inspectionSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      i === inspectionSteps.length - 1 && inspectionLoading
                        ? 'bg-blue-100 text-blue-600 animate-pulse'
                        : 'bg-gray-100 text-gray-500'
                    }`}>{i + 1}</span>
                    {step}
                  </div>
                ))}
              </div>
            )}

            {/* Result */}
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-700 leading-relaxed flex-1 min-h-[160px] max-h-[360px] overflow-y-auto">
              {inspectionLoading && !inspectionResult
                ? <span className="text-gray-400 animate-pulse">Gemini is reading your site…</span>
                : inspectionResult
                  ? <span className="whitespace-pre-wrap">{inspectionResult}</span>
                  : <span className="text-gray-300">
                      {siteUrl
                        ? 'Click Inspect — Gemini will visit your site and find what blocks users'
                        : 'Configure your site URL first'}
                    </span>
              }
            </div>
          </div>
        </div>
      )}

      {/* <DebugConsole logs={debugLogs} onClear={onClearLogs} /> */}
    </div>
  );
}

// ─── Debug Console ────────────────────────────────────────────────────────────

export interface DebugLog {
  id: number;
  ts: string;
  type: 'request' | 'response' | 'error' | 'info';
  label: string;
  body: string;
}

function DebugConsole({ logs, onClear }: { logs: DebugLog[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, open]);

  const color = (t: DebugLog['type']) => {
    if (t === 'error')    return 'text-red-400';
    if (t === 'response') return 'text-emerald-400';
    if (t === 'request')  return 'text-blue-400';
    return 'text-gray-400';
  };
  const prefix = (t: DebugLog['type']) => {
    if (t === 'error')    return '✖';
    if (t === 'response') return '✔';
    if (t === 'request')  return '→';
    return 'ℹ';
  };

  return (
    <div className="mt-4 border border-gray-200 rounded-2xl overflow-hidden font-mono">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-950 text-gray-400 hover:bg-gray-900 transition-colors"
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </span>
          <span className="text-gray-500">gemini console</span>
          {logs.length > 0 && (
            <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px]">
              {logs.length} log{logs.length > 1 ? 's' : ''}
            </span>
          )}
          {logs.some(l => l.type === 'error') && (
            <span className="px-1.5 py-0.5 bg-red-950 text-red-400 rounded text-[10px]">
              {logs.filter(l => l.type === 'error').length} error{logs.filter(l => l.type === 'error').length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {logs.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); onClear(); }}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors cursor-pointer"
            >clear</span>
          )}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="bg-gray-950 max-h-72 overflow-y-auto px-4 py-3 space-y-3">
          {logs.length === 0
            ? <p className="text-[11px] text-gray-600 py-2">No logs yet. Click Analyze or Inspect.</p>
            : logs.map(log => (
                <div key={log.id} className="text-[11px] leading-relaxed">
                  <div className={`flex items-center gap-1.5 mb-0.5 ${color(log.type)}`}>
                    <span>{prefix(log.type)}</span>
                    <span className="font-semibold">{log.label}</span>
                    <span className="text-gray-600 ml-auto">{log.ts}</span>
                  </div>
                  <pre className="text-gray-400 whitespace-pre-wrap break-all bg-gray-900 rounded-lg p-2 text-[10px] max-h-40 overflow-y-auto">{log.body}</pre>
                </div>
              ))
          }
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ params }: { params: { siteId: string } }) {
  const { siteId } = params;
  const [user, setUser]             = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [siteInfo, setSiteInfo]     = useState<SiteInfo | null>(null);
  const [period, setPeriod]         = useState<'7d' | '30d' | '90d'>('7d');
  const [current, setCurrent]       = useState<PageViewDoc[]>([]);
  const [previous, setPrevious]     = useState<PageViewDoc[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // ── BetaPlus AI state ──
  const [aiInsight, setAiInsight]               = useState<string | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<string | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionSteps, setInspectionSteps]   = useState<string[]>([]);
  const [debugLogs, setDebugLogs]               = useState<DebugLog[]>([]);
  const debugIdRef                              = useRef(0);

  const addLog = useCallback((type: DebugLog['type'], label: string, body: unknown) => {
    const id = ++debugIdRef.current;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    setDebugLogs(l => [...l, { id, ts, type, label, body: text }]);
  }, []);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); }), []);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'sites'), where('siteId', '==', siteId), where('ownerId', '==', user.uid)))
      .then(snap => { if (!snap.empty) setSiteInfo(snap.docs[0].data() as SiteInfo); }).catch(() => {});
  }, [user, siteId]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const days = periodToDays(period);
      const [rCur, rPrev] = await Promise.all([
        fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days}`),
        fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days}&offset=${days}`),
      ]);
      if (!rCur.ok) throw new Error();
      const { pageviews: cur }  = await rCur.json();
      const { pageviews: prev } = rPrev.ok ? await rPrev.json() : { pageviews: [] };
      setCurrent(cur as PageViewDoc[]); setPrevious(prev as PageViewDoc[]);
    } catch { setError('Failed to load data.'); }
    finally { setLoading(false); }
  }, [siteId, period, user]);

  useEffect(() => { if (user) fetchData(); }, [fetchData, user]);

  // ── BetaPlus AI functions ─────────────────────────────────────────────────
  const analyzeAnalytics = useCallback(async () => {
    setAiInsightLoading(true);
    setAiInsight(null);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      addLog('info', 'analyzeAnalytics — start', `apiKey present: ${!!apiKey}`);
      const tPages    = topN(current.map(p => p.page));
      const tSources  = topN(current.map(p => parseSource(p.referrer)));
      const tDevices  = topN(current.map(p => parseDevice(p.userAgent || '')));
      const tCountries = topN(current.map(p => p.country || 'Unknown'), 4);
      const sessSet   = new Set(current.map(p => p.sessionId).filter(Boolean));
      const prevSess  = new Set(previous.map(p => p.sessionId).filter(Boolean));
      const bounceMap = new Map<string, number>();
      current.forEach(p => { if (p.sessionId) bounceMap.set(p.sessionId, (bounceMap.get(p.sessionId) || 0) + 1); });
      const bounceRate = bounceMap.size ? Math.round([...bounceMap.values()].filter(c => c === 1).length / bounceMap.size * 100) : 0;
      const visitorsChange = pctChange(sessSet.size, prevSess.size);

      const prompt = `You are BetaPlus, a no-BS growth advisor for indie builders.

Analytics for ${siteInfo?.url || siteId} — Last ${periodToDays(period)} days:
• Visitors: ${sessSet.size}${visitorsChange !== null ? ` (${visitorsChange >= 0 ? '+' : ''}${visitorsChange}% vs prev period)` : ''}
• Page Views: ${current.length}
• Bounce Rate: ${bounceRate}%
• Top Pages: ${tPages.slice(0, 4).map(p => `${p.name} (${p.count})`).join(', ') || 'none'}
• Traffic Sources: ${tSources.slice(0, 4).map(s => `${s.name} (${s.count})`).join(', ') || 'none'}
• Top Countries: ${tCountries.slice(0, 3).map(c => `${c.name} (${c.count})`).join(', ') || 'none'}
• Devices: ${tDevices.slice(0, 3).map(d => `${d.name} (${d.count})`).join(', ') || 'none'}

In 150 words max:
1. What the numbers reveal (good and bad)
2. The #1 thing to fix right now to reduce bounce or improve retention
3. One quick win to try this week

Be direct. Talk like a founder to a founder. No bullet padding, no fluff.`;

      addLog('request', 'POST gemini-3.5-flash (insights)', { model: 'gemini-3.5-flash', promptLength: prompt.length });
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );
      const data = await res.json();
      addLog(res.ok ? 'response' : 'error', `HTTP ${res.status}`, data);
      const parts = data.candidates?.[0]?.content?.parts || [];
      const textPart = parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text);
      addLog('info', 'parts breakdown', parts.map((p: { thought?: boolean; text?: string }) => ({ thought: !!p.thought, textLen: p.text?.length ?? 0 })));
      setAiInsight(textPart?.text ?? 'No insight returned.');
    } catch (err) {
      addLog('error', 'analyzeAnalytics — exception', String(err));
      setAiInsight('Analysis failed. Check NEXT_PUBLIC_GEMINI_API_KEY in your .env.local');
    } finally {
      setAiInsightLoading(false);
    }
  }, [current, previous, period, siteId, siteInfo, addLog]);

  const inspectSite = useCallback(async () => {
    if (!siteInfo?.url) return;
    setInspectionLoading(true);
    setInspectionResult(null);
    setInspectionSteps([]);
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      const url = siteInfo.url;
      addLog('info', 'inspectSite — start', `url: ${url} | apiKey present: ${!!apiKey}`);

      // Simulate step progression while Gemini fetches the URL
      setInspectionSteps(['Connecting to your site…']);
      await new Promise(r => setTimeout(r, 600));
      setInspectionSteps(s => [...s, 'Gemini is reading your homepage…']);
      await new Promise(r => setTimeout(r, 800));
      setInspectionSteps(s => [...s, 'Analyzing layout, UX and onboarding…']);

      addLog('request', 'POST gemini-3.5-flash (inspect)', { model: 'gemini-3.5-flash', url, tool: 'url_context' });
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: [{ url_context: {} }],
            contents: [{
              parts: [{
                text: `Visit this website and analyze it: ${url}

You are BetaPlus, a UX inspector for indie builders. After reading the page, tell me:

1. What the site is about and who it's for (1 sentence)
2. The top 3 UX or layout problems that would make users leave immediately
3. Whether the mobile layout looks solid or not, based on the HTML
4. Whether the call-to-action is clear and visible
5. The single most important fix to increase user retention

Max 180 words. Direct, founder-to-founder tone. No fluff.`,
              }],
            }],
            generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
          }),
        }
      );

      const data = await res.json();
      addLog(res.ok ? 'response' : 'error', `HTTP ${res.status}`, data);
      const parts = data.candidates?.[0]?.content?.parts || [];
      addLog('info', 'parts breakdown', parts.map((p: { thought?: boolean; text?: string }) => ({ thought: !!p.thought, textLen: p.text?.length ?? 0 })));
      const textPart = parts.find((p: { thought?: boolean; text?: string }) => !p.thought && p.text);
      const report = textPart?.text ?? 'Could not analyze the site.';
      setInspectionSteps(s => [...s, 'Analysis complete ✓']);
      setInspectionResult(report);
    } catch (err) {
      addLog('error', 'inspectSite — exception', String(err));
      setInspectionSteps([]);
      setInspectionResult('Inspection failed. Check NEXT_PUBLIC_GEMINI_API_KEY in your .env.local');
    } finally {
      setInspectionLoading(false);
    }
  }, [siteInfo, addLog]);
  // ─────────────────────────────────────────────────────────────────────────────

  const days = periodToDays(period);

  const stats = useMemo(() => {
    const sessions = (arr: PageViewDoc[]) => new Set(arr.map(p => p.sessionId).filter(Boolean)).size;
    const bounce = (arr: PageViewDoc[]) => {
      const m = new Map<string, number>();
      arr.forEach(p => { if (p.sessionId) m.set(p.sessionId, (m.get(p.sessionId) || 0) + 1); });
      return m.size ? Math.round([...m.values()].filter(c => c === 1).length / m.size * 100) : 0;
    };
    return {
      visitors: sessions(current), visitorsPct: pctChange(sessions(current), sessions(previous)),
      pageviews: current.length,   pvPct:        pctChange(current.length, previous.length),
      bounce:    bounce(current),  bouncePct:    pctChange(bounce(current), bounce(previous)),
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
    return [...map.entries()].map(([date, s]) => ({ label: fmtDate(date), visitors: s.size }));
  }, [current, days]);

  const topPages   = useMemo(() => topN(current.map(p => p.page)), [current]);
  const topSources = useMemo(() => topN(current.map(p => parseSource(p.referrer))), [current]);
  const codeFor    = (n: string) => current.find(p => p.country === n)?.countryCode || '';
  const countries  = useMemo(() => topN(current.map(p => p.country || 'Unknown'), 5).map(({ name, count }) => ({ name, count, code: codeFor(name) })), [current]);
  const devices    = useMemo(() => topN(current.map(p => parseDevice(p.userAgent  || ''))), [current]);
  const browsers   = useMemo(() => topN(current.map(p => parseBrowser(p.userAgent || ''))), [current]);
  const os         = useMemo(() => topN(current.map(p => parseOS(p.userAgent      || ''))), [current]);
  const total      = Math.max(stats.visitors, 1);

  // ── Auth guards ───────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className={`${font.className} min-h-screen flex items-center justify-center bg-white`}>
      <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
    </div>
  );

  if (!user) return (
    <div className=" min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-xs text-center">
        <Logo className="h-10 w-auto text-gray-900 mx-auto mb-6" />
        <p className="text-gray-500 text-sm mb-6">Sign in to view your analytics.</p>
        <button onClick={() => signInWithPopup(auth, googleProvider).catch(() => {})}
          className="w-full flex items-center justify-center gap-3 h-12 bg-white border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 shadow-sm transition-all">
          <GoogleIcon /> Continue with Google
        </button>
      </div>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  const displayUrl = siteInfo?.url
    ? siteInfo.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : `${siteId}`;

  return (
    <div className=" min-h-screen bg-white text-gray-900">

      {/* ── Top nav ── */}
      <div className="border-b border-gray-100 sticky top-0 bg-white z-20">
        <div className="max-w-5xl mx-auto px-4">
          {/* breadcrumb */}
          <div className="flex items-center gap-1 py-1.5 text-xs text-gray-400 border-b border-gray-50">
            <Link href="/" className="hover:text-gray-700 transition-colors font-medium">
              {user.displayName?.split(' ')[0] || 'Home'}
            </Link>
            <span>/</span>
            <span className="text-[#171717]">Analytics</span>
          </div>

          {/* sub-header */}
          <div className="flex items-center justify-between py-2 gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-semibold text-gray-900 truncate">{displayUrl}</span>
              <LivePanel siteId={siteId} />
            </div>
            <div className="flex items-center gap-2">
              {/* Period selector */}
              <div className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white">
                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth={2}/><line x1="16" y1="2" x2="16" y2="6" strokeWidth={2}/>
                  <line x1="8" y1="2" x2="8" y2="6" strokeWidth={2}/><line x1="3" y1="10" x2="21" y2="10" strokeWidth={2}/>
                </svg>
                <select value={period} onChange={e => setPeriod(e.target.value as '7d'|'30d'|'90d')}
                  className="bg-transparent outline-none cursor-pointer text-xs font-medium">
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="90d">Last 90 Days</option>
                </select>
              </div>
              <button onClick={fetchData} className="p-1.5 border border-gray-200 rounded-lg text-gray-400 hover:text-gray-700 transition-colors bg-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
              </button>
              <AvatarMenu user={user} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4">
        {error && <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">⚠ {error}</div>}

        {/* ── Stats ── */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100 py-5">
          {[
            { label: 'Visitors',   val: stats.visitors,  badge: stats.visitorsPct, fmt: (v: number) => v.toLocaleString() },
            { label: 'Page Views', val: stats.pageviews, badge: stats.pvPct,       fmt: (v: number) => v.toLocaleString() },
            { label: 'Bounce Rate',val: stats.bounce,    badge: stats.bouncePct,   fmt: (v: number) => `${v}%` },
          ].map(({ label, val, badge, fmt }) => (
            <div key={label} className="px-4 first:pl-0 last:pr-0">
              <div className="text-xs text-gray-500 mb-1.5">{label}</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[26px] font-bold leading-none tabular-nums">{loading ? '—' : fmt(val)}</span>
                {!loading && <Badge value={badge} />}
              </div>
            </div>
          ))}
        </div>

        {/* ── Chart ── */}
        <div className="py-5 border-b border-gray-100">
          {loading ? <div className="h-56 flex items-center justify-center text-gray-300 text-sm">Loading…</div>
                   : <VisitorsChart data={chartData} />}
        </div>

        {/* ── Pages + Referrers (2 col → stack mobile) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 border-b border-gray-100 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <span className="text-sm font-semibold text-gray-900">Pages</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Visitors</span>
            </div>
            {topPages.map(r => <TRow key={r.name} name={r.name} count={r.count} maxCount={topPages[0]?.count || 1} />)}
          </div>
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <span className="text-sm font-semibold text-gray-900">Referrers</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Visitors</span>
            </div>
            {topSources.map(r => (
              <TRow key={r.name} name={r.name} count={r.count} maxCount={topSources[0]?.count || 1}
                icon={<SourceIcon domain={r.name} />} />
            ))}
          </div>
        </div>

        {/* ── Breakdown: 4 cards, chacune full-width mobile ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 py-6 border-b border-gray-100">
          <BreakdownCard title="Countries"         items={countries} total={total} showFlag />
          <BreakdownCard title="Devices"           items={devices}   total={total} />
          <BreakdownCard title="Browsers"          items={browsers}  total={total} />
          <BreakdownCard title="Operating Systems" items={os}        total={total} />
        </div>

        {/* ── BetaPlus AI — coming soon ── */}
        {false && <BetaplusPanel
          siteUrl={siteInfo?.url ?? null}
          onAnalyze={analyzeAnalytics}
          onInspect={inspectSite}
          aiInsight={aiInsight}
          aiInsightLoading={aiInsightLoading}
          inspectionResult={inspectionResult}
          inspectionLoading={inspectionLoading}
          inspectionSteps={inspectionSteps}
          debugLogs={debugLogs}
          onClearLogs={() => setDebugLogs([])}
        />}
      </div>
    </div>
  );
}
