import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import juice from "juice";

// Fonction pour récupérer le contenu (HTML ou CSS)
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
    const baseUrl = new URL(targetUrl).origin;

    // 1. Récupération HTML & CSS
    const html = await fetchResource(targetUrl);
    if (!html) throw new Error("Site inaccessible");

    const $ = cheerio.load(html);
    
    // Récupération de TOUS les CSS (Externes + Inline)
    let globalCSS = "";
    const cssLinks: string[] = [];
    
    $("link[rel='stylesheet']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) {
            try { cssLinks.push(new URL(href, baseUrl).href); } catch {}
        }
    });

    // Téléchargement parallèle des CSS pour la vitesse
    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    globalCSS = cssContents.join("\n");
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });

    // Ajout de styles de base pour les inputs (Reset)
    globalCSS += `
      input, textarea, select { font-family: inherit; color: inherit; }
      * { box-sizing: border-box; }
    `;

    // --- 2. LOGIQUE D'EXTRACTION (AVANT INLINING) ---
    const extracted = {
      buttons: [] as any[],
      cards: [] as any[],
      inputs: [] as any[], // NOUVELLE CATÉGORIE
      navbars: [] as any[]
    };
    let idCounter = 0;

    // Helper: Applique Juice (Inline CSS) sur un fragment HTML spécifique
    const processElement = (category: string, el: any, source: string) => {
        // 1. On nettoie l'élément
        const $el = $(el);
        // On récupère le HTML brut de l'élément
        let rawHtml = $.html(el);
        
        // 2. On rend les URLs absolues
        rawHtml = makeAbsolute(rawHtml, baseUrl);

        // 3. MAGIE : On applique le CSS Global UNIQUEMENT sur ce petit morceau
        // Cela transforme les classes en style="..." sans casser la détection globale
        try {
            const inlinedHtml = juice.inlineContent(rawHtml, globalCSS, {
                removeStyleTags: true,
                preserveMediaQueries: false,
                applyAttributesTableElements: false
            });

            extracted[category].push({
                id: `${category}-${idCounter++}`,
                type: category,
                source: source,
                html: inlinedHtml, // C'est ici qu'on a le style inline !
                classes: $el.attr("class") || "" // On garde les classes au cas où
            });
        } catch (e) {
            // Fallback si Juice échoue
            extracted[category].push({
                id: `${category}-${idCounter++}`,
                type: category,
                source: source + '-raw',
                html: rawHtml,
                classes: $el.attr("class") || ""
            });
        }
    };

    // A. INPUTS & TEXTAREAS (LOGIQUE WRAPPER)
    $("input:not([type='hidden']):not([type='submit']), textarea, select").each((_, el) => {
        const $el = $(el);
        const $parent = $el.parent();
        
        // Est-ce que le parent est un wrapper intéressant ?
        // On regarde s'il a une classe spécifique ou s'il est une div/label
        const parentClasses = $parent.attr('class') || "";
        const isWrapper = parentClasses.match(/group|wrapper|container|input|field|box/i) || $parent.is("label") || $parent.hasClass("framer-input");

        if (isWrapper && $parent.get(0).tagName !== 'BODY') {
            // On prend le parent (qui contient l'input + icone + bordure)
            // On vérifie qu'on ne l'a pas déjà pris (via l'ID unique cheerio)
            // @ts-ignore
            if (!$parent.data('scanned')) {
                processElement('inputs', $parent, 'input-wrapper');
                // @ts-ignore
                $parent.data('scanned', true); // Marque comme scanné
            }
        } else {
            // Sinon on prend l'input brut
             processElement('inputs', $el, 'raw-input');
        }
    });

    // B. BOUTONS (LARGE)
    // On inclut Framer, Webflow (w-button), et les div qui agissent comme boutons
    const btnSelectors = [
        "button", 
        "a[role='button']", 
        "input[type='submit']", 
        "[class*='btn']", 
        "[class*='button']",
        ".w-button",
        "[data-framer-name*='Button']",
        "[class*='framer-'][class*='button']"
    ];
    
    $(btnSelectors.join(", ")).each((_, el) => {
        const txt = $(el).text().trim();
        // Filtre léger
        if (txt.length < 60 && $(el).find('div').length < 5) {
            processElement('buttons', el, 'detected');
        }
    });

    // C. NAVBARS
    $("nav, header, .w-nav, [data-framer-name*='Nav']").each((_, el) => {
        if ($(el).find('a').length > 0) {
            processElement('navbars', el, 'structure');
        }
    });

    // D. CARDS (LARGE MAIS INTELLIGENT)
    const cardSelectors = [
        "article", 
        ".card", ".tile", ".item", 
        "[class*='card']", 
        "[class*='container']",
        ".w-dyn-item", // Webflow CMS items
        "[data-framer-name*='Card']",
        "[data-framer-name*='Item']"
    ];

    $(cardSelectors.join(", ")).each((_, el) => {
        const $el = $(el);
        const html = $el.html() || "";
        // Critères : Pas trop gros, contient image OU titre
        const hasContent = html.length > 100 && html.length < 6000;
        const hasMedia = $el.find('img, svg').length > 0;
        const hasTitle = $el.find('h2, h3, h4, strong').length > 0;

        if (hasContent && (hasMedia || hasTitle)) {
             processElement('cards', el, 'smart-detect');
        }
    });

    // Limitation
    const limit = (arr: any[], max: number) => {
        // Dédoublonnage basique sur le HTML
        const unique = new Map();
        arr.forEach(item => unique.set(item.html, item));
        return Array.from(unique.values()).slice(0, max);
    };

    return NextResponse.json({
      success: true,
      data: {
          buttons: limit(extracted.buttons, 15),
          inputs: limit(extracted.inputs, 10), // On renvoie les inputs inlinés !
          navbars: limit(extracted.navbars, 3),
          cards: limit(extracted.cards, 8),
      }
    });

  } catch (err: any) {
    console.error("Extract Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
      }
