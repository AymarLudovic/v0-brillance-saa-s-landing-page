"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type AppMode = "clone" | "create" | "web";

interface SearchMeta {
  queries: string[];
  chunks: { title: string; uri: string }[];
  supports: { text: string; indices: number[] }[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  mode?: AppMode;
  searchMeta?: SearchMeta;
}

interface ColorSample {
  hex: string;
  frequency: number;
  zone: string;
}

function extractColors(img: HTMLImageElement): ColorSample[] {
  const canvas = document.createElement("canvas");
  const MAX = 400;
  const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 1);
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  const zones = [
    { name: "header-top", x0: 0, y0: 0, x1: 1, y1: 0.13 },
    { name: "coin-haut-gauche", x0: 0, y0: 0, x1: 0.22, y1: 0.13 },
    { name: "sidebar-gauche", x0: 0, y0: 0.13, x1: 0.22, y1: 0.87 },
    { name: "contenu-principal", x0: 0.22, y0: 0.13, x1: 0.78, y1: 0.87 },
    { name: "milieu-centre", x0: 0.28, y0: 0.25, x1: 0.72, y1: 0.75 },
    { name: "colonne-droite", x0: 0.78, y0: 0.13, x1: 1, y1: 0.87 },
    { name: "bas-page", x0: 0, y0: 0.87, x1: 1, y1: 1 },
  ];
  const results: ColorSample[] = [];
  for (const zone of zones) {
    const x0 = Math.round(zone.x0 * W), y0 = Math.round(zone.y0 * H);
    const w = Math.max(Math.round((zone.x1 - zone.x0) * W), 1);
    const h = Math.max(Math.round((zone.y1 - zone.y0) * H), 1);
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(x0, y0, w, h).data; } catch { continue; }
    const freq: Record<string, number> = {};
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.round(data[i] / 32) * 32;
      const g = Math.round(data[i + 1] / 32) * 32;
      const b = Math.round(data[i + 2] / 32) * 32;
      freq[`${r},${g},${b}`] = (freq[`${r},${g},${b}`] || 0) + 1;
    }
    Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([rgb, count]) => {
      const [r, g, b] = rgb.split(",").map(Number);
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      results.push({ hex, frequency: count, zone: zone.name });
    });
  }
  return results;
}

function extractHtml(text: string): string {
  const m = text.match(/```html\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  const t = text.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) return t;
  return "";
}

function parseSearchResponse(raw: string): { text: string; meta: SearchMeta | null } {
  const metaMatch = raw.match(/\[SEARCH_META\]([\s\S]*?)\[\/SEARCH_META\]/);
  if (!metaMatch) return { text: raw, meta: null };
  try {
    const meta: SearchMeta = JSON.parse(metaMatch[1]);
    const text = raw.replace(/\n?\[SEARCH_META\][\s\S]*?\[\/SEARCH_META\]/, "").trim();
    return { text, meta };
  } catch { return { text: raw, meta: null }; }
}

function getDomain(uri: string): string {
  try { return new URL(uri).hostname.replace("www.", ""); } catch { return uri; }
}

function SearchActivity({ queries, visitedCount }: { queries: string[]; visitedCount: number }) {
  return (
    <div className="mt-2 space-y-1.5">
      {queries.map((q, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-3 h-3 rounded-full border border-emerald-500/60 flex items-center justify-center shrink-0">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          </span>
          <span className="text-slate-500">Recherche :</span>
          <span className="text-emerald-400 font-medium truncate">&ldquo;{q}&rdquo;</span>
        </div>
      ))}
      {visitedCount > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="w-3 h-3 rounded border border-sky-500/40 flex items-center justify-center shrink-0 text-[7px] text-sky-500">✓</span>
          <span>{visitedCount} source{visitedCount > 1 ? "s" : ""} consultée{visitedCount > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

function SourceCards({ chunks }: { chunks: SearchMeta["chunks"] }) {
  if (!chunks.length) return null;
  return (
    <div className="mt-3 space-y-1">
      <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider">Sources</p>
      {chunks.map((c, i) => (
        <a key={i} href={c.uri} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-sky-500/30 hover:bg-sky-500/5 transition-all group block no-underline">
          <img src={`https://www.google.com/s2/favicons?domain=${getDomain(c.uri)}&sz=32`} alt="" className="w-4 h-4 rounded shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-300 truncate group-hover:text-sky-300 transition-colors">{c.title || getDomain(c.uri)}</p>
            <p className="text-[10px] text-slate-600 truncate">{getDomain(c.uri)}</p>
          </div>
          <span className="text-slate-700 group-hover:text-sky-500 text-xs transition-colors shrink-0">↗</span>
        </a>
      ))}
    </div>
  );
}

export default function DesignerPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AppMode>("create");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<"js" | "ux" | "web" | "">("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [colors, setColors] = useState<ColorSample[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"chat" | "preview">("chat");
  const [streamBuffer, setStreamBuffer] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streamBuffer]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setImagePreview(url);
      const img = new Image();
      img.onload = () => setColors(extractColors(img));
      img.src = url;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleImageSelect(f);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleImageSelect(f);
  };

  const openInNewTab = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageFile) || isLoading) return;
    const userMsg: Message = { role: "user", content: text, imagePreview: imagePreview || undefined, mode };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStreamBuffer("");
    const historyForApi = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      if (mode === "web") {
        setLoadingStep("web");
        const webForm = new FormData();
        webForm.append("message", text);
        webForm.append("history", JSON.stringify(historyForApi));
        if (imageFile) webForm.append("image", imageFile);
        const webResp = await fetch("/api/web", { method: "POST", body: webForm });
        if (!webResp.ok || !webResp.body) throw new Error(`Web API ${webResp.status}`);
        const reader = webResp.body.getReader();
        const dec = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value);
          setStreamBuffer(full.replace(/\[SEARCH_META\][\s\S]*?\[\/SEARCH_META\]/, "").slice(-400));
        }
        const { text: cleanText, meta } = parseSearchResponse(full);
        setMessages(prev => [...prev, { role: "assistant", content: cleanText, mode: "web", searchMeta: meta || undefined }]);
      } else {
        let jsOutput = "";
        if (text.length > 10) {
          setLoadingStep("js");
          const jsForm = new FormData();
          jsForm.append("message", text);
          jsForm.append("history", JSON.stringify(historyForApi));
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
                setStreamBuffer("⚙️ " + jsOutput.slice(-150));
              }
            }
          } catch { /* optional */ }
        }
        setLoadingStep("ux");
        setStreamBuffer("🎨 Génération...");
        const uxForm = new FormData();
        uxForm.append("message", text);
        uxForm.append("history", JSON.stringify(historyForApi));
        uxForm.append("mode", mode);
        if (imageFile) uxForm.append("image", imageFile);
        if (colors.length > 0) uxForm.append("colors", JSON.stringify(colors));
        if (jsOutput.trim()) uxForm.append("jsScripts", jsOutput);
        const uxResp = await fetch("/api/ux", { method: "POST", body: uxForm });
        if (!uxResp.ok || !uxResp.body) throw new Error(`UX API ${uxResp.status}`);
        const reader = uxResp.body.getReader();
        const dec = new TextDecoder();
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += dec.decode(value);
          const html = extractHtml(full);
          if (html) { setPreviewHtml(html); setActiveTab("preview"); }
          setStreamBuffer(full.slice(-200));
        }
        const finalHtml = extractHtml(full);
        if (finalHtml) setPreviewHtml(finalHtml);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: finalHtml ? `✅ Interface générée — ${mode === "clone" ? "⚡ Clone" : "✦ Création"}` : full,
          mode,
        }]);
        if (finalHtml) setActiveTab("preview");
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `❌ ${err.message}` }]);
    } finally {
      setIsLoading(false);
      setLoadingStep("");
      setStreamBuffer("");
      setImageFile(null);
      setImagePreview("");
      setColors([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const uniqueColors = [...new Set(colors.slice(0, 8).map(c => c.hex))];

  const modes = [
    { id: "clone" as AppMode,  emoji: "⚡", label: "Clone",   desc: "Pixel-perfect",     activeClass: "bg-blue-600 text-white shadow-sm" },
    { id: "create" as AppMode, emoji: "✦",  label: "Créer",   desc: "Nouvelle interface", activeClass: "bg-violet-600 text-white shadow-sm" },
    { id: "web" as AppMode,    emoji: "🔍", label: "Web",     desc: "Recherche réelle",   activeClass: "bg-emerald-600 text-white shadow-sm" },
  ];

  const currentMode = modes.find(m => m.id === mode)!;

  return (
    <div className="flex flex-col h-dvh bg-[#09090f] text-slate-200 overflow-hidden" >

      {/* HEADER */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0c0c18] shrink-0 gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-sm font-bold select-none">✦</div>
          <span className="font-semibold text-sm tracking-tight text-slate-100 hidden sm:block">AI Designer</span>
        </div>

        <div className="flex bg-white/[0.04] border border-white/[0.08] rounded-xl p-0.5 gap-0.5">
          {modes.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} title={m.desc}
              className={["px-3 py-1 rounded-[9px] text-xs font-medium transition-all duration-150 flex items-center gap-1",
                mode === m.id ? m.activeClass : "text-slate-500 hover:text-slate-300"].join(" ")}>
              <span>{m.emoji}</span><span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {(["chat", "preview"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={["px-2.5 py-1 rounded-md text-xs font-medium border transition-all duration-150",
                activeTab === tab ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "border-white/[0.08] text-slate-500 hover:text-slate-400"].join(" ")}>
              {tab === "chat" ? "💬" : "🖥️"} <span className="hidden sm:inline">{tab === "chat" ? "Chat" : "Aperçu"}</span>
            </button>
          ))}
        </div>
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">

        {/* CHAT */}
        <div className={["flex flex-col w-full md:w-[460px] md:max-w-[460px] border-r border-white/[0.06] shrink-0",
          activeTab === "preview" ? "hidden md:flex" : "flex"].join(" ")}>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600/20 to-blue-600/20 border border-violet-500/20 flex items-center justify-center text-2xl">✦</div>
                <div>
                  <p className="text-sm font-medium text-slate-400 mb-1">AI Designer Studio</p>
                  <p className="text-xs text-slate-600">Upload une image et décris ce que tu veux créer</p>
                </div>
                <div className="w-full max-w-xs space-y-1.5">
                  {modes.map(m => (
                    <button key={m.id} onClick={() => setMode(m.id)}
                      className={["w-full px-3 py-2.5 text-left rounded-xl border transition-all text-xs",
                        mode === m.id ? "border-violet-500/30 bg-violet-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"].join(" ")}>
                      <span className="mr-1.5">{m.emoji}</span>
                      <span className={mode === m.id ? "text-slate-200 font-medium" : "text-slate-500"}>{m.label}</span>
                      <span className="text-slate-600 ml-1">— {m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={["flex gap-2 items-start", msg.role === "user" ? "flex-row-reverse" : "flex-row"].join(" ")}>
                <div className={["w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold",
                  msg.role === "user" ? "bg-gradient-to-br from-blue-600 to-violet-600" :
                  msg.mode === "web" ? "bg-gradient-to-br from-emerald-600 to-teal-600" :
                  "bg-gradient-to-br from-violet-600 to-pink-600"].join(" ")}>
                  {msg.role === "user" ? "U" : msg.mode === "web" ? "🔍" : "✦"}
                </div>
                <div className={["max-w-[82%] px-3 py-2.5 text-sm leading-relaxed border",
                  msg.role === "user" ? "bg-white/[0.04] border-white/[0.08] rounded-[12px_4px_12px_12px]" :
                  "bg-[#0f0f1e] border-white/[0.06] rounded-[4px_12px_12px_12px]"].join(" ")}>
                  {msg.imagePreview && <img src={msg.imagePreview} alt="ref" className="w-full max-w-[180px] rounded-lg mb-2 block opacity-90" />}
                  {msg.mode && (
                    <span className={["inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold mb-1.5",
                      msg.mode === "clone" ? "bg-blue-500/15 text-blue-400" :
                      msg.mode === "create" ? "bg-violet-500/15 text-violet-400" :
                      "bg-emerald-500/15 text-emerald-400"].join(" ")}>
                      {modes.find(m => m.id === msg.mode)?.emoji} {msg.mode.toUpperCase()}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-slate-300">{msg.content}</p>
                  {msg.searchMeta && (
                    <div className="mt-2 pt-2 border-t border-white/[0.06]">
                      <SearchActivity queries={msg.searchMeta.queries} visitedCount={msg.searchMeta.chunks.length} />
                      <SourceCards chunks={msg.searchMeta.chunks} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2 items-start">
                <div className={["w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold animate-pulse",
                  loadingStep === "web" ? "bg-gradient-to-br from-emerald-600 to-teal-600" : "bg-gradient-to-br from-violet-600 to-pink-600"].join(" ")}>
                  {loadingStep === "web" ? "🔍" : "✦"}
                </div>
                <div className="bg-[#0f0f1e] border border-white/[0.06] rounded-[4px_12px_12px_12px] px-3 py-2.5 max-w-[82%]">
                  {loadingStep === "web" && (
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                        <span className="w-3 h-3 rounded-full border-2 border-emerald-500/50 border-t-emerald-500 animate-spin shrink-0" />
                        <span>Recherche web en cours...</span>
                      </div>
                      {streamBuffer && (
                        <p className="text-[11px] text-slate-500 leading-relaxed whitespace-pre-wrap line-clamp-5">{streamBuffer.slice(-300)}</p>
                      )}
                    </div>
                  )}
                  {loadingStep === "js" && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-full border-2 border-amber-500/50 border-t-amber-500 animate-spin shrink-0" />
                      <span>Construction JavaScript...</span>
                    </div>
                  )}
                  {loadingStep === "ux" && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="w-3 h-3 rounded-full border-2 border-violet-500/50 border-t-violet-500 animate-spin shrink-0" />
                      <span>Génération de l&apos;interface...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* INPUT */}
          <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] bg-[#0c0c18] shrink-0">
            {imagePreview && (
              <div className="relative inline-block mb-2">
                <img src={imagePreview} alt="ref" className="w-14 h-14 object-cover rounded-xl border border-white/10 block" />
                {uniqueColors.length > 0 && (
                  <div className="absolute -bottom-1.5 left-0 flex gap-0.5">
                    {uniqueColors.slice(0, 5).map((hex, i) => (
                      <div key={i} title={hex} className="w-2.5 h-2.5 rounded-sm border border-black/30" style={{ backgroundColor: hex }} />
                    ))}
                  </div>
                )}
                <button onClick={() => { setImageFile(null); setImagePreview(""); setColors([]); }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center cursor-pointer border-none leading-none">✕</button>
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
              <span className="text-[10px] text-slate-700">Modo :</span>
              <span className={["text-[10px] font-semibold",
                mode === "clone" ? "text-blue-400" : mode === "create" ? "text-violet-400" : "text-emerald-400"].join(" ")}>
                {currentMode.emoji} {currentMode.label}
              </span>
            </div>

            <div className="flex items-end gap-2 bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2"
              onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
              {mode !== "web" && (
                <button onClick={() => fileInputRef.current?.click()} disabled={isLoading}
                  title="Choisir une image depuis vos fichiers"
                  className={["w-8 h-8 rounded-lg border flex items-center justify-center text-base shrink-0 transition-all duration-150",
                    imageFile ? "border-violet-500/50 bg-violet-500/15 text-violet-400" : "border-white/[0.08] bg-white/[0.02] text-slate-600 hover:text-slate-400",
                    isLoading ? "opacity-40 cursor-not-allowed" : "cursor-pointer"].join(" ")}>
                  📁
                </button>
              )}
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} disabled={isLoading} rows={1}
                placeholder={mode === "clone" ? "Décris le clone à reproduire..." : mode === "create" ? "Décris l'interface à créer..." : "Pose ta question — recherche web réelle..."}
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-slate-200 placeholder-slate-600 leading-relaxed min-h-[32px]"
                 />
              <button onClick={sendMessage} disabled={isLoading || (!input.trim() && !imageFile)}
                className={["w-8 h-8 rounded-lg border-none flex items-center justify-center text-sm font-bold shrink-0 transition-all duration-150",
                  (!input.trim() && !imageFile) || isLoading ? "bg-white/[0.04] text-slate-700 cursor-not-allowed" :
                  mode === "clone" ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer" :
                  mode === "create" ? "bg-violet-600 hover:bg-violet-500 text-white cursor-pointer" :
                  "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"].join(" ")}>
                {isLoading ? "…" : "↑"}
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileInput} className="hidden" />
          </div>
        </div>

        {/* PREVIEW */}
        <div className={["flex-1 flex flex-col bg-[#060608]", activeTab === "chat" ? "hidden md:flex" : "flex"].join(" ")}
          onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-[#09090f] shrink-0 gap-2">
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
              <div className="absolute inset-0 bg-[#060608]/90 flex flex-col items-center justify-center gap-3">
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
