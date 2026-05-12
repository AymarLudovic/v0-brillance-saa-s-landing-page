import { NextRequest, NextResponse } from "next/server"
import { Nango } from "@nangohq/node"

// ─────────────────────────────────────────────────────────────────────────────
// /api/connector/route.ts  — Tout en un : statut, session Nango, exécution skill
//
// .env.local : NANGO_SECRET_KEY=<ta clé secrète depuis app.nango.dev>
//
// GET  /api/connector?userId=xxx              → statut connexions de l'user
// POST {action:"session", provider, userId}   → session token pour Nango Connect UI
// POST {action:"run", service, ...}           → exécute un skill via Nango proxy
// ─────────────────────────────────────────────────────────────────────────────

const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! })

// Integration IDs tels que configurés dans ton dashboard Nango
// app.nango.dev → Integrations → le "Integration ID" de chaque fiche
const INTEGRATIONS: Record<string, string> = {
  gmail:    "google-mail",
  drive:    "google-drive",
  calendar: "google-calendar",
  notion:   "notion",
  trello:   "trello",
}

const STATUS_GROUPS: Record<string, string[]> = {
  google: ["gmail", "drive", "calendar"],
  notion: ["notion"],
  trello: ["trello"],
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — statut des connexions
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId")
  if (!userId) return NextResponse.json({ google: false, notion: false, trello: false })

  const status: Record<string, boolean> = {}

  await Promise.allSettled(
    Object.entries(STATUS_GROUPS).map(async ([group, services]) => {
      for (const svc of services) {
        const id = INTEGRATIONS[svc]
        if (!id) continue
        try {
          await nango.getConnection(id, userId)
          status[group] = true
          return
        } catch { /* pas connecté */ }
      }
      if (!status[group]) status[group] = false
    })
  )

  return NextResponse.json(status)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action = "run", provider, userId, service, intent, geminiKey, subSkillId } = body

  if (!userId) return NextResponse.json({ error: "userId requis" }, { status: 400 })

  // ── Créer une session pour Nango Connect UI (frontend) ────────────────────
  if (action === "session") {
    try {
      const session = await nango.createConnectSession({
        end_user: { id: userId },
        ...(provider && INTEGRATIONS[provider]
          ? { allowed_integrations: [INTEGRATIONS[provider]] }
          : {}),
      })
      return NextResponse.json({ sessionToken: session.token })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erreur Nango session" },
        { status: 500 }
      )
    }
  }

  // ── Exécuter un skill ─────────────────────────────────────────────────────
  if (action === "run") {
    if (!geminiKey) return NextResponse.json({ error: "Clé Gemini manquante" }, { status: 400 })

    const resolved = resolveService(service, subSkillId)
    const integId  = INTEGRATIONS[resolved]
    if (!integId) return NextResponse.json({ error: `Service "${service}" non supporté` }, { status: 400 })

    try { await nango.getConnection(integId, userId) }
    catch { return NextResponse.json({ error: "non_connecté", service }, { status: 401 }) }

    try {
      const plan = await askGemini({ geminiKey, service: resolved, subSkillId, intent })

      const proxyRes = await nango.proxy({
        method:            plan.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        endpoint:          plan.endpoint,
        providerConfigKey: integId,
        connectionId:      userId,
        data:              plan.body     ?? undefined,
        params:            plan.params   ?? undefined,
        headers:           plan.headers  ?? undefined,
      })

      return NextResponse.json({
        success: true,
        label:   plan.label,
        result:  formatResult(proxyRes.data, plan.label),
      })
    } catch (err: unknown) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erreur" },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ error: "Action inconnue" }, { status: 400 })
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveService — mappe le service générique vers le bon integration ID
// ─────────────────────────────────────────────────────────────────────────────
function resolveService(service: string, subSkillId = ""): string {
  if (service === "google" || service === "gmail") {
    if (subSkillId.startsWith("drive"))    return "drive"
    if (subSkillId.startsWith("calendar")) return "calendar"
    return "gmail"
  }
  return service
}

// ─────────────────────────────────────────────────────────────────────────────
// formatResult — formate la réponse API en texte lisible pour l'UI
// ─────────────────────────────────────────────────────────────────────────────
function formatResult(data: unknown, label?: string): string {
  if (!data) return "Action effectuée avec succès."
  if (typeof data === "string") return data
  const d = data as Record<string, unknown>
  if (d.id && d.threadId)                              return `${label ?? "Email traité"} !\nID message : \`${d.id}\``
  if (d.webViewLink)                                   return `Fichier créé !\n🔗 [Ouvrir dans Drive](${d.webViewLink})`
  if (d.id && d.name)                                  return `"${d.name}" créé avec succès !\nID : \`${d.id}\``
  if (d.url && (d.object === "page" || d.object === "database")) return `Créé dans Notion !\n🔗 [Ouvrir](${d.url})`
  if (d.shortUrl)                                      return `Carte Trello créée !\n🔗 [Ouvrir](${d.shortUrl})`
  return JSON.stringify(data, null, 2).slice(0, 800)
}

// ─────────────────────────────────────────────────────────────────────────────
// askGemini — génère le plan d'action API complet
// ─────────────────────────────────────────────────────────────────────────────
const API_DOCS: Record<string, string> = {
  gmail: `
Base URL gérée par Nango — donne seulement le path.
- Envoyer un email   : POST /gmail/v1/users/me/messages/send
  body: { "raw": "<email encodé en base64url au format RFC 2822>" }
  Format RFC 2822 à encoder:
    To: destinataire@email.com\\r\\n
    Subject: =?UTF-8?B?<btoa(sujet)>?=\\r\\n
    Content-Type: text/plain; charset=utf-8\\r\\n
    MIME-Version: 1.0\\r\\n
    \\r\\n
    <corps de l'email>
- Créer un brouillon : POST /gmail/v1/users/me/drafts
  body: { "message": { "raw": "<même format base64url>" } }
`,
  drive: `
Base URL gérée par Nango.
- Créer un Google Doc   : POST /drive/v3/files
  body: { "name": "<titre>", "mimeType": "application/vnd.google-apps.document" }
- Créer une Google Sheet: POST /drive/v3/files
  body: { "name": "<titre>", "mimeType": "application/vnd.google-apps.spreadsheet" }
- Uploader un fichier texte: POST /upload/drive/v3/files?uploadType=media
  headers: { "Content-Type": "text/plain" }
  body: "<contenu texte brut>"
`,
  calendar: `
Base URL gérée par Nango.
- Créer un événement : POST /calendar/v3/calendars/primary/events
  body: {
    "summary": "<titre>",
    "description": "<description>",
    "start": { "dateTime": "<ISO8601>", "timeZone": "Europe/Paris" },
    "end":   { "dateTime": "<ISO8601>", "timeZone": "Europe/Paris" }
  }
`,
  notion: `
Base URL gérée par Nango. Headers requis: { "Notion-Version": "2022-06-28" }
- Créer une page/note : POST /v1/pages
  body: {
    "parent": { "type": "workspace", "workspace": true },
    "icon": { "type": "emoji", "emoji": "<emoji>" },
    "properties": { "title": { "title": [{ "text": { "content": "<titre>" } }] } },
    "children": [{ "object": "block", "type": "paragraph", "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "<contenu>" } }] } }]
  }
- Créer une tâche : même endpoint, utilise type "to_do" dans children avec checked:false
- Créer une base de données : POST /v1/databases
  body: {
    "parent": { "type": "workspace", "workspace": true },
    "title": [{ "type": "text", "text": { "content": "<titre>" } }],
    "properties": { "Nom": { "title": {} }, "Statut": { "select": { "options": [{"name":"À faire","color":"red"},{"name":"En cours","color":"yellow"},{"name":"Terminé","color":"green"}] } }, "Date": { "date": {} } }
  }
`,
  trello: `
Base URL gérée par Nango.
- Créer une carte : POST /1/cards
  body: { "name": "<nom>", "desc": "<description>", "idList": "<idDeLaListe>", "pos": "top" }
  Pour trouver idList: GET /1/members/me/boards?fields=id,name puis GET /1/boards/<id>/lists
- Créer une liste : POST /1/lists
  body: { "name": "<nom>", "idBoard": "<idDuBoard>", "pos": "bottom" }
  Pour trouver idBoard: GET /1/members/me/boards?fields=id,name
`,
}

async function askGemini({
  geminiKey, service, subSkillId, intent,
}: {
  geminiKey: string
  service: string
  subSkillId: string
  intent: string
}): Promise<{
  method: string
  endpoint: string
  body?: Record<string, unknown>
  params?: Record<string, string>
  headers?: Record<string, string>
  label: string
}> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Tu es un expert en intégrations API REST. Génère un plan d'appel API précis et complet.

Service: "${service}"
Sub-skill: "${subSkillId}"
Instruction utilisateur: "${intent}"

Documentation API:
${API_DOCS[service] ?? "API REST standard"}

Réponds UNIQUEMENT en JSON strict (sans markdown, sans commentaires) :
{
  "method": "POST",
  "endpoint": "/chemin/exact",
  "body": { ...données complètes... },
  "params": { ...query string si nécessaire... },
  "headers": { ...headers spéciaux si nécessaire... },
  "label": "description courte de l'action réalisée"
}

RÈGLES ABSOLUES :
- Génère un VRAI contenu professionnel, pas de placeholders ni de <...>
- Pour les emails Gmail : encode correctement en base64url le message RFC 2822 complet
- Pour les pages Notion : génère un vrai titre et contenu structuré basés sur l'instruction
- "params" et "headers" sont optionnels — ne les inclus que si nécessaires
- Le "label" décrit ce qui a été fait (ex: "Email envoyé à john@example.com — Réunion du 15 mai")`,
          }],
        }],
        generationConfig: { temperature: 1, maxOutputTokens: 10000 },
      }),
    }
  )

  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Gemini API ${res.status}`)

  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
    .replace(/```json|```/g, "").trim()

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`Gemini — JSON invalide reçu : ${raw.slice(0, 300)}`)
  }
  }
                                              
