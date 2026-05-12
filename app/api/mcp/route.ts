import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

// ─────────────────────────────────────────────────────────────────────────────
// /api/mcp
//
// GET  — retourne le statut de connexion de chaque service
// POST — connecte au MCP server, utilise Gemini pour choisir l'outil + params,
//        appelle l'outil, retourne le résultat
// ─────────────────────────────────────────────────────────────────────────────

type Transport = "streamable" | "sse"
interface ServerConfig { url: string; tokenCookie: string; transport: Transport }

const MCP_SERVERS: Record<string, ServerConfig> = {
  gmail:    { url: "https://gmailmcp.googleapis.com/mcp/v1",    tokenCookie: "google_access_token", transport: "streamable" },
  drive:    { url: "https://drivemcp.googleapis.com/mcp/v1",    tokenCookie: "google_access_token", transport: "streamable" },
  calendar: { url: "https://calendarmcp.googleapis.com/mcp/v1", tokenCookie: "google_access_token", transport: "streamable" },
  notion:   { url: "https://mcp.notion.com/sse",                tokenCookie: "notion_access_token", transport: "sse" },
  trello:   { url: "https://mcp.trello.com/sse",                tokenCookie: "trello_token",         transport: "sse" },
}

// ── GET /api/mcp — statut de connexion ────────────────────────────────────
export async function GET() {
  const cookieStore = await cookies()
  const status: Record<string, boolean> = {}
  for (const [service, config] of Object.entries(MCP_SERVERS)) {
    // Regroupe gmail/drive/calendar sous "google"
    const key = ["gmail", "drive", "calendar"].includes(service) ? "google" : service
    if (!status[key]) {
      status[key] = !!cookieStore.get(config.tokenCookie)?.value
    }
  }
  return NextResponse.json(status)
}

// ── POST /api/mcp — exécute un outil via MCP ──────────────────────────────
export async function POST(req: NextRequest) {
  const { service, intent, geminiKey, subSkillId } = await req.json()

  // Mappe "google" → service MCP précis selon le subSkillId
  const resolvedService = resolveService(service, subSkillId)
  const config = MCP_SERVERS[resolvedService]
  if (!config) {
    return NextResponse.json({ error: `Service "${service}" non supporté` }, { status: 400 })
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(config.tokenCookie)?.value
  if (!token) {
    return NextResponse.json({ error: "non_connecté", service }, { status: 401 })
  }

  let client: Client | null = null
  try {
    client = new Client({ name: "skills-platform", version: "1.0.0" })

    // Construit le transport avec le Bearer token
    const authHeader = { Authorization: `Bearer ${token}` }
    const transport =
      config.transport === "sse"
        ? new SSEClientTransport(new URL(config.url), { requestInit: { headers: authHeader } })
        : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: authHeader } })

    await client.connect(transport)

    // Découverte dynamique des outils
    const { tools } = await client.listTools()
    if (!tools.length) {
      return NextResponse.json({ error: "Aucun outil disponible sur ce MCP server" }, { status: 502 })
    }

    // Gemini choisit l'outil + génère les paramètres
    const toolChoice = await askGeminiForTool({
      geminiKey,
      service: resolvedService,
      subSkillId,
      intent,
      tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    })

    // Appel de l'outil MCP
    const result = await client.callTool(toolChoice.tool, toolChoice.params)
    return NextResponse.json({ success: true, tool: toolChoice.tool, result })

  } catch (err: unknown) {
    const status = (err as { status?: number })?.status
    if (status === 401) {
      const response = NextResponse.json({ error: "token_expiré", service }, { status: 401 })
      response.cookies.delete(config.tokenCookie)
      return response
    }
    const message = err instanceof Error ? err.message : "Erreur MCP inconnue"
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    try { await client?.close() } catch {}
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mappe un service générique + subSkillId vers le bon MCP server */
function resolveService(service: string, subSkillId: string): string {
  if (service === "google" || service === "gmail") {
    if (subSkillId?.startsWith("drive")) return "drive"
    if (subSkillId?.startsWith("calendar")) return "calendar"
    return "gmail"
  }
  return service
}

/** Demande à Gemini de choisir l'outil MCP et de générer les paramètres */
async function askGeminiForTool({
  geminiKey, service, subSkillId, intent, tools,
}: {
  geminiKey: string
  service: string
  subSkillId: string
  intent: string
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
}): Promise<{ tool: string; params: Record<string, unknown> }> {
  if (!geminiKey) throw new Error("Clé Gemini manquante")

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Tu es un assistant qui sélectionne et paramètre des outils MCP.

Service: "${service}"
Sub-skill: "${subSkillId}"
Instruction utilisateur: "${intent}"

Outils disponibles:
${JSON.stringify(tools, null, 2)}

Réponds UNIQUEMENT en JSON strict (sans markdown) :
{"tool": "nom_exact_de_l_outil", "params": { ...paramètres appropriés... }}

Choisis l'outil le plus adapté et génère des paramètres complets et réalistes basés sur l'instruction.
Si l'instruction est vague, utilise des valeurs raisonnables par défaut.`,
          }],
        }],
        generationConfig: { temperature: 1, maxOutputTokens: 5162 },
      }),
    }
  )

  const data = await res.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  const clean = raw.replace(/```json|```/g, "").trim()

  try {
    return JSON.parse(clean)
  } catch {
    throw new Error(`Gemini a retourné une réponse invalide : ${raw.slice(0, 200)}`)
  }
}

