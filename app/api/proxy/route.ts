import { NextRequest, NextResponse } from "next/server"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")
  const referer = req.nextUrl.searchParams.get("ref") || ""

  if (!url) {
    return new NextResponse("Missing url param", { status: 400, headers: CORS_HEADERS })
  }

  // Sécurité : on n'autorise que des URLs http(s)
  if (!/^https?:\/\//i.test(url)) {
    return new NextResponse("Invalid URL", { status: 400, headers: CORS_HEADERS })
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
    }
    if (referer) headers["Referer"] = referer

    const response = await fetch(url, { headers, redirect: "follow" })

    if (!response.ok) {
      return new NextResponse(`Upstream error: ${response.status}`, {
        status: response.status,
        headers: CORS_HEADERS,
      })
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream"
    const buffer = await response.arrayBuffer()

    // Pour les CSS: réécrire les url() relatives en absolues
    if (contentType.includes("text/css")) {
      let css = new TextDecoder().decode(buffer)
      const base = new URL(url).origin + new URL(url).pathname.replace(/[^/]*$/, "")

      // Réécrire url() relatives → absolues
      css = css.replace(/url\(\s*(['"]?)(?!data:|https?:|\/\/)([^)'"]+)\1\s*\)/gi, (match, q, rel) => {
        try {
          const abs = new URL(rel, base).href
          return `url(${q}${abs}${q})`
        } catch {
          return match
        }
      })

      // Réécrire les @import relatifs → absolus
      css = css.replace(/@import\s+(?:url\()?['"]?(?!https?:\/\/)([^'")\s;]+)['"]?\)?/gi, (match, rel) => {
        try {
          const abs = new URL(rel, base).href
          return match.replace(rel, abs)
        } catch {
          return match
        }
      })

      return new NextResponse(css, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      })
    }

    // Tous les autres types (JS, fonts, images, etc.)
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    })
  } catch (err: any) {
    console.error("[proxy] Error fetching", url, err.message)
    return new NextResponse(`Proxy error: ${err.message}`, {
      status: 502,
      headers: CORS_HEADERS,
    })
  }
}
