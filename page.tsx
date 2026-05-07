"use client";
// app/page.tsx

import { useChat } from "ai/react";
import { useState, useRef, useEffect } from "react";

const MODELS = [
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "openai/gpt-5.4", label: "GPT-5.4" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export default function Home() {
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } =
    useChat({
      api: "/api/chat",
      body: { model: selectedModel },
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#e8e0d0",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          borderBottom: "1px solid #2a2520",
          padding: "1rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#0f0e0c",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#c8a96e",
              display: "inline-block",
              boxShadow: "0 0 8px #c8a96e88",
            }}
          />
          <h1
            style={{
              fontSize: "1rem",
              fontWeight: "normal",
              letterSpacing: "0.15em",
              color: "#c8a96e",
              textTransform: "uppercase",
            }}
          >
            Agent
          </h1>
        </div>

        {/* Model selector */}
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{
            background: "#1a1814",
            border: "1px solid #2a2520",
            color: "#a09070",
            padding: "0.35rem 0.75rem",
            borderRadius: 4,
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </header>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "2rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          maxWidth: 760,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "#3a3530",
              marginTop: "8rem",
              fontSize: "0.85rem",
              letterSpacing: "0.1em",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>◈</div>
            <div>Commencez la conversation</div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: m.role === "user" ? "#6a8060" : "#805040",
                marginBottom: "0.35rem",
                paddingInline: "0.5rem",
              }}
            >
              {m.role === "user" ? "Vous" : "Agent"}
            </div>
            <div
              style={{
                maxWidth: "80%",
                padding: "0.85rem 1.1rem",
                borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
                background: m.role === "user" ? "#1a2218" : "#1a1510",
                border: `1px solid ${m.role === "user" ? "#2a3828" : "#2a2018"}`,
                fontSize: "0.9rem",
                lineHeight: 1.7,
                color: "#d8d0c0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            <div
              style={{
                padding: "0.85rem 1.1rem",
                borderRadius: "2px 12px 12px 12px",
                background: "#1a1510",
                border: "1px solid #2a2018",
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
                    background: "#805040",
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
              padding: "0.75rem 1rem",
              background: "#1a0a08",
              border: "1px solid #3a1510",
              borderRadius: 6,
              color: "#c05040",
              fontSize: "0.8rem",
            }}
          >
            Erreur : {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: "1px solid #1a1814",
          padding: "1rem 1.5rem",
          background: "#0f0e0c",
          maxWidth: 760,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
          alignSelf: "center",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}
        >
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as any);
              }
            }}
            placeholder="Écrivez votre message…"
            rows={1}
            style={{
              flex: 1,
              background: "#1a1814",
              border: "1px solid #2a2520",
              borderRadius: 6,
              padding: "0.75rem 1rem",
              color: "#e8e0d0",
              fontSize: "0.9rem",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
              lineHeight: 1.5,
              maxHeight: 160,
              overflowY: "auto",
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            style={{
              background: isLoading || !input.trim() ? "#1a1814" : "#c8a96e",
              border: "none",
              borderRadius: 6,
              color: isLoading || !input.trim() ? "#3a3530" : "#0a0a0a",
              padding: "0.75rem 1.25rem",
              cursor: isLoading || !input.trim() ? "default" : "pointer",
              fontSize: "1rem",
              transition: "background 0.15s",
              fontWeight: "bold",
            }}
          >
            ↑
          </button>
        </form>
        <div
          style={{
            textAlign: "center",
            fontSize: "0.65rem",
            color: "#2a2520",
            marginTop: "0.5rem",
            letterSpacing: "0.05em",
          }}
        >
          Shift+Entrée pour nouvelle ligne • Alimenté par Vercel AI Gateway
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #2a2520; border-radius: 2px; }
      `}</style>
    </main>
  );
}
