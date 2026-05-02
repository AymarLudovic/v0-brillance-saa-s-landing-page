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
  // ══ A. Neutraliser TOUTE détection iframe ═══════════════════════════════
  var _win = window;
  ['top','parent','self'].forEach(function(k){
    try{Object.defineProperty(_win,k,{get:function(){return _win;},configurable:true});}catch(e){}
  });
  try{Object.defineProperty(_win,'frameElement',{get:function(){return null;},configurable:true});}catch(e){}
  // Certains sites comparent window.location.href à document.referrer
  try{Object.defineProperty(_win,'location',{
    get:function(){return {href:_win.location&&_win.location.href||'',hostname:'',pathname:'/',assign:function(){},replace:function(){},reload:function(){}};},
    configurable:true
  });}catch(e){}

  // ══ B. Bloquer navigation / redirections ════════════════════════════════
  try{_win.history.pushState=function(){};_win.history.replaceState=function(){};}catch(e){}
  try{_win.opener=null;}catch(e){}
  // Bloquer document.write qui peut effacer la page
  try{document.write=function(){};document.writeln=function(){};}catch(e){}

  // ══ C. Intercepter TOUS les setters CSS de masquage ════════════════════
  //   opacity, visibility, filter (blur), display (hide seulement)
  var proto = CSSStyleDeclaration.prototype;

  function patchProp(name, blockFn){
    try{
      var d=Object.getOwnPropertyDescriptor(proto,name);
      if(!d||!d.set) return;
      Object.defineProperty(proto,name,{
        set:function(v){ if(blockFn(v)) return; d.set.call(this,v); },
        get:d.get, configurable:true, enumerable:d.enumerable
      });
    }catch(e){}
  }

  patchProp('opacity',   function(v){ return parseFloat(v)===0; });
  patchProp('visibility',function(v){ return v==='hidden'||v==='collapse'; });
  // filter: blur(Xpx) avec X > 0 → bloquer
  patchProp('filter',    function(v){
    if(typeof v!=='string') return false;
    var m=v.match(/blur\(\s*([\d.]+)/);
    return m && parseFloat(m[1])>0;
  });
  // display: none → laisser passer sauf si le parent est body/html
  // (on ne bloque pas display:none globalement car ça casse les menus)

  // ══ D. Intercepter setProperty() ═══════════════════════════════════════
  try{
    var origSP=proto.setProperty;
    proto.setProperty=function(prop,val,prio){
      var p=prop.trim().toLowerCase();
      if(p==='opacity'&&parseFloat(val)===0) return;
      if(p==='visibility'&&(val==='hidden'||val==='collapse')) return;
      if(p==='filter'&&typeof val==='string'){
        var bm=val.match(/blur\(\s*([\d.]+)/);
        if(bm&&parseFloat(bm[1])>0) return;
      }
      return origSP.call(this,prop,val,prio);
    };
  }catch(e){}

  // ══ E. MutationObserver — surveille les changements APRÈS le chargement ═
  //   C'est lui qui attrape les scripts qui re-cachent après init (linear, etc.)
  function fixEl(el){
    try{
      var s=el.style;
      if(!s) return;
      if(s.opacity==='0') s.opacity='1';
      if(s.visibility==='hidden'||s.visibility==='collapse') s.visibility='visible';
      if(s.filter&&s.filter.indexOf('blur(')>-1){
        var bm=s.filter.match(/blur\(\s*([\d.]+)/);
        if(bm&&parseFloat(bm[1])>0) s.filter=s.filter.replace(/blur\([^)]*\)/g,'blur(0px)');
      }
    }catch(e){}
  }

  function startObserver(){
    try{
      if(_win.__previewObserver) return;
      _win.__previewObserver=new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var m=muts[i];
          if(m.type==='attributes'&&m.attributeName==='style'){
            fixEl(m.target);
          }
          if(m.type==='childList'){
            for(var j=0;j<m.addedNodes.length;j++){
              var n=m.addedNodes[j];
              if(n.nodeType===1){ fixEl(n); n.querySelectorAll&&n.querySelectorAll('*').forEach&&n.querySelectorAll('*').forEach(fixEl); }
            }
          }
        }
      });
      _win.__previewObserver.observe(document.documentElement,{
        attributes:true, attributeFilter:['style'],
        childList:true, subtree:true
      });
    }catch(e){}
  }

  // ══ F. Scan initial + passes différées ═════════════════════════════════
  function revealAll(){
    try{
      document.querySelectorAll('*').forEach(function(el){ fixEl(el); });
    }catch(e){}
  }

  // ══ G. Silencer les erreurs non-fatales ════════════════════════════════
  _win.onerror=function(){ return true; };
  _win.onunhandledrejection=function(e){ try{e.preventDefault();}catch(x){} };
  var _ce=console.error;console.error=function(){try{_ce.apply(console,arguments);}catch(e){}};

  // ══ Lancement ═══════════════════════════════════════════════════════════
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){
      startObserver(); revealAll();
      setTimeout(revealAll,500); setTimeout(revealAll,1500); setTimeout(revealAll,3500);
    });
  } else {
    startObserver(); revealAll();
    setTimeout(revealAll,500); setTimeout(revealAll,1500); setTimeout(revealAll,3500);
  }
})();
</script>`

  // ─── 2. PATCH CSS ────────────────────────────────────────────────────────
  const cssPatch = `<style data-preview-patch="1">
  /* ── opacity:0 / visibility:hidden inline ── */
  [style*="opacity: 0"],[style*="opacity:0"] { opacity: 1 !important; }
  [style*="visibility: hidden"],[style*="visibility:hidden"],
  [style*="visibility: collapse"],[style*="visibility:collapse"] { visibility: visible !important; }

  /* ── filter:blur inline (texte flou de cosmos.so et similaires) ── */
  [style*="filter: blur"],[style*="filter:blur"] { filter: none !important; }

  /* ── Transforms d'init d'animation (Framer Motion, GSAP, AOS) ── */
  [style*="translateY(10px)"],[style*="translateY(20px)"],[style*="translateY(30px)"],
  [style*="translateY(40px)"],[style*="translateY(50px)"],[style*="translateY(60px)"],
  [style*="translateY(80px)"],[style*="translateY(100px)"],[style*="translateY(120px)"],
  [style*="translateY(-10px)"],[style*="translateY(-20px)"],[style*="translateY(-30px)"],
  [style*="translateY(-40px)"],[style*="translateY(-50px)"],[style*="translateY(-100px)"],
  [style*="translateX(10px)"],[style*="translateX(20px)"],[style*="translateX(-20px)"],
  [style*="translateX(100px)"],[style*="translateX(-100px)"],
  [style*="scale(0)"],[style*="scale(0.8)"],[style*="scale(0.9)"],[style*="scale(0.95)"] {
    transform: none !important; opacity: 1 !important;
  }

  /* ── Frameworks (AOS, SAL, ScrollReveal, Lenis, Locomotive) ── */
  [data-aos],[data-aos-delay],[data-aos-duration],
  .aos-init,.aos-animate { opacity:1!important; transform:none!important; transition:none!important; }
  [data-sal],[data-sal-duration],[data-sal-easing] { opacity:1!important; transform:none!important; }
  [data-scroll],[data-scroll-reveal],[data-locomotive] { opacity:1!important; transform:none!important; }
  .sr,.js-reveal,.js-fade,.js-slide,.js-animate { opacity:1!important; transform:none!important; }

  /* ── Framer Motion: will-change:opacity state ── */
  [style*="will-change: opacity"],[style*="will-change:opacity"] { opacity:1!important; }
  [style*="pointer-events: none"][style*="opacity"] { opacity:1!important; pointer-events:auto!important; }

  /* ── Sauter les animations CSS à leur état final immédiatement ── */
  *, *::before, *::after {
    animation-play-state: paused !important;
    animation-delay: -9999s !important;
    animation-fill-mode: both !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
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
      
