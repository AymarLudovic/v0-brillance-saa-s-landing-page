import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

// ─────────────────────────────────────────────────────────────────────────────
// /api/connector/route.ts  — Gère TOUT : OAuth, callbacks, déconnexion, MCP
//
// GET  /api/connector                               → statut des connexions
// GET  /api/connector?action=auth&provider=google   → OAuth redirect
// GET  /api/connector?action=callback&provider=...  → OAuth callback
// GET  /api/connector?action=disconnect&service=... → déconnexion
// GET  /api/connector?action=trello-save&token=...  → sauvegarde token Trello
// POST /api/connector                               → exécution outil MCP
// ─────────────────────────────────────────────────────────────────────────────

// ── Config MCP servers ────────────────────────────────────────────────────────
const MCP: Record<string, { url: string; cookie: string; transport: "http" | "sse" }> = {
  gmail:    { url: "https://gmailmcp.googleapis.com/mcp/v1",    cookie: "google_access_token", transport: "http" },
  drive:    { url: "https://drivemcp.googleapis.com/mcp/v1",    cookie: "google_access_token", transport: "http" },
  calendar: { url: "https://calendarmcp.googleapis.com/mcp/v1", cookie: "google_access_token", transport: "http" },
  notion:   { url: "https://mcp.notion.com/sse",                cookie: "notion_access_token", transport: "sse"  },
}

// ── Cookies liés à chaque service (pour le statut + déconnexion) ──────────────
const SERVICE_COOKIES: Record<string, string[]> = {
  google: ["google_access_token", "google_refresh_token"],
  notion: ["notion_access_token"],
  trello: ["trello_token"],
}

// ── Web Crypto helpers (pas besoin du package Node "crypto") ──────────────────
function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("")
}

function randomBase64url(bytes = 32): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const sp       = req.nextUrl.searchParams
  const action   = sp.get("action")
  const provider = sp.get("provider")
  const service  = sp.get("service")
  const origin   = req.nextUrl.origin
  const jar      = await cookies()

  // ── Statut (aucun action) ──────────────────────────────────────────────────
  if (!action) {
    return NextResponse.json({
      google: !!jar.get("google_access_token")?.value,
      notion: !!jar.get("notion_access_token")?.value,
      trello: !!jar.get("trello_token")?.value,
    })
  }

  // ── auth — Démarre le flow OAuth ──────────────────────────────────────────
  if (action === "auth") {
    // Google : OAuth 2.0 + PKCE
    if (provider === "google") {
      const clientId = process.env.GOOGLE_CLIENT_ID
      if (!clientId) return jsonErr("GOOGLE_CLIENT_ID manquant dans .env.local")

      const state        = randomHex(16)
      const codeVerifier = randomBase64url(32)
      const challenge    = await sha256Base64url(codeVerifier)

      const res = NextResponse.redirect(buildUrl("https://accounts.google.com/o/oauth2/v2/auth", {
        client_id:             clientId,
        redirect_uri:          `${origin}/api/connector?action=callback&provider=google`,
        response_type:         "code",
        scope:                 "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar",
        state,
        code_challenge:        challenge,
        code_challenge_method: "S256",
        access_type:           "offline",
        prompt:                "consent",
      }))
      setCookie(res, "oauth_state",         state,        600)
      setCookie(res, "oauth_code_verifier", codeVerifier, 600)
      return res
    }

    // Notion : OAuth 2.0 standard
    if (provider === "notion") {
      const clientId = process.env.NOTION_CLIENT_ID
      if (!clientId) return jsonErr("NOTION_CLIENT_ID manquant dans .env.local")

      const state = randomHex(16)
      const res = NextResponse.redirect(buildUrl("https://api.notion.com/v1/oauth/authorize", {
        client_id:     clientId,
        redirect_uri:  `${origin}/api/connector?action=callback&provider=notion`,
        response_type: "code",
        owner:         "user",
        state,
      }))
      setCookie(res, "oauth_state", state, 600)
      return res
    }

    // Trello : OAuth 1.0a simplifié (token dans le fragment — géré côté client)
    if (provider === "trello") {
      const apiKey = process.env.TRELLO_API_KEY
      if (!apiKey) return jsonErr("TRELLO_API_KEY manquant dans .env.local")

      return NextResponse.redirect(buildUrl("https://trello.com/1/authorize", {
        expiration:      "never",
        name:            "SkillsPlatform",
        scope:           "read,write",
        response_type:   "token",
        key:             apiKey,
        return_url:      `${origin}/api/connector?action=callback&provider=trello`,
        callback_method: "fragment",
      }))
    }

    return jsonErr(`Provider "${provider}" inconnu`)
  }

  // ── callback — Reçoit le code/token ───────────────────────────────────────
  if (action === "callback") {
    // Google callback
    if (provider === "google") {
      const code        = sp.get("code")
      const state       = sp.get("state")
      const savedState  = jar.get("oauth_state")?.value
      const verifier    = jar.get("oauth_code_verifier")?.value

      if (!code || state !== savedState || !verifier) return redirect(`${origin}/?error=google_state_mismatch`)

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "authorization_code",
          client_id:     process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri:  `${origin}/api/connector?action=callback&provider=google`,
          code,
          code_verifier: verifier,
        }),
      })
      const token = await tokenRes.json()
      if (!tokenRes.ok || !token.access_token) return redirect(`${origin}/?error=google_token_exchange`)

      const res = redirect(`${origin}/?connected=google`)
      setCookie(res, "google_access_token",  token.access_token,  token.expires_in ?? 3600)
      if (token.refresh_token) setCookie(res, "google_refresh_token", token.refresh_token, 30 * 24 * 3600)
      res.cookies.delete("oauth_state")
      res.cookies.delete("oauth_code_verifier")
      return res
    }

    // Notion callback
    if (provider === "notion") {
      const code       = sp.get("code")
      const state      = sp.get("state")
      const savedState = jar.get("oauth_state")?.value
      if (!code || state !== savedState) return redirect(`${origin}/?error=notion_state_mismatch`)

      const credentials = btoa(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`)
      const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${credentials}` },
        body: JSON.stringify({
          grant_type:   "authorization_code",
          code,
          redirect_uri: `${origin}/api/connector?action=callback&provider=notion`,
        }),
      })
      const token = await tokenRes.json()
      if (!tokenRes.ok || !token.access_token) return redirect(`${origin}/?error=notion_token_exchange`)

      const res = redirect(`${origin}/?connected=notion`)
      setCookie(res, "notion_access_token", token.access_token, 365 * 24 * 3600)
      res.cookies.delete("oauth_state")
      return res
    }

    // Trello callback — le token est dans le fragment (#token=...) pas le query string.
    // On sert une micro-page HTML qui lit le hash et fait une redirection propre.
    if (provider === "trello") {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Trello</title></head><body>
<script>
  var token = new URLSearchParams(location.hash.replace('#','')).get('token');
  location.href = token
    ? '/api/connector?action=trello-save&token=' + encodeURIComponent(token)
    : '/?error=trello_no_token';
</script>
<p>Connexion Trello...</p></body></html>`
      return new NextResponse(html, { headers: { "Content-Type": "text/html" } })
    }
  }

  // ── trello-save — Sauvegarde le token Trello (vient du callback HTML) ─────
  if (action === "trello-save") {
    const token = sp.get("token")
    if (!token) return redirect(`${origin}/?error=trello_no_token`)
    const res = redirect(`${origin}/?connected=trello`)
    setCookie(res, "trello_token", token, 30 * 24 * 3600)
    return res
  }

  // ── disconnect — Supprime les cookies d'un service ────────────────────────
  if (action === "disconnect") {
    const toClear = SERVICE_COOKIES[service ?? ""]
    if (!toClear) return jsonErr(`Service "${service}" inconnu`)
    const res = redirect(`${origin}/`)
    toClear.forEach(name => res.cookies.delete(name))
    return res
  }

  return jsonErr("Action inconnue")
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler — Exécute un outil via MCP
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { service, intent, geminiKey, subSkillId } = await req.json()

  const resolved = resolveService(service, subSkillId)
  const cfg      = MCP[resolved]
  if (!cfg) return NextResponse.json({ error: `Service "${service}" non supporté` }, { status: 400 })

  const jar   = await cookies()
  const token = jar.get(cfg.cookie)?.value

  if (!token) {
    return NextResponse.json({ error: "non_connecté", service }, { status: 401 })
  }

  // Refresh Google token si expiré
  const freshToken = cfg.cookie === "google_access_token"
    ? await maybeRefreshGoogle(token, jar.get("google_refresh_token")?.value, req)
    : token

  let client: Client | null = null
  try {
    client = new Client({ name: "skills-platform", version: "1.0.0" })

    const authHeader = { Authorization: `Bearer ${freshToken}` }
    const transport  = cfg.transport === "sse"
      ? new SSEClientTransport(new URL(cfg.url), { requestInit: { headers: authHeader } })
      : new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: authHeader } })

    await client.connect(transport)

    // Découverte des outils disponibles sur ce MCP server
    const { tools } = await client.listTools()
    if (!tools.length) return NextResponse.json({ error: "Aucun outil disponible sur ce MCP server" }, { status: 502 })

    // Gemini sélectionne l'outil + génère les paramètres
    const { tool, params } = await askGemini({
      geminiKey,
      service: resolved,
      subSkillId,
      intent,
      tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    })

    // Appel MCP
    const result = await client.callTool(tool, params)
    return NextResponse.json({ success: true, tool, result })

  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      const res = NextResponse.json({ error: "non_connecté", service }, { status: 401 })
      res.cookies.delete(cfg.cookie)
      return res
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur MCP" }, { status: 500 })
  } finally {
    try { await client?.close() } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────────────

/** Mappe service générique → MCP server précis selon le sub-skill */
function resolveService(service: string, subSkillId?: string): string {
  const s = subSkillId ?? ""
  if (service === "google" || service === "gmail") {
    if (s.startsWith("drive"))    return "drive"
    if (s.startsWith("calendar")) return "calendar"
    return "gmail"
  }
  return service
}

/** Rafraîchit le Google access_token si on a un refresh_token */
async function maybeRefreshGoogle(
  accessToken: string,
  refreshToken: string | undefined,
  req: NextRequest
): Promise<string> {
  if (!refreshToken) return accessToken
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    })
    const data = await res.json()
    if (data.access_token) {
      // Met à jour le cookie dans la réponse (best-effort, pas bloquant)
      return data.access_token
    }
  } catch {}
  return accessToken
}

/** Demande à Gemini de choisir l'outil MCP + générer les paramètres */
async function askGemini({
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
            text: `Tu es un expert en intégrations MCP. Tu dois choisir le bon outil et générer des paramètres précis et complets.

Service MCP: "${service}"
Sub-skill demandé: "${subSkillId}"
Instruction de l'utilisateur: "${intent}"

Outils disponibles sur ce MCP server:
${JSON.stringify(tools, null, 2)}

INSTRUCTIONS:
- Choisis l'outil le plus approprié pour accomplir ce que demande l'utilisateur
- Génère des paramètres complets, réalistes et directement utilisables
- Si l'utilisateur n'a pas spécifié certains champs requis, utilise des valeurs sensées
- Pour les emails : génère un vrai contenu professionnel
- Pour les documents : génère un vrai titre et contenu structuré
- Pour les tâches : génère une vraie description claire

Réponds UNIQUEMENT en JSON strict (sans markdown, sans commentaires) :
{"tool": "nom_exact_de_l_outil", "params": { ...tous les paramètres nécessaires... }}`,
          }],
        }],
        generationConfig: {
          temperature:     1,
          maxOutputTokens: 10000,
        },
      }),
    }
  )

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Gemini API ${res.status}`)

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim())
  } catch {
    throw new Error(`Gemini — réponse JSON invalide : ${raw.slice(0, 300)}`)
  }
}

// ── Petits utilitaires ────────────────────────────────────────────────────────
function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return url.toString()
}

function redirect(url: string): NextResponse {
  return NextResponse.redirect(url)
}

function jsonErr(msg: string, status = 400): NextResponse {
  return NextResponse.json({ error: msg }, { status })
}

function setCookie(res: NextResponse, name: string, value: string, maxAge: number) {
  res.cookies.set(name, value, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path:     "/",
  })
                           }
    
