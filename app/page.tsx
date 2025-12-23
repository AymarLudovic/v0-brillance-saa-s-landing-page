"use client"

import { useState } from "react"

export default function Home() {
  const [idea, setIdea] = useState("")
  const [pkg, setPkg] = useState<any>(null)
  const [plan, setPlan] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea })
    })
    const data = await res.json()
    setPkg(data.pkg)
    setPlan(data.plan)
    setLoading(false)
  }

  return (
    <main style={{ padding: 32, fontFamily: "sans-serif" }}>
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

      {pkg && (
        <>
          <h2>Pages</h2>
          <ul>
            {Object.keys(pkg.pages).map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>

          <h2>Features</h2>
          <ul>
            {Object.keys(pkg.features).map(f => (
              <li key={f}>{f}</li>
            ))}
          </ul>

          <h2>Constraints</h2>
          <pre>{JSON.stringify(pkg.constraints, null, 2)}</pre>
        </>
      )}

      {plan && (
        <>
          <h2>Execution Plan</h2>
          <pre>{JSON.stringify(plan, null, 2)}</pre>
        </>
      )}
    </main>
  )
      }

