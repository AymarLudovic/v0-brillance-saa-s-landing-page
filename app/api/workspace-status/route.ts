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
  const data = await res.json() as { result: unknown }[];
  return data.map(d => d.result);
}

async function rGet(key: string): Promise<unknown> {
  const [result] = await upstash([["GET", key]]);
  return result ? JSON.parse(result as string) : null;
}

async function rSet(key: string, value: unknown) {
  await upstash([["SET", key, JSON.stringify(value), "EX", String(86400 * 90)]]);
}

// Découvre tous les workspaces via SCAN sur les clés ws:*:context
async function discoverWorkspaces(): Promise<string[]> {
  let cursor = "0";
  const wsIds = new Set<string>();

  do {
    const res = await fetch(`${R_URL}/scan/${cursor}?match=ws:*:context&count=100`, {
      headers: { Authorization: `Bearer ${R_TOKEN}` },
    });
    const data = await res.json() as { result: [string, string[]] };
    const [nextCursor, keys] = data.result;
    cursor = nextCursor;

    for (const key of keys) {
      // "ws:vacances-2026:context" → "vacances-2026"
      const match = key.match(/^ws:(.+):context$/);
      if (match) wsIds.add(match[1]);
    }
  } while (cursor !== "0");

  return Array.from(wsIds);
}

export async function GET() {
  if (!R_URL || !R_TOKEN)
    return NextResponse.json({ error: "Missing Redis env vars" }, { status: 500 });

  // 1. Essaie l'index global d'abord
  let workspaceIds = (await rGet("global:workspaces") as string[] | null) ?? [];

  // 2. Si vide → SCAN pour retrouver les anciens workspaces
  if (workspaceIds.length === 0) {
    workspaceIds = await discoverWorkspaces();
    // Met à jour l'index pour les prochaines fois
    if (workspaceIds.length > 0) await rSet("global:workspaces", workspaceIds);
  }

  // 3. Charge les données de chaque workspace en parallèle
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

  // Filtre les workspaces vides (clé context expirée mais agents encore en vie)
  const active = workspaces.filter(w => w.context || w.agents.length > 0);

  return NextResponse.json({
    workspaces: active,
    total:      active.length,
    updated_at: Date.now(),
  });
                          }
                  
