import { NextResponse } from "next/server"

// NOTE: Assurez-vous que vos fonctions utilitaires (fetchUrlContent, detectAnimationLibrary)
// sont définies et disponibles dans le même contexte de fichier.

/**
 * Récupère le contenu d'une URL de manière sécurisée. (Inchangée)
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

        const rawHTML = mainResponse.content
        let baseURL: string
        try {
             baseURL = new URL(urlToAnalyze).origin
        } catch {
             baseURL = urlToAnalyze
        }

        // --- 1. CORRECTION: Extraction des sources CSS externes ---
        // Regex robuste: capture la balise entière (match[0]) et l'URL href (match[2])
        // Elle ne se soucie pas de l'ordre ou des autres attributs.
        const linkHrefCaptureRegex = /(<link\s+[^>]*?href=["']([^"']+)["'][^>]*?>)/gi
        
        const cssSources = [...rawHTML.matchAll(linkHrefCaptureRegex)]
          .filter(match => /rel=["']stylesheet["']/i.test(match[0])) // 🛑 FIX: Filtre sur le rel="stylesheet" dans la balise entière
          .map(match => match[2]) // 🛑 FIX: Extrait l'URL (le second groupe de capture)
          .filter(Boolean)
        // FIN CORRECTION

        // --- 2. Extraction des sources JS externes ---
        const scriptSrcRegex = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi
        const scriptSources = [...rawHTML.matchAll(scriptSrcRegex)]
          .map(match => match[1])
          .filter(Boolean)
        
        // --- 3. Normalisation des URLs (Ajout du domaine si relatif) ---
        const normalizeUrl = (path: string): string | null => {
            try {
                if (path.startsWith('//')) {
                    return `https:${path}`
                }
                return new URL(path, baseURL).href
            } catch {
                return null
            }
        }
        
        const normalizedCssSources = cssSources.map(normalizeUrl).filter(Boolean) as string[]
        const normalizedScriptSources = scriptSources.map(normalizeUrl).filter(Boolean) as string[]


        // --- 4. Fetch et agrégation du CSS ---
        const cssFetches = await Promise.allSettled(
          normalizedCssSources.map(async (href) => {
            const result = await fetchUrlContent(href)
            if (!result.success) throw new Error(`Failed to fetch CSS: ${href}`); 
            return { href, ...result }
          }),
        )

        const cssContentFromFetches = cssFetches
          .filter(c => c.status === 'fulfilled')
          .map((c: any) => `/* From: ${c.value.href} */\n${c.value.content}`);
        
        const inlineCssRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
        const inlineCss = [...rawHTML.matchAll(inlineCssRegex)]
          .map(match => match[1])
          .filter(Boolean)
          .map((css, i) => `/* Inline style ${i + 1} */\n${css}`);

        const fullCSS = [...cssContentFromFetches, ...inlineCss].join("\n\n");


        // --- 5. Fetch et agrégation du JS ---
        const scriptFetches = await Promise.allSettled(
          normalizedScriptSources.map(async (src) => {
            const result = await fetchUrlContent(src)
            if (!result.success) throw new Error(`Failed to fetch JS: ${src}`); 

            const animationInfo = detectAnimationLibrary(result.content)
            return { src, ...result, ...animationInfo }
          }),
        )

        const jsContentFromFetches = scriptFetches
          .filter(s => s.status === 'fulfilled')
          .map((s: any) => `/* From: ${s.value.src} */\n${s.value.content}`);

        // Regex pour capturer le contenu des scripts qui n'ont pas d'attribut src (inline)
        const inlineJsRegex = /<script\b[^>]*>(?:(?!src=["']).)*?([\s\S]*?)<\/script>/gi
        const inlineJs = [...rawHTML.matchAll(inlineJsRegex)]
          .map(match => match[1])
          .filter(Boolean)
          .map((js, i) => `/* Inline script ${i + 1} */\n${js}`);

        const fullJS = [...jsContentFromFetches, ...inlineJs].join("\n\n");
        

        // --- 6. Extraction du HTML du corps (Nettoyage des scripts/styles) ---
        const bodyContentMatch = rawHTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let cleanHTML = bodyContentMatch ? bodyContentMatch[1] : rawHTML;

        cleanHTML = cleanHTML
            .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
            .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '')
            .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, ''); 

        cleanHTML = cleanHTML.trim();

        // RETOUR FINAL DU CONTENU COMPLET ET STRUCTURÉ
        return NextResponse.json({
          success: true,
          fullHTML: cleanHTML,
          fullCSS: fullCSS,    
          fullJS: fullJS,      
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
