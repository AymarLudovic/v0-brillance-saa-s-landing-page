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
          `import io
import uuid
import base64
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageEnhance, ImageOps

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Stockage en mémoire : session_id -> Image PIL originale
sessions: dict[str, Image.Image] = {}
MAX_SESSIONS = 20

def cleanup_sessions():
    if len(sessions) > MAX_SESSIONS:
        oldest = list(sessions.keys())[0]
        del sessions[oldest]

def img_to_base64(img: Image.Image, quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

def apply_edits(original: Image.Image, params: dict) -> Image.Image:
    # Travailler sur une copie redimensionnée pour l'affichage (vitesse maximale)
    img = original.copy()
    img.thumbnail((1400, 1400), Image.LANCZOS)

    # --- Transformations géométriques ---
    rotation = params.get("rotation", 0)
    if rotation:
        img = img.rotate(-rotation, expand=True)
    if params.get("flip_h"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if params.get("flip_v"):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

    # --- Réglages tonaux via NumPy ---
    arr = np.array(img, dtype=np.float32)

    # Exposition (-2 à +2 stops)
    exposure = params.get("exposure", 0)
    if exposure != 0:
        arr *= (2.0 ** exposure)

    # Hautes lumières & Ombres
    highlights = params.get("highlights", 0)
    shadows = params.get("shadows", 0)
    if highlights != 0 or shadows != 0:
        norm = np.clip(arr / 255.0, 0, 1)
        if highlights != 0:
            mask = norm ** 2
            arr += (highlights / 100.0) * mask * 90
        if shadows != 0:
            mask = (1.0 - norm) ** 2
            arr += (shadows / 100.0) * mask * 90

    # Température couleur (-100 froid → +100 chaud)
    temp = params.get("temperature", 0)
    if temp != 0:
        factor = temp / 100.0
        arr[:, :, 0] = np.clip(arr[:, :, 0] + factor * 28, 0, 255)  # Rouge
        arr[:, :, 2] = np.clip(arr[:, :, 2] - factor * 28, 0, 255)  # Bleu

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)

    # --- Améliorations PIL ---
    b = params.get("brightness", 1.0)
    if b != 1.0:
        img = ImageEnhance.Brightness(img).enhance(b)

    c = params.get("contrast", 1.0)
    if c != 1.0:
        img = ImageEnhance.Contrast(img).enhance(c)

    s = params.get("saturation", 1.0)
    if s != 1.0:
        img = ImageEnhance.Color(img).enhance(s)

    sh = params.get("sharpness", 1.0)
    if sh != 1.0:
        img = ImageEnhance.Sharpness(img).enhance(sh)

    # --- Filtres créatifs ---
    f = params.get("filter", "none")

    if f == "bw":
        img = ImageOps.grayscale(img).convert("RGB")

    elif f == "sepia":
        gray = np.array(ImageOps.grayscale(img), dtype=np.float32)
        out = np.stack([
            np.clip(gray * 1.08, 0, 255),
            np.clip(gray * 0.85, 0, 255),
            np.clip(gray * 0.66, 0, 255),
        ], axis=2).astype(np.uint8)
        img = Image.fromarray(out)

    elif f == "cinematic":
        arr = np.array(img, dtype=np.float32)
        # Ombres bleu-vert, hautes lumières orange
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.06 + 8, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.88, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
        img = ImageEnhance.Contrast(img).enhance(1.18)

    elif f == "fade":
        arr = np.array(img, dtype=np.float32)
        arr = arr * 0.86 + 30
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    elif f == "vignette":
        arr = np.array(img, dtype=np.float32)
        h, w = arr.shape[:2]
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt(((X - w / 2) / (w / 2)) ** 2 + ((Y - h / 2) / (h / 2)) ** 2)
        mask = np.clip(1.0 - 0.72 * dist ** 1.6, 0, 1)
        arr *= mask[:, :, np.newaxis]
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    elif f == "chrome":
        arr = np.array(img, dtype=np.float32)
        arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.1, 0, 255)
        arr[:, :, 1] = np.clip(arr[:, :, 1] * 0.95, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.85, 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
        img = ImageEnhance.Contrast(img).enhance(1.3)
        img = ImageEnhance.Color(img).enhance(1.2)

    return img


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    original = Image.open(io.BytesIO(data)).convert("RGB")

    session_id = str(uuid.uuid4())
    cleanup_sessions()
    sessions[session_id] = original

    # Envoyer une preview initiale (sans modifications)
    preview = original.copy()
    preview.thumbnail((1400, 1400), Image.LANCZOS)
    b64 = img_to_base64(preview, quality=90)

    return {
        "session_id": session_id,
        "image": b64,
        "width": original.width,
        "height": original.height,
    }


@app.websocket("/ws/edit")
async def ws_edit(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            session_id = data.get("session_id")

            if not session_id or session_id not in sessions:
                await ws.send_json({"error": "Session introuvable"})
                continue

            original = sessions[session_id]
            params = data.get("params", {})

            try:
                result = apply_edits(original, params)
                b64 = img_to_base64(result, quality=88)
                await ws.send_json({"image": b64})
            except Exception as e:
                await ws.send_json({"error": str(e)})

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
Pillow>=10.0.0
numpy>=1.24.0
python-multipart>=0.0.9
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

body {
  font-family: Arial, Helvetica, sans-serif;
}

input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 9999px;
  outline: none;
  cursor: pointer;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
  border: 2px solid #18181b;
  transition: transform 0.1s;
}
input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #6366f1;
  cursor: pointer;
  border: 2px solid #18181b;
}
input[type='range']:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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

        // page.tsx — Éditeur photo Lightroom-like (Next.js + FastAPI WebSocket)
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type FilterType = "none" | "bw" | "sepia" | "cinematic" | "fade" | "vignette" | "chrome";

interface Params {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  temperature: number;
  sharpness: number;
  rotation: number;
  flip_h: boolean;
  flip_v: boolean;
  filter: FilterType;
}

const DEFAULT: Params = {
  exposure: 0, brightness: 1, contrast: 1,
  highlights: 0, shadows: 0, saturation: 1,
  temperature: 0, sharpness: 1,
  rotation: 0, flip_h: false, flip_v: false,
  filter: "none",
};

const SLIDERS = [
  { key: "exposure",    label: "Exposition",    min: -2,   max: 2,   step: 0.05, zero: 0   },
  { key: "brightness",  label: "Luminosité",    min: 0,    max: 3,   step: 0.05, zero: 1   },
  { key: "contrast",    label: "Contraste",     min: 0,    max: 3,   step: 0.05, zero: 1   },
  { key: "highlights",  label: "Hautes lumières", min: -100, max: 100, step: 1, zero: 0  },
  { key: "shadows",     label: "Ombres",        min: -100, max: 100, step: 1,    zero: 0   },
  { key: "saturation",  label: "Saturation",    min: 0,    max: 3,   step: 0.05, zero: 1   },
  { key: "temperature", label: "Température",   min: -100, max: 100, step: 1,    zero: 0   },
  { key: "sharpness",   label: "Netteté",       min: 0,    max: 3,   step: 0.05, zero: 1   },
] as const;

const FILTERS: { id: FilterType; emoji: string; label: string }[] = [
  { id: "none",      emoji: "○", label: "Original"  },
  { id: "bw",        emoji: "◐", label: "N&B"       },
  { id: "sepia",     emoji: "◕", label: "Sépia"     },
  { id: "cinematic", emoji: "◆", label: "Cinéma"    },
  { id: "fade",      emoji: "◇", label: "Fade"      },
  { id: "vignette",  emoji: "●", label: "Vignette"  },
  { id: "chrome",    emoji: "◈", label: "Chrome"    },
];

type Status = "idle" | "uploading" | "ready" | "processing" | "error";

export default function Page() {
  const [image, setImage]         = useState<string | null>(null);
  const [params, setParams]       = useState<Params>({ ...DEFAULT });
  const [status, setStatus]       = useState<Status>("idle");
  const [dragging, setDragging]   = useState(false);
  const [errMsg, setErrMsg]       = useState("");
  const [origSize, setOrigSize]   = useState("");

  const sessionRef   = useRef<string | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const pendingRef   = useRef<Params | null>(null);
  const busyRef      = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- WebSocket ----------
  const sendToWs = useCallback((p: Params) => {
    const ws = wsRef.current;
    const sid = sessionRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sid) return;

    if (busyRef.current) {
      pendingRef.current = p; // on garde le dernier en attente
      return;
    }
    busyRef.current = true;
    ws.send(JSON.stringify({ session_id: sid, params: p }));
  }, []);

  const connectWs = useCallback((sid: string, initialParams: Params) => {
    wsRef.current?.close();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(\`\${proto}//\${window.location.host}/api/py/ws/edit\`);
    wsRef.current = ws;

    ws.onopen = () => {
      busyRef.current = false;
      ws.send(JSON.stringify({ session_id: sid, params: initialParams }));
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.image) {
        setImage(\`data:image/jpeg;base64,\${data.image}\`);
        setStatus("ready");
      } else if (data.error) {
        setErrMsg(data.error);
        setStatus("error");
      }
      busyRef.current = false;
      // Vider la file d'attente
      if (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        sendToWs(next);
      }
    };

    ws.onerror = () => { setStatus("error"); setErrMsg("WebSocket error"); };
    ws.onclose = () => { if (sessionRef.current) setStatus("error"); };
  }, [sendToWs]);

  // ---------- Upload ----------
  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setStatus("uploading");
    setErrMsg("");
    setParams({ ...DEFAULT });
    sessionRef.current = null;

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res  = await fetch("/api/py/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.session_id) throw new Error(data.detail || "Upload échoué");

      sessionRef.current = data.session_id;
      setImage(\`data:image/jpeg;base64,\${data.image}\`);
      setOrigSize(\`\${data.width} × \${data.height} px\`);
      connectWs(data.session_id, { ...DEFAULT });
    } catch (err: any) {
      setStatus("error");
      setErrMsg(err.message);
    }
  }, [connectWs]);

  // ---------- Param update ----------
  const update = useCallback(<K extends keyof Params>(key: K, value: Params[K]) => {
    setParams(prev => {
      const next = { ...prev, [key]: value };
      setStatus("processing");
      sendToWs(next);
      return next;
    });
  }, [sendToWs]);

  const rotate = useCallback((deg: number) => {
    setParams(prev => {
      const next = { ...prev, rotation: (prev.rotation + deg + 360) % 360 };
      setStatus("processing");
      sendToWs(next);
      return next;
    });
  }, [sendToWs]);

  const reset = useCallback(() => {
    const p = { ...DEFAULT };
    setParams(p);
    setStatus("processing");
    sendToWs(p);
  }, [sendToWs]);

  const download = useCallback(() => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = "photo-editee.jpg";
    a.click();
  }, [image]);

  // ---------- Drag & Drop ----------
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ---------- Helpers ----------
  const hasSession = !!sessionRef.current && status !== "uploading";

  const displayVal = (key: string, val: number, zero: number) => {
    if (zero === 1) {
      const diff = Math.round((val - 1) * 100);
      return diff === 0 ? "0" : diff > 0 ? \`+\${diff}\` : \`\${diff}\`;
    }
    const v = key === "exposure" ? val.toFixed(1) : Math.round(val).toString();
    return val > 0 ? \`+\${v}\` : v;
  };

  const statusDot: Record<Status, string> = {
    idle:       "#6b7280",
    uploading:  "#f59e0b",
    ready:      "#22c55e",
    processing: "#6366f1",
    error:      "#ef4444",
  };
  const statusText: Record<Status, string> = {
    idle:       "En attente",
    uploading:  "Upload…",
    ready:      "Connecté · live",
    processing: "Traitement…",
    error:      "Erreur",
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col select-none">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-base">📷</div>
          <span className="font-semibold text-sm">PhotoEdit</span>
          {origSize && <span className="text-xs text-zinc-500 hidden sm:block">{origSize}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: statusDot[status], boxShadow: status === "ready" || status === "processing" ? \`0 0 6px \${statusDot[status]}\` : "none" }}
          />
          <span className="text-xs" style={{ color: statusDot[status] }}>
            {status === "error" ? errMsg || statusText[status] : statusText[status]}
          </span>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Preview */}
        <div
          className="flex-1 flex items-center justify-center bg-zinc-950 overflow-hidden"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {!image ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={\`cursor-pointer flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-2xl p-16 mx-8 transition-all \${
                dragging ? "border-indigo-400 bg-indigo-950/20" : "border-zinc-700 hover:border-zinc-500"
              }\`}
            >
              <span className="text-6xl">🖼️</span>
              <div className="text-center">
                <p className="text-zinc-200 font-medium">Glissez une photo ici</p>
                <p className="text-zinc-500 text-sm mt-1">ou cliquez pour sélectionner · JPG PNG WEBP</p>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center justify-center w-full h-full p-4">
              <img
                src={image}
                alt="Aperçu"
                className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
                style={{ maxHeight: "calc(100vh - 56px)" }}
              />
              {status === "processing" && (
                <div className="absolute top-4 right-4 w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 hover:bg-black/90 text-zinc-300 text-xs px-4 py-2 rounded-full backdrop-blur transition-all"
              >
                Changer de photo
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>

        {/* ── Panneau de contrôle ── */}
        <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto shrink-0">

          {/* Réglages */}
          <section className="p-4 border-b border-zinc-800">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Réglages</p>
            <div className="flex flex-col gap-4">
              {SLIDERS.map(({ key, label, min, max, step, zero }) => {
                const val = params[key as keyof Params] as number;
                const pct = ((val - min) / (max - min)) * 100;
                const modified = val !== zero;
                return (
                  <div key={key}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className={\`text-xs \${modified ? "text-zinc-200" : "text-zinc-500"}\`}>{label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={\`text-xs font-mono \${modified ? "text-indigo-400" : "text-zinc-600"}\`}>
                          {displayVal(key, val, zero)}
                        </span>
                        {modified && (
                          <button
                            onClick={() => update(key as keyof Params, zero as Params[typeof key])}
                            className="text-zinc-600 hover:text-zinc-300 text-xs leading-none"
                            title="Reset"
                          >✕</button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range" min={min} max={max} step={step} value={val}
                      disabled={!hasSession}
                      onChange={(e) => update(key as keyof Params, parseFloat(e.target.value) as Params[typeof key])}
                      style={{ background: \`linear-gradient(to right, \${modified ? "#6366f1" : "#52525b"} \${pct}%, #27272a \${pct}%)\` }}
                      className="w-full"
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Filtres */}
          <section className="p-4 border-b border-zinc-800">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Filtres</p>
            <div className="grid grid-cols-2 gap-1.5">
              {FILTERS.map(({ id, emoji, label }) => (
                <button
                  key={id}
                  disabled={!hasSession}
                  onClick={() => update("filter", id)}
                  className={\`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-30 \${
                    params.filter === id
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  }\`}
                >
                  <span>{emoji}</span> {label}
                </button>
              ))}
            </div>
          </section>

          {/* Transformation */}
          <section className="p-4 border-b border-zinc-800">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Transformation</p>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { icon: "↺", title: "Rotation gauche",  fn: () => rotate(-90) },
                { icon: "↻", title: "Rotation droite",  fn: () => rotate(90)  },
                { icon: "↔", title: "Miroir horizontal", fn: () => update("flip_h", !params.flip_h) },
                { icon: "↕", title: "Miroir vertical",   fn: () => update("flip_v", !params.flip_v) },
              ].map(({ icon, title, fn }) => (
                <button key={title} title={title} disabled={!hasSession} onClick={fn}
                  className="py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-all disabled:opacity-30">
                  {icon}
                </button>
              ))}
            </div>
            {(params.flip_h || params.flip_v || params.rotation !== 0) && (
              <p className="text-xs text-indigo-400 mt-2 text-center">
                {params.rotation !== 0 && \`\${params.rotation}°  \`}
                {params.flip_h && "↔ "}
                {params.flip_v && "↕"}
              </p>
            )}
          </section>

          {/* Actions */}
          <section className="p-4 flex flex-col gap-2 mt-auto">
            <button disabled={!hasSession} onClick={reset}
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all disabled:opacity-30">
              Réinitialiser tout
            </button>
            <button disabled={!image} onClick={download}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-30">
              ↓ Télécharger
            </button>
          </section>

        </aside>
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
