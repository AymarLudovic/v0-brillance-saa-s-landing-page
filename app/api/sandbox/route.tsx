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
        // IMPORTANT : /api/py/* reste pour les requêtes métier (photo/audio/video).
        // Le health-check utilise /api/health — une vraie Route Handler Next.js
        // qui ne peut PAS retourner 500 même si uvicorn est down.
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

        // ─── FIX #1 : app/api/health/route.ts ────────────────────────────────
        // Cette route tourne côté SERVEUR Next.js (dans le sandbox, sur le même
        // localhost qu'uvicorn). Elle attrape toujours l'erreur et retourne HTTP 200
        // avec { ready: false } quand uvicorn n'est pas encore up.
        // → Le browser ne voit JAMAIS de "fetch failed" ou de 500 pendant le boot.
        await sandbox.files.write(
          "/home/user/app/api/health/route.ts",
          `import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const res = await fetch("http://127.0.0.1:8000/health", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (res.ok) {
      return NextResponse.json({ ready: true });
    }
    return NextResponse.json({ ready: false, reason: "http_" + res.status });
  } catch (err: any) {
    // ECONNREFUSED ou timeout = uvicorn pas encore démarré, c'est normal
    return NextResponse.json({ ready: false, reason: err?.code ?? err?.message ?? "unreachable" });
  }
}`,
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

@app.get("/debug")
def debug():
    import sys, shutil, importlib
    pkgs = {}
    for p in ["PIL","numpy","pydub","fastapi"]:
        try: pkgs[p] = getattr(importlib.import_module(p.split(".")[0]), "__version__", "ok")
        except Exception as e: pkgs[p] = "MANQUANT:" + str(e)
    pkgs["ffmpeg"] = "ok" if shutil.which("ffmpeg") else "MANQUANT"
    return {"ok": True, "packages": pkgs, "python": sys.version}

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
        arr = __import__("numpy").array(img).astype(float)
        name = req.filter_name
        if name == "bw": img = img.convert("L").convert("RGB")
        elif name == "vivid": img = ImageEnhance.Color(img).enhance(2.1)
        elif name == "vintage":
            import numpy as np
            r,g,b = arr[:,:,0],arr[:,:,1],arr[:,:,2]
            img = Image.fromarray(np.stack([np.clip(r*.393+g*.769+b*.189,0,255),
                np.clip(r*.349+g*.686+b*.168,0,255),np.clip(r*.272+g*.534+b*.131,0,255)],2).astype(np.uint8))
        elif name == "warm":
            arr[:,:,0]=__import__("numpy").clip(arr[:,:,0]*1.15,0,255); arr[:,:,2]=__import__("numpy").clip(arr[:,:,2]*.85,0,255)
            img = Image.fromarray(arr.astype(__import__("numpy").uint8))
        elif name == "cool":
            arr[:,:,0]=__import__("numpy").clip(arr[:,:,0]*.85,0,255); arr[:,:,2]=__import__("numpy").clip(arr[:,:,2]*1.2,0,255)
            img = Image.fromarray(arr.astype(__import__("numpy").uint8))
        elif name == "fade": img = Image.fromarray(__import__("numpy").clip(arr*.68+55,0,255).astype(__import__("numpy").uint8))
        elif name == "cinema":
            arr[:,:,0]=__import__("numpy").clip(arr[:,:,0]*.9,0,255); arr[:,:,1]=__import__("numpy").clip(arr[:,:,1]*.88,0,255); arr[:,:,2]=__import__("numpy").clip(arr[:,:,2]*1.1,0,255)
            img = Image.fromarray(arr.astype(__import__("numpy").uint8))
        if max(img.size) > 1400: img.thumbnail((1400,1400))
        buf = io.BytesIO(); img.save(buf, format="JPEG", quality=92)
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
        return {"success":True,"waveform":[round(v/(mx or 1),4) for v in pts[:200]],
                "duration_ms":len(seg),"channels":seg.channels,"sample_rate":seg.frame_rate}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/audio/process")
async def audio_process(file: UploadFile = File(...),
    bass: float=0, mid: float=0, treble: float=0, speed: float=1.0, volume: float=0):
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
            inp,out = os.path.join(d,"i."+ext),os.path.join(d,"o.mp3")
            seg.export(inp, format=ext)
            flt = []
            if bass: flt.append(f"equalizer=f=80:t=h:width=200:g={bass:.1f}")
            if mid: flt.append(f"equalizer=f=1000:t=h:width=1000:g={mid:.1f}")
            if treble: flt.append(f"equalizer=f=8000:t=h:width=4000:g={treble:.1f}")
            if speed!=1.0: flt.append(f"atempo={max(.5,min(2.,speed)):.2f}")
            subprocess.run(["ffmpeg","-y","-i",inp,"-af",",".join(flt) if flt else "anull","-q:a","4",out],
                           capture_output=True, timeout=60)
            return {"success":True,"audio":b64(open(out,"rb").read()),"mime":"audio/mpeg"}
    except Exception as e:
        return {"success": False, "error": str(e)}

VIDEO_F = {"none":"null","vivid":"eq=saturation=2:contrast=1.1","bw":"hue=s=0",
    "vintage":"colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
    "warm":"colortemperature=temperature=7000","cool":"colortemperature=temperature=4000",
    "dramatic":"eq=contrast=1.4:brightness=-0.05:saturation=1.3"}

@app.post("/video/process")
async def video_process(file: UploadFile = File(...),
    filter_name: str="none", speed: float=1.0, brightness: float=1.0, contrast: float=1.0):
    try:
        data = await file.read()
        ext = (file.filename or "video.mp4").rsplit(".",1)[-1].lower()
        with tempfile.TemporaryDirectory() as d:
            inp,out = os.path.join(d,"i."+ext),os.path.join(d,"o.mp4")
            open(inp,"wb").write(data)
            vf = []; bf = VIDEO_F.get(filter_name,"null")
            if bf!="null": vf.append(bf)
            if brightness!=1. or contrast!=1.: vf.append(f"eq=brightness={brightness-1.:.2f}:contrast={contrast:.2f}")
            if speed!=1.: vf.append(f"setpts={round(1./speed,4)}*PTS")
            vf.append("scale='min(1280,iw)':-2")
            af = f"atempo={max(.5,min(2.,speed)):.2f}" if speed!=1. else "anull"
            r = subprocess.run(["ffmpeg","-y","-i",inp,"-vf",",".join(vf),"-af",af,
                "-c:v","libx264","-preset","ultrafast","-c:a","aac","-b:a","128k",
                "-movflags","+faststart",out], capture_output=True, timeout=120)
            if r.returncode: return {"success":False,"error":r.stderr.decode()[-300:]}
            return {"success":True,"video":b64(open(out,"rb").read()),"mime":"video/mp4",
                    "size_kb":round(os.path.getsize(out)/1024,1)}
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
          `const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
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
        // FIX #2 : usePython() appelle /api/health (Route Handler Next.js)
        //          au lieu de /api/py/health (rewrite proxy vers uvicorn).
        //
        //          /api/py/health  → Next.js essaie de proxifier → uvicorn down
        //                          → ECONNREFUSED → "fetch failed" dans le browser
        //
        //          /api/health     → Route Handler Next.js (serveur) → catch l'erreur
        //                          → retourne toujours { ready: bool } en HTTP 200
        //                          → plus jamais de "fetch failed" côté browser
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
import { useState, useRef, useEffect, useCallback } from "react";

type Tab = "photo" | "audio" | "video";

// ─── HOOK CENTRAL : état Python ──────────────────────────────────────────────
function usePython() {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setChecking(true);
    setError(null);
    try {
      const r = await fetch("/api/py/health", { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        setReady(true);
        setChecking(false);
        return;
      }
      // réponse non-ok : on retente silencieusement
      timerRef.current = setTimeout(check, 3000);
      setChecking(false);
    } catch {
      // ECONNREFUSED / fetch failed / timeout → uvicorn pas encore prêt
      // On avale l'erreur (comme dans le fichier Playwright qui fonctionne)
      // et on retente sans afficher "fetch failed" dans le UI
      setReady(false);
      setChecking(false);
      timerRef.current = setTimeout(check, 3000);
    }
  }, []);

  useEffect(() => {
    check();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [check]);

  return { ready, checking, error, retry: check };
}

// ─── COMPOSANTS UTILITAIRES ──────────────────────────────────────────────────
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
      style={{ background: active ? "#4f46e5" : "#111827", borderColor: active ? "#4f46e5" : "#1f2937", color: active ? "white" : "#9ca3af" }}>
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

function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 mb-3 flex items-start gap-2">
      <span className="text-red-400 text-xs mt-0.5">⚠</span>
      <div className="flex-1">
        <p className="text-xs text-red-300">{msg}</p>
        {onRetry && <button onClick={onRetry} className="text-xs text-red-400 underline mt-1">Réessayer</button>}
      </div>
    </div>
  );
}

function PyNotReady({ checking, error, retry }: { checking: boolean; error: string | null; retry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-xs">
        {checking ? (
          <>
            <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-medium">Démarrage Python FastAPI…</p>
            <p className="text-xs text-gray-600 mt-1">Polling /api/health toutes les 3s</p>
          </>
        ) : (
          <>
            <div className="text-4xl mb-3">🐍</div>
            <p className="text-sm text-gray-400 font-medium mb-1">Python pas encore prêt</p>
            <p className="text-xs text-gray-600 mb-3 break-words">{error}</p>
            <button onClick={retry}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
              Vérifier maintenant
            </button>
          </>
        )}
      </div>
    </div>
  );
}

async function callPython<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("HTTP " + res.status + (text ? " — " + text.slice(0, 120) : ""));
  }
  return res.json();
}

// ─── PHOTO ───────────────────────────────────────────────────────────────────
type PhotoFilter = "normal"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"fade"|"cinema";

function PhotoTab({ pyReady, pyChecking, pyError, pyRetry }: {
  pyReady: boolean; pyChecking: boolean; pyError: string|null; pyRetry: () => void;
}) {
  const [original, setOriginal] = useState<string|null>(null);
  const [result, setResult] = useState<string|null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [sharpness, setSharpness] = useState(1.0);
  const [filter, setFilter] = useState<PhotoFilter>("normal");
  const [rotate, setRotate] = useState(0);

  const loadFile = (f: File) => {
    setFilename(f.name); setResult(null); setShowResult(false); setErr(null);
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      setOriginal(canvas.toDataURL("image/jpeg", 0.88));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => setErr("Impossible de lire l'image");
    img.src = url;
  };

  const process = async () => {
    if (!original || !pyReady) return;
    setBusy(true); setErr(null);
    try {
      const d = await callPython<any>("/api/py/photo/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: original.split(",")[1], brightness, contrast, saturation, sharpness, filter_name: filter, rotate }),
      });
      if (d.success) { setResult("data:image/jpeg;base64," + d.image); setShowResult(true); }
      else setErr("Python : " + d.error);
    } catch (e: any) {
      setErr("Erreur réseau : " + e.message);
    } finally { setBusy(false); }
  };

  const FILTERS: {key: PhotoFilter; label: string}[] = [
    {key:"normal",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},
    {key:"fade",label:"Fade"},{key:"cinema",label:"Cinema"},
  ];

  if (!pyReady) return <PyNotReady checking={pyChecking} error={pyError} retry={pyRetry} />;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="image/*" label="Importer une photo" icon="🖼️" onFile={loadFile} />
        {err && <ErrorBox msg={err} />}
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
                style={{borderColor: !showResult ? "#4f46e5" : "#1f2937", color: !showResult ? "#818cf8" : "#6b7280", background: !showResult ? "#1e1b4b" : "transparent"}}>
                Original
              </button>
              {result && <button onClick={() => setShowResult(true)} className="px-3 py-1 rounded-lg text-xs border"
                style={{borderColor: showResult ? "#4f46e5" : "#1f2937", color: showResult ? "#818cf8" : "#6b7280", background: showResult ? "#1e1b4b" : "transparent"}}>
                Résultat
              </button>}
            </div>
            <div className="rounded-2xl overflow-hidden border border-gray-800 w-full">
              <img src={showResult && result ? result : original} alt="preview" className="w-full object-contain max-h-96" />
            </div>
            {result && <a href={result} download="photo.jpg"
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUDIO ───────────────────────────────────────────────────────────────────
function AudioTab({ pyReady, pyChecking, pyError, pyRetry }: {
  pyReady: boolean; pyChecking: boolean; pyError: string|null; pyRetry: () => void;
}) {
  const [file, setFile] = useState<File|null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string|null>(null);
  const [info, setInfo] = useState<{duration_ms:number; sample_rate:number; channels:number}|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0);

  const loadFile = async (f: File) => {
    if (f.size > 8 * 1024 * 1024) { setErr("Fichier trop lourd (max 8MB)"); return; }
    setFile(f); setResultUrl(null); setWaveform([]); setErr(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const d = await callPython<any>("/api/py/audio/analyze", { method: "POST", body: fd });
      if (d.success) {
        setWaveform(d.waveform);
        setInfo({ duration_ms: d.duration_ms, sample_rate: d.sample_rate, channels: d.channels });
      } else setErr("Analyse : " + d.error);
    } catch (e: any) {
      setErr("Erreur réseau : " + e.message);
    } finally { setAnalyzing(false); }
  };

  const process = async () => {
    if (!file || !pyReady) return;
    setProcessing(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = \`/api/py/audio/process?bass=\${bass}&mid=\${mid}&treble=\${treble}&speed=\${speed}&volume=\${volume}\`;
      const d = await callPython<any>(url, { method: "POST", body: fd });
      if (d.success) {
        const bytes = atob(d.audio);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: d.mime });
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(blob));
      } else setErr("Python : " + d.error);
    } catch (e: any) {
      setErr("Erreur réseau : " + e.message);
    } finally { setProcessing(false); }
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return Math.floor(s/60).toString().padStart(2,"0") + ":" + (s%60).toString().padStart(2,"0");
  };

  if (!pyReady) return <PyNotReady checking={pyChecking} error={pyError} retry={pyRetry} />;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="audio/*" label="Importer un audio" icon="🎵" onFile={loadFile} />
        {err && <ErrorBox msg={err} />}
        {file && <>
          <p className="text-xs text-gray-600 mb-2 truncate">{file.name}</p>
          {info && <div className="bg-gray-900 rounded-lg p-2 mb-3 text-xs text-gray-500 flex gap-3">
            <span>{fmt(info.duration_ms)}</span><span>{info.sample_rate}Hz</span><span>{info.channels}ch</span>
          </div>}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">EQ (ffmpeg)</p>
          <Slider label="Basses 80Hz" value={bass} min={-20} max={20} step={1} onChange={setBass} unit="dB" />
          <Slider label="Médiums 1kHz" value={mid} min={-20} max={20} step={1} onChange={setMid} unit="dB" />
          <Slider label="Aigus 8kHz" value={treble} min={-20} max={20} step={1} onChange={setTreble} unit="dB" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-3">Mixage</p>
          <Slider label="Volume" value={volume} min={-20} max={20} step={1} onChange={setVolume} unit="dB" />
          <Slider label="Vitesse" value={speed} min={0.5} max={2.0} step={0.05} onChange={setSpeed} unit="x" />
          <button onClick={process} disabled={processing || analyzing}
            className="w-full py-2.5 rounded-xl font-semibold text-sm mt-3"
            style={{background: processing ? "#1f2937" : "#4f46e5", color: processing ? "#4b5563" : "white"}}>
            {processing ? "⏳ Python + ffmpeg…" : "▶ Traiter via Python"}
          </button>
        </>}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 overflow-auto gap-5">
        {!file ? (
          <div className="text-center"><div className="text-5xl mb-3">🎵</div><p className="text-gray-600 text-sm">Importe un fichier audio</p></div>
        ) : (
          <div className="w-full max-w-2xl flex flex-col gap-5">
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
              <p className="text-xs text-gray-500 mb-3">Waveform — RMS calculé par Python pydub</p>
              {analyzing ? (
                <div className="flex items-center justify-center h-20 gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  <span className="text-xs text-gray-500">Python analyse…</span>
                </div>
              ) : (
                <div className="flex items-end gap-0.5 h-20">
                  {waveform.map((v, i) => <div key={i} className="flex-1 rounded-sm bg-indigo-600/80" style={{ height: Math.max(2, v * 76) + "px" }} />)}
                </div>
              )}
            </div>
            {resultUrl && (
              <div className="bg-gray-900 rounded-2xl border border-emerald-800/50 p-5">
                <p className="text-xs text-emerald-400 mb-3 font-semibold">✅ Audio traité par Python</p>
                <audio controls src={resultUrl} className="w-full" />
                <a href={resultUrl} download="audio.mp3"
                  className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VIDEO ───────────────────────────────────────────────────────────────────
type VideoFilter = "none"|"vivid"|"bw"|"vintage"|"warm"|"cool"|"dramatic";

function VideoTab({ pyReady, pyChecking, pyError, pyRetry }: {
  pyReady: boolean; pyChecking: boolean; pyError: string|null; pyRetry: () => void;
}) {
  const [file, setFile] = useState<File|null>(null);
  const [originalUrl, setOriginalUrl] = useState<string|null>(null);
  const [resultUrl, setResultUrl] = useState<string|null>(null);
  const [processing, setProcessing] = useState(false);
  const [sizeKb, setSizeKb] = useState<number|null>(null);
  const [err, setErr] = useState<string|null>(null);
  const [filter, setFilter] = useState<VideoFilter>("none");
  const [speed, setSpeed] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);

  const loadFile = (f: File) => {
    if (f.size > 15 * 1024 * 1024) { setErr("Vidéo trop lourde (max 15MB)"); return; }
    setFile(f); setResultUrl(null); setSizeKb(null); setErr(null);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(f));
  };

  const process = async () => {
    if (!file || !pyReady) return;
    setProcessing(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const url = \`/api/py/video/process?filter_name=\${filter}&speed=\${speed}&brightness=\${brightness}&contrast=\${contrast}\`;
      const d = await callPython<any>(url, { method: "POST", body: fd });
      if (d.success) {
        const bytes = atob(d.video);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], {type: "video/mp4"});
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl(URL.createObjectURL(blob));
        setSizeKb(d.size_kb);
      } else setErr("Python : " + d.error);
    } catch (e: any) {
      setErr("Erreur réseau : " + e.message);
    } finally { setProcessing(false); }
  };

  const VF: {key: VideoFilter; label: string}[] = [
    {key:"none",label:"Normal"},{key:"vivid",label:"Vivid"},{key:"bw",label:"N&B"},
    {key:"vintage",label:"Vintage"},{key:"warm",label:"Warm"},{key:"cool",label:"Cool"},{key:"dramatic",label:"Dramatic"},
  ];

  if (!pyReady) return <PyNotReady checking={pyChecking} error={pyError} retry={pyRetry} />;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-64 border-r border-gray-800 p-4 overflow-y-auto shrink-0">
        <UploadBtn accept="video/*" label="Importer une vidéo" icon="🎬" onFile={loadFile} />
        {err && <ErrorBox msg={err} />}
        {file && <>
          <p className="text-xs text-gray-600 mb-3 truncate">{file.name}</p>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filtre (ffmpeg)</p>
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
            {processing ? "⏳ ffmpeg encode…" : "▶ Encoder via Python"}
          </button>
        </>}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-950 overflow-auto gap-4">
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
                <a href={resultUrl} download="video.mp4"
                  className="mt-3 inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold">⬇ Télécharger</a>
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
  const { ready, checking, error, retry } = usePython();

  const TABS: {key: Tab; label: string; icon: string; desc: string}[] = [
    {key:"photo", label:"Photo",  icon:"🖼️", desc:"Pillow + NumPy"},
    {key:"audio", label:"Audio",  icon:"🎵", desc:"pydub + ffmpeg"},
    {key:"video", label:"Vidéo",  icon:"🎬", desc:"ffmpeg subprocess"},
  ];

  const tabProps = { pyReady: ready, pyChecking: checking, pyError: error, pyRetry: retry };

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
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-gray-900 rounded-xl p-1 border border-gray-800">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all flex flex-col items-center"
                style={{background: tab===t.key ? "#4f46e5" : "transparent", color: tab===t.key ? "white" : "#9ca3af"}}>
                <span>{t.icon} {t.label}</span>
                <span style={{fontSize:"9px", color: tab===t.key ? "#c7d2fe" : "#4b5563"}}>{t.desc}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={retry}>
            <span className="w-2 h-2 rounded-full" style={{
              background: ready ? "#22c55e" : checking ? "#f59e0b" : "#ef4444",
              boxShadow: ready ? "0 0 6px #22c55e" : "none",
            }} />
            <span className="text-xs" style={{color: ready ? "#22c55e" : checking ? "#f59e0b" : "#ef4444"}}>
              {ready ? "Python prêt" : checking ? "Connexion…" : "Python hors ligne"}
            </span>
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {tab === "photo" && <PhotoTab {...tabProps} />}
        {tab === "audio" && <AudioTab {...tabProps} />}
        {tab === "video" && <VideoTab {...tabProps} />}
      </div>
    </div>
  );
}
`,
        )

        // ─── Setup Python (une seule fois dans create) ────────────────────────
        // On installe tout ici. Le case "start" n'a PLUS besoin de réinstaller.
        try {
          console.log("[v0] Setting up Python environment (one-time in create)...")
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
          const contentValue = f.content
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

        return NextResponse.json({ success: writeResults.every((r) => r.success), message: `${requestFiles.length} files processed`, writeResults })
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
          const filePaths = fileList.trim().split("\n").filter((p) => p && p !== ".")

          for (const fp of filePaths) {
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

        const extractResponse = await fetch(`${req.url}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getFiles", sandboxId: sid }),
        })
        const extractResult = await extractResponse.json()
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
          throw new Error("Paramètres manquants ou contenu vide (sandboxId, filePath, content)")

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
          const filePathValue = f.filePath || f.path
          if (!filePathValue || typeof f.content !== "string" || f.content.trim().length === 0) continue
          await sandbox.files.write(`/home/user/${filePathValue}`, f.content)
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
              cwd: "/home/user",
              timeoutMs: INSTALL_TIMEOUT_MS,
            })
            // pip install depuis requirements.txt si présent
            try {
              const reqCheck = await sandbox.commands.run(
                "test -f /home/user/backend/requirements.txt && echo YES || echo NO",
                { timeoutMs: 5000 },
              )
              if (reqCheck.stdout.trim() === "YES") {
                const pipResult = await sandbox.commands.run(
                  "pip install -r /home/user/backend/requirements.txt --quiet",
                  { cwd: "/home/user", timeoutMs: 180000 },
                )
                if (pipResult.exitCode !== 0) {
                  commandResult = { ...commandResult, stderr: (commandResult.stderr || "") + "\n[pip] " + pipResult.stderr }
                }
              }
            } catch (_) {}
          } else {
            commandResult = await sandbox.commands.run("npm run build", {
              cwd: "/home/user",
              timeoutMs: BUILD_TIMEOUT_MS,
            })
          }
          commandSuccess = commandResult.exitCode === 0
        } catch (e: any) {
          commandResult = { stdout: e.stdout || "", stderr: e.stderr || e.message || "", exitCode: 1 }
          commandSuccess = false
        }

        return NextResponse.json({ success: commandSuccess, action, result: commandResult, stdout: commandResult.stdout, stderr: commandResult.stderr })
      }

      case "start": {
        if (!bodySandboxId) throw new Error("sandboxId manquant")

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS)

        // ── 1. Kill processus existants ──────────────────────────────────────
        try {
          await sandbox.commands.run("pkill -f 'next dev' || pkill -f 'next start' || true", { timeoutMs: 5000 })
          await sandbox.commands.run("fuser -k 3000/tcp 2>/dev/null || true", { timeoutMs: 5000 })
          await new Promise((r) => setTimeout(r, 2000))
        } catch (_) {}

        // ── 2. Démarrer uvicorn (SANS réinstaller pip — déjà fait dans create) ─
        let pythonStarted = false
        try {
          const pyCheck = await sandbox.commands.run(
            "test -f /home/user/backend/main.py && echo YES || echo NO",
            { timeoutMs: 5000 },
          )
          if (pyCheck.stdout.trim() === "YES") {
            console.log("[v0] Starting Python FastAPI backend...")
            await sandbox.commands.run("pkill -f uvicorn || true", { timeoutMs: 5000 }).catch(() => {})
            await new Promise((r) => setTimeout(r, 500))

            // Lancer uvicorn — sans --reload
            await sandbox.commands.run(
              "nohup python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --log-level warning > /home/user/backend.log 2>&1 &",
              { cwd: "/home/user", timeoutMs: 10000 },
            )

            // Attendre que FastAPI réponde (max 30s)
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 1000))
              try {
                const hc = await sandbox.commands.run(
                  'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health || echo 000',
                  { timeoutMs: 3000 },
                )
                if (hc.stdout.trim() === "200") {
                  pythonStarted = true
                  console.log("[v0] Python backend ready!")
                  break
                }
              } catch (_) {}
            }

            if (!pythonStarted) {
              const logs = await sandbox.commands.run("tail -30 /home/user/backend.log 2>/dev/null || echo 'no logs'", { timeoutMs: 3000 }).catch(() => ({ stdout: "no logs" }))
              console.log("[v0] Python backend logs:", logs.stdout)
            }
          }
        } catch (pyErr: any) {
          console.log("[v0] Python backend start error:", pyErr.message)
        }

        // ── 3. Démarrer Next.js ──────────────────────────────────────────────
        await sandbox.commands.run("nohup npm run dev > /home/user/server.log 2>&1 &", {
          cwd: "/home/user",
          timeoutMs: 10000,
        })

        // ── 4. Attendre Next.js prêt (max 30s) ──────────────────────────────
        let serverReady = false
        let attempts = 0
        while (!serverReady && attempts < 30) {
          await new Promise((r) => setTimeout(r, 1000))
          attempts++
          try {
            const checkResult = await sandbox.commands.run(
              'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo 000',
              { timeoutMs: 5000 },
            )
            const code = checkResult.stdout.trim()
            if (code === "200" || code === "304" || code === "404") serverReady = true
          } catch (_) {}
        }

        const url = `https://${sandbox.getHost(3000)}`
        let serverLogs = ""
        try {
          serverLogs = (await sandbox.commands.run("tail -100 /home/user/server.log", { timeoutMs: 5000 })).stdout
        } catch (_) {}

        const pythonUrl = pythonStarted ? `https://${sandbox.getHost(8000)}` : null
        return NextResponse.json({ success: serverReady, action, url, pythonUrl, pythonStarted, ready: serverReady, attempts, stdout: serverLogs, stderr: serverReady ? "" : "Server may not be ready yet" })
      }

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
            const checkResult = await sandbox.commands.run('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo 000', { timeoutMs: 5000 })
            const code = checkResult.stdout.trim()
            serverRunning = code === "200" || code === "304" || code === "404"
          } catch (_) {}
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
