import { NextRequest, NextResponse } from "next/server"

async function fetchHTML(url: string, cookies?: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Upgrade-Insecure-Requests": "1",
  }
  if (cookies?.trim()) headers["Cookie"] = cookies.trim()

  const res = await fetch(url, { headers, redirect: "follow" })
  if (!res.ok) throw new Error(`HTTP ${res.status} when fetching ${url}`)
  return res.text()
}

// Convertit toute URL relative/protocol-relative en absolue
function toAbsolute(val: string, base: string): string | null {
  if (!val || val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("javascript:")) return val
  try {
    if (val.startsWith("//")) return "https:" + val
    return new URL(val, base).href
  } catch {
    return null
  }
}

// Redirige une URL de ressource vers notre proxy /api/proxy?url=...&ref=...
function proxyUrl(url: string, ref: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(ref)}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    let rawUrl: string = body.url || ""
    const cookies: string = body.cookies || ""

    if (!rawUrl) return NextResponse.json({ error: "URL is required" }, { status: 400 })
    if (!/^https?:\/\//i.test(rawUrl)) rawUrl = "https://" + rawUrl

    const origin = new URL(rawUrl).origin
    const base = rawUrl

    // 1. Fetch le HTML principal
    const html = await fetchHTML(rawUrl, cookies)

    // 2. Extraire le viewport
    const viewportMatch = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)
    const viewportTag = viewportMatch?.[0] ?? '<meta name="viewport" content="width=device-width, initial-scale=1">'

    // 3. Extraire le <head> complet pour conserver l'ordre des ressources
    const headMatch = html.match(/<head[\s\S]*?>([\s\S]*?)<\/head>/i)
    let headContent = headMatch?.[1] ?? ""

    // 4. Extraire le <body>
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    let bodyContent = bodyMatch?.[1] ?? html

    // Compteurs pour les stats
    let cssFilesFound = 0
    let jsFilesFound = 0
    let jsInlineCount = 0
    let cssInlineCount = 0

    // 5. Traitement du <head>
    // a) Réécrire les <link stylesheet> vers le proxy
    headContent = headContent.replace(
      /(<link\b[^>]*?\shref=["'])([^"']+)(["'][^>]*>)/gi,
      (match, pre, href, post) => {
        const rel = /rel=["']([^"']+)["']/i.exec(match)?.[1]?.toLowerCase() ?? ""
        if (!rel.includes("stylesheet") && !rel.includes("preload")) return match
        const abs = toAbsolute(href, base)
        if (!abs) return match
        cssFilesFound++
        return `${pre}${proxyUrl(abs, base)}${post}`
      }
    )

    // b) Réécrire les <script src> vers le proxy
    headContent = headContent.replace(
      /(<script\b[^>]*?\ssrc=["'])([^"']+)(["'][^>]*><\/script>)/gi,
      (match, pre, src, post) => {
        const abs = toAbsolute(src, base)
        if (!abs) return match
        jsFilesFound++
        return `${pre}${proxyUrl(abs, base)}${post}`
      }
    )

    // c) Supprimer les meta CSP et X-Frame-Options (qui bloqueraient l'iframe)
    headContent = headContent.replace(
      /<meta[^>]*(?:http-equiv=["'](?:Content-Security-Policy|X-Frame-Options|x-frame-options)["']|name=["']referrer["'])[^>]*>/gi,
      "<!-- [ArtBox] removed security meta -->"
    )

    // 6. Traitement du <body>
    // a) Réécrire les src d'images/vidéos/sources vers proxy
    bodyContent = bodyContent.replace(
      /(\s(?:src|data-src|data-lazy-src)=["'])([^"']+)(["'])/gi,
      (match, pre, val, post) => {
        if (val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("{") || val.startsWith("{{")) return match
        const abs = toAbsolute(val, base)
        if (!abs) return match
        return `${pre}${proxyUrl(abs, base)}${post}`
      }
    )

    // b) Réécrire les srcset
    bodyContent = bodyContent.replace(
      /\ssrcset=["']([^"']+)["']/gi,
      (match, srcset) => {
        const rewritten = srcset.replace(/([^\s,]+)(\s+\d+[wx]?)?/g, (m: string, url: string, descriptor: string) => {
          const abs = toAbsolute(url.trim(), base)
          return abs ? `${proxyUrl(abs, base)}${descriptor ?? ""}` : m
        })
        return ` srcset="${rewritten}"`
      }
    )

    // c) Réécrire les <script src> dans le body
    bodyContent = bodyContent.replace(
      /(<script\b[^>]*?\ssrc=["'])([^"']+)(["'])/gi,
      (match, pre, src, post) => {
        const abs = toAbsolute(src, base)
        if (!abs) return match
        jsFilesFound++
        return `${pre}${proxyUrl(abs, base)}${post}`
      }
    )

    // d) Compter les scripts inline
    const inlineScriptMatches = bodyContent.match(/<script\b(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi)
    jsInlineCount = inlineScriptMatches?.length ?? 0

    // e) Compter les styles inline
    const inlineStyleMatches = headContent.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)
    cssInlineCount = inlineStyleMatches?.length ?? 0

    // 7. Patch anti-iframe à injecter en premier script du body
    const antiIframePatch = `<script>
(function() {
  // Neutralise la détection iframe
  try { Object.defineProperty(window,'top',{get:function(){return window;},configurable:true}); } catch(e){}
  try { Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true}); } catch(e){}
  try { Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true}); } catch(e){}
  // Empêche les redirections
  try { window.history.pushState=function(){}; window.history.replaceState=function(){}; } catch(e){}
  try { window.opener=null; } catch(e){}
})();
</script>`

    return NextResponse.json({
      success: true,
      headContent,
      bodyContent: antiIframePatch + bodyContent,
      viewportTag,
      baseUrl: base,
      origin,
      stats: {
        cssFilesFound,
        cssFilesCount: cssFilesFound,
        cssFilesFailed: 0,
        cssInlineCount,
        jsFilesCount: jsFilesFound,
        jsInlineCount,
        totalCssSize: Math.round(headContent.length / 1024),
        totalJsSize: Math.round(bodyContent.length / 1024),
      },
    })
  } catch (err: any) {
    console.error("[analyze] Fatal error:", err)
    return NextResponse.json(
      { error: `Analysis failed: ${err.message}` },
      { status: 500 }
    )
  }
    }
                             
