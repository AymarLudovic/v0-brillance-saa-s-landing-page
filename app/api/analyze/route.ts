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
 * Injecte les patches JS+CSS en premier dans <head>.
 * 
 * REVEAL MODE : neutralise toutes les techniques de masquage JS/CSS courantes
 * (animations initiales, opacity:0, visibility:hidden, iframe detection, etc.)
 * tout en préservant la mise en page (on ne touche pas à display:none global).
 */
function injectPatches(html: string, siteUrl: string): string {
  let origin = ""
  try { origin = new URL(siteUrl).origin } catch {}

  // ─── 1. PATCH JS (doit s'exécuter AVANT tous les autres scripts) ──────────
  const jsPatch = `<script data-preview-patch="1">
(function(){
  // ── A. Neutraliser la détection iframe ──────────────────────────────────
  try{Object.defineProperty(window,'top',{get:function(){return window;},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'parent',{get:function(){return window;},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:true});}catch(e){}
  try{Object.defineProperty(window,'self',{get:function(){return window;},configurable:true});}catch(e){}

  // ── B. Bloquer les redirections et navigation ────────────────────────────
  try{
    var _assign=window.location.assign.bind(window.location);
    var _replace=window.location.replace.bind(window.location);
    Object.defineProperty(window.location,'assign',{value:function(){},writable:true,configurable:true});
    Object.defineProperty(window.location,'replace',{value:function(){},writable:true,configurable:true});
  }catch(e){}
  try{window.history.pushState=function(){};window.history.replaceState=function(){};}catch(e){}
  try{window.opener=null;}catch(e){}

  // ── C. Intercepter les setters CSS pour bloquer le masquage par JS ───────
  //    Cible : opacity:0, visibility:hidden, transform initial des animations
  try{
    var opDesc=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'opacity');
    if(opDesc&&opDesc.set){
      Object.defineProperty(CSSStyleDeclaration.prototype,'opacity',{
        set:function(v){
          // Autoriser seulement les valeurs > 0
          var n=parseFloat(v);
          if(!isNaN(n)&&n===0) return;
          opDesc.set.call(this,v);
        },
        get:opDesc.get, configurable:true, enumerable:opDesc.enumerable
      });
    }
  }catch(e){}
  try{
    var visDesc=Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype,'visibility');
    if(visDesc&&visDesc.set){
      Object.defineProperty(CSSStyleDeclaration.prototype,'visibility',{
        set:function(v){
          if(v==='hidden'||v==='collapse') return;
          visDesc.set.call(this,v);
        },
        get:visDesc.get, configurable:true, enumerable:visDesc.enumerable
      });
    }
  }catch(e){}

  // ── D. Intercepter setProperty() (utilisé par Framer Motion, GSAP, etc.) ─
  try{
    var origSetProp=CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty=function(prop,val,priority){
      var p=prop.trim().toLowerCase();
      if(p==='opacity'&&(val==='0'||parseFloat(val)===0)) return;
      if(p==='visibility'&&(val==='hidden'||val==='collapse')) return;
      return origSetProp.call(this,prop,val,priority);
    };
  }catch(e){}

  // ── E. Silencer les erreurs non-fatales (évite les crashs d'UI) ──────────
  window.onerror=function(msg,src,line,col,err){
    // Laisser passer les erreurs critiques de parsing
    if(typeof msg==='string'&&(msg.indexOf('Script error')>-1||msg.indexOf('ResizeObserver')>-1)) return true;
    return false;
  };
  var _ce=console.error;console.error=function(){try{_ce.apply(console,arguments);}catch(e){}};

  // ── F. Après le chargement : révéler tout ce qui reste caché ─────────────
  function revealHiddenElements(){
    try{
      var all=document.querySelectorAll('*');
      for(var i=0;i<all.length;i++){
        var el=all[i];
        var s=el.style;
        // Réparer les inline styles résiduels
        if(s.opacity==='0') s.cssText=s.cssText.replace(/opacity\s*:\s*0[^;]*;?/g,'opacity:1;');
        if(s.visibility==='hidden') s.cssText=s.cssText.replace(/visibility\s*:\s*hidden[^;]*;?/g,'visibility:visible;');
        // Réparer les transforms d'animation initiale communs
        if(s.transform&&(
          s.transform.indexOf('translateY(')>-1||
          s.transform.indexOf('translateX(')>-1||
          s.transform.indexOf('scale(0')>-1
        )){
          var cs=window.getComputedStyle(el);
          if(parseFloat(cs.opacity)<0.1){
            s.transform='none';
            s.opacity='1';
          }
        }
      }
    }catch(e){}
  }

  // Lancer à plusieurs moments pour couvrir les animations retardées
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      revealHiddenElements();
      setTimeout(revealHiddenElements,800);
      setTimeout(revealHiddenElements,2000);
    });
  } else {
    revealHiddenElements();
    setTimeout(revealHiddenElements,800);
    setTimeout(revealHiddenElements,2000);
  }
})();
</script>`

  // ─── 2. PATCH CSS (override de haute priorité avec !important) ───────────
  //    Cible les patterns de masquage CSS connus sans casser les layouts
  const cssPatch = `<style data-preview-patch="1">
  /* ── Attributs inline opacity:0 / visibility:hidden ── */
  [style*="opacity: 0"],[style*="opacity:0"] { opacity: 1 !important; }
  [style*="visibility: hidden"],[style*="visibility:hidden"] { visibility: visible !important; }
  [style*="visibility: collapse"],[style*="visibility:collapse"] { visibility: visible !important; }

  /* ── Transforms d'animation initiales courantes (Framer Motion, GSAP, AOS) ── */
  [style*="translateY(20px)"],[style*="translateY(30px)"],[style*="translateY(40px)"],
  [style*="translateY(50px)"],[style*="translateY(60px)"],[style*="translateY(100px)"],
  [style*="translateY(-20px)"],[style*="translateY(-30px)"],[style*="translateY(-40px)"],
  [style*="translateY(-50px)"],[style*="translateY(-100px)"],
  [style*="translateX(20px)"],[style*="translateX(-20px)"],[style*="translateX(100px)"],
  [style*="translateX(-100px)"],
  [style*="scale(0)"],[style*="scale(0.8)"],[style*="scale(0.9)"] {
    transform: none !important;
    opacity: 1 !important;
  }

  /* ── Frameworks d'animation (AOS, ScrollReveal, Locomotive, etc.) ── */
  [data-aos], .aos-init, .aos-animate { opacity: 1 !important; transform: none !important; transition: none !important; }
  [data-sal], [data-sal-duration], [data-sal-easing] { opacity: 1 !important; transform: none !important; }
  [data-scroll], [data-scroll-reveal] { opacity: 1 !important; transform: none !important; }
  .sr, .js-reveal, .js-fade, .js-slide { opacity: 1 !important; transform: none !important; }

  /* ── Classes utilitaires de masquage communes ── */
  .is-hidden:not([aria-hidden="true"]) { visibility: visible !important; opacity: 1 !important; }
  .invisible { visibility: visible !important; opacity: 1 !important; }

  /* ── Framer Motion / React Spring : état initial will-change ── */
  [style*="will-change: opacity"],[style*="will-change:opacity"] { opacity: 1 !important; }
  [style*="pointer-events: none"][style*="opacity"] { opacity: 1 !important; pointer-events: auto !important; }

  /* ── Désactiver les transitions pour que les états finaux s'affichent immédiatement ── */
  *, *::before, *::after {
    animation-play-state: paused !important;
    animation-delay: -9999s !important;
    animation-fill-mode: both !important;
  }
</style>`

  // ─── 3. Nettoyage ─────────────────────────────────────────────────────────
  // Retirer les balises <base> existantes
  html = html.replace(/<base\s[^>]*>/gi, "")
  // Retirer les meta CSP et X-Frame-Options inline
  html = html.replace(/<meta[^>]*http-equiv=["'](?:Content-Security-Policy|X-Frame-Options|Content-Security-Policy-Report-Only)["'][^>]*>/gi, "")
  // Notre <base href>
  const baseTag = `<base href="${origin}/">`

  // ─── 4. Injection dans <head> (le plus tôt possible) ─────────────────────
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/(<head\b[^>]*>)/i, `$1\n${baseTag}\n${jsPatch}\n${cssPatch}`)
  } else {
    html = baseTag + "\n" + jsPatch + "\n" + cssPatch + "\n" + html
  }

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
                               
