import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { url, method, params } = await req.json();

    if (!url || !method) {
      return NextResponse.json(
        { error: { code: -32600, message: "Missing url or method" } },
        { status: 400 }
      );
    }

    // Normalise l'URL : retire le trailing slash, s'assure qu'elle pointe vers /mcp
    const target = url.replace(/\/$/, "");

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: params ?? {},
    });

    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Accept:          "application/json, text/event-stream",
        "User-Agent":    "MCP-Playground/1.0",
      },
      body,
      // Next.js route timeout — 30 s
      signal: AbortSignal.timeout(30_000),
    });

    const contentType = response.headers.get("content-type") ?? "";

    // ── Streamable HTTP (SSE) ────────────────────────────────────────────────
    if (contentType.includes("text/event-stream")) {
      const reader = response.body?.getReader();
      if (!reader) {
        return NextResponse.json({ error: { code: -32000, message: "Empty SSE stream" } });
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        // SSE: parse "data: {...}" lines
        const lines = accumulated.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              if (parsed.result !== undefined || parsed.error !== undefined) {
                return NextResponse.json(parsed);
              }
            } catch {
              // Not valid JSON yet — continue accumulating
            }
          }
        }
        // Keep only last partial line
        const lastNewline = accumulated.lastIndexOf("\n");
        if (lastNewline > 0) accumulated = accumulated.slice(lastNewline + 1);
      }

      return NextResponse.json({ error: { code: -32000, message: "SSE stream ended without result" } });
    }

    // ── Standard JSON-RPC ────────────────────────────────────────────────────
    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: { code: response.status, message: `Server returned ${response.status}: ${text.slice(0, 200)}` } },
        { status: 200 } // always 200 to client, error is in JSON body
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({
        error: { code: -32700, message: `Invalid JSON from server: ${text.slice(0, 200)}` },
      });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout") || msg.includes("abort");
    return NextResponse.json({
      error: {
        code: isTimeout ? -32001 : -32000,
        message: isTimeout ? "Request timed out (30s)" : msg,
      },
    });
  }
        }
        
