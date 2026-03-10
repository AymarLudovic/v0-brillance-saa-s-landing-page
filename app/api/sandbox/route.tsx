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
          `import sys
import platform
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "message": "Python backend ready"}

@app.get("/status")
def status():
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return {
        "status": "ok",
        "python_version": version,
        "platform": platform.system(),
        "server_time": datetime.now().strftime("%H:%M:%S"),
        "message": "FastAPI + Python operationnels",
        "math_check": 2 ** 32,
    }
`
        )
        await sandbox.files.write(
          "/home/user/backend/requirements.txt",
          `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-dotenv>=1.0.0
httpx>=0.27.0
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

        // page.tsx — Stack Demo : appelle vraiment FastAPI
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";

import { useState, useEffect } from "react";

interface PythonStatus {
  status: string;
  python_version: string;
  server_time: string;
  message: string;
  math_check: number;
}

interface StatusCardProps {
  label: string;
  value: string;
  ok?: boolean;
}

function StatusCard({ label, value, ok }: StatusCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2">
        {ok !== undefined && (
          <span className={ok ? "text-emerald-500" : "text-red-400"}>
            {ok ? "●" : "○"}
          </span>
        )}
        <span className="text-sm font-semibold text-gray-800">{value}</span>
      </div>
    </div>
  );
}

export default function Page() {
  const [python, setPython] = useState<PythonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetchPython = async () => {
    try {
      const res = await fetch("/api/py/status");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      setPython(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPython();
    const id = setInterval(() => {
      setTick(t => t + 1);
      fetchPython();
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 font-sans">

      {/* Header */}
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center text-white font-bold text-lg">S</div>
          <h1 className="text-2xl font-bold text-gray-900">Stack Demo</h1>
        </div>
        <p className="text-gray-500 text-sm">Next.js ↔ FastAPI Python — connexion en temps réel</p>
      </div>

      {/* Stack layers */}
      <div className="w-full max-w-lg space-y-3 mb-8">

        {/* Next.js layer */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 180 180" fill="white"><path d="M90 0C40.3 0 0 40.3 0 90s40.3 90 90 90 90-40.3 90-90S139.7 0 90 0Zm40 127.5L54.5 54H45v72.5h13V70l67.5 87H135V54h-13v73.5h8Z"/></svg>
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">Next.js 15</div>
                <div className="text-xs text-gray-400">Frontend · Port 3000</div>
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              Running
            </span>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center text-gray-300 text-lg">↕</div>

        {/* Python layer */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#3776AB] flex items-center justify-center">
                <span className="text-white text-xs font-bold">Py</span>
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-sm">FastAPI Python</div>
                <div className="text-xs text-gray-400">Backend · Port 8000 · /api/py/*</div>
              </div>
            </div>
            {loading ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"></span>
                Connecting…
              </span>
            ) : error ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full"></span>
                Error
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                Live
              </span>
            )}
          </div>

          {error && (
            <div className="text-xs text-red-500 bg-red-50 rounded-lg p-3 font-mono mb-3">
              {error}
            </div>
          )}

          {python && (
            <div className="grid grid-cols-2 gap-2">
              <StatusCard label="Python" value={python.python_version} ok={true} />
              <StatusCard label="Vérification math" value={"2³² = " + python.math_check} ok={python.math_check === 4294967296} />
              <StatusCard label="Heure serveur" value={python.server_time} />
              <StatusCard label="Statut" value={python.status} ok={python.status === "ok"} />
            </div>
          )}
        </div>
      </div>

      {/* Live request counter */}
      <div className="text-center">
        <p className="text-xs text-gray-400">
          Requête <span className="font-mono font-medium text-gray-600">GET /api/py/status</span> · actualisation toutes les 3s · {tick + 1} appel{tick > 0 ? "s" : ""}
        </p>
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
            "pip install fastapi uvicorn[standard] python-dotenv httpx --quiet",
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
