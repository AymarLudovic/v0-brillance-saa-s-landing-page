"use client"
import { useState } from "react"

export default function TerminalPage() {
  const [command, setCommand] = useState("openssl rand -base64 32")
  const [output, setOutput] = useState("")
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const run = async () => {
    if (!command.trim()) return
    setLoading(true)
    setOutput("")
    try {
      const res = await fetch("/api/sand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "runCommand", command }),
      })
      const data = await res.json()
      setOutput(data.stdout || data.stderr || data.error || "No output")
    } catch (e: any) {
      setOutput("Error: " + e.message)
    } finally {
      setLoading(false)
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a0a", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px",
      fontFamily: "monospace"
    }}>
      <div style={{ width: "100%", maxWidth: "560px" }}>
        <p style={{ color: "#666", fontSize: "12px", marginBottom: "16px" }}>
          E2B Sandbox Terminal
        </p>

        {/* Input */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <input
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder="Enter command..."
            style={{
              flex: 1, background: "#111", border: "1px solid #222",
              borderRadius: "8px", padding: "10px 14px", color: "#fff",
              fontSize: "13px", outline: "none"
            }}
          />
          <button
            onClick={run}
            disabled={loading}
            style={{
              background: loading ? "#222" : "#fff", color: loading ? "#666" : "#000",
              border: "none", borderRadius: "8px", padding: "10px 18px",
              fontSize: "13px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "..." : "Run"}
          </button>
        </div>

        {/* Output */}
        {output && (
          <div style={{
            background: "#111", border: "1px solid #222", borderRadius: "8px",
            padding: "14px", position: "relative"
          }}>
            <p style={{ color: "#4ade80", fontSize: "13px", wordBreak: "break-all", margin: 0 }}>
              {output}
            </p>
            <button
              onClick={copy}
              style={{
                position: "absolute", top: "10px", right: "10px",
                background: copied ? "#4ade80" : "#222", color: copied ? "#000" : "#fff",
                border: "none", borderRadius: "6px", padding: "4px 10px",
                fontSize: "11px", cursor: "pointer", fontWeight: 600
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}

        {loading && (
          <p style={{ color: "#444", fontSize: "12px", marginTop: "12px" }}>
            Creating sandbox and running command...
          </p>
        )}
      </div>
    </div>
  )
}
