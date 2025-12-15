import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Helper pour rendre les URLs absolues (Images et Liens)
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

// Helper pour récupérer le texte d'une URL
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

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "URL requise" }, { status: 400 });

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const baseUrl = new URL(targetUrl).origin;

    // 1. Récupération du HTML
    const html = await fetchResource(targetUrl);
    if (!html) throw new Error("Impossible de lire le site");

    const $ = cheerio.load(html);

    // --- 2. RÉCUPÉRATION MASSIVE DU CSS ---
    // On va construire un "Blob" de CSS géant contenant tout le style du site
    let globalCSS = "";
    const cssLinks: string[] = [];
    
    // A. Liens externes (<link rel="stylesheet">)
    $("link[rel='stylesheet']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
            try { cssLinks.push(new URL(href, baseUrl).href); } catch {}
        }
    });

    // B. Téléchargement parallèle (Rapide)
    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    globalCSS += cssContents.join("\n");

    // C. Styles Inline (<style>...</style>)
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });

    // D. Petit fix pour les fonts relatives dans le CSS (Optionnel mais utile)
    // On essaie de remplacer grossièrement les urls relatives dans le CSS
    // globalCSS = globalCSS.replace(/url\(['"]?((?!http|data)[^'")]+)['"]?\)/g, `url(${baseUrl}/$1)`);


    // --- 3. EXTRACTION DES COMPOSANTS (HTML BRUT) ---
    // Note: On ne fait plus d'inlining ici. On prend le HTML tel quel (avec ses classes).
    // C'est l'iframe qui fera le lien avec le CSS global.
    
    const extracted = {
      buttons: [] as any[],
      inputs: [] as any[],
      cards: [] as any[],
      navbars: [] as any[]
    };
    let idCounter = 0;

    const addItem = (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        // Important : On rend les images absolues, sinon elles seront cassées dans l'iframe
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml, // HTML Brut avec classes
            classes: $el.attr("class") || ""
        });
    };

    // --- SÉLECTEURS (Les mêmes qu'avant, robustes) ---

    // A. INPUTS WRAPPERS
    $("input:not([type='hidden']):not([type='submit']), textarea, select").each((_, el) => {
        const $el = $(el);
        const $parent = $el.parent();
        const parentClass = $parent.attr('class') || "";
        const isWrapper = parentClass.match(/group|wrapper|container|input|field|box/i) || $parent.is("label");

        // @ts-ignore
        if (isWrapper && !$parent.data('scanned')) {
            addItem('inputs', $parent, 'wrapped');
            // @ts-ignore
            $parent.data('scanned', true);
        } else if (!isWrapper) {
            addItem('inputs', $el, 'raw');
        }
    });

    // B. BOUTONS
    const btnSel = ["button", "a[role='button']", "[class*='btn']", "[class*='button']", ".w-button", "[data-framer-name*='Button']"];
    $(btnSel.join(", ")).each((_, el) => {
        if ($(el).text().trim().length < 60 && $(el).find('div').length < 5) {
            addItem('buttons', el, 'detected');
        }
    });

    // C. CARDS
    const cardSel = ["article", "[class*='card']", "[class*='container']", ".w-dyn-item", "[data-framer-name*='Card']"];
    $(cardSel.join(", ")).each((_, el) => {
        const h = $(el).html() || "";
        const hasMedia = $(el).find('img, svg').length > 0;
        const hasTitle = $(el).find('h2, h3, h4, strong').length > 0;
        if (h.length > 100 && h.length < 6000 && (hasMedia || hasTitle)) {
             addItem('cards', el, 'smart-detect');
        }
    });

    // D. NAVBARS
    $("nav, header, [data-framer-name*='Nav']").each((_, el) => {
        if ($(el).find('a').length > 0) addItem('navbars', el, 'structure');
    });

    // Limitation des résultats
    const limit = (arr: any[], max: number) => {
        const unique = new Map();
        arr.forEach(item => unique.set(item.html, item));
        return Array.from(unique.values()).slice(0, max);
    };

    return NextResponse.json({
      success: true,
      // ON RENVOIE TOUT LE CSS DU SITE ICI
      globalCSS: globalCSS, 
      data: {
          buttons: limit(extracted.buttons, 15),
          inputs: limit(extracted.inputs, 10),
          cards: limit(extracted.cards, 8),
          navbars: limit(extracted.navbars, 3),
      }
    });

  } catch (err: any) {
    console.error("Extract Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
        }
