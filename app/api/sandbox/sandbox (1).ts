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
import io
import subprocess
import tempfile
import os
import numpy as np
from PIL import Image, ImageEnhance
from pydub import AudioSegment
from pydub.effects import normalize
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── UTILITAIRES ────────────────────────────────────────────────

def b64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode()

def apply_photo_filter(img, name):
    arr = np.array(img).astype(float)
    if name == "bw":
        return img.convert("L").convert("RGB")
    if name == "vivid":
        return ImageEnhance.Color(img).enhance(2.1)
    if name == "vintage":
        r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
        nr = np.clip(r*0.393 + g*0.769 + b*0.189, 0, 255)
        ng = np.clip(r*0.349 + g*0.686 + b*0.168, 0, 255)
        nb = np.clip(r*0.272 + g*0.534 + b*0.131, 0, 255)
        return Image.fromarray(np.stack([nr, ng, nb], 2).astype(np.uint8))
    if name == "warm":
        arr[:,:,0] = np.clip(arr[:,:,0] * 1.15, 0, 255)
        arr[:,:,2] = np.clip(arr[:,:,2] * 0.85, 0, 255)
        return Image.fromarray(arr.astype(np.uint8))
    if name == "cool":
        arr[:,:,0] = np.clip(arr[:,:,0] * 0.85, 0, 255)
        arr[:,:,2] = np.clip(arr[:,:,2] * 1.2, 0, 255)
        return Image.fromarray(arr.astype(np.uint8))
    if name == "fade":
        arr = arr * 0.68 + 55
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if name == "cinema":
        arr[:,:,0] = np.clip(arr[:,:,0] * 0.9, 0, 255)
        arr[:,:,1] = np.clip(arr[:,:,1] * 0.88, 0, 255)
        arr[:,:,2] = np.clip(arr[:,:,2] * 1.1, 0, 255)
        return Image.fromarray(arr.astype(np.uint8))
    return img

# ─── PHOTO ──────────────────────────────────────────────────────

class PhotoReq(BaseModel):
    image: str
    brightness: float = 1.0
    contrast: float = 1.0
    saturation: float = 1.0
    sharpness: float = 1.0
    filter_name: str = "normal"
    rotate: int = 0

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/photo/process")
def photo_process(req: PhotoReq):
    try:
        img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
        if req.rotate:
            img = img.rotate(-req.rotate, expand=True)
        img = ImageEnhance.Brightness(img).enhance(req.brightness)
        img = ImageEnhance.Contrast(img).enhance(req.contrast)
        img = ImageEnhance.Color(img).enhance(req.saturation)
        img = ImageEnhance.Sharpness(img).enhance(req.sharpness)
        img = apply_photo_filter(img, req.filter_name)
        if max(img.size) > 2000:
            img.thumbnail((2000, 2000))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return {"success": True, "image": b64_encode(buf.getvalue())}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ─── AUDIO ──────────────────────────────────────────────────────

@app.post("/audio/analyze")
async def audio_analyze(file: UploadFile = File(...)):
    try:
        data = await file.read()
        ext = (file.filename or "audio.mp3").rsplit(".", 1)[-1].lower()
        seg = AudioSegment.from_file(io.BytesIO(data), format=ext)
        # Waveform : 200 points d'amplitude RMS
        chunk_ms = max(1, len(seg) // 200)
        points = []
        for i in range(0, len(seg), chunk_ms):
            chunk = seg[i:i+chunk_ms]
            rms = chunk.rms
            points.append(rms)
        if not points:
            points = [0]
        max_rms = max(points) or 1
        waveform = [round(v / max_rms, 4) for v in points[:200]]
        return {
            "success": True,
            "waveform": waveform,
            "duration_ms": len(seg),
            "channels": seg.channels,
            "sample_rate": seg.frame_rate,
            "format": ext,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/audio/process")
async def audio_process(
    file: UploadFile = File(...),
    bass: float = 0,
    mid: float = 0,
    treble: float = 0,
    speed: float = 1.0,
    volume: float = 0,
    normalize_audio: bool = False,
):
    try:
        data = await file.read()
        ext = (file.filename or "audio.mp3").rsplit(".", 1)[-1].lower()
        seg = AudioSegment.from_file(io.BytesIO(data), format=ext)

        # Volume (dB)
        if volume != 0:
            seg = seg + volume

        # EQ via ffmpeg equalizer
        with tempfile.TemporaryDirectory() as tmpdir:
            in_path  = os.path.join(tmpdir, "input." + ext)
            out_path = os.path.join(tmpdir, "output.mp3")
            seg.export(in_path, format=ext)

            eq_filters = []
            if bass != 0:
                eq_filters.append(f"equalizer=f=80:t=h:width=200:g={bass:.1f}")
            if mid != 0:
                eq_filters.append(f"equalizer=f=1000:t=h:width=1000:g={mid:.1f}")
            if treble != 0:
                eq_filters.append(f"equalizer=f=8000:t=h:width=4000:g={treble:.1f}")
            if speed != 1.0:
                eq_filters.append(f"atempo={max(0.5, min(2.0, speed)):.2f}")

            af = ",".join(eq_filters) if eq_filters else "anull"
            cmd = ["ffmpeg", "-y", "-i", in_path, "-af", af, "-b:a", "192k", out_path]
            subprocess.run(cmd, capture_output=True, timeout=60)

            with open(out_path, "rb") as f:
                out_bytes = f.read()

        return {
            "success": True,
            "audio": b64_encode(out_bytes),
            "mime": "audio/mpeg",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# ─── VIDEO ──────────────────────────────────────────────────────

VIDEO_FILTER_MAP = {
    "none":    "null",
    "vivid":   "eq=saturation=2:contrast=1.1",
    "bw":      "hue=s=0",
    "vintage": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "warm":    "colortemperature=temperature=7000",
    "cool":    "colortemperature=temperature=4000",
    "dramatic":"eq=contrast=1.4:brightness=-0.05:saturation=1.3",
}

@app.post("/video/process")
async def video_process(
    file: UploadFile = File(...),
    filter_name: str = "none",
    speed: float = 1.0,
    brightness: float = 1.0,
    contrast: float = 1.0,
):
    try:
        data = await file.read()
        ext = (file.filename or "video.mp4").rsplit(".", 1)[-1].lower()

        with tempfile.TemporaryDirectory() as tmpdir:
            in_path  = os.path.join(tmpdir, "input." + ext)
            out_path = os.path.join(tmpdir, "output.mp4")
            with open(in_path, "wb") as f:
                f.write(data)

            vf_parts = []
            base_filter = VIDEO_FILTER_MAP.get(filter_name, "null")
            if base_filter != "null":
                vf_parts.append(base_filter)
            if brightness != 1.0 or contrast != 1.0:
                b = brightness - 1.0
                vf_parts.append(f"eq=brightness={b:.2f}:contrast={contrast:.2f}")
            if speed != 1.0:
                vf_parts.append(f"setpts={round(1.0/speed, 4)}*PTS")

            vf = ",".join(vf_parts) if vf_parts else "null"

            af = f"atempo={max(0.5, min(2.0, speed)):.2f}" if speed != 1.0 else "anull"

            cmd = [
                "ffmpeg", "-y", "-i", in_path,
                "-vf", vf, "-af", af,
                "-c:v", "libx264", "-preset", "ultrafast",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                out_path,
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode != 0:
                return {"success": False, "error": result.stderr.decode()[-300:]}

            with open(out_path, "rb") as f:
                out_bytes = f.read()

        return {
            "success": True,
            "video": b64_encode(out_bytes),
            "mime": "video/mp4",
            "size_kb": round(len(out_bytes) / 1024, 1),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


        )
        await sandbox.files.write(
          "/home/user/backend/requirements.txt",
          `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
python-dotenv>=1.0.0
httpx>=0.27.0
pydantic>=2.0.0
pillow>=10.0.0
numpy>=1.26.0
pydub>=0.25.1
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

        // page.tsx — Creator Studio : Python traite, React affiche
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
import { useState, useRef } from "react";

type Tab = "photo" | "audio" | "video";

function Slider({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono tabular-nums">{value.toFixed(step < 1 ? 2 : 0)}{unit || ""}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-indigo-500 h-1" />
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
      style={{
        background: active ? "#4f46e5" : "#111827",
        borderColor: active ? "#4f46e5" : "#1f2937",
        color: active ? "white" : "#9ca3af",
      }}>
      {label}
    </button>
  );
}

function UploadBtn({ accept, label, icon, onFile }: {
  accept: string; label: string; icon: string; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mb-4">
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button onClick={() => ref.current?.click()}
        className="w-full py-3 rounded-xl border-2 border-dashed border-gray-700 hover:border-indigo-500 transition-colors flex flex-col items-center gap-1 text-gray-500 hover:text-indigo-400">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs text-gray-600">depuis votre appareil</span>
      </button>
    </div>
  );
}

// ─── PHOTO ──────────────────────────────────────────────────────

type PhotoFilter = "normal"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"fade"|"cinema";

function PhotoTab() {
  const [original, setOriginal] = useState<string|null>(null);
  const [result, setResult] = useState<string|null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [sharpness, setSharpness] = useState(1.0);
  const [filter, setFilter] = useState<PhotoFilter>("normal");
  const [rotate, setRotate] = useState(0);

  const loadFile = (f: File) => {
    setFilename(f.name); setResult(null); setShowResult(false);
    const r = new FileReader();
    r.onload = e => setOriginal((e.target?.result as string) || null);
    r.readAsDataURL(f);
  };

  const process = async () => {
    if (!original) return;
    setBusy(true);
    try {
      const res = await fetch("/api/py/photo/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: original.split(",")[1], brightness, contrast, saturation, sharpness, filter_name: filter, rotate }),
      });
      const d = await res.json();
      if (d.success) { setResult("data:image/jpeg;base64," + d.image); setShowResult(true); }
      else alert("Erreur Python : " + d.error);
    } finally { setBusy(false); }
  };

  const FILTERS: {key: PhotoFilter; label: string}[] = [
    {key:"normal",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},
    {key:"fade",label:"Fade"},{key:"cinema",label:"Cinema"},
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="image/*" label="Importer une photo" icon="🖼️" onFile={loadFile} />
        {original && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{filename}</p>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ajustements</p>
          <Slider label="Luminosité" value={brightness} min={0.1} max={2.5} step={0.05} onChange={setBrightness} />
          <Slider label="Contraste" value={contrast} min={0.1} max={2.5} step={0.05} onChange={setContrast} />
          <Slider label="Saturation" value={saturation} min={0} max={3} step={0.05} onChange={setSaturation} />
          <Slider label="Netteté" value={sharpness} min={0} max={4} step={0.1} onChange={setSharpness} />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Filtres</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {FILTERS.map(f => <Pill key={f.key} label={f.label} active={filter===f.key} onClick={() => setFilter(f.key)} />)}
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Rotation</p>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setRotate(r => (r+270)%360)} className="flex-1 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">↺ 90°</button>
            <button onClick={() => setRotate(r => (r+90)%360)} className="flex-1 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">↻ 90°</button>
          </div>
          <button onClick={process} disabled={busy}
            className="w-full py-2.5 rounded-xl font-semibold text-sm"
            style={{background: busy ? "#1f2937" : "#4f46e5", color: busy ? "#4b5563" : "white"}}>
            {busy ? "Python Pillow traite…" : "▶ Traiter via Python"}
          </button>
          <p className="text-xs text-gray-700 mt-2 text-center">Pillow + NumPy côté serveur</p>
        </>}
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-950 overflow-auto">
        {!original ? (
          <div className="text-center"><div className="text-5xl mb-3">🖼️</div><p className="text-gray-600 text-sm">Importe une photo pour commencer</p></div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
            <div className="flex gap-2">
              <button onClick={() => setShowResult(false)} className="px-3 py-1 rounded-lg text-xs border transition-all"
                style={{borderColor: !showResult ? "#4f46e5" : "#1f2937", color: !showResult ? "#818cf8" : "#6b7280", background: !showResult ? "#1e1b4b" : "transparent"}}>
                Original
              </button>
              {result && <button onClick={() => setShowResult(true)} className="px-3 py-1 rounded-lg text-xs border transition-all"
                style={{borderColor: showResult ? "#4f46e5" : "#1f2937", color: showResult ? "#818cf8" : "#6b7280", background: showResult ? "#1e1b4b" : "transparent"}}>
                Résultat Python
              </button>}
            </div>
            <div className="rounded-2xl overflow-hidden border border-gray-800 shadow-2xl w-full">
              <img src={showResult && result ? result : original} alt="preview" className="w-full object-contain max-h-96" />
            </div>
            {result && <a href={result} download="creator_photo.jpg"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">
              ⬇ Télécharger
            </a>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUDIO ──────────────────────────────────────────────────────

function AudioTab() {
  const [file, setFile] = useState<File|null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string|null>(null);
  const [info, setInfo] = useState<{duration_ms:number; sample_rate:number; channels:number}|null>(null);
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);

  const loadFile = async (f: File) => {
    setFile(f); setResultUrl(null); setWaveform([]);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/py/audio/analyze", { method: "POST", body: fd });
      const d = await res.json();
      if (d.success) {
        setWaveform(d.waveform);
        setInfo({ duration_ms: d.duration_ms, sample_rate: d.sample_rate, channels: d.channels });
      }
    } finally { setAnalyzing(false); }
  };

  const process = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = "/api/py/audio/process?bass=" + bass + "&mid=" + mid + "&treble=" + treble + "&speed=" + speed + "&volume=" + volume;
      const res = await fetch(url, { method: "POST", body: fd });
      const d = await res.json();
      if (d.success) {
        const blob = base64ToBlob(d.audio, d.mime);
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(blob));
      } else alert("Erreur Python : " + d.error);
    } finally { setProcessing(false); }
  };

  const base64ToBlob = (b64: string, mime: string) => {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return Math.floor(s/60).toString().padStart(2,"0") + ":" + (s%60).toString().padStart(2,"0");
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="audio/*" label="Importer un audio" icon="🎵" onFile={loadFile} />
        {file && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{file.name}</p>
          {info && <div className="bg-gray-900 rounded-lg p-2 mb-3 text-xs text-gray-500 flex gap-3">
            <span>{fmtDuration(info.duration_ms)}</span>
            <span>{info.sample_rate}Hz</span>
            <span>{info.channels}ch</span>
          </div>}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">EQ (via ffmpeg Python)</p>
          <Slider label="Basses 80Hz" value={bass} min={-20} max={20} step={1} onChange={setBass} unit="dB" />
          <Slider label="Médiums 1kHz" value={mid} min={-20} max={20} step={1} onChange={setMid} unit="dB" />
          <Slider label="Aigus 8kHz" value={treble} min={-20} max={20} step={1} onChange={setTreble} unit="dB" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Mixage</p>
          <Slider label="Volume" value={volume} min={-20} max={20} step={1} onChange={setVolume} unit="dB" />
          <Slider label="Vitesse" value={speed} min={0.5} max={2.0} step={0.05} onChange={setSpeed} unit="x" />
          <button onClick={process} disabled={processing || analyzing}
            className="w-full py-2.5 rounded-xl font-semibold text-sm mt-3"
            style={{background: processing ? "#1f2937" : "#4f46e5", color: processing ? "#4b5563" : "white"}}>
            {processing ? "Python + ffmpeg…" : "▶ Traiter via Python"}
          </button>
          <p className="text-xs text-gray-700 mt-2 text-center">pydub + ffmpeg côté serveur</p>
        </>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 overflow-auto gap-5">
        {!file ? (
          <div className="text-center"><div className="text-5xl mb-3">🎵</div><p className="text-gray-600 text-sm">Importe un fichier audio pour commencer</p></div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-5">
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
              <p className="text-xs text-gray-500 mb-3">Waveform — analysée par Python pydub (RMS par chunk)</p>
              {analyzing ? (
                <div className="flex items-center justify-center h-20 gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  <span className="text-xs text-gray-500">Python analyse le fichier…</span>
                </div>
              ) : (
                <div className="flex items-end gap-0.5 h-20">
                  {waveform.map((v, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-indigo-600/80"
                      style={{ height: Math.max(2, v * 76) + "px" }} />
                  ))}
                </div>
              )}
            </div>

            {resultUrl && (
              <div className="bg-gray-900 rounded-2xl border border-emerald-800/50 p-5">
                <p className="text-xs text-emerald-400 mb-3 font-semibold">✅ Audio traité par Python — EQ + vitesse appliqués</p>
                <audio controls src={resultUrl} className="w-full" style={{accentColor: "#4f46e5"}} />
                <a href={resultUrl} download="creator_audio.mp3"
                  className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">
                  ⬇ Télécharger
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VIDEO ──────────────────────────────────────────────────────

type VideoFilter = "none"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"dramatic";

function VideoTab() {
  const [file, setFile] = useState<File|null>(null);
  const [originalUrl, setOriginalUrl] = useState<string|null>(null);
  const [resultUrl, setResultUrl] = useState<string|null>(null);
  const [processing, setProcessing] = useState(false);
  const [sizeKb, setSizeKb] = useState<number|null>(null);
  const [filter, setFilter] = useState<VideoFilter>("none");
  const [speed, setSpeed] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);

  const loadFile = (f: File) => {
    setFile(f); setResultUrl(null); setSizeKb(null);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(f));
  };

  const process = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = "/api/py/video/process?filter_name=" + filter + "&speed=" + speed + "&brightness=" + brightness + "&contrast=" + contrast;
      const res = await fetch(url, { method: "POST", body: fd });
      const d = await res.json();
      if (d.success) {
        const bytes = atob(d.video);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], {type: "video/mp4"});
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(blob));
        setSizeKb(d.size_kb);
      } else alert("Erreur Python : " + d.error);
    } finally { setProcessing(false); }
  };

  const VF: {key: VideoFilter; label: string}[] = [
    {key:"none",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},
    {key:"dramatic",label:"Dramatic"},
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="video/*" label="Importer une vidéo" icon="🎬" onFile={loadFile} />
        {file && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{file.name}</p>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filtre (ffmpeg Python)</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {VF.map(f => <Pill key={f.key} label={f.label} active={filter===f.key} onClick={() => setFilter(f.key)} />)}
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ajustements</p>
          <Slider label="Luminosité" value={brightness} min={0.1} max={2.0} step={0.05} onChange={setBrightness} />
          <Slider label="Contraste" value={contrast} min={0.1} max={2.0} step={0.05} onChange={setContrast} />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Vitesse</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[0.5,1,1.5,2].map(s => <Pill key={s} label={s+"x"} active={speed===s} onClick={() => setSpeed(s)} />)}
          </div>
          <button onClick={process} disabled={processing}
            className="w-full py-2.5 rounded-xl font-semibold text-sm"
            style={{background: processing ? "#1f2937" : "#4f46e5", color: processing ? "#4b5563" : "white"}}>
            {processing ? "ffmpeg Python encode…" : "▶ Encoder via Python"}
          </button>
          <p className="text-xs text-gray-700 mt-2 text-center">ffmpeg subprocess côté serveur</p>
        </>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 overflow-auto gap-5">
        {!file ? (
          <div className="text-center"><div className="text-5xl mb-3">🎬</div><p className="text-gray-600 text-sm">Importe une vidéo pour commencer</p></div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-4">
            {originalUrl && !resultUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Aperçu original (lecture navigateur)</p>
                <div className="rounded-2xl overflow-hidden border border-gray-800">
                  <video src={originalUrl} controls className="w-full" style={{display:"block"}} />
                </div>
              </div>
            )}
            {resultUrl && (
              <div>
                <p className="text-xs text-emerald-400 mb-2 font-semibold">
                  ✅ Encodé par Python ffmpeg — filtre {filter}, vitesse {speed}x
                  {sizeKb && <span className="text-gray-500 ml-2">({sizeKb} KB)</span>}
                </p>
                <div className="rounded-2xl overflow-hidden border border-emerald-800/40">
                  <video src={resultUrl} controls autoPlay className="w-full" style={{display:"block"}} />
                </div>
                <a href={resultUrl} download="creator_video.mp4"
                  className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold">
                  ⬇ Télécharger
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LAYOUT PRINCIPAL ────────────────────────────────────────────

export default function Page() {
  const [tab, setTab] = useState<Tab>("photo");

  const TABS: {key: Tab; label: string; icon: string; desc: string}[] = [
    {key:"photo", label:"Photo", icon:"🖼️", desc:"Pillow + NumPy"},
    {key:"audio", label:"Audio", icon:"🎵", desc:"pydub + ffmpeg"},
    {key:"video", label:"Vidéo", icon:"🎬", desc:"ffmpeg subprocess"},
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans flex flex-col" style={{height:"100vh"}}>
      <header className="border-b border-gray-800 px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold">CS</div>
          <div>
            <h1 className="text-sm font-bold leading-none">Creator Studio</h1>
            <p className="text-xs text-gray-500">Python FastAPI traite tout · Next.js affiche tout</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex flex-col items-center"
              style={{background: tab===t.key ? "#4f46e5" : "transparent", color: tab===t.key ? "white" : "#9ca3af"}}>
              <span>{t.icon} {t.label}</span>
              <span className="text-gray-600" style={{fontSize:"9px", color: tab===t.key ? "#c7d2fe" : "#4b5563"}}>{t.desc}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {tab === "photo" && <PhotoTab />}
        {tab === "audio" && <AudioTab />}
        {tab === "video" && <VideoTab />}
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
            "pip install fastapi uvicorn[standard] python-dotenv httpx pydantic pillow numpy pydub --quiet",
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
