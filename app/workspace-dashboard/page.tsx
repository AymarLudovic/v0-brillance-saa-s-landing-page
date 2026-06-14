"use client";
// app/workspace-dashboard/page.tsx
// Dashboard live pour Claude Workspace MCP
// Refresh auto toutes les 3 secondes

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Agent {
  agent_id:     string;
  status:       string;
  current_task: string;
  last_seen:    number;
}

interface Task {
  id:          string;
  description: string;
  claimed_by:  string;
  claimed_at:  number;
}

interface HistoryEntry {
  action:    string;
  agent:     string;
  detail:    string;
  timestamp: number;
}

interface Broadcast {
  from:    string;
  message: string;
  sent_at: number;
}

interface WorkspaceData {
  id:      string;
  context: { summary: string; progress: string; updated_by: string; updated_at: number } | null;
  agents:  Agent[];
  tasks:   Task[];
  history: HistoryEntry[];
  bcasts:  Broadcast[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
};

const ACTION_COLORS: Record<string, string> = {
  save_context:   "#7B61FF",
  register_agent: "#10B981",
  claim_task:     "#F59E0B",
  release_task:   "#3B82F6",
  broadcast:      "#EC4899",
  request_review: "#8B5CF6",
  review_approved:"#10B981",
  review_rejected:"#EF4444",
  use_template:   "#06B6D4",
};

// ── Components ────────────────────────────────────────────────────────────────
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600,
    }}>{children}</span>
  );
}

function WorkspaceCard({ ws }: { ws: WorkspaceData }) {
  const [tab, setTab] = useState<"overview"|"history"|"broadcasts">("overview");

  return (
    <div style={{
      background: "#12111f", border: "1px solid rgba(123,97,255,.2)",
      borderRadius: 14, overflow: "hidden", marginBottom: 20,
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#1e1b3a,#12111f)",
        padding: "14px 18px", display: "flex", alignItems: "center",
        justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🗂️</span>
          <span style={{ color: "#F0EFF4", fontWeight: 700, fontSize: 15 }}>{ws.id}</span>
          <Badge color="#7B61FF">{ws.agents.length} agents</Badge>
          <Badge color="#F59E0B">{ws.tasks.length} tasks locked</Badge>
        </div>
        <span style={{ color: "rgba(255,255,255,.3)", fontSize: 11 }}>
          {ws.context ? `Updated ${ago(ws.context.updated_at)} by ${ws.context.updated_by}` : "No context yet"}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        {(["overview","history","broadcasts"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "8px 16px", fontSize: 12, fontWeight: 600,
            color: tab === t ? "#7B61FF" : "rgba(255,255,255,.35)",
            borderBottom: tab === t ? "2px solid #7B61FF" : "2px solid transparent",
          }}>{t.toUpperCase()}</button>
        ))}
      </div>

      <div style={{ padding: 18 }}>
        {/* Overview tab */}
        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Context */}
            <div style={{ gridColumn: "1 / -1" }}>
              {ws.context ? (
                <div style={{ background: "rgba(123,97,255,.06)", borderRadius: 8, padding: 12 }}>
                  <div style={{ color: "rgba(255,255,255,.4)", fontSize: 10, marginBottom: 6 }}>CONTEXT</div>
                  <div style={{ color: "#F0EFF4", fontSize: 13, marginBottom: 4 }}>{ws.context.summary}</div>
                  <div style={{ color: "#7B61FF", fontSize: 12 }}>→ {ws.context.progress}</div>
                </div>
              ) : (
                <div style={{ color: "rgba(255,255,255,.25)", fontSize: 12 }}>No context saved yet</div>
              )}
            </div>

            {/* Agents */}
            <div>
              <div style={{ color: "rgba(255,255,255,.4)", fontSize: 10, marginBottom: 8 }}>ACTIVE AGENTS</div>
              {ws.agents.length === 0
                ? <div style={{ color: "rgba(255,255,255,.2)", fontSize: 12 }}>No agents registered</div>
                : ws.agents.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#7B61FF", display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
                    }}>{a.agent_id?.[0]?.toUpperCase() ?? "?"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#F0EFF4", fontSize: 12, fontWeight: 600 }}>{a.agent_id}</div>
                      <div style={{ color: "rgba(255,255,255,.35)", fontSize: 10 }}>
                        {a.status} {a.current_task ? `· ${a.current_task}` : ""}
                      </div>
                    </div>
                    <span style={{ color: "rgba(255,255,255,.25)", fontSize: 10 }}>{ago(a.last_seen)}</span>
                  </div>
                ))
              }
            </div>

            {/* Tasks */}
            <div>
              <div style={{ color: "rgba(255,255,255,.4)", fontSize: 10, marginBottom: 8 }}>LOCKED TASKS</div>
              {ws.tasks.length === 0
                ? <div style={{ color: "rgba(255,255,255,.2)", fontSize: 12 }}>No tasks claimed</div>
                : ws.tasks.map((t, i) => (
                  <div key={i} style={{
                    padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#F59E0B", fontSize: 12, fontWeight: 600 }}>🔒 {t.id}</span>
                      <span style={{ color: "rgba(255,255,255,.25)", fontSize: 10 }}>{ago(t.claimed_at)}</span>
                    </div>
                    <div style={{ color: "rgba(255,255,255,.35)", fontSize: 10, marginTop: 2 }}>
                      by {t.claimed_by} · {t.description?.slice(0, 50)}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* History tab */}
        {tab === "history" && (
          <div>
            {ws.history.length === 0
              ? <div style={{ color: "rgba(255,255,255,.2)", fontSize: 12 }}>No history yet</div>
              : ws.history.map((h, i) => (
                <div key={i} style={{
                  display: "flex", gap: 10, padding: "6px 0",
                  borderBottom: "1px solid rgba(255,255,255,.04)",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                    background: ACTION_COLORS[h.action] ?? "#666",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{
                        color: ACTION_COLORS[h.action] ?? "#888",
                        fontSize: 11, fontWeight: 600,
                      }}>{h.action}</span>
                      <span style={{ color: "rgba(255,255,255,.25)", fontSize: 10 }}>{ago(h.timestamp)}</span>
                    </div>
                    <div style={{ color: "rgba(255,255,255,.5)", fontSize: 11 }}>
                      <span style={{ color: "#A78BFA" }}>{h.agent}</span> · {h.detail}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Broadcasts tab */}
        {tab === "broadcasts" && (
          <div>
            {ws.bcasts.length === 0
              ? <div style={{ color: "rgba(255,255,255,.2)", fontSize: 12 }}>No broadcasts yet</div>
              : ws.bcasts.map((b, i) => (
                <div key={i} style={{
                  background: "rgba(236,72,153,.06)", border: "1px solid rgba(236,72,153,.15)",
                  borderRadius: 8, padding: 10, marginBottom: 8,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "#EC4899", fontSize: 11, fontWeight: 600 }}>📢 {b.from}</span>
                    <span style={{ color: "rgba(255,255,255,.25)", fontSize: 10 }}>{ago(b.sent_at)}</span>
                  </div>
                  <div style={{ color: "#F0EFF4", fontSize: 13 }}>{b.message}</div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function WorkspaceDashboard() {
  const [data, setData]       = useState<{ workspaces: WorkspaceData[]; updated_at: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [pulse, setPulse]     = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace-status");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
      setPulse(p => !p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, 3000);
    return () => clearInterval(interval);
  }, [fetch_]);

  return (
    <div style={{
      minHeight: "100vh", background: "#0d0d18", fontFamily: "sans-serif",
      padding: "24px 20px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ color: "#F0EFF4", fontSize: 22, fontWeight: 800, margin: 0 }}>
            Claude Workspace
          </h1>
          <p style={{ color: "rgba(255,255,255,.35)", fontSize: 13, margin: "4px 0 0" }}>
            Live dashboard · Refresh toutes les 3s
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Live pulse indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: error ? "#EF4444" : "#10B981",
              boxShadow: error ? "none" : `0 0 0 3px rgba(16,185,129,${pulse ? ".3" : ".1"})`,
              transition: "box-shadow .3s",
            }} />
            <span style={{ color: "rgba(255,255,255,.4)", fontSize: 11 }}>
              {error ? "Error" : "Live"}
            </span>
          </div>
          {data && (
            <span style={{ color: "rgba(255,255,255,.2)", fontSize: 11 }}>
              {new Date(data.updated_at).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      {data && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Workspaces", value: data.workspaces.length, color: "#7B61FF" },
            { label: "Active Agents", value: data.workspaces.reduce((s, w) => s + w.agents.length, 0), color: "#10B981" },
            { label: "Locked Tasks", value: data.workspaces.reduce((s, w) => s + w.tasks.length, 0), color: "#F59E0B" },
            { label: "Total Actions", value: data.workspaces.reduce((s, w) => s + w.history.length, 0), color: "#A78BFA" },
          ].map((stat, i) => (
            <div key={i} style={{
              flex: 1, background: "#12111f", border: `1px solid ${stat.color}22`,
              borderRadius: 10, padding: "12px 16px",
            }}>
              <div style={{ color: stat.color, fontSize: 22, fontWeight: 800 }}>{stat.value}</div>
              <div style={{ color: "rgba(255,255,255,.35)", fontSize: 11 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading && (
        <div style={{ textAlign: "center", color: "rgba(255,255,255,.3)", padding: 40 }}>
          Loading workspaces…
        </div>
      )}

      {error && (
        <div style={{
          background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)",
          borderRadius: 10, padding: 16, color: "#FCA5A5", marginBottom: 20,
        }}>
          ⚠️ {error} — Vérifie les env vars UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN
        </div>
      )}

      {data?.workspaces.length === 0 && !loading && (
        <div style={{
          textAlign: "center", color: "rgba(255,255,255,.2)", padding: 60,
          border: "1px dashed rgba(255,255,255,.08)", borderRadius: 14,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🗂️</div>
          <div style={{ fontSize: 15 }}>Aucun workspace actif</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Connecte ton MCP et lance save_context ou use_workflow_template
          </div>
        </div>
      )}

      {data?.workspaces.map((ws) => (
        <WorkspaceCard key={ws.id} ws={ws} />
      ))}
    </div>
  );
  }
