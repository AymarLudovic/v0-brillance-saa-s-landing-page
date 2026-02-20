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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0d0f",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Georgia', 'Times New Roman', serif",
        color: "#e8e2d9",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "20px 32px",
          borderBottom: "1px solid #1e1e24",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          background: "#0d0d0f",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          ✦
        </div>
        <div>
          <div
            style={{
              fontFamily: "'Georgia', serif",
              fontSize: "1.05rem",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "#f0ece4",
            }}
          >
            DeepSeek V3
          </div>
          <div
            style={{
              fontSize: "0.72rem",
              color: "#5a5a6e",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginTop: 1,
            }}
          >
            deepseek-chat · via deepseek.com
          </div>
        </div>
      </header>

      {/* Messages */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "32px 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {messages.length === 0 && !loading && (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "#3a3a4a",
              padding: "0 24px",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>✦</div>
            <div style={{ fontSize: "1.1rem", color: "#4a4a5e" }}>
              Commencez la conversation
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "#2e2e3e",
                marginTop: 8,
                fontFamily: "monospace",
              }}
            >
              Entrée pour envoyer · Maj+Entrée pour sauter une ligne
            </div>
          </div>
        )}

        <div
          style={{
            maxWidth: 760,
            width: "100%",
            margin: "0 auto",
            padding: "0 20px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 14,
                flexDirection: msg.role === "user" ? "row-reverse" : "row",
                alignItems: "flex-start",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  background:
                    msg.role === "user"
                      ? "#1e2a3a"
                      : "linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%)",
                  color:
                    msg.role === "user" ? "#6a8ab0" : "rgba(255,255,255,0.9)",
                  border:
                    msg.role === "user" ? "1px solid #2a3a4a" : "none",
                  marginTop: 2,
                }}
              >
                {msg.role === "user" ? "U" : "✦"}
              </div>

              {/* Bubble */}
              <div
                style={{
                  maxWidth: "78%",
                  background:
                    msg.role === "user"
                      ? "#14141c"
                      : "#111118",
                  border:
                    msg.role === "user"
                      ? "1px solid #1e1e2a"
                      : "1px solid #1a1a24",
                  borderRadius:
                    msg.role === "user"
                      ? "18px 4px 18px 18px"
                      : "4px 18px 18px 18px",
                  padding: "12px 16px",
                  lineHeight: 1.7,
                  fontSize: "0.92rem",
                  color: msg.role === "user" ? "#b0aac0" : "#ddd7cc",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  background:
                    "linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%)",
                  marginTop: 2,
                }}
              >
                ✦
              </div>
              <div
                style={{
                  background: "#111118",
                  border: "1px solid #1a1a24",
                  borderRadius: "4px 18px 18px 18px",
                  padding: "14px 20px",
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4f8ef7",
                      display: "inline-block",
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                background: "#1a0a0a",
                border: "1px solid #4a1a1a",
                borderRadius: 10,
                padding: "10px 16px",
                color: "#f08080",
                fontSize: "0.85rem",
              }}
            >
              ⚠ {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
      <footer
        style={{
          padding: "16px 20px 20px",
          background: "#0d0d0f",
          borderTop: "1px solid #1e1e24",
          position: "sticky",
          bottom: 0,
        }}
      >
        <form
          onSubmit={sendMessage}
          style={{
            maxWidth: 760,
            margin: "0 auto",
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message…"
            rows={1}
            style={{
              flex: 1,
              background: "#111118",
              border: "1px solid #2a2a38",
              borderRadius: 14,
              padding: "12px 16px",
              color: "#e8e2d9",
              fontSize: "0.92rem",
              fontFamily: "'Georgia', serif",
              lineHeight: 1.6,
              resize: "none",
              outline: "none",
              minHeight: 48,
              maxHeight: 160,
              transition: "border-color 0.2s",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "#4f8ef7")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "#2a2a38")
            }
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background:
                loading || !input.trim()
                  ? "#1a1a24"
                  : "linear-gradient(135deg, #4f8ef7 0%, #a78bfa 100%)",
              border: "none",
              color:
                loading || !input.trim() ? "#3a3a4e" : "#fff",
              fontSize: 18,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ↑
          </button>
        </form>
        <div
          style={{
            maxWidth: 760,
            margin: "8px auto 0",
            fontSize: "0.7rem",
            color: "#2e2e3e",
            textAlign: "center",
            fontFamily: "monospace",
            letterSpacing: "0.04em",
          }}
        >
          Propulsé par DeepSeek V3 · deepseek-chat
        </div>
      </footer>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a38; border-radius: 2px; }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        textarea::placeholder { color: #3a3a4e; }
      `}</style>
    </div>
  );
    }
