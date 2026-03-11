import { NextResponse } from "next/server"
import * as e2b from "@e2b/code-interpreter"

const SANDBOX_TIMEOUT_MS = 900000
const INSTALL_TIMEOUT_MS = 700000
const BUILD_TIMEOUT_MS = 300000

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

      // ═══════════════════════════════════════════════════════════════════════
      case "create": {
        console.log("[v0] Creating new sandbox...")

        const sandbox = await e2b.Sandbox.create({
          apiKey,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        })

        // ── package.json ──────────────────────────────────────────────────────
        await sandbox.files.write("/home/user/package.json", JSON.stringify({
          name: "nextjs-app",
          private: true,
          scripts: {
            dev:   "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next start -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next:       "15.1.0",
            react:      "19.0.0",
            "react-dom":"19.0.0",
            "lucide-react": "0.561.0",
          },
          devDependencies: {
            typescript:          "5.7.2",
            "@types/node":       "22.10.1",
            "@types/react":      "19.0.1",
            "@types/react-dom":  "19.0.1",
            tailwindcss:         "^3.4.1",
            postcss:             "^8",
            autoprefixer:        "^10.0.1",
          },
        }, null, 2))

        // ── tsconfig.json ─────────────────────────────────────────────────────
        await sandbox.files.write("/home/user/tsconfig.json", JSON.stringify({
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
        }, null, 2))

        // ── next.config.ts ────────────────────────────────────────────────────
        await sandbox.files.write("/home/user/next.config.ts",
`import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/py/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

export default nextConfig;`)

        // ── postcss.config.mjs ────────────────────────────────────────────────
        await sandbox.files.write("/home/user/postcss.config.mjs",
`const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
export default config;`)

        // ── tailwind.config.ts ────────────────────────────────────────────────
        await sandbox.files.write("/home/user/tailwind.config.ts",
`import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;`)

        // ── app/layout.tsx ────────────────────────────────────────────────────
        await sandbox.files.write("/home/user/app/layout.tsx",
`import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QR Studio",
  description: "QR Code Generator powered by Python",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}`)

        // ── app/globals.css ───────────────────────────────────────────────────
        await sandbox.files.write("/home/user/app/globals.css",
`@tailwind base;
@tailwind components;
@tailwind utilities;
body { font-family: Arial, Helvetica, sans-serif; }`)

        // ── backend/__init__.py ───────────────────────────────────────────────
        await sandbox.files.write("/home/user/backend/__init__.py", "")

        // ── backend/main.py ───────────────────────────────────────────────────
        await sandbox.files.write("/home/user/backend/main.py",
`import base64
import io
import urllib.parse
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer

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
    return {"status": "ok"}

@app.get("/status")
def status():
    return {"ready": True, "engine": "qrcode + Pillow"}

class QRRequest(BaseModel):
    text: str
    size: int = 10          # box_size
    border: int = 4
    color_fg: str = "#000000"
    color_bg: str = "#ffffff"
    rounded: bool = False
    error_correction: str = "M"   # L M Q H

@app.post("/generate")
def generate(req: QRRequest):
    try:
        ec_map = {"L": qrcode.constants.ERROR_CORRECT_L,
                  "M": qrcode.constants.ERROR_CORRECT_M,
                  "Q": qrcode.constants.ERROR_CORRECT_Q,
                  "H": qrcode.constants.ERROR_CORRECT_H}
        ec = ec_map.get(req.error_correction, qrcode.constants.ERROR_CORRECT_M)

        qr = qrcode.QRCode(
            error_correction=ec,
            box_size=max(1, min(req.size, 20)),
            border=max(0, min(req.border, 10)),
        )
        qr.add_data(req.text)
        qr.make(fit=True)

        if req.rounded:
            img = qr.make_image(
                image_factory=StyledPilImage,
                module_drawer=RoundedModuleDrawer(),
                fill_color=req.color_fg,
                back_color=req.color_bg,
            )
        else:
            img = qr.make_image(
                fill_color=req.color_fg,
                back_color=req.color_bg,
            )

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        version = qr.version or 0
        modules = (version * 4 + 17) if version else 0

        return {
            "success": True,
            "image": b64,
            "version": version,
            "modules": modules,
            "chars": len(req.text),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

class AnalyzeRequest(BaseModel):
    url: str

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    try:
        parsed = urllib.parse.urlparse(req.url)
        params = dict(urllib.parse.parse_qsl(parsed.query))
        return {
            "success": True,
            "scheme":   parsed.scheme,
            "host":     parsed.netloc,
            "path":     parsed.path,
            "params":   params,
            "fragment": parsed.fragment,
            "is_valid": bool(parsed.scheme and parsed.netloc),
            "param_count": len(params),
            "path_depth": len([p for p in parsed.path.split("/") if p]),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
`)

        // ── backend/requirements.txt ──────────────────────────────────────────
        await sandbox.files.write("/home/user/backend/requirements.txt",
`fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.0.0
qrcode[pil]>=7.4.2
pillow>=10.0.0
`)

        // ── app/page.tsx ──────────────────────────────────────────────────────
        // Suit EXACTEMENT le pattern de route_tsx__4_.txt :
        //   useEffect → let alive = true → poll() → setInterval → cleanup
        //   catch {} silencieux, pas de e.message exposé
        await sandbox.files.write("/home/user/app/page.tsx",
`"use client";
import { useState, useEffect, useRef } from "react";

type Mode = "qr" | "url";
type PyStatus = "connecting" | "live" | "error";
type EcLevel = "L" | "M" | "Q" | "H";

interface QRResult {
  success: boolean;
  image?: string;
  version?: number;
  modules?: number;
  chars?: number;
  error?: string;
}

interface URLResult {
  success: boolean;
  scheme?: string;
  host?: string;
  path?: string;
  params?: Record<string, string>;
  fragment?: string;
  is_valid?: boolean;
  param_count?: number;
  path_depth?: number;
  error?: string;
}

// ─── PATTERN EXACT DE route_tsx__4_.txt ──────────────────────────────────────
// setInterval fixe + alive flag + catch SILENCIEUX = jamais de "fetch failed"
function usePyStatus(): PyStatus {
  const [status, setStatus] = useState<PyStatus>("connecting");

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/py/status");
        if (!res.ok) throw new Error("not ok");
        await res.json();
        if (!alive) return;
        setStatus("live");
      } catch {
        if (!alive) return;
        setStatus(s => s === "live" ? "error" : s);
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return status;
}

// ─── QR Generator ────────────────────────────────────────────────────────────
function QRPanel() {
  const [text, setText] = useState("https://example.com");
  const [size, setSize] = useState(10);
  const [border, setBorder] = useState(4);
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [rounded, setRounded] = useState(false);
  const [ec, setEc] = useState<EcLevel>("M");
  const [result, setResult] = useState<QRResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/py/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, size, border, color_fg: fgColor, color_bg: bgColor, rounded, error_correction: ec }),
      });
      const data: QRResult = await res.json();
      if (data.success) setResult(data);
      else setError(data.error ?? "Erreur inconnue");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const EC_LEVELS: { key: EcLevel; label: string; desc: string }[] = [
    { key: "L", label: "L", desc: "7%" },
    { key: "M", label: "M", desc: "15%" },
    { key: "Q", label: "Q", desc: "25%" },
    { key: "H", label: "H", desc: "30%" },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 border-r border-gray-800 p-5 overflow-y-auto shrink-0 flex flex-col gap-4">
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Contenu</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="URL, texte, email, téléphone…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Taille</label>
            <div className="flex items-center gap-2">
              <input type="range" min={5} max={20} value={size} onChange={e => setSize(+e.target.value)}
                className="flex-1 accent-indigo-500 h-1" />
              <span className="text-xs text-gray-300 w-4 tabular-nums">{size}</span>
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Marge</label>
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={10} value={border} onChange={e => setBorder(+e.target.value)}
                className="flex-1 accent-indigo-500 h-1" />
              <span className="text-xs text-gray-300 w-4 tabular-nums">{border}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Couleur QR</label>
            <div className="flex items-center gap-2">
              <input type="color" value={fgColor} onChange={e => setFgColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
              <span className="text-xs text-gray-500 font-mono">{fgColor}</span>
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Fond</label>
            <div className="flex items-center gap-2">
              <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
              <span className="text-xs text-gray-500 font-mono">{bgColor}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">Correction d'erreur</label>
          <div className="flex gap-1.5">
            {EC_LEVELS.map(l => (
              <button key={l.key} onClick={() => setEc(l.key)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all flex flex-col items-center"
                style={{ background: ec===l.key?"#4f46e5":"#111827", borderColor: ec===l.key?"#4f46e5":"#1f2937", color: ec===l.key?"white":"#9ca3af" }}>
                <span>{l.label}</span>
                <span style={{ fontSize:"9px", opacity:0.7 }}>{l.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Modules arrondis</span>
          <button onClick={() => setRounded(r => !r)}
            className="w-10 h-5 rounded-full transition-colors relative"
            style={{ background: rounded ? "#4f46e5" : "#374151" }}>
            <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow"
              style={{ left: rounded ? "22px" : "2px" }} />
          </button>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
            <p className="text-xs text-red-300">⚠ {error}</p>
          </div>
        )}

        <button onClick={generate} disabled={loading || !text.trim()}
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all"
          style={{ background: (loading||!text.trim())?"#1f2937":"#4f46e5", color: (loading||!text.trim())?"#4b5563":"white" }}>
          {loading ? "⏳ Python génère…" : "▶ Générer QR Code"}
        </button>
      </div>

      {/* Zone résultat */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-950">
        {!result ? (
          <div className="text-center">
            <div className="text-6xl mb-4">⬛</div>
            <p className="text-gray-600 text-sm">Configure et génère ton QR code</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div className="rounded-2xl overflow-hidden border border-gray-800 shadow-2xl p-4 bg-white">
              <img src={"data:image/png;base64," + result.image} alt="QR Code"
                className="block" style={{ imageRendering: "pixelated", maxWidth: 360, maxHeight: 360, width: "100%", height: "auto" }} />
            </div>
            <div className="flex gap-6 text-center">
              {[
                { label: "Version", value: result.version },
                { label: "Modules", value: result.modules + "×" + result.modules },
                { label: "Caractères", value: result.chars },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-sm font-bold text-white">{item.value}</p>
                </div>
              ))}
            </div>
            <a href={"data:image/png;base64," + result.image} download="qrcode.png"
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">
              ⬇ Télécharger PNG
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── URL Analyzer ─────────────────────────────────────────────────────────────
function URLPanel() {
  const [url, setUrl] = useState("https://example.com/path?foo=bar&baz=qux#section");
  const [result, setResult] = useState<URLResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/py/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data: URLResult = await res.json();
      if (data.success) setResult(data);
      else setError(data.error ?? "Erreur");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const PRESETS = [
    "https://github.com/vercel/next.js/issues?q=bug&label=good+first+issue",
    "https://shop.example.com/products?category=shoes&size=42&color=black#reviews",
    "ftp://files.example.org/pub/data/archive.tar.gz",
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-96 border-r border-gray-800 p-5 flex flex-col gap-4 shrink-0">
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider mb-1.5 block">URL à analyser</label>
          <textarea
            value={url}
            onChange={e => setUrl(e.target.value)}
            rows={3}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none font-mono"
          />
        </div>

        <div>
          <p className="text-xs text-gray-600 mb-2">Exemples :</p>
          <div className="flex flex-col gap-1.5">
            {PRESETS.map((p, i) => (
              <button key={i} onClick={() => setUrl(p)}
                className="text-left text-xs text-indigo-400 hover:text-indigo-300 truncate px-2 py-1 rounded bg-gray-900 hover:bg-gray-800 transition-colors font-mono">
                {p}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
            <p className="text-xs text-red-300">⚠ {error}</p>
          </div>
        )}

        <button onClick={analyze} disabled={loading || !url.trim()}
          className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all"
          style={{ background: (loading||!url.trim())?"#1f2937":"#4f46e5", color: (loading||!url.trim())?"#4b5563":"white" }}>
          {loading ? "⏳ Python analyse…" : "▶ Analyser l'URL"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-gray-950">
        {!result ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-5xl mb-4">🔗</div>
            <p className="text-gray-600 text-sm">Entre une URL et clique Analyser</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-lg">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: result.is_valid ? "#22c55e" : "#ef4444" }} />
              <span className="text-sm font-semibold" style={{ color: result.is_valid ? "#22c55e" : "#ef4444" }}>
                {result.is_valid ? "URL valide" : "URL invalide"}
              </span>
            </div>

            {[
              { label: "Schéma", value: result.scheme, mono: true },
              { label: "Hôte", value: result.host, mono: true },
              { label: "Chemin", value: result.path || "/", mono: true },
              { label: "Fragment", value: result.fragment || "—", mono: true },
              { label: "Profondeur du chemin", value: String(result.path_depth), mono: false },
            ].map(row => (
              <div key={row.label} className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex justify-between items-center">
                <span className="text-xs text-gray-500">{row.label}</span>
                <span className={row.mono ? "text-sm text-indigo-300 font-mono" : "text-sm text-white font-semibold"}>
                  {row.value}
                </span>
              </div>
            ))}

            {result.params && Object.keys(result.params).length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-800">
                  <span className="text-xs text-gray-400 uppercase tracking-wider">Paramètres ({result.param_count})</span>
                </div>
                <div className="divide-y divide-gray-800">
                  {Object.entries(result.params).map(([k, v]) => (
                    <div key={k} className="px-4 py-2.5 flex justify-between items-center gap-4">
                      <span className="text-xs font-mono text-emerald-400">{k}</span>
                      <span className="text-xs font-mono text-gray-300 truncate text-right">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function Page() {
  const [mode, setMode] = useState<Mode>("qr");
  const pyStatus = usePyStatus();
  const live = pyStatus === "live";

  const statusColor = pyStatus === "live" ? "#22c55e" : pyStatus === "connecting" ? "#f59e0b" : "#ef4444";
  const statusLabel = pyStatus === "live" ? "Python prêt" : pyStatus === "connecting" ? "Démarrage…" : "Reconnexion…";

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col font-sans" style={{ height: "100vh" }}>

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-base">⬛</div>
          <div>
            <h1 className="text-sm font-bold leading-none">QR Studio</h1>
            <p className="text-xs text-gray-500">Généré par Python qrcode · Affiché par Next.js</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
            {([["qr", "⬛ QR Code", "Python qrcode"], ["url", "🔗 Analyser URL", "urllib.parse"]] as const).map(([key, label, sub]) => (
              <button key={key} onClick={() => setMode(key as Mode)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex flex-col items-center"
                style={{ background: mode===key?"#4f46e5":"transparent", color: mode===key?"white":"#9ca3af" }}>
                <span>{label}</span>
                <span style={{ fontSize: "9px", color: mode===key?"#c7d2fe":"#4b5563" }}>{sub}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: statusColor }} />
            <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </header>

      {/* Corps */}
      <div className="flex flex-1 overflow-hidden">
        {!live ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-300">
                {pyStatus === "connecting" ? "Démarrage Python FastAPI…" : "Reconnexion…"}
              </p>
              <p className="text-xs text-gray-600 mt-1">polling /api/py/status toutes les 2s</p>
            </div>
          </div>
        ) : (
          <>
            {mode === "qr"  && <QRPanel />}
            {mode === "url" && <URLPanel />}
          </>
        )}
      </div>
    </div>
  );
}
`)

        // ── pip install dans create (exactement comme route_tsx__4_.txt) ──────
        try {
          console.log("[v0] Setting up Python environment...")
          await sandbox.commands.run(
            "python3 -m pip install --upgrade pip --quiet 2>/dev/null || true",
            { cwd: "/home/user", timeoutMs: 60000 },
          )
          await sandbox.commands.run(
            "pip install fastapi 'uvicorn[standard]' pydantic 'qrcode[pil]' pillow --quiet",
            { cwd: "/home/user", timeoutMs: 180000 },
          )
          console.log("[v0] Python environment ready")
        } catch (pySetup: any) {
          console.log("[v0] Python setup warning (non-fatal):", pySetup.message)
        }

        console.log(`[v0] Sandbox créé: ${sandbox.sandboxId}`)
        return NextResponse.json({ success: true, sandboxId: sandbox.sandboxId })
      }

      // ═══════════════════════════════════════════════════════════════════════
      case "writeFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles))
          throw new Error("Paramètres manquants (sandboxId ou files[])")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        const writeResults: { filePath: string; success: boolean; error?: string }[] = []
        for (const f of requestFiles) {
          const fp = f.filePath || f.path
          if (!fp || typeof f.content !== "string") {
            writeResults.push({ filePath: fp || "inconnu", success: false, error: "filePath ou content manquant" })
            continue
          }
          try {
            await sandbox.files.write(`/home/user/${fp}`, f.content)
            writeResults.push({ filePath: fp, success: true })
          } catch (error: any) {
            writeResults.push({ filePath: fp, success: false, error: error.message })
          }
        }
        return NextResponse.json({ success: writeResults.every(r => r.success), writeResults })
      }

      // ═══════════════════════════════════════════════════════════════════════
      case "getFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")
        try {
          let sandbox: e2b.Sandbox
          try {
            sandbox = await e2b.Sandbox.connect(sid, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
          } catch {
            throw new Error(`Sandbox ${sid} is no longer available.`)
          }
          await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
          const { stdout: fileList } = await sandbox.commands.run(
            "find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.*'",
            { cwd: "/home/user", timeoutMs: 30000 },
          )
          const files: Record<string, string> = {}
          for (const fp of fileList.trim().split("\n").filter(p => p && p !== ".")) {
            try {
              const cleanPath = fp.replace(/^\.\//, "")
              const c = await sandbox.files.read(`/home/user/${cleanPath}`)
              files[cleanPath] = typeof c === "string" ? c : String(c)
            } catch {}
          }
          return NextResponse.json({ success: true, files, fileCount: Object.keys(files).length })
        } catch (error: any) {
          return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      case "addFile": {
        if (!bodySandboxId || !filePath || typeof content !== "string")
          throw new Error("Paramètres manquants")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        await sandbox.files.write(`/home/user/${filePath}`, content)
        return NextResponse.json({ success: true })
      }

      case "addFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles))
          throw new Error("Paramètres manquants")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        for (const f of requestFiles) {
          const fp = f.filePath || f.path
          if (!fp || typeof f.content !== "string") continue
          await sandbox.files.write(`/home/user/${fp}`, f.content)
        }
        return NextResponse.json({ success: true })
      }

      // ═══════════════════════════════════════════════════════════════════════
      case "install":
      case "build": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        let commandResult: any = { stdout: "", stderr: "", exitCode: -1 }
        let commandSuccess = false
        try {
          if (action === "install") {
            commandResult = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
              cwd: "/home/user", timeoutMs: INSTALL_TIMEOUT_MS,
            })
            try {
              const reqCheck = await sandbox.commands.run(
                "test -f /home/user/backend/requirements.txt && echo YES || echo NO",
                { timeoutMs: 5000 },
              )
              if (reqCheck.stdout.trim() === "YES") {
                await sandbox.commands.run(
                  "pip install -r /home/user/backend/requirements.txt --quiet",
                  { cwd: "/home/user", timeoutMs: 180000 },
                )
              }
            } catch {}
          } else {
            commandResult = await sandbox.commands.run("npm run build", {
              cwd: "/home/user", timeoutMs: BUILD_TIMEOUT_MS,
            })
          }
          commandSuccess = commandResult.exitCode === 0
        } catch (e: any) {
          commandResult = { stdout: "", stderr: e.message, exitCode: 1 }
        }
        return NextResponse.json({ success: commandSuccess, action, stdout: commandResult.stdout, stderr: commandResult.stderr })
      }

      // ═══════════════════════════════════════════════════════════════════════
      // CASE START — copié fidèlement de route_tsx__4_.txt
      // Ordre : kill → Python (uvicorn) → attente /health → Next.js → attente :3000
      case "start": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        // 1. Kill processus existants
        try {
          await sandbox.commands.run("pkill -f 'next dev' || true",   { cwd: "/home/user", timeoutMs: 5000 })
          await sandbox.commands.run("pkill -f 'next start' || true", { cwd: "/home/user", timeoutMs: 5000 })
          await sandbox.commands.run("fuser -k 3000/tcp || true",     { cwd: "/home/user", timeoutMs: 5000 })
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (e) {
          console.log("[v0] No existing process to kill or kill failed (this is OK)")
        }

        try {
          // 2. Démarrer FastAPI si backend/main.py existe
          let pythonStarted = false
          try {
            const pyCheck = await sandbox.commands.run(
              "test -f /home/user/backend/main.py && echo YES || echo NO",
              { timeoutMs: 5000 },
            )
            if (pyCheck.stdout.trim() === "YES") {
              console.log("[v0] Starting Python FastAPI backend...")
              await sandbox.commands.run("pkill -f uvicorn || true", { timeoutMs: 5000 }).catch(() => {})
              await new Promise(r => setTimeout(r, 1000))

              await sandbox.commands.run(
                "nohup python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload > /home/user/backend.log 2>&1 &",
                { cwd: "/home/user", timeoutMs: 10000 },
              )

              // Attendre que FastAPI réponde sur /health (max 15s)
              for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000))
                try {
                  const hc = await sandbox.commands.run(
                    "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health || echo 000",
                    { timeoutMs: 3000 },
                  )
                  if (hc.stdout.trim() === "200") {
                    pythonStarted = true
                    console.log("[v0] Python backend ready on port 8000!")
                    break
                  }
                } catch {}
              }

              if (!pythonStarted) {
                const blogResult = await sandbox.commands.run(
                  "tail -20 /home/user/backend.log 2>/dev/null || echo 'no logs'",
                  { timeoutMs: 3000 },
                ).catch(() => ({ stdout: "no logs" }))
                console.log("[v0] Python backend logs:", blogResult.stdout)
              }
            }
          } catch (pyErr: any) {
            console.log("[v0] Python backend start skipped:", pyErr.message)
          }

          // 3. Démarrer Next.js dev server
          await sandbox.commands.run("nohup npm run dev > /home/user/server.log 2>&1 &", {
            cwd: "/home/user",
            timeoutMs: 10000,
          })

          // 4. Attendre que Next.js soit prêt (max 30s)
          let serverReady = false
          let attempts = 0
          const maxAttempts = 30

          while (!serverReady && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000))
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

          let serverLogs = ""
          try {
            serverLogs = (await sandbox.commands.run("tail -100 /home/user/server.log", {
              cwd: "/home/user", timeoutMs: 5000,
            })).stdout
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
          return NextResponse.json({ success: false, action, error: e.message, stderr: e.message })
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      case "stop": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        try {
          await sandbox.commands.run("pkill -f 'next' || pkill -f 'uvicorn' || true", { timeoutMs: 10000 })
          await sandbox.commands.run("fuser -k 3000/tcp 2>/dev/null; fuser -k 8000/tcp 2>/dev/null || true", { timeoutMs: 5000 })
          return NextResponse.json({ success: true, message: "Server stopped" })
        } catch (e: any) {
          return NextResponse.json({ success: true, message: "Stop attempted", details: e.message })
        }
      }

      case "restart": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", sandboxId: bodySandboxId }) })
        const startResult = await (await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", sandboxId: bodySandboxId }) })).json()
        return NextResponse.json({ success: startResult.success, action: "restart", url: startResult.url, stdout: startResult.stdout, stderr: startResult.stderr })
      }

      case "logs": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        try {
          const logsResult = await sandbox.commands.run("tail -200 /home/user/server.log 2>/dev/null || echo 'No logs yet'", { timeoutMs: 10000 })
          return NextResponse.json({ success: true, logs: logsResult.stdout })
        } catch (e: any) {
          return NextResponse.json({ success: false, logs: "", error: e.message })
        }
      }

      case "status": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        try {
          const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 30000 })
          let serverRunning = false
          try {
            const checkResult = await sandbox.commands.run(
              "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo '000'",
              { cwd: "/home/user", timeoutMs: 5000 },
            )
            const httpCode = checkResult.stdout.trim()
            serverRunning = httpCode === "200" || httpCode === "304" || httpCode === "404"
          } catch {}
          return NextResponse.json({ success: true, connected: true, serverRunning, url: `https://${sandbox.getHost(3000)}` })
        } catch (error: any) {
          return NextResponse.json({ success: false, connected: false, serverRunning: false, error: error.message })
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
