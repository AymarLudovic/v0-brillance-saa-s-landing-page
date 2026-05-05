"use client"
// Place at: app/admin/contacts/page.tsx

import { useState, useRef } from "react"

const ADMIN_EMAIL = "ludovicaymar8@gmail.com"

// ── Types ──────────────────────────────────────────────────────────────────
type Mode = "csv" | "api"
type Status = "idle" | "loading" | "ok" | "error"

interface ContactRow {
  email: string
  status: Status
  message: string
}

// ── Helpers ────────────────────────────────────────────────────────────────
const isValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function buildCSV(emails: string[]): string {
  return ["EMAIL", ...emails].join("\r\n")
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ContactsPage() {
  const [mode, setMode] = useState<Mode>("csv")
  const [apiKey, setApiKey] = useState("")
  const [listId, setListId] = useState("")
  const [input, setInput] = useState("")
  const [rows, setRows] = useState<ContactRow[]>([])
  const [toast, setToast] = useState("")
  const [globalStatus, setGlobalStatus] = useState<Status>("idle")
  const inputRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(""), 2500)
  }

  // Add one or multiple emails from the input
  const addEmails = () => {
    const raw = input.split(/[\n,;]/).map(s => s.trim()).filter(Boolean)
    if (!raw.length) return
    const existing = new Set(rows.map(r => r.email.toLowerCase()))
    let added = 0
    const newRows: ContactRow[] = []
    for (const e of raw) {
      if (!isValid(e)) continue
      if (existing.has(e.toLowerCase())) continue
      existing.add(e.toLowerCase())
      newRows.push({ email: e.trim(), status: "idle", message: "" })
      added++
    }
    if (added) {
      setRows(prev => [...prev, ...newRows])
      showToast(`${added} email${added > 1 ? "s" : ""} added`)
    }
    setInput("")
    inputRef.current?.focus()
  }

  const remove = (idx: number) =>
    setRows(prev => prev.filter((_, i) => i !== idx))

  const clearAll = () => { setRows([]); setGlobalStatus("idle") }

  // ── CSV download ───────────────────────────────────────────────────────
  const handleDownloadCSV = () => {
    if (!rows.length) return
    downloadFile(buildCSV(rows.map(r => r.email)), `brevo-${new Date().toISOString().split("T")[0]}.csv`)
    showToast("CSV downloaded!")
  }

  // ── Send to Brevo API one by one ───────────────────────────────────────
  const sendToBrevo = async () => {
    if (!apiKey.trim()) return showToast("Enter your Brevo API key first.")
    if (!rows.length) return
    setGlobalStatus("loading")

    const pending = rows.map((_, i) => i)
    let ok = 0, fail = 0

    for (const idx of pending) {
      const email = rows[idx].email
      setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "loading", message: "" } : r))
      try {
        const body: Record<string, unknown> = { email }
        if (listId.trim()) body.listIds = [parseInt(listId.trim())]

        const res = await fetch("https://api.brevo.com/v3/contacts", {
          method: "POST",
          headers: {
            "api-key": apiKey.trim(),
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (res.ok || res.status === 204) {
          setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "ok", message: "Added" } : r))
          ok++
        } else {
          const data = await res.json().catch(() => ({}))
          const msg = data?.message || `HTTP ${res.status}`
          // 400 with "Contact already exist" is not really an error
          if (msg.toLowerCase().includes("already exist")) {
            setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "ok", message: "Already exists" } : r))
            ok++
          } else {
            setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "error", message: msg } : r))
            fail++
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Network error"
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, status: "error", message: msg } : r))
        fail++
      }
    }

    setGlobalStatus(fail === 0 ? "ok" : ok > 0 ? "ok" : "error")
    showToast(`Done — ${ok} added${fail ? `, ${fail} failed` : ""}`)
  }

  const pendingCount = rows.filter(r => r.status === "idle").length
  const doneCount = rows.filter(r => r.status === "ok").length

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f9f9f7",
      fontFamily: "'DM Mono', monospace",
      padding: "40px 16px 80px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input { outline: none; }
        input::placeholder { color: #bbb; }
        .remove-btn { opacity: 0; transition: opacity 0.15s; background: none; border: none; cursor: pointer; padding: 2px 6px; color: #aaa; font-size: 16px; }
        .row:hover .remove-btn { opacity: 1; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#111", color: "#fff", fontSize: 12, padding: "10px 18px",
          borderRadius: 8, zIndex: 999, letterSpacing: "0.03em", whiteSpace: "nowrap",
        }}>{toast}</div>
      )}

      <div style={{ maxWidth: 560, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px", letterSpacing: "-0.02em", color: "#111" }}>
            Brevo contacts
          </h1>
          <p style={{ fontSize: 11, color: "#aaa", margin: 0, letterSpacing: "0.03em" }}>
            ADMIN — {ADMIN_EMAIL}
          </p>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: "inline-flex", background: "#eee", borderRadius: 8, padding: 3, marginBottom: 20,
        }}>
          {(["csv", "api"] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 11, fontFamily: "inherit", fontWeight: 500, letterSpacing: "0.04em",
              textTransform: "uppercase",
              background: mode === m ? "#111" : "transparent",
              color: mode === m ? "#fff" : "#888",
              transition: "all 0.15s",
            }}>
              {m === "csv" ? "Export CSV" : "Send to Brevo"}
            </button>
          ))}
        </div>

        {/* API mode config */}
        {mode === "api" && (
          <div style={{
            background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10,
            padding: 16, marginBottom: 16,
          }}>
            <label style={{ fontSize: 10, color: "#aaa", display: "block", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Brevo API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="xkeysib-..."
              style={{
                width: "100%", border: "1px solid #e8e8e8", borderRadius: 7,
                padding: "8px 12px", fontSize: 12, fontFamily: "inherit",
                color: "#111", marginBottom: 10, background: "#fafafa",
              }}
            />
            <label style={{ fontSize: 10, color: "#aaa", display: "block", marginBottom: 5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              List ID <span style={{ color: "#ccc" }}>(optional)</span>
            </label>
            <input
              type="text"
              value={listId}
              onChange={e => setListId(e.target.value)}
              placeholder="e.g. 3  — leave empty to add without list"
              style={{
                width: "100%", border: "1px solid #e8e8e8", borderRadius: 7,
                padding: "8px 12px", fontSize: 12, fontFamily: "inherit",
                color: "#111", background: "#fafafa",
              }}
            />
            <p style={{ fontSize: 10, color: "#bbb", margin: "8px 0 0", letterSpacing: "0.02em" }}>
              Brevo → Settings → API Keys → Generate a new API key
            </p>
          </div>
        )}

        {/* Email input */}
        <div style={{
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10, padding: 16, marginBottom: 12,
        }}>
          <label style={{ fontSize: 10, color: "#aaa", display: "block", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Add emails — one per line, or comma-separated
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && addEmails()}
              placeholder="user@example.com"
              style={{
                flex: 1, border: "1px solid #e8e8e8", borderRadius: 7,
                padding: "9px 12px", fontSize: 13, fontFamily: "inherit", color: "#111",
              }}
            />
            <button onClick={addEmails} style={{
              padding: "0 18px", background: "#111", color: "#fff", border: "none",
              borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.02em", whiteSpace: "nowrap",
            }}>Add</button>
          </div>
        </div>

        {/* List */}
        {rows.length > 0 && (
          <div style={{
            background: "#fff", border: "1px solid #e8e8e8", borderRadius: 10,
            overflow: "hidden", marginBottom: 14,
          }}>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {rows.map((r, i) => (
                <div key={i} className="row" style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderBottom: i < rows.length - 1 ? "1px solid #f0f0f0" : "none",
                }}>
                  {/* Status dot */}
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: r.status === "ok" ? "#22c55e" : r.status === "error" ? "#ef4444" : r.status === "loading" ? "#facc15" : "#ddd",
                  }} />
                  <span style={{ flex: 1, fontSize: 13, color: "#333", letterSpacing: "-0.01em" }}>{r.email}</span>
                  {r.message && (
                    <span style={{ fontSize: 10, color: r.status === "error" ? "#ef4444" : "#aaa", letterSpacing: "0.02em" }}>
                      {r.message}
                    </span>
                  )}
                  {r.status === "loading" ? (
                    <span style={{ fontSize: 11, color: "#bbb" }}>…</span>
                  ) : (
                    <button className="remove-btn" onClick={() => remove(i)}>×</button>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{
              padding: "9px 14px", borderTop: "1px solid #f0f0f0",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 11, color: "#bbb" }}>
                {rows.length} email{rows.length !== 1 ? "s" : ""}
                {doneCount > 0 && ` · ${doneCount} sent`}
              </span>
              <button onClick={clearAll} style={{
                background: "none", border: "none", fontSize: 11, color: "#ccc",
                cursor: "pointer", fontFamily: "inherit", padding: 0,
              }}>Clear all</button>
            </div>
          </div>
        )}

        {/* Action button */}
        {rows.length > 0 && (
          <button
            onClick={mode === "csv" ? handleDownloadCSV : sendToBrevo}
            disabled={globalStatus === "loading" || (mode === "api" && !apiKey.trim())}
            style={{
              width: "100%", height: 44, background: "#111", color: "#fff", border: "none",
              borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.02em",
              opacity: (globalStatus === "loading" || (mode === "api" && !apiKey.trim())) ? 0.5 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {globalStatus === "loading"
              ? "Sending…"
              : mode === "csv"
              ? `Download CSV (${rows.length} email${rows.length !== 1 ? "s" : ""})`
              : `Send ${pendingCount} contact${pendingCount !== 1 ? "s" : ""} to Brevo`}
          </button>
        )}

        {mode === "csv" && rows.length > 0 && (
          <p style={{ fontSize: 10, color: "#ccc", textAlign: "center", marginTop: 12, letterSpacing: "0.02em" }}>
            Brevo → CRM → Contacts → Import contacts → Upload file
          </p>
        )}

      </div>
    </div>
  )
}
