import { NextResponse } from "next/server"

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
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    const content = await response.text()
    return { success: true, content }
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error)
    return { success: false, content: "" }
  }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        let urlToAnalyze = body.url as string
        if (!urlToAnalyze) return NextResponse.json({ error: "URL is required" }, { status: 400 })
        if (!/^https?:\/\//i.test(urlToAnalyze)) urlToAnalyze = "https://" + urlToAnalyze

        const mainResponse = await fetchUrlContent(urlToAnalyze)
        if (!mainResponse.success) throw new Error("Could not fetch the main HTML content")

        const rawHTML = mainResponse.content
        let baseURL: string
        try { baseURL = new URL(urlToAnalyze).origin } catch { baseURL = urlToAnalyze }

        const linkHrefCaptureRegex = /(<link\s+[^>]*?href=["']([^"']+)["'][^>]*?>)/gi
        const cssSources = [...rawHTML.matchAll(linkHrefCaptureRegex)]
          .filter(match => /rel=["']stylesheet["']/i.test(match[0]))
          .map(match => match[2])
          .filter(Boolean)

        const scriptSrcRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi
        const scriptSources = [...rawHTML.matchAll(scriptSrcRegex)]
          .map(match => match[1])
          .filter(Boolean)
        
        const normalizeUrl = (path: string | undefined | null): string | null => {
            // Guard: new URL(undefined) -> "Cannot read properties of undefined (reading 'split')"
            if (!path || typeof path !== 'string') return null
            const p = path.trim()
            if (!p) return null
            try {
                if (p.startsWith('//')) return `https:${p}`
                if (p.startsWith('http://') || p.startsWith('https://')) return p
                return new URL(p, baseURL).href
            } catch {
                return null
            }
        }
        
        const normalizedCssSources = cssSources.map(normalizeUrl).filter(Boolean) as string[]
        const normalizedScriptSources = scriptSources.map(normalizeUrl).filter(Boolean) as string[]

        const cssFetches = await Promise.allSettled(
          normalizedCssSources.map(async (href) => {
            const result = await fetchUrlContent(href)
            if (!result.success) throw new Error(`Failed to fetch CSS: ${href}`)
            return { href, ...result }
          }),
        )
        const cssContentFromFetches = cssFetches
          .filter(c => c.status === 'fulfilled')
          .map((c: any) => `/* From: ${c.value.href} */\n${c.value.content}`)
        
        const inlineCssRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
        const inlineCss = [...rawHTML.matchAll(inlineCssRegex)]
          .map(match => match[1])
          .filter(Boolean)
          .map((css, i) => `/* Inline style ${i + 1} */\n${css}`)
        const fullCSS = [...cssContentFromFetches, ...inlineCss].join("\n\n")

        const scriptFetches = await Promise.allSettled(
          normalizedScriptSources.map(async (src) => {
            const result = await fetchUrlContent(src)
            if (!result.success) throw new Error(`Failed to fetch JS: ${src}`)
            return { src, ...result }
          }),
        )
        const jsContentFromFetches = scriptFetches
          .filter(s => s.status === 'fulfilled')
          .map((s: any) => `/* From: ${s.value.src} */\n${s.value.content}`)

        // FIX: La negative lookahead (?!src=["']) tronquait le JS inline
        // quand le contenu du script contenait src= (URLs, configs, commentaires...).
        // Solution: regex simple sur toutes les balises <script>, filtre src= en JS pur.
        const allScriptRegex = /<script([^>]*)>([sS]*?)</script>/gi
        const inlineJs = [...rawHTML.matchAll(allScriptRegex)]
          .filter(match => !/src=["'][^"']*["']/i.test(match[1] || ""))
          .map(match => (match[2] || "").trim())
          .filter(Boolean)
          .map((js, i) => `/* Inline script ${i + 1} */\n${js}`)
        const fullJS = [...jsContentFromFetches, ...inlineJs].join("\n\n")

        const bodyContentMatch = rawHTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
        let cleanHTML = bodyContentMatch ? bodyContentMatch[1] : rawHTML
        cleanHTML = cleanHTML
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '')
            .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
            .trim()

        const viewportMatch = rawHTML.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)
        const viewportTag = viewportMatch ? viewportMatch[0] : '<meta name="viewport" content="width=device-width, initial-scale=1">'

        const stats = {
          cssFilesCount: normalizedCssSources.length,
          cssInlineCount: inlineCss.length,
          jsFilesCount: normalizedScriptSources.length,
          jsInlineCount: inlineJs.length,
          totalCssSize: Math.round(fullCSS.length / 1024),
          totalJsSize: Math.round(fullJS.length / 1024),
        }

        return NextResponse.json({ success: true, fullHTML: cleanHTML, fullCSS, fullJS, viewportTag, stats })
    } catch (err: any) {
        console.error("[analyze] ERREUR:", err)
        return NextResponse.json({ error: `Analysis failed: ${err.message}` }, { status: 500 })
    }
  }
