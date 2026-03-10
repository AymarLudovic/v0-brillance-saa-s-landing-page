import { NextResponse } from "next/server"
import * as e2b from "@e2b/code-interpreter"

// Définition des timeouts E2B (900000 ms = 15 minutes)
const SANDBOX_TIMEOUT_MS = 900000
const INSTALL_TIMEOUT_MS = 700000 // 10 minutes pour npm install
const BUILD_TIMEOUT_MS = 300000 // 5 minutes pour npm run build
const START_TIMEOUT_MS = 120000 // 2 minutes pour démarrer le serveur

export async function POST(req: Request) {
  try {
    const body = await req.json().catch((e) => {
      console.error("[v0] Failed to parse request JSON:", e)
      throw new Error("Invalid JSON in request body")
    })

    const { action, sandboxId: bodySandboxId, files: requestFiles, filePath, content } = body || {}

    const apiKey = process.env.E2B_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "E2B_API_KEY manquant" }, { status: 500 })
    }

    console.log("[v0] Sandbox API called with action:", action)

    switch (action) {
      case "create": {
        console.log("[v0] Creating new sandbox...")

        // Utilisation de betaCreate avec autoPause pour la persistance
        const sandbox = await e2b.Sandbox.create({
          apiKey,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        })

        // Fichiers Next.js 15 par défaut (SANS Tailwind CSS)
        const defaultPackageJson = {
  name: "nextjs-app",
  private: true,
  scripts: {
    dev: "next dev -p 3000 -H 0.0.0.0",
    build: "next build",
    start: "next start -p 3000 -H 0.0.0.0",
  },
  dependencies: {
    next: "15.1.0",
    react: "19.0.0",
    "react-dom": "19.0.0",
    "iconsax-reactjs": "0.0.8",
    "iconoir-react": "7.11.0",
    "lucide-react": "0.561.0"
  },
  devDependencies: {
    typescript: "5.7.2",
    "@types/node": "22.10.1",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    // AJOUTS POUR TAILWIND
    "tailwindcss": "^3.4.1",
    "postcss": "^8",
    "autoprefixer": "^10.0.1"
  },
}

await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPackageJson, null, 2))



        // tsconfig.json pour Next.js 15
        await sandbox.files.write(
          "/home/user/tsconfig.json",
          JSON.stringify(
            {
              compilerOptions: {
                target: "ESNext",
                lib: ["dom", "dom.iterable", "esnext"],
                allowJs: true,
                skipLibCheck: true,
                strict: true,
                noEmit: true,
                esModuleInterop: true,
                module: "esnext",
                moduleResolution: "bundler",
                resolveJsonModule: true,
                isolatedModules: true,
                jsx: "preserve",
                incremental: true,
                plugins: [{ name: "next" }],
                paths: { "@/*": ["./*"] },
              },
              include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
              exclude: ["node_modules"],
            },
            null,
            2,
          ),
        )

        // next.config.ts — avec proxy vers backend Python (port 8000)
        await sandbox.files.write(
          "/home/user/next.config.ts",
          `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        // Toutes les requêtes /api/py/* sont envoyées vers FastAPI
        source: "/api/py/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

export default nextConfig;`,
        )

        // backend/ — structure de base (sera remplacée par les fichiers générés)
        await sandbox.files.write(
          "/home/user/backend/__init__.py",
          `# Backend Python FastAPI
`
        )
        await sandbox.files.write(
          "/home/user/backend/main.py",
          `import asyncio
import json
import psutil
import platform
import sys
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_snapshot():
    cpu_per_core = psutil.cpu_percent(interval=0.1, percpu=True)
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    net = psutil.net_io_counters()
    procs = []
    for p in sorted(psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "status"]),
                    key=lambda x: x.info["cpu_percent"] or 0, reverse=True)[:8]:
        try:
            procs.append({
                "pid": p.info["pid"],
                "name": p.info["name"][:22],
                "cpu": round(p.info["cpu_percent"] or 0, 1),
                "mem": round(p.info["memory_percent"] or 0, 1),
                "status": p.info["status"],
            })
        except Exception:
            pass
    return {
        "cpu_total": psutil.cpu_percent(interval=0),
        "cpu_cores": cpu_per_core,
        "cpu_count": psutil.cpu_count(),
        "ram_used": round(ram.used / 1024**3, 2),
        "ram_total": round(ram.total / 1024**3, 2),
        "ram_pct": ram.percent,
        "disk_used": round(disk.used / 1024**3, 1),
        "disk_total": round(disk.total / 1024**3, 1),
        "disk_pct": disk.percent,
        "net_sent": round(net.bytes_sent / 1024**2, 2),
        "net_recv": round(net.bytes_recv / 1024**2, 2),
        "processes": procs,
        "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        "os": platform.system(),
        "time": datetime.now().strftime("%H:%M:%S"),
    }

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/snapshot")
def snapshot():
    return get_snapshot()

@app.websocket("/ws/monitor")
async def ws_monitor(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = get_snapshot()
            await ws.send_text(json.dumps(data))
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass
`
        )
        await sandbox.files.write(
          "/home/user/backend/requirements.txt",
          `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-dotenv>=1.0.0
httpx>=0.27.0
psutil>=6.0.0
`
        )

        // layout.tsx
        await sandbox.files.write(
  "/home/user/app/layout.tsx",
  `import type { Metadata } from "next";
import "./globals.css"; // <--- L'IMPORT CRUCIAL EST ICI

export const metadata: Metadata = {
  title: "Generated App",
  description: "Generated by AI Developer",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-black margin-0 padding-0">
        {children}
      </body>
    </html>
  );
}`
);

  await sandbox.files.write(
  "/home/user/app/globals.css",
  `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Tu peux ajouter tes styles globaux ici si besoin */
body {
  font-family: Arial, Helvetica, sans-serif;
}`
);

        await sandbox.files.write(
  "/home/user/postcss.config.mjs",
  `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;`
);

          await sandbox.files.write(
  "/home/user/tailwind.config.ts",
  `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;`
);

        // page.tsx — Moniteur Système Temps Réel
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";

import { useState, useEffect } from "react";

interface Proc {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  status: string;
}

interface Snap {
  cpu_total: number;
  cpu_cores: number[];
  cpu_count: number;
  ram_used: number;
  ram_total: number;
  ram_pct: number;
  disk_used: number;
  disk_total: number;
  disk_pct: number;
  net_sent: number;
  net_recv: number;
  processes: Proc[];
  python: string;
  os: string;
  time: string;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: pct + "%", background: color }}
      />
    </div>
  );
}

function MiniBar({ pct }: { pct: number }) {
  const color = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";
  return (
    <div className="w-full bg-gray-700 rounded h-1 overflow-hidden">
      <div className="h-full rounded transition-all duration-500" style={{ width: pct + "%", background: color }} />
    </div>
  );
}

function Gauge({ label, pct, used, total, unit, color }: {
  label: string; pct: number; used: number; total: number; unit: string; color: string;
}) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 flex flex-col gap-3 border border-gray-800">
      <div className="flex justify-between items-baseline">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{pct.toFixed(0)}<span className="text-sm text-gray-500">%</span></span>
      </div>
      <Bar pct={pct} color={color} />
      <span className="text-xs text-gray-500 tabular-nums">{used} / {total} {unit}</span>
    </div>
  );
}

export default function Page() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/py/snapshot");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: Snap = await res.json();
        if (!alive) return;
        setSnap(data);
        setHistory(h => [...h.slice(-29), data.cpu_total]);
        setStatus("live");
      } catch {
        if (!alive) return;
        setStatus("error");
      }
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const statusColor = status === "live" ? "#22c55e" : status === "connecting" ? "#f59e0b" : "#ef4444";
  const statusLabel = status === "live" ? "Live" : status === "connecting" ? "Connecting..." : "Error — retrying...";

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">System Monitor</h1>
            {snap && <p className="text-xs text-gray-500">{snap.os} · Python {snap.python}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: statusColor }} />
          <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
          {snap && <span className="text-xs text-gray-600 ml-2">{snap.time}</span>}
        </div>
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
        <Gauge label="CPU" pct={snap?.cpu_total ?? 0} used={snap?.cpu_total ?? 0} total={100} unit="%" color="#6366f1" />
        <Gauge label="RAM" pct={snap?.ram_pct ?? 0} used={snap?.ram_used ?? 0} total={snap?.ram_total ?? 0} unit="GB" color="#06b6d4" />
        <Gauge label="Disk" pct={snap?.disk_pct ?? 0} used={snap?.disk_used ?? 0} total={snap?.disk_total ?? 0} unit="GB" color="#f59e0b" />
        <div className="bg-gray-900 rounded-2xl p-5 flex flex-col gap-3 border border-gray-800">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Network</span>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">↑ Sent</span>
              <span className="text-emerald-400 tabular-nums">{snap?.net_sent ?? 0} MB</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">↓ Recv</span>
              <span className="text-sky-400 tabular-nums">{snap?.net_recv ?? 0} MB</span>
            </div>
          </div>
        </div>
      </div>

      {/* CPU sparkline + cores */}
      <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-2">

        {/* Sparkline */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">CPU History</span>
            <span className="text-xs text-indigo-400 tabular-nums">{snap?.cpu_total.toFixed(1)}%</span>
          </div>
          <svg viewBox="0 0 300 60" className="w-full" preserveAspectRatio="none" style={{ height: 60 }}>
            {history.length > 1 && (
              <polyline
                fill="none"
                stroke="#6366f1"
                strokeWidth="2"
                points={history.map((v, i) =>
                  ((i / 29) * 300).toFixed(2) + "," + (60 - (v / 100) * 56).toFixed(2)
                ).join(" ")}
              />
            )}
            {history.length > 1 && (
              <polygon
                fill="rgba(99,102,241,0.15)"
                points={[
                  ...history.map((v, i) => ((i / 29) * 300).toFixed(2) + "," + (60 - (v / 100) * 56).toFixed(2)),
                  (((history.length - 1) / 29) * 300).toFixed(2) + ",60",
                  "0,60"
                ].join(" ")}
              />
            )}
          </svg>
        </div>

        {/* CPU cores */}
        <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">CPU Cores</span>
            <span className="text-xs text-gray-500">{snap?.cpu_count ?? 0} cores</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(snap?.cpu_cores ?? []).map((v, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600">Core {i}</span>
                  <span className="text-gray-300 tabular-nums">{v.toFixed(0)}%</span>
                </div>
                <MiniBar pct={v} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Process table */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Top Processes</span>
          <span className="text-xs text-gray-600">live · 1s refresh</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 border-b border-gray-800">
                <th className="text-left px-5 py-2 font-medium">PID</th>
                <th className="text-left px-5 py-2 font-medium">Name</th>
                <th className="text-right px-5 py-2 font-medium">CPU %</th>
                <th className="text-right px-5 py-2 font-medium">MEM %</th>
                <th className="text-right px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(snap?.processes ?? []).map((p) => (
                <tr key={p.pid} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-2 text-gray-500 tabular-nums">{p.pid}</td>
                  <td className="px-5 py-2 text-gray-200">{p.name}</td>
                  <td className="px-5 py-2 text-right tabular-nums" style={{ color: p.cpu > 10 ? "#f59e0b" : "#6b7280" }}>{p.cpu.toFixed(1)}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-sky-400">{p.mem.toFixed(1)}</td>
                  <td className="px-5 py-2 text-right">
                    <span className="px-2 py-0.5 rounded text-gray-400 bg-gray-800">{p.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 text-center text-xs text-gray-700">
        Données lues par Python psutil · polling HTTP /api/py/snapshot toutes les secondes · affichées par React
      </div>

    </div>
  );
}
`
        )

        // Préparer Python dans le sandbox — disponible pour tout projet
        try {
          console.log("[v0] Setting up Python environment...")
          // Vérifier que pip est disponible et upgrader
          await sandbox.commands.run(
            "python3 -m pip install --upgrade pip --quiet 2>/dev/null || true",
            { cwd: "/home/user", timeoutMs: 60000 }
          )
          // Installer FastAPI/uvicorn en avance (requis pour tout backend Python)
          await sandbox.commands.run(
            "pip install fastapi uvicorn[standard] python-dotenv httpx psutil --quiet",
            { cwd: "/home/user", timeoutMs: 120000 }
          )
          console.log("[v0] Python environment ready")
        } catch (pySetup: any) {
          console.log("[v0] Python setup warning (non-fatal):", pySetup.message)
        }

        console.log(`[v0] Sandbox créé: ${sandbox.sandboxId}`)
        return NextResponse.json({ success: true, sandboxId: sandbox.sandboxId })
      }

      case "writeFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles)) {
          throw new Error("Paramètres manquants (sandboxId ou files[])")
        }

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        const writeResults: { filePath: string; success: boolean; error?: string }[] = []

        for (const f of requestFiles) {
          const filePathValue = f.filePath || f.path
          const contentValue = f.content

          if (!filePathValue || typeof contentValue !== "string") {
            writeResults.push({
              filePath: filePathValue || "inconnu",
              success: false,
              error: "filePath ou content manquant/invalide",
            })
            continue
          }

          try {
            await sandbox.files.write(`/home/user/${filePathValue}`, contentValue)
            console.log(`[v0] Fichier ${filePathValue} écrit dans le sandbox ${bodySandboxId}`)
            writeResults.push({ filePath: filePathValue, success: true })
          } catch (error: any) {
            console.error(`[v0] Échec de l'écriture de ${filePathValue}:`, error)
            writeResults.push({ filePath: filePathValue, success: false, error: error.message })
          }
        }

        return NextResponse.json({
          success: writeResults.every((r) => r.success),
          message: `${requestFiles.length} files processed`,
          writeResults,
        })
      }

      case "getFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")
        console.log("[v0] Extracting files from sandbox:", sid)

        try {
          let sandbox: e2b.Sandbox
          try {
            sandbox = await e2b.Sandbox.connect(sid, {
              apiKey,
              timeoutMs: SANDBOX_TIMEOUT_MS,
            })
          } catch (connectError: any) {
            console.log("[v0] Failed to connect to sandbox:", connectError.message)
            throw new Error(`Sandbox ${sid} is no longer available.`)
          }

          await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

          const { stdout: fileList } = await sandbox.commands.run(
            "find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.*'",
            { cwd: "/home/user", timeoutMs: 30000 },
          )

          const files: Record<string, string> = {}
          const filePaths = fileList
            .trim()
            .split("\n")
            .filter((path) => path && path !== ".")

          console.log("[v0] Found", filePaths.length, "files to extract")

          for (let i = 0; i < filePaths.length; i++) {
            const fp = filePaths[i]
            try {
              const cleanPath = fp.replace(/^\.\//, "")
              const content = await sandbox.files.read(`/home/user/${cleanPath}`)

              if (cleanPath === "package.json" || cleanPath.endsWith(".json")) {
                try {
                  const parsed = JSON.parse(content as string)
                  files[cleanPath] = JSON.stringify(parsed, null, 2)
                } catch {
                  files[cleanPath] = content as string
                }
              } else {
                files[cleanPath] = typeof content === "string" ? content : String(content)
              }

              console.log(`[v0] Extracted file ${i + 1}/${filePaths.length}:`, cleanPath)
            } catch (error) {
              console.log("[v0] Could not read file:", fp, error)
            }
          }

          return NextResponse.json({
            success: true,
            files,
            fileCount: Object.keys(files).length,
          })
        } catch (error: any) {
          console.error("[v0] Error extracting files:", error)
          return NextResponse.json(
            { success: false, error: "Failed to extract files", details: error.message, sandboxId: sid },
            { status: 500 },
          )
        }
      }

      case "processFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")
        console.log("[v0] Processing files for deployment from sandbox:", sid)

        try {
          const extractResponse = await fetch(`${req.url}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "getFiles", sandboxId: sid }),
          })

          const extractResult = await extractResponse.json()
          if (!extractResult.success) {
            throw new Error(`Failed to extract files: ${extractResult.error}`)
          }

          const rawFiles = extractResult.files
          const processedFiles: Record<string, { content: string; encoding: string }> = {}

          for (const [filePath, content] of Object.entries(rawFiles)) {
            const fileContent = content as string
            if (typeof fileContent !== "string") continue

            if (filePath === "package.json") {
              try {
                JSON.parse(fileContent)
              } catch (e) {
                throw new Error(`package.json contains invalid JSON: ${e}`)
              }
            }

            processedFiles[filePath] = {
              content: Buffer.from(fileContent, "utf8").toString("base64"),
              encoding: "base64",
            }
          }

          return NextResponse.json({
            success: true,
            files: processedFiles,
            fileCount: Object.keys(processedFiles).length,
          })
        } catch (error: any) {
          console.error("[v0] Error processing files:", error)
          return NextResponse.json(
            { success: false, error: "Failed to process files", details: error.message, sandboxId: sid },
            { status: 500 },
          )
        }
      }

      case "addFile": {
        if (!bodySandboxId || !filePath || typeof content !== "string" || content.trim().length === 0)
          throw new Error("Paramètres manquants ou contenu vide (sandboxId, filePath, content)")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        await sandbox.files.write(`/home/user/${filePath}`, content)
        console.log(`[v0] Fichier ${filePath} écrit dans le sandbox ${bodySandboxId}`)
        return NextResponse.json({ success: true, message: `File ${filePath} written` })
      }

      case "addFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles)) {
          throw new Error("Paramètres manquants (sandboxId ou files[])")
        }

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        for (const f of requestFiles) {
          const filePathValue = f.filePath || f.path
          if (!filePathValue || typeof f.content !== "string" || f.content.trim().length === 0) continue
          await sandbox.files.write(`/home/user/${filePathValue}`, f.content)
          console.log(`[v0] Fichier ${filePathValue} écrit dans le sandbox ${bodySandboxId}`)
        }

        return NextResponse.json({ success: true, message: `${requestFiles.length} files written` })
      }

      case "install":
      case "build": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        let commandResult: any = { stdout: "", stderr: "", exitCode: -1 }
        let commandSuccess = false

        try {
          if (action === "install") {
            // 1. npm install
            commandResult = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
              cwd: "/home/user",
              timeoutMs: INSTALL_TIMEOUT_MS,
            })
            // 2. pip install si requirements.txt présent
            try {
              const reqCheck = await sandbox.commands.run(
                "test -f /home/user/backend/requirements.txt && echo YES || echo NO",
                { timeoutMs: 5000 }
              )
              if (reqCheck.stdout.trim() === "YES") {
                console.log("[v0] Installing Python dependencies from requirements.txt...")
                const pipResult = await sandbox.commands.run(
                  "pip install -r /home/user/backend/requirements.txt --quiet",
                  { cwd: "/home/user", timeoutMs: 180000 }
                )
                console.log("[v0] pip install exit:", pipResult.exitCode)
                if (pipResult.exitCode !== 0) {
                  commandResult = {
                    ...commandResult,
                    stderr: (commandResult.stderr || "") + "\n[Python pip] " + pipResult.stderr
                  }
                }
                // Install playwright browsers if needed
                const reqContent = await sandbox.files.read("/home/user/backend/requirements.txt").catch(() => "")
                if (String(reqContent).includes("playwright")) {
                  console.log("[v0] Installing Playwright browsers...")
                  await sandbox.commands.run(
                    "python3 -m playwright install chromium --quiet 2>/dev/null || true",
                    { timeoutMs: 120000 }
                  )
                }
              }
            } catch (pipErr: any) {
              console.log("[v0] pip install skipped:", pipErr.message)
            }
          } else {
            commandResult = await sandbox.commands.run("npm run build", {
              cwd: "/home/user",
              timeoutMs: BUILD_TIMEOUT_MS,
            })
          }
          commandSuccess = commandResult.exitCode === 0
        } catch (e: any) {
          commandResult = {
            stdout: e.stdout || "",
            stderr: e.stderr || e.message || "",
            exitCode: e.exitCode || 1,
            error: e.message,
          }
          commandSuccess = false
        }

        console.log(`[v0] Commande '${action}' exécutée. Exit Code: ${commandResult.exitCode}`)
        return NextResponse.json({
          success: commandSuccess,
          action,
          result: commandResult,
          stdout: commandResult.stdout,
          stderr: commandResult.stderr,
        })
      }

      case "start": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        try {
          await sandbox.commands.run("pkill -f 'next dev' || true", {
            cwd: "/home/user",
            timeoutMs: 5000,
          })
          await sandbox.commands.run("pkill -f 'next start' || true", {
            cwd: "/home/user",
            timeoutMs: 5000,
          })
          // Also try to kill by port
          await sandbox.commands.run("fuser -k 3000/tcp || true", {
            cwd: "/home/user",
            timeoutMs: 5000,
          })
          // Wait a bit for processes to die
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } catch (e) {
          console.log("[v0] No existing process to kill or kill failed (this is OK)")
        }

        try {
          // Démarrer FastAPI si backend/main.py existe
          let pythonStarted = false
          try {
            const pyCheck = await sandbox.commands.run(
              "test -f /home/user/backend/main.py && echo YES || echo NO",
              { timeoutMs: 5000 }
            )
            if (pyCheck.stdout.trim() === "YES") {
              console.log("[v0] Starting Python FastAPI backend...")
              // Kill existing uvicorn
              await sandbox.commands.run("pkill -f uvicorn || true", { timeoutMs: 5000 }).catch(() => {})
              await new Promise(r => setTimeout(r, 1000))
              // Start uvicorn
              await sandbox.commands.run(
                "nohup python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload > /home/user/backend.log 2>&1 &",
                { cwd: "/home/user", timeoutMs: 10000 }
              )
              // Attendre que FastAPI réponde sur /health
              for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000))
                try {
                  const hc = await sandbox.commands.run(
                    "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health || echo 000",
                    { timeoutMs: 3000 }
                  )
                  if (hc.stdout.trim() === "200") {
                    pythonStarted = true
                    console.log("[v0] Python backend ready on port 8000!")
                    break
                  }
                } catch {}
              }
              if (!pythonStarted) {
                // Log backend errors for debugging
                const blogResult = await sandbox.commands.run(
                  "tail -20 /home/user/backend.log 2>/dev/null || echo 'no logs'",
                  { timeoutMs: 3000 }
                ).catch(() => ({ stdout: "no logs" }))
                console.log("[v0] Python backend logs:", blogResult.stdout)
              }
            }
          } catch (pyErr: any) {
            console.log("[v0] Python backend start skipped:", pyErr.message)
          }

          // Start Next.js dev server
          await sandbox.commands.run("nohup npm run dev > /home/user/server.log 2>&1 &", {
            cwd: "/home/user",
            timeoutMs: 10000,
          })

          // Wait for server to be ready
          let serverReady = false
          let attempts = 0
          const maxAttempts = 30 // 30 seconds max

          while (!serverReady && attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            attempts++

            try {
              const checkResult = await sandbox.commands.run(
                "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo '000'",
                { cwd: "/home/user", timeoutMs: 5000 },
              )
              const httpCode = checkResult.stdout.trim()
              console.log(`[v0] Server check attempt ${attempts}: HTTP ${httpCode}`)

              if (httpCode === "200" || httpCode === "304" || httpCode === "404") {
                serverReady = true
              }
            } catch (e) {
              console.log(`[v0] Server check attempt ${attempts} failed`)
            }
          }

          const url = `https://${sandbox.getHost(3000)}`

          // Get server logs
          let serverLogs = ""
          try {
            const logsResult = await sandbox.commands.run("tail -100 /home/user/server.log", {
              cwd: "/home/user",
              timeoutMs: 5000,
            })
            serverLogs = logsResult.stdout
          } catch (e) {
            console.log("[v0] Could not read server logs")
          }

          console.log(`[v0] Server started. URL: ${url}, Ready: ${serverReady}`)

          const pythonUrl = pythonStarted ? `https://${sandbox.getHost(8000)}` : null
          return NextResponse.json({
            success: serverReady,
            action,
            url,
            pythonUrl,
            pythonStarted,
            ready: serverReady,
            attempts,
            stdout: serverLogs,
            stderr: serverReady ? "" : "Server may not be ready yet",
          })
        } catch (e: any) {
          console.error("[v0] Error starting server:", e)
          return NextResponse.json({
            success: false,
            action,
            error: e.message,
            stderr: e.message,
          })
        }
      }

      case "stop": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        try {
          await sandbox.commands.run("pkill -f 'next' || pkill -f 'uvicorn' || true", {
            cwd: "/home/user",
            timeoutMs: 10000,
          })
          await sandbox.commands.run("fuser -k 3000/tcp 2>/dev/null; fuser -k 8000/tcp 2>/dev/null || true", {
            cwd: "/home/user",
            timeoutMs: 5000,
          })

          return NextResponse.json({ success: true, message: "Server stopped" })
        } catch (e: any) {
          return NextResponse.json({ success: true, message: "Stop attempted", details: e.message })
        }
      }

      case "restart": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        // Stop first
        const stopResponse = await fetch(req.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "stop", sandboxId: bodySandboxId }),
        })
        await stopResponse.json()

        // Then start
        const startResponse = await fetch(req.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", sandboxId: bodySandboxId }),
        })
        const startResult = await startResponse.json()

        return NextResponse.json({
          success: startResult.success,
          action: "restart",
          url: startResult.url,
          stdout: startResult.stdout,
          stderr: startResult.stderr,
        })
      }

      case "logs": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        try {
          const logsResult = await sandbox.commands.run(
            "tail -200 /home/user/server.log 2>/dev/null || echo 'No logs yet'",
            {
              cwd: "/home/user",
              timeoutMs: 10000,
            },
          )

          return NextResponse.json({
            success: true,
            logs: logsResult.stdout,
          })
        } catch (e: any) {
          return NextResponse.json({
            success: false,
            logs: "",
            error: e.message,
          })
        }
      }

      case "status": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        try {
          const sandbox = await e2b.Sandbox.connect(bodySandboxId, {
            apiKey,
            timeoutMs: 30000,
          })

          // Check if server is running
          let serverRunning = false
          try {
            const checkResult = await sandbox.commands.run(
              "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo '000'",
              { cwd: "/home/user", timeoutMs: 5000 },
            )
            const httpCode = checkResult.stdout.trim()
            serverRunning = httpCode === "200" || httpCode === "304" || httpCode === "404"
          } catch (e) {
            serverRunning = false
          }

          const url = `https://${sandbox.getHost(3000)}`

          return NextResponse.json({
            success: true,
            connected: true,
          serverRunning,
            url,
          })
        } catch (error: any) {
          return NextResponse.json({
            success: false,
            connected: false,
            serverRunning: false,
            error: error.message,
          })
        }
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[v0] Erreur dans l'API route /api/sandbox:", e)
    return NextResponse.json({ error: e.message || "Erreur inconnue", details: e.toString() }, { status: 500 })
  }
            }
