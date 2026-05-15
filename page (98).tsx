/**
 * app/dashboard/[siteId]/page.tsx
 *
 * Poyne Analytics Dashboard
 * Shows: total visitors, unique sessions, top pages, countries, referrers.
 * Reads live from Firestore: analytics/{siteId}/pageviews
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
// Lecture via /api/analytics — pas de SDK Firebase côté client
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageViewDoc {
  page: string;
  country: string;
  countryCode: string;
  city: string;
  referrer: string;
  sessionId: string;
  title: string;
  timestamp: string; // ISO 8601
}

type Period = '7d' | '30d' | '90d';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodToDays(p: Period): number {
  return p === '7d' ? 7 : p === '30d' ? 30 : 90;
}

function getStartDate(p: Period): Date {
  const d = new Date();
  d.setDate(d.getDate() - periodToDays(p));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(date: Date, short = false): string {
  return date.toLocaleDateString('fr-FR', short
    ? { day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: 'short' });
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2 || code === 'XX' || code === 'LH') return '🌐';
  const offset = 0x1f1e6 - 65;
  return String.fromCodePoint(
    code.toUpperCase().charCodeAt(0) + offset,
    code.toUpperCase().charCodeAt(1) + offset
  );
}

function cleanReferrer(ref: string): string {
  if (!ref) return 'Direct / Aucun';
  try {
    const url = new URL(ref);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return ref;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`
        relative rounded-2xl border p-5 flex flex-col gap-1 overflow-hidden
        transition-all duration-300 hover:scale-[1.02]
        ${accent
          ? 'bg-[#0c1e38] border-[#1a4f8a] shadow-[0_0_30px_rgba(56,189,248,0.07)]'
          : 'bg-[#0d1320] border-[#1a2840]'}
      `}
    >
      <span className="text-xs font-medium tracking-widest uppercase text-[#4a6080] font-mono">
        {label}
      </span>
      <span
        className={`text-3xl font-bold tracking-tight font-mono ${
          accent ? 'text-[#38bdf8]' : 'text-[#e2e8f0]'
        }`}
      >
        {typeof value === 'number' ? fmtNum(value) : value}
      </span>
      {sub && (
        <span className="text-xs text-[#4a6080] font-mono mt-0.5">{sub}</span>
      )}
      {accent && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-[#38bdf8] opacity-[0.03] rounded-full -translate-y-8 translate-x-8 pointer-events-none" />
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5 animate-pulse">
      <div className="h-3 w-20 bg-[#1a2840] rounded mb-3" />
      <div className="h-8 w-28 bg-[#1a2840] rounded" />
    </div>
  );
}

// ─── Custom Tooltip for chart ─────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1e33] border border-[#1a3a5c] rounded-xl px-4 py-3 shadow-xl">
      <p className="text-[#4a6080] text-xs font-mono mb-1">{label}</p>
      <p className="text-[#38bdf8] text-xl font-bold font-mono">{payload[0].value}</p>
      <p className="text-[#4a6080] text-xs font-mono">visiteurs</p>
    </div>
  );
}

// ─── Embed Snippet ────────────────────────────────────────────────────────────

function EmbedSnippet({ siteId }: { siteId: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${
    typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'
  }/poyne.js" data-site-id="${siteId}" defer></script>`;

  const copy = () => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium tracking-widest uppercase text-[#4a6080] font-mono">
          Intégrer sur votre site
        </span>
        <button
          onClick={copy}
          className={`text-xs font-mono px-3 py-1 rounded-lg border transition-all duration-200 ${
            copied
              ? 'border-[#10b981] text-[#10b981] bg-[#10b981]/10'
              : 'border-[#1a3a5c] text-[#38bdf8] hover:bg-[#38bdf8]/10'
          }`}
        >
          {copied ? '✓ Copié' : 'Copier'}
        </button>
      </div>
      <div className="bg-[#070b14] border border-[#1a2840] rounded-xl p-4 overflow-x-auto">
        <code className="text-[#38bdf8] text-sm font-mono whitespace-nowrap">
          {snippet}
        </code>
      </div>
      <p className="text-[#4a6080] text-xs font-mono mt-3">
        Colle cette balise avant &lt;/head&gt; ou &lt;/body&gt; — aucun package à installer.
      </p>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({
  params,
}: {
  params: { siteId: string };
}) {
  const siteId = params.siteId;

  const [period, setPeriod]     = useState<Period>('30d');
  const [pageviews, setPageviews] = useState<PageViewDoc[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = periodToDays(period);
      const res  = await fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { pageviews: docs } = await res.json();
      setPageviews(docs as PageViewDoc[]);
    } catch (err) {
      console.error('[Poyne] Fetch error:', err);
      setError('Impossible de charger les données. Vérifiez votre siteId.');
    } finally {
      setLoading(false);
    }
  }, [siteId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Computed stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalPageviews = pageviews.length;
    const uniqueSessions = new Set(pageviews.map((p) => p.sessionId).filter(Boolean)).size;

    // Unique visitors: sessions deduplicated
    const visitorsPerDay = new Map<string, Set<string>>();
    pageviews.forEach((p) => {
      const day = new Date(p.timestamp ?? '').toISOString().slice(0, 10) ?? '';
      if (!visitorsPerDay.has(day)) visitorsPerDay.set(day, new Set());
      if (p.sessionId) visitorsPerDay.get(day)!.add(p.sessionId);
    });

    const avgPerDay =
      visitorsPerDay.size > 0
        ? Math.round([...visitorsPerDay.values()].reduce((a, s) => a + s.size, 0) / visitorsPerDay.size)
        : 0;

    return { totalPageviews, uniqueSessions, avgPerDay };
  }, [pageviews]);

  // ── Chart data (visitors per day) ─────────────────────────────────────────
  const chartData = useMemo(() => {
    const days = periodToDays(period);
    const result: { date: string; visitors: number }[] = [];
    const sessionsByDay = new Map<string, Set<string>>();

    pageviews.forEach((p) => {
      const d = new Date(p.timestamp ?? '');
      if (!d) return;
      const key = d.toISOString().slice(0, 10);
      if (!sessionsByDay.has(key)) sessionsByDay.set(key, new Set());
      if (p.sessionId) sessionsByDay.get(key)!.add(p.sessionId);
      else sessionsByDay.get(key)!.add(Math.random().toString());
    });

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({
        date: fmtDate(d, true),
        visitors: sessionsByDay.get(key)?.size ?? 0,
      });
    }
    return result;
  }, [pageviews, period]);

  // ── Top pages ──────────────────────────────────────────────────────────────
  const topPages = useMemo(() => {
    const map = new Map<string, number>();
    pageviews.forEach((p) => map.set(p.page, (map.get(p.page) ?? 0) + 1));
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([page, views]) => ({ page, views }));
  }, [pageviews]);

  // ── Countries ──────────────────────────────────────────────────────────────
  const countries = useMemo(() => {
    const map = new Map<string, { code: string; count: number }>();
    pageviews.forEach((p) => {
      const key = p.country || 'Unknown';
      const entry = map.get(key) ?? { code: p.countryCode || 'XX', count: 0 };
      entry.count++;
      map.set(key, entry);
    });
    const sorted = [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
    const max = sorted[0]?.[1].count || 1;
    return sorted.map(([name, { code, count }]) => ({ name, code, count, pct: (count / max) * 100 }));
  }, [pageviews]);

  // ── Referrers ──────────────────────────────────────────────────────────────
  const referrers = useMemo(() => {
    const map = new Map<string, number>();
    pageviews.forEach((p) => {
      const key = cleanReferrer(p.referrer);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([source, count]) => ({ source, count }));
  }, [pageviews]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

        * { box-sizing: border-box; }

        body {
          background: #060a12;
          font-family: 'Syne', sans-serif;
          margin: 0;
        }

        .font-mono { font-family: 'JetBrains Mono', monospace !important; }

        /* Subtle dot grid background */
        .dot-bg {
          background-image: radial-gradient(circle, #1a2840 1px, transparent 1px);
          background-size: 28px 28px;
          background-position: 0 0;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #060a12; }
        ::-webkit-scrollbar-thumb { background: #1a2840; border-radius: 3px; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.4s ease forwards; }
        .fade-up-1 { animation-delay: 0.05s; opacity: 0; }
        .fade-up-2 { animation-delay: 0.10s; opacity: 0; }
        .fade-up-3 { animation-delay: 0.15s; opacity: 0; }
        .fade-up-4 { animation-delay: 0.20s; opacity: 0; }
        .fade-up-5 { animation-delay: 0.25s; opacity: 0; }
      `}</style>

      <div className="min-h-screen bg-[#060a12] dot-bg text-[#e2e8f0]">

        {/* ── Top gradient glow ── */}
        <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#38bdf8]/40 to-transparent pointer-events-none" />
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#38bdf8]/[0.03] rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ── Header ── */}
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 fade-up fade-up-1">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#38bdf8] to-[#0284c7] flex items-center justify-center shadow-lg shadow-[#38bdf8]/20">
                <span className="text-white font-bold text-sm font-mono">P</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">
                  Poyne
                  <span className="ml-2 text-[#4a6080] font-normal text-sm font-mono">
                    /{siteId}
                  </span>
                </h1>
                <p className="text-xs text-[#4a6080] font-mono">Analytics Dashboard</p>
              </div>
            </div>

            {/* Period selector */}
            <div className="flex items-center gap-1 bg-[#0d1320] border border-[#1a2840] rounded-xl p-1">
              {(['7d', '30d', '90d'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-mono font-medium transition-all duration-200 ${
                    period === p
                      ? 'bg-[#38bdf8] text-[#060a12] shadow-lg shadow-[#38bdf8]/20'
                      : 'text-[#4a6080] hover:text-[#e2e8f0]'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={fetchData}
                className="ml-1 p-2 text-[#4a6080] hover:text-[#38bdf8] transition-colors rounded-lg hover:bg-[#38bdf8]/10"
                title="Actualiser"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </svg>
              </button>
            </div>
          </header>

          {/* ── Error ── */}
          {error && (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 mb-6 text-red-400 text-sm font-mono">
              ⚠ {error}
            </div>
          )}

          {/* ── Stats row ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <div className="fade-up fade-up-1">
                  <StatCard
                    label="Visiteurs uniques"
                    value={stats.uniqueSessions}
                    sub={`sur ${period}`}
                    accent
                  />
                </div>
                <div className="fade-up fade-up-2">
                  <StatCard
                    label="Pages vues"
                    value={stats.totalPageviews}
                    sub="total des événements"
                  />
                </div>
                <div className="fade-up fade-up-3">
                  <StatCard
                    label="Moy. / jour"
                    value={stats.avgPerDay}
                    sub="visiteurs uniques"
                  />
                </div>
                <div className="fade-up fade-up-4">
                  <StatCard
                    label="Pays #1"
                    value={countries[0] ? `${countryFlag(countries[0].code)} ${countries[0].name}` : '—'}
                    sub={countries[0] ? `${countries[0].count} visites` : 'aucune donnée'}
                  />
                </div>
              </>
            )}
          </div>

          {/* ── Area Chart ── */}
          <div className="rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5 mb-6 fade-up fade-up-3">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Visiteurs dans le temps</h2>
                <p className="text-xs text-[#4a6080] font-mono mt-0.5">
                  {periodToDays(period)} derniers jours
                </p>
              </div>
              {!loading && (
                <span className="text-xs font-mono text-[#4a6080] bg-[#070b14] border border-[#1a2840] px-3 py-1 rounded-full">
                  {pageviews.length} événements
                </span>
              )}
            </div>

            {loading ? (
              <div className="h-52 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-[#38bdf8] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pynGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1a2840" strokeDasharray="3 6" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#4a6080', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      axisLine={false}
                      tickLine={false}
                      interval={Math.floor(chartData.length / 6)}
                    />
                    <YAxis
                      tick={{ fill: '#4a6080', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#38bdf8', strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Area
                      type="monotone"
                      dataKey="visitors"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fill="url(#pynGrad)"
                      dot={false}
                      activeDot={{ r: 5, fill: '#38bdf8', strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ── Bottom grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">

            {/* Top Pages */}
            <div className="lg:col-span-2 rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5 fade-up fade-up-4">
              <h2 className="text-sm font-semibold text-white mb-4">Pages les plus visitées</h2>

              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-9 bg-[#0d1e30] rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : topPages.length === 0 ? (
                <p className="text-[#4a6080] text-sm font-mono text-center py-8">
                  Aucune donnée pour cette période.
                </p>
              ) : (
                <div className="space-y-1">
                  {topPages.map(({ page, views }, idx) => (
                    <div
                      key={page}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#0a1626] transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-[#4a6080] font-mono w-5 text-right shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-sm text-[#94a3b8] font-mono truncate group-hover:text-[#e2e8f0] transition-colors">
                          {page}
                        </span>
                      </div>
                      <span className="text-sm font-bold font-mono text-[#38bdf8] shrink-0 ml-3">
                        {fmtNum(views)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Countries */}
            <div className="rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5 fade-up fade-up-5">
              <h2 className="text-sm font-semibold text-white mb-4">Pays</h2>

              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="space-y-1">
                      <div className="h-3 w-24 bg-[#1a2840] rounded animate-pulse" />
                      <div className="h-1.5 bg-[#1a2840] rounded-full animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : countries.length === 0 ? (
                <p className="text-[#4a6080] text-sm font-mono text-center py-8">—</p>
              ) : (
                <div className="space-y-3">
                  {countries.map(({ name, code, count, pct }) => (
                    <div key={name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-[#94a3b8] flex items-center gap-1.5">
                          <span>{countryFlag(code)}</span>
                          <span className="truncate max-w-[110px]">{name}</span>
                        </span>
                        <span className="text-xs font-mono text-[#38bdf8] shrink-0">{fmtNum(count)}</span>
                      </div>
                      <div className="h-1 bg-[#0d1e30] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#38bdf8] to-[#0ea5e9] rounded-full transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Referrers ── */}
          <div className="rounded-2xl border border-[#1a2840] bg-[#0d1320] p-5 mb-6 fade-up fade-up-5">
            <h2 className="text-sm font-semibold text-white mb-4">Sources de trafic</h2>

            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 bg-[#0d1e30] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : referrers.length === 0 ? (
              <p className="text-[#4a6080] text-sm font-mono text-center py-4">—</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {referrers.map(({ source, count }) => (
                  <div
                    key={source}
                    className="flex items-center justify-between px-4 py-3 bg-[#070b14] border border-[#1a2840] rounded-xl hover:border-[#1a3a5c] transition-colors"
                  >
                    <span className="text-sm text-[#94a3b8] truncate max-w-[120px]">{source}</span>
                    <span className="text-sm font-bold font-mono text-[#38bdf8] ml-2 shrink-0">{fmtNum(count)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Embed snippet ── */}
          <div className="fade-up fade-up-5">
            <EmbedSnippet siteId={siteId} />
          </div>

          {/* Footer */}
          <footer className="mt-8 text-center text-xs text-[#2a3a50] font-mono">
            Poyne Analytics · Cookieless · GDPR-ready · Open source
          </footer>
        </div>
      </div>
    </>
  );
}
