"use client";

import { useState } from "react";

export default function Home() {
  const [template, setTemplate] = useState(`export default function Page() {
  return (
    <div style={{ padding: 40, fontSize: 32 }}>
      Hello from E2B Next.js Sandbox 🚀
    </div>
  );
}`);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (line: string) => {
    console.log(line);
    setLogs((prev) => [...prev, line]);
  };

  const run = async () => {
    setLogs([]);
    const res = await fetch("/api/run-nextjs", {
      method: "POST",
      body: JSON.stringify({ template }),
    });

    if (!res.body) {
      addLog("No response body");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      addLog(decoder.decode(value));
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
        onClick={run}
        className="mt-4 px-4 py-2 bg-black text-white rounded"
      >
        Build & Run
      </button>

      <div className="mt-6 border rounded p-3 h-80 overflow-auto bg-black text-green-400 font-mono text-sm">
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </main>
  );
    }
