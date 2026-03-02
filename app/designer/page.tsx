"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// =============================================================================
// TYPES
// =============================================================================

interface Message {
  role: "user" | "assistant";
  content: string;
  imagePreview?: string;
  mode?: "clone" | "create";
}

interface ColorSample {
  hex: string;
  frequency: number;
  zone: string;
}

// =============================================================================
// EXTRACTION COULEURS CANVAS
// =============================================================================

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
  for (const zone of zones) {
    const x0 = Math.round(zone.x0 * W), y0 = Math.round(zone.y0 * H);
    const w  = Math.max(Math.round((zone.x1 - zone.x0) * W), 1);
    const h  = Math.max(Math.round((zone.y1 - zone.y0) * H), 1);
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(x0, y0, w, h).data; } catch { continue; }
    const freq: Record<string, number> = {};
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.round(data[i]     / 32) * 32;
      const g = Math.round(data[i + 1] / 32) * 32;
      const b = Math.round(data[i + 2] / 32) * 32;
      const key = `${r},${g},${b}`;
      freq[key] = (freq[key] || 0) + 1;
    }
    Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([rgb, count]) => {
      const [r, g, b] = rgb.split(",").map(Number);
      const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
      results.push({ hex, frequency: count, zone: zone.name });
    });
  }
  return results;
}

// =============================================================================
// EXTRACTION HTML
// =============================================================================

function extractHtml(text: string): string {
  const m = text.match(/```html\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  const t = text.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) return t;
  return "";
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================

export default function DesignerPage() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState("");
  const [mode, setMode]               = useState<"clone" | "create">("create");
  const [isLoading, setIsLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState<"js" | "ux" | "">("");
  const [imageFile, setImageFile]     = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [colors, setColors]           = useState<ColorSample[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [activeTab, setActiveTab]     = useState<"chat" | "preview">("chat");
  const [streamBuffer, setStreamBuffer] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef   = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── Image select ────────────────────────────────────────────────────────────
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

  // ── Open in new tab ─────────────────────────────────────────────────────────
  const openInNewTab = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && !imageFile) || isLoading) return;

    const userMsg: Message = { role: "user", content: text, imagePreview: imagePreview || undefined, mode };
    const newMessages: Message[] = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStreamBuffer("");

    const historyForApi = newMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));

    try {
      // ── STEP 1 : JS Builder ─────────────────────────────────────────────────
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
        } catch { /* JS builder optional */ }
      }

      // ── STEP 2 : UX Designer ───────────────────────────────────────────────
      setLoadingStep("ux");
      setStreamBuffer("🎨 Génération de l'interface...");

      const uxForm = new FormData();
      uxForm.append("message", text);
      uxForm.append("history", JSON.stringify(historyForApi));
      uxForm.append("mode", mode);
      if (imageFile)         uxForm.append("image", imageFile);
      if (colors.length > 0) uxForm.append("colors", JSON.stringify(colors));
      if (jsOutput.trim())   uxForm.append("jsScripts", jsOutput);

      const uxResp = await fetch("/api/ux", { method: "POST", body: uxForm });
      if (!uxResp.ok || !uxResp.body) throw new Error(`UX API ${uxResp.status}`);

      const reader = uxResp.body.getReader();
      const dec    = new TextDecoder();
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
        content: finalHtml
          ? `✅ Interface générée — mode ${mode === "clone" ? "⚡ Clone" : "✦ Création"}`
          : full,
        mode,
      }]);
      if (finalHtml) setActiveTab("preview");

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

  // ── Unique colors preview ──────────────────────────────────────────────────
  const uniqueColors = [...new Set(colors.slice(0, 8).map(c => c.hex))];

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex flex-col h-dvh bg-[#09090f] text-slate-200 overflow-hidden font-sans">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-[#0c0c18] shrink-0 gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-sm font-bold">
            ✦
          </div>
          <span className="font-semibold text-sm tracking-tight hidden sm:block">AI Designer</span>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 gap-0.5">
          {(["clone", "create"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={[
                "px-3 py-1 rounded-md text-xs font-medium transition-all duration-150",
                mode === m
                  ? m === "clone"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-violet-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-300",
              ].join(" ")}
            >
              {m === "clone" ? "⚡ Clone" : "✦ Créer"}
            </button>
          ))}
        </div>

        {/* Tabs — mobile */}
        <div className="flex gap-1.5">
          {(["chat", "preview"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                "px-2.5 py-1 rounded-md text-xs font-medium border transition-all duration-150",
                activeTab === tab
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-300"
                  : "border-white/10 text-slate-500 hover:text-slate-400",
              ].join(" ")}
            >
              {tab === "chat" ? "💬 Chat" : "🖥️ Aperçu"}
            </button>
          ))}
        </div>
      </header>

      {/* ── BODY ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── CHAT ─────────────────────────────────────────────────────────── */}
        <div className={[
          "flex flex-col w-full md:max-w-[480px] border-r border-white/5 shrink-0",
          "md:flex",
          activeTab === "preview" ? "hidden" : "flex",
        ].join(" ")}>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scroll-smooth">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
                <div className="text-4xl opacity-20">✦</div>
                <p className="text-sm text-slate-500">Upload une image et décris ce que tu veux créer</p>
                <div className="flex flex-col gap-2 w-full max-w-xs text-xs text-slate-600">
                  <div className="px-3 py-2 bg-white/[0.03] border border-white/5 rounded-lg text-left">
                    <span className="text-blue-400 font-semibold">⚡ Clone</span> — reproduction pixel-perfect
                  </div>
                  <div className="px-3 py-2 bg-white/[0.03] border border-white/5 rounded-lg text-left">
                    <span className="text-violet-400 font-semibold">✦ Créer</span> — nouvelle interface inspirée
                  </div>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={["flex gap-2 items-start", msg.role === "user" ? "flex-row-reverse" : "flex-row"].join(" ")}
              >
                {/* Avatar */}
                <div className={[
                  "w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs",
                  msg.role === "user"
                    ? "bg-gradient-to-br from-blue-600 to-violet-600"
                    : "bg-gradient-to-br from-violet-600 to-pink-600",
                ].join(" ")}>
                  {msg.role === "user" ? "👤" : "✦"}
                </div>

                {/* Bubble */}
                <div className={[
                  "max-w-[80%] px-3 py-2.5 text-sm leading-relaxed border",
                  msg.role === "user"
                    ? "bg-white/5 border-white/10 rounded-[12px_4px_12px_12px]"
                    : "bg-[#0f0f1e] border-white/[0.07] rounded-[4px_12px_12px_12px]",
                ].join(" ")}>
                  {msg.imagePreview && (
                    <img src={msg.imagePreview} alt="ref" className="w-full max-w-[180px] rounded mb-2 block" />
                  )}
                  {msg.mode && (
                    <span className={[
                      "inline-block px-1.5 py-0 rounded text-[10px] font-bold mb-1.5",
                      msg.mode === "clone"
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-violet-500/20 text-violet-400",
                    ].join(" ")}>
                      {msg.mode === "clone" ? "⚡ CLONE" : "✦ CRÉATION"}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-2 items-start">
                <div className="w-7 h-7 rounded-full shrink-0 bg-gradient-to-br from-violet-600 to-pink-600 flex items-center justify-center text-xs animate-pulse">
                  ✦
                </div>
                <div className="max-w-[80%] bg-[#0f0f1e] border border-white/[0.07] rounded-[4px_12px_12px_12px] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {loadingStep === "js" && (
                      <>
                        <span className="animate-spin inline-block">⚙️</span>
                        <span>Construction JavaScript...</span>
                      </>
                    )}
                    {loadingStep === "ux" && (
                      <>
                        <span className="animate-spin inline-block">🎨</span>
                        <span>Génération interface...</span>
                      </>
                    )}
                  </div>
                  {streamBuffer && (
                    <p className="mt-1 text-[10px] text-slate-700 font-mono leading-tight line-clamp-3">
                      {streamBuffer.slice(-100)}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── INPUT ──────────────────────────────────────────────────────── */}
          <div className="px-3 pb-3 pt-2 border-t border-white/5 bg-[#0c0c18] shrink-0">

            {/* Image preview */}
            {imagePreview && (
              <div className="relative inline-block mb-2">
                <img
                  src={imagePreview}
                  alt="ref"
                  className="w-14 h-14 object-cover rounded-lg border border-white/10"
                />
                {/* Color dots */}
                {uniqueColors.length > 0 && (
                  <div className="absolute -bottom-1.5 left-0 flex gap-0.5">
                    {uniqueColors.slice(0, 5).map((hex, i) => (
                      <div
                        key={i}
                        title={hex}
                        className="w-2.5 h-2.5 rounded-sm border border-black/30"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setImageFile(null); setImagePreview(""); setColors([]); }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 border-none text-white text-[9px] font-bold flex items-center justify-center cursor-pointer leading-none"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Input row */}
            <div
              className="flex items-end gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
            >
              {/* Upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title="Ajouter une image"
                className={[
                  "w-8 h-8 rounded-lg border flex items-center justify-center text-base shrink-0 transition-all duration-150",
                  imageFile
                    ? "border-violet-500/50 bg-violet-500/15 text-violet-400"
                    : "border-white/10 bg-white/[0.03] text-slate-600 hover:text-slate-400",
                  isLoading ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                📎
              </button>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={1}
                placeholder={mode === "clone" ? "Upload + décris le clone..." : "Décris l'interface à créer..."}
                className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-slate-200 placeholder-slate-600 leading-relaxed min-h-[32px] font-sans"
              />

              {/* Send */}
              <button
                onClick={sendMessage}
                disabled={isLoading || (!input.trim() && !imageFile)}
                className={[
                  "w-8 h-8 rounded-lg border-none flex items-center justify-center text-base shrink-0 transition-all duration-150",
                  (!input.trim() && !imageFile) || isLoading
                    ? "bg-white/5 text-slate-700 cursor-not-allowed"
                    : mode === "clone"
                      ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                      : "bg-violet-600 hover:bg-violet-500 text-white cursor-pointer",
                ].join(" ")}
              >
                {isLoading ? "⏳" : "↑"}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        </div>

        {/* ── PREVIEW ─────────────────────────────────────────────────────── */}
        <div
          className={[
            "flex-1 flex flex-col bg-[#060608]",
            activeTab === "chat" ? "hidden md:flex" : "flex",
          ].join(" ")}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
        >
          {/* Preview topbar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#09090f] shrink-0 gap-2">
            <span className="text-[11px] text-slate-600 truncate">
              {previewHtml
                ? `✅ ${(previewHtml.length / 1024).toFixed(1)} KB généré`
                : "Aperçu · Drop une image ici"}
            </span>
            {previewHtml && (
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => navigator.clipboard?.writeText(previewHtml)}
                  className="px-2.5 py-1 rounded-md text-[11px] border border-white/10 bg-white/[0.03] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                >
                  📋 Copier
                </button>
                <button
                  onClick={openInNewTab}
                  className="px-2.5 py-1 rounded-md text-[11px] border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:text-violet-300 transition-colors cursor-pointer font-medium"
                >
                  ↗ Nouvel onglet
                </button>
              </div>
            )}
          </div>

          {/* iframe */}
          <div className="flex-1 relative">
            {previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                sandbox="allow-scripts allow-same-origin allow-forms"
                className="w-full h-full border-0 bg-white"
                title="Aperçu"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <div className="text-5xl opacity-10">🖥️</div>
                <p className="text-xs text-slate-700">L&apos;interface apparaîtra ici</p>
                <p className="text-[11px] text-slate-800 border border-dashed border-white/5 rounded-lg px-4 py-2">
                  Drop une image pour l&apos;analyser
                </p>
              </div>
            )}

            {/* Loading overlay */}
            {isLoading && loadingStep === "ux" && (
              <div className="absolute inset-0 bg-[#06060899] flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-white/5 border-t-violet-500 animate-spin" />
                <p className="text-xs text-slate-500">Génération en cours...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
