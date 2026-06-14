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
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  const data = await res.json() as { result: unknown; error?: string }[];
  return data.map(d => d.result);
}

// rGet safe — retourne null si la valeur n'est pas parseable
async function rGet(key: string): Promise<unknown> {
  try {
    const [result] = await upstash([["GET", key]]);
    if (!result || typeof result !== "string") return null;
    return JSON.parse(result);
  } catch { return null; }
}

async function rSet(key: string, value: unknown) {
  await upstash([["SET", key, JSON.stringify(value), "EX", "7776000"]]);
}

// Garantit un array — évite le .map is not a function
function toArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

async function discoverWorkspaces(): Promise<string[]> {
  try {
    const wsIds = new Set<string>();
    let cursor = "0";
    let attempts = 0;

    do {
      const [scanResult] = await upstash([
        ["SCAN", cursor, "MATCH", "ws:*:context", "COUNT", "100"]
      ]);

      // Upstash pipeline retourne [cursor, [keys...]]
      if (!Array.isArray(scanResult)) break;
      const [nextCursor, keys] = scanResult as [string, string[]];
      cursor = String(nextCursor ?? "0");

      for (const key of toArray<string>(keys)) {
        const match = key.match(/^ws:(.+):context$/);
        if (match) wsIds.add(match[1]);
      }

      attempts++;
      if (attempts > 20) break; // safety limit
    } while (cursor !== "0");

    return Array.from(wsIds);
  } catch (e) {
    console.error("SCAN failed:", e);
    return [];
  }
}

export async function GET() {
  try {
    if (!R_URL || !R_TOKEN)
      return NextResponse.json(
        { error: "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in env" },
        { status: 500 }
      );

    // 1. Index global
    let workspaceIds = toArray<string>(await rGet("global:workspaces"));

    // 2. Fallback SCAN
    if (workspaceIds.length === 0) {
      workspaceIds = await discoverWorkspaces();
      if (workspaceIds.length > 0) await rSet("global:workspaces", workspaceIds);
    }

    // 3. Charge chaque workspace de façon défensive
    const workspaces = await Promise.all(workspaceIds.map(async (wsId) => {
      const [rawAgentIds, rawTaskIds, context, history, bcasts] = await Promise.all([
        rGet(`ws:${wsId}:agents`),
        rGet(`ws:${wsId}:tasks`),
        rGet(`ws:${wsId}:context`),
        rGet(`ws:${wsId}:history`),
        rGet(`ws:${wsId}:broadcast`),
      ]);

      const agentIds = toArray<string>(rawAgentIds);
      const taskIds  = toArray<string>(rawTaskIds);

      const agents = await Promise.all(
        agentIds.map(id => rGet(`ws:${wsId}:agent:${id}`))
      );

      const tasks = await Promise.all(
        taskIds.map(async id => {
          const task = await rGet(`ws:${wsId}:task:${id}`);
          return task && typeof task === "object" ? { id, ...(task as object) } : null;
        })
      );

      return {
        id:      wsId,
        context: context && typeof context === "object" ? context : null,
        agents:  agents.filter(Boolean),
        tasks:   tasks.filter(Boolean),
        history: toArray(history).slice(0, 15),
        bcasts:  toArray(bcasts).slice(0, 5),
      };
    }));

    const active = workspaces.filter(w => w.context || w.agents.length > 0);
    return NextResponse.json({ workspaces: active, total: active.length, updated_at: Date.now() });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
    }
  
