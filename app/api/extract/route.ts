import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// --- HELPER : RENDRE LES URLS ABSOLUES ---
const makeAbsolute = (html: string, baseUrl: string) => {
  if (!html) return "";
  return html.replace(/(src|href|srcset|poster|action)=["']((?!http|data|\/\/)[^"']+)["']/g, (match, attr, path) => {
    try { return `${attr}="${new URL(path, baseUrl).href}"`; } catch { return match; }
  });
};

// --- HELPER : EXTRAIRE LE CSS PERTINENT (LA MAGIE) ---
// Cette fonction prend le HTML d'un composant et le GROS CSS du site
// Elle renvoie un PETIT CSS qui ne contient que ce qu'il faut.
const generateIsolatedCSS = (htmlFragment: string, globalCSS: string) => {
    const $ = cheerio.load(htmlFragment);
    
    // 1. Lister toutes les classes utilisées dans le HTML
    const usedClasses = new Set<string>();
    $("*").each((_, el) => {
        const cls = $(el).attr("class");
        if (cls) cls.split(/\s+/).forEach(c => usedClasses.add(`.${c}`));
    });

    // 2. Lister toutes les balises utilisées (input, div, a...)
    const usedTags = new Set<string>();
    $("*").each((_, el) => { usedTags.add(el.tagName.toLowerCase()); });

    // 3. Filtrer le CSS Global ligne par ligne (Approche Regex simplifiée mais robuste)
    // On garde : 
    // - Les @font-face et @keyframes (Vital pour le look)
    // - Les variables :root (Vital pour les couleurs)
    // - Les règles qui contiennent nos classes ou nos tags
    
    let isolatedCSS = "";
    
    // On nettoie les commentaires pour simplifier
    const cleanGlobal = globalCSS.replace(/\/\*[\s\S]*?\*\//g, "");
    
    // Regex pour capturer "Selecteur { Contenu }"
    // Attention : C'est une approximation, pour un parsing parfait il faudrait un parser AST lourds
    // Mais ça suffit pour 95% des cas "Vibe Coding"
    const rules = cleanGlobal.match(/([^{}]+)\{([^{}]+)\}/g) || [];

    // On ajoute toujours les bases vitales
    isolatedCSS += `
        /* BASES VITALES */
        * { box-sizing: border-box; }
        body { margin: 0; font-family: system-ui, sans-serif; }
    `;

    rules.forEach(rule => {
        // Est-ce une règle spéciale ? (@font-face, :root, @media, @keyframes)
        if (rule.match(/@font-face|:root|@keyframes/i)) {
            isolatedCSS += rule + "\n";
            return;
        }

        // On sépare le sélecteur du contenu
        const [selectorPart] = rule.split("{");
        
        // Vérification : Est-ce que ce sélecteur concerne notre HTML ?
        let isRelevant = false;

        // Vérifie les classes
        for (const cls of Array.from(usedClasses)) {
            // On utilise une regex stricte pour éviter que ".btn" match ".btn-large"
            // On cherche la classe suivie d'un espace, point, deux-points ou fin de ligne
            if (selectorPart.includes(cls)) {
                isRelevant = true;
                break;
            }
        }

        // Vérifie les tags (seulement si pas de classe, pour éviter de tout prendre)
        if (!isRelevant) {
             for (const tag of Array.from(usedTags)) {
                // On cherche "input", "input:", "input " etc.
                const tagRegex = new RegExp(`\\b${tag}\\b`, 'i');
                if (tagRegex.test(selectorPart)) {
                    isRelevant = true;
                    break;
                }
            }
        }

        if (isRelevant) {
            isolatedCSS += rule + "\n";
        }
    });

    return isolatedCSS;
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

    // --- 1. CAPTURE DU CSS GLOBAL ---
    let globalCSS = "";
    const cssLinks: string[] = [];
    $("link[rel='stylesheet']").each((_, el) => {
        const href = $(el).attr("href");
        if (href) { try { cssLinks.push(new URL(href, baseUrl).href); } catch {} }
    });

    const cssContents = await Promise.all(cssLinks.map(link => fetchResource(link)));
    
    // Nettoyage des URLs relatives dans le CSS
    const cleanCSS = (css: string, cssUrl: string) => {
         const cssBase = new URL(cssUrl).origin;
         // Remplace url('font.woff') par url('https://site.com/font.woff')
         return css.replace(/url\(['"]?((?!http|data)[^'")]+)['"]?\)/g, `url(${cssBase}/$1)`);
    };

    cssContents.forEach((css, i) => { globalCSS += cleanCSS(css, cssLinks[i]) + "\n"; });
    $("style").each((_, el) => { globalCSS += $(el).html() + "\n"; });


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

    const addItem = (category: keyof typeof extracted, el: any, typeSrc: string) => {
        const $el = $(el);
        const rawHtml = makeAbsolute($.html(el), baseUrl);
        
        // --- NOUVEAU : GÉNÉRATION DU CSS ISOLÉ ---
        // On calcule le CSS spécifique pour cet élément MAINTENANT
        const isolatedCSS = generateIsolatedCSS(rawHtml, globalCSS);

        extracted[category].push({
            id: `${category}-${idCounter++}`,
            type: category,
            source: typeSrc,
            html: rawHtml,
            classes: $el.attr("class") || "",
            // On stocke le CSS isolé DANS l'objet. C'est ça qui sera téléchargé.
            isolatedCss: isolatedCSS 
        });
    };

    // A. INPUTS (Smart Wrapper)
    $("input:not([type='hidden']), textarea, select").each((_, el) => {
        const $parent = $(el).parent();
        const pClass = $parent.attr('class') || "";
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

    // D. FOOTERS
    $("footer, [class*='footer']").each((_, el) => {
        if ($(el).find('a').length > 3) addItem('footers', el, 'structure');
    });

    // E. CARDS & SECTIONS
    const containerSel = "article, section, [class*='card'], [class*='container'], [class*='wrapper'], [class*='box']";
    $(containerSel).each((_, el) => {
        const h = $(el).html() || "";
        const $el = $(el);
        const hasMedia = $el.find('img, svg').length > 0;
        const hasTitle = $el.find('h1, h2, h3, h4').length > 0;
        
        if (h.length > 200 && h.length < 5000 && (hasMedia || hasTitle)) {
             addItem('cards', el, 'card-detect');
        } else if (h.length > 500 && h.length < 15000 && hasTitle && hasMedia) {
             addItem('sections', el, 'section-detect');
        }
    });

    const limit = (arr: any[], max: number) => {
        const unique = new Map();
        arr.forEach(item => unique.set(item.html, item));
        return Array.from(unique.values()).slice(0, max);
    };

    return NextResponse.json({
      success: true,
      globalCSS: globalCSS, // On renvoie toujours le gros CSS pour le mode "Full"
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
