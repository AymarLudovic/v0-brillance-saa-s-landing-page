import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

// C'est la fonction qui sera exécutée DANS le vrai navigateur
// Elle va transformer les classes CSS en styles inline (style="...")
const inlineComputedStyles = (rootElement: Element) => {
    const importantProperties = [
        // Layout & Box Model
        'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
        'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        // Flex & Grid
        'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'gap',
        'grid-template-columns', 'grid-template-rows',
        // Typography
        'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'color', 'text-transform', 'letter-spacing',
        // Visuals
        'background-color', 'background-image', 'background-size', 'background-position',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
        'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
        'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
        'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
        'box-shadow', 'opacity', 'overflow', 'transform', 'backdrop-filter'
    ];

    // Fonction récursive qui parcourt l'élément et tous ses enfants
    const traverse = (el: Element) => {
        if (!(el instanceof HTMLElement)) return;

        const computed = window.getComputedStyle(el);
        let styleString = "";

        importantProperties.forEach(prop => {
            const value = computed.getPropertyValue(prop);
            // On ne garde que les valeurs qui ne sont pas "par défaut" pour alléger
            if (value && value !== 'auto' && value !== 'normal' && value !== 'none' && value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
                // Petit hack pour les couleurs: convertir rgb en hex si possible est mieux, mais rgb marche.
                styleString += `${prop}:${value};`;
            }
        });

        // On applique le style calculé directement sur l'élément
        el.setAttribute('style', styleString);
        
        // On retire les classes pour prouver que le style est bien inline
        el.removeAttribute('class');

        // On continue sur les enfants
        Array.from(el.children).forEach(child => traverse(child));
    };

    // On lance le processus sur l'élément racine
    traverse(rootElement);
    
    // On nettoie les balises inutiles à l'intérieur
    rootElement.querySelectorAll('script, style, noscript, iframe, svg[aria-hidden="true"]').forEach(e => e.remove());
    
    return rootElement.outerHTML;
};


export async function POST(request: Request) {
  let browser;
  try {
    const { url } = await request.json();
    if (!url) return NextResponse.json({ error: "URL requise" }, { status: 400 });

    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    
    // 1. Lancement du navigateur
    browser = await puppeteer.launch({ 
        headless: "new", // Mode sans interface graphique
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Nécessaire pour certains environnements
    });
    const page = await browser.newPage();

    // On se fait passer pour un vrai desktop pour avoir la version complète du site
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    console.log(`[Puppeteer] Navigation vers ${targetUrl}...`);
    // On attend que le réseau soit calme (signe que le site a fini de charger)
    await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 60000 });


    // 2. Injection du script d'extraction et d'inlining CSS DANS la page
    // Tout ce qui est dans evaluate() s'exécute dans le contexte du site distant
    const extractedData = await page.evaluate((inlineStylesFnStr) => {
        // On recrée la fonction d'inlining dans le contexte de la page
        // @ts-ignore
        const inlineComputedStyles = new Function('return ' + inlineStylesFnStr)();

        const results = {
            buttons: [] as any[],
            cards: [] as any[],
            sidebars: [] as any[], // NOUVEAU TYPE
        };

        // Helper d'ajout
        let idCounter = 0;
        const addItem = (category: keyof typeof results, elements: NodeListOf<Element> | Element[], source: string) => {
            elements.forEach(el => {
                if (!(el instanceof HTMLElement)) return;
                
                // Filtres de qualité
                const text = el.innerText.trim();
                const hasMedia = el.querySelector('img, svg, video');
                const rect = el.getBoundingClientRect();

                if (rect.width === 0 || rect.height === 0) return; // Élément invisible

                let isValid = false;
                // Logique spécifique par catégorie
                if (category === 'buttons' && (text.length > 0 || hasMedia) && rect.height < 100) isValid = true;
                // Cards complexes : doivent avoir du contenu mixte et une certaine taille
                if (category === 'cards' && rect.height > 100 && rect.width > 100 && (text.length > 50 || hasMedia)) isValid = true;
                // Sidebar : Doit être grand verticalement et sur le côté
                if (category === 'sidebars' && rect.height > 500 && rect.width < 400) isValid = true;

                if (isValid) {
                    // C'EST ICI QUE LA MAGIE OPÈRE : ON INLINE LE CSS
                    const inlinedHTML = inlineComputedStyles(el.cloneNode(true)); // On clone pour ne pas casser la vraie page
                    
                    results[category].push({
                        id: `${category}-${idCounter++}`,
                        type: category,
                        source,
                        html: inlinedHTML,
                        // Plus besoin de classes, le style est inline !
                    });
                }
            });
        };

        // --- SÉLECTEURS AMÉLIORÉS ---

        // A. BOUTONS
        addItem('buttons', document.querySelectorAll('button, a[role="button"], [class*="btn"], [class*="button"]'), 'generic');

        // B. CARDS COMPLEXES (On cherche des structures riches)
        // On cherche des articles, des sections, ou des div profondes qui contiennent des titres ET des images
        const potentialCards = Array.from(document.querySelectorAll('article, section, div[class*="card"], div[class*="container"]')).filter(el => {
             return el.querySelector('h2, h3, h4') && (el.querySelector('img') || el.querySelector('p'));
        });
        addItem('cards', potentialCards, 'complex-structure');
        // Support spécifique Framer/Webflow
        addItem('cards', document.querySelectorAll('[data-framer-name*="Card"], .w-dyn-item'), 'framework');

        // C. SIDEBARS / ASIDES (Nouveau)
        addItem('sidebars', document.querySelectorAll('aside, [role="complementary"], [class*="sidebar"], [class*="drawer"]'), 'structure');


        // Limitation des résultats pour ne pas surcharger le retour
        results.buttons = results.buttons.slice(0, 12);
        results.cards = results.cards.slice(0, 8); // Moins de cards car elles sont grosses
        results.sidebars = results.sidebars.slice(0, 3);

        return results;

    }, inlineComputedStyles.toString()); // On passe la fonction sous forme de string

    await browser.close();

    return NextResponse.json({
      success: true,
      // Plus besoin de globalCSS, tout est dans le HTML !
      data: extractedData
    });

  } catch (err: any) {
    if (browser) await browser.close();
    console.error("Puppeteer Error:", err);
    // Timeout est l'erreur la plus commune si le site est lourd
    const msg = err.message.includes('Timeout') ? "Le site est trop long à charger ou bloque les bots." : err.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
      }
