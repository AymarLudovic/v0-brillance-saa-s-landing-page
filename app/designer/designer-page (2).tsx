"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type AppMode = "clone" | "create" | "web";

interface WebSource { title: string; url: string }

interface Message {
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  mode?: AppMode;
  webQueries?: string[];
  webSources?: WebSource[];
}

interface ColorSample { hex: string; frequency: number; zone: string }

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION COULEURS CANVAS
// ─────────────────────────────────────────────────────────────────────────────

function extractColors(img: HTMLImageElement): ColorSample[] {
  const canvas = document.createElement("canvas");
  const MAX = 400;
  const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 1);
  canvas.width  = Math.round(img.naturalWidth  * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;

  const zones = [
    { name: "header-top",        x0: 0,    y0: 0,    x1: 1,    y1: 0.13 },
    { name: "coin-haut-gauche",  x0: 0,    y0: 0,    x1: 0.22, y1: 0.13 },
    { name: "sidebar-gauche",    x0: 0,    y0: 0.13, x1: 0.22, y1: 0.87 },
    { name: "contenu-principal", x0: 0.22, y0: 0.13, x1: 0.78, y1: 0.87 },
    { name: "milieu-centre",     x0: 0.28, y0: 0.25, x1: 0.72, y1: 0.75 },
    { name: "colonne-droite",    x0: 0.78, y0: 0.13, x1: 1,    y1: 0.87 },
    { name: "bas-page",          x0: 0,    y0: 0.87, x1: 1,    y1: 1    },
  ];

  const results: ColorSample[] = [];
  for (const z of zones) {
    const x0 = Math.round(z.x0 * W), y0 = Math.round(z.y0 * H);
    const w = Math.max(Math.round((z.x1 - z.x0) * W), 1);
    const h = Math.max(Math.round((z.y1 - z.y0) * H), 1);
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(x0, y0, w, h).data; } catch { continue; }
    const freq: Record<string, number> = {};
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.round(data[i]   / 32) * 32;
      const g = Math.round(data[i+1] / 32) * 32;
      const b = Math.round(data[i+2] / 32) * 32;
      const k = `${r},${g},${b}`;
      freq[k] = (freq[k] || 0) + 1;
    }
    Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,3).forEach(([rgb, count]) => {
      const [r,g,b] = rgb.split(",").map(Number);
      const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
      results.push({ hex, frequency: count, zone: z.name });
    });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS DE STREAM
// ─────────────────────────────────────────────────────────────────────────────

function extractHtml(text: string): string {
  const m = text.match(/```html\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  const t = text.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) return t;
  return "";
}

// Extrait le HTML injecté avec JS depuis le marqueur serveur
function extractJsInjected(text: string): string | null {
  const m = text.match(/\[JS_INJECTED\]([\s\S]*?)\[\/JS_INJECTED\]/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as string; } catch { return null; }
}

function extractJsonMarker<T>(text: string, tag: string): T | null {
  const m = text.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  if (!m) return null;
  try { return JSON.parse(m[1]) as T; } catch { return null; }
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANTS UI
// ─────────────────────────────────────────────────────────────────────────────

function WebActivity({ queries, sources }: { queries: string[]; sources: WebSource[] }) {
  return (
    <div className="mt-2 space-y-1.5 pt-2 border-t border-white/[0.06]">
      {queries.length > 0 && (
        <div className="space-y-1">
          {queries.map((q, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="w-3 h-3 rounded-full border border-emerald-500/50 flex items-center justify-center shrink-0">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              </span>
              <span className="text-slate-500">Recherche :</span>
              <span className="text-emerald-400 truncate font-medium">&ldquo;{q}&rdquo;</span>
            </div>
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div className="space-y-1 mt-2">
          <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
            {sources.length} source{sources.length > 1 ? "s" : ""} consultée{sources.length > 1 ? "s" : ""}
          </p>
          {sources.slice(0, 6).map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-sky-500/30 hover:bg-sky-500/[0.06] transition-all group no-underline">
              <img src={`https://www.google.com/s2/favicons?domain=${getDomain(s.url)}&sz=32`} alt="" className="w-4 h-4 rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-300 truncate group-hover:text-sky-300 transition-colors">{s.title || getDomain(s.url)}</p>
                <p className="text-[10px] text-slate-600 truncate">{getDomain(s.url)}</p>
              </div>
              <span className="text-slate-700 group-hover:text-sky-500 transition-colors text-xs shrink-0">↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export default function DesignerPage() {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState("");
  const [mode, setMode]                 = useState<AppMode>("create");
  const [isLoading, setIsLoading]       = useState(false);
  const [loadingStep, setLoadingStep]   = useState<"js" | "ux" | "web" | "">("");
  const [imageFile, setImageFile]       = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [colors, setColors]             = useState<ColorSample[]>([]);
  const [previewHtml, setPreviewHtml]   = useState("");
  const [activeTab, setActiveTab]       = useState<"chat" | "preview">("chat");
  const [streamText, setStreamText]     = useState("");
  const [liveQueries, setLiveQueries]   = useState<string[]>([]);

  const fileRef    = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const taRef      = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamText]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = e => {
      const url = e.target?.result as string;
      setImagePreview(url);
      const img = new Image();
      img.onload = () => setColors(extractColors(img));
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleImageSelect(f); e.target.value = "";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageSelect(f);
  };
  const openInNewTab = () => {
    if (!previewHtml) return;
    const url = URL.createObjectURL(new Blob([previewHtml], { type: "text/html" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // ── SEND ───────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageFile) || isLoading) return;

    const userMsg: Message = { role: "user", content: text, imagePreview: imagePreview || undefined, mode };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStreamText("");
    setLiveQueries([]);

    const histApi = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      // ── WEB SEARCH ──────────────────────────────────────────────────────────
      if (mode === "web") {
        setLoadingStep("web");
        const form = new FormData();
        form.append("message", text);
        form.append("history", JSON.stringify(histApi));

        const resp = await fetch("/api/web", { method: "POST", body: form });
        if (!resp.ok || !resp.body) throw new Error(`Web API ${resp.status}`);

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let full = "";
        let queries: string[] = [];
        let sources: WebSource[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value);

          // Extrait les marqueurs au fil du stream
          const q = extractJsonMarker<string[]>(full, "QUERIES");
          if (q && q.length) { queries = q; setLiveQueries(q); }

          const s = extractJsonMarker<WebSource[]>(full, "SOURCES");
          if (s) sources = s;

          // Affiche le texte sans les marqueurs
          const cleanText = full
            .replace(/\[QUERIES\][\s\S]*?\[\/QUERIES\]\n?/g, "")
            .replace(/\[SOURCES\][\s\S]*?\[\/SOURCES\]\n?/g, "");
          setStreamText(cleanText.slice(-300));
        }

        const finalText = full
          .replace(/\[QUERIES\][\s\S]*?\[\/QUERIES\]\n?/g, "")
          .replace(/\[SOURCES\][\s\S]*?\[\/SOURCES\]\n?/g, "")
          .trim();

        setMessages(prev => [...prev, {
          role: "assistant", content: finalText, mode: "web",
          webQueries: queries, webSources: sources,
        }]);

      } else {
        // ── JS BUILDER (optionnel) ───────────────────────────────────────────
        let jsOutput = "";
        if (text.length > 10) {
          setLoadingStep("js");
          const jsForm = new FormData();
          jsForm.append("message", text);
          jsForm.append("history", JSON.stringify(histApi));
          if (imageFile) jsForm.append("image", imageFile);
          try {
            const jsResp = await fetch("/api/js", { method: "POST", body: jsForm });
            if (jsResp.ok && jsResp.body) {
              const reader = jsResp.body.getReader();
              const dec = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                jsOutput += dec.decode(value);
                setStreamText("⚙️ " + jsOutput.slice(-150));
              }
            }
          } catch { /* JS optionnel */ }
        }

        // ── UX DESIGNER ─────────────────────────────────────────────────────
        setLoadingStep("ux");
        setStreamText("🎨 Génération de l'interface...");

        const uxForm = new FormData();
        uxForm.append("message", text);
        uxForm.append("history", JSON.stringify(histApi));
        uxForm.append("mode", mode);
        if (imageFile)         uxForm.append("image", imageFile);
        if (colors.length > 0) uxForm.append("colors", JSON.stringify(colors));
        if (jsOutput.trim())   uxForm.append("jsScripts", jsOutput);

        const uxResp = await fetch("/api/ux", { method: "POST", body: uxForm });
        if (!uxResp.ok || !uxResp.body) throw new Error(`UX API ${uxResp.status}`);

        const reader = uxResp.body.getReader();
        const dec = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value);

          // Vérifie si le JS injecté est arrivé (prioritaire)
          const injected = extractJsInjected(full);
          if (injected) {
            setPreviewHtml(injected);
            setActiveTab("preview");
          } else {
            // Sinon affiche le HTML brut généré (sans JS encore)
            const html = extractHtml(full);
            if (html) { setPreviewHtml(html); setActiveTab("preview"); }
          }

          setStreamText(full.replace(/\[JS_INJECTED\][\s\S]*?\[\/JS_INJECTED\]/, "").slice(-200));
        }

        // Résultat final — le JS_INJECTED a priorité sur l'HTML brut
        const finalInjected = extractJsInjected(full);
        const finalHtml = finalInjected || extractHtml(full);
        if (finalHtml) setPreviewHtml(finalHtml);

        setMessages(prev => [...prev, {
          role: "assistant",
          content: finalHtml
            ? `✅ Interface générée — ${mode === "clone" ? "⚡ Clone" : "✦ Création"}`
            : full.replace(/\[JS_INJECTED\][\s\S]*?\[\/JS_INJECTED\]/, "").trim(),
          mode,
        }]);
        if (finalHtml) setActiveTab("preview");
      }

    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}` }]);
    } finally {
      setIsLoading(false); setLoadingStep(""); setStreamText(""); setLiveQueries([]);
      setImageFile(null); setImagePreview(""); setColors([]);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const uniqueColors = [...new Set(colors.slice(0, 10).map(c => c.hex))];

  const modes = [
    { id: "clone" as AppMode,  emoji: "⚡", label: "Clone",  desc: "Pixel-perfect",     btn: "bg-blue-600 hover:bg-blue-500",    active: "bg-blue-600 text-white shadow-sm" },
    { id: "create" as AppMode, emoji: "✦",  label: "Créer",  desc: "Nouvelle interface", btn: "bg-violet-600 hover:bg-violet-500", active: "bg-violet-600 text-white shadow-sm" },
    { id: "web" as AppMode,    emoji: "🔍", label: "Web",    desc: "Recherche réelle",   btn: "bg-emerald-600 hover:bg-emerald-500", active: "bg-emerald-600 text-white shadow-sm" },
  ];
  const currentMode = modes.find(m => m.id === mode)!;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-dvh bg-[#090910] text-slate-200 overflow-hidden select-none">

      {/* HEADER */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0c0c1a] shrink-0 gap-3 z-10">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-sm font-bold">✦</div>
          <span className="font-semibold text-sm tracking-tight hidden sm:block">AI Designer</span>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-white/[0.04] border border-white/[0.08] rounded-xl p-[3px] gap-0.5">
          {modes.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} title={m.desc}
              className={`px-3 py-1 rounded-[9px] text-xs font-medium transition-all duration-150 flex items-center gap-1 ${mode === m.id ? m.active : "text-slate-500 hover:text-slate-300"}`}>
              <span>{m.emoji}</span><span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1">
          {(["chat", "preview"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150 ${activeTab === tab ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "border-white/[0.07] text-slate-500 hover:text-slate-400"}`}>
              {tab === "chat" ? "💬" : "🖥️"}
              <span className="hidden sm:inline ml-1">{tab === "chat" ? "Chat" : "Aperçu"}</span>
            </button>
          ))}
        </div>
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── CHAT ──────────────────────────────────────────────────────────── */}
        <div className={`flex flex-col w-full md:w-[460px] md:max-w-[460px] shrink-0 border-r border-white/[0.06] ${activeTab === "preview" ? "hidden md:flex" : "flex"}`}>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scroll-smooth">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/20 flex items-center justify-center text-2xl">✦</div>
                <div>
                  <p className="text-sm font-medium text-slate-400 mb-1">AI Designer Studio</p>
                  <p className="text-xs text-slate-600">Upload une image et décris ce que tu veux</p>
                </div>
                <div className="w-full max-w-xs space-y-1.5 text-xs">
                  {modes.map(m => (
                    <button key={m.id} onClick={() => setMode(m.id)}
                      className={`w-full px-3 py-2.5 rounded-xl border text-left transition-all ${mode === m.id ? "border-violet-500/30 bg-violet-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"}`}>
                      <span className="mr-1.5">{m.emoji}</span>
                      <span className={mode === m.id ? "text-slate-200 font-medium" : "text-slate-500"}>{m.label}</span>
                      <span className="text-slate-600 ml-1">— {m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 items-start ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${msg.role === "user" ? "bg-gradient-to-br from-blue-600 to-violet-600" : msg.mode === "web" ? "bg-gradient-to-br from-emerald-600 to-teal-500" : "bg-gradient-to-br from-violet-600 to-pink-600"}`}>
                  {msg.role === "user" ? "U" : msg.mode === "web" ? "🌐" : "✦"}
                </div>
                <div className={`max-w-[82%] px-3 py-2.5 text-sm leading-relaxed border ${msg.role === "user" ? "bg-white/[0.04] border-white/[0.08] rounded-[12px_4px_12px_12px]" : "bg-[#0f0f20] border-white/[0.06] rounded-[4px_12px_12px_12px]"}`}>
                  {msg.imagePreview && <img src={msg.imagePreview} alt="" className="w-full max-w-[180px] rounded-lg mb-2 block" />}
                  {msg.mode && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mb-1.5 ${msg.mode === "clone" ? "bg-blue-500/15 text-blue-400" : msg.mode === "create" ? "bg-violet-500/15 text-violet-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                      {modes.find(m => m.id === msg.mode)?.emoji} {msg.mode.toUpperCase()}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-slate-300 select-text">{msg.content}</p>
                  {(msg.webQueries?.length || msg.webSources?.length) ? (
                    <WebActivity queries={msg.webQueries || []} sources={msg.webSources || []} />
                  ) : null}
                </div>
              </div>
            ))}

            {/* Loading state */}
            {isLoading && (
              <div className="flex gap-2 items-start">
                <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs animate-pulse ${loadingStep === "web" ? "bg-gradient-to-br from-emerald-600 to-teal-500" : "bg-gradient-to-br from-violet-600 to-pink-600"}`}>
                  {loadingStep === "web" ? "🌐" : "✦"}
                </div>
                <div className="bg-[#0f0f20] border border-white/[0.06] rounded-[4px_12px_12px_12px] px-3 py-2.5 max-w-[82%] min-w-[140px]">
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-1.5">
                    <span className={`w-3 h-3 rounded-full border-2 animate-spin shrink-0 ${loadingStep === "js" ? "border-amber-500/30 border-t-amber-400" : loadingStep === "web" ? "border-emerald-500/30 border-t-emerald-400" : "border-violet-500/30 border-t-violet-400"}`} />
                    <span>
                      {loadingStep === "js" ? "Construction JavaScript..." :
                       loadingStep === "web" ? "Recherche web en cours..." :
                       "Génération de l'interface..."}
                    </span>
                  </div>

                  {/* Queries en direct pour le mode web */}
                  {loadingStep === "web" && liveQueries.length > 0 && (
                    <div className="space-y-1 mb-1">
                      {liveQueries.map((q, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full shrink-0 animate-pulse" />
                          <span className="truncate text-emerald-500/70">&ldquo;{q}&rdquo;</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {streamText && !streamText.includes("[QUERIES]") && (
                    <p className="text-[10px] text-slate-700 font-mono line-clamp-3 whitespace-pre-wrap leading-relaxed">
                      {streamText.slice(-120)}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* INPUT */}
          <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] bg-[#0c0c1a] shrink-0">

            {/* Image preview + color dots */}
            {imagePreview && (
              <div className="relative inline-block mb-2.5">
                <img src={imagePreview} alt="ref" className="w-14 h-14 object-cover rounded-xl border border-white/10" />
                {uniqueColors.length > 0 && (
                  <div className="absolute -bottom-1 left-0 flex gap-0.5">
                    {uniqueColors.slice(0, 6).map((hex, i) => (
                      <div key={i} title={hex} className="w-2.5 h-2.5 rounded-sm border border-black/30"
                        style={{ backgroundColor: hex }} />
                    ))}
                  </div>
                )}
                <button onClick={() => { setImageFile(null); setImagePreview(""); setColors([]); }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-0 cursor-pointer leading-none">
                  ✕
                </button>
              </div>
            )}

            {/* Mode indicator */}
            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
              <span className="text-[10px] text-slate-700">Mode :</span>
              <span className={`text-[10px] font-semibold ${mode === "clone" ? "text-blue-400" : mode === "create" ? "text-violet-400" : "text-emerald-400"}`}>
                {currentMode.emoji} {currentMode.label}
              </span>
            </div>

            {/* Input row */}
            <div className="flex items-end gap-2 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2"
              onDrop={onDrop} onDragOver={e => e.preventDefault()}>

              {mode !== "web" && (
                <button onClick={() => fileRef.current?.click()} disabled={isLoading} title="Choisir une image"
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center text-base shrink-0 transition-all cursor-pointer ${imageFile ? "border-violet-500/50 bg-violet-500/15 text-violet-400" : "border-white/[0.08] bg-white/[0.02] text-slate-600 hover:text-slate-400"} ${isLoading ? "opacity-40 pointer-events-none" : ""}`}>
                  📁
                </button>
              )}

              <textarea ref={taRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={onKey} disabled={isLoading} rows={1}
                placeholder={mode === "clone" ? "Décris le clone à reproduire..." : mode === "create" ? "Décris l'interface à créer..." : "Pose ta question — recherche web réelle..."}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-sm text-slate-200 placeholder-slate-600 leading-relaxed min-h-[32px] font-[inherit] select-text" />

              <button onClick={sendMessage} disabled={isLoading || (!input.trim() && !imageFile)}
                className={`w-8 h-8 rounded-lg border-0 flex items-center justify-center text-sm font-bold shrink-0 transition-all ${(!input.trim() && !imageFile) || isLoading ? "bg-white/[0.04] text-slate-700 cursor-not-allowed" : `${currentMode.btn} text-white cursor-pointer`}`}>
                {isLoading ? "…" : "↑"}
              </button>
            </div>

            <input ref={fileRef} type="file" accept="image/*" onChange={onFileInput} className="hidden" />
          </div>
        </div>

        {/* ── PREVIEW ───────────────────────────────────────────────────────── */}
        <div className={`flex-1 flex flex-col bg-[#060608] ${activeTab === "chat" ? "hidden md:flex" : "flex"}`}
          onDrop={onDrop} onDragOver={e => e.preventDefault()}>

          {/* Preview topbar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-[#090910] shrink-0 gap-2">
            <span className="text-[11px] text-slate-600 truncate">
              {previewHtml ? `✅ ${(previewHtml.length / 1024).toFixed(1)} KB` : "Aperçu · Drop une image ici"}
            </span>
            {previewHtml && (
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => navigator.clipboard?.writeText(previewHtml)}
                  className="px-2.5 py-1 rounded-md text-[11px] border border-white/[0.08] bg-white/[0.02] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
                  📋 Copier
                </button>
                <button onClick={openInNewTab}
                  className="px-2.5 py-1 rounded-md text-[11px] border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:text-violet-300 transition-colors cursor-pointer font-medium">
                  ↗ Nouvel onglet
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 relative">
            {previewHtml ? (
              <iframe srcDoc={previewHtml} sandbox="allow-scripts allow-same-origin allow-forms"
                className="w-full h-full border-0 bg-white" title="Aperçu" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <div className="text-5xl opacity-[0.06]">🖥️</div>
                <p className="text-xs text-slate-700">L&apos;interface générée apparaîtra ici</p>
                <p className="text-[11px] text-slate-800 border border-dashed border-white/[0.04] rounded-xl px-4 py-2">
                  Drop une image pour l&apos;analyser
                </p>
              </div>
            )}

            {isLoading && loadingStep === "ux" && (
              <div className="absolute inset-0 bg-[#060608]/90 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div className="w-10 h-10 rounded-full border-2 border-white/[0.04] border-t-violet-500 animate-spin" />
                <p className="text-xs text-slate-500">Génération en cours...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
