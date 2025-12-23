"use client"

import { useState, useEffect, useRef } from "react"

type Log = {
  type: "step" | "info" | "error"
  message: string
}

export default function HomePage() {
  const [idea, setIdea] = useState("")
  const [loading, setLoading] = useState(false)
  const [streamedText, setStreamedText] = useState("")
  const [logs, setLogs] = useState<Log[]>([])
  const [error, setError] = useState<string | null>(null)
  
  // Ref pour scroller automatiquement les logs
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  // Fonction pour extraire les fichiers du texte XML streamé
  const parseFiles = (text: string) => {
    const files: { path: string; content: string }[] = []
    const regex = /<create_file path="([^"]+)">([\s\S]*?)(?:<\/create_file>|$)/g
    let match
    while ((match = regex.exec(text)) !== null) {
      files.push({ path: match[1], content: match[2].trim() })
    }
    return files
  }

  async function runGeneration() {
    setLoading(true)
    setStreamedText("")
    setLogs([])
    setError(null)

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      })

      if (!res.ok) throw new Error(`Server error: ${res.statusText}`)
      if (!res.body) throw new Error("No response body")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let fullText = ""

      while (!done) {
        const { value, done: doneReading } = await reader.read()
        done = doneReading
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        
        // Mise à jour du texte brut
        setStreamedText(fullText)

        // Extraction des logs à la volée (lignes commençant par [)
        const lines = chunk.split('\n')
        lines.forEach(line => {
          if (line.startsWith(" [STEP]")) {
            setLogs(prev => [...prev, { type: "step", message: line.replace(" [STEP] ", "") }])
          } else if (line.startsWith(" [INFO]")) {
            setLogs(prev => [...prev, { type: "info", message: line.replace(" [INFO] ", "") }])
          } else if (line.startsWith(" [ERROR]")) {
            setLogs(prev => [...prev, { type: "error", message: line.replace(" [ERROR] ", "") }])
          }
        })
      }
    } catch (err: any) {
      console.error("Stream error:", err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const generatedFiles = parseFiles(streamedText)

  return (
    <main style={{ padding: "40px", maxWidth: "1200px", margin: "0 auto", fontFamily: "sans-serif", backgroundColor: "#fff", color: "#000" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "20px" }}>Gemini App Architect</h1>
      
      <div style={{ marginBottom: "20px" }}>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Describe your app idea..."
          style={{ width: "100%", height: "100px", padding: "12px", borderRadius: "8px", border: "1px solid #ccc", marginBottom: "10px", display: "block" }}
        />
        <button 
          onClick={runGeneration} 
          disabled={loading || !idea}
          style={{ padding: "12px 24px", backgroundColor: loading ? "#ccc" : "#000", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
        >
          {loading ? "Generating..." : "Start Pipeline"}
        </button>
      </div>

      {error && <div style={{ color: "red", padding: "10px", border: "1px solid red", borderRadius: "4px", marginBottom: "20px" }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: "20px" }}>
        {/* Colonne de gauche : Logs */}
        <div style={{ background: "#f4f4f4", padding: "20px", borderRadius: "8px", height: "600px", overflowY: "auto" }}>
          <h3 style={{ marginTop: 0 }}>System Logs</h3>
          <div style={{ fontFamily: "monospace", fontSize: "13px" }}>
            {logs.map((l, i) => (
              <div key={i} style={{ marginBottom: "8px", color: l.type === "step" ? "#0070f3" : l.type === "error" ? "red" : "#666" }}>
                [{l.type.toUpperCase()}] {l.message}
              </div>
            ))}
            {loading && <div style={{ color: "#0070f3" }}>_ Loading...</div>}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Colonne de droite : Code Viewer */}
        <div style={{ border: "1px solid #eee", borderRadius: "8px", height: "600px", overflowY: "auto", background: "#fafafa" }}>
          <h3 style={{ padding: "0 20px" }}>Generated Files ({generatedFiles.length})</h3>
          {generatedFiles.length === 0 && !loading && <p style={{ padding: "20px", color: "#999" }}>No files generated yet.</p>}
          
          {generatedFiles.map((file, i) => (
            <details key={i} open={i === generatedFiles.length - 1} style={{ marginBottom: "10px", background: "#fff", border: "1px solid #eee" }}>
              <summary style={{ padding: "10px 20px", cursor: "pointer", fontWeight: "bold", backgroundColor: "#eee" }}>
                {file.path}
              </summary>
              <pre style={{ margin: 0, padding: "20px", overflowX: "auto", fontSize: "12px", background: "#1e1e1e", color: "#fff" }}>
                <code>{file.content}</code>
              </pre>
            </details>
          ))}
        </div>
      </div>
    </main>
  )
                                       }
