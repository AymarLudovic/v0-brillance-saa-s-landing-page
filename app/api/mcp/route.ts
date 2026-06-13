import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ── Upstash Redis REST client (zero dependency) ───────────────────────────────
const R_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

// Pipeline Upstash — les commandes en JSON body évitent les problèmes
// d'encodage des clés avec des deux-points dans l'URL REST.
async function upstash(commands: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${R_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const data = await res.json() as { result: unknown }[];
  return data.map(d => d.result);
}

async function rGet(key: string): Promise<unknown> {
  const [result] = await upstash([["GET", key]]);
  return result ? JSON.parse(result as string) : null;
}

async function rSet(key: string, value: unknown, exSeconds = 86400 * 7) {
  await upstash([["SET", key, JSON.stringify(value), "EX", exSeconds]]);
}

async function rDel(key: string) {
  await upstash([["DEL", key]]);
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────
const ok  = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

// ── Types ─────────────────────────────────────────────────────────────────────
interface WorkspaceContext {
  summary:     string;
  decisions:   string[];
  files:       string[];
  progress:    string;
  updated_at:  number;
  updated_by:  string;
}

interface AgentRecord {
  agent_id:     string;
  status:       string;
  current_task: string;
  last_seen:    number;
}

interface TaskRecord {
  description: string;
  claimed_by:  string;
  claimed_at:  number;
}

// ── Redis key helpers ─────────────────────────────────────────────────────────
const K = {
  context: (ws: string)              => `ws:${ws}:context`,
  agent:   (ws: string, ag: string)  => `ws:${ws}:agent:${ag}`,
  agents:  (ws: string)              => `ws:${ws}:agents`,      // Set of agent_ids
  task:    (ws: string, tk: string)  => `ws:${ws}:task:${tk}`,
  tasks:   (ws: string)              => `ws:${ws}:tasks`,       // Set of task_ids
};

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "save_context",
    description:
      "Saves the current conversation context to a shared workspace. " +
      "Call this regularly so other Claude instances (or your future self in a new chat) " +
      "can pick up exactly where you left off.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", description: "Project identifier. Ex: my-app-v2" },
        agent_id:     { type: "string", description: "Your unique instance ID. Ex: claude-frontend-01" },
        summary:      { type: "string", description: "What has been done so far in this conversation" },
        progress:     { type: "string", description: "Current state / next step" },
        decisions:    { type: "array",  items: { type: "string" }, description: "Key decisions made" },
        files:        { type: "array",  items: { type: "string" }, description: "Files touched or created" },
      },
      required: ["workspace_id", "agent_id", "summary", "progress"],
    },
  },
  {
    name: "get_context",
    description:
      "Retrieves the full context of a workspace. Call this at the start of a new chat " +
      "to instantly know everything that was done before without re-explaining anything.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "register_agent",
    description:
      "Registers this Claude instance as active on a workspace. " +
      "Other agents will see you in list_agents and know what you're working on.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string", description: "Your unique ID. Ex: claude-backend-02" },
        status:       { type: "string", description: "What you're currently doing" },
        current_task: { type: "string", description: "The specific task you're handling right now" },
      },
      required: ["workspace_id", "agent_id", "status"],
    },
  },
  {
    name: "list_agents",
    description:
      "Lists all Claude instances currently active on a workspace. " +
      "Use this before starting a task to check if another agent is already working on it.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "claim_task",
    description:
      "Claims a task so other agents know not to touch it. " +
      "Always claim before starting work on something shared.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string" },
        task_id:      { type: "string", description: "Short task identifier. Ex: auth-module, navbar-component" },
        description:  { type: "string", description: "What you're going to do on this task" },
      },
      required: ["workspace_id", "agent_id", "task_id", "description"],
    },
  },
  {
    name: "release_task",
    description: "Releases a task you previously claimed, so other agents can work on it.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string" },
        task_id:      { type: "string" },
        result:       { type: "string", description: "What was done / outcome" },
      },
      required: ["workspace_id", "agent_id", "task_id"],
    },
  },
  {
    name: "list_tasks",
    description: "Lists all currently claimed tasks in a workspace and who owns them.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
      },
      required: ["workspace_id"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────
async function callTool(name: string, args: Record<string, unknown>) {
  const ws  = String(args.workspace_id ?? "");
  const ag  = String(args.agent_id     ?? "");

  switch (name) {

    // ── save_context ───────────────────────────────────────────────────────
    case "save_context": {
      const ctx: WorkspaceContext = {
        summary:    String(args.summary  ?? ""),
        progress:   String(args.progress ?? ""),
        decisions:  (args.decisions as string[]) ?? [],
        files:      (args.files     as string[]) ?? [],
        updated_at: Date.now(),
        updated_by: ag,
      };
      await rSet(K.context(ws), ctx);
      return { content: [{ type: "text", text:
        `✅ Context saved to workspace "${ws}" by ${ag}.\n` +
        `Summary: ${ctx.summary.slice(0, 100)}…\n` +
        `Progress: ${ctx.progress}`
      }]};
    }

    // ── get_context ────────────────────────────────────────────────────────
    case "get_context": {
      const ctx = await rGet(K.context(ws)) as WorkspaceContext | null;
      if (!ctx) return { content: [{ type: "text", text:
        `⚠️ No context found for workspace "${ws}". Start a new project or check the workspace ID.`
      }]};
      const age = Math.round((Date.now() - ctx.updated_at) / 60000);
      return { content: [{ type: "text", text:
        `📋 Workspace: "${ws}" — last updated ${age} min ago by ${ctx.updated_by}\n\n` +
        `**Summary:**\n${ctx.summary}\n\n` +
        `**Progress / Next step:**\n${ctx.progress}\n\n` +
        `**Key decisions:**\n${ctx.decisions.map(d => `• ${d}`).join("\n") || "None"}\n\n` +
        `**Files touched:**\n${ctx.files.map(f => `• ${f}`).join("\n") || "None"}`
      }]};
    }

    // ── register_agent ─────────────────────────────────────────────────────
    case "register_agent": {
      const record: AgentRecord = {
        agent_id:     ag,
        status:       String(args.status       ?? "active"),
        current_task: String(args.current_task ?? ""),
        last_seen:    Date.now(),
      };
      await rSet(K.agent(ws, ag), record, 3600); // expire après 1h d'inactivité

      // Ajouter à la liste des agents actifs
      const agents = (await rGet(K.agents(ws)) as string[] | null) ?? [];
      if (!agents.includes(ag)) agents.push(ag);
      await rSet(K.agents(ws), agents);

      return { content: [{ type: "text", text:
        `🤖 Agent "${ag}" registered on workspace "${ws}".\n` +
        `Status: ${record.status}\n` +
        `Current task: ${record.current_task || "none"}`
      }]};
    }

    // ── list_agents ────────────────────────────────────────────────────────
    case "list_agents": {
      const agentIds = (await rGet(K.agents(ws)) as string[] | null) ?? [];
      if (agentIds.length === 0) return { content: [{ type: "text", text:
        `No active agents on workspace "${ws}" yet.`
      }]};

      const records = await Promise.all(
        agentIds.map(id => rGet(K.agent(ws, id)) as Promise<AgentRecord | null>)
      );
      const active = records.filter(Boolean) as AgentRecord[];
      const lines  = active.map(a => {
        const age = Math.round((Date.now() - a.last_seen) / 60000);
        return `• **${a.agent_id}** — ${a.status} | task: ${a.current_task || "—"} | last seen ${age}min ago`;
      });

      return { content: [{ type: "text", text:
        `🤖 Active agents on "${ws}" (${active.length}):\n\n${lines.join("\n")}`
      }]};
    }

    // ── claim_task ─────────────────────────────────────────────────────────
    case "claim_task": {
      const tk  = String(args.task_id ?? "");
      const existing = await rGet(K.task(ws, tk)) as TaskRecord | null;

      if (existing) {
        const age = Math.round((Date.now() - existing.claimed_at) / 60000);
        return { content: [{ type: "text", text:
          `⛔ Task "${tk}" is already claimed by **${existing.claimed_by}** (${age}min ago).\n` +
          `What they're doing: ${existing.description}\n\n` +
          `Wait for them to release_task or pick a different task.`
        }]};
      }

      const task: TaskRecord = {
        description: String(args.description ?? ""),
        claimed_by:  ag,
        claimed_at:  Date.now(),
      };
      await rSet(K.task(ws, tk), task, 7200);

      const tasks = (await rGet(K.tasks(ws)) as string[] | null) ?? [];
      if (!tasks.includes(tk)) tasks.push(tk);
      await rSet(K.tasks(ws), tasks);

      return { content: [{ type: "text", text:
        `✅ Task "${tk}" claimed by ${ag}.\n` +
        `Description: ${task.description}\n\n` +
        `Other agents will see this task is locked. Release it when done.`
      }]};
    }

    // ── release_task ───────────────────────────────────────────────────────
    case "release_task": {
      const tk  = String(args.task_id ?? "");
      const existing = await rGet(K.task(ws, tk)) as TaskRecord | null;

      if (!existing) return { content: [{ type: "text", text:
        `Task "${tk}" is not currently claimed.`
      }]};

      if (existing.claimed_by !== ag) return { content: [{ type: "text", text:
        `⚠️ Task "${tk}" is claimed by ${existing.claimed_by}, not by you (${ag}).`
      }]};

      await rDel(K.task(ws, tk));
      const tasks = ((await rGet(K.tasks(ws)) as string[] | null) ?? []).filter(t => t !== tk);
      await rSet(K.tasks(ws), tasks);

      return { content: [{ type: "text", text:
        `🔓 Task "${tk}" released by ${ag}.\n` +
        `Result: ${String(args.result ?? "Done")}\n\n` +
        `Other agents can now work on this task.`
      }]};
    }

    // ── list_tasks ─────────────────────────────────────────────────────────
    case "list_tasks": {
      const taskIds = (await rGet(K.tasks(ws)) as string[] | null) ?? [];
      if (taskIds.length === 0) return { content: [{ type: "text", text:
        `No tasks currently claimed in workspace "${ws}".`
      }]};

      const records = await Promise.all(
        taskIds.map(id => rGet(K.task(ws, id)).then(r => r ? { id, ...r as TaskRecord } : null))
      );
      const active = records.filter(Boolean) as (TaskRecord & { id: string })[];
      const lines  = active.map(t => {
        const age = Math.round((Date.now() - t.claimed_at) / 60000);
        return `• **${t.id}** → ${t.claimed_by} (${age}min) — ${t.description}`;
      });

      return { content: [{ type: "text", text:
        `🔒 Claimed tasks in "${ws}" (${active.length}):\n\n${lines.join("\n")}`
      }]};
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try { body = await req.json(); }
  catch { return err(0, -32700, "Parse error"); }

  const { id, method, params = {} } = body;

  switch (method) {

    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "claude-workspace", version: "1.0.0" },
      });

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = String(params.name ?? "");
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        if (!R_URL || !R_TOKEN)
          return err(id, -32000, "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars.");
        return ok(id, await callTool(toolName, toolArgs));
      } catch (e: unknown) {
        return err(id, -32000, e instanceof Error ? e.message : String(e));
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}
  
