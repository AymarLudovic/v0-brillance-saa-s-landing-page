import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { PurgeCSS } from "purgecss";

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
    
    // Nettoyage CSS
    const cleanCSS = (css: string, cssUrl: string) => {
         const cssBase = new URL(cssUrl).origin;
         return css.replace(/url\(['"]?((?!http|data)[^'")]+)['"]?\)/g, `url(${cssBase}/$1)`);
    };

    cssContents.forEach((css, i) => { globalCSS += cleanCSS(css, cssLinks[i]) + "\n"; });
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });

    // Ajout variables vitales par défaut
    globalCSS = `
        :root { --background: #ffffff; --foreground: #000000; }
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        ${globalCSS}
    `;

    // 2. EXTRACTION
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
        
        // --- ASTUCE : Récupérer toutes les classes utilisées dans cet élément ---
        // On va les forcer dans la Safelist pour être sûr que PurgeCSS ne les rate pas
        const usedClasses: string[] = [];
        $el.find('*').addBack().each((_, element) => {
            const cls = $(element).attr('class');
            if (cls) {
                cls.split(/\s+/).forEach(c => {
                    if(c.trim()) usedClasses.push(c.trim());
                });
            }
        });

        // Contexte pour PurgeCSS
        const htmlContext = `<html><body><div id="wrapper">${rawHtml}</div></body></html>`;

        const purgeResult = await new PurgeCSS().purge({
            content: [{ raw: htmlContext, extension: 'html' }],
            css: [{ raw: globalCSS }],
            safelist: {
                standard: [
                    ...UNIVERSAL_TAGS,
                    ...usedClasses, // ON FORCE TOUTES LES CLASSES TROUVÉES
                    'body', 'html', ':root'
                ],
                deep: [/framer-/, /w-/, /data-/], // Regex pour Framer/Webflow
                greedy: [/token/], // Pour les variables Framer --token-xyz
                variables: true,
                keyframes: true
            },
            fontFace: true,
            keyframes: true,
            variables: true
        });

        const isolatedCSS = purgeResult[0]?.css || "";

        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,
            classes: $el.attr("class") || "",
            isolatedCss: isolatedCSS // C'est ici que le CSS filtré se trouve
        });
    };

    const processingPromises: Promise<void>[] = [];

    // SELECTEURS (Inchangés)
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        if ($parent.attr('class')?.match(/group|wrapper|container|field|box|input/i) || $parent.is("label")) {
            // @ts-ignore
            if (!$parent.data('scanned')) { processingPromises.push(processItem('inputs', $parent, 'wrapped')); $parent.data('scanned', true); }
        } else { processingPromises.push(processItem('inputs', el, 'raw')); }
    });

    $("button, a[role='button'], [class*='btn'], .w-button").each((_, el) => {
        if ($(el).text().trim().length < 50) processingPromises.push(processItem('buttons', el, 'detected'));
    });

    $("nav, header").each((_, el) => { if ($(el).find('a').length > 0) processingPromises.push(processItem('navbars', el, 'structure')); });

    $("footer").each((_, el) => { if ($(el).find('a').length > 3) processingPromises.push(processItem('footers', el, 'structure')); });

    $( "article, section, [class*='card'], [class*='container']").each((_, el) => {
        const h = $(el).html() || "";
        const hasMedia = $(el).find('img, svg').length > 0;
        const hasTitle = $(el).find('h1, h2, h3, h4').length > 0;
        if (h.length > 200 && h.length < 5000 && (hasMedia || hasTitle)) processingPromises.push(processItem('cards', el, 'card-detect'));
        else if (h.length > 500 && h.length < 15000 && hasTitle && hasMedia) processingPromises.push(processItem('sections', el, 'section-detect'));
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
        }
