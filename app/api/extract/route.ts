import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { PurgeCSS } from "purgecss";
import juice from "juice";

const UNIVERSAL_TAGS = [
    'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'blockquote', 'a',
    'button', 'input', 'textarea', 'select', 'label', 'form', 'img', 'svg', 'video', 'ul', 'li'
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

    // 1. CSS GLOBAL
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

    globalCSS = `:root { --bg: #fff; } * { box-sizing: border-box; -webkit-font-smoothing: antialiased; } ${globalCSS}`;

    // 2. EXTRACTION
    const extracted = {
      buttons: [] as any[],
      inputs: [] as any[],
      cards: [] as any[],
      navbars: [] as any[],
      rich_blocks: [] as any[] // NOUVEAU : Divs complexes
    };
    let idCounter = 0;

    const processItem = async (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        const usedClasses: string[] = [];
        $el.find('*').addBack().each((_, element) => {
            const cls = $(element).attr('class');
            if (cls) cls.split(/\s+/).forEach(c => { if(c.trim()) usedClasses.push(c.trim()); });
        });

        const htmlContext = `<html><body><div id="wrapper">${rawHtml}</div></body></html>`;

        // A. PURGE CSS (On isole le CSS)
        const purgeResult = await new PurgeCSS().purge({
            content: [{ raw: htmlContext, extension: 'html' }],
            css: [{ raw: globalCSS }],
            fontFace: true, keyframes: true, variables: true,
            safelist: {
                standard: [...UNIVERSAL_TAGS, ...usedClasses, 'body', 'html', ':root', /\*/, /data-/, /::placeholder/, /::before/, /::after/],
                deep: [/^framer-/, /^w-/, /^is-/, /^active/, /^hover/],
                greedy: [/token/]
            }
        });
        const isolatedCSS = purgeResult[0]?.css || "";

        // B. JUICE (On injecte le CSS dans le HTML style="")
        // Cela crée la version "AI Ready"
        const inlinedHTML = juice.inlineContent(rawHtml, isolatedCSS, {
            applyStyleTags: true,
            removeStyleTags: false, // IMPORTANT: On garde les styles qu'on ne peut pas inliner (media queries, hover)
            preserveMediaQueries: true,
            insertPreservedExtraCss: true,
            applyAttributesTableElements: false
        });

        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,          // HTML original (classes)
            isolatedCss: isolatedCSS, // CSS séparé
            inlinedHtml: inlinedHTML, // HTML avec style="..." (Le Graal pour l'IA)
        });
    };

    const processingPromises: Promise<void>[] = [];

    // --- SÉLECTEURS AMÉLIORÉS ---

    // 1. RICH BLOCKS (Texte + Image + Optionnel Bouton)
    // On cherche des divs qui ne sont PAS des sections entières mais des blocs de contenu
    $("div, [class*='wrapper'], [class*='content']").each((_, el) => {
        const $el = $(el);
        // Ne pas scanner le body ou main direct
        if ($el.is('body') || $el.is('main')) return;
        
        const h = $el.html() || "";
        // Critères : Taille moyenne
        if (h.length < 300 || h.length > 8000) return;

        const hasImg = $el.find('img, svg').length > 0;
        const hasText = $el.text().trim().length > 50;
        const hasBtn = $el.find('button, a[class*="btn"]').length > 0;
        const hasTitle = $el.find('h2, h3, h4').length > 0;

        // Cas 1: Texte + Image (Classique)
        if (hasImg && hasText && hasTitle) {
             processingPromises.push(processItem('rich_blocks', el, 'text-image-block'));
        }
        // Cas 2: Texte + Image + Bouton (Call to Action)
        else if (hasImg && hasText && hasBtn) {
             processingPromises.push(processItem('rich_blocks', el, 'cta-block'));
        }
    });

    // 2. INPUTS
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        if ($parent.attr('class')?.match(/group|wrapper|container|field|box|input/i) || $parent.is("label")) {
            // @ts-ignore
            if (!$parent.data('scanned')) { processingPromises.push(processItem('inputs', $parent, 'wrapped')); $parent.data('scanned', true); }
        } else { processingPromises.push(processItem('inputs', el, 'raw')); }
    });

    // 3. BOUTONS
    $("button, a[role='button'], [class*='btn'], .w-button").each((_, el) => {
        if ($(el).text().trim().length < 50) processingPromises.push(processItem('buttons', el, 'detected'));
    });

    // 4. NAVBARS
    $("nav, header").each((_, el) => { if ($(el).find('a').length > 0) processingPromises.push(processItem('navbars', el, 'structure')); });

    // 5. CARDS (Classique)
    $( "article, section, [class*='card']").each((_, el) => {
        const h = $(el).html() || "";
        const hasMedia = $(el).find('img, svg').length > 0;
        const hasTitle = $(el).find('h1, h2, h3, h4').length > 0;
        if (h.length > 200 && h.length < 5000 && (hasMedia || hasTitle)) processingPromises.push(processItem('cards', el, 'card-detect'));
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
          rich_blocks: limit(extracted.rich_blocks, 6) // NOUVEAU
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
