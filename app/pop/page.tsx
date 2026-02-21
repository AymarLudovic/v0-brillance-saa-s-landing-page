"use client";
import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
  imageUrl?: string;
  html?: string;
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string } | null>(null);
  const [iframeHtml, setIframeHtml] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "preview">("chat");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    if (loading || (!input.trim() && !pendingImage)) return;

    const userText = input.trim() || "Clone cette interface en HTML/CSS pixel-perfect.";
    const userMsg: Message = { role: "user", text: userText, imageUrl: pendingImage?.url };
    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const imgToSend = pendingImage;
    setPendingImage(null);
    setLoading(true);

    try {
      const fd = new FormData();
      fd.append("message", userText);
      fd.append("history", JSON.stringify(history));
      if (imgToSend) fd.append("image", imgToSend.file);

      const res = await fetch("/api/chat", { method: "POST", body: fd });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const assistantMsg: Message = {
        role: "assistant",
        text: data.content,
        html: data.htmlCode,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (data.htmlCode) {
        setIframeHtml(data.htmlCode);
      }
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : "Erreur inconnue";
      setMessages((prev) => [...prev, { role: "assistant", text: `❌ ${errorText}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100svh", display: "flex", flexDirection: "column", background: "#111117", color: "#e2ddd6", fontFamily: "system-ui, sans-serif" }}>

      {/* HEADER */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #222230", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          🖼 UI Cloner{" "}
          <span style={{ fontWeight: 400, fontSize: "0.65rem", color: "#44445a", fontFamily: "monospace" }}>gemini-3-flash-preview</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setView("chat")}
            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: view === "chat" ? "#6366f1" : "#1e1e2e", color: view === "chat" ? "#fff" : "#555", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600 }}
          >Chat</button>
          <button
            onClick={() => setView("preview")}
            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: view === "preview" ? "#6366f1" : "#1e1e2e", color: view === "preview" ? "#fff" : iframeHtml ? "#818cf8" : "#555", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600 }}
          >Preview {iframeHtml ? "●" : ""}</button>
        </div>
      </div>

      {/* PREVIEW */}
      {view === "preview" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {iframeHtml
            ? <iframe srcDoc={iframeHtml} style={{ flex: 1, border: "none", width: "100%", background: "#fff" }} sandbox="allow-scripts allow-same-origin" />
            : <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#33334a", fontSize: "0.85rem" }}>Aucun HTML généré. Envoie une image d'abord.</div>
          }
          {iframeHtml && (
            <div style={{ padding: "8px 12px", borderTop: "1px solid #222230", display: "flex", gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(iframeHtml)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #6366f1", background: "rgba(99,102,241,0.1)", color: "#818cf8", cursor: "pointer", fontSize: "0.78rem" }}>Copier le HTML</button>
            </div>
          )}
        </div>
      )}

      {/* CHAT */}
      {view === "chat" && (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>

            {messages.length === 0 && (
              <div style={{ margin: "auto", textAlign: "center", color: "#2a2a3e", lineHeight: 2, fontSize: "0.82rem" }}>
                📎 Uploade une image d'interface<br />
                Gemini va la cloner en HTML/CSS<br />
                Prévisualisation dans l'onglet Preview
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>

                <div style={{ fontSize: "0.6rem", color: "#33334a", fontFamily: "monospace" }}>
                  {msg.role === "user" ? "Vous" : "Gemini"}
                </div>

                {msg.imageUrl && (
                  <img src={msg.imageUrl} alt="" style={{ maxWidth: 200, maxHeight: 130, borderRadius: 8, border: "1px solid #333344", objectFit: "cover" }} />
                )}

                <div style={{
                  maxWidth: "88%",
                  padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "14px 3px 14px 14px" : "3px 14px 14px 14px",
                  background: msg.role === "user" ? "#1a1a2e" : "#161622",
                  border: `1px solid ${msg.role === "user" ? "#2a2a42" : "#252538"}`,
                  fontSize: "0.84rem",
                  lineHeight: 1.75,
                  color: "#ccc8be",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {msg.html
                    ? msg.text.replace(/```html[\s\S]*?```/gi, "").trim() || "✅ HTML/CSS généré avec succès"
                    : msg.text
                  }
                </div>

                {msg.html && (
                  <button
                    onClick={() => { setIframeHtml(msg.html!); setView("preview"); }}
                    style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.1)", color: "#818cf8", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600 }}
                  >
                    Voir la prévisualisation →
                  </button>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                <div style={{ fontSize: "0.6rem", color: "#33334a", fontFamily: "monospace" }}>Gemini</div>
                <div style={{ padding: "12px 16px", borderRadius: "3px 14px 14px 14px", background: "#161622", border: "1px solid #252538", display: "flex", gap: 5, alignItems: "center" }}>
                  {[0, 1, 2].map((k) => (
                    <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: "#6366f1", display: "inline-block", animation: `dot 1.2s ease-in-out ${k * 0.2}s infinite` }} />
                  ))}
                  <span style={{ fontSize: "0.72rem", color: "#44445a", marginLeft: 8, fontFamily: "monospace" }}>Analyse en cours…</span>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* INPUT BAR */}
          <div style={{ padding: "10px 12px 20px", borderTop: "1px solid #222230", flexShrink: 0, background: "#111117" }}>
            {pendingImage && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <img src={pendingImage.url} alt="" style={{ height: 54, width: "auto", borderRadius: 7, border: "1px solid rgba(99,102,241,0.35)", objectFit: "cover" }} />
                <span style={{ fontSize: "0.7rem", color: "#6366f1", fontFamily: "monospace" }}>Image prête</span>
                <button onClick={() => setPendingImage(null)} style={{ marginLeft: "auto", background: "#ef4444", border: "none", borderRadius: "50%", width: 22, height: 22, color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button
                onClick={() => fileRef.current?.click()}
                style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >📎</button>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingImage({ file: f, url: URL.createObjectURL(f) }); e.target.value = ""; }} />

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={pendingImage ? "Instructions (optionnel)…" : "Message ou image…"}
                rows={1}
                style={{ flex: 1, background: "#1a1a28", border: "1px solid #2a2a3e", borderRadius: 10, padding: "11px 13px", color: "#e2ddd6", fontSize: "0.86rem", fontFamily: "system-ui,sans-serif", resize: "none", outline: "none", minHeight: 44, maxHeight: 120, lineHeight: 1.6 }}
              />

              <button
                onClick={send}
                disabled={loading || (!input.trim() && !pendingImage)}
                style={{ width: 44, height: 44, borderRadius: 10, border: "none", background: (!loading && (input.trim() || pendingImage)) ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#1e1e2e", color: (!loading && (input.trim() || pendingImage)) ? "#fff" : "#333", fontSize: 20, cursor: (!loading && (input.trim() || pendingImage)) ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >↑</button>
            </div>
          </div>
        </>
      )}

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        textarea::placeholder { color: #2a2a3e; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #222230; border-radius: 2px; }
        @keyframes dot {
          0%, 100% { opacity: 0.3; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
                                   }
