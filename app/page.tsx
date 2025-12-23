"use client"

import { useState } from "react"

type Log = {
  type: "step" | "info" | "error"
  message: string
}

type GeneratedFile = {
  path: string
  content: string
}

export default function HomePage() {
  const [idea, setIdea] = useState("")
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ pkg: any; files: GeneratedFile[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<number | null>(null)

  async function runGeneration() {
  setLoading(true)
  setLogs([])
  setResult("") // On va stocker le texte brut ici
  setError(null)

  try {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    })

    if (!res.ok) throw new Error("Erreur serveur")

    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    let cumulativeText = ""

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        cumulativeText += chunk
        
        // On met à jour l'état pour afficher le code en temps réel
        setResult(cumulativeText) 
        
        // Optionnel : Extraire les logs à la volée s'ils commencent par [STEP]
        if (chunk.includes("[STEP]")) {
           const stepMatch = chunk.match(/\[STEP\].*/g);
           if (stepMatch) {
             setLogs(prev => [...prev, { type: "step", message: stepMatch[0] }]);
           }
        }
      }
    }
  } catch (err: any) {
    setError(err.message)
  } finally {
    setLoading(false)
  }
    }
  return (
    <main style={{ padding: "40px", maxWidth: "1200px", margin: "0 auto", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "2.5rem", fontWeight: "800", marginBottom: "8px" }}>AI App Architect</h1>
        <p style={{ color: "#666" }}>Describe your vision, and I'll build the architecture, UI, and Backend.</p>
      </header>

      {/* INPUT SECTION */}
      <section style={{ marginBottom: "32px", background: "#f9f9f9", padding: "24px", borderRadius: "12px", border: "1px solid #eee" }}>
        <textarea
          placeholder="Ex: A minimalist task manager with drag and drop and offline sync..."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          style={{ 
            width: "100%", padding: "16px", borderRadius: "8px", border: "1px solid #ddd",
            fontSize: "1rem", marginBottom: "16px", outline: "none", resize: "vertical"
          }}
        />
        <button 
          onClick={runGeneration} 
          disabled={loading || !idea}
          style={{ 
            backgroundColor: loading ? "#ccc" : "#000", color: "#fff", padding: "12px 24px",
            borderRadius: "8px", border: "none", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s"
          }}
        >
          {loading ? "🔨 Building Architecture..." : "🚀 Generate Full App"}
        </button>
      </section>

      {/* ERROR DISPLAY */}
      {error && (
        <div style={{ padding: "16px", backgroundColor: "#fff5f5", color: "#c53030", borderRadius: "8px", marginBottom: "24px", border: "1px solid #feb2b2" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: result ? "300px 1fr" : "1fr", gap: "24px" }}>
        
        {/* LOGS & STATUS */}
        <aside>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>Pipeline Progress</h2>
          <div style={{ 
            background: "#1e1e1e", color: "#d4d4d4", padding: "16px", borderRadius: "8px", 
            fontFamily: "'Fira Code', monospace", fontSize: "0.85rem", height: "400px", overflowY: "auto" 
          }}>
            {logs.length === 0 && <span style={{ color: "#666" }}>Waiting for prompt...</span>}
            {logs.map((log, i) => (
              <div key={i} style={{ marginBottom: "6px", borderLeft: `3px solid ${log.type === 'step' ? '#4CAF50' : '#2196F3'}`, paddingLeft: "8px" }}>
                <span style={{ opacity: 0.5, fontSize: "0.7rem" }}>[{log.type.toUpperCase()}]</span> {log.message}
              </div>
            ))}
            {loading && <div style={{ color: "#4CAF50", marginTop: "10px" }}>● Agent is thinking...</div>}
          </div>
        </aside>

        {/* RESULTS: FILE EXPLORER */}
        {result && (
          <section>
            <h2 style={{ fontSize: "1.2rem", marginBottom: "16px" }}>Generated Assets</h2>
            <div style={{ border: "1px solid #ddd", borderRadius: "8px", overflow: "hidden", display: "flex", height: "500px" }}>
              
              {/* Sidebar: File List */}
              <div style={{ width: "250px", borderRight: "1px solid #ddd", background: "#f5f5f5", overflowY: "auto" }}>
                {result.files.map((file, i) => (
                  <div 
                    key={i}
                    onClick={() => setSelectedFile(i)}
                    style={{ 
                      padding: "12px 16px", cursor: "pointer", fontSize: "0.9rem",
                      borderBottom: "1px solid #eee", background: selectedFile === i ? "#fff" : "transparent",
                      fontWeight: selectedFile === i ? "bold" : "normal", color: selectedFile === i ? "#000" : "#555"
                    }}
                  >
                    📄 {file.path.split('/').pop()}
                    <div style={{ fontSize: "0.7rem", color: "#999" }}>{file.path}</div>
                  </div>
                ))}
              </div>

              {/* Main: Code Viewer */}
              <div style={{ flex: 1, background: "#fff", overflow: "auto" }}>
                {selectedFile !== null ? (
                  <pre style={{ margin: 0, padding: "20px", fontSize: "0.9rem", lineHeight: "1.5", color: "#333" }}>
                    <code>{result.files[selectedFile].content}</code>
                  </pre>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#999" }}>
                    Select a file to view code
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
          }
