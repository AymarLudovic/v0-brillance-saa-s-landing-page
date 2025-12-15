import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import juice from "juice";

// Fonction pour récupérer le contenu d'une URL (HTML ou CSS)
async function fetchResource(url: string) {
    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" }
        });
        if (!res.ok) return "";
        return await res.text();
    } catch (e) {
        return "";
    }
}

// Fonction pour rendre les URLs absolues (images, liens...)
const makeAbsolute = (html: string, baseUrl: string) => {
  return html.replace(/(src|href|srcset)=["']((?!http|data|\/\/)[^"']+)["']/g, (match, attr, path) => {
    try {
      const absUrl = new URL(path, baseUrl).href;
      return `${attr}="${absUrl}"`;
    } catch {
      return match;
    }
  });
};

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "URL requise" }, { status: 400 });

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const baseUrl = new URL(targetUrl).origin;

    // 1. Récupérer le HTML
    const html = await fetchResource(targetUrl);
    if (!html) throw new Error("Impossible de lire le site");

    // 2. Extraire les liens CSS pour les télécharger
    const $temp = cheerio.load(html);
    const cssLinks: string[] = [];
    
    $temp("link[rel='stylesheet']").each((_, el) => {
        const href = $temp(el).attr("href");
        if (href) {
            try { cssLinks.push(new URL(href, baseUrl).href); } catch {}
        }
    });

    // 3. Télécharger tout le CSS en parallèle (Rapide)
    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    
    // On ajoute aussi le CSS <style> inline
    let fullCSS = cssContents.join("\n");
    $temp("style").each((_, el) => { fullCSS += $temp(el).html() + "\n"; });

    // 4. LA MAGIE JUICE : Fusionner HTML + CSS -> HTML avec styles inline
    // Cela transforme <div class="btn"> en <div style="background: blue; padding: 10px;">
    const inlinedHTML = juice.inlineContent(html, fullCSS, { 
        applyStyleTags: true,
        removeStyleTags: true,
        preserveMediaQueries: false 
    });

    // 5. Charger le HTML "Inliné" dans Cheerio pour l'extraction
    const $ = cheerio.load(inlinedHTML);
    const results = { buttons: [] as any[], cards: [] as any[], sidebars: [] as any[] };
    let idCounter = 0;

    // --- LOGIQUE D'EXTRACTION AMÉLIORÉE ---

    // A. BOUTONS (On cherche des classes explicites ou des balises button)
    $("button, a[class*='btn'], a[class*='button'], [role='button']").each((_, el) => {
        const txt = $(el).text().trim();
        // Un bouton ne doit pas être vide, ni être un conteneur géant
        if (txt.length > 0 && txt.length < 60 && $(el).find('div').length < 3) {
            results.buttons.push({
                id: `btn-${idCounter++}`,
                type: 'buttons',
                source: 'cheerio-juice',
                html: makeAbsolute($.html(el), baseUrl) // Le style est déjà inline grâce à Juice !
            });
        }
    });

    // B. CARDS COMPLEXES (Pour éviter le "juste du texte")
    // On cherche des éléments qui ont une certaine STRUCTURE
    $("article, div[class*='card'], div[class*='item'], section, [class*='container']").each((_, el) => {
        const $el = $(el);
        const htmlContent = $el.html() || "";
        
        // CRITÈRES DE QUALITÉ POUR UNE CARD :
        // 1. Pas trop longue (sinon c'est toute la page)
        // 2. Contient au moins une image OU un titre (h2, h3...)
        // 3. Contient un peu de texte
        const hasMedia = $el.find("img, svg").length > 0;
        const hasTitle = $el.find("h2, h3, h4, strong").length > 0;
        
        if (htmlContent.length < 5000 && htmlContent.length > 200 && (hasMedia || hasTitle)) {
             results.cards.push({
                id: `card-${idCounter++}`,
                type: 'cards',
                source: 'cheerio-juice',
                html: makeAbsolute($.html(el), baseUrl)
            });
        }
    });

    // C. SIDEBARS
    $("aside, nav[class*='side'], [class*='sidebar']").each((_, el) => {
        const linkCount = $(el).find("a").length;
        // Une sidebar doit avoir plusieurs liens
        if (linkCount > 3) {
            results.sidebars.push({
                id: `sidebar-${idCounter++}`,
                type: 'sidebars',
                source: 'cheerio-juice',
                html: makeAbsolute($.html(el), baseUrl)
            });
        }
    });

    // Nettoyage : On ne garde que les éléments uniques et on limite la quantité
    const limit = (arr: any[], max: number) => arr.slice(0, max);
    
    return NextResponse.json({
      success: true,
      data: {
          buttons: limit(results.buttons, 15),
          cards: limit(results.cards, 8),
          sidebars: limit(results.sidebars, 3)
      }
    });

  } catch (err: any) {
    console.error("Extraction Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
    }
