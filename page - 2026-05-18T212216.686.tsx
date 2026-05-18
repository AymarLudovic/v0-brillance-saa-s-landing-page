'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageViewDoc {
  page: string;
  country: string;
  countryCode: string;
  city: string;
  referrer: string;
  sessionId: string;
  visitorId?: string;
  isNew?: boolean;
  title: string;
  userAgent: string;
  timestamp: string;
}

interface LiveVisitor {
  sessionId: string;
  visitorId: string;
  isNew: boolean;
  page: string;
  title: string;
  lastSeen: string;
  country: string;
  countryCode: string;
  city: string;
}

// ─── UA / referrer parsers ────────────────────────────────────────────────────

function parseDevice(ua: string): string {
  if (!ua) return 'Desktop';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  if (/mobile|android|iphone|ipod/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function parseBrowser(ua: string): string {
  if (!ua) return 'Unknown';
  if (/edg\//i.test(ua))                              return 'Edge';
  if (/opr\/|opera/i.test(ua))                        return 'Opera';
  if (/firefox\//i.test(ua))                          return 'Firefox';
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return 'Chrome';
  if (/safari\//i.test(ua) && !/chrome/i.test(ua))   return 'Safari';
  return 'Other';
}

function parseOS(ua: string): string {
  if (!ua) return 'Unknown';
  if (/windows nt/i.test(ua))                        return 'Windows';
  if (/android/i.test(ua))                           return 'Android';
  if (/iphone|ipad|ipod/i.test(ua))                  return 'iOS';
  if (/mac os x/i.test(ua) && !/iphone/i.test(ua))   return 'macOS';
  if (/linux/i.test(ua))                             return 'Linux';
  return 'Other';
}

function parseSource(referrer: string): string {
  if (!referrer) return 'Direct';
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    if (/google\./i.test(host))              return 'Google';
    if (/facebook\.com|fb\./i.test(host))    return 'Facebook';
    if (/twitter\.com|t\.co/i.test(host))    return 'Twitter / X';
    if (/instagram\.com/i.test(host))        return 'Instagram';
    if (/tiktok\.com/i.test(host))           return 'TikTok';
    if (/linkedin\.com/i.test(host))         return 'LinkedIn';
    if (/bing\.com/i.test(host))             return 'Bing';
    if (/youtube\.com|youtu\.be/i.test(host))return 'YouTube';
    if (/reddit\.com/i.test(host))           return 'Reddit';
    return host;
  } catch { return 'Unknown'; }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐';
  try {
    return String.fromCodePoint(
      ...code.toUpperCase().split('').map((c) => 0x1f1e0 + c.charCodeAt(0) - 65)
    );
  } catch { return '🌐'; }
}

function periodToDays(p: string): number {
  return p === '7d' ? 7 : p === '90d' ? 90 : 30;
}

function topItems(items: string[], n = 6) {
  const map = new Map<string, number>();
  for (const item of items) map.set(item, (map.get(item) || 0) + 1);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

// ─── Live hook ────────────────────────────────────────────────────────────────

function useLiveVisitors(siteId: string) {
  const [visitors, setVisitors] = useState<LiveVisitor[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/presence/${encodeURIComponent(siteId)}`);
      if (res.ok) {
        const { visitors: v } = await res.json();
        setVisitors(v || []);
        setLastRefresh(new Date());
      }
    } catch { /* silent */ }
  }, [siteId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000); // poll 8s
    return () => clearInterval(t);
  }, [refresh]);

  return { visitors, lastRefresh, refresh };
}

// ─── Mini bar chart row ───────────────────────────────────────────────────────

function BarRow({ name, count, maxCount, extra }: {
  name: string; count: number; maxCount: number; extra?: string;
}) {
  const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#161b22] transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[#e6edf3] truncate font-mono">{name}</span>
          {extra && <span className="text-[10px] text-[#484f58] ml-2 shrink-0">{extra}</span>}
        </div>
        <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#238636] rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-xs font-mono text-[#8b949e] shrink-0 w-8 text-right">
        {count.toLocaleString()}
      </span>
    </div>
  );
}

// ─── Section card (tables + grids) ───────────────────────────────────────────

function SectionCard({
  tabs, activeTab, onTabChange, rows, maxCount, rightLabel = 'Visitors',
}: {
  tabs: string[];
  activeTab: string;
  onTabChange: (t: string) => void;
  rows: { name: string; count: number; extra?: string }[];
  maxCount: number;
  rightLabel?: string;
}) {
  return (
    <div className="bg-[#0d1117] border border-[#21262d] rounded-xl overflow-hidden">
      <div className="flex items-center border-b border-[#21262d]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === activeTab
                ? 'text-[#e6edf3] border-b-2 border-[#238636] -mb-px bg-[#0d1117]'
                : 'text-[#8b949e] hover:text-[#e6edf3]'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1" />
        <span className="px-4 text-[10px] text-[#484f58] uppercase tracking-wider">{rightLabel}</span>
      </div>
      <div className="divide-y divide-[#21262d]">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-[#484f58] text-xs">
            Aucune donnée pour cette période
          </div>
        ) : (
          rows.map((row) => (
            <BarRow
              key={row.name}
              name={row.name}
              count={row.count}
              maxCount={maxCount}
              extra={row.extra}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Mini grid section (Countries / Devices / Browsers / OS) ─────────────────

function GridCard({ title, items, total }: {
  title: string;
  items: { name: string; count: number }[];
  total: number;
}) {
  const max = items[0]?.count || 1;
  return (
    <div className="bg-[#0d1117] border border-[#21262d] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#21262d]">
        <span className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider">
          {title}
        </span>
        <span className="text-[10px] text-[#484f58] uppercase tracking-wider">Visitors</span>
      </div>
      <div className="divide-y divide-[#21262d]">
        {items.length === 0 ? (
          <div className="px-4 py-4 text-center text-[#484f58] text-xs">—</div>
        ) : (
          items.map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 px-4 py-2 hover:bg-[#161b22] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-[#e6edf3] truncate">{item.name}</span>
                  <span className="text-[10px] text-[#484f58] ml-1 shrink-0">
                    {total > 0 ? `${Math.round((item.count / total) * 100)}%` : ''}
                  </span>
                </div>
                <div className="h-0.5 bg-[#21262d] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#238636]/70 rounded-full"
                    style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#8b949e] shrink-0 w-6 text-right">
                {item.count}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function VisitorsChart({ pageviews, days }: { pageviews: PageViewDoc[]; days: number }) {
  const data = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      map.set(d.toISOString().slice(0, 10), new Set());
    }
    for (const p of pageviews) {
      const day = new Date(p.timestamp ?? '').toISOString().slice(0, 10);
      if (map.has(day) && p.sessionId) map.get(day)!.add(p.sessionId);
    }
    return [...map.entries()].map(([date, sessions]) => ({
      label: date.slice(5).replace('-', '/'),
      visitors: sessions.size,
    }));
  }, [pageviews, days]);

  const max = Math.max(...data.map((d) => d.visitors), 1);

  return (
    <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 mb-4">
      <div className="flex items-end gap-[3px] h-28 mb-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end group relative">
            <div
              title={`${d.label}: ${d.visitors} visiteur${d.visitors !== 1 ? 's' : ''}`}
              className="w-full rounded-sm bg-[#238636]/60 hover:bg-[#3fb950] transition-colors cursor-default"
              style={{
                height: `${Math.max((d.visitors / max) * 100, d.visitors > 0 ? 6 : 1)}%`,
                minHeight: d.visitors > 0 ? '4px' : '1px',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <span className="text-[10px] text-[#484f58] font-mono">{data[0]?.label}</span>
        <span className="text-[10px] text-[#484f58] font-mono">{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// ─── Live panel ───────────────────────────────────────────────────────────────

function LivePanel({ siteId }: { siteId: string }) {
  const { visitors, lastRefresh, refresh } = useLiveVisitors(siteId);

  function activityStatus(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 35) return { label: 'actif',   color: 'text-[#3fb950]' };
    if (s < 70) return { label: '~1 min',  color: 'text-[#f0883e]' };
    return        { label: 'départ',       color: 'text-[#f85149]' };
  }

  return (
    <div className="bg-[#0d1117] border border-[#21262d] rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#21262d]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {visitors.length > 0 && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3fb950] opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              visitors.length > 0 ? 'bg-[#3fb950]' : 'bg-[#30363d]'
            }`} />
          </span>
          <span className="text-xs text-[#e6edf3] font-medium">
            {visitors.length} online
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-[#484f58] font-mono">
              {lastRefresh.toLocaleTimeString('fr-FR', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </span>
          )}
          <button
            onClick={refresh}
            className="p-1 text-[#484f58] hover:text-[#8b949e] transition-colors rounded"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {visitors.length === 0 ? (
        <div className="px-4 py-5 text-center text-[#484f58] text-xs font-mono">
          Aucun visiteur actif · màj toutes les 8s
        </div>
      ) : (
        <div className="divide-y divide-[#21262d]">
          {visitors.map((v) => {
            const s = activityStatus(v.lastSeen);
            return (
              <div key={v.sessionId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#161b22] transition-colors">
                <span className="text-base shrink-0">{countryFlag(v.countryCode)}</span>
                <span className="text-xs font-mono text-[#e6edf3] flex-1 truncate">{v.page}</span>
                <span className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 ${
                  v.isNew
                    ? 'border-[#1f6feb]/40 text-[#388bfd] bg-[#1f6feb]/10'
                    : 'border-[#6e40c9]/40 text-[#d2a8ff] bg-[#6e40c9]/10'
                }`}>
                  {v.isNew ? 'new' : 'return'}
                </span>
                <span className={`text-[10px] font-mono shrink-0 ${s.color}`}>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ params }: { params: { siteId: string } }) {
  const { siteId } = params;

  const [period, setPeriod]     = useState<'7d' | '30d' | '90d'>('7d');
  const [pageviews, setPageviews] = useState<PageViewDoc[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [pagesTab, setPagesTab] = useState('Pages');
  const [refTab, setRefTab]     = useState('Sources');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = periodToDays(period);
      const res = await fetch(`/api/analytics/${encodeURIComponent(siteId)}?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { pageviews: docs } = await res.json();
      setPageviews(docs as PageViewDoc[]);
    } catch {
      setError('Impossible de charger les données. Vérifiez votre siteId.');
    } finally {
      setLoading(false);
    }
  }, [siteId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Computed ───────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const uniqueSessions = new Set(pageviews.map((p) => p.sessionId).filter(Boolean)).size;
    const total = pageviews.length;
    const sessionCounts = new Map<string, number>();
    for (const p of pageviews) {
      if (p.sessionId) sessionCounts.set(p.sessionId, (sessionCounts.get(p.sessionId) || 0) + 1);
    }
    const bounced = [...sessionCounts.values()].filter((c) => c === 1).length;
    const bounceRate = uniqueSessions > 0 ? Math.round((bounced / uniqueSessions) * 100) : 0;
    const returningPct = uniqueSessions > 0
      ? Math.round((pageviews.filter((p) => p.isNew === false).length / Math.max(total, 1)) * 100)
      : 0;
    return { uniqueSessions, total, bounceRate, returningPct };
  }, [pageviews]);

  const topPages    = useMemo(() => topItems(pageviews.map((p) => p.page)), [pageviews]);
  const topTitles   = useMemo(() => topItems(pageviews.map((p) => p.title || '(sans titre)')), [pageviews]);
  const topSources  = useMemo(() => topItems(pageviews.map((p) => parseSource(p.referrer))), [pageviews]);
  const topRefs     = useMemo(() => topItems(pageviews.map((p) => {
    if (!p.referrer) return 'Direct';
    try { return new URL(p.referrer).hostname.replace('www.', ''); } catch { return p.referrer; }
  })), [pageviews]);

  const topCountries = useMemo(() => topItems(
    pageviews.map((p) => p.country || 'Unknown'), 6
  ).map(({ name, count }) => ({
    name: `${countryFlag(pageviews.find((p) => p.country === name)?.countryCode || '')} ${name}`,
    count,
  })), [pageviews]);

  const topDevices  = useMemo(() => topItems(pageviews.map((p) => parseDevice(p.userAgent || ''))), [pageviews]);
  const topBrowsers = useMemo(() => topItems(pageviews.map((p) => parseBrowser(p.userAgent || ''))), [pageviews]);
  const topOS       = useMemo(() => topItems(pageviews.map((p) => parseOS(p.userAgent || ''))), [pageviews]);

  const days = periodToDays(period);

  return (
    <div className="min-h-screen bg-[#010409] font-sans">

      {/* ── Top nav ── */}
      <nav className="border-b border-[#21262d] bg-[#0d1117] sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-5 h-5 rounded-md bg-[#238636] flex items-center justify-center text-white font-bold text-[10px]">
              P
            </div>
            <span className="text-[#e6edf3] font-semibold">Poyne</span>
            <span className="text-[#30363d]">/</span>
            <span className="text-[#8b949e] font-mono text-xs">{siteId}</span>
          </div>
          <span className="text-[10px] text-[#484f58] font-mono hidden sm:block">Analytics Dashboard</span>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-5">

        {/* ── Site header row ── */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#8b949e] font-mono bg-[#161b22] border border-[#30363d] px-2.5 py-1 rounded-md">
              {siteId}
            </span>
            <span className="text-[10px] text-[#484f58]">Production</span>
          </div>

          {/* Period selector */}
          <div className="flex bg-[#161b22] border border-[#30363d] rounded-lg p-0.5 gap-0.5">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  period === p
                    ? 'bg-[#21262d] text-[#e6edf3] shadow-sm'
                    : 'text-[#8b949e] hover:text-[#e6edf3]'
                }`}
              >
                {p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : 'Last 90 Days'}
              </button>
            ))}
            <button
              onClick={fetchData}
              className="px-2 py-1.5 text-[#8b949e] hover:text-[#e6edf3] transition-colors"
              title="Rafraîchir"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-[#f85149]/10 border border-[#f85149]/30 rounded-xl text-sm text-[#f85149] flex items-center gap-2">
            <span>⚠</span> {error}
          </div>
        )}

        {/* ── 4 stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            {
              label: 'Visitors',
              value: loading ? '—' : stats.uniqueSessions.toLocaleString(),
              sub: `${days}d sessions uniques`,
            },
            {
              label: 'Page Views',
              value: loading ? '—' : stats.total.toLocaleString(),
              sub: 'total événements',
            },
            {
              label: 'Bounce Rate',
              value: loading ? '—' : `${stats.bounceRate}%`,
              sub: 'sessions 1 page',
            },
            {
              label: 'Returning',
              value: loading ? '—' : `${stats.returningPct}%`,
              sub: 'visiteurs retour',
            },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4">
              <div className="text-[10px] font-semibold text-[#8b949e] uppercase tracking-wider mb-1.5">
                {label}
              </div>
              <div className="text-2xl font-bold text-[#e6edf3] font-mono leading-none mb-1">
                {value}
              </div>
              <div className="text-[10px] text-[#484f58]">{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Chart ── */}
        <VisitorsChart pageviews={pageviews} days={days} />

        {/* ── Live panel ── */}
        <LivePanel siteId={siteId} />

        {/* ── Pages / Sources ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <SectionCard
            tabs={['Pages', 'Titres']}
            activeTab={pagesTab}
            onTabChange={setPagesTab}
            rows={pagesTab === 'Pages' ? topPages : topTitles}
            maxCount={(pagesTab === 'Pages' ? topPages : topTitles)[0]?.count || 1}
          />
          <SectionCard
            tabs={['Sources', 'Referrers']}
            activeTab={refTab}
            onTabChange={setRefTab}
            rows={refTab === 'Sources' ? topSources : topRefs}
            maxCount={(refTab === 'Sources' ? topSources : topRefs)[0]?.count || 1}
          />
        </div>

        {/* ── 4-col grid ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GridCard title="Countries" items={topCountries} total={stats.uniqueSessions} />
          <GridCard title="Devices"   items={topDevices}   total={stats.uniqueSessions} />
          <GridCard title="Browsers"  items={topBrowsers}  total={stats.uniqueSessions} />
          <GridCard title="OS"        items={topOS}        total={stats.uniqueSessions} />
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-[10px] text-[#484f58] font-mono">
          Poyne Analytics · {siteId} · màj auto toutes les 15s
        </div>
      </div>
    </div>
  );
}
