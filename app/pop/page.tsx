"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
  htmlCode?: string;
  imagePreview?: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeHtml, setActiveHtml] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "preview">("chat");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 140) + "px";
  }, [input]);

  const handleImageSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPendingImage({ file, preview: e.target?.result as string });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }, [handleImageSelect]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if ((!trimmed && !pendingImage) || loading) return;

    const userMessage: Message = {
      role: "user",
      content: trimmed || (pendingImage ? "Reproduis cette interface en HTML/CSS pixel-perfect." : ""),
      imagePreview: pendingImage?.preview,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    const imageCopy = pendingImage;
    setPendingImage(null);
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("message", userMessage.content);
      formData.append("history", JSON.stringify(
        messages.map((m) => ({ role: m.role, content: m.content }))
      ));
      if (imageCopy) {
        formData.append("image", imageCopy.file);
      }

      const res = await fetch("/api/chat", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || data.error) throw new Error(data.error ?? "Erreur serveur");

      const assistantMessage: Message = {
        role: "assistant",
        content: data.content,
        htmlCode: data.htmlCode ?? undefined,
      };

      setMessages([...updatedMessages, assistantMessage]);

      if (data.htmlCode) {
        setActiveHtml(data.htmlCode);
        setActiveTab("preview");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#0c0c10",
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
      color: "#e8e4de",
      overflow: "hidden",
    }}>
      {/* Header */}
      <header style={{
        padding: "0 24px",
        height: 52,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(12,12,16,0.98)",
        flexShrink: 0,
        zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#fff",
            boxShadow: "0 0 14px rgba(99,102,241,0.4)",
          }}>G</div>
          <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#d0ccc5" }}>
            UI Cloner
          </span>
          <span style={{
            fontSize: "0.58rem", background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8",
            padding: "2px 7px", borderRadius: 4, fontWeight: 700,
            letterSpacing: "0.08em", fontFamily: "monospace",
          }}>
            gemini-3-flash-preview
          </span>
        </div>

        {/* Tabs mobile */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["chat", "preview"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                fontSize: "0.72rem",
                fontWeight: 600,
                cursor: "pointer",
                background: activeTab === tab ? "rgba(99,102,241,0.2)" : "transparent",
                color: activeTab === tab ? "#818cf8" : "#404055",
                transition: "all 0.18s",
                letterSpacing: "0.04em",
              }}
            >
              {tab === "chat" ? "Chat" : "Preview"}
              {tab === "preview" && activeHtml && (
                <span style={{
                  marginLeft: 5, width: 6, height: 6,
                  borderRadius: "50%", background: "#22c55e",
                  display: "inline-block", verticalAlign: "middle",
                  boxShadow: "0 0 6px #22c55e",
                }} />
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setMessages([]); setActiveHtml(null); setError(null); setActiveTab("chat"); }}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 6, color: "#404055", fontSize: "0.68rem",
            padding: "4px 10px", cursor: "pointer", fontFamily: "monospace",
          }}
        >
          Reset
        </button>
      </header>

      {/* Body : split layout */}
      <div style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
      }}>
        {/* LEFT — Chat panel */}
        <div style={{
          width: activeHtml ? "42%" : "100%",
          display: activeTab === "preview" && activeHtml ? "none" : "flex",
          flexDirection: "column",
          borderRight: activeHtml ? "1px solid rgba(255,255,255,0.05)" : "none",
          transition: "width 0.3s",
          minWidth: 0,
        }}>
          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto",
            padding: "20px 0",
            display: "flex", flexDirection: "column",
          }}>
            {messages.length === 0 && !loading && (
              <div style={{
                margin: "auto", textAlign: "center", padding: "0 28px",
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16, margin: "0 auto 18px",
                  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 800, color: "#fff",
                  boxShadow: "0 0 30px rgba(99,102,241,0.3)",
                }}>G</div>
                <div style={{ fontSize: "1rem", color: "#2a2a3e", fontWeight: 600, marginBottom: 10 }}>
                  Clone une interface UI
                </div>
                <div style={{
                  fontSize: "0.75rem", color: "#1e1e2e",
                  lineHeight: 1.8, fontFamily: "monospace",
                }}>
                  📎 Uploade une image<br />
                  🧠 Gemini analyse pixel par pixel<br />
                  ⚡ HTML/CSS généré + prévisualisation
                </div>
              </div>
            )}

            <div style={{
              maxWidth: 640, width: "100%", margin: "0 auto",
              padding: "0 14px", display: "flex", flexDirection: "column", gap: 16,
            }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex", gap: 10,
                  flexDirection: msg.role === "user" ? "row-reverse" : "row",
                  alignItems: "flex-start",
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700,
                    background: msg.role === "user"
                      ? "rgba(255,255,255,0.04)"
                      : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                    border: msg.role === "user" ? "1px solid rgba(255,255,255,0.07)" : "none",
                    color: msg.role === "user" ? "#404055" : "#fff",
                    boxShadow: msg.role === "assistant" ? "0 0 10px rgba(99,102,241,0.3)" : "none",
                  }}>
                    {msg.role === "user" ? "U" : "G"}
                  </div>

                  <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6 }}>
                    {/* Image preview si uploadée */}
                    {msg.imagePreview && (
                      <img
                        src={msg.imagePreview}
                        alt="uploaded"
                        style={{
                          maxWidth: 200, maxHeight: 140, borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.08)",
                          objectFit: "cover",
                        }}
                      />
                    )}

                    <div style={{
                      background: msg.role === "user"
                        ? "rgba(255,255,255,0.03)"
                        : "rgba(99,102,241,0.06)",
                      border: msg.role === "user"
                        ? "1px solid rgba(255,255,255,0.06)"
                        : "1px solid rgba(99,102,241,0.15)",
                      borderRadius: msg.role === "user" ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                      padding: "10px 14px",
                      fontSize: "0.84rem", lineHeight: 1.7, color: "#c0bbb0",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {/* Afficher seulement le texte, pas le bloc HTML brut */}
                      {msg.htmlCode
                        ? msg.content.replace(/```html[\s\S]*?```/gi, "").trim() ||
                          "✅ HTML généré — voir la prévisualisation →"
                        : msg.content}
                    </div>

                    {/* Bouton voir le preview si HTML dispo */}
                    {msg.htmlCode && (
                      <button
                        onClick={() => { setActiveHtml(msg.htmlCode!); setActiveTab("preview"); }}
                        style={{
                          alignSelf: "flex-start",
                          background: "rgba(99,102,241,0.12)",
                          border: "1px solid rgba(99,102,241,0.25)",
                          borderRadius: 6, padding: "5px 12px",
                          color: "#818cf8", fontSize: "0.7rem",
                          cursor: "pointer", fontWeight: 600,
                          letterSpacing: "0.03em",
                          transition: "all 0.18s",
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.22)"}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.12)"}
                      >
                        Voir le preview →
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: 8, flexShrink: 0, marginTop: 2,
                    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#fff",
                  }}>G</div>
                  <div style={{
                    background: "rgba(99,102,241,0.06)",
                    border: "1px solid rgba(99,102,241,0.15)",
                    borderRadius: "4px 14px 14px 14px",
                    padding: "12px 16px", display: "flex", gap: 5, alignItems: "center",
                  }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: "#6366f1", display: "inline-block",
                        animation: `bounce 1.1s ease-in-out ${i * 0.16}s infinite`,
                      }} />
                    ))}
                    <span style={{ fontSize: "0.72rem", color: "#404055", marginLeft: 8, fontFamily: "monospace" }}>
                      Analyse pixel par pixel…
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 8, padding: "8px 14px", color: "#f87171",
                  fontSize: "0.75rem", fontFamily: "monospace",
                }}>
                  ⚠ {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input zone */}
          <div
            style={{
              padding: "10px 14px 14px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(12,12,16,0.98)",
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {/* Pending image preview */}
            {pendingImage && (
              <div style={{
                marginBottom: 8, position: "relative", display: "inline-block",
              }}>
                <img
                  src={pendingImage.preview}
                  alt="À envoyer"
                  style={{
                    height: 56, width: "auto", borderRadius: 6,
                    border: "1px solid rgba(99,102,241,0.3)",
                  }}
                />
                <button
                  onClick={() => setPendingImage(null)}
                  style={{
                    position: "absolute", top: -6, right: -6,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "#ef4444", border: "none", color: "#fff",
                    fontSize: 10, cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                  }}
                >×</button>
              </div>
            )}

            <div style={{
              display: "flex", gap: 8, alignItems: "flex-end",
              background: dragOver ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)",
              border: dragOver
                ? "1px solid rgba(99,102,241,0.4)"
                : "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "8px 10px",
              transition: "all 0.18s",
            }}>
              {/* Upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Uploader une image"
                style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  color: "#6366f1", cursor: "pointer", fontSize: 16,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.18s",
                }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.2)"}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.1)"}
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageSelect(f);
                  e.target.value = "";
                }}
              />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingImage
                  ? "Instrucions spécifiques ou Entrée pour cloner…"
                  : "Colle une image ou écris un message…"
                }
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none",
                  outline: "none", color: "#e8e4de", fontSize: "0.86rem",
                  fontFamily: "inherit", lineHeight: 1.6, resize: "none",
                  minHeight: 32, maxHeight: 140, paddingTop: 4,
                }}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData.items);
                  const imgItem = items.find(i => i.type.startsWith("image/"));
                  if (imgItem) {
                    const file = imgItem.getAsFile();
                    if (file) handleImageSelect(file);
                  }
                }}
              />

              <button
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !pendingImage)}
                style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: loading || (!input.trim() && !pendingImage)
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                  border: "none",
                  color: loading || (!input.trim() && !pendingImage) ? "#2a2a3a" : "#fff",
                  fontSize: 16, cursor: loading || (!input.trim() && !pendingImage) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.18s",
                  boxShadow: loading || (!input.trim() && !pendingImage)
                    ? "none"
                    : "0 0 12px rgba(99,102,241,0.4)",
                }}
              >↑</button>
            </div>

            <div style={{
              marginTop: 5, fontSize: "0.62rem", color: "#1e1e2e",
              fontFamily: "monospace", textAlign: "center", letterSpacing: "0.04em",
            }}>
              📎 Glisser-déposer · Ctrl+V pour coller · Entrée pour envoyer
            </div>
          </div>
        </div>

        {/* RIGHT — Preview panel */}
        {activeHtml && (
          <div style={{
            flex: 1,
            display: activeTab === "chat" ? "none" : "flex",
            flexDirection: "column",
            background: "#f8f8f8",
            position: "relative",
            minWidth: 0,
          }}>
            {/* Preview toolbar */}
            <div style={{
              height: 40, background: "#1a1a24",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center",
              padding: "0 14px", gap: 10, flexShrink: 0,
            }}>
              <div style={{ display: "flex", gap: 5 }}>
                {["#ef4444", "#f59e0b", "#22c55e"].map((c, i) => (
                  <div key={i} style={{
                    width: 10, height: 10, borderRadius: "50%", background: c,
                  }} />
                ))}
              </div>
              <div style={{
                flex: 1, background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 5, padding: "2px 10px",
                fontSize: "0.65rem", color: "#404055", fontFamily: "monospace",
              }}>
                preview — HTML/CSS pixel-perfect
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    "```html\n" + activeHtml + "\n```"
                  );
                }}
                style={{
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 5, padding: "3px 10px",
                  color: "#6366f1", fontSize: "0.65rem",
                  cursor: "pointer", fontFamily: "monospace",
                }}
              >
                Copier HTML
              </button>
            </div>

            {/* iframe */}
            <iframe
              key={activeHtml}
              srcDoc={activeHtml}
              style={{
                flex: 1, border: "none", width: "100%",
                background: "#fff",
              }}
              sandbox="allow-scripts allow-same-origin"
              title="Preview pixel-perfect"
            />

            {/* Back to chat on mobile */}
            <button
              onClick={() => setActiveTab("chat")}
              style={{
                position: "absolute", bottom: 16, left: 16,
                background: "rgba(12,12,16,0.85)",
                border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 8, padding: "6px 14px",
                color: "#818cf8", fontSize: "0.72rem",
                cursor: "pointer", backdropFilter: "blur(8px)",
              }}
            >
              ← Chat
            </button>
          </div>
        )}

        {/* Placeholder preview quand pas encore de HTML */}
        {!activeHtml && activeTab === "preview" && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#0e0e14", color: "#1e1e2e",
            flexDirection: "column", gap: 12, fontFamily: "monospace",
          }}>
            <div style={{ fontSize: "2rem" }}>🖼️</div>
            <div style={{ fontSize: "0.78rem" }}>
              Envoie une image pour voir la prévisualisation ici
            </div>
          </div>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 2px; }
        textarea::placeholder { color: #252535; }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }

        /* Split visible sur desktop */
        @media (min-width: 900px) {
          .left-panel { display: flex !important; }
          .right-panel { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
