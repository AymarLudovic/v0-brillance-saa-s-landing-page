import { NextResponse } from "next/server"

async function fetchHtml(url: string, cookies?: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
      ...(cookies ? { "Cookie": cookies } : {}),
    },
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

/**
 * Convertit toutes les URLs relatives en absolues dans le HTML brut.
 * On fait ça avec une seule passe de remplacement sur les attributs connus.
 */
function absolutifyHtml(html: string, base: string): string {
  const origin = (() => { try { return new URL(base).origin } catch { return base } })()

  const toAbs = (val: string): string => {
    if (!val || val.startsWith("data:") || val.startsWith("blob:") ||
        val.startsWith("javascript:") || val.startsWith("mailto:") ||
        val.startsWith("tel:") || val.startsWith("#")) return val
    if (val.startsWith("http://") || val.startsWith("https://")) return val
    if (val.startsWith("//")) return "https:" + val
    try { return new URL(val, base).href } catch { return val }
  }

  // Attributs src/href/action/srcset sur toutes les balises
  html = html.replace(
    /(<[a-z][a-z0-9]*\s[^>]*?\s?)(src|href|action|data-src|data-href)=(['"])([^'"]*)\3/gi,
    (_, pre, attr, q, val) => `${pre}${attr}=${q}${toAbs(val)}${q}`
  )

  // srcset (format "url 2x, url2 1x")
  html = html.replace(
    /srcset=(['"])([^'"]+)\1/gi,
    (_, q, val) => {
      const fixed = val.split(",").map((part: string) => {
        const [url, ...rest] = part.trim().split(/\s+/)
        return [toAbs(url), ...rest].join(" ")
      }).join(", ")
      return `srcset=${q}${fixed}${q}`
    }
  )

  // url() dans les style= inline
  html = html.replace(
    /style=(['"])(.*?)\1/gi,
    (_, q, css) => `style=${q}${fixCssUrls(css, base)}${q}`
  )

  // url() dans les blocs <style>
  html = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open, css, close) => `${open}${fixCssUrls(css, base)}${close}`
  )

  return html
}

function fixCssUrls(css: string, base: string): string {
  return css.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (match, q, val) => {
      if (!val || val.startsWith("data:") || val.startsWith("http") || val.startsWith("//")) return match
      try { return `url(${q}${new URL(val, base).href}${q})` } catch { return match }
    }
  )
}

/**
 * Compte les ressources dans le HTML pour les stats
 */
function countResources(html: string) {
  const cssLinks = (html.match(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi) || []).length
  const preloadStyles = (html.match(/<link[^>]+as=["']style["'][^>]*>/gi) || []).length
  const scripts = (html.match(/<script\b[^>]+src=["'][^"']+["'][^>]*>/gi) || []).length
  const inlineStyles = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).length
  const inlineScripts = (html.match(/<script\b(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi) || []).length
  return { cssLinks: cssLinks + preloadStyles, scripts, inlineStyles, inlineScripts }
}

/**
 * Injecte les patches JS en premier dans <head> et supprime les headers anti-iframe
 */
function injectPatches(html: string, siteUrl: string): string {
  let hostname = ""
  let origin = ""
  try {
    const u = new URL(siteUrl)
    hostname = u.hostname
    origin = u.origin
  } catch {}

  // Patch injecté en PREMIER avant tout autre script
  // - Neutralise la détection iframe (window.top, window.parent, window.frameElement)
  // - Neutralise les redirections
  // - Silences les erreurs non-fatales
  const patch = `<script>
(function(){
  // Patch 1: neutraliser détection iframe
  try{Object.defineProperty(window,'top',{get:function(){return window;},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true});}catch(e){}
  // Patch 2: empêcher redirections
  try{window.history.pushState=function(){};window.history.replaceState=function(){};}catch(e){}
  // Patch 3: opener null
  try{window.opener=null;}catch(e){}
  // Patch 4: console.error silencieux (évite les crashs d'erreurs non-fatales)
  var _ce=console.error;console.error=function(){try{_ce.apply(console,arguments);}catch(e){}};
})();
</script>`

  // Retirer les balises <base> existantes (on met la nôtre)
  html = html.replace(/<base\s[^>]*>/gi, "")

  // Notre <base href> pour que les URLs relatives restantes fonctionnent
  const baseTag = `<base href="${origin}/">`

  // Injecter au tout début de <head>
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/(<head\b[^>]*>)/i, `$1\n${baseTag}\n${patch}`)
  } else {
    html = baseTag + "\n" + patch + "\n" + html
  }

  // Retirer les meta CSP et X-Frame-Options inline (certains sites les mettent en meta)
  html = html.replace(/<meta[^>]*http-equiv=["'](?:Content-Security-Policy|X-Frame-Options)["'][^>]*>/gi, "")

  return html
}

/**
 * Fetches all external <link rel="stylesheet"> and replaces them with <style> blocks.
 * Makes the HTML fully self-contained so CORS can't block styles in the iframe.
 */
async function inlineExternalCSS(html: string, base: string): Promise<string> {
  const hrefPattern = /\bhref=["']([^"']+)["']/i
  const linkTags = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)].map(m => m[0])

  for (const tag of linkTags) {
    const hrefMatch = tag.match(hrefPattern)
    if (!hrefMatch) continue
    const href = hrefMatch[1]
    const absUrl = href.startsWith("http") ? href
      : href.startsWith("//") ? "https:" + href
      : (() => { try { return new URL(href, base).href } catch { return null } })()
    if (!absUrl) continue
    try {
      const res = await fetch(absUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/css,*/*;q=0.8" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      let css = await res.text()
      css = fixCssUrls(css, absUrl)
      html = html.replace(tag, `<style data-href="${absUrl}">\n${css}\n</style>`)
    } catch {
      // Leave the original <link> if fetch fails
    }
  }
  return html
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let siteUrl: string = body.url || ""
    const cookies: string = body.cookies || ""

    if (!siteUrl) return NextResponse.json({ error: "URL manquante" }, { status: 400 })
    if (!/^https?:\/\//i.test(siteUrl)) siteUrl = "https://" + siteUrl

    // 1. Récupérer le HTML brut
    const rawHtml = await fetchHtml(siteUrl, cookies)

    // 2. Convertir toutes les URLs relatives en absolues
    const absoluteHtml = absolutifyHtml(rawHtml, siteUrl)

    // 3. Injecter les patches
    const patchedHtml = injectPatches(absoluteHtml, siteUrl)

    // 4. Inliner tous les CSS externes (évite le blocage CORS dans l'iframe)
    const finalHtml = await inlineExternalCSS(patchedHtml, siteUrl)

    // 5. Stats
    const stats = countResources(rawHtml)

    // 6. Extraire CSS et JS inline pour la détection de technos et l'export
    const inlineCSS = Array.from(rawHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
      .map(m => m[1]).join("\n")
    const inlineJS = Array.from(rawHtml.matchAll(/<script\b(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi))
      .map(m => m[1]).join("\n")

    return NextResponse.json({
      success: true,
      fullHTML: finalHtml,
      fullCSS: inlineCSS,
      fullJS: inlineJS,
      stats,
    })

  } catch (err: any) {
    console.error("[analyze] error:", err)
    return NextResponse.json({ error: err.message || "Erreur serveur" }, { status: 500 })
  }
        }
    
