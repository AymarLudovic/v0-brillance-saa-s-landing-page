import { NextResponse } from "next/server"

/**
 * Fetches a URL safely with browser-like headers.
 */
async function fetchUrlContent(url: string): Promise<{ success: boolean; content: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      // Timeout de 15 secondes
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const content = await response.text()
    return { success: true, content }
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error)
    return { success: false, content: "" }
  }
}

/**
 * Fetches a resource and returns it as a base64 data URI.
 * Used for images, fonts, etc. to inline them.
 */
async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get("content-type") || "application/octet-stream"
    const base64 = Buffer.from(buffer).toString("base64")
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

/**
 * Normalizes a URL relative to a base URL.
 */
function normalizeUrl(path: string, baseURL: string): string | null {
  try {
    if (!path || path.startsWith("data:") || path.startsWith("javascript:") || path.startsWith("blob:")) {
      return null
    }
    if (path.startsWith("//")) {
      return `https:${path}`
    }
    return new URL(path, baseURL).href
  } catch {
    return null
  }
}

/**
 * FIX MAJEUR: Extrait les ressources dans leur ordre d'apparition dans le HTML.
 * On parse le HTML une seule fois en ordre pour préserver l'ordre de chargement
 * (crucial pour que les dépendances JS comme jQuery soient chargées avant leurs plugins).
 */
function extractResourcesInOrder(
  rawHTML: string,
  baseURL: string
): {
  cssResources: Array<{ type: "external" | "inline"; content: string; url?: string }>
  jsResources: Array<{ type: "external" | "inline"; content: string; url?: string }>
} {
  const cssResources: Array<{ type: "external" | "inline"; content: string; url?: string }> = []
  const jsResources: Array<{ type: "external" | "inline"; content: string; url?: string }> = []

  // Regex unifiée qui capture TOUTES les balises CSS et JS dans l'ordre
  // Groupe 1: <link> | Groupe 2: <style> | Groupe 3: <script src> | Groupe 4: <script inline>
  const resourceRegex =
    /(<link\s[^>]*>)|(<style\b[^>]*>([\s\S]*?)<\/style>)|(<script\b([^>]*)>([\s\S]*?)<\/script>)/gi

  let match
  while ((match = resourceRegex.exec(rawHTML)) !== null) {
    if (match[1]) {
      // C'est un <link>
      const linkTag = match[1]
      if (/rel=["']stylesheet["']/i.test(linkTag)) {
        const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i)
        if (hrefMatch) {
          const url = normalizeUrl(hrefMatch[1], baseURL)
          if (url) cssResources.push({ type: "external", content: "", url })
        }
      }
    } else if (match[2]) {
      // C'est un <style> inline
      const cssContent = match[3] || ""
      if (cssContent.trim()) {
        cssResources.push({ type: "inline", content: cssContent })
      }
    } else if (match[4]) {
      // C'est un <script>
      const scriptAttrs = match[5] || ""
      const scriptContent = match[6] || ""
      const srcMatch = scriptAttrs.match(/src=["']([^"']+)["']/i)

      if (srcMatch) {
        // Script externe
        const url = normalizeUrl(srcMatch[1], baseURL)
        if (url) jsResources.push({ type: "external", content: "", url })
      } else if (scriptContent.trim()) {
        // Script inline (seulement si pas vide)
        // Ignore les scripts de type JSON/template
        const typeMatch = scriptAttrs.match(/type=["']([^"']+)["']/i)
        const scriptType = typeMatch ? typeMatch[1].toLowerCase() : "text/javascript"
        if (
          scriptType === "text/javascript" ||
          scriptType === "application/javascript" ||
          scriptType === "module" ||
          scriptType === "text/javascript;charset=utf-8"
        ) {
          jsResources.push({ type: "inline", content: scriptContent })
        }
      }
    }
  }

  return { cssResources, jsResources }
}

/**
 * Remplace les URLs relatives dans le CSS par des URLs absolues.
 */
function rewriteCssUrls(cssContent: string, cssFileUrl: string): string {
  const cssBase = cssFileUrl.substring(0, cssFileUrl.lastIndexOf("/") + 1)
  return cssContent.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, urlPath) => {
    if (urlPath.startsWith("data:") || urlPath.startsWith("http://") || urlPath.startsWith("https://")) {
      return match
    }
    try {
      const absoluteUrl = new URL(urlPath, cssBase).href
      return `url("${absoluteUrl}")`
    } catch {
      return match
    }
  })
}

// ─── Route principale ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let urlToAnalyze = body.url as string

    if (!urlToAnalyze) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    if (!/^https?:\/\//i.test(urlToAnalyze)) {
      urlToAnalyze = "https://" + urlToAnalyze
    }

    // ── Étape 1: Fetch du HTML principal ──────────────────────────────────
    const mainResponse = await fetchUrlContent(urlToAnalyze)
    if (!mainResponse.success) {
      throw new Error("Impossible de récupérer le contenu HTML principal. Le site bloque peut-être les requêtes.")
    }

    const rawHTML = mainResponse.content
    let baseURL: string
    try {
      baseURL = new URL(urlToAnalyze).origin
    } catch {
      baseURL = urlToAnalyze
    }

    // ── Étape 2: Extraction des ressources DANS L'ORDRE ──────────────────
    const { cssResources, jsResources } = extractResourcesInOrder(rawHTML, baseURL)

    // ── Étape 3: Fetch des ressources externes CSS et JS en parallèle ─────
    const fetchPromises: Promise<void>[] = []

    // Fetch CSS externes
    for (const res of cssResources) {
      if (res.type === "external" && res.url) {
        fetchPromises.push(
          fetchUrlContent(res.url).then((result) => {
            if (result.success) {
              res.content = rewriteCssUrls(result.content, res.url!)
            } else {
              // Fallback: garder le lien externe
              res.content = `/* Failed to fetch: ${res.url} */`
            }
          })
        )
      }
    }

    // Fetch JS externes
    for (const res of jsResources) {
      if (res.type === "external" && res.url) {
        fetchPromises.push(
          fetchUrlContent(res.url).then((result) => {
            if (result.success) {
              res.content = result.content
            } else {
              res.content = `/* Failed to fetch: ${res.url} */`
            }
          })
        )
      }
    }

    await Promise.allSettled(fetchPromises)

    // ── Étape 4: Assemblage du CSS final ──────────────────────────────────
    const cssBlocks = cssResources
      .map((res) => {
        const label = res.type === "external" ? `/* From: ${res.url} */` : `/* Inline CSS */`
        return `${label}\n${res.content}`
      })
      .filter((block) => !block.includes("/* Failed to fetch") || block.length > 50)
      .join("\n\n")

    // ── Étape 5: Assemblage du JS final (ordre préservé) ──────────────────
    const jsBlocks = jsResources
      .map((res) => {
        const label = res.type === "external" ? `/* From: ${res.url} */` : `/* Inline JS */`
        return `${label}\n${res.content}`
      })
      .join("\n\n")

    // ── Étape 6: Nettoyage du HTML body ───────────────────────────────────
    let cleanHTML = rawHTML

    // Extraire le contenu du <body>
    const bodyMatch = rawHTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    cleanHTML = bodyMatch ? bodyMatch[1] : rawHTML

    // Supprimer scripts, styles, links du body (ils sont maintenant inlinés)
    cleanHTML = cleanHTML
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<link[^>]*rel=["']stylesheet["'][^>]*\/?>/gi, "")
      .trim()

    // ── Étape 7: Extraire les meta pour le viewport ───────────────────────
    const viewportMatch = rawHTML.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)
    const viewportTag = viewportMatch ? viewportMatch[0] : '<meta name="viewport" content="width=device-width, initial-scale=1">'

    // ── Étape 8: Statistiques ─────────────────────────────────────────────
    const stats = {
      cssFilesCount: cssResources.filter((r) => r.type === "external").length,
      cssInlineCount: cssResources.filter((r) => r.type === "inline").length,
      jsFilesCount: jsResources.filter((r) => r.type === "external").length,
      jsInlineCount: jsResources.filter((r) => r.type === "inline").length,
      totalCssSize: Math.round(cssBlocks.length / 1024),
      totalJsSize: Math.round(jsBlocks.length / 1024),
    }

    return NextResponse.json({
      success: true,
      fullHTML: cleanHTML,
      fullCSS: cssBlocks,
      fullJS: jsBlocks,
      viewportTag,
      stats,
    })
  } catch (err: any) {
    console.error("[analyze] ❌ ERREUR:", err)
    return NextResponse.json(
      {
        error: `Analyse échouée: ${err.message}`,
        details: "Erreur côté serveur lors de l'analyse.",
      },
      { status: 500 }
    )
  }
}
