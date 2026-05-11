import { NextRequest, NextResponse } from "next/server"

// ── /api/notion — proxy CORS pour l'API Notion ────────────────────────────
// Notion bloque les appels directs depuis le navigateur (pas de CORS).
// Ce endpoint reçoit les requêtes depuis le client et les transfère à Notion.

export async function POST(req: NextRequest) {
  const { token, action, title, content, emoji } = await req.json()

  if (!token) {
    return NextResponse.json({ error: "Token Notion manquant" }, { status: 400 })
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  }

  try {
    if (action === "create-page" || action === "create-todo") {
      const isTodo = action === "create-todo"
      const body = {
        parent: { type: "workspace", workspace: true },
        icon: { type: "emoji", emoji: emoji || (isTodo ? "✅" : "📝") },
        properties: {
          title: { title: [{ text: { content: title || "Sans titre" } }] },
        },
        children: content
          ? [
              ...(isTodo
                ? [
                    {
                      object: "block",
                      type: "to_do",
                      to_do: {
                        rich_text: [{ type: "text", text: { content } }],
                        checked: false,
                      },
                    },
                  ]
                : [
                    {
                      object: "block",
                      type: "paragraph",
                      paragraph: {
                        rich_text: [{ type: "text", text: { content } }],
                      },
                    },
                  ]),
            ]
          : [],
      }

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data.message || "Erreur Notion" }, { status: res.status })
      }
      return NextResponse.json({ success: true, url: data.url, id: data.id })
    }

    if (action === "create-database") {
      // Crée une database Notion (tableau)
      const body = {
        parent: { type: "workspace", workspace: true },
        icon: { type: "emoji", emoji: emoji || "📊" },
        title: [{ type: "text", text: { content: title || "Nouveau tableau" } }],
        properties: {
          Nom: { title: {} },
          Statut: {
            select: {
              options: [
                { name: "À faire", color: "red" },
                { name: "En cours", color: "yellow" },
                { name: "Terminé", color: "green" },
              ],
            },
          },
          Date: { date: {} },
        },
      }

      const res = await fetch("https://api.notion.com/v1/databases", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data.message || "Erreur Notion" }, { status: res.status })
      }
      return NextResponse.json({ success: true, url: data.url, id: data.id })
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    )
  }
}
