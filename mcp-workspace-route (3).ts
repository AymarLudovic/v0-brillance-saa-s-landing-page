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

// Pub/Sub — publie sur le channel live du workspace
// Upstash supporte PUBLISH via pipeline REST
async function publish(ws: string, event: Record<string, unknown>) {
  try {
    const payload = JSON.stringify({ ...event, ts: Date.now(), ws });
    await upstash([["PUBLISH", `ws:${ws}:live`, payload]]);
  } catch { /* non-bloquant */ }
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
  platform:     string;
  status:       string;
  current_task: string;
  last_seen:    number;
}

interface TaskRecord {
  description: string;
  claimed_by:  string;
  claimed_at:  number;
}

interface HistoryEntry {
  action:    string;
  agent:     string;
  detail:    string;
  timestamp: number;
}

interface ReviewRequest {
  from:        string;
  to:          string;
  task_id:     string;
  description: string;
  requested_at: number;
  status:      "pending" | "approved" | "rejected";
  feedback?:   string;
}

interface BroadcastMessage {
  from:      string;
  message:   string;
  sent_at:   number;
}

// ── Redis key helpers ─────────────────────────────────────────────────────────
const K = {
  context:   (ws: string)              => `ws:${ws}:context`,
  agent:     (ws: string, ag: string)  => `ws:${ws}:agent:${ag}`,
  agents:    (ws: string)              => `ws:${ws}:agents`,
  task:      (ws: string, tk: string)  => `ws:${ws}:task:${tk}`,
  tasks:     (ws: string)              => `ws:${ws}:tasks`,
  history:   (ws: string)              => `ws:${ws}:history`,
  review:    (ws: string, id: string)  => `ws:${ws}:review:${id}`,
  reviews:   (ws: string)              => `ws:${ws}:reviews`,
  broadcast: (ws: string)              => `ws:${ws}:broadcast`,
  global:                                 "global:workspaces",
};

// ── History logger ────────────────────────────────────────────────────────────
async function logAction(ws: string, action: string, agent: string, detail: string) {
  const history = (await rGet(K.history(ws)) as HistoryEntry[] | null) ?? [];
  history.unshift({ action, agent, detail, timestamp: Date.now() });
  if (history.length > 100) history.splice(100);
  await rSet(K.history(ws), history, 86400 * 30);
}

// ── Redis Stream publisher — alimente le SSE endpoint en temps réel ────────────
async function publishEvent(ws: string, action: string, agent: string, detail: string) {
  try {
    await upstash([["XADD", `stream:${ws}`, "*",
      "ws", ws, "action", action, "agent", agent,
      "detail", detail.slice(0, 200),
      "ts", String(Date.now()),
    ]]);
    // Global stream pour le dashboard "all workspaces"
    await upstash([["XADD", "stream:*", "*",
      "ws", ws, "action", action, "agent", agent,
      "detail", detail.slice(0, 200),
      "ts", String(Date.now()),
    ]]);
  } catch { /* non-bloquant */ }
}

// ── Workspace global index ─────────────────────────────────────────────────────
async function trackWorkspace(ws: string) {
  const list = (await rGet(K.global) as string[] | null) ?? [];
  if (!list.includes(ws)) { list.push(ws); await rSet(K.global, list, 86400 * 90); }
}

// ── Workflow templates ─────────────────────────────────────────────────────────
const WORKFLOW_TEMPLATES: Record<string, { name: string; agents: {id:string;role:string}[]; tasks: string[] }> = {
  "landing-page": {
    name: "Landing Page Team",
    agents: [
      { id: "designer",    role: "UI/UX design and visual layout" },
      { id: "developer",   role: "HTML/CSS/JS implementation" },
      { id: "copywriter",  role: "Headlines, CTAs, and body copy" },
    ],
    tasks: ["design-mockup", "hero-section", "features-section", "cta-section", "mobile-responsive"],
  },
  "content-team": {
    name: "Content Creation Team",
    agents: [
      { id: "researcher",  role: "Topic research and fact-checking" },
      { id: "writer",      role: "Draft writing" },
      { id: "editor",      role: "Review and polish" },
    ],
    tasks: ["research", "outline", "draft", "review", "publish"],
  },
  "bug-fix": {
    name: "Bug Fix Squad",
    agents: [
      { id: "investigator", role: "Reproduce and diagnose the bug" },
      { id: "fixer",        role: "Write the fix" },
      { id: "tester",       role: "Verify the fix works" },
    ],
    tasks: ["reproduce", "root-cause", "fix", "test", "pr"],
  },
  "travel-planning": {
    name: "Travel Planning Team",
    agents: [
      { id: "planner",     role: "Itinerary and schedule" },
      { id: "researcher",  role: "Hotels, flights, and activities" },
      { id: "budgeter",    role: "Cost estimation and optimization" },
    ],
    tasks: ["destination", "flights", "hotels", "activities", "budget", "itinerary"],
  },
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
        platform:     { type: "string", description: "Your platform. Ex: claude, codex, cursor, windsurf, gemini, copilot, chatgpt, vscode" },
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
  {
    name: "wait_for_event",
    description:
      "Blocks and waits until another agent triggers a specific event (ex: task released). " +
      "Use this so you don't have to manually poll — the tool returns the moment the event fires. " +
      "Max wait is 25 seconds. If timeout, call again to keep waiting.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        event:        { type: "string", description: "Event name to wait for. Ex: task:activites-jour1:released" },
        timeout:      { type: "number", description: "Seconds to wait, max 25. Default 20." },
      },
      required: ["workspace_id", "event"],
    },
  },
  {
    name: "broadcast_message",
    description:
      "Sends a message visible to ALL agents in the workspace. " +
      "Use this to announce progress, ask a question to everyone, or share important info. " +
      "Other agents can read it with get_history or by listening via wait_for_event('broadcast').",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string" },
        message:      { type: "string", description: "Message to broadcast to all agents" },
      },
      required: ["workspace_id", "agent_id", "message"],
    },
  },
  {
    name: "request_review",
    description:
      "Asks a specific agent to review your work before you continue. " +
      "The target agent will see a pending review when they call list_agents or get_history. " +
      "Use approve_review or reject_review to respond.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        from_agent:   { type: "string", description: "Your agent ID" },
        to_agent:     { type: "string", description: "Agent ID you want review from" },
        task_id:      { type: "string", description: "Which task needs review" },
        description:  { type: "string", description: "What you did and what you need feedback on" },
      },
      required: ["workspace_id", "from_agent", "to_agent", "task_id", "description"],
    },
  },
  {
    name: "respond_review",
    description:
      "Approves or rejects a review request from another agent. " +
      "The requesting agent will receive the feedback when they call wait_for_event or get_history.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string", description: "Your agent ID (the reviewer)" },
        review_id:    { type: "string", description: "Review ID from request_review" },
        decision:     { type: "string", enum: ["approved", "rejected"], description: "Your decision" },
        feedback:     { type: "string", description: "Your feedback or reason" },
      },
      required: ["workspace_id", "agent_id", "review_id", "decision"],
    },
  },
  {
    name: "get_history",
    description:
      "Returns the full action history of a workspace — who did what and when. " +
      "Includes saves, claims, releases, broadcasts, reviews. Useful for onboarding a new agent.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        limit:        { type: "number", description: "Max entries to return. Default 20." },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "listen_workspace",
    description:
      "Listens for real-time updates from other agents on this workspace. " +
      "Blocks up to 25 seconds and returns the moment another agent does something " +
      "(save context, claim a task, broadcast, etc.). " +
      "Use this at the start of your session to stay informed without asking.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        timeout:      { type: "number", description: "Seconds to wait. Max 25. Default 20." },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "use_workflow_template",
    description:
      "Applies a predefined team workflow to a workspace. Sets up the agent roles and task list automatically. " +
      "Available templates: landing-page, content-team, bug-fix, travel-planning.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        agent_id:     { type: "string" },
        template:     { type: "string", enum: ["landing-page", "content-team", "bug-fix", "travel-planning"] },
      },
      required: ["workspace_id", "agent_id", "template"],
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
      await trackWorkspace(ws);
      await logAction(ws, "save_context", ag, `Summary: ${ctx.summary.slice(0, 80)}…`);
      await publish(ws, { action: "save_context", agent: ag, summary: ctx.summary.slice(0, 100), progress: ctx.progress });
      await publishEvent(ws, "save_context", ag, `Summary: ${ctx.summary.slice(0, 80)}…`);
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
      // Priorité : clientInfo du handshake MCP > platform déclaré par l'agent > keyword dans agent_id
      const sessionClient = await rGet("session:last_client") as { name: string } | null;
      const detectedPlatform = sessionClient?.name || String(args.platform ?? "");

      const record: AgentRecord = {
        agent_id:     ag,
        platform:     detectedPlatform,
        status:       String(args.status       ?? "active"),
        current_task: String(args.current_task ?? ""),
        last_seen:    Date.now(),
      };
      await rSet(K.agent(ws, ag), record, 86400 * 7); // persist 7 jours
      const agents = (await rGet(K.agents(ws)) as string[] | null) ?? [];
      if (!agents.includes(ag)) agents.push(ag);
      await rSet(K.agents(ws), agents);
      await trackWorkspace(ws);
      await logAction(ws, "register_agent", ag, `Status: ${record.status} | Task: ${record.current_task || "none"}`);
      await publish(ws, { action: "register_agent", agent: ag, platform: record.platform, status: record.status });
      await publishEvent(ws, "register_agent", ag, `Joined — ${detectedPlatform || "claude"}`);
      // Charge le contexte actuel pour que l'agent sache tout sans appeler get_context
      const [ctx, taskIds, agentIds] = await Promise.all([
        rGet(K.context(ws)),
        rGet(K.tasks(ws)),
        rGet(K.agents(ws)),
      ]) as [WorkspaceContext | null, string[] | null, string[] | null];

      const otherAgents = (agentIds ?? []).filter(id => id !== ag);
      const claimedTasks = await Promise.all(
        (taskIds ?? []).map(async (id) => {
          const t = await rGet(K.task(ws, id)) as TaskRecord | null;
          return t ? `• ${id} → ${t.claimed_by}` : null;
        })
      );

      const briefing = [
        `✅ You joined workspace "${ws}" as "${ag}".`,
        `Platform detected: ${detectedPlatform || "claude"}`,
        ``,
        ctx ? `📋 Project context:\n${ctx.summary}\n→ Next: ${ctx.progress}` : `📋 No context saved yet — you can start fresh.`,
        ``,
        otherAgents.length > 0
          ? `🤖 Other agents in this workspace: ${otherAgents.join(", ")}`
          : `🤖 You are the first agent in this workspace.`,
        ``,
        claimedTasks.filter(Boolean).length > 0
          ? `🔒 Tasks currently locked:\n${claimedTasks.filter(Boolean).join("\n")}`
          : `🔒 No tasks claimed — all areas are free.`,
        ``,
        `You can now claim_task before starting work, and release_task when done.`,
      ].join("\n");

      return { content: [{ type: "text", text: briefing }]};
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
      await logAction(ws, "claim_task", ag, `Task: ${tk} — ${task.description}`);
      await publish(ws, { action: "claim_task", agent: ag, task: tk, description: task.description });
      await publishEvent(ws, "claim_task", ag, `Task: ${tk}`);
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
      await logAction(ws, "release_task", ag, `Task: ${tk} — Result: ${String(args.result ?? "Done").slice(0, 80)}`);
      await publish(ws, { action: "release_task", agent: ag, task: tk, result: String(args.result ?? "Done").slice(0, 120) });
      await publishEvent(ws, "release_task", ag, `Task: ${tk} done`);
      const eventKey = `event:${ws}:task:${tk}:released`;
      await rSet(eventKey, { by: ag, task: tk, result: String(args.result ?? "Done") }, 120);

      return { content: [{ type: "text", text:
        `🔓 Task "${tk}" released by ${ag}.\n` +
        `Result: ${String(args.result ?? "Done")}\n\n` +
        `Event publié → les agents qui attendent "task:${tk}:released" vont être notifiés.`
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

    // ── wait_for_event ─────────────────────────────────────────────────────
    case "wait_for_event": {
      const event   = String(args.event   ?? "");
      const timeout = Math.min(Number(args.timeout ?? 20), 25);
      const deadline = Date.now() + timeout * 1000;
      const eventKey = `event:${ws}:${event}`;

      while (Date.now() < deadline) {
        const found = await rGet(eventKey);
        if (found) {
          await rDel(eventKey); // consomme l'event — un seul agent le reçoit
          return { content: [{ type: "text", text:
            `🔔 Event reçu : "${event}"\n` +
            `Data: ${JSON.stringify(found)}\n\n` +
            `Tu peux maintenant agir immédiatement.`
          }]};
        }
        // Poll toutes les 500ms
        await new Promise(r => setTimeout(r, 500));
      }

      return { content: [{ type: "text", text:
        `⏱️ Timeout après ${timeout}s — aucun event "${event}" reçu.\n` +
        `L'autre agent n'a pas encore terminé. Rappelle wait_for_event pour continuer d'attendre.`
      }]};
    }

    // ── broadcast_message ──────────────────────────────────────────────────
    case "broadcast_message": {
      const message = String(args.message ?? "");
      const bcast: BroadcastMessage = { from: ag, message, sent_at: Date.now() };

      // Stocke le broadcast dans l'historique des broadcasts
      const bcasts = (await rGet(K.broadcast(ws)) as BroadcastMessage[] | null) ?? [];
      bcasts.unshift(bcast);
      if (bcasts.length > 50) bcasts.splice(50);
      await rSet(K.broadcast(ws), bcasts, 86400 * 7);

      // Log + event pour wait_for_event
      await logAction(ws, "broadcast", ag, message.slice(0, 120));
      await publish(ws, { action: "broadcast", agent: ag, message });
      await rSet(`event:${ws}:broadcast`, { from: ag, message }, 300);

      return { content: [{ type: "text", text:
        `📢 Broadcast envoyé par ${ag} au workspace "${ws}".\n\n` +
        `Message : "${message}"\n\n` +
        `Tous les agents peuvent lire ce message via get_history ou wait_for_event("broadcast").`
      }]};
    }

    // ── request_review ─────────────────────────────────────────────────────
    case "request_review": {
      const fromAgent = String(args.from_agent ?? "");
      const toAgent   = String(args.to_agent   ?? "");
      const taskId    = String(args.task_id    ?? "");
      const desc      = String(args.description ?? "");
      const reviewId  = `${taskId}-${Date.now()}`;

      const review: ReviewRequest = {
        from: fromAgent, to: toAgent, task_id: taskId,
        description: desc, requested_at: Date.now(), status: "pending",
      };

      await rSet(K.review(ws, reviewId), review, 86400);
      const reviews = (await rGet(K.reviews(ws)) as string[] | null) ?? [];
      reviews.push(reviewId);
      await rSet(K.reviews(ws), reviews, 86400);

      await logAction(ws, "request_review", fromAgent, `→ ${toAgent} | Task: ${taskId}`);
      // Event pour que toAgent puisse wait_for_event
      await rSet(`event:${ws}:review:${toAgent}:pending`, { review_id: reviewId, from: fromAgent, task_id: taskId }, 86400);

      return { content: [{ type: "text", text:
        `🔍 Review request envoyée.\n\n` +
        `Review ID : ${reviewId}\n` +
        `De : ${fromAgent} → À : ${toAgent}\n` +
        `Tâche : ${taskId}\n` +
        `Description : ${desc}\n\n` +
        `${toAgent} peut attendre via wait_for_event("review:${toAgent}:pending") ou voir ça dans get_history.`
      }]};
    }

    // ── respond_review ─────────────────────────────────────────────────────
    case "respond_review": {
      const reviewId = String(args.review_id ?? "");
      const decision = String(args.decision  ?? "") as "approved" | "rejected";
      const feedback = String(args.feedback  ?? "");

      const review = await rGet(K.review(ws, reviewId)) as ReviewRequest | null;
      if (!review) return { content: [{ type: "text", text: `⚠️ Review "${reviewId}" introuvable.` }]};

      review.status   = decision;
      review.feedback = feedback;
      await rSet(K.review(ws, reviewId), review, 86400);

      const emoji = decision === "approved" ? "✅" : "❌";
      await logAction(ws, `review_${decision}`, ag, `Review ${reviewId} | Feedback: ${feedback.slice(0, 80)}`);
      // Notifie le demandeur
      await rSet(`event:${ws}:review:${review.from}:result`, { review_id: reviewId, decision, feedback, from: ag }, 3600);

      return { content: [{ type: "text", text:
        `${emoji} Review ${decision} par ${ag}.\n\n` +
        `Review ID : ${reviewId}\n` +
        `Tâche : ${review.task_id}\n` +
        `Feedback : ${feedback || "(aucun feedback)"}\n\n` +
        `${review.from} recevra la notification via wait_for_event("review:${review.from}:result").`
      }]};
    }

    // ── get_history ────────────────────────────────────────────────────────
    case "get_history": {
      const limit   = Math.min(Number(args.limit ?? 20), 100);
      const history = (await rGet(K.history(ws)) as HistoryEntry[] | null) ?? [];
      const bcasts  = (await rGet(K.broadcast(ws)) as BroadcastMessage[] | null) ?? [];

      if (history.length === 0) return { content: [{ type: "text", text:
        `Aucune action enregistrée dans le workspace "${ws}" pour l'instant.`
      }]};

      const lines = history.slice(0, limit).map(h => {
        const ago = Math.round((Date.now() - h.timestamp) / 60000);
        return `[${ago}min ago] **${h.action}** by ${h.agent} — ${h.detail}`;
      });

      const bcastLines = bcasts.slice(0, 5).map(b => {
        const ago = Math.round((Date.now() - b.sent_at) / 60000);
        return `[${ago}min ago] 📢 ${b.from}: "${b.message}"`;
      });

      return { content: [{ type: "text", text:
        `📜 Historique workspace "${ws}" (${history.length} actions) :\n\n` +
        lines.join("\n") +
        (bcastLines.length ? `\n\n📢 Broadcasts récents :\n${bcastLines.join("\n")}` : "")
      }]};
    }

    // ── listen_workspace ──────────────────────────────────────────────────
    case "listen_workspace": {
      const timeout  = Math.min(Number(args.timeout ?? 20), 25);
      const deadline = Date.now() + timeout * 1000;
      const channel  = `ws:${ws}:live`;
      let lastId     = "$"; // seuls les nouveaux messages

      // Upstash XREAD avec BLOCK via pipeline — streams Redis
      // On utilise XREAD sur un stream plutôt que SUBSCRIBE (REST-compatible)
      // D'abord on initialise le stream si inexistant
      try { await upstash([["XADD", channel, "MAXLEN", "~", "50", "*", "dummy", "1"]]); } catch {}

      while (Date.now() < deadline) {
        try {
          const remaining = Math.min(Math.floor(deadline - Date.now()), 2000);
          const [result] = await upstash([["XREAD", "COUNT", "1", "BLOCK", String(remaining), "STREAMS", channel, lastId]]);

          if (result && Array.isArray(result) && result.length > 0) {
            const streamData = result[0];
            if (streamData && Array.isArray(streamData) && streamData[1]?.length > 0) {
              const entry   = streamData[1][0];
              lastId        = entry[0]; // update cursor
              const fields  = entry[1] as string[];
              // Les fields sont [key, value, key, value...]
              const dataIdx = fields.indexOf("data");
              if (dataIdx >= 0) {
                const event = JSON.parse(fields[dataIdx + 1]);
                if (event.agent !== ag) { // ignore ses propres events
                  return { content: [{ type: "text", text:
                    `🔔 Update from workspace "${ws}":

` +
                    `**${event.agent}** just did: ${event.action}
` +
                    (event.summary   ? `Summary: ${event.summary}
`    : "") +
                    (event.progress  ? `Progress: ${event.progress}
`  : "") +
                    (event.task      ? `Task: ${event.task}
`          : "") +
                    (event.message   ? `Message: ${event.message}
`    : "") +
                    (event.result    ? `Result: ${event.result}
`      : "") +
                    `
You can now act on this information.`
                  }]};
                }
              }
            }
          }
        } catch { await new Promise(r => setTimeout(r, 500)); }
      }

      return { content: [{ type: "text", text:
        `⏱️ No updates from other agents in the last ${timeout}s on workspace "${ws}".
` +
        `The workspace is quiet. You can call listen_workspace again to keep listening.`
      }]};
    }

    // ── use_workflow_template ──────────────────────────────────────────────
    case "use_workflow_template": {
      const templateId = String(args.template ?? "");
      const tmpl = WORKFLOW_TEMPLATES[templateId];
      if (!tmpl) return { content: [{ type: "text", text:
        `⚠️ Template "${templateId}" inconnu. Disponibles : ${Object.keys(WORKFLOW_TEMPLATES).join(", ")}`
      }]};

      // Initialise le contexte avec le template
      const ctx = {
        summary:    `Workspace initialisé avec le template "${tmpl.name}"`,
        progress:   `Étape 1 — ${tmpl.tasks[0]}`,
        decisions:  [`Template utilisé : ${tmpl.name}`],
        files:      [],
        updated_at: Date.now(),
        updated_by: ag,
      };
      await rSet(K.context(ws), ctx, 86400 * 7);
      await trackWorkspace(ws);
      await logAction(ws, "use_template", ag, `Template: ${tmpl.name}`);

      const agentLines = tmpl.agents.map(a => `• **${a.id}** — ${a.role}`).join("\n");
      const taskLines  = tmpl.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n");

      return { content: [{ type: "text", text:
        `🚀 Template "${tmpl.name}" appliqué au workspace "${ws}".\n\n` +
        `👥 Agents suggérés :\n${agentLines}\n\n` +
        `📋 Tâches à réaliser :\n${taskLines}\n\n` +
        `Chaque agent doit maintenant faire register_agent avec son rôle, ` +
        `puis claim_task sur sa première tâche.`
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

    case "initialize": {
      // Lit le clientInfo envoyé automatiquement par chaque client MCP
      // Cursor envoie {"name":"cursor"}, Codex {"name":"codex"}, etc.
      const clientInfo = (params as Record<string,unknown>).clientInfo as { name?: string; version?: string } | undefined;
      const clientName = String(clientInfo?.name ?? "").toLowerCase();
      if (clientName) {
        // Stocke le client détecté pendant 5 minutes — register_agent le lira
        await rSet("session:last_client", { name: clientName }, 300);
      }
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "claude-workspace", version: "1.0.0" },
      });
    }

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
