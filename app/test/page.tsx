"use client";

import { useState, useRef, useEffect, FormEvent } from "react";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const sendMessage = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Erreur serveur");
      }

      if (data.model) setActiveModel(data.model);

      setMessages([
        ...newMessages,
        { role: "assistant", content: data.content },
      ]);
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

  const modelLabel = activeModel
    ? activeModel === "gemini-3-pro-preview"
      ? "Gemini 3 Pro"
      : "Gemini 2.5 Pro"
    : "Gemini 3 Pro";

  const isGemini3 = !activeModel || activeModel === "gemini-3-pro-preview";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#08090d",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
      color: "#e2ddd4",
    }}>
      {/* Header */}
      <header style={{
        padding: "18px 28px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(8,9,13,0.95)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: isGemini3
              ? "linear-gradient(135deg, #1a73e8 0%, #34a853 50%, #ea4335 100%)"
              : "linear-gradient(135deg, #4285f4 0%, #0f9d58 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            flexShrink: 0,
            boxShadow: isGemini3
              ? "0 0 20px rgba(26,115,232,0.3)"
              : "0 0 16px rgba(66,133,244,0.2)",
          }}>
            G
          </div>
          <div>
            <div style={{
              fontSize: "1rem",
              fontWeight: 600,
              color: "#f0ece4",
              letterSpacing: "0.01em",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              {modelLabel}
              {isGemini3 && (
                <span style={{
                  fontSize: "0.6rem",
                  background: "linear-gradient(90deg, #1a73e8, #34a853)",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: 4,
                  letterSpacing: "0.08em",
                  fontFamily: "monospace",
                  fontWeight: 700,
                }}>
                  NOUVEAU
                </span>
              )}
            </div>
            <div style={{
              fontSize: "0.7rem",
              color: "#404050",
              letterSpacing: "0.05em",
              fontFamily: "monospace",
              marginTop: 1,
            }}>
              {activeModel ?? "gemini-3-pro-preview"} · Google AI Studio
            </div>
          </div>
        </div>

        <button
          onClick={() => { setMessages([]); setActiveModel(null); setError(null); }}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: "#505060",
            fontSize: "0.75rem",
            padding: "5px 12px",
            cursor: "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#a0a0b0";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#505060";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
          }}
        >
          Nouveau chat
        </button>
      </header>

      {/* Messages */}
      <main style={{
        flex: 1,
        overflowY: "auto",
        padding: "32px 0",
        display: "flex",
        flexDirection: "column",
      }}>
        {messages.length === 0 && !loading && (
          <div style={{
            margin: "auto",
            textAlign: "center",
            padding: "0 24px",
          }}>
            <div style={{
              fontSize: "3.5rem",
              marginBottom: 20,
              background: "linear-gradient(135deg, #1a73e8 0%, #34a853 50%, #ea4335 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>
              G
            </div>
            <div style={{
              fontSize: "1.4rem",
              color: "#2a2a3a",
              fontStyle: "italic",
              marginBottom: 8,
            }}>
              Gemini 3 Pro Preview
            </div>
            <div style={{
              fontSize: "0.78rem",
              color: "#252535",
              fontFamily: "monospace",
              letterSpacing: "0.06em",
            }}>
              Le modèle le plus puissant de Google · Gratuit via AI Studio
            </div>
          </div>
        )}

        <div style={{
          maxWidth: 780,
          width: "100%",
          margin: "0 auto",
          padding: "0 18px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: "flex",
              gap: 12,
              flexDirection: msg.role === "user" ? "row-reverse" : "row",
              alignItems: "flex-start",
            }}>
              {/* Avatar */}
              <div style={{
                width: 28,
                height: 28,
                borderRadius: msg.role === "user" ? 8 : 10,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                marginTop: 3,
                background: msg.role === "user"
                  ? "#151520"
                  : "linear-gradient(135deg, #1a73e8 0%, #34a853 50%, #ea4335 100%)",
                color: msg.role === "user" ? "#404050" : "#fff",
                border: msg.role === "user" ? "1px solid #202030" : "none",
                fontWeight: 700,
                boxShadow: msg.role === "assistant" ? "0 0 12px rgba(26,115,232,0.25)" : "none",
              }}>
                {msg.role === "user" ? "U" : "G"}
              </div>

              {/* Bubble */}
              <div style={{
                maxWidth: "80%",
                background: msg.role === "user"
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(26,115,232,0.05)",
                border: msg.role === "user"
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px solid rgba(26,115,232,0.12)",
                borderRadius: msg.role === "user"
                  ? "16px 4px 16px 16px"
                  : "4px 16px 16px 16px",
                padding: "12px 16px",
                lineHeight: 1.75,
                fontSize: "0.91rem",
                color: msg.role === "user" ? "#9090a8" : "#d4cfc6",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                flexShrink: 0,
                marginTop: 3,
                background: "linear-gradient(135deg, #1a73e8 0%, #34a853 50%, #ea4335 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#fff",
                boxShadow: "0 0 12px rgba(26,115,232,0.25)",
              }}>G</div>
              <div style={{
                background: "rgba(26,115,232,0.05)",
                border: "1px solid rgba(26,115,232,0.12)",
                borderRadius: "4px 16px 16px 16px",
                padding: "14px 18px",
                display: "flex",
                gap: 5,
                alignItems: "center",
              }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#1a73e8",
                    display: "inline-block",
                    animation: `bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
                  }}/>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: "rgba(234,67,53,0.06)",
              border: "1px solid rgba(234,67,53,0.2)",
              borderRadius: 10,
              padding: "10px 16px",
              color: "#ea8080",
              fontSize: "0.82rem",
              fontFamily: "monospace",
            }}>
              ⚠ {error}
            </div>
          )}

          <div ref={bottomRef}/>
        </div>
      </main>

      {/* Input */}
      <footer style={{
        padding: "14px 18px 18px",
        background: "rgba(8,9,13,0.95)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        bottom: 0,
      }}>
        <form
          onSubmit={sendMessage}
          style={{
            maxWidth: 780,
            margin: "0 auto",
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Posez votre question à Gemini 3 Pro…"
            rows={1}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: "12px 16px",
              color: "#e2ddd4",
              fontSize: "0.91rem",
              fontFamily: "'Palatino Linotype', serif",
              lineHeight: 1.6,
              resize: "none",
              outline: "none",
              minHeight: 48,
              maxHeight: 160,
              transition: "border-color 0.2s",
            }}
            onFocus={e => (e.currentTarget.style.borderColor = "rgba(26,115,232,0.5)")}
            onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: loading || !input.trim()
                ? "rgba(255,255,255,0.04)"
                : "linear-gradient(135deg, #1a73e8 0%, #34a853 100%)",
              border: "none",
              color: loading || !input.trim() ? "#303040" : "#fff",
              fontSize: 18,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: loading || !input.trim() ? "none" : "0 0 16px rgba(26,115,232,0.4)",
            }}
          >
            ↑
          </button>
        </form>
        <div style={{
          maxWidth: 780,
          margin: "7px auto 0",
          fontSize: "0.68rem",
          color: "#202030",
          textAlign: "center",
          fontFamily: "monospace",
          letterSpacing: "0.04em",
        }}>
          Gemini 3 Pro Preview · Google AI Studio free tier · Fallback: Gemini 2.5 Pro
        </div>
      </footer>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1a28; border-radius: 2px; }
        textarea::placeholder { color: #282838; }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
      }
