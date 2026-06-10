import { NextResponse } from "next/server";

// ── Types JSON-RPC 2.0 ───────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: number | string, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });

const err = (id: number | string, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

// ── Tools définition ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "echo",
    description: "Renvoie le texte que vous lui envoyez. Utile pour tester la connexion.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Le texte à renvoyer",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "get_time",
    description: "Retourne la date et l'heure actuelle du serveur.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Format souhaité",
          enum: ["iso", "locale", "timestamp"],
        },
      },
      required: [],
    },
  },
  {
    name: "add_numbers",
    description: "Additionne deux nombres.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "Premier nombre" },
        b: { type: "number", description: "Second nombre" },
      },
      required: ["a", "b"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "echo": {
      const message = String(args.message ?? "");
      return { content: [{ type: "text", text: `Echo: ${message}` }] };
    }

    case "get_time": {
      const format = String(args.format ?? "locale");
      const now = new Date();
      const text =
        format === "iso"       ? now.toISOString()
        : format === "timestamp" ? String(now.getTime())
        : now.toLocaleString("fr-FR", { timeZone: "UTC" }) + " UTC";
      return { content: [{ type: "text", text: `Current time: ${text}` }] };
    }

    case "add_numbers": {
      const a = Number(args.a ?? 0);
      const b = Number(args.b ?? 0);
      return { content: [{ type: "text", text: `${a} + ${b} = ${a + b}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: JsonRpcRequest;

  try {
    body = await req.json();
  } catch {
    return err(0, -32700, "Parse error: invalid JSON");
  }

  const { id, method, params = {} } = body;

  switch (method) {
    // ── initialize ────────────────────────────────────────────────────────────
    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "demo-mcp-server", version: "1.0.0" },
      });

    // ── tools/list ────────────────────────────────────────────────────────────
    case "tools/list":
      return ok(id, { tools: TOOLS });

    // ── tools/call ────────────────────────────────────────────────────────────
    case "tools/call": {
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = callTool(toolName, toolArgs);
        return ok(id, result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(id, -32000, msg);
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
                                                  }
                     
