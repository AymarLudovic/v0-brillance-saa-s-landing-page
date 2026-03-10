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
          `import base64
import time
import uuid
from datetime import datetime
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from playwright.sync_api import sync_playwright

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# File d'attente des jobs en memoire
jobs: dict = {}

class BrowseRequest(BaseModel):
    url: str
    job_id: Optional[str] = None

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/jobs")
def list_jobs():
    return list(jobs.values())

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    return jobs.get(job_id, {"error": "not found"})

@app.post("/browse")
def browse(req: BrowseRequest):
    job_id = req.job_id or str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "id": job_id,
        "url": req.url,
        "status": "running",
        "started_at": datetime.now().strftime("%H:%M:%S"),
    }
    try:
        t0 = time.time()
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.goto(req.url, timeout=20000, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)

            title = page.title()
            elapsed = round(time.time() - t0, 2)

            links_raw = page.eval_on_selector_all(
                "a[href]",
                "els => els.slice(0,12).map(a => ({text: a.innerText.trim().slice(0,60), href: a.href}))"
            )
            links = [l for l in links_raw if l["text"] and l["href"].startswith("http")][:10]

            meta_desc = ""
            try:
                meta_desc = page.get_attribute('meta[name="description"]', "content") or ""
            except Exception:
                pass

            screenshot_bytes = page.screenshot(type="jpeg", quality=70, full_page=False)
            screenshot_b64 = base64.b64encode(screenshot_bytes).decode()

            browser.close()

        jobs[job_id] = {
            "id": job_id,
            "url": req.url,
            "status": "done",
            "title": title,
            "description": meta_desc[:160],
            "elapsed": elapsed,
            "links": links,
            "screenshot": screenshot_b64,
            "done_at": datetime.now().strftime("%H:%M:%S"),
        }
    except Exception as e:
        jobs[job_id] = {
            "id": job_id,
            "url": req.url,
            "status": "error",
            "error": str(e)[:200],
        }
    return jobs[job_id]
`
        )
        await sandbox.files.write(
          "/home/user/backend/requirements.txt",
          `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-dotenv>=1.0.0
httpx>=0.27.0
playwright>=1.48.0
pydantic>=2.0.0
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

        // page.tsx — Agent de navigation Chrome via Playwright
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";

import { useState, useEffect } from "react";

interface Link { text: string; href: string; }

interface Job {
  id: string;
  url: string;
  status: "running" | "done" | "error";
  title?: string;
  description?: string;
  elapsed?: number;
  links?: Link[];
  screenshot?: string;
  error?: string;
  started_at?: string;
  done_at?: string;
}

const PRESETS = [
  "https://example.com",
  "https://news.ycombinator.com",
  "https://github.com/trending",
  "https://wikipedia.org",
];

function StatusBadge({ status }: { status: Job["status"] }) {
  if (status === "running") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      Navigating…
    </span>
  );
  if (status === "done") return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      Done
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-red-400 bg-red-400/10 px-2.5 py-1 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      Error
    </span>
  );
}

export default function Page() {
  const [url, setUrl] = useState("https://example.com");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [backendReady, setBackendReady] = useState(false);

  // Vérifier que le backend est prêt
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("/api/py/health");
        if (r.ok) setBackendReady(true);
        else setTimeout(check, 2000);
      } catch {
        setTimeout(check, 2000);
      }
    };
    check();
  }, []);

  // Polling des jobs en cours
  useEffect(() => {
    const running = jobs.filter(j => j.status === "running");
    if (running.length === 0) return;
    const id = setInterval(async () => {
      const updated = await Promise.all(
        running.map(j => fetch("/api/py/jobs/" + j.id).then(r => r.json()))
      );
      setJobs(prev => prev.map(j => {
        const u = updated.find(u => u.id === j.id);
        return u ? u : j;
      }));
      setSelected(prev => {
        if (!prev) return prev;
        const u = updated.find(u => u.id === prev.id);
        return u ? u : prev;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [jobs]);

  const handleBrowse = async () => {
    if (!url.trim() || loading) return;
    const jobId = Math.random().toString(36).slice(2, 10);
    const newJob: Job = { id: jobId, url: url.trim(), status: "running", started_at: new Date().toLocaleTimeString() };
    setJobs(prev => [newJob, ...prev]);
    setSelected(newJob);
    setLoading(true);
    try {
      const res = await fetch("/api/py/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), job_id: jobId }),
      });
      const data = await res.json();
      setJobs(prev => prev.map(j => j.id === jobId ? data : j));
      setSelected(data);
    } catch (e: any) {
      const err: Job = { ...newJob, status: "error", error: e.message };
      setJobs(prev => prev.map(j => j.id === jobId ? err : j));
      setSelected(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans flex flex-col">

      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-sm">🌐</div>
          <div>
            <h1 className="text-sm font-bold">Browser Agent</h1>
            <p className="text-xs text-gray-500">Python Playwright + Chromium — contrôle réel</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: backendReady ? "#22c55e" : "#f59e0b" }} />
          <span className="text-xs" style={{ color: backendReady ? "#22c55e" : "#f59e0b" }}>
            {backendReady ? "Backend prêt" : "Démarrage Python…"}
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar gauche — input + historique */}
        <div className="w-72 border-r border-gray-800 flex flex-col shrink-0">

          {/* Input */}
          <div className="p-4 border-b border-gray-800">
            <label className="text-xs text-gray-500 mb-2 block font-medium uppercase tracking-wider">URL à visiter</label>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-3"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleBrowse()}
              placeholder="https://..."
            />
            <button
              onClick={handleBrowse}
              disabled={!backendReady || loading}
              className="w-full py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: (!backendReady || loading) ? "#1f2937" : "#4f46e5",
                color: (!backendReady || loading) ? "#4b5563" : "white",
                cursor: (!backendReady || loading) ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Chromium navigue…" : "▶ Lancer"}
            </button>

            {/* Presets */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p} onClick={() => setUrl(p)}
                  className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors">
                  {new URL(p).hostname.replace("www.", "")}
                </button>
              ))}
            </div>
          </div>

          {/* Historique */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {jobs.length === 0 && (
              <p className="text-xs text-gray-600 text-center mt-8">Lance une navigation pour commencer</p>
            )}
            {jobs.map(j => (
              <div key={j.id} onClick={() => setSelected(j)}
                className="rounded-xl p-3 cursor-pointer transition-all border"
                style={{
                  background: selected?.id === j.id ? "#1e1b4b" : "#111827",
                  borderColor: selected?.id === j.id ? "#4f46e5" : "#1f2937",
                }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-gray-500">#{j.id}</span>
                  <StatusBadge status={j.status} />
                </div>
                <p className="text-xs text-gray-300 truncate">{j.url}</p>
                {j.title && <p className="text-xs text-indigo-400 truncate mt-0.5">{j.title}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Zone principale — résultat */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4">
              <div className="text-5xl">🤖</div>
              <div>
                <h2 className="text-lg font-bold text-gray-300 mb-1">Agent prêt</h2>
                <p className="text-sm text-gray-600 max-w-sm">Entre une URL à gauche. Python va lancer un vrai Chromium, visiter la page et extraire les données.</p>
              </div>
            </div>
          ) : selected.status === "running" ? (
            <div className="h-full flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-300">Chromium navigue vers</p>
                <p className="text-xs text-indigo-400 mt-1">{selected.url}</p>
              </div>
            </div>
          ) : selected.status === "error" ? (
            <div className="bg-red-900/20 border border-red-800 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-red-400 mb-2">Erreur de navigation</h3>
              <p className="text-xs text-gray-400 font-mono">{selected.error}</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Méta */}
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-white truncate">{selected.title}</h2>
                    <a href={selected.url} target="_blank" rel="noreferrer"
                      className="text-xs text-indigo-400 hover:underline truncate block mt-0.5">{selected.url}</a>
                    {selected.description && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{selected.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-gray-600">Chargé en</p>
                    <p className="text-sm font-bold text-emerald-400">{selected.elapsed}s</p>
                  </div>
                </div>
              </div>

              {/* Screenshot */}
              {selected.screenshot && (
                <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/60" />
                      <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                      <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
                    </div>
                    <span className="text-xs text-gray-500 truncate flex-1">{selected.url}</span>
                    <span className="text-xs text-gray-600">screenshot · Chromium 1280×800</span>
                  </div>
                  <img
                    src={"data:image/jpeg;base64," + selected.screenshot}
                    alt="Screenshot"
                    className="w-full block"
                    style={{ imageRendering: "auto" }}
                  />
                </div>
              )}

              {/* Liens extraits */}
              {selected.links && selected.links.length > 0 && (
                <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                      Liens extraits ({selected.links.length})
                    </span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {selected.links.map((l, i) => (
                      <div key={i} className="px-5 py-2.5 flex items-center gap-3 hover:bg-gray-800/40 transition-colors">
                        <span className="text-xs text-gray-600 w-5 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-300 truncate">{l.text || "(sans texte)"}</p>
                          <p className="text-xs text-indigo-500 truncate">{l.href}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer */}
              <p className="text-center text-xs text-gray-700 pb-4">
                Visité par Python Playwright · Chromium headless · screenshot base64 · route POST /api/py/browse
              </p>
            </div>
          )}
        </div>
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
            "pip install fastapi uvicorn[standard] python-dotenv httpx playwright pydantic --quiet",
            { cwd: "/home/user", timeoutMs: 120000 }
          )
          // Installer Chromium pour Playwright
          console.log("[v0] Installing Playwright Chromium...")
          await sandbox.commands.run(
            "python3 -m playwright install chromium --with-deps 2>/dev/null || python3 -m playwright install chromium",
            { cwd: "/home/user", timeoutMs: 180000 }
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
