// app/api/workspace-status/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const R_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function upstash(commands: unknown[][]): Promise<unknown[]> {
  const res = await fetch(`${R_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Upstash error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { result: unknown; error?: string }[];
  return data.map(d => d.result);
}

async function rGet(key: string): Promise<unknown> {
  try {
    const [result] = await upstash([["GET", key]]);
    return result ? JSON.parse(result as string) : null;
  } catch { return null; }
}

async function rSet(key: string, value: unknown) {
  await upstash([["SET", key, JSON.stringify(value), "EX", "7776000"]]);
}

// SCAN via pipeline — trouve tous les ws:*:context
async function discoverWorkspaces(): Promise<string[]> {
  const wsIds = new Set<string>();
  let cursor = "0";

  do {
    const [[nextCursor, keys]] = await upstash([
      ["SCAN", cursor, "MATCH", "ws:*:context", "COUNT", "100"]
    ]) as [[string, string[]]];

    cursor = nextCursor;
    for (const key of (keys ?? [])) {
      const match = key.match(/^ws:(.+):context$/);
      if (match) wsIds.add(match[1]);
    }
  } while (cursor !== "0");

  return Array.from(wsIds);
}

export async function GET() {
  try {
    if (!R_URL || !R_TOKEN)
      return NextResponse.json({ error: "Missing env vars: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN" }, { status: 500 });

    // 1. Index global d'abord
    let workspaceIds = (await rGet("global:workspaces") as string[] | null) ?? [];

    // 2. Fallback SCAN si index vide
    if (workspaceIds.length === 0) {
      workspaceIds = await discoverWorkspaces();
      if (workspaceIds.length > 0) await rSet("global:workspaces", workspaceIds);
    }

    // 3. Charge chaque workspace
    const workspaces = await Promise.all(workspaceIds.map(async (wsId) => {
      const [agentIds, taskIds, context, history, bcasts] = await Promise.all([
        rGet(`ws:${wsId}:agents`),
        rGet(`ws:${wsId}:tasks`),
        rGet(`ws:${wsId}:context`),
        rGet(`ws:${wsId}:history`),
        rGet(`ws:${wsId}:broadcast`),
      ]) as [string[]|null, string[]|null, Record<string,unknown>|null, unknown[]|null, unknown[]|null];

      const agents = await Promise.all(
        (agentIds ?? []).map(id => rGet(`ws:${wsId}:agent:${id}`))
      );
      const tasks = await Promise.all(
        (taskIds ?? []).map(async id => {
          const task = await rGet(`ws:${wsId}:task:${id}`) as Record<string,unknown>|null;
          return task ? { id, ...task } : null;
        })
      );

      return {
        id:      wsId,
        context: context ?? null,
        agents:  agents.filter(Boolean),
        tasks:   tasks.filter(Boolean),
        history: (history ?? []).slice(0, 15),
        bcasts:  (bcasts ?? []).slice(0, 5),
      };
    }));

    const active = workspaces.filter(w => w.context || w.agents.length > 0);
    return NextResponse.json({ workspaces: active, total: active.length, updated_at: Date.now() });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
    }
    
