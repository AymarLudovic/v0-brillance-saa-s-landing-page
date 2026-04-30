import { NextResponse } from "next/server"

// Compatible avec toutes les versions de Node.js (AbortSignal.timeout n'existe pas avant Node 17.3)
function makeTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  // Nettoyage automatique si la requête se termine avant le timeout
  controller.signal.addEventListener("abort", () => clearTimeout(timer))
  return controller.signal
}

async function fetchUrlContent(url: string): Promise<{ success: boolean; content: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: makeTimeoutSignal(15000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    const content = await response.text()
    return { success: true, content }
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error)
    return { success: false, content: "" }
  }
}

function normalizeUrl(path: string | undefined | null, baseURL: string | undefined | null): string | null {
  // Guard strict: new URL(undefined) lance Cannot read properties of undefined (reading split)
  if (!path || typeof path !== "string" || !baseURL || typeof baseURL !== "string") return null
  const trimmed = path.trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("blob:")) return null
    if (trimmed.startsWith("//")) return `https:${trimmed}`
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
    return new URL(trimmed, baseURL).href
  } catch {
    return null
  }
}

function extractResourcesInOrder(rawHTML: string, baseURL: string) {
  const cssResources: Array<{ type: "external" | "inline"; content: string; url?: string }> = []
  const jsResources: Array<{ type: "external" | "inline"; content: string; url?: string }> = []
  const resourceRegex = /(<link\s[^>]*>)|(<style\b[^>]*>([\s\S]*?)<\/style>)|(<script\b([^>]*)>([\s\S]*?)<\/script>)/gi
  let match
  while ((match = resourceRegex.exec(rawHTML)) !== null) {
    if (match[1]) {
      const linkTag = match[1]
      if (/rel=["']stylesheet["']/i.test(linkTag)) {
        const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i)
        if (hrefMatch) {
          const url = normalizeUrl(hrefMatch[1], baseURL)
          if (url) cssResources.push({ type: "external", content: "", url })
        }
      }
    } else if (match[2]) {
      const cssContent = match[3] || ""
      if (cssContent.trim()) cssResources.push({ type: "inline", content: cssContent })
    } else if (match[4]) {
      const scriptAttrs = match[5] || ""
      const scriptContent = match[6] || ""
      const srcMatch = scriptAttrs.match(/src=["']([^"']+)["']/i)
      if (srcMatch) {
        const url = normalizeUrl(srcMatch[1], baseURL)
        if (url) jsResources.push({ type: "external", content: "", url })
      } else if (scriptContent.trim()) {
        const typeMatch = scriptAttrs.match(/type=["']([^"']+)["']/i)
        const scriptType = typeMatch ? typeMatch[1].toLowerCase() : "text/javascript"
        if (["text/javascript", "application/javascript", "module", "text/javascript;charset=utf-8"].includes(scriptType)) {
          jsResources.push({ type: "inline", content: scriptContent })
        }
      }
    }
  }
  return { cssResources, jsResources }
}

function rewriteCssUrls(cssContent: string, cssFileUrl: string | undefined): string {
  if (!cssContent || !cssFileUrl || typeof cssFileUrl !== "string") return cssContent || ""
  try {
    const cssBase = new URL(cssFileUrl).href.replace(/\/[^\/]*$/, "/")
    return cssContent.replace(/url\(["''']?([^"')]+)["''']?\)/gi, (match, urlPath) => {
      if (!urlPath || typeof urlPath !== "string") return match
      const p = urlPath.trim()
      if (!p || p.startsWith("data:") || p.startsWith("http://") || p.startsWith("https://") || p.startsWith("//")) return match
      try {
        return `url("${new URL(p, cssBase).href}")`
      } catch {
        return match
      }
    })
  } catch {
    return cssContent
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let urlToAnalyze = body.url as string
    if (!urlToAnalyze) return NextResponse.json({ error: "URL is required" }, { status: 400 })
    if (!/^https?:\/\//i.test(urlToAnalyze)) urlToAnalyze = "https://" + urlToAnalyze

    const mainResponse = await fetchUrlContent(urlToAnalyze)
    if (!mainResponse.success) throw new Error("Impossible de récupérer le HTML. Le site bloque peut-être les requêtes.")

    const rawHTML = mainResponse.content
    let baseURL: string
    try { baseURL = new URL(urlToAnalyze).origin } catch { baseURL = urlToAnalyze }

    const { cssResources, jsResources } = extractResourcesInOrder(rawHTML, baseURL)

    const fetchPromises: Promise<void>[] = []
    for (const res of cssResources) {
      if (res.type === "external" && res.url) {
        const capturedUrl = res.url
        fetchPromises.push(
          fetchUrlContent(capturedUrl).then((result) => {
            res.content = result.success ? rewriteCssUrls(result.content, capturedUrl) : `/* Failed: ${capturedUrl} */`
          })
        )
      }
    }
    for (const res of jsResources) {
      if (res.type === "external" && res.url) {
        const capturedUrl = res.url
        fetchPromises.push(
          fetchUrlContent(capturedUrl).then((result) => {
            res.content = result.success ? result.content : `/* Failed: ${capturedUrl} */`
          })
        )
      }
    }
    await Promise.allSettled(fetchPromises)

    const cssBlocks = cssResources
      .map((res) => `${res.type === "external" ? `/* From: ${res.url} */` : "/* Inline CSS */"}\n${res.content}`)
      .join("\n\n")

    const jsBlocks = jsResources
      .map((res) => `${res.type === "external" ? `/* From: ${res.url} */` : "/* Inline JS */"}\n${res.content}`)
      .join("\n\n")

    const bodyMatch = rawHTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    let cleanHTML = bodyMatch ? bodyMatch[1] : rawHTML
    cleanHTML = cleanHTML
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<link[^>]*rel=["']stylesheet["'][^>]*\/?>/gi, "")
      .trim()

    const viewportMatch = rawHTML.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)
    const viewportTag = viewportMatch ? viewportMatch[0] : '<meta name="viewport" content="width=device-width, initial-scale=1">'

    const stats = {
      cssFilesCount: cssResources.filter((r) => r.type === "external").length,
      cssInlineCount: cssResources.filter((r) => r.type === "inline").length,
      jsFilesCount: jsResources.filter((r) => r.type === "external").length,
      jsInlineCount: jsResources.filter((r) => r.type === "inline").length,
      totalCssSize: Math.round(cssBlocks.length / 1024),
      totalJsSize: Math.round(jsBlocks.length / 1024),
    }

    return NextResponse.json({ success: true, fullHTML: cleanHTML, fullCSS: cssBlocks, fullJS: jsBlocks, viewportTag, stats })
  } catch (err: any) {
    console.error("[analyze] ❌ ERREUR:", err)
    return NextResponse.json({ error: `Analyse échouée: ${err.message}`, details: "Erreur côté serveur." }, { status: 500 })
  }
}
