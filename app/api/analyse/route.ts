import { NextResponse } from "next/server"
import { JSDOM } from "jsdom"

// --- Fonctions d'Analyse ---

/**
 * Récupère le contenu d'une URL de manière sécurisée.
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
      // Ajout d'un timeout optionnel si nécessaire, non inclus ici pour la simplicité
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
 * Détecte les librairies d'animation dans le contenu JS.
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

/**
 * Analyse le HTML pour extraire les classes utilisées et nettoyer le contenu.
 */
function processHTML(html: string): { cleanHTML: string; usedClasses: Set<string> } {
  const usedClasses = new Set<string>()
  const dom = new JSDOM(html)
  const document = dom.window.document

  // Note: Cette logique d'extraction de classes est maintenue telle quelle
  document.querySelectorAll("[class]").forEach((el) => {
    const classList = (el as HTMLElement).className
    if (typeof classList === "string") {
      classList.split(/\s+/).forEach((cls) => {
        if (cls.trim()) usedClasses.add(cls.trim())
      })
    }
  })

  // Le HTML complet du body est retourné (sans le <script> et <style> qui seront extraits)
  return { cleanHTML: document.body.innerHTML, usedClasses }
}

// --- Route principale (CORRIGÉE) ---

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

        const mainResponse = await fetchUrlContent(urlToAnalyze)
        if (!mainResponse.success) {
          throw new Error("Could not fetch the main HTML content")
        }

        const dom = new JSDOM(mainResponse.content)
        const document = dom.window.document
        const baseURL = new URL(urlToAnalyze).origin

        const { cleanHTML, usedClasses } = processHTML(document.body.innerHTML)
        
        // Extraction CSS
        const cssSources = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
          .map((el) => {
            try { return new URL((el as HTMLLinkElement).href, baseURL).href } catch { return null }
          })
          .filter(Boolean) as string[]

        // Utilisation de Promise.allSettled : garantit que toutes les requêtes se terminent
        const cssFetches = await Promise.allSettled(
          cssSources.map(async (href) => {
            const result = await fetchUrlContent(href)
            // On lève une erreur si le fetch échoue pour marquer la promesse comme 'rejected'
            if (!result.success) throw new Error(`Failed to fetch CSS: ${href}`); 
            return { href, ...result }
          }),
        )

        // Traitement des résultats : on ne prend que les 'fulfilled' (réussis)
        const cssContentFromFetches = cssFetches
          .filter(c => c.status === 'fulfilled')
          .map((c: any) => `/* From: ${c.value.href} */\n${c.value.content}`);
        
        const inlineCss = Array.from(document.querySelectorAll("style"))
          .map((s) => s.textContent || "")
          .filter(Boolean)
          .map((css, i) => `/* Inline style ${i + 1} */\n${css}`);

        const fullCSS = [...cssContentFromFetches, ...inlineCss].join("\n\n");


        // Extraction JS
        const scriptSources = Array.from(document.querySelectorAll("script[src]"))
          .map((el) => {
            try { return new URL((el as HTMLScriptElement).src, baseURL).href } catch { return null }
          })
          .filter(Boolean) as string[]

        // Utilisation de Promise.allSettled pour les scripts
        const scriptFetches = await Promise.allSettled(
          scriptSources.map(async (src) => {
            const result = await fetchUrlContent(src)
            if (!result.success) throw new Error(`Failed to fetch JS: ${src}`); 

            const animationInfo = detectAnimationLibrary(result.content)
            return { src, ...result, ...animationInfo }
          }),
        )

        // Traitement des résultats JS : on ne prend que les 'fulfilled' (réussis)
        const jsContentFromFetches = scriptFetches
          .filter(s => s.status === 'fulfilled')
          .map((s: any) => `/* From: ${s.value.src} */\n${s.value.content}`);

        const inlineJs = Array.from(document.querySelectorAll("script:not([src])"))
          .map((s) => s.textContent || "")
          .filter(Boolean)
          .map((js, i) => `/* Inline script ${i + 1} */\n${js}`);

        const fullJS = [...jsContentFromFetches, ...inlineJs].join("\n\n");


        // RETOUR FINAL DU CONTENU COMPLET ET STRUCTURÉ
        return NextResponse.json({
          success: true,
          fullHTML: cleanHTML,
          fullCSS: fullCSS,    
          fullJS: fullJS,      
        })

    } catch (err: any) {
        // En cas d'erreur fatale (ex: URL principale non récupérée, ou parsing JSON de la requête)
        console.error("[v0] Analysis error:", err)
        return NextResponse.json(
          {
            error: `Analysis failed: ${err.message}`,
            details: err.stack,
          },
          { status: 500 },
        )
    }
}
