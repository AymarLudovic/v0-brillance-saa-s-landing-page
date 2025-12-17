import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { PurgeCSS } from "purgecss";
import juice from "juice";

// Tags HTML à protéger absolument
const UNIVERSAL_TAGS = [
    'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'blockquote', 'pre', 'code', 'a',
    'button', 'input', 'textarea', 'select', 'label', 'form', 'fieldset', 'legend',
    'img', 'svg', 'video', 'figure', 'figcaption', 'ul', 'ol', 'li', 'table', 'td', 'th', 'tr'
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
      sidebars: [] as any[], // NOUVEAU: Sidebar explicite
      rich_blocks: [] as any[]
    };
    let idCounter = 0;

    const processItem = async (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        // Extraction manuelle des classes
        const usedClasses = new Set<string>();
        const rootClasses = $el.attr('class');
        if (rootClasses) rootClasses.split(/\s+/).forEach(c => usedClasses.add(c));
        $el.find('*').each((_, child) => {
            const childClasses = $(child).attr('class');
            if (childClasses) childClasses.split(/\s+/).forEach(c => { if(c.trim()) usedClasses.add(c.trim()); });
        });

        const htmlContext = `<html><body><div id="wrapper">${rawHtml}</div></body></html>`;

        // A. PURGE CSS
        const purgeResult = await new PurgeCSS().purge({
            content: [{ raw: htmlContext, extension: 'html' }],
            css: [{ raw: globalCSS }],
            fontFace: true, keyframes: true, variables: true,
            safelist: {
                standard: [...UNIVERSAL_TAGS, ...Array.from(usedClasses), 'body', 'html', ':root', /\*/, /data-/, /::placeholder/, /::before/, /::after/],
                deep: [/^framer-/, /^w-/, /^is-/, /^active/, /^hover/, /^btn/, /^nav/, /^sidebar/], // Plus permissif
                greedy: [/token/]
            }
        });
        const isolatedCSS = purgeResult[0]?.css || "";

        // B. JUICE
        const inlinedHTML = juice.inlineContent(rawHtml, isolatedCSS, {
            applyStyleTags: true,
            removeStyleTags: false,
            preserveMediaQueries: true,
            insertPreservedExtraCss: true, 
            applyAttributesTableElements: false
        });

        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,          
            isolatedCss: isolatedCSS,
            ai_hybrid: inlinedHTML 
        });
    };

    const processingPromises: Promise<void>[] = [];

    // --- SÉLECTEURS HEURISTIQUES AVANCÉS ---

    // 1. SIDEBARS (Divs cachées)
    // On cherche: aside, ou div avec class 'sidebar'/'drawer', ou nav verticale
    $("aside, nav, div[class*='sidebar'], div[class*='drawer'], div[class*='menu'], div[class*='panel']").each((_, el) => {
        const $el = $(el);
        const txt = $el.text().trim();
        const linkCount = $el.find('a').length;
        const hasList = $el.find('ul, ol').length > 0;
        
        // Une sidebar a souvent beaucoup de liens sous forme de liste, mais pas trop de texte "paragraphe"
        if (linkCount > 3 && hasList && txt.length < 2000) {
            // On vérifie si c'est pas une navbar horizontale (souvent <header>)
            if (!$el.is('header') && !$el.closest('header').length) {
                processingPromises.push(processItem('sidebars', el, 'sidebar-heuristic'));
            }
        }
    });

    // 2. BLOCS RICHES (Hero, Features, CTA)
    $("section, header, div[class*='hero'], div[class*='feature'], div[class*='cta'], div[class*='wrapper'], div[class*='container']").each((_, el) => {
        const $el = $(el);
        // Pas le body ni main
        if ($el.is('body') || $el.is('main')) return;

        const h = $el.html() || "";
        // Taille minimale pour un bloc riche
        if (h.length < 200) return;

        // Score de "Richesse"
        let score = 0;
        if ($el.find('h1, h2, h3').length > 0) score += 2; // Titre
        if ($el.find('p').length > 0) score += 1; // Texte
        if ($el.find('img, svg, video').length > 0) score += 2; // Média
        if ($el.find('a[class*="btn"], button').length > 0) score += 2; // Action

        // Si score élevé, c'est un bloc intéressant
        if (score >= 4) {
             processingPromises.push(processItem('rich_blocks', el, 'rich-block-score-' + score));
        }
    });

    // 3. CARDS (Divs répétitives)
    // On cherche des éléments qui ont des "frères" similaires
    $("div, article, li").each((_, el) => {
        const $el = $(el);
        const $siblings = $el.siblings();
        
        // Si l'élément a au moins 2 frères du même tag
        if ($siblings.length >= 2 && $el.prop('tagName') === $siblings.first().prop('tagName')) {
            // Et qu'il a du contenu (Image + Titre)
            const hasMedia = $el.find('img, svg').length > 0;
            const hasTitle = $el.find('h3, h4, h5, strong').length > 0;
            const hasLink = $el.find('a').length > 0 || $el.parent('a').length > 0;

            if ((hasMedia && hasTitle) || (hasTitle && hasLink)) {
                // On évite les doublons (si le parent est déjà pris comme rich_block, c'est pas grave, on prend quand même pour la granularité)
                if ($el.html()!.length < 3000) { // Pas trop gros
                    processingPromises.push(processItem('cards', el, 'sibling-pattern'));
                }
            }
        }
    });

    // 4. BUTTONS & LINKS (Détection large)
    $("button, a, input[type='submit'], div[role='button']").each((_, el) => {
        const $el = $(el);
        const cls = $el.attr('class') || "";
        const txt = $el.text().trim();
        
        // Est-ce que ça ressemble à un bouton ?
        const isBtnClass = cls.match(/btn|button|cta|primary|secondary/i);
        const isClickable = $el.is('button') || $el.attr('role') === 'button';
        const isShortLink = $el.is('a') && txt.length < 30 && txt.length > 0 && cls.length > 0; // Lien court avec classe

        if ((isBtnClass || isClickable || isShortLink) && $el.find('div').length < 2) {
             processingPromises.push(processItem('buttons', el, 'btn-heuristic'));
        }
    });

    // 5. INPUTS (Inchangé car marche bien)
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        if ($parent.attr('class')?.match(/group|wrapper|container|field|box|input/i) || $parent.is("label")) {
            // @ts-ignore
            if (!$parent.data('scanned')) { processingPromises.push(processItem('inputs', $parent, 'wrapped')); $parent.data('scanned', true); }
        } else { processingPromises.push(processItem('inputs', el, 'raw')); }
    });

    // 6. NAVBARS (Structure classique)
    $("nav, header").each((_, el) => {
         // Doit être en haut ou avoir une nav
         if ($(el).find('a').length > 2 && $(el).html()!.length > 100) {
             processingPromises.push(processItem('navbars', el, 'structure'));
         }
    });

    await Promise.all(processingPromises);

    // Fonction de dédoublonnage strict (sur le HTML pur)
    const uniqueFilter = (arr: any[], max: number) => {
        const seen = new Set();
        const result = [];
        for (const item of arr) {
            // On nettoie un peu le HTML pour comparer (enlever les espaces)
            const sign = item.html.replace(/\s/g, ''); 
            if (!seen.has(sign)) {
                seen.add(sign);
                result.push(item);
            }
            if (result.length >= max) break;
        }
        return result;
    };

    return NextResponse.json({
      success: true,
      globalCSS: globalCSS,
      data: {
          buttons: uniqueFilter(extracted.buttons, 20), // Plus de boutons
          inputs: uniqueFilter(extracted.inputs, 10),
          cards: uniqueFilter(extracted.cards, 12),
          sidebars: uniqueFilter(extracted.sidebars, 3),
          navbars: uniqueFilter(extracted.navbars, 2),
          rich_blocks: uniqueFilter(extracted.rich_blocks, 8)
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
                      }
