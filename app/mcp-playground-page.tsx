"use client";

import { useState, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

interface LogEntry {
  id: number;
  type: "info" | "sent" | "received" | "error" | "success";
  text: string;
  ts: string;
}

type ConnStatus = "idle" | "connecting" | "connected" | "error";

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 1;
const nextId = () => _id++;
const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

// ── Main Component ───────────────────────────────────────────────────────────

export default function MCPPlayground() {
  const [serverUrl, setServerUrl]   = useState("");
  const [status, setStatus]         = useState<ConnStatus>("idle");
  const [tools, setTools]           = useState<MCPTool[]>([]);
  const [selected, setSelected]     = useState<MCPTool | null>(null);
  const [params, setParams]         = useState<Record<string, string>>({});
  const [logs, setLogs]             = useState<LogEntry[]>([]);
  const [calling, setCalling]       = useState(false);
  const [mobileView, setMobileView] = useState<"tools" | "call" | "logs">("tools");
  const logsEndRef                  = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry["type"], text: string) => {
    setLogs(prev => {
      const entry: LogEntry = { id: nextId(), type, text, ts: ts() };
      const next = [...prev, entry];
      setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      return next;
    });
  }, []);

  // ── MCP call via proxy ────────────────────────────────────────────────────

  const mcpCall = useCallback(async (method: string, mcpParams: unknown = {}) => {
    const body = JSON.stringify({ url: serverUrl, method, params: mcpParams });
    addLog("sent", `→ ${method} ${JSON.stringify(mcpParams) === "{}" ? "" : JSON.stringify(mcpParams)}`);
    const res = await fetch("/api/mcp-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
    return data.result;
  }, [serverUrl, addLog]);

  // ── Connect ───────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    if (!serverUrl.trim()) return;
    setStatus("connecting");
    setTools([]);
    setSelected(null);
    setLogs([]);
    addLog("info", `Connecting to ${serverUrl}…`);

    try {
      await mcpCall("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        clientInfo: { name: "MCP Playground", version: "1.0.0" },
      });
      addLog("success", "✓ Initialized");

      const result = await mcpCall("tools/list", {});
      const list: MCPTool[] = result?.tools ?? [];
      setTools(list);
      setStatus("connected");
      addLog("success", `✓ ${list.length} tool${list.length !== 1 ? "s" : ""} discovered`);
      if (list.length > 0) {
        setSelected(list[0]);
        setMobileView("call");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("error");
      addLog("error", `✗ ${msg}`);
    }
  }, [serverUrl, mcpCall, addLog]);

  // ── Call tool ─────────────────────────────────────────────────────────────

  const handleCall = useCallback(async () => {
    if (!selected || calling) return;
    setCalling(true);
    setMobileView("logs");
    addLog("info", `Calling tool: ${selected.name}`);

    // Build typed args
    const args: Record<string, unknown> = {};
    const props = selected.inputSchema?.properties ?? {};
    for (const [key, schema] of Object.entries(props)) {
      const raw = params[key] ?? "";
      args[key] = schema.type === "number" ? Number(raw)
        : schema.type === "boolean" ? raw === "true"
        : raw;
    }

    try {
      const result = await mcpCall("tools/call", { name: selected.name, arguments: args });
      const content = result?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "text") addLog("received", c.text);
          else addLog("received", JSON.stringify(c, null, 2));
        }
      } else {
        addLog("received", JSON.stringify(result, null, 2));
      }
      addLog("success", `✓ ${selected.name} returned`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog("error", `✗ ${msg}`);
    } finally {
      setCalling(false);
    }
  }, [selected, calling, params, mcpCall, addLog]);

  // ── Select tool ───────────────────────────────────────────────────────────

  const selectTool = useCallback((tool: MCPTool) => {
    setSelected(tool);
    setParams({});
    setMobileView("call");
  }, []);

  // ── Status dot ────────────────────────────────────────────────────────────

  const dotColor = {
    idle: "#4B4B60",
    connecting: "#F59E0B",
    connected: "#00D68F",
    error: "#FF4757",
  }[status];

  const dotPulse = status === "connecting" || status === "connected";

  // ── Log colors ────────────────────────────────────────────────────────────

  const logColor = {
    info:     "rgba(240,239,244,0.4)",
    sent:     "#7B61FF",
    received: "#00D68F",
    error:    "#FF4757",
    success:  "#00D68F",
  };

  const logPrefix = { info: "  ", sent: "↑ ", received: "↓ ", error: "✗ ", success: "✓ " };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0D0D0F",
        color: "#F0EFF4",
        fontFamily: "'Inter', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.7; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .tool-card:hover { background: rgba(123,97,255,0.08) !important; border-color: rgba(123,97,255,0.25) !important; }
        .tool-card.active { background: rgba(123,97,255,0.12) !important; border-color: rgba(123,97,255,0.4) !important; }
      `}</style>

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          background: "#111113",
          flexShrink: 0,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#7B61FF,#A78BFA)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="2" fill="white" opacity=".9"/>
              <circle cx="12" cy="4" r="2" fill="white" opacity=".9"/>
              <circle cx="4" cy="12" r="2" fill="white" opacity=".9"/>
              <circle cx="12" cy="12" r="2" fill="white" opacity=".9"/>
              <path d="M4 6v4M6 4h4M6 12h4M10 6v4" stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity=".6"/>
            </svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>MCP Playground</span>
        </div>

        {/* URL input */}
        <div style={{ flex: 1, minWidth: 220, display: "flex", gap: 8 }}>
          <input
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleConnect()}
            placeholder="https://your-app.vercel.app/api/mcp"
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 8,
              padding: "7px 12px",
              color: "#F0EFF4",
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              outline: "none",
            }}
          />
          <button
            onClick={handleConnect}
            disabled={status === "connecting" || !serverUrl.trim()}
            style={{
              background: status === "connecting" ? "rgba(123,97,255,0.3)" : "#7B61FF",
              border: "none",
              borderRadius: 8,
              padding: "7px 16px",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: status === "connecting" ? "not-allowed" : "pointer",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all .15s",
            }}
          >
            {status === "connecting" ? (
              <>
                <span style={{ width: 12, height: 12, border: "1.5px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                Connecting…
              </>
            ) : "Connect"}
          </button>
        </div>

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          <div style={{ position: "relative", width: 10, height: 10 }}>
            {dotPulse && (
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: dotColor, animation: "pulse-ring 1.8s ease-out infinite",
              }} />
            )}
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: dotColor }} />
          </div>
          <span style={{ fontSize: 12, color: "rgba(240,239,244,0.45)", fontWeight: 500 }}>
            {status === "idle" ? "Not connected"
              : status === "connecting" ? "Connecting…"
              : status === "connected" ? `Connected · ${tools.length} tools`
              : "Connection failed"}
          </span>
        </div>
      </div>

      {/* ── Mobile nav ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "none",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "#111113",
        }}
        className="mcp-mobile-nav"
      >
        <style>{`
          @media (max-width: 768px) {
            .mcp-mobile-nav { display: flex !important; }
            .mcp-desktop { display: none !important; }
            .mcp-mobile { display: flex !important; }
          }
          @media (min-width: 769px) {
            .mcp-mobile { display: none !important; }
          }
        `}</style>
        {(["tools", "call", "logs"] as const).map(v => (
          <button
            key={v}
            onClick={() => setMobileView(v)}
            style={{
              flex: 1,
              padding: "10px 0",
              background: "none",
              border: "none",
              borderBottom: mobileView === v ? "2px solid #7B61FF" : "2px solid transparent",
              color: mobileView === v ? "#7B61FF" : "rgba(240,239,244,0.4)",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "capitalize",
              cursor: "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {v === "tools" ? `Tools ${tools.length > 0 ? `(${tools.length})` : ""}` : v === "call" ? "Call" : "Log"}
          </button>
        ))}
      </div>

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* ── Left: Tools list ────────────────────────────────────────── */}
        <div
          className="mcp-mobile"
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.06)",
            display: mobileView === "tools" ? "flex" : "none",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "14px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(240,239,244,0.35)", textTransform: "uppercase" }}>
              Tools
            </span>
            {tools.length > 0 && (
              <span style={{ fontSize: 11, background: "rgba(123,97,255,0.2)", color: "#A78BFA", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
                {tools.length}
              </span>
            )}
          </div>

          {tools.length === 0 && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, color: "rgba(240,239,244,0.2)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="18" y="4" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="4" y="18" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <rect x="18" y="18" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span style={{ fontSize: 12, textAlign: "center", lineHeight: 1.6 }}>
                Connect to a server<br />to see its tools
              </span>
            </div>
          )}

          <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
            {tools.map(tool => (
              <button
                key={tool.name}
                onClick={() => selectTool(tool)}
                className={`tool-card${selected?.name === tool.name ? " active" : ""}`}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "1px solid transparent",
                  borderRadius: 8,
                  padding: "10px 12px",
                  cursor: "pointer",
                  transition: "all .12s",
                  color: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: selected?.name === tool.name ? "#A78BFA" : "#F0EFF4", marginBottom: 3 }}>
                  {tool.name}
                </div>
                {tool.description && (
                  <div style={{ fontSize: 11, color: "rgba(240,239,244,0.4)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {tool.description}
                  </div>
                )}
                {tool.inputSchema?.properties && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {Object.keys(tool.inputSchema.properties).map(p => (
                      <span key={p} style={{ fontSize: 10, background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px", color: "rgba(240,239,244,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Center: Call panel ──────────────────────────────────────── */}
        <div
          className="mcp-mobile"
          style={{
            flex: 1,
            display: mobileView === "call" ? "flex" : "none",
            flexDirection: "column",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          {!selected ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(240,239,244,0.2)" }}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <path d="M20 8v24M8 20h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".4"/>
                <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"/>
              </svg>
              <span style={{ fontSize: 13 }}>Select a tool to call it</span>
            </div>
          ) : (
            <>
              {/* Tool header */}
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#7B61FF", flexShrink: 0 }} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 500, color: "#A78BFA" }}>
                    {selected.name}
                  </span>
                </div>
                {selected.description && (
                  <p style={{ fontSize: 12, color: "rgba(240,239,244,0.5)", lineHeight: 1.6, paddingLeft: 15 }}>
                    {selected.description}
                  </p>
                )}
              </div>

              {/* Params */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                {Object.keys(selected.inputSchema?.properties ?? {}).length === 0 ? (
                  <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ fontSize: 12, color: "rgba(240,239,244,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>
                      // No parameters required
                    </span>
                  </div>
                ) : (
                  Object.entries(selected.inputSchema!.properties!).map(([key, schema]) => {
                    const isRequired = selected.inputSchema?.required?.includes(key);
                    return (
                      <div key={key}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#A78BFA", fontWeight: 500 }}>
                            {key}
                          </span>
                          <span style={{ fontSize: 10, color: "rgba(240,239,244,0.3)", fontFamily: "'JetBrains Mono', monospace" }}>
                            {schema.type}
                          </span>
                          {isRequired && (
                            <span style={{ fontSize: 10, color: "#FF4757", fontWeight: 700 }}>*</span>
                          )}
                        </label>
                        {schema.description && (
                          <p style={{ fontSize: 11, color: "rgba(240,239,244,0.4)", marginBottom: 6, lineHeight: 1.5 }}>
                            {schema.description}
                          </p>
                        )}
                        {schema.enum ? (
                          <select
                            value={params[key] ?? ""}
                            onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                            style={{
                              width: "100%",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 7,
                              padding: "8px 12px",
                              color: "#F0EFF4",
                              fontSize: 13,
                              fontFamily: "'JetBrains Mono', monospace",
                              outline: "none",
                            }}
                          >
                            <option value="">Select…</option>
                            {schema.enum.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : schema.type === "boolean" ? (
                          <select
                            value={params[key] ?? ""}
                            onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                            style={{
                              width: "100%",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 7,
                              padding: "8px 12px",
                              color: "#F0EFF4",
                              fontSize: 13,
                              fontFamily: "'JetBrains Mono', monospace",
                              outline: "none",
                            }}
                          >
                            <option value="">Select…</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            type={schema.type === "number" ? "number" : "text"}
                            value={params[key] ?? ""}
                            onChange={e => setParams(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={`Enter ${key}…`}
                            style={{
                              width: "100%",
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 7,
                              padding: "8px 12px",
                              color: "#F0EFF4",
                              fontSize: 13,
                              fontFamily: "'JetBrains Mono', monospace",
                              outline: "none",
                            }}
                          />
                        )}
                      </div>
                    );
                  })
                )}

                {/* Call button */}
                <button
                  onClick={handleCall}
                  disabled={calling || status !== "connected"}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    background: calling || status !== "connected"
                      ? "rgba(123,97,255,0.2)"
                      : "linear-gradient(135deg,#7B61FF,#9B89FF)",
                    border: "none",
                    borderRadius: 9,
                    padding: "11px 0",
                    color: calling || status !== "connected" ? "rgba(240,239,244,0.4)" : "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: calling || status !== "connected" ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    transition: "all .15s",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {calling ? (
                    <>
                      <span style={{ width: 13, height: 13, border: "1.5px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                      Calling…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M4 8h8M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Run {selected.name}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Right: Log output ───────────────────────────────────────── */}
        <div
          className="mcp-mobile"
          style={{
            flex: 1,
            display: mobileView === "logs" ? "flex" : "none",
            flexDirection: "column",
            background: "#0A0A0C",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(240,239,244,0.3)", textTransform: "uppercase" }}>
              Output
            </span>
            {logs.length > 0 && (
              <button
                onClick={() => setLogs([])}
                style={{ background: "none", border: "none", color: "rgba(240,239,244,0.25)", fontSize: 11, cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            {logs.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(240,239,244,0.15)", marginTop: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                  {">"} Waiting for activity…
                </span>
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(240,239,244,0.2)", flexShrink: 0, paddingTop: 2, minWidth: 64 }}>
                    {log.ts}
                  </span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                    color: logColor[log.type],
                    lineHeight: 1.7,
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                  }}>
                    {logPrefix[log.type]}{log.text}
                  </span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* ── Desktop 3-column layout ─────────────────────────────────── */}
        <style>{`
          @media (min-width: 769px) {
            .mcp-mobile { display: flex !important; }
          }
        `}</style>
      </div>
    </div>
  );
}
