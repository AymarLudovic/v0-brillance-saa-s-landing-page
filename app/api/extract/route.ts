import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Helper URLs absolues
const makeAbsolute = (html: string, baseUrl: string) => {
  if (!html) return "";
  return html.replace(/(src|href|srcset|poster)=["']((?!http|data|\/\/)[^"']+)["']/g, (match, attr, path) => {
    try { return `${attr}="${new URL(path, baseUrl).href}"`; } catch { return match; }
  });
};

// Helper Fetch CSS
async function fetchResource(url: string) {
    try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" } });
        if (!res.ok) return "";
        return await res.text();
    } catch (e) { return ""; }
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "URL requise" }, { status: 400 });

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const baseUrl = new URL(targetUrl).origin;

    const html = await fetchResource(targetUrl);
    if (!html) throw new Error("Site inaccessible");

    const $ = cheerio.load(html);

    // --- 1. CAPTURE DU CSS GLOBAL (CRITIQUE) ---
    // On veut TOUT : @font-face, :root variables, body reset, tout.
    let globalCSS = `
        /* Reset de sécurité pour l'isolation */
        * { box-sizing: border-box; } 
        body { margin: 0; min-height: 100vh; }
    `;
    
    const cssLinks: string[] = [];
    $("link[rel='stylesheet']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) { try { cssLinks.push(new URL(href, baseUrl).href); } catch {} }
    });

    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    
    // On nettoie un peu le CSS pour éviter les erreurs de parsing d'URLs relatives dans le CSS
    const cleanCSS = (css: string, cssUrl: string) => {
         // Petite regex pour rendre les url() absolues dans le CSS
         const cssBase = new URL(cssUrl).origin; // Simplification
         return css.replace(/url\(['"]?((?!http|data)[^'")]+)['"]?\)/g, `url(${cssBase}/$1)`);
    };

    cssContents.forEach((css, i) => {
        globalCSS += `\n/* Source: ${cssLinks[i]} */\n` + cleanCSS(css, cssLinks[i]);
    });
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });


    // --- 2. EXTRACTION AMÉLIORÉE ---
    const extracted = {
      buttons: [] as any[],
      inputs: [] as any[],
      cards: [] as any[],
      navbars: [] as any[],
      footers: [] as any[], // NOUVEAU
      sections: [] as any[] // NOUVEAU (Divs complexes)
    };
    let idCounter = 0;

    const addItem = (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,
            classes: $el.attr("class") || "",
            // On ajoute une info sur les dimensions estimées (via attributs ou style inline)
            meta: { tagName: el.tagName }
        });
    };

    // A. INPUTS WRAPPERS (Smart Detection)
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        const pClass = $parent.attr('class') || "";
        // Si le parent ressemble à un container d'input
        if (pClass.match(/group|wrapper|container|field|box|input/i) || $parent.is("label")) {
            // @ts-ignore
            if (!$parent.data('scanned')) { addItem('inputs', $parent, 'wrapped'); $parent.data('scanned', true); }
        } else {
            addItem('inputs', el, 'raw');
        }
    });

    // B. BOUTONS
    $("button, a[role='button'], [class*='btn'], [class*='button'], .w-button").each((_, el) => {
        if ($(el).text().trim().length < 50 && $(el).find('div').length < 3) addItem('buttons', el, 'detected');
    });

    // C. NAVBARS
    $("nav, header, [role='banner']").each((_, el) => {
        if ($(el).find('a').length > 0) addItem('navbars', el, 'structure');
    });

    // D. FOOTERS (NOUVEAU)
    $("footer, [class*='footer'], [class*='bottom']").each((_, el) => {
        // Un footer doit avoir des liens et être assez gros
        if ($(el).find('a').length > 3 && $(el).html()!.length > 200) {
            addItem('footers', el, 'structure');
        }
    });

    // E. CARDS & SECTIONS (AMÉLIORÉ)
    // On cherche des divs qui ont une classe intéressante
    const containerSel = "article, section, [class*='card'], [class*='container'], [class*='wrapper'], [class*='section'], [class*='box']";
    $(containerSel).each((_, el) => {
        const h = $(el).html() || "";
        const $el = $(el);
        
        // Critères de qualité
        const hasMedia = $el.find('img, svg, video').length > 0;
        const hasTitle = $el.find('h1, h2, h3, h4, h5').length > 0;
        const hasText = $el.text().trim().length > 30;
        
        // C'est une CARD si c'est moyen et a du média/titre
        if (h.length > 200 && h.length < 5000 && (hasMedia || hasTitle)) {
             addItem('cards', el, 'card-detect');
        }
        // C'est une SECTION si c'est gros et structuré
        else if (h.length > 500 && h.length < 15000 && hasTitle && hasMedia) {
             addItem('sections', el, 'section-detect');
        }
    });

    // Limitation
    const limit = (arr: any[], max: number) => {
        const unique = new Map();
        arr.forEach(item => unique.set(item.html, item));
        return Array.from(unique.values()).slice(0, max);
    };

    return NextResponse.json({
      success: true,
      globalCSS: globalCSS,
      data: {
          buttons: limit(extracted.buttons, 15),
          inputs: limit(extracted.inputs, 10),
          cards: limit(extracted.cards, 8),
          navbars: limit(extracted.navbars, 2),
          footers: limit(extracted.footers, 2),
          sections: limit(extracted.sections, 3)
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
                    }
