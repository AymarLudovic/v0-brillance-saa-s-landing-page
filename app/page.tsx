"use client"

import { useState } from "react"

type Log = {
  type: "step" | "info" | "error"
  message: string
}

export default function HomePage() {
  const [idea, setIdea] = useState("")
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  async function runGeneration() {
    setLoading(true)
    setLogs([])
    setResult(null)
    setError(null)

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Unknown error")
      }

      if (data.logs) {
        setLogs(data.logs)
      }

      if (data.pkg || data.plan) {
        setResult(data)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>AI App Generator</h1>

      {/* INPUT */}
      <textarea
        placeholder="Describe your app idea..."
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        rows={4}
        style={{ width: "100%", marginBottom: 12 }}
      />

      <button onClick={runGeneration} disabled={loading}>
        {loading ? "Generating..." : "Generate"}
      </button>

      {/* LOGS */}
      {logs.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Logs</h2>

          <div
            style={{
              background: "#0d1117",
              color: "#c9d1d9",
              padding: 12,
              borderRadius: 6,
              fontFamily: "monospace",
              fontSize: 13,
              maxHeight: 300,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  color:
                    log.type === "error"
                      ? "#ff7b72"
                      : log.type === "step"
                      ? "#79c0ff"
                      : "#a5d6ff",
                }}
              >
                [{log.type.toUpperCase()}] {log.message}
              </div>
            ))}
          </div>

          <button
            style={{ marginTop: 8 }}
            onClick={() =>
              navigator.clipboard.writeText(
                logs
                  .map((l) => `[${l.type.toUpperCase()}] ${l.message}`)
                  .join("\n")
              )
            }
          >
            Copy logs
          </button>
        </section>
      )}

      {/* ERROR */}
      {error && (
        <p style={{ marginTop: 16, color: "red" }}>
          Error: {error}
        </p>
      )}

      {/* RESULT */}
      {result && (
        <section style={{ marginTop: 24 }}>
          <h2>Result</h2>
          <pre
            style={{
              background: "#f6f8fa",
              padding: 12,
              borderRadius: 6,
              fontSize: 13,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      )}
    </main>
  )
      }
          
