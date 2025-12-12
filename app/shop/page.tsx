"use client";

import React, { useState } from "react";

export default function Page() {
  const [template, setTemplate] = useState(`
// Exemple de template Next.js
export default function Page() {
  return (
    <div style={{padding: 40, fontSize: 30}}>
      <h1>Mon App Next.js Daytona 🚀</h1>
      <p>Ceci est un template envoyé depuis le front-end.</p>
    </div>
  );
}
  `);

  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");

  async function runSandbox() {
    setLoading(true);
    setUrl("");

    const res = await fetch("/api/run", {
      method: "POST",
      body: JSON.stringify({ template }),
    });

    const data = await res.json();
    setLoading(false);
    setUrl(data.url);
  }

  return (
    <div style={{ padding: 40 }}>
      <h1 style={{ fontSize: 40, fontWeight: "bold" }}>
        Next.js → Sandbox Daytona Runner
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
    </div>
  );
}
    
