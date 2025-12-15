import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Fonction pour rendre les URLs absolues
const makeAbsolute = (html: string, baseUrl: string) => {
  if (!html) return "";
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
    
    const response = await fetch(targetUrl, {
        headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        }
    });
    
    if (!response.ok) throw new Error("Impossible d'accéder au site");

    const html = await response.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(targetUrl).origin;

    // --- 1. EXTRACTION DU CSS ---
    let globalCSS = "";
    
    $("link[rel='stylesheet']").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try {
            const absHref = href.startsWith("http") ? href : new URL(href, baseUrl).href;
            globalCSS += `<link rel="stylesheet" href="${absHref}" />\n`;
        } catch(e) {}
      }
    });

    $("style").each((_, el) => {
      globalCSS += `<style>${$(el).html()}</style>\n`;
    });

    // --- 2. EXTRACTION INTELLIGENTE ---
    const extracted = {
      buttons: [] as any[],
      cards: [] as any[],
      navbars: [] as any[],
      sidebars: [] as any[] // NOUVEAU
    };

    let idCounter = 0;

    // Helper générique
    const addItem = (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const htmlContent = makeAbsolute($.html(el), baseUrl);
        
        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: htmlContent,
            classes: $el.attr("class") || ""
        });
    };

    // A. BOUTONS
    // On cherche les boutons explicites et les liens qui ressemblent à des boutons
    $("button, a[role='button'], input[type='submit'], [class*='btn'], [class*='button']").each((_, el) => {
        const txt = $(el).text().trim();
        const classes = $(el).attr('class') || "";
        
        // Filtre : Pas de conteneurs vides, pas de wrappers géants
        if (txt.length > 0 && txt.length < 50 && !classes.includes('container') && !classes.includes('wrapper')) {
            addItem('buttons', el, 'detected');
        }
    });

    // B. NAVBARS
    $("nav, header, [role='banner'], .navbar, .nav-wrapper").each((_, el) => {
        // Une navbar doit avoir des liens
        if ($(el).find('a').length > 0) {
            addItem('navbars', el, 'structure');
        }
    });

    // C. SIDEBARS / ASIDES (NOUVEAU)
    $("aside, [role='complementary'], .sidebar, .drawer, [class*='sidebar']").each((_, el) => {
        const $el = $(el);
        // Une vraie sidebar contient généralement une liste de navigation (au moins 3 liens)
        // et a une hauteur significative (difficile à tester avec Cheerio, donc on se fie au contenu)
        const linkCount = $el.find('a').length;
        if (linkCount >= 3) {
            addItem('sidebars', el, 'structure');
        }
    });

    // D. CARDS (AMÉLIORÉ : Fini les faux positifs texte)
    const cardSelectors = "article, .card, .tile, .item, .box, [class*='card'], [class*='container']";
    
    $(cardSelectors).each((_, el) => {
        const $el = $(el);
        const htmlLen = $el.html()?.length || 0;
        const textLen = $el.text().trim().length;

        // CRITÈRES DE QUALITÉ STRICTS :
        // 1. Taille raisonnable (pas toute la page, pas un micro truc)
        // 2. DOIT contenir (Une Image OU un SVG) OU (Un Titre h2-h6)
        // 3. DOIT contenir un peu de texte descriptif
        
        const hasMedia = $el.find('img, svg').length > 0;
        const hasTitle = $el.find('h2, h3, h4, h5, h6, strong').length > 0;
        const isNotHuge = htmlLen < 5000;
        const isNotTiny = textLen > 30;

        if (isNotHuge && isNotTiny && (hasMedia || hasTitle)) {
             // On vérifie qu'on a pas déjà pris le parent (évite les doublons imbriqués)
             // C'est dur avec Cheerio pur, donc on fait confiance au filtre unique à la fin
             addItem('cards', el, 'smart-detect');
        }
    });


    // E. NETTOYAGE ET LIMITATION
    const uniqueFilter = (items: any[], limit: number) => {
        const seen = new Set();
        const result = [];
        for (const item of items) {
            // On utilise une signature simple pour détecter les doublons visuels
            const signature = item.html.length + item.classes; 
            if (!seen.has(signature)) {
                seen.add(signature);
                result.push(item);
            }
            if (result.length >= limit) break;
        }
        return result;
    };

    return NextResponse.json({
      success: true,
      globalCSS, 
      data: {
          buttons: uniqueFilter(extracted.buttons, 15),
          navbars: uniqueFilter(extracted.navbars, 3),
          sidebars: uniqueFilter(extracted.sidebars, 3),
          cards: uniqueFilter(extracted.cards, 10),
      }
    });

  } catch (err: any) {
    console.error("Extract Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
