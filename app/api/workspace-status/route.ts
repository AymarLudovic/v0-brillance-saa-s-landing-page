// app/api/workspace-status/route.ts
// Endpoint pour le dashboard live — retourne tous les workspaces avec agents + tâches + historique

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

export async function GET() {
  if (!R_URL || !R_TOKEN)
    return NextResponse.json({ error: "Missing Redis env vars" }, { status: 500 });

  // 1. Récupère tous les workspaces connus
  const workspaceIds = (await rGet("global:workspaces") as string[] | null) ?? [];

  // 2. Pour chaque workspace, charge agents + tâches + historique en parallèle
  const workspaces = await Promise.all(workspaceIds.map(async (wsId) => {
    const [agentIds, taskIds, context, history, bcasts] = await Promise.all([
      rGet(`ws:${wsId}:agents`),
      rGet(`ws:${wsId}:tasks`),
      rGet(`ws:${wsId}:context`),
      rGet(`ws:${wsId}:history`),
      rGet(`ws:${wsId}:broadcast`),
    ]) as [string[] | null, string[] | null, Record<string,unknown> | null, unknown[] | null, unknown[] | null];

    // Charge les détails de chaque agent
    const agents = await Promise.all(
      (agentIds ?? []).map(id => rGet(`ws:${wsId}:agent:${id}`))
    );

    // Charge les détails de chaque tâche
    const tasks = await Promise.all(
      (taskIds ?? []).map(async id => {
        const task = await rGet(`ws:${wsId}:task:${id}`) as Record<string,unknown> | null;
        return task ? { id, ...task } : null;
      })
    );

    return {
      id:       wsId,
      context:  context ?? null,
      agents:   agents.filter(Boolean),
      tasks:    tasks.filter(Boolean),
      history:  (history ?? []).slice(0, 15),
      bcasts:   (bcasts ?? []).slice(0, 5),
    };
  }));

  return NextResponse.json({
    workspaces,
    total:      workspaces.length,
    updated_at: Date.now(),
  });
                       }
      
