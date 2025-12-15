import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { PurgeCSS } from "purgecss";

// --- LISTE DES TAGS À NE JAMAIS SUPPRIMER ---
// C'est ça qui garantit que le "Vibe" global (typo, spacing) reste
const UNIVERSAL_TAGS = [
    // Structure
    'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside',
    // Texte
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a',
    // Formulaires (CRUCIAL pour toi)
    'button', 'input', 'textarea', 'select', 'label', 'form', 'fieldset', 'legend',
    // Média
    'img', 'svg', 'video', 'figure', 'figcaption'
];

const makeAbsolute = (html: string, baseUrl: string) => {
  if (!html) return "";
  return html.replace(/(src|href|srcset|poster|action)=["']((?!http|data|\/\/)[^"']+)["']/g, (match, attr, path) => {
    try { return `${attr}="${new URL(path, baseUrl).href}"`; } catch { return match; }
  });
};

async function fetchResource(url: string) {
    try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
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

    // --- 1. ASSEMBLAGE CSS GLOBAL ---
    let globalCSS = "";
    const cssLinks: string[] = [];
    $("link[rel='stylesheet']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) { try { cssLinks.push(new URL(href, baseUrl).href); } catch {} }
    });

    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    
    const cleanCSS = (css: string, cssUrl: string) => {
         const cssBase = new URL(cssUrl).origin;
         return css.replace(/url\(['"]?((?!http|data)[^'")]+)['"]?\)/g, `url(${cssBase}/$1)`);
    };

    cssContents.forEach((css, i) => { globalCSS += cleanCSS(css, cssLinks[i]) + "\n"; });
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });

    // Ajout de styles par défaut vitaux au cas où
    globalCSS = `
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        input, textarea, button, select, a { font-family: inherit; color: inherit; }
        ${globalCSS}
    `;

    // --- 2. EXTRACTION ---
    const extracted = {
      buttons: [] as any[],
      inputs: [] as any[],
      cards: [] as any[],
      navbars: [] as any[],
      footers: [] as any[],
      sections: [] as any[]
    };
    let idCounter = 0;

    const processItem = async (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        // On encapsule pour le contexte
        const htmlContext = `<html><body><div id="wrapper">${rawHtml}</div></body></html>`;

        const purgeResult = await new PurgeCSS().purge({
            content: [{ raw: htmlContext, extension: 'html' }],
            css: [{ raw: globalCSS }],
            
            // --- LA PROTECTION ULTIME ---
            safelist: {
                standard: [
                    ...UNIVERSAL_TAGS, // On protège tous les tags HTML de base
                    /:root/,           // On protège les variables
                    /\*/,              // On protège le sélecteur universel
                    /data-/,           // On protège les data-attributes
                    /::placeholder/,   // On protège les placeholders
                    /::before/,        // On protège les pseudo-éléments
                    /::after/
                ],
                deep: [
                    /^framer-/,     // Frameworks
                    /^w-/, 
                    /^is-/,         // États (is-active, is-open)
                    /^active/,
                    /^hover/
                ],
                greedy: [], 
                variables: true,    // Garder les variables CSS utilisées
                keyframes: true     // Garder les animations
            },
            fontFace: true,         // Garder les fonts
            keyframes: true         // Garder les keyframes
        });

        const isolatedCSS = purgeResult[0]?.css || "";

        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,
            classes: $el.attr("class") || "",
            isolatedCss: isolatedCSS 
        });
    };

    const processingPromises: Promise<void>[] = [];

    // A. INPUTS (Smart)
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        const pClass = $parent.attr('class') || "";
        if (pClass.match(/group|wrapper|container|field|box|input/i) || $parent.is("label")) {
            // @ts-ignore
            if (!$parent.data('scanned')) { 
                processingPromises.push(processItem('inputs', $parent, 'wrapped')); 
                // @ts-ignore
                $parent.data('scanned', true); 
            }
        } else {
            processingPromises.push(processItem('inputs', el, 'raw'));
        }
    });

    // B. BOUTONS
    $("button, a[role='button'], [class*='btn'], [class*='button'], .w-button").each((_, el) => {
        if ($(el).text().trim().length < 50 && $(el).find('div').length < 3) 
            processingPromises.push(processItem('buttons', el, 'detected'));
    });

    // C. NAVBARS
    $("nav, header, [role='banner']").each((_, el) => {
        if ($(el).find('a').length > 0) processingPromises.push(processItem('navbars', el, 'structure'));
    });

    // D. FOOTERS
    $("footer, [class*='footer']").each((_, el) => {
        if ($(el).find('a').length > 3) processingPromises.push(processItem('footers', el, 'structure'));
    });

    // E. CARDS & SECTIONS
    const containerSel = "article, section, [class*='card'], [class*='container'], [class*='wrapper'], [class*='box']";
    $(containerSel).each((_, el) => {
        const h = $(el).html() || "";
        const $el = $(el);
        const hasMedia = $el.find('img, svg').length > 0;
        const hasTitle = $el.find('h1, h2, h3, h4').length > 0;
        
        if (h.length > 200 && h.length < 5000 && (hasMedia || hasTitle)) {
             processingPromises.push(processItem('cards', el, 'card-detect'));
        } else if (h.length > 500 && h.length < 15000 && hasTitle && hasMedia) {
             processingPromises.push(processItem('sections', el, 'section-detect'));
        }
    });

    await Promise.all(processingPromises);

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
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  }
