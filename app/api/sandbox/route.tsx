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
import subprocess
import numpy as np
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageEnhance, ImageOps
from pydub import AudioSegment

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Stockage ────────────────────────────────────────────────────────────────
photo_sessions: dict[str, Image.Image] = {}   # RAM  (photo PIL)
MEDIA_DIR = Path("/tmp/media_sessions")        # Disk (video/audio)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

MAX_SESSIONS = 20

def cleanup_photo():
    if len(photo_sessions) > MAX_SESSIONS:
        del photo_sessions[list(photo_sessions.keys())[0]]

def img_to_b64(img: Image.Image, quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

# ─── Traitement photo ─────────────────────────────────────────────────────────
def apply_photo(original: Image.Image, p: dict) -> Image.Image:
    img = original.copy()
    img.thumbnail((1400, 1400), Image.LANCZOS)

    if p.get("rotation"):
        img = img.rotate(-p["rotation"], expand=True)
    if p.get("flip_h"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if p.get("flip_v"):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

    arr = np.array(img, dtype=np.float32)

    exp = p.get("exposure", 0)
    if exp: arr *= (2.0 ** exp)

    hl, sh = p.get("highlights", 0), p.get("shadows", 0)
    if hl or sh:
        norm = np.clip(arr / 255.0, 0, 1)
        if hl: arr += (hl / 100.0) * (norm ** 2) * 90
        if sh: arr += (sh / 100.0) * ((1 - norm) ** 2) * 90

    temp = p.get("temperature", 0)
    if temp:
        f = temp / 100.0
        arr[:, :, 0] = np.clip(arr[:, :, 0] + f * 28, 0, 255)
        arr[:, :, 2] = np.clip(arr[:, :, 2] - f * 28, 0, 255)

    arr = np.clip(arr, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)

    for attr, key in [(ImageEnhance.Brightness, "brightness"), (ImageEnhance.Contrast, "contrast"),
                      (ImageEnhance.Color, "saturation"), (ImageEnhance.Sharpness, "sharpness")]:
        v = p.get(key, 1.0)
        if v != 1.0: img = attr(img).enhance(v)

    f = p.get("filter", "none")
    if f == "bw":
        img = ImageOps.grayscale(img).convert("RGB")
    elif f == "sepia":
        g = np.array(ImageOps.grayscale(img), dtype=np.float32)
        img = Image.fromarray(np.stack([np.clip(g*1.08,0,255), np.clip(g*0.85,0,255), np.clip(g*0.66,0,255)], 2).astype(np.uint8))
    elif f == "cinematic":
        a = np.array(img, dtype=np.float32)
        a[:,:,0] = np.clip(a[:,:,0]*1.06+8, 0, 255)
        a[:,:,2] = np.clip(a[:,:,2]*0.88, 0, 255)
        img = ImageEnhance.Contrast(Image.fromarray(a.astype(np.uint8))).enhance(1.18)
    elif f == "fade":
        a = np.array(img, dtype=np.float32)
        img = Image.fromarray(np.clip(a*0.86+30, 0, 255).astype(np.uint8))
    elif f == "vignette":
        a = np.array(img, dtype=np.float32)
        h, w = a.shape[:2]
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt(((X-w/2)/(w/2))**2 + ((Y-h/2)/(h/2))**2)
        a *= np.clip(1.0 - 0.72*dist**1.6, 0, 1)[:,:,np.newaxis]
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    elif f == "chrome":
        a = np.array(img, dtype=np.float32)
        a[:,:,0] = np.clip(a[:,:,0]*1.1, 0, 255)
        a[:,:,2] = np.clip(a[:,:,2]*0.85, 0, 255)
        img = ImageEnhance.Color(ImageEnhance.Contrast(Image.fromarray(a.astype(np.uint8))).enhance(1.3)).enhance(1.2)
    return img

# ─── PHOTO ENDPOINTS ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/upload")
async def upload_photo(file: UploadFile = File(...)):
    original = Image.open(io.BytesIO(await file.read())).convert("RGB")
    sid = str(uuid.uuid4())
    cleanup_photo()
    photo_sessions[sid] = original
    preview = original.copy()
    preview.thumbnail((1400, 1400), Image.LANCZOS)
    return {"session_id": sid, "image": img_to_b64(preview, 90),
            "width": original.width, "height": original.height}

@app.websocket("/ws/edit")
async def ws_edit(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            sid = data.get("session_id")
            if not sid or sid not in photo_sessions:
                await ws.send_json({"error": "Session introuvable"}); continue
            try:
                result = apply_photo(photo_sessions[sid], data.get("params", {}))
                await ws.send_json({"image": img_to_b64(result, 88)})
            except Exception as e:
                await ws.send_json({"error": str(e)})
    except WebSocketDisconnect:
        pass

# ─── VIDEO ENDPOINTS ──────────────────────────────────────────────────────────

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    sid = str(uuid.uuid4())
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    vpath = MEDIA_DIR / f"{sid}_original{suffix}"
    vpath.write_bytes(await file.read())

    duration = 0.0
    try:
        r = subprocess.run(
            ["ffprobe","-v","error","-show_entries","format=duration",
             "-of","default=noprint_wrappers=1:nokey=1", str(vpath)],
            capture_output=True, text=True, timeout=10)
        duration = float(r.stdout.strip() or 0)
    except Exception: pass

    thumb_path = MEDIA_DIR / f"{sid}_thumb.jpg"
    try:
        subprocess.run(["ffmpeg","-y","-ss","00:00:01","-i",str(vpath),
                        "-vframes","1","-q:v","3",str(thumb_path)],
                       capture_output=True, timeout=15)
    except Exception: pass

    thumbnail = base64.b64encode(thumb_path.read_bytes()).decode() if thumb_path.exists() else ""
    return {"session_id": sid, "duration": round(duration, 2),
            "thumbnail": thumbnail, "filename": file.filename}

@app.post("/process-video")
async def process_video(data: dict):
    sid = data.get("session_id")
    p = data.get("params", {})
    originals = list(MEDIA_DIR.glob(f"{sid}_original*"))
    if not originals:
        return JSONResponse({"error": "Session introuvable"}, status_code=404)

    input_path = originals[0]
    output_path = MEDIA_DIR / f"{sid}_output.mp4"

    start = float(p.get("start_time", 0))
    end   = p.get("end_time")
    speed = float(p.get("speed", 1.0))
    vol   = float(p.get("volume", 1.0))
    rot   = int(p.get("rotation", 0))
    bri   = float(p.get("brightness", 0))
    mute  = bool(p.get("mute", False))
    gray  = bool(p.get("grayscale", False))

    vf, af = [], []
    if rot == 90:  vf.append("transpose=1")
    elif rot == 180: vf.append("transpose=1,transpose=1")
    elif rot == 270: vf.append("transpose=2")
    if gray: vf.append("hue=s=0")
    if bri:  vf.append(f"eq=brightness={bri*0.1:.3f}")
    if speed != 1.0:
        vf.append(f"setpts={1.0/speed:.4f}*PTS")
        s = speed
        while s > 2.0: af.append("atempo=2.0"); s /= 2.0
        while s < 0.5: af.append("atempo=0.5"); s *= 2.0
        af.append(f"atempo={s:.4f}")
    if vol != 1.0 and not mute:
        af.append(f"volume={vol:.2f}")

    cmd = ["ffmpeg", "-y"]
    if start > 0: cmd += ["-ss", str(start)]
    cmd += ["-i", str(input_path)]
    if end is not None: cmd += ["-t", str(float(end) - start)]
    if vf: cmd += ["-vf", ",".join(vf)]
    if mute: cmd += ["-an"]
    elif af: cmd += ["-af", ",".join(af)]
    cmd += ["-c:v","libx264","-preset","ultrafast","-crf","30",
            "-movflags","+faststart", str(output_path)]

    try:
        r = subprocess.run(cmd, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "Traitement trop long (>3 min)"}, status_code=408)

    if r.returncode != 0 or not output_path.exists():
        return JSONResponse({"error": r.stderr.decode()[-400:]}, status_code=500)

    size = output_path.stat().st_size
    if size > 80 * 1024 * 1024:
        return JSONResponse({"error": "Fichier trop lourd pour le transfert (>80 MB)"}, status_code=413)

    return {"video": base64.b64encode(output_path.read_bytes()).decode(), "size": size}

# ─── AUDIO ENDPOINTS ──────────────────────────────────────────────────────────

@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    sid = str(uuid.uuid4())
    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    apath = MEDIA_DIR / f"{sid}_original{suffix}"
    apath.write_bytes(await file.read())
    try:
        audio = AudioSegment.from_file(str(apath))
        return {"session_id": sid, "duration": round(len(audio)/1000.0, 2),
                "channels": audio.channels, "sample_rate": audio.frame_rate,
                "filename": file.filename}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/process-audio")
async def process_audio(data: dict):
    sid = data.get("session_id")
    p = data.get("params", {})
    originals = list(MEDIA_DIR.glob(f"{sid}_original*"))
    if not originals:
        return JSONResponse({"error": "Session introuvable"}, status_code=404)
    try:
        audio = AudioSegment.from_file(str(originals[0]))
        dur_ms = len(audio)
        start_ms = int(float(p.get("start_time", 0)) * 1000)
        end_ms   = min(int(float(p.get("end_time", dur_ms/1000)) * 1000), dur_ms)
        audio = audio[start_ms:end_ms]

        vdb = float(p.get("volume_db", 0))
        if vdb: audio = audio + vdb

        fi = int(float(p.get("fade_in",  0)) * 1000)
        fo = int(float(p.get("fade_out", 0)) * 1000)
        if fi and fi < len(audio): audio = audio.fade_in(fi)
        if fo and fo < len(audio): audio = audio.fade_out(fo)
        if p.get("reverse"): audio = audio.reverse()

        speed = float(p.get("speed", 1.0))
        if speed != 1.0:
            tmp_in  = MEDIA_DIR / f"{sid}_spd_in.wav"
            tmp_out = MEDIA_DIR / f"{sid}_spd_out.wav"
            audio.export(str(tmp_in), format="wav")
            af = []
            s = speed
            while s > 2.0: af.append("atempo=2.0"); s /= 2.0
            while s < 0.5: af.append("atempo=0.5"); s *= 2.0
            af.append(f"atempo={s:.4f}")
            subprocess.run(["ffmpeg","-y","-i",str(tmp_in),"-af",",".join(af),str(tmp_out)],
                           capture_output=True, timeout=60)
            if tmp_out.exists():
                audio = AudioSegment.from_file(str(tmp_out))

        buf = io.BytesIO()
        audio.export(buf, format="mp3", bitrate="192k")
        return {"audio": base64.b64encode(buf.getvalue()).decode(),
                "duration": round(len(audio)/1000.0, 2)}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
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

        // not-found.tsx — required by Next.js 15 for production builds
        // Without this, `npm run build` throws: [PageNotFoundError] Cannot find module for page: /_not-found
        await sandbox.files.write(
  "/home/user/app/not-found.tsx",
  `export default function NotFound() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "4rem", fontWeight: 300, margin: 0, color: "#111" }}>404</h1>
        <p style={{ color: "#888", marginTop: "0.5rem" }}>Page not found</p>
      </div>
    </div>
  );
}`
);

  await sandbox.files.write(
  "/home/user/app/globals.css",
  `@tailwind base;
@tailwind components;
@tailwind utilities;

body { font-family: Arial, Helvetica, sans-serif; }

input[type='range'] {
  -webkit-appearance: none; appearance: none;
  height: 6px; border-radius: 9999px; outline: none; cursor: pointer; width: 100%;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: #6366f1; cursor: pointer;
  border: 2px solid #18181b; transition: transform 0.1s;
}
input[type='range']::-webkit-slider-thumb:hover { transform: scale(1.25); }
input[type='range']::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: #6366f1; cursor: pointer; border: 2px solid #18181b;
}
input[type='range']:disabled { opacity: 0.3; cursor: not-allowed; }`
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

        // page.tsx — Éditeur média (Photo · Vidéo · Audio) — Next.js + FastAPI
        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
import { useState, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type FilterType = "none"|"bw"|"sepia"|"cinematic"|"fade"|"vignette"|"chrome";
type Tab    = "photo"|"video"|"audio";
type Status = "idle"|"uploading"|"ready"|"processing"|"error";

interface PhotoParams {
  exposure:number; brightness:number; contrast:number;
  highlights:number; shadows:number; saturation:number;
  temperature:number; sharpness:number;
  rotation:number; flip_h:boolean; flip_v:boolean; filter:FilterType;
}
interface VideoParams {
  start_time:number; end_time:number|null; speed:number; volume:number;
  rotation:number; grayscale:boolean; brightness:number; mute:boolean;
}
interface AudioParams {
  start_time:number; end_time:number|null;
  volume_db:number; speed:number; fade_in:number; fade_out:number; reverse:boolean;
}

// ─── Constantes Photo ─────────────────────────────────────────────────────────
const PH_DEF: PhotoParams = {
  exposure:0,brightness:1,contrast:1,highlights:0,shadows:0,
  saturation:1,temperature:0,sharpness:1,rotation:0,flip_h:false,flip_v:false,filter:"none",
};
const PH_SLIDERS = [
  {key:"exposure",   label:"Exposition",      min:-2,  max:2,   step:0.05, zero:0},
  {key:"brightness", label:"Luminosité",      min:0,   max:3,   step:0.05, zero:1},
  {key:"contrast",   label:"Contraste",       min:0,   max:3,   step:0.05, zero:1},
  {key:"highlights", label:"Hautes lumières", min:-100,max:100, step:1,    zero:0},
  {key:"shadows",    label:"Ombres",          min:-100,max:100, step:1,    zero:0},
  {key:"saturation", label:"Saturation",      min:0,   max:3,   step:0.05, zero:1},
  {key:"temperature",label:"Température",     min:-100,max:100, step:1,    zero:0},
  {key:"sharpness",  label:"Netteté",         min:0,   max:3,   step:0.05, zero:1},
] as const;
const PH_FILTERS = [
  {id:"none"      as FilterType,emoji:"○",label:"Original"},
  {id:"bw"        as FilterType,emoji:"◐",label:"N&B"},
  {id:"sepia"     as FilterType,emoji:"◕",label:"Sépia"},
  {id:"cinematic" as FilterType,emoji:"◆",label:"Cinéma"},
  {id:"fade"      as FilterType,emoji:"◇",label:"Fade"},
  {id:"vignette"  as FilterType,emoji:"●",label:"Vignette"},
  {id:"chrome"    as FilterType,emoji:"◈",label:"Chrome"},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(s:number){ const m=Math.floor(s/60); return \`\${m}:\${String(Math.floor(s%60)).padStart(2,"0")}\`; }

function b64Blob(b64:string,mime:string):string {
  const bytes=atob(b64), arr=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr],{type:mime}));
}

const S_COLOR:Record<Status,string>={idle:"#6b7280",uploading:"#f59e0b",ready:"#22c55e",processing:"#6366f1",error:"#ef4444"};
const S_LABEL:Record<Status,string>={idle:"En attente",uploading:"Upload…",ready:"Prêt",processing:"Traitement…",error:"Erreur"};

// ─── Composants réutilisables ─────────────────────────────────────────────────
function Slider({label,min,max,step,value,zero,disabled,onChange}:{
  label:string;min:number;max:number;step:number;value:number;zero:number;disabled:boolean;onChange:(v:number)=>void;
}){
  const mod = value!==zero;
  const pct = ((value-min)/(max-min))*100;
  const disp = zero===1
    ? (v=>v>0?\`+\${v}\`:\`\${v}\`)(Math.round((value-1)*100))
    : (v=>v>0?\`+\${v}\`:\`\${v}\`)(step<1?value.toFixed(2):Math.round(value));
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className={\`text-xs \${mod?"text-zinc-200":"text-zinc-500"}\`}>{label}</span>
        <span className={\`text-xs font-mono \${mod?"text-indigo-400":"text-zinc-600"}\`}>{disp}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{background:\`linear-gradient(to right,\${mod?"#6366f1":"#52525b"} \${pct}%,#27272a \${pct}%)\`}} />
    </div>
  );
}

function Toggle({label,checked,disabled,onChange}:{label:string;checked:boolean;disabled:boolean;onChange:()=>void}){
  return (
    <label className={\`flex items-center justify-between cursor-pointer \${disabled?"opacity-30":""}\`}>
      <span className="text-xs text-zinc-400">{label}</span>
      <div onClick={()=>!disabled&&onChange()}
        className={\`w-9 h-5 rounded-full relative transition-all \${checked?"bg-indigo-600":"bg-zinc-700"}\`}>
        <div className={\`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all \${checked?"left-4":"left-0.5"}\`}/>
      </div>
    </label>
  );
}

function DropZone({icon,title,accept,dragging,setDragging,onFile,onClick}:{
  icon:string;title:string;accept:string;dragging:boolean;
  setDragging:(v:boolean)=>void;onFile:(f:File)=>void;onClick:()=>void;
}){
  return (
    <div onClick={onClick}
      onDragOver={e=>{e.preventDefault();setDragging(true);}}
      onDragLeave={()=>setDragging(false)}
      onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)onFile(f);}}
      className={\`cursor-pointer flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-2xl p-16 mx-8 transition-all \${dragging?"border-indigo-400 bg-indigo-950/20":"border-zinc-700 hover:border-zinc-500"}\`}>
      <span className="text-6xl">{icon}</span>
      <div className="text-center">
        <p className="text-zinc-200 font-medium">{title}</p>
        <p className="text-zinc-500 text-sm mt-1">{accept}</p>
      </div>
    </div>
  );
}

// ─── Onglet Photo (WebSocket temps-réel) ──────────────────────────────────────
function PhotoTab(){
  const [image,setImage]=useState<string|null>(null);
  const [params,setParams]=useState<PhotoParams>({...PH_DEF});
  const [status,setStatus]=useState<Status>("idle");
  const [dragging,setDragging]=useState(false);
  const [err,setErr]=useState("");
  const [meta,setMeta]=useState("");
  const sid=useRef<string|null>(null);
  const ws=useRef<WebSocket|null>(null);
  const pending=useRef<PhotoParams|null>(null);
  const busy=useRef(false);
  const fileRef=useRef<HTMLInputElement>(null);

  const send=useCallback((p:PhotoParams)=>{
    if(!ws.current||ws.current.readyState!==WebSocket.OPEN||!sid.current)return;
    if(busy.current){pending.current=p;return;}
    busy.current=true;
    ws.current.send(JSON.stringify({session_id:sid.current,params:p}));
  },[]);

  const connect=useCallback((id:string,init:PhotoParams)=>{
    ws.current?.close();
    const proto=window.location.protocol==="https:"?"wss:":"ws:";
    const sock=new WebSocket(\`\${proto}//\${window.location.host}/api/py/ws/edit\`);
    ws.current=sock;
    sock.onopen=()=>{busy.current=false;sock.send(JSON.stringify({session_id:id,params:init}));};
    sock.onmessage=e=>{
      const d=JSON.parse(e.data);
      if(d.image){setImage(\`data:image/jpeg;base64,\${d.image}\`);setStatus("ready");}
      else if(d.error){setErr(d.error);setStatus("error");}
      busy.current=false;
      if(pending.current){const n=pending.current;pending.current=null;send(n);}
    };
    sock.onerror=()=>{setStatus("error");setErrMsg("WebSocket error");};
  },[send]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setErrMsg=setErr;

  const upload=useCallback(async(file:File)=>{
    if(!file.type.startsWith("image/"))return;
    setStatus("uploading");setErr("");setParams({...PH_DEF});sid.current=null;
    const fd=new FormData();fd.append("file",file);
    try{
      const res=await fetch("/api/py/upload",{method:"POST",body:fd});
      const d=await res.json();
      if(!res.ok||!d.session_id)throw new Error(d.detail||"Upload échoué");
      sid.current=d.session_id;
      setImage(\`data:image/jpeg;base64,\${d.image}\`);
      setMeta(\`\${d.width} × \${d.height} px\`);
      connect(d.session_id,{...PH_DEF});
    }catch(e:any){setStatus("error");setErr(e.message);}
  },[connect]);

  const upd=useCallback(<K extends keyof PhotoParams>(key:K,val:PhotoParams[K])=>{
    setParams(p=>{const n={...p,[key]:val};setStatus("processing");send(n);return n;});
  },[send]);

  const rotate=useCallback((deg:number)=>{
    setParams(p=>{const n={...p,rotation:(p.rotation+deg+360)%360};setStatus("processing");send(n);return n;});
  },[send]);

  const reset=()=>{const p={...PH_DEF};setParams(p);setStatus("processing");send(p);};
  const dl=()=>{if(!image)return;const a=document.createElement("a");a.href=image;a.download="photo.jpg";a.click();};
  const ok=!!sid.current&&status!=="uploading";

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex items-center justify-center bg-zinc-950 overflow-hidden">
        {!image
          ? <DropZone icon="🖼️" title="Glissez une photo ici" accept="JPG · PNG · WEBP"
              dragging={dragging} setDragging={setDragging} onFile={upload}
              onClick={()=>fileRef.current?.click()} />
          : <div className="relative flex items-center justify-center w-full h-full p-4">
              <img src={image} alt="" className="max-w-full max-h-full rounded-lg shadow-2xl object-contain" style={{maxHeight:"calc(100vh - 100px)"}}/>
              {status==="processing"&&<div className="absolute top-4 right-4 w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>}
              {err&&<div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded-full">{err}</div>}
              <button onClick={()=>fileRef.current?.click()} className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 hover:bg-black/90 text-zinc-300 text-xs px-4 py-2 rounded-full">Changer</button>
            </div>
        }
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/>
      </div>
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto shrink-0">
        {meta&&<div className="px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500">{meta}</div>}
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Réglages</p>
          <div className="flex flex-col gap-4">
            {PH_SLIDERS.map(({key,label,min,max,step,zero})=>(
              <Slider key={key} label={label} min={min} max={max} step={step}
                value={params[key as keyof PhotoParams] as number}
                zero={zero} disabled={!ok}
                onChange={v=>upd(key as keyof PhotoParams,v as any)}/>
            ))}
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Filtres</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PH_FILTERS.map(({id,emoji,label})=>(
              <button key={id} disabled={!ok} onClick={()=>upd("filter",id)}
                className={\`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-30 \${params.filter===id?"bg-indigo-600 text-white":"bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}\`}>
                <span>{emoji}</span>{label}
              </button>
            ))}
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Transformation</p>
          <div className="grid grid-cols-4 gap-1.5">
            {([["↺","Rotation -90",()=>rotate(-90)],["↻","Rotation +90",()=>rotate(90)],
               ["↔","Miroir H",()=>upd("flip_h",!params.flip_h)],["↕","Miroir V",()=>upd("flip_v",!params.flip_v)]] as [string,string,()=>void][])
              .map(([icon,title,fn])=>(
                <button key={title} title={title} disabled={!ok} onClick={fn}
                  className="py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-all disabled:opacity-30">{icon}</button>
              ))}
          </div>
        </section>
        <section className="p-4 flex flex-col gap-2 mt-auto">
          <button disabled={!ok} onClick={reset} className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all disabled:opacity-30">Réinitialiser</button>
          <button disabled={!image} onClick={dl} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-30">↓ Télécharger</button>
        </section>
      </aside>
    </div>
  );
}

// ─── Onglet Vidéo (HTTP POST + ffmpeg) ────────────────────────────────────────
function VideoTab(){
  const [previewUrl,setPreviewUrl]=useState<string|null>(null);
  const [outputUrl,setOutputUrl]=useState<string|null>(null);
  const [duration,setDuration]=useState(0);
  const [status,setStatus]=useState<Status>("idle");
  const [err,setErr]=useState("");
  const [dragging,setDragging]=useState(false);
  const [params,setParams]=useState<VideoParams>({
    start_time:0,end_time:null,speed:1,volume:1,rotation:0,grayscale:false,brightness:0,mute:false,
  });
  const sid=useRef<string|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  const upload=useCallback(async(file:File)=>{
    if(!file.type.startsWith("video/"))return;
    setStatus("uploading");setErr("");setOutputUrl(null);
    setPreviewUrl(URL.createObjectURL(file));
    const fd=new FormData();fd.append("file",file);
    try{
      const res=await fetch("/api/py/upload-video",{method:"POST",body:fd});
      const d=await res.json();
      if(!res.ok)throw new Error(d.error||"Upload échoué");
      sid.current=d.session_id;
      setDuration(d.duration);
      setParams(p=>({...p,end_time:d.duration}));
      setStatus("ready");
    }catch(e:any){setStatus("error");setErr(e.message);}
  },[]);

  const process=useCallback(async()=>{
    if(!sid.current)return;
    setStatus("processing");setErr("");
    try{
      const res=await fetch("/api/py/process-video",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({session_id:sid.current,params}),
      });
      const d=await res.json();
      if(!res.ok||d.error)throw new Error(d.error||"Traitement échoué");
      setOutputUrl(b64Blob(d.video,"video/mp4"));
      setStatus("ready");
    }catch(e:any){setStatus("error");setErr(e.message);}
  },[params]);

  const ok=!!sid.current;
  const up=(k:keyof VideoParams,v:any)=>setParams(p=>({...p,[k]:v}));

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex items-center justify-center bg-zinc-950 overflow-hidden">
        {!previewUrl
          ? <DropZone icon="🎬" title="Glissez une vidéo ici" accept="MP4 · MOV · WEBM · AVI"
              dragging={dragging} setDragging={setDragging} onFile={upload}
              onClick={()=>fileRef.current?.click()} />
          : <div className="flex flex-col items-center justify-center w-full h-full p-4 gap-3">
              <p className="text-xs text-zinc-500">{outputUrl?"✅ Vidéo traitée":"Aperçu original"}</p>
              <video key={outputUrl||previewUrl||""} src={outputUrl||previewUrl||""} controls
                className="max-w-full rounded-lg shadow-2xl" style={{maxHeight:"calc(100vh - 220px)"}}/>
              {status==="processing"&&<div className="flex items-center gap-2 text-indigo-400 text-sm"><div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Traitement ffmpeg…</div>}
              {err&&<div className="bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded-full max-w-xs text-center">{err}</div>}
              <button onClick={()=>fileRef.current?.click()} className="bg-black/70 hover:bg-black/90 text-zinc-300 text-xs px-4 py-2 rounded-full">Changer de vidéo</button>
            </div>
        }
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/>
      </div>
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto shrink-0">
        {duration>0&&<div className="px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500">Durée : {fmtTime(duration)}</div>}
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Découpe</p>
          <div className="flex flex-col gap-4">
            <Slider label="Début" min={0} max={duration||100} step={0.1} value={params.start_time} zero={0} disabled={!ok} onChange={v=>up("start_time",v)}/>
            <Slider label="Fin" min={0} max={duration||100} step={0.1} value={params.end_time??duration} zero={duration||100} disabled={!ok} onChange={v=>up("end_time",v)}/>
            <div className="flex justify-between text-xs text-zinc-500 -mt-2">
              <span>{fmtTime(params.start_time)}</span>
              <span>{fmtTime(params.end_time??duration)}</span>
            </div>
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Réglages</p>
          <div className="flex flex-col gap-4">
            <Slider label="Vitesse" min={0.25} max={4} step={0.25} value={params.speed} zero={1} disabled={!ok} onChange={v=>up("speed",v)}/>
            <Slider label="Volume" min={0} max={2} step={0.1} value={params.volume} zero={1} disabled={!ok||params.mute} onChange={v=>up("volume",v)}/>
            <Slider label="Luminosité" min={-1} max={1} step={0.05} value={params.brightness} zero={0} disabled={!ok} onChange={v=>up("brightness",v)}/>
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Transformation</p>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <button disabled={!ok} onClick={()=>up("rotation",(params.rotation-90+360)%360)} className="py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm disabled:opacity-30">↺ -90°</button>
            <button disabled={!ok} onClick={()=>up("rotation",(params.rotation+90)%360)}      className="py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm disabled:opacity-30">↻ +90°</button>
          </div>
          <div className="flex flex-col gap-2">
            <Toggle label="Noir & Blanc" checked={params.grayscale} disabled={!ok} onChange={()=>up("grayscale",!params.grayscale)}/>
            <Toggle label="Couper le son" checked={params.mute} disabled={!ok} onChange={()=>up("mute",!params.mute)}/>
          </div>
        </section>
        <section className="p-4 flex flex-col gap-2 mt-auto">
          <button disabled={!ok||status==="processing"} onClick={process}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-30">
            {status==="processing"?"⏳ ffmpeg en cours…":"▶ Traiter la vidéo"}
          </button>
          <button disabled={!outputUrl} onClick={()=>{if(!outputUrl)return;const a=document.createElement("a");a.href=outputUrl;a.download="video-editee.mp4";a.click();}}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all disabled:opacity-30">↓ Télécharger</button>
        </section>
      </aside>
    </div>
  );
}

// ─── Onglet Audio (HTTP POST + pydub) ─────────────────────────────────────────
function AudioTab(){
  const [previewUrl,setPreviewUrl]=useState<string|null>(null);
  const [outputUrl,setOutputUrl]=useState<string|null>(null);
  const [duration,setDuration]=useState(0);
  const [status,setStatus]=useState<Status>("idle");
  const [err,setErr]=useState("");
  const [info,setInfo]=useState("");
  const [dragging,setDragging]=useState(false);
  const [params,setParams]=useState<AudioParams>({
    start_time:0,end_time:null,volume_db:0,speed:1,fade_in:0,fade_out:0,reverse:false,
  });
  const sid=useRef<string|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  const upload=useCallback(async(file:File)=>{
    if(!file.type.startsWith("audio/"))return;
    setStatus("uploading");setErr("");setOutputUrl(null);
    setPreviewUrl(URL.createObjectURL(file));
    const fd=new FormData();fd.append("file",file);
    try{
      const res=await fetch("/api/py/upload-audio",{method:"POST",body:fd});
      const d=await res.json();
      if(!res.ok)throw new Error(d.error||"Upload échoué");
      sid.current=d.session_id;
      setDuration(d.duration);
      setParams(p=>({...p,end_time:d.duration}));
      setInfo(\`\${d.channels===2?"Stéréo":"Mono"} · \${(d.sample_rate/1000).toFixed(1)} kHz\`);
      setStatus("ready");
    }catch(e:any){setStatus("error");setErr(e.message);}
  },[]);

  const process=useCallback(async()=>{
    if(!sid.current)return;
    setStatus("processing");setErr("");
    try{
      const res=await fetch("/api/py/process-audio",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({session_id:sid.current,params}),
      });
      const d=await res.json();
      if(!res.ok||d.error)throw new Error(d.error||"Traitement échoué");
      setOutputUrl(b64Blob(d.audio,"audio/mpeg"));
      setStatus("ready");
    }catch(e:any){setStatus("error");setErr(e.message);}
  },[params]);

  const ok=!!sid.current;
  const up=(k:keyof AudioParams,v:any)=>setParams(p=>({...p,[k]:v}));

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex items-center justify-center bg-zinc-950 overflow-hidden">
        {!previewUrl
          ? <DropZone icon="🎵" title="Glissez un fichier audio ici" accept="MP3 · WAV · OGG · M4A · FLAC"
              dragging={dragging} setDragging={setDragging} onFile={upload}
              onClick={()=>fileRef.current?.click()} />
          : <div className="flex flex-col items-center justify-center gap-6 w-full p-8">
              <div className="w-32 h-32 bg-zinc-800 rounded-full flex items-center justify-center text-6xl shadow-2xl">🎵</div>
              {info&&<p className="text-zinc-500 text-sm">{info} · {fmtTime(duration)}</p>}
              <div className="flex flex-col items-center gap-2 w-full max-w-md">
                <p className="text-xs text-zinc-500">{outputUrl?"✅ Audio traité":"Original"}</p>
                <audio key={outputUrl||previewUrl||""} src={outputUrl||previewUrl||""} controls className="w-full"/>
              </div>
              {status==="processing"&&<div className="flex items-center gap-2 text-indigo-400 text-sm"><div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Traitement pydub…</div>}
              {err&&<div className="bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded-full max-w-xs text-center">{err}</div>}
              <button onClick={()=>fileRef.current?.click()} className="bg-black/70 hover:bg-black/90 text-zinc-300 text-xs px-4 py-2 rounded-full">Changer de fichier</button>
            </div>
        }
        <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/>
      </div>
      <aside className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-y-auto shrink-0">
        {duration>0&&<div className="px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500">Durée : {fmtTime(duration)}</div>}
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Découpe</p>
          <div className="flex flex-col gap-4">
            <Slider label="Début" min={0} max={duration||100} step={0.1} value={params.start_time} zero={0} disabled={!ok} onChange={v=>up("start_time",v)}/>
            <Slider label="Fin"   min={0} max={duration||100} step={0.1} value={params.end_time??duration} zero={duration||100} disabled={!ok} onChange={v=>up("end_time",v)}/>
            <div className="flex justify-between text-xs text-zinc-500 -mt-2">
              <span>{fmtTime(params.start_time)}</span>
              <span>{fmtTime(params.end_time??duration)}</span>
            </div>
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">Réglages</p>
          <div className="flex flex-col gap-4">
            <Slider label="Volume (dB)" min={-20} max={20} step={1} value={params.volume_db} zero={0} disabled={!ok} onChange={v=>up("volume_db",v)}/>
            <Slider label="Vitesse"     min={0.5}  max={2}  step={0.05} value={params.speed}     zero={1} disabled={!ok} onChange={v=>up("speed",v)}/>
            <Slider label="Fondu entrée (s)" min={0} max={10} step={0.5} value={params.fade_in}  zero={0} disabled={!ok} onChange={v=>up("fade_in",v)}/>
            <Slider label="Fondu sortie (s)" min={0} max={10} step={0.5} value={params.fade_out} zero={0} disabled={!ok} onChange={v=>up("fade_out",v)}/>
          </div>
        </section>
        <section className="p-4 border-b border-zinc-800">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Effets</p>
          <Toggle label="Inverser l'audio" checked={params.reverse} disabled={!ok} onChange={()=>up("reverse",!params.reverse)}/>
        </section>
        <section className="p-4 flex flex-col gap-2 mt-auto">
          <button disabled={!ok||status==="processing"} onClick={process}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-30">
            {status==="processing"?"⏳ pydub en cours…":"▶ Traiter l'audio"}
          </button>
          <button disabled={!outputUrl} onClick={()=>{if(!outputUrl)return;const a=document.createElement("a");a.href=outputUrl;a.download="audio-edite.mp3";a.click();}}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all disabled:opacity-30">↓ Télécharger</button>
        </section>
      </aside>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function Page(){
  const [tab,setTab]=useState<Tab>("photo");
  const TABS=[{id:"photo" as Tab,icon:"🖼️",label:"Photo"},{id:"video" as Tab,icon:"🎬",label:"Vidéo"},{id:"audio" as Tab,icon:"🎵",label:"Audio"}];
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col select-none">
      <header className="flex items-center justify-between px-5 py-2.5 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">✂️</div>
          <span className="font-semibold text-sm">MediaEdit</span>
        </div>
        <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
          {TABS.map(({id,icon,label})=>(
            <button key={id} onClick={()=>setTab(id)}
              className={\`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all \${tab===id?"bg-indigo-600 text-white shadow":"text-zinc-400 hover:text-zinc-200"}\`}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
        <div className="w-24"/>
      </header>
      {tab==="photo"&&<PhotoTab/>}
      {tab==="video"&&<VideoTab/>}
      {tab==="audio"&&<AudioTab/>}
    </div>
  );
}
`
        )

        // Préparer Python dans le sandbox — disponible pour tout projet
        try {
          console.log("[v0] Setting up Python environment...")
          // ffmpeg requis pour vidéo (pydub + subprocess)
          await sandbox.commands.run(
            "which ffmpeg || (apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null) || true",
            { cwd: "/home/user", timeoutMs: 90000 }
          )
          await sandbox.commands.run(
            "python3 -m pip install --upgrade pip --quiet 2>/dev/null || true",
            { cwd: "/home/user", timeoutMs: 60000 }
          )
          // Pré-installer les dépendances média (Pillow, numpy, pydub)
          await sandbox.commands.run(
            "pip install fastapi uvicorn[standard] python-dotenv httpx Pillow numpy python-multipart pydub --quiet",
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

      case "deploy-all": {
        // ── Séquence complète : create → addFiles → install → build → start ──
        // Répond en streaming NDJSON pour que le client lise les logs en temps réel
        const files = requestFiles;
        if (!files || !Array.isArray(files)) throw new Error("files[] requis pour deploy-all");

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const emit = (msg: string, type: 'stdout' | 'stderr' | 'system' | 'success' = 'system') => {
              controller.enqueue(enc.encode(JSON.stringify({ type, message: msg }) + '\n'));
            };

            try {
              // ── STEP 1 : create ────────────────────────────────────────────
              emit("📦 Création du sandbox...");
              const sandbox = await e2b.Sandbox.create({ apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });
              const sid = sandbox.sandboxId;

              // Fichiers Next.js par défaut
              const defaultPkg = {
                name: "nextjs-app", private: true,
                scripts: { dev: "next dev -p 3000 -H 0.0.0.0", build: "next build", start: "next start -p 3000 -H 0.0.0.0" },
                dependencies: { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.561.0" },
                devDependencies: { typescript: "5.7.2", "@types/node": "22.10.1", "@types/react": "19.0.1", "@types/react-dom": "19.0.1", tailwindcss: "^3.4.1", postcss: "^8", autoprefixer: "^10.0.1" }
              };
              await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPkg, null, 2));
              emit(`✅ Sandbox créé (${sid})`);
              emit(`[SANDBOX_ID]${sid}[/SANDBOX_ID]`); // pour que le client récupère l'ID

              // ── STEP 2 : delay + addFiles ──────────────────────────────────
              emit("⏳ Initialisation (6s)...");
              await new Promise(r => setTimeout(r, 6000));
              emit(`📂 Écriture de ${files.length} fichiers...`);
              let written = 0;
              for (const f of files) {
                const fp = f.filePath || f.path;
                if (!fp || typeof f.content !== 'string' || !f.content.trim()) continue;
                await sandbox.files.write(`/home/user/${fp}`, f.content);
                written++;
              }
              emit(`✅ ${written} fichiers écrits`);

              // ── STEP 3 : install ───────────────────────────────────────────
              emit("📥 npm install en cours...");
              let installResult: any;
              try {
                installResult = await sandbox.commands.run("npm install --no-audit --loglevel warn", { cwd: "/home/user", timeoutMs: INSTALL_TIMEOUT_MS });
                if (installResult.stdout) emit(installResult.stdout.slice(0, 500), 'stdout');
                if (installResult.stderr) {
                  const hasBlockingError = installResult.stderr.toLowerCase().includes('npm err') || installResult.stderr.includes('ERESOLVE');
                  if (hasBlockingError) emit(installResult.stderr.slice(0, 800), 'stderr');
                }
                emit(installResult.exitCode === 0 ? "✅ Installation réussie" : "⚠️ Installation avec avertissements");
              } catch (e: any) {
                emit(`❌ Install error: ${e.message}`, 'stderr');
                controller.enqueue(enc.encode(JSON.stringify({ type: 'BUILD_ERROR', action: 'Install', stderr: e.message }) + '\n'));
              }

              // ── STEP 4 : build ─────────────────────────────────────────────
              emit("🔨 npm run build en cours...");
              let buildResult: any;
              try {
                buildResult = await sandbox.commands.run("npm run build", { cwd: "/home/user", timeoutMs: BUILD_TIMEOUT_MS });
                if (buildResult.stdout) emit(buildResult.stdout.slice(-1000), 'stdout');
                if (buildResult.exitCode !== 0 && buildResult.stderr) {
                  emit(buildResult.stderr.slice(0, 1000), 'stderr');
                  controller.enqueue(enc.encode(JSON.stringify({ type: 'BUILD_ERROR', action: 'Build', stderr: buildResult.stderr.slice(0, 2000) }) + '\n'));
                } else {
                  emit("✅ Build réussi");
                }
              } catch (e: any) {
                emit(`❌ Build error: ${e.message}`, 'stderr');
                controller.enqueue(enc.encode(JSON.stringify({ type: 'BUILD_ERROR', action: 'Build', stderr: e.message }) + '\n'));
              }

              // ── STEP 5 : start ─────────────────────────────────────────────
              emit("🚀 Démarrage du serveur...");
              await sandbox.commands.run("pkill -f 'next' || true; fuser -k 3000/tcp || true", { timeoutMs: 5000 }).catch(() => {});
              await new Promise(r => setTimeout(r, 1000));
              await sandbox.commands.run("nohup npm run dev > /home/user/server.log 2>&1 &", { cwd: "/home/user", timeoutMs: 10000 });

              let serverReady = false;
              for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                  const chk = await sandbox.commands.run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 || echo 000", { timeoutMs: 4000 });
                  const code = chk.stdout.trim();
                  if (code === "200" || code === "304" || code === "404") { serverReady = true; break; }
                } catch {}
              }

              const url = `https://${sandbox.getHost(3000)}`;
              emit(serverReady ? `✅ Serveur prêt : ${url}` : `⚠️ Serveur peut-être pas encore prêt — ${url}`);
              controller.enqueue(enc.encode(JSON.stringify({ type: 'DONE', sandboxId: sid, url, success: serverReady }) + '\n'));
            } catch (err: any) {
              emit(`❌ Erreur: ${err.message}`, 'stderr');
              controller.enqueue(enc.encode(JSON.stringify({ type: 'ERROR', message: err.message }) + '\n'));
            } finally {
              controller.close();
            }
          }
        });

        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' }
        });
      }
    }
  } catch (e: any) {
    console.error("[v0] Erreur dans l'API route /api/sandbox:", e)
    return NextResponse.json({ error: e.message || "Erreur inconnue", details: e.toString() }, { status: 500 })
  }
            }
