import { NextResponse } from "next/server"
import { JSDOM } from "jsdom"
// REMOVED: import crypto from "crypto"

// 🆕 Cache en mémoire pour les résultats d'analyse volumineux
// Key: unique ID, Value: { fullHTML: string, fullCSS: string, fullJS: string }
const analysisCache = new Map<string, { fullHTML: string; fullCSS: string; fullJS: string }>()

/**
 * Génère un ID unique en utilisant le timestamp et un nombre aléatoire,
 * assurant qu'il n'y a pas besoin de packages externes comme 'crypto'.
 */
function generateUniqueId(): string {
  const timestamp = Date.now().toString(36) // Base 36 pour compacité
  const randomPart = Math.random().toString(36).substring(2, 9) // 7 caractères aléatoires
  return timestamp + randomPart
}

// --- Fonctions d'Analyse (Fournies par l'utilisateur) ---

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

function processHTML(html: string): { cleanHTML: string; usedClasses: Set<string> } {
  const usedClasses = new Set<string>()
  const dom = new JSDOM(html)
  const document = dom.window.document

  document.querySelectorAll("[class]").forEach((el) => {
    const classList = (el as HTMLElement).className
    if (typeof classList === "string") {
      classList.split(/\s+/).forEach((cls) => {
        if (cls.trim()) usedClasses.add(cls.trim())
      })
    }
  })

  return { cleanHTML: html, usedClasses }
}

// --- Route principale ---

export async function POST(request: Request) {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')

    // 1. Action de récupération des données volumineuses
    if (action === 'get_data') {
        const id = url.searchParams.get('id')
        if (!id) {
            return NextResponse.json({ error: "Analysis ID is required" }, { status: 400 })
        }
        
        const data = analysisCache.get(id)
        if (!data) {
            // Logique pour s'assurer que si l'ID est trop ancien, la date n'est pas un problème
            return NextResponse.json({ error: "Analysis data not found or expired. Cache is only valid for 5 minutes." }, { status: 404 })
        }

        analysisCache.delete(id) 

        return NextResponse.json({ success: true, ...data })
    }
    
    // 2. Action d'analyse
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

        const cssFetches = await Promise.all(
          cssSources.map(async (href) => {
            const result = await fetchUrlContent(href)
            return { href, ...result }
          }),
        )

        const inlineCss = Array.from(document.querySelectorAll("style"))
          .map((s) => s.textContent || "")
          .filter(Boolean)

        const rawCSS = [
          ...cssFetches.filter((c) => c.success).map((c) => `/* From: ${c.href} */\n${c.content}`),
          ...inlineCss.map((css, i) => `/* Inline style ${i + 1} */\n${css}`),
        ].join("\n\n")

        const fullCSS = rawCSS

        // Extraction JS
        const scriptSources = Array.from(document.querySelectorAll("script[src]"))
          .map((el) => {
            try { return new URL((el as HTMLScriptElement).src, baseURL).href } catch { return null }
          })
          .filter(Boolean) as string[]

        const scriptFetches = await Promise.all(
          scriptSources.map(async (src) => {
            const result = await fetchUrlContent(src)
            const animationInfo = result.success
              ? detectAnimationLibrary(result.content)
              : { isAnimation: false, confidence: 0 }
            return { src, ...result, ...animationInfo }
          }),
        )

        const inlineJs = Array.from(document.querySelectorAll("script:not([src])"))
          .map((s) => s.textContent || "")
          .filter(Boolean)

        const fullJS = [
          ...scriptFetches.filter((s) => s.success).map((s) => `/* From: ${s.src} */\n${s.content}`),
          ...inlineJs.map((js, i) => `/* Inline script ${i + 1} */\n${js}`),
        ].join("\n\n")


        // STOCKAGE TEMPORAIRE ET ID UNIQUE
        const uniqueId = generateUniqueId()
        
        analysisCache.set(uniqueId, {
            fullHTML: cleanHTML, 
            fullCSS: fullCSS,
            fullJS: fullJS,
        })
        
        // Nettoyage après 5 minutes (300 000 ms)
        setTimeout(() => analysisCache.delete(uniqueId), 300000) 

        return NextResponse.json({
          success: true,
          analysisId: uniqueId, // L'ID pour la récupération par le frontend
        })

    } catch (err: any) {
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
  
