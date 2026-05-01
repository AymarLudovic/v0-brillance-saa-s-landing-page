import { NextResponse } from "next/server"

// NOTE: Assurez-vous que vos fonctions utilitaires (fetchUrlContent, detectAnimationLibrary)
// sont définies et disponibles dans le même contexte de fichier.

/**
 * Récupère le contenu d'une URL de manière sécurisée. (Inchangée)
 */
async function fetchUrlContent(url: string, cookies?: string, referer?: string): Promise<{ success: boolean; content: string }> {
  try {
    const isCss = /\.css(\?|$)/i.test(url)
    const isJs  = /\.js(\?|$)/i.test(url)
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": isCss ? "text/css,*/*;q=0.1" : isJs ? "application/javascript,*/*;q=0.1" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      "DNT": "1",
      "Connection": "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    }
    // Referer CRUCIAL : beaucoup de CDNs rejettent les requetes sans Referer
    if (referer) headers["Referer"] = referer
    if (cookies?.trim()) headers["Cookie"] = cookies.trim()
    const response = await fetch(url, { headers, redirect: "follow" })

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
 * Détecte les librairies d'animation dans le contenu JS. (Inchangée)
 */
function detectAnimationLibrary(content: string): { isAnimation: boolean; library?: string; confidence: number } {
  const patterns = [
    { regex: /gsap|tweenmax|tweenlite|timelinemax|timelinelite/gi, library: "GSAP", confidence: 90 },
    { regex: /new THREE\.|THREE\.Scene|THREE\.WebGLRenderer/gi, library: "Three.js", confidence: 95 },
    { regex: /anime\(|anime\.js/gi, library: "Anime.js", confidence: 85 },
    { regex: /lottie|bodymovin/gi, library: "Lottie", confidence: 90 },
    { regex: /framer-motion|motion\./gi, library: "Framer Motion", confidence: 85 },
    { regex: /aos\.init|AOS\./gi, library: "AOS", confidence: 80 },
    { regex: /scrollmagic/gi, library: "ScrollMagic", confidence: 80 },
    { regex: /@keyframes|animation:|transform:|transition:/gi, library: "CSS Animations", confidence: 70 },
  ]

  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      return { isAnimation: true, library: pattern.library, confidence: pattern.confidence }
    }
  }

  return { isAnimation: false, confidence: 0 }
}


// --- Route principale (CORRIGÉE) ---

export async function POST(request: Request) {
    
    try {
        const body = await request.json()
        let urlToAnalyze = body.url as string
        const cookies = (body.cookies as string | undefined) || ""

        if (!urlToAnalyze) {
            return NextResponse.json({ error: "URL is required" }, { status: 400 })
        }

        if (!/^https?:\/\//i.test(urlToAnalyze)) {
            urlToAnalyze = "https://" + urlToAnalyze
        }

        const mainResponse = await fetchUrlContent(urlToAnalyze, cookies)
        if (!mainResponse.success) {
          throw new Error("Could not fetch the main HTML content")
        }

        const rawHTML = mainResponse.content
        let baseURL: string
        try {
             baseURL = new URL(urlToAnalyze).origin
        } catch {
             baseURL = urlToAnalyze
        }

        // --- UTILITAIRE: Normalisation des URLs ---
        const normalizeUrl = (path: string, base: string = baseURL): string | null => {
            if (!path || path.startsWith('data:') || path.startsWith('blob:')) return path
            try {
                if (path.startsWith('//')) return `https:${path}`
                return new URL(path, base).href
            } catch {
                return null
            }
        }

        // --- UTILITAIRE: Réécriture des URLs relatives dans le CSS ---
        const rewriteCssUrls = (css: string, cssFileUrl: string): string => {
            return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, urlVal) => {
                if (!urlVal || urlVal.startsWith('data:') || urlVal.startsWith('http') || urlVal.startsWith('//')) return match
                const absolute = normalizeUrl(urlVal, cssFileUrl)
                return absolute ? `url(${quote}${absolute}${quote})` : match
            })
        }

        // --- UTILITAIRE: Résolution récursive des @import CSS (Google Fonts, etc.) ---
        // Sans ça, les polices et CSS importés dans d'autres CSS sont perdus
        const resolveImports = async (css: string, cssFileUrl: string, depth = 0): Promise<string> => {
            if (depth > 3) return css // protection anti-boucle infinie
            const importRegex = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?[^;]*;/gi
            const imports: { full: string; url: string }[] = []
            for (const m of css.matchAll(importRegex)) {
                const importUrl = normalizeUrl(m[1], cssFileUrl)
                if (importUrl) imports.push({ full: m[0], url: importUrl })
            }
            if (imports.length === 0) return css
            // Fetch tous les imports en parallèle
            const fetched = await Promise.allSettled(
                imports.map(async ({ url }) => {
                    const res = await fetchUrlContent(url, undefined, cssFileUrl)
                    if (!res.success) return { url, content: `/* @import failed: ${url} */` }
                    const rewritten = rewriteCssUrls(res.content, url)
                    const resolved = await resolveImports(rewritten, url, depth + 1)
                    return { url, content: resolved }
                })
            )
            // Remplacer les @import par le contenu réel
            let result = css
            fetched.forEach((r, i) => {
                const content = r.status === 'fulfilled' ? r.value.content : `/* @import failed */`
                result = result.replace(imports[i].full, `/* @import inlined: ${imports[i].url} */
${content}`)
            })
            return result
        }

        // --- 1. Extraction du viewport tag ---
        const viewportMatch = rawHTML.match(/<meta[^>]*name=["']viewport["'][^>]*>/i)
        const viewportTag = viewportMatch ? viewportMatch[0] : '<meta name="viewport" content="width=device-width, initial-scale=1">'

        // --- 2. Extraction des sources CSS externes ---
        // Gere: standard, preload as=style, rel multi-valeurs, multi-lignes
        const extractCssSources = (html: string): string[] => {
            const found = new Set<string>()
            const linkTagRegex = /<link([\s\S]*?)>/gi
            for (const tagMatch of html.matchAll(linkTagRegex)) {
                const attrs = tagMatch[1]
                const relMatch = /(?:^|[\s])rel=["']([^"']+)["']/i.exec(attrs)
                const asMatch  = /(?:^|[\s])as=["']style["']/i.exec(attrs)
                if (!relMatch) continue
                const relVal = relMatch[1].toLowerCase()
                const isStylesheet   = relVal.includes('stylesheet')
                const isPreloadStyle = relVal.includes('preload') && !!asMatch
                if (!isStylesheet && !isPreloadStyle) continue
                const hrefMatch = /(?:^|[\s])href=["']([^"']+)["']/i.exec(attrs)
                if (!hrefMatch) continue
                const normalized = normalizeUrl(hrefMatch[1])
                if (normalized) found.add(normalized)
            }
            return Array.from(found)
        }
        const cssSources = extractCssSources(rawHTML)

        // --- 3. Extraction des scripts EN ORDRE DOCUMENT ---
        // On parse tous les scripts une seule fois en préservant leur ordre original
        type ScriptEntry =
          | { kind: 'external'; src: string }
          | { kind: 'inline'; content: string }

        const orderedScripts: ScriptEntry[] = []
        const allScriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
        for (const m of rawHTML.matchAll(allScriptRegex)) {
            const attrs = m[1]
            const inline = m[2]
            const srcMatch = /src=["']([^"']+)["']/i.exec(attrs)
            if (srcMatch) {
                const normalized = normalizeUrl(srcMatch[1])
                if (normalized) orderedScripts.push({ kind: 'external', src: normalized })
            } else if (inline.trim()) {
                orderedScripts.push({ kind: 'inline', content: inline })
            }
        }

        // --- 4. Fetch CSS (en parallèle, ordre preservé) ---
        const cssFetches = await Promise.allSettled(
          cssSources.map(async (href) => {
            const res = await fetchUrlContent(href, cookies, urlToAnalyze)
            if (!res.success) throw new Error(`CSS fetch failed: ${href}`)
            const rewritten = rewriteCssUrls(res.content, href)
            // Résoudre les @import (Google Fonts, etc.) récursivement
            const resolved = await resolveImports(rewritten, href)
            return { href, content: resolved }
          })
        )

        const cssFilesContent: string[] = []
        let cssFilesCount = 0
        let cssFilesFailed = 0
        for (const r of cssFetches) {
            if (r.status === 'fulfilled') {
                cssFilesContent.push(`/* From: ${r.value.href} */\n${r.value.content}`)
                cssFilesCount++
            } else {
                cssFilesFailed++
                console.warn("[CSS] fetch failed:", (r as any).reason?.message)
            }
        }

        const inlineCssRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
        const inlineCssBlocks = [...rawHTML.matchAll(inlineCssRegex)]
          .map(m => m[1]).filter(Boolean)

        // Résoudre les @import dans les blocs CSS inline aussi
        const resolvedInlineCss = await Promise.all(
            inlineCssBlocks.map((css, i) =>
                resolveImports(rewriteCssUrls(css, urlToAnalyze), urlToAnalyze)
                    .then(resolved => `/* Inline style ${i + 1} */\n${resolved}`)
            )
        )

        const fullCSS = [
          ...cssFilesContent,
          ...resolvedInlineCss,
        ].join("\n\n")

        // --- 5. Fetch JS externes (en parallèle) puis reconstruction dans l'ordre ---
        const externalSrcs = orderedScripts
          .filter((s): s is { kind: 'external'; src: string } => s.kind === 'external')
          .map(s => s.src)

        const jsFetchMap = new Map<string, string>()
        await Promise.allSettled(
          externalSrcs.map(async (src) => {
            const res = await fetchUrlContent(src, cookies, urlToAnalyze)
            if (res.success) jsFetchMap.set(src, res.content)
          })
        )

        // Reconstruction dans l'ordre original du document
        const jsChunks: string[] = []
        let jsFilesCount = 0
        let jsInlineCount = 0
        for (const entry of orderedScripts) {
            if (entry.kind === 'external') {
                const content = jsFetchMap.get(entry.src)
                if (content) {
                    jsChunks.push(`/* From: ${entry.src} */\n${content}`)
                    jsFilesCount++
                }
            } else {
                jsChunks.push(`/* Inline script ${jsInlineCount + 1} */\n${entry.content}`)
                jsInlineCount++
            }
        }
        const fullJS = jsChunks.join("\n\n")

        // --- 6. Extraction + nettoyage du HTML body ---
        const bodyContentMatch = rawHTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
        let cleanHTML = bodyContentMatch ? bodyContentMatch[1] : rawHTML

        // Convertir les src d'images/vidéos/liens en absolus
        cleanHTML = cleanHTML
          .replace(/(<(?:img|source|video|audio|embed)[^>]*?\s(?:src|srcset)=["'])([^"']+)(["'])/gi,
            (_, pre, val, post) => {
              const abs = normalizeUrl(val)
              return abs ? `${pre}${abs}${post}` : `${pre}${val}${post}`
            }
          )
          .replace(/(<a\s[^>]*?href=["'])([^"'#][^"']*)(["'])/gi,
            (_, pre, val, post) => {
              if (val.startsWith('http') || val.startsWith('//') || val.startsWith('mailto:') || val.startsWith('tel:')) return `${pre}${val}${post}`
              const abs = normalizeUrl(val)
              return abs ? `${pre}${abs}${post}` : `${pre}${val}${post}`
            }
          )

        // Retirer les balises script/style/link (le contenu est déjà extrait)
        cleanHTML = cleanHTML
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<link[^>]*rel=["'][^"']*(stylesheet|preload)[^"']*["'][^>]*>/gi, '')
          .trim()

        // --- 7. Stats ---
        const totalCssSize = Math.round(fullCSS.length / 1024)
        const totalJsSize = Math.round(fullJS.length / 1024)

        return NextResponse.json({
          success: true,
          fullHTML: cleanHTML,
          fullCSS: fullCSS,
          fullJS: fullJS,
          viewportTag,
          stats: {
            cssFilesCount,
            cssFilesFound: cssSources.length,
            cssFilesFailed,
            cssInlineCount: inlineCssBlocks.length,
            jsFilesCount,
            jsInlineCount,
            totalCssSize,
            totalJsSize,
          },
        })

    } catch (err: any) {
        console.error("[v0] ❌ ERREUR FATALE DANS L'ANALYSE (Nouvelle méthode) :", err)
        return NextResponse.json(
          {
            error: `Analysis failed: ${err.message}`,
            details: "Analysis failed due to server-side error.",
          },
          { status: 500 },
        )
    }
                                       }
