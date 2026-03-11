import { NextResponse } from "next/server"
import * as e2b from "@e2b/code-interpreter"

const SANDBOX_TIMEOUT_MS = 900000
const INSTALL_TIMEOUT_MS = 700000
const BUILD_TIMEOUT_MS = 300000
const START_TIMEOUT_MS = 120000

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

        const sandbox = await e2b.Sandbox.create({
          apiKey,
          timeoutMs: SANDBOX_TIMEOUT_MS,
        })

        // ─── package.json ────────────────────────────────────────────────────
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
            "lucide-react": "0.561.0",
          },
          devDependencies: {
            typescript: "5.7.2",
            "@types/node": "22.10.1",
            "@types/react": "19.0.1",
            "@types/react-dom": "19.0.1",
            tailwindcss: "^3.4.1",
            postcss: "^8",
            autoprefixer: "^10.0.1",
          },
        }
        await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPackageJson, null, 2))

        // ─── tsconfig.json ────────────────────────────────────────────────────
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

        // ─── next.config.ts ───────────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/next.config.ts",
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

export default nextConfig;`,
        )

        // ─── backend/__init__.py ──────────────────────────────────────────────
        await sandbox.files.write("/home/user/backend/__init__.py", `# Backend Python FastAPI\n`)

        // ─── backend/main.py ──────────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/backend/main.py",
          `import base64, io, subprocess, tempfile, os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/status")
def status():
    import shutil, sys
    return {
        "ready": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "python": sys.version.split()[0],
    }

def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()

class PhotoReq(BaseModel):
    image: str
    brightness: float = 1.0
    contrast: float = 1.0
    saturation: float = 1.0
    sharpness: float = 1.0
    filter_name: str = "normal"
    rotate: int = 0

@app.post("/photo/process")
def photo_process(req: PhotoReq):
    try:
        import numpy as np
        from PIL import Image, ImageEnhance
    except ImportError as e:
        return {"success": False, "error": "Pillow/numpy manquant: " + str(e)}
    try:
        img = Image.open(io.BytesIO(base64.b64decode(req.image))).convert("RGB")
        if req.rotate: img = img.rotate(-req.rotate, expand=True)
        img = ImageEnhance.Brightness(img).enhance(req.brightness)
        img = ImageEnhance.Contrast(img).enhance(req.contrast)
        img = ImageEnhance.Color(img).enhance(req.saturation)
        img = ImageEnhance.Sharpness(img).enhance(req.sharpness)
        arr = np.array(img).astype(float)
        name = req.filter_name
        if name == "bw":
            img = img.convert("L").convert("RGB")
        elif name == "vivid":
            img = ImageEnhance.Color(img).enhance(2.1)
        elif name == "vintage":
            r,g,b = arr[:,:,0],arr[:,:,1],arr[:,:,2]
            img = Image.fromarray(np.stack([
                np.clip(r*.393+g*.769+b*.189,0,255),
                np.clip(r*.349+g*.686+b*.168,0,255),
                np.clip(r*.272+g*.534+b*.131,0,255)],2).astype(np.uint8))
        elif name == "warm":
            arr[:,:,0]=np.clip(arr[:,:,0]*1.15,0,255)
            arr[:,:,2]=np.clip(arr[:,:,2]*.85,0,255)
            img = Image.fromarray(arr.astype(np.uint8))
        elif name == "cool":
            arr[:,:,0]=np.clip(arr[:,:,0]*.85,0,255)
            arr[:,:,2]=np.clip(arr[:,:,2]*1.2,0,255)
            img = Image.fromarray(arr.astype(np.uint8))
        elif name == "fade":
            img = Image.fromarray(np.clip(arr*.68+55,0,255).astype(np.uint8))
        elif name == "cinema":
            arr[:,:,0]=np.clip(arr[:,:,0]*.9,0,255)
            arr[:,:,1]=np.clip(arr[:,:,1]*.88,0,255)
            arr[:,:,2]=np.clip(arr[:,:,2]*1.1,0,255)
            img = Image.fromarray(arr.astype(np.uint8))
        if max(img.size) > 1400: img.thumbnail((1400,1400))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return {"success": True, "image": b64(buf.getvalue())}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/audio/analyze")
async def audio_analyze(file: UploadFile = File(...)):
    try:
        from pydub import AudioSegment
    except ImportError as e:
        return {"success": False, "error": "pydub manquant: " + str(e)}
    try:
        data = await file.read()
        ext = (file.filename or "audio.mp3").rsplit(".",1)[-1].lower()
        seg = AudioSegment.from_file(io.BytesIO(data), format=ext)
        chunk = max(1, len(seg)//200)
        pts = [seg[i:i+chunk].rms for i in range(0,len(seg),chunk)]
        mx = max(pts) if pts else 1
        return {
            "success": True,
            "waveform": [round(v/(mx or 1),4) for v in pts[:200]],
            "duration_ms": len(seg),
            "channels": seg.channels,
            "sample_rate": seg.frame_rate,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/audio/process")
async def audio_process(
    file: UploadFile = File(...),
    bass: float=0, mid: float=0, treble: float=0,
    speed: float=1.0, volume: float=0,
):
    try:
        from pydub import AudioSegment
    except ImportError as e:
        return {"success": False, "error": "pydub manquant: " + str(e)}
    try:
        data = await file.read()
        ext = (file.filename or "audio.mp3").rsplit(".",1)[-1].lower()
        seg = AudioSegment.from_file(io.BytesIO(data), format=ext)
        if volume: seg = seg + volume
        with tempfile.TemporaryDirectory() as d:
            inp = os.path.join(d, "i." + ext)
            out = os.path.join(d, "o.mp3")
            seg.export(inp, format=ext)
            flt = []
            if bass:   flt.append(f"equalizer=f=80:t=h:width=200:g={bass:.1f}")
            if mid:    flt.append(f"equalizer=f=1000:t=h:width=1000:g={mid:.1f}")
            if treble: flt.append(f"equalizer=f=8000:t=h:width=4000:g={treble:.1f}")
            if speed != 1.0: flt.append(f"atempo={max(.5,min(2.,speed)):.2f}")
            subprocess.run(
                ["ffmpeg","-y","-i",inp,"-af",",".join(flt) if flt else "anull","-q:a","4",out],
                capture_output=True, timeout=60,
            )
            return {"success": True, "audio": b64(open(out,"rb").read()), "mime": "audio/mpeg"}
    except Exception as e:
        return {"success": False, "error": str(e)}

VIDEO_FILTERS = {
    "none":     "null",
    "vivid":    "eq=saturation=2:contrast=1.1",
    "bw":       "hue=s=0",
    "vintage":  "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "warm":     "colortemperature=temperature=7000",
    "cool":     "colortemperature=temperature=4000",
    "dramatic": "eq=contrast=1.4:brightness=-0.05:saturation=1.3",
}

@app.post("/video/process")
async def video_process(
    file: UploadFile = File(...),
    filter_name: str="none", speed: float=1.0,
    brightness: float=1.0, contrast: float=1.0,
):
    try:
        data = await file.read()
        ext = (file.filename or "video.mp4").rsplit(".",1)[-1].lower()
        with tempfile.TemporaryDirectory() as d:
            inp = os.path.join(d, "i." + ext)
            out = os.path.join(d, "o.mp4")
            open(inp, "wb").write(data)
            vf = []
            bf = VIDEO_FILTERS.get(filter_name, "null")
            if bf != "null": vf.append(bf)
            if brightness != 1. or contrast != 1.:
                vf.append(f"eq=brightness={brightness-1.:.2f}:contrast={contrast:.2f}")
            if speed != 1.: vf.append(f"setpts={round(1./speed,4)}*PTS")
            vf.append("scale='min(1280,iw)':-2")
            af = f"atempo={max(.5,min(2.,speed)):.2f}" if speed != 1. else "anull"
            r = subprocess.run(
                ["ffmpeg","-y","-i",inp,
                 "-vf", ",".join(vf),
                 "-af", af,
                 "-c:v","libx264","-preset","ultrafast",
                 "-c:a","aac","-b:a","128k",
                 "-movflags","+faststart",out],
                capture_output=True, timeout=120,
            )
            if r.returncode:
                return {"success": False, "error": r.stderr.decode()[-300:]}
            return {
                "success": True,
                "video": b64(open(out,"rb").read()),
                "mime": "video/mp4",
                "size_kb": round(os.path.getsize(out)/1024, 1),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}
`,
        )

        // ─── backend/requirements.txt ─────────────────────────────────────────
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
`,
        )

        // ─── app/layout.tsx ───────────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/app/layout.tsx",
          `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Generated App",
  description: "Generated by AI Developer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-black margin-0 padding-0">{children}</body>
    </html>
  );
}`,
        )

        // ─── app/globals.css ──────────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/app/globals.css",
          `@tailwind base;
@tailwind components;
@tailwind utilities;

body { font-family: Arial, Helvetica, sans-serif; }`,
        )

        // ─── postcss.config.mjs ───────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/postcss.config.mjs",
          `/** @type {import('postcss-load-config').Config} */
const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
export default config;`,
        )

        // ─── tailwind.config.ts ───────────────────────────────────────────────
        await sandbox.files.write(
          "/home/user/tailwind.config.ts",
          `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: { extend: {} },
  plugins: [],
};
export default config;`,
        )

        // ─── app/page.tsx ─────────────────────────────────────────────────────
        // STRUCTURE CLÉ copiée du fichier system monitor (route_tsx__4_.txt) :
        //
        //  useEffect(() => {
        //    let alive = true
        //    const poll = async () => {
        //      try {
        //        const res = await fetch("/api/py/status")   ← poll direct
        //        if (!res.ok) throw new Error(...)
        //        setStatus("live")
        //      } catch {                                      ← catch SILENCIEUX
        //        if (!alive) return
        //        setStatus("error")                          ← pas de e.message exposé
        //      }
        //    }
        //    poll()
        //    const id = setInterval(poll, 1500)              ← interval fixe
        //    return () => { alive = false; clearInterval(id) }
        //  }, [])
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
import { useState, useEffect, useRef } from "react";

type Tab = "photo" | "audio" | "video";
type PyStatus = "connecting" | "live" | "error";
type PhotoFilter = "normal"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"fade"|"cinema";
type VideoFilter = "none"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"dramatic";

// ─── Utilitaires ─────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono tabular-nums">
          {value.toFixed(step < 1 ? 2 : 0)}{unit ?? ""}
        </span>
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

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 mb-3">
      <p className="text-xs text-red-300">⚠ {msg}</p>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}

async function callPy<T>(url: string, opts: RequestInit): Promise<T> {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("HTTP " + res.status + (txt ? " — " + txt.slice(0,120) : ""));
  }
  return res.json();
}

// ─── PHOTO ───────────────────────────────────────────────────────────────────
function PhotoTab({ live }: { live: boolean }) {
  const [original, setOriginal] = useState<string|null>(null);
  const [result, setResult]     = useState<string|null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy]         = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [err, setErr]           = useState<string|null>(null);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast]     = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [sharpness, setSharpness]   = useState(1.0);
  const [filter, setFilter]         = useState<PhotoFilter>("normal");
  const [rotate, setRotate]         = useState(0);

  const loadFile = (f: File) => {
    setFilename(f.name); setResult(null); setShowResult(false); setErr(null);
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      setOriginal(canvas.toDataURL("image/jpeg", 0.88));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setErr("Impossible de lire l'image");
    img.src = url;
  };

  const process = async () => {
    if (!original || !live) return;
    setBusy(true); setErr(null);
    try {
      const d = await callPy<any>("/api/py/photo/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: original.split(",")[1], brightness, contrast, saturation, sharpness, filter_name: filter, rotate }),
      });
      if (d.success) { setResult("data:image/jpeg;base64," + d.image); setShowResult(true); }
      else setErr("Python : " + d.error);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const FILTERS: { key: PhotoFilter; label: string }[] = [
    {key:"normal",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},
    {key:"fade",label:"Fade"},{key:"cinema",label:"Cinema"},
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="image/*" label="Importer une photo" icon="🖼️" onFile={loadFile} />
        {err && <ErrBox msg={err} />}
        {original && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{filename}</p>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ajustements</p>
          <Slider label="Luminosité" value={brightness} min={0.1} max={2.5} step={0.05} onChange={setBrightness} />
          <Slider label="Contraste"  value={contrast}   min={0.1} max={2.5} step={0.05} onChange={setContrast} />
          <Slider label="Saturation" value={saturation} min={0}   max={3}   step={0.05} onChange={setSaturation} />
          <Slider label="Netteté"    value={sharpness}  min={0}   max={4}   step={0.1}  onChange={setSharpness} />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Filtres</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {FILTERS.map(f => <Pill key={f.key} label={f.label} active={filter===f.key} onClick={() => setFilter(f.key)} />)}
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Rotation</p>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setRotate(r => (r+270)%360)} className="flex-1 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">↺ 90°</button>
            <button onClick={() => setRotate(r => (r+90)%360)}  className="flex-1 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">↻ 90°</button>
          </div>
          <button onClick={process} disabled={busy || !live}
            className="w-full py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: (busy||!live) ? "#1f2937" : "#4f46e5", color: (busy||!live) ? "#4b5563" : "white" }}>
            {busy ? "⏳ Python traite…" : "▶ Traiter via Python"}
          </button>
        </>}
      </div>
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-950 overflow-auto">
        {!original ? (
          <div className="text-center"><div className="text-5xl mb-3">🖼️</div><p className="text-gray-600 text-sm">Importe une photo</p></div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
            <div className="flex gap-2">
              <button onClick={() => setShowResult(false)} className="px-3 py-1 rounded-lg text-xs border"
                style={{ borderColor: !showResult?"#4f46e5":"#1f2937", color: !showResult?"#818cf8":"#6b7280", background: !showResult?"#1e1b4b":"transparent" }}>
                Original
              </button>
              {result && <button onClick={() => setShowResult(true)} className="px-3 py-1 rounded-lg text-xs border"
                style={{ borderColor: showResult?"#4f46e5":"#1f2937", color: showResult?"#818cf8":"#6b7280", background: showResult?"#1e1b4b":"transparent" }}>
                Résultat
              </button>}
            </div>
            <div className="rounded-2xl overflow-hidden border border-gray-800 w-full">
              <img src={showResult && result ? result : original} alt="preview" className="w-full object-contain max-h-96" />
            </div>
            {result && <a href={result} download="photo.jpg" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUDIO ───────────────────────────────────────────────────────────────────
function AudioTab({ live }: { live: boolean }) {
  const [file, setFile]         = useState<File|null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [analyzing, setAnalyzing]   = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl]   = useState<string|null>(null);
  const [info, setInfo]         = useState<{duration_ms:number;sample_rate:number;channels:number}|null>(null);
  const [err, setErr]           = useState<string|null>(null);
  const [bass, setBass]         = useState(0);
  const [mid, setMid]           = useState(0);
  const [treble, setTreble]     = useState(0);
  const [speed, setSpeed]       = useState(1.0);
  const [volume, setVolume]     = useState(0);

  const loadFile = async (f: File) => {
    if (f.size > 8*1024*1024) { setErr("Fichier trop lourd (max 8MB)"); return; }
    setFile(f); setResultUrl(null); setWaveform([]); setErr(null); setAnalyzing(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const d = await callPy<any>("/api/py/audio/analyze", { method: "POST", body: fd });
      if (d.success) { setWaveform(d.waveform); setInfo({ duration_ms: d.duration_ms, sample_rate: d.sample_rate, channels: d.channels }); }
      else setErr("Analyse : " + d.error);
    } catch (e: any) { setErr(e.message); }
    finally { setAnalyzing(false); }
  };

  const process = async () => {
    if (!file || !live) return;
    setProcessing(true); setErr(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const url = \`/api/py/audio/process?bass=\${bass}&mid=\${mid}&treble=\${treble}&speed=\${speed}&volume=\${volume}\`;
      const d = await callPy<any>(url, { method: "POST", body: fd });
      if (d.success) {
        const bytes = atob(d.audio);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(new Blob([arr], { type: d.mime })));
      } else setErr("Python : " + d.error);
    } catch (e: any) { setErr(e.message); }
    finally { setProcessing(false); }
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms/1000);
    return Math.floor(s/60).toString().padStart(2,"0") + ":" + (s%60).toString().padStart(2,"0");
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="audio/*" label="Importer un audio" icon="🎵" onFile={loadFile} />
        {err && <ErrBox msg={err} />}
        {file && <>
          <p className="text-xs text-gray-600 mb-2 truncate">{file.name}</p>
          {info && <div className="bg-gray-900 rounded-lg p-2 mb-3 text-xs text-gray-500 flex gap-3">
            <span>{fmt(info.duration_ms)}</span><span>{info.sample_rate}Hz</span><span>{info.channels}ch</span>
          </div>}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">EQ (ffmpeg)</p>
          <Slider label="Basses 80Hz"  value={bass}   min={-20} max={20} step={1}    onChange={setBass}   unit="dB" />
          <Slider label="Médiums 1kHz" value={mid}    min={-20} max={20} step={1}    onChange={setMid}    unit="dB" />
          <Slider label="Aigus 8kHz"   value={treble} min={-20} max={20} step={1}    onChange={setTreble} unit="dB" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Mixage</p>
          <Slider label="Volume" value={volume} min={-20} max={20} step={1}    onChange={setVolume} unit="dB" />
          <Slider label="Vitesse" value={speed} min={0.5} max={2.0} step={0.05} onChange={setSpeed}  unit="x" />
          <button onClick={process} disabled={processing||analyzing||!live}
            className="w-full py-2.5 rounded-xl font-semibold text-sm mt-3"
            style={{ background: (processing||!live)?"#1f2937":"#4f46e5", color: (processing||!live)?"#4b5563":"white" }}>
            {processing ? "⏳ Python + ffmpeg…" : "▶ Traiter via Python"}
          </button>
        </>}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 gap-5">
        {!file ? (
          <div className="text-center"><div className="text-5xl mb-3">🎵</div><p className="text-gray-600 text-sm">Importe un fichier audio</p></div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-5">
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
              <p className="text-xs text-gray-500 mb-3">Waveform — RMS calculé par Python pydub</p>
              {analyzing ? (
                <div className="flex items-center justify-center h-20 gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  <span className="text-xs text-gray-500">Analyse en cours…</span>
                </div>
              ) : (
                <div className="flex items-end gap-0.5 h-20">
                  {waveform.map((v, i) => <div key={i} className="flex-1 rounded-sm bg-indigo-600/80" style={{ height: Math.max(2, v*76)+"px" }} />)}
                </div>
              )}
            </div>
            {resultUrl && (
              <div className="bg-gray-900 rounded-2xl border border-emerald-800/50 p-5">
                <p className="text-xs text-emerald-400 mb-3 font-semibold">✅ Audio traité par Python</p>
                <audio controls src={resultUrl} className="w-full" />
                <a href={resultUrl} download="audio.mp3" className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VIDEO ───────────────────────────────────────────────────────────────────
function VideoTab({ live }: { live: boolean }) {
  const [file, setFile]           = useState<File|null>(null);
  const [originalUrl, setOriginalUrl] = useState<string|null>(null);
  const [resultUrl, setResultUrl] = useState<string|null>(null);
  const [processing, setProcessing] = useState(false);
  const [sizeKb, setSizeKb]       = useState<number|null>(null);
  const [err, setErr]             = useState<string|null>(null);
  const [filter, setFilter]       = useState<VideoFilter>("none");
  const [speed, setSpeed]         = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast]   = useState(1.0);

  const loadFile = (f: File) => {
    if (f.size > 15*1024*1024) { setErr("Vidéo trop lourde (max 15MB)"); return; }
    setFile(f); setResultUrl(null); setSizeKb(null); setErr(null);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(f));
  };

  const process = async () => {
    if (!file || !live) return;
    setProcessing(true); setErr(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const url = \`/api/py/video/process?filter_name=\${filter}&speed=\${speed}&brightness=\${brightness}&contrast=\${contrast}\`;
      const d = await callPy<any>(url, { method: "POST", body: fd });
      if (d.success) {
        const bytes = atob(d.video);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(new Blob([arr], { type: "video/mp4" })));
        setSizeKb(d.size_kb);
      } else setErr("Python : " + d.error);
    } catch (e: any) { setErr(e.message); }
    finally { setProcessing(false); }
  };

  const VF: { key: VideoFilter; label: string }[] = [
    {key:"none",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},{key:"dramatic",label:"Dramatic"},
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="video/*" label="Importer une vidéo" icon="🎬" onFile={loadFile} />
        {err && <ErrBox msg={err} />}
        {file && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{file.name}</p>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filtre (ffmpeg)</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {VF.map(f => <Pill key={f.key} label={f.label} active={filter===f.key} onClick={() => setFilter(f.key)} />)}
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ajustements</p>
          <Slider label="Luminosité" value={brightness} min={0.1} max={2.0} step={0.05} onChange={setBrightness} />
          <Slider label="Contraste"  value={contrast}   min={0.1} max={2.0} step={0.05} onChange={setContrast} />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Vitesse</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[0.5,1,1.5,2].map(s => <Pill key={s} label={s+"x"} active={speed===s} onClick={() => setSpeed(s)} />)}
          </div>
          <button onClick={process} disabled={processing||!live}
            className="w-full py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: (processing||!live)?"#1f2937":"#4f46e5", color: (processing||!live)?"#4b5563":"white" }}>
            {processing ? "⏳ ffmpeg encode…" : "▶ Encoder via Python"}
          </button>
        </>}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 gap-4">
        {!file ? (
          <div className="text-center"><div className="text-5xl mb-3">🎬</div><p className="text-gray-600 text-sm">Importe une vidéo</p></div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-4">
            {originalUrl && !resultUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Original</p>
                <div className="rounded-2xl overflow-hidden border border-gray-800">
                  <video src={originalUrl} controls className="w-full" style={{display:"block"}} />
                </div>
              </div>
            )}
            {resultUrl && (
              <div>
                <p className="text-xs text-emerald-400 mb-2 font-semibold">
                  ✅ Encodé par Python ffmpeg — {filter}, {speed}x {sizeKb && <span className="text-gray-500">({sizeKb} KB)</span>}
                </p>
                <div className="rounded-2xl overflow-hidden border border-emerald-800/40">
                  <video src={resultUrl} controls autoPlay className="w-full" style={{display:"block"}} />
                </div>
                <a href={resultUrl} download="video.mp4" className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ─────────────────────────────────────────────────────────
export default function Page() {
  const [tab, setTab] = useState<Tab>("photo");
  const [pyStatus, setPyStatus] = useState<PyStatus>("connecting");

  // ── PATTERN CLÉ copié du system monitor (route_tsx__4_.txt) ──────────────
  // setInterval fixe + alive flag + catch silencieux = pas de "fetch failed"
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/py/status");
        if (!res.ok) throw new Error("not ok");
        await res.json();
        if (!alive) return;
        setPyStatus("live");
      } catch {
        if (!alive) return;
        setPyStatus(s => s === "live" ? "error" : s === "connecting" ? "connecting" : "error");
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const live = pyStatus === "live";

  const statusColor = pyStatus === "live" ? "#22c55e" : pyStatus === "connecting" ? "#f59e0b" : "#ef4444";
  const statusLabel = pyStatus === "live" ? "Python prêt" : pyStatus === "connecting" ? "Démarrage…" : "Reconnexion…";

  const TABS: { key: Tab; icon: string; label: string; desc: string }[] = [
    { key: "photo", icon: "🖼️", label: "Photo",  desc: "Pillow + NumPy" },
    { key: "audio", icon: "🎵", label: "Audio",  desc: "pydub + ffmpeg" },
    { key: "video", icon: "🎬", label: "Vidéo",  desc: "ffmpeg subprocess" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans flex flex-col" style={{ height: "100vh" }}>
      {/* Header */}
      <header className="border-b border-gray-800 px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold">CS</div>
          <div>
            <h1 className="text-sm font-bold leading-none">Creator Studio</h1>
            <p className="text-xs text-gray-500">Python FastAPI traite tout · Next.js affiche tout</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Onglets */}
          <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex flex-col items-center"
                style={{ background: tab===t.key?"#4f46e5":"transparent", color: tab===t.key?"white":"#9ca3af" }}>
                <span>{t.icon} {t.label}</span>
                <span style={{ fontSize:"9px", color: tab===t.key?"#c7d2fe":"#4b5563" }}>{t.desc}</span>
              </button>
            ))}
          </div>
          {/* Indicateur Python */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: statusColor, boxShadow: live?"0 0 6px #22c55e":"none" }} />
            <span className="text-xs" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
        </div>
      </header>

      {/* Corps */}
      <div className="flex flex-1 overflow-hidden">
        {!live && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-300">
                {pyStatus === "connecting" ? "Démarrage Python FastAPI…" : "Reconnexion au backend Python…"}
              </p>
              <p className="text-xs text-gray-600 mt-1">polling /api/py/status toutes les 2s</p>
            </div>
          </div>
        )}
        {live && tab === "photo" && <PhotoTab live={live} />}
        {live && tab === "audio" && <AudioTab live={live} />}
        {live && tab === "video" && <VideoTab live={live} />}
      </div>
    </div>
  );
}
`,
        )

        // ─── Setup Python dans create (pip install, même pattern que route_tsx__4_) ──
        try {
          console.log("[v0] Setting up Python environment...")
          await sandbox.commands.run(
            "python3 -m pip install --upgrade pip --quiet 2>/dev/null || true",
            { cwd: "/home/user", timeoutMs: 60000 },
          )
          await sandbox.commands.run(
            "pip install fastapi 'uvicorn[standard]' python-dotenv httpx pydantic pillow numpy pydub --quiet",
            { cwd: "/home/user", timeoutMs: 180000 },
          )
          console.log("[v0] Python environment ready")
        } catch (pySetup: any) {
          console.log("[v0] Python setup warning (non-fatal):", pySetup.message)
        }

        console.log(`[v0] Sandbox créé: ${sandbox.sandboxId}`)
        return NextResponse.json({ success: true, sandboxId: sandbox.sandboxId })
      }

      // ─────────────────────────────────────────────────────────────────────────
      case "writeFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles))
          throw new Error("Paramètres manquants (sandboxId ou files[])")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        const writeResults: { filePath: string; success: boolean; error?: string }[] = []
        for (const f of requestFiles) {
          const filePathValue = f.filePath || f.path
          const contentValue  = f.content
          if (!filePathValue || typeof contentValue !== "string") {
            writeResults.push({ filePath: filePathValue || "inconnu", success: false, error: "filePath ou content manquant/invalide" })
            continue
          }
          try {
            await sandbox.files.write(`/home/user/${filePathValue}`, contentValue)
            writeResults.push({ filePath: filePathValue, success: true })
          } catch (error: any) {
            writeResults.push({ filePath: filePathValue, success: false, error: error.message })
          }
        }
        return NextResponse.json({ success: writeResults.every(r => r.success), message: `${requestFiles.length} files processed`, writeResults })
      }

      case "getFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        try {
          let sandbox: e2b.Sandbox
          try {
            sandbox = await e2b.Sandbox.connect(sid, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
          } catch (connectError: any) {
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
              const content = await sandbox.files.read(`/home/user/${cleanPath}`)
              if (cleanPath.endsWith(".json")) {
                try { files[cleanPath] = JSON.stringify(JSON.parse(content as string), null, 2) }
                catch { files[cleanPath] = content as string }
              } else {
                files[cleanPath] = typeof content === "string" ? content : String(content)
              }
            } catch (_) {}
          }
          return NextResponse.json({ success: true, files, fileCount: Object.keys(files).length })
        } catch (error: any) {
          return NextResponse.json({ success: false, error: "Failed to extract files", details: error.message, sandboxId: sid }, { status: 500 })
        }
      }

      case "processFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")
        const extractResult = await (await fetch(`${req.url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "getFiles", sandboxId: sid }) })).json()
        if (!extractResult.success) throw new Error(`Failed to extract files: ${extractResult.error}`)
        const processedFiles: Record<string, { content: string; encoding: string }> = {}
        for (const [filePath, content] of Object.entries(extractResult.files)) {
          const fileContent = content as string
          if (typeof fileContent !== "string") continue
          processedFiles[filePath] = { content: Buffer.from(fileContent, "utf8").toString("base64"), encoding: "base64" }
        }
        return NextResponse.json({ success: true, files: processedFiles, fileCount: Object.keys(processedFiles).length })
      }

      case "addFile": {
        if (!bodySandboxId || !filePath || typeof content !== "string" || content.trim().length === 0)
          throw new Error("Paramètres manquants ou contenu vide")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        await sandbox.files.write(`/home/user/${filePath}`, content)
        return NextResponse.json({ success: true, message: `File ${filePath} written` })
      }

      case "addFiles": {
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles))
          throw new Error("Paramètres manquants (sandboxId ou files[])")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        for (const f of requestFiles) {
          const fp = f.filePath || f.path
          if (!fp || typeof f.content !== "string" || f.content.trim().length === 0) continue
          await sandbox.files.write(`/home/user/${fp}`, f.content)
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
            commandResult = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
              cwd: "/home/user", timeoutMs: INSTALL_TIMEOUT_MS,
            })
            // pip install depuis requirements.txt
            try {
              const reqCheck = await sandbox.commands.run(
                "test -f /home/user/backend/requirements.txt && echo YES || echo NO",
                { timeoutMs: 5000 },
              )
              if (reqCheck.stdout.trim() === "YES") {
                console.log("[v0] Installing Python dependencies from requirements.txt...")
                const pipResult = await sandbox.commands.run(
                  "pip install -r /home/user/backend/requirements.txt --quiet",
                  { cwd: "/home/user", timeoutMs: 180000 },
                )
                if (pipResult.exitCode !== 0) {
                  commandResult = { ...commandResult, stderr: (commandResult.stderr||"") + "\n[pip] " + pipResult.stderr }
                }
              }
            } catch (pipErr: any) {
              console.log("[v0] pip install skipped:", pipErr.message)
            }
          } else {
            commandResult = await sandbox.commands.run("npm run build", {
              cwd: "/home/user", timeoutMs: BUILD_TIMEOUT_MS,
            })
          }
          commandSuccess = commandResult.exitCode === 0
        } catch (e: any) {
          commandResult = { stdout: e.stdout||"", stderr: e.stderr||e.message||"", exitCode: 1 }
          commandSuccess = false
        }

        console.log(`[v0] Commande '${action}' exécutée. Exit Code: ${commandResult.exitCode}`)
        return NextResponse.json({ success: commandSuccess, action, result: commandResult, stdout: commandResult.stdout, stderr: commandResult.stderr })
      }

      case "start": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        // ── 1. Kill processus existants ──────────────────────────────────────
        try {
          await sandbox.commands.run("pkill -f 'next dev' || true", { cwd: "/home/user", timeoutMs: 5000 })
          await sandbox.commands.run("pkill -f 'next start' || true", { cwd: "/home/user", timeoutMs: 5000 })
          await sandbox.commands.run("fuser -k 3000/tcp || true", { cwd: "/home/user", timeoutMs: 5000 })
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (e) {
          console.log("[v0] No existing process to kill or kill failed (this is OK)")
        }

        try {
          // ── 2. Démarrer FastAPI ────────────────────────────────────────────
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

          // ── 3. Démarrer Next.js ────────────────────────────────────────────
          await sandbox.commands.run("nohup npm run dev > /home/user/server.log 2>&1 &", {
            cwd: "/home/user", timeoutMs: 10000,
          })

          // ── 4. Attendre Next.js prêt ───────────────────────────────────────
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
              if (httpCode === "200" || httpCode === "304" || httpCode === "404") serverReady = true
            } catch (e) {
              console.log(`[v0] Server check attempt ${attempts} failed`)
            }
          }

          const url = `https://${sandbox.getHost(3000)}`
          let serverLogs = ""
          try {
            serverLogs = (await sandbox.commands.run("tail -100 /home/user/server.log", { cwd: "/home/user", timeoutMs: 5000 })).stdout
          } catch (e) { console.log("[v0] Could not read server logs") }

          console.log(`[v0] Server started. URL: ${url}, Ready: ${serverReady}`)
          const pythonUrl = pythonStarted ? `https://${sandbox.getHost(8000)}` : null
          return NextResponse.json({ success: serverReady, action, url, pythonUrl, pythonStarted, ready: serverReady, attempts, stdout: serverLogs, stderr: serverReady ? "" : "Server may not be ready yet" })
        } catch (e: any) {
          console.error("[v0] Error starting server:", e)
          return NextResponse.json({ success: false, action, error: e.message, stderr: e.message })
        }
      }

      case "stop": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)
        try {
          await sandbox.commands.run("pkill -f 'next' || pkill -f 'uvicorn' || true", { cwd: "/home/user", timeoutMs: 10000 })
          await sandbox.commands.run("fuser -k 3000/tcp 2>/dev/null; fuser -k 8000/tcp 2>/dev/null || true", { cwd: "/home/user", timeoutMs: 5000 })
          return NextResponse.json({ success: true, message: "Server stopped" })
        } catch (e: any) {
          return NextResponse.json({ success: true, message: "Stop attempted", details: e.message })
        }
      }

      case "restart": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")
        const stopResponse = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", sandboxId: bodySandboxId }) })
        await stopResponse.json()
        const startResponse = await fetch(req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", sandboxId: bodySandboxId }) })
        const startResult = await startResponse.json()
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
          } catch (e) { serverRunning = false }
          const url = `https://${sandbox.getHost(3000)}`
          return NextResponse.json({ success: true, connected: true, serverRunning, url })
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
