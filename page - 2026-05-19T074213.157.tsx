'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

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

// ─── UA / Source parsers ──────────────────────────────────────────────────────

function parseDevice(ua: string) {
  if (!ua) return 'Desktop';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  if (/mobile|android|iphone|ipod/i.test(ua)) return 'Mobile';
  return 'Desktop';
}
function parseBrowser(ua: string) {
  if (!ua) return 'Other';
  if (/edg\//i.test(ua))                              return 'Edge';
  if (/opr\/|opera/i.test(ua))                        return 'Opera';
  if (/firefox\//i.test(ua))                          return 'Firefox';
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome/i.test(ua))   return 'Safari';
  return 'Other';
}
function parseOS(ua: string) {
  if (!ua) return 'Other';
  if (/windows nt/i.test(ua))                       return 'Windows';
  if (/android/i.test(ua))                          return 'Android';
  if (/iphone|ipad|ipod/i.test(ua))                 return 'iOS';
  if (/mac os x/i.test(ua) && !/iphone/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua))                            return 'GNU/Linux';
  return 'Other';
}
function parseSource(ref: string) {
  if (!ref) return 'Direct';
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    if (/google\./i.test(h))               return 'google.com';
    if (/facebook\.com|fb\./i.test(h))     return 'facebook.com';
    if (/twitter\.com|t\.co/i.test(h))     return 'twitter.com';
    if (/instagram\.com/i.test(h))         return 'instagram.com';
    if (/tiktok\.com/i.test(h))            return 'tiktok.com';
    if (/linkedin\.com/i.test(h))          return 'linkedin.com';
    if (/bing\.com/i.test(h))              return 'bing.com';
    if (/youtube\.com|youtu\.be/i.test(h)) return 'youtube.com';
    if (/reddit\.com/i.test(h))            return 'reddit.com';
    return h;
  } catch { return 'Unknown'; }
}

function flag(code: string) {
  if (!code || code.length !== 2) return '🌐';
  try {
    return String.fromCodePoint(
      ...code.toUpperCase().split('').map((c) => 0x1f1e0 + c.charCodeAt(0) - 65)
    );
  } catch { return '🌐'; }
}

function topN(arr: string[], n = 6) {
  const m = new Map<string, number>();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function pct(a: number, b: number) {
  if (!b) return null;
  const d = ((a - b) / b) * 100;
  return Math.round(d);
}

function periodToDays(p: string) { return p === '7d' ? 7 : p === '90d' ? 90 : 30; }

// ─── Referrer favicon ────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<string, string> = {
  'facebook.com': '🟦', 'instagram.com': '🟪', 'twitter.com': '🐦',
  'google.com': '🔍', 'youtube.com': '▶️', 'linkedin.com': '💼',
  'reddit.com': '🟠', 'tiktok.com': '🎵', 'bing.com': '🔷', 'Direct': '↗',
};

// ─── Live hook ────────────────────────────────────────────────────────────────

function useLiveVisitors(siteId: string) {
  const [visitors, setVisitors] = useState<LiveVisitor[]>([]);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/presence/${encodeURIComponent(siteId)}`);
      if (r.ok) { const { visitors: v } = await r.json(); setVisitors(v || []); }
    } catch { /* silent */ }
  }, [siteId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, [refresh]);
  return { visitors, refresh };
}

// ─── Stat badge ───────────────────────────────────────────────────────────────

function Badge({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {up ? '+' : ''}{value}%
    </span>
  );
}

// ─── Breakdown row ────────────────────────────────────────────────────────────

function BRow({ name, count, total, prefix }: {
  name: string; count: number; total: number; prefix?: string;
}) {
  const p = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 py-1.5">
      {prefix && <span className="text-sm shrink-0 w-5 text-center">{prefix}</span>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-gray-700 truncate">{name}</span>
          <span className="text-xs text-gray-400 ml-2 shrink-0">{p}%</span>
        </div>
        <div className="h-1 bg-gray-100 rounded-full">
          <div className="h-full bg-gray-300 rounded-full" style={{ width: `${p}%` }} />
        </div>
      </div>
      <span className="text-xs text-gray-500 shrink-0 w-7 text-right font-mono">{count}</span>
    </div>
  );
}

// ─── Table rows (Pages / Referrers) ──────────────────────────────────────────

function TRow({ name, count, icon }: { name: string; count: number; icon?: string }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-50 hover:bg-gray-50 transition-colors px-4">
      {icon !== undefined && (
        <span className="text-sm shrink-0 w-5 text-center">{icon}</span>
      )}
      <span className="text-xs text-gray-700 flex-1 truncate font-mono">{name}</span>
      <span className="text-xs font-semibold text-gray-800 shrink-0">{count.toLocaleString()}</span>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }: {
  tabs: string[]; active: string; onChange: (t: string) => void;
}) {
  return (
    <div className="flex border-b border-gray-100">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-4 py-2.5 text-xs font-medium transition-colors ${
            t === active
              ? 'text-gray-900 border-b-2 border-gray-900 -mb-px'
              : 'text-gray-400 hover:text-gray-700'
          }`}>
          {t}
        </button>
      ))}
      <div className="flex-1" />
    </div>
  );
}

// ─── Area chart ───────────────────────────────────────────────────────────────

function VisitorsChart({ data }: { data: { label: string; visitors: number }[] }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false} axisLine={false}
            interval={Math.floor(data.length / 5)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false}
            axisLine={false} width={36}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px #0001' }}
            labelStyle={{ color: '#6b7280' }} itemStyle={{ color: '#374151' }}
            formatter={(v: number) => [v, 'Visitors']}
          />
          <Area
            type="monotone" dataKey="visitors" stroke="#3b82f6" strokeWidth={2}
            fill="url(#grad)" dot={false} activeDot={{ r: 4, fill: '#3b82f6' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Live panel (collapsible) ─────────────────────────────────────────────────

function LivePanel({ siteId, count }: { siteId: string; count: number }) {
  const { visitors, refresh } = useLiveVisitors(siteId);
  const [open, setOpen] = useState(false);

  function actStatus(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 35) return { label: 'actif', cls: 'text-green-500' };
    if (s < 70) return { label: '~1min', cls: 'text-amber-500' };
    return { label: 'départ', cls: 'text-red-400' };
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
      >
        <span className="relative flex h-2 w-2">
          {visitors.length > 0 && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${visitors.length > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
        </span>
        {visitors.length} online
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full bg-white border border-gray-200 shadow-lg rounded-b-xl z-20 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">Visiteurs en direct</span>
            <button onClick={refresh} className="text-gray-400 hover:text-gray-700">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
              </svg>
            </button>
          </div>
          {visitors.length === 0 ? (
            <p className="text-[11px] text-gray-400 text-center py-3 font-mono">Aucun visiteur actif</p>
          ) : visitors.map((v) => {
            const s = actStatus(v.lastSeen);
            return (
              <div key={v.sessionId} className="flex items-center gap-2 py-1.5 border-t border-gray-50">
                <span className="text-base">{flag(v.countryCode)}</span>
                <span className="text-xs font-mono text-gray-700 flex-1 truncate">{v.page}</span>
                <span className={`text-[10px] font-medium border rounded px-1.5 py-0.5 ${
                  v.isNew ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-purple-200 text-purple-600 bg-purple-50'
                }`}>{v.isNew ? 'new' : 'return'}</span>
                <span className={`text-[10px] font-mono ${s.cls}`}>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ params }: { params: { siteId: string } }) {
  const { siteId } = params;
  const [period, setPeriod]       = useState<'7d' | '30d' | '90d'>('7d');
  const [current, setCurrent]     = useState<PageViewDoc[]>([]);
  const [previous, setPrevious]   = useState<PageViewDoc[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [pTab, setPTab]           = useState('Pages');
  const [rTab, setRTab]           = useState('Referrers');

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const days = periodToDays(period);
      // Fetch 2× les jours → on coupe en deux pour calculer les % de variation
      const [rCur, rPrev] = await Promise.all([
        fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days}`),
        fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days * 2}&offset=${days}`),
      ]);
      if (!rCur.ok) throw new Error(`HTTP ${rCur.status}`);
      const { pageviews: cur }  = await rCur.json();
      const { pageviews: prev } = rPrev.ok ? await rPrev.json() : { pageviews: [] };
      setCurrent(cur  as PageViewDoc[]);
      setPrevious(prev as PageViewDoc[]);
    } catch { setError('Impossible de charger les données.'); }
    finally { setLoading(false); }
  }, [siteId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const days = periodToDays(period);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sessions = (arr: PageViewDoc[]) => new Set(arr.map((p) => p.sessionId).filter(Boolean)).size;
    const bounce   = (arr: PageViewDoc[]) => {
      const m = new Map<string, number>();
      for (const p of arr) if (p.sessionId) m.set(p.sessionId, (m.get(p.sessionId) || 0) + 1);
      const u = m.size; if (!u) return 0;
      return Math.round(([...m.values()].filter((c) => c === 1).length / u) * 100);
    };
    const curV  = sessions(current);  const prevV  = sessions(previous);
    const curPV = current.length;     const prevPV = previous.length;
    const curB  = bounce(current);    const prevB  = bounce(previous);
    return {
      visitors: curV,  visitorsPct:   pct(curV,  prevV),
      pageviews: curPV, pageviewsPct: pct(curPV, prevPV),
      bounceRate: curB, bouncePct:    pct(curB,  prevB),
    };
  }, [current, previous]);

  // ── Chart data ─────────────────────────────────────────────────────────────
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
    return [...map.entries()].map(([date, s]) => ({
      label: `${date.slice(5, 7)}/${date.slice(8, 10)}`,
      visitors: s.size,
    }));
  }, [current, days]);

  // ── Tables ─────────────────────────────────────────────────────────────────
  const topPages    = useMemo(() => topN(current.map((p) => p.page)), [current]);
  const topTitles   = useMemo(() => topN(current.map((p) => p.title || '(sans titre)')), [current]);
  const topRefs     = useMemo(() => topN(current.map((p) => parseSource(p.referrer))), [current]);
  const topRawRefs  = useMemo(() => topN(current.map((p) => {
    if (!p.referrer) return 'Direct';
    try { return new URL(p.referrer).hostname.replace('www.',''); } catch { return p.referrer; }
  })), [current]);

  // ── Grid ───────────────────────────────────────────────────────────────────
  const codeFor = (name: string) => current.find((p) => p.country === name)?.countryCode || '';
  const countries = useMemo(() => topN(current.map((p) => p.country || 'Unknown'), 5)
    .map(({ name, count }) => ({ name, count, prefix: flag(codeFor(name)) })), [current]);
  const devices  = useMemo(() => topN(current.map((p) => parseDevice(p.userAgent  || ''))), [current]);
  const browsers = useMemo(() => topN(current.map((p) => parseBrowser(p.userAgent || ''))), [current]);
  const os       = useMemo(() => topN(current.map((p) => parseOS(p.userAgent      || ''))), [current]);

  const total = stats.visitors || 1;

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900">

      {/* ── Top header bar ── */}
      <div className="bg-white border-b border-gray-200 relative">
        <div className="max-w-5xl mx-auto px-4">

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 py-2 text-xs text-gray-500 border-b border-gray-100">
            <span className="font-medium text-gray-700">{siteId}</span>
            <span className="text-gray-300">›</span>
            <span>Analytics</span>
          </div>

          {/* Sub-header: URL + online + dropdowns */}
          <div className="flex items-center justify-between py-2 flex-wrap gap-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-gray-800">
                {siteId}.vercel.app
                <span className="text-blue-500 ml-1">+1</span>
              </span>
              <LivePanel siteId={siteId} count={0} />
            </div>

            <div className="flex items-center gap-2">
              {/* Environment */}
              <div className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 rounded-md text-xs text-gray-600">
                Production
                <svg className="w-3 h-3 text-gray-400 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {/* Period */}
              <div className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 rounded-md text-xs text-gray-600">
                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth={2}/>
                  <line x1="16" y1="2" x2="16" y2="6" strokeWidth={2}/>
                  <line x1="8"  y1="2" x2="8"  y2="6" strokeWidth={2}/>
                  <line x1="3"  y1="10" x2="21" y2="10" strokeWidth={2}/>
                </svg>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as '7d' | '30d' | '90d')}
                  className="bg-transparent outline-none cursor-pointer text-xs"
                >
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="90d">Last 90 Days</option>
                </select>
              </div>
              <button onClick={fetchData} className="p-1.5 border border-gray-200 rounded-md text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4">

        {/* Error */}
        {error && (
          <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            ⚠ {error}
          </div>
        )}

        {/* ── 3 stat cards ── */}
        <div className="grid grid-cols-3 border-b border-gray-100 divide-x divide-gray-100 py-4">
          {[
            { label: 'Visitors',   value: stats.visitors,   pct: stats.visitorsPct,  fmt: (v: number) => v.toLocaleString() },
            { label: 'Page Views', value: stats.pageviews,  pct: stats.pageviewsPct, fmt: (v: number) => v.toLocaleString() },
            { label: 'Bounce Rate',value: stats.bounceRate, pct: stats.bouncePct,    fmt: (v: number) => `${v}%` },
          ].map(({ label, value, pct: p, fmt }) => (
            <div key={label} className="px-4 first:pl-0 last:pr-0">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900 font-mono">
                  {loading ? '—' : fmt(value)}
                </span>
                {!loading && <Badge value={p} />}
              </div>
            </div>
          ))}
        </div>

        {/* ── Area chart ── */}
        <div className="py-4 border-b border-gray-100">
          {loading ? (
            <div className="h-52 flex items-center justify-center text-gray-300 text-sm">Chargement…</div>
          ) : (
            <VisitorsChart data={chartData} />
          )}
        </div>

        {/* ── Pages + Referrers ── */}
        <div className="grid grid-cols-2 border-b border-gray-100 divide-x divide-gray-100 py-2">
          {/* Pages */}
          <div className="pr-4">
            <div className="flex items-center justify-between mb-1">
              <Tabs tabs={['Pages', 'Titres', 'Hostnames']} active={pTab} onChange={setPTab} />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 pr-4">Visitors</span>
            </div>
            {(pTab === 'Pages' ? topPages : pTab === 'Titres' ? topTitles : topPages).map((r) => (
              <TRow key={r.name} name={r.name} count={r.count} />
            ))}
          </div>

          {/* Referrers */}
          <div className="pl-4">
            <div className="flex items-center justify-between mb-1">
              <Tabs tabs={['Referrers', 'UTM']} active={rTab} onChange={setRTab} />
              <span className="text-[10px] uppercase tracking-wider text-gray-400 pr-4">Visitors</span>
            </div>
            {(rTab === 'Referrers' ? topRefs : topRawRefs).map((r) => (
              <TRow
                key={r.name}
                name={r.name}
                count={r.count}
                icon={SOURCE_ICONS[r.name] || '🌐'}
              />
            ))}
          </div>
        </div>

        {/* ── 4-col breakdown ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-gray-100 border-b border-gray-100 py-4">
          {/* Countries */}
          <div className="px-0 pr-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Countries</span>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Visitors</span>
            </div>
            {countries.map((c) => (
              <BRow key={c.name} name={c.name} count={c.count} total={total} prefix={c.prefix} />
            ))}
          </div>

          {/* Devices */}
          <div className="px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Devices</span>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Visitors</span>
            </div>
            {devices.map((d) => <BRow key={d.name} name={d.name} count={d.count} total={total} />)}
          </div>

          {/* Browsers */}
          <div className="px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Browsers</span>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Visitors</span>
            </div>
            {browsers.map((b) => <BRow key={b.name} name={b.name} count={b.count} total={total} />)}
          </div>

          {/* Operating Systems */}
          <div className="pl-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Operating Systems</span>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">Visitors</span>
            </div>
            {os.map((o) => <BRow key={o.name} name={o.name} count={o.count} total={total} />)}
          </div>
        </div>

        {/* Footer */}
        <div className="py-6 text-center text-[10px] text-gray-300 font-mono">
          Poyne Analytics · {siteId} · màj automatique
        </div>
      </div>
    </div>
  );
}
