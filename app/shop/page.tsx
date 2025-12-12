"use client";

import { useState } from "react";

export default function Home() {
  const [template, setTemplate] = useState(
`export default function Page() {
  return (
    <div style={{ padding: 40, fontSize: 32 }}>
      🚀 Hello from E2B Next.js Sandbox
    </div>
  );
}`
  );

  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs((prev) => [...prev, msg]);
  };

  const runBuild = async () => {
    setLogs([]);

    const res = await fetch("/api/run", {
      method: "POST",
      body: JSON.stringify({ template }),
    });

    if (!res.body) {
      addLog("❌ No response body");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      addLog(text);
    }
  };

  return (
    <main className="p-10 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Next.js Builder (E2B Sandbox)</h1>

      <textarea
        className="w-full h-64 border p-3 rounded"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
      />

      <button
        onClick={runBuild}
        className="mt-4 px-5 py-2 bg-black text-white rounded"
      >
        🚀 Build & Run
      </button>

      <div className="mt-6 border rounded p-3 h-80 overflow-auto bg-black text-green-300 font-mono text-sm whitespace-pre-wrap">
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </main>
  );
      }
    
