"use client";

import React, { useState } from "react";

export default function Page() {
  const [template, setTemplate] = useState(`
// Exemple de template Next.js
export default function Page() {
  return (
    <div style={{padding: 40, fontSize: 30}}>
      <h1>Mon App Next.js Daytona 🚀</h1>
    </div>
  );
}
  `);

  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  // Append a new log line to the client UI
  function addLog(text: string) {
    console.log("[LOG CLIENT]", text); // console navigateur
    setLogs((prev) => [...prev, text]);
  }

  async function runSandbox() {
    setLoading(true);
    setUrl("");
    setLogs([]);

    addLog("Envoi du template à Daytona...");

    const res = await fetch("/api/run", {
      method: "POST",
      body: JSON.stringify({ template }),
    });

    const reader = res.body?.getReader();
    if (!reader) {
      addLog("Impossible de lire la réponse du serveur.");
      setLoading(false);
      return;
    }

    const decoder = new TextDecoder();

    // Lire le streaming textuel ligne par ligne
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n");

      for (let line of lines) {
        if (!line.trim()) continue;

        // Format: "LOG: ...."
        if (line.startsWith("LOG: ")) {
          addLog(line.replace("LOG: ", ""));
        }

        // Format: "URL: ...."
        if (line.startsWith("URL: ")) {
          const finalUrl = line.replace("URL: ", "").trim();
          addLog("✔️ Application lancée : " + finalUrl);
          setUrl(finalUrl);
        }
      }
    }

    setLoading(false);
  }

  return (
    <div style={{ padding: 40 }}>
      <h1 style={{ fontSize: 40, fontWeight: "bold" }}>
        Next.js → Daytona Runner + Logs
      </h1>

      <textarea
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        style={{
          width: "100%",
          height: 400,
          marginTop: 20,
          padding: 20,
          fontSize: 16,
          borderRadius: 10,
          border: "1px solid #555",
        }}
      />

      <button
        onClick={runSandbox}
        disabled={loading}
        style={{
          marginTop: 20,
          padding: "15px 25px",
          fontSize: 20,
          background: "black",
          color: "white",
          borderRadius: 10,
        }}
      >
        {loading ? "Lancement..." : "Lancer sur Daytona 🚀"}
      </button>

      {url && (
        <div style={{ marginTop: 30, fontSize: 22 }}>
          <p>Ton app Next.js tourne ici :</p>
          <a href={url} target="_blank" style={{ color: "blue" }}>
            {url}
          </a>
        </div>
      )}

      {/* 🔥 Zone des logs */}
      <div
        style={{
          marginTop: 40,
          padding: 20,
          background: "#111",
          color: "#0f0",
          height: 250,
          overflowY: "scroll",
          borderRadius: 10,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
        }}
      >
        <h2>Logs</h2>
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
    }
    
