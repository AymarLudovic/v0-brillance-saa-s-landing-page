"use client"

import { useState } from "react"

type Log = {
  type: "info" | "step" | "error"
  message: string
}

export default function Home() {
  const [idea, setIdea] = useState("")
  const [pkg, setPkg] = useState<any>(null)
  const [plan, setPlan] = useState<any>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)

  function addLog(type: Log["type"], message: string) {
    setLogs(prev => [...prev, { type, message }])
  }

  async function generate() {
    setPkg(null)
    setPlan(null)
    setLogs([])
    setLoading(true)

    try {
      addLog("step", "Starting generation pipeline")
      addLog("info", "Sending idea to AI backend")

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText)
      }

      addLog("step", "AI response received")
      const data = await res.json()

      if (!data.pkg) {
        throw new Error("PKG missing in AI response")
      }

      addLog("step", "Product Knowledge Graph generated")
      setPkg(data.pkg)

      if (data.plan) {
        addLog("step", "Execution plan generated")
        setPlan(data.plan)
      }

      addLog("info", "Generation completed successfully")

    } catch (err: any) {
      addLog("error", err.message || "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  function copyLogs() {
    const text = logs
      .map(l => `[${l.type.toUpperCase()}] ${l.message}`)
      .join("\n")
    navigator.clipboard.writeText(text)
  }

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif", maxWidth: 900 }}>
      <h1>AI Product Generator</h1>

      <textarea
        value={idea}
        onChange={e => setIdea(e.target.value)}
        placeholder="Describe your product idea..."
        style={{ width: "100%", height: 120 }}
      />

      <br /><br />
      <button onClick={generate} disabled={loading}>
        {loading ? "Generating..." : "Generate"}
      </button>

      {/* LOGS */}
      <section style={{ marginTop: 32 }}>
        <h2>Logs</h2>

        <button onClick={copyLogs} disabled={logs.length === 0}>
          Copy logs
        </button>

        <div
          style={{
            marginTop: 12,
            background: "#0e0e0e",
            color: "#eaeaea",
            padding: 16,
            borderRadius: 6,
            fontSize: 13,
            maxHeight: 260,
            overflowY: "auto",
            whiteSpace: "pre-wrap"
          }}
        >
          {logs.length === 0 && "No logs yet"}

          {logs.map((log, i) => (
            <div
              key={i}
              style={{
                color:
                  log.type === "error"
                    ? "#ff5c5c"
                    : log.type === "step"
                    ? "#5cc8ff"
                    : "#b7ff5c"
              }}
            >
              [{log.type.toUpperCase()}] {log.message}
            </div>
          ))}
        </div>
      </section>

      {/* PKG */}
      {pkg && (
        <section style={{ marginTop: 32 }}>
          <h2>Product Knowledge Graph</h2>

          <h3>Pages</h3>
          <ul>
            {Object.keys(pkg.pages).map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <h3>Features</h3>
          <ul>
            {Object.keys(pkg.features).map(f => (
              <li key={f}>{f}</li>
            ))}
          </ul>

          <h3>Constraints</h3>
          <pre>{JSON.stringify(pkg.constraints, null, 2)}</pre>
        </section>
      )}

      {/* PLAN */}
      {plan && (
        <section style={{ marginTop: 32 }}>
          <h2>Execution Plan</h2>
          <pre>{JSON.stringify(plan, null, 2)}</pre>
        </section>
      )}
    </main>
  )
                  }
        
