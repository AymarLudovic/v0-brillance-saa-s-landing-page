"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Status = "idle" | "listening" | "active" | "capturing";
interface Screenshot { id: string; url: string; time: string; }

const WAKE_WORD = "jarvis";

export default function JarvisPage() {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);

  const [status,       setStatus]       = useState<Status>("idle");
  const [screenActive, setScreenActive] = useState(false);
  const [screenshots,  setScreenshots]  = useState<Screenshot[]>([]);
  const [transcript,   setTranscript]   = useState("");
  const [log,          setLog]          = useState<string[]>([
    "Système initialisé. Dites « Jarvis » pour activer.",
  ]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 12));
  }, []);

  // ── Démarrer le partage d'écran ──────────────────────────────────────
  const startScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      stream.getVideoTracks()[0].onended = () => stopScreen();
      setScreenActive(true);
      setStatus("active");
      addLog("Écran capturé. Je vois votre écran.");
    } catch {
      addLog("Accès écran refusé.");
      setStatus("idle");
    }
  }, [addLog]);

  // ── Arrêter ──────────────────────────────────────────────────────────
  const stopScreen = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScreenActive(false);
    setStatus("listening");
    addLog("Écran déconnecté.");
  }, [addLog]);

  // ── Capture ───────────────────────────────────────────────────────────
  const takeScreenshot = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url  = canvas.toDataURL("image/png");
    const now  = new Date();
    const time = now.toLocaleTimeString();
    setScreenshots(prev => [{ id: String(now.getTime()), url, time }, ...prev].slice(0, 6));
    setStatus("capturing");
    addLog(`Capture effectuée à ${time}.`);
    setTimeout(() => setStatus("active"), 800);
    // Téléchargement auto
    const a = document.createElement("a");
    a.href = url; a.download = `jarvis-${now.getTime()}.png`; a.click();
  }, [addLog]);

  // ── Reconnaissance vocale — démarre une seule fois ────────────────────
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { addLog("Reconnaissance vocale non supportée."); return; }

    const rec = new SpeechRecognition();
    rec.lang           = "fr-FR";
    rec.continuous     = true;
    rec.interimResults = true;
    recognitionRef.current = rec;

    rec.onresult = (e: any) => {
      const result = e.results[e.results.length - 1];
      const text   = result[0].transcript.toLowerCase().trim();
      setTranscript(text);
      if (!result.isFinal) return;
      setTranscript("");

      if (text.includes(WAKE_WORD)) {
        if (!streamRef.current) {
          addLog("Mot-clé détecté → activation écran...");
          startScreen();
        } else {
          addLog("Mot-clé détecté → désactivation.");
          stopScreen();
        }
        return;
      }
      if (streamRef.current) {
        if (text.includes("capture") || text.includes("screenshot") || text.includes("photo")) {
          takeScreenshot(); return;
        }
        if (text.includes("stop") || text.includes("arrête") || text.includes("ferme")) {
          stopScreen(); return;
        }
      }
    };

    rec.onerror = (e: any) => { if (e.error !== "no-speech") addLog(`Erreur : ${e.error}`); };
    rec.onend   = () => { try { rec.start(); } catch {} };

    try { rec.start(); setStatus("listening"); addLog("Écoute active. Dites « Jarvis »."); }
    catch { addLog("Impossible de démarrer le micro."); }

    return () => { try { rec.abort(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accent =
    status === "capturing" ? "#ff3c6e"
    : status === "active"  ? "#00ff88"
    : status === "listening"? "#4fc3f7"
    : "#444";

  const statusLabel = {
    idle: "EN ATTENTE", listening: "ÉCOUTE",
    active: "ACTIF", capturing: "CAPTURE !"
  }[status];

  return (
    <div style={{
      minHeight: "100vh", background: "#07080a", color: "#e0e6f0",
      fontFamily: "'JetBrains Mono','Courier New',monospace",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "24px 16px", gap: 18,
    }}>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* ── Header ── */}
      <div style={{ width: "100%", maxWidth: 860, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 20px ${accent}44`, transition: "all 0.4s",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3.5" fill={accent}/>
              <circle cx="12" cy="12" r="8" stroke={accent} strokeWidth="1" opacity=".3"/>
              <line x1="12" y1="2" x2="12" y2="5.5" stroke={accent} strokeWidth="1.2"/>
              <line x1="12" y1="18.5" x2="12" y2="22" stroke={accent} strokeWidth="1.2"/>
              <line x1="2" y1="12" x2="5.5" y2="12" stroke={accent} strokeWidth="1.2"/>
              <line x1="18.5" y1="12" x2="22" y2="12" stroke={accent} strokeWidth="1.2"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.18em", color: accent, transition: "color 0.4s" }}>
              J.A.R.V.I.S
            </div>
            <div style={{ fontSize: 9, color: "#2a3040", letterSpacing: "0.12em" }}>
              SCREEN INTELLIGENCE v1.0
            </div>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 16px", borderRadius: 99,
          border: `1px solid ${accent}33`, background: `${accent}08`,
          fontSize: 10, letterSpacing: "0.12em", color: accent,
          transition: "all 0.4s",
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: accent, boxShadow: `0 0 8px ${accent}`,
            animation: status !== "idle" ? "blink 1.5s infinite" : "none",
          }}/>
          {statusLabel}
        </div>
      </div>

      {/* ── Preview écran ── */}
      <div style={{
        width: "100%", maxWidth: 860, aspectRatio: "16/9",
        borderRadius: 14, overflow: "hidden",
        border: `1px solid ${accent}22`,
        background: "#0c0e12", position: "relative",
        boxShadow: screenActive ? `0 0 48px ${accent}18` : "none",
        transition: "box-shadow 0.5s, border-color 0.4s",
      }}>
        {/* Scanlines */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)",
        }}/>
        {/* Coins */}
        {([["top","left"],["top","right"],["bottom","left"],["bottom","right"]] as const).map(([v, h], i) => (
          <div key={i} style={{
            position: "absolute", [v]: 10, [h]: 10,
            width: 18, height: 18, zIndex: 3, pointerEvents: "none",
            borderTop:    v === "top"    ? `1.5px solid ${accent}` : "none",
            borderBottom: v === "bottom" ? `1.5px solid ${accent}` : "none",
            borderLeft:   h === "left"   ? `1.5px solid ${accent}` : "none",
            borderRight:  h === "right"  ? `1.5px solid ${accent}` : "none",
            transition: "border-color 0.4s",
          }}/>
        ))}

        <video ref={videoRef} muted playsInline style={{
          width: "100%", height: "100%", objectFit: "contain",
          opacity: screenActive ? 1 : 0, transition: "opacity 0.5s",
        }}/>

        {!screenActive && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
          }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" style={{ color: "#1c2030" }}>
              <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1"/>
              <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            <div style={{ fontSize: 11, color: "#1c2030", letterSpacing: "0.14em" }}>
              DITES « JARVIS » POUR ACTIVER
            </div>
          </div>
        )}
      </div>

      {/* ── Boutons manuels ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {!screenActive
          ? <Btn color="#00ff88" onClick={startScreen} icon="screen">Activer l'écran</Btn>
          : <>
              <Btn color="#4fc3f7" onClick={takeScreenshot} icon="camera">Capturer</Btn>
              <Btn color="#ff3c6e" onClick={stopScreen} icon="stop">Arrêter</Btn>
            </>
        }
      </div>

      {/* ── Transcript en cours ── */}
      {transcript && (
        <div style={{
          width: "100%", maxWidth: 860,
          padding: "10px 16px", borderRadius: 8,
          background: "#0d1018", border: "1px solid #4fc3f722",
          fontSize: 12, color: "#4fc3f7", letterSpacing: "0.06em",
        }}>
          🎙 {transcript}
        </div>
      )}

      {/* ── Log ── */}
      <div style={{
        width: "100%", maxWidth: 860,
        borderRadius: 10, background: "#0c0e12", border: "1px solid #161a24", overflow: "hidden",
      }}>
        <div style={{ padding: "8px 14px", fontSize: 9, color: "#222840", letterSpacing: "0.14em", borderBottom: "1px solid #161a24" }}>
          JOURNAL SYSTÈME
        </div>
        <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
          {log.map((l, i) => (
            <div key={i} style={{ fontSize: 11, color: i === 0 ? "#8090a8" : "#2a3245", letterSpacing: "0.04em" }}>
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* ── Commandes rapides ── */}
      <div style={{ width: "100%", maxWidth: 860, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { cmd: "« Jarvis »",  desc: "Activer / Désactiver" },
          { cmd: "« Capture »", desc: "Prendre une capture" },
          { cmd: "« Stop »",    desc: "Arrêter l'écran"     },
        ].map(({ cmd, desc }) => (
          <div key={cmd} style={{
            flex: 1, minWidth: 140, padding: "10px 14px", borderRadius: 8,
            background: "#0c0e12", border: "1px solid #161a24",
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <div style={{ fontSize: 12, color: accent, fontWeight: 600, transition: "color 0.4s" }}>{cmd}</div>
            <div style={{ fontSize: 10, color: "#2a3245" }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* ── Captures récentes ── */}
      {screenshots.length > 0 && (
        <div style={{ width: "100%", maxWidth: 860 }}>
          <div style={{ fontSize: 9, color: "#222840", letterSpacing: "0.14em", marginBottom: 10 }}>
            CAPTURES RÉCENTES
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {screenshots.map(sc => (
              <a key={sc.id} href={sc.url} download={`jarvis-${sc.id}.png`}
                style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                <img src={sc.url} alt={sc.time} style={{
                  width: 156, height: 88, objectFit: "cover",
                  borderRadius: 6, border: "1px solid #161a24", cursor: "pointer",
                  transition: "border-color 0.2s",
                }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${accent}66`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#161a24")}
                />
                <span style={{ fontSize: 10, color: "#2a3245", textAlign: "center" }}>{sc.time}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
      `}</style>
    </div>
  );
}

// ── Bouton réutilisable ────────────────────────────────────────────────────
function Btn({ color, onClick, icon, children }: {
  color: string; onClick: () => void; icon: string; children: React.ReactNode;
}) {
  const icons: Record<string, React.ReactNode> = {
    screen: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
    camera: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="4"/><path d="M9 3H5a2 2 0 0 0-2 2v3m14-5h4a2 2 0 0 1 2 2v3M3 19v2a2 2 0 0 0 2 2h4m8 0h4a2 2 0 0 0 2-2v-2"/></svg>,
    stop:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
  };
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 20px", borderRadius: 8,
      border: `1px solid ${color}44`, background: `${color}0e`,
      color, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace",
      fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
      transition: "all 0.2s",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${color}1a`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${color}0e`; }}
    >
      {icons[icon]} {children}
    </button>
  );
    }
