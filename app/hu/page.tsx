"use client";
// app/page.tsx
import { useChat } from "ai/react";
import { useEffect, useRef } from "react";

export default function Page() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f0f0f", color: "#f0f0f0", fontFamily: "sans-serif" }}>

      {/* Header */}
      <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid #222", fontSize: "0.85rem", color: "#888" }}>
        Agent · Claude Sonnet 4.6
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#333", marginTop: "4rem" }}>
            Commencez la conversation
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "75%",
              padding: "0.75rem 1rem",
              borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
              background: m.role === "user" ? "#1a3a2a" : "#1a1a2e",
              border: `1px solid ${m.role === "user" ? "#2a5a3a" : "#2a2a4a"}`,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {m.content}
          </div>
        ))}

        {isLoading && (
          <div style={{ alignSelf: "flex-start", color: "#555", fontSize: "0.8rem", padding: "0.5rem" }}>
            …
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "0.5rem", padding: "1rem 1.5rem", borderTop: "1px solid #222" }}
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Écrivez votre message…"
          style={{
            flex: 1,
            padding: "0.75rem 1rem",
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: "8px",
            color: "#f0f0f0",
            fontSize: "0.9rem",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: "0.75rem 1.25rem",
            background: isLoading || !input.trim() ? "#222" : "#4a7c59",
            border: "none",
            borderRadius: "8px",
            color: isLoading || !input.trim() ? "#555" : "#fff",
            cursor: isLoading || !input.trim() ? "default" : "pointer",
            fontWeight: "bold",
          }}
        >
          ↑
        </button>
      </form>
    </div>
  );
}
  
