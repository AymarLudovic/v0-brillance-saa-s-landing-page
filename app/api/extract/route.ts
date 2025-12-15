import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Fonction pour rendre les URLs absolues (images, fonts, liens)
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
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        }
    });
    
    if (!response.ok) throw new Error("Impossible d'accéder au site");

    const html = await response.text();
    const $ = cheerio.load(html);
    const baseUrl = new URL(targetUrl).origin;

    // --- 1. EXTRACTION DU CSS (CRITIQUE) ---
    // On prend tout pour être sûr que Framer/Tailwind fonctionne dans l'iframe
    let globalCSS = "";
    
    $("link[rel='stylesheet']").each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const absHref = href.startsWith("http") ? href : new URL(href, baseUrl).href;
        globalCSS += `<link rel="stylesheet" href="${absHref}" />\n`;
      }
    });

    $("style").each((_, el) => {
      globalCSS += `<style>${$(el).html()}</style>\n`;
    });

    // --- 2. LOGIQUE DE DÉTECTION AVANCÉE ---
    const extracted = {
      buttons: [] as any[],
      cards: [] as any[],
      navbars: [] as any[]
    };

    // Helper pour ajouter sans doublon
    const addItem = (category: 'buttons' | 'cards' | 'navbars', el: any, typeSrc: string) => {
        const htmlContent = makeAbsolute($.html(el), baseUrl);
        // On évite les éléments vides ou invisibles
        if ($(el).text().trim().length === 0 && $(el).find('img, svg').length === 0) return;
        
        extracted[category].push({
            id: `${category}-${extracted[category].length}`,
            type: category,
            source: typeSrc, // 'framer', 'semantic', 'class'
            html: htmlContent,
            classes: $(el).attr("class") || ""
        });
    };

    // A. DÉTECTION DES BOUTONS (Framer + Standard)
    // 1. Framer & Webflow specific
    $("[class*='framer-'][data-framer-name*='Button'], .w-button, [class*='button-wrapper']").each((_, el) => addItem('buttons', el, 'framework'));
    
    // 2. Classes génériques (contient 'btn' ou 'button' mais pas trop long)
    $("[class*='btn'], [class*='button']").each((_, el) => {
        const cls = $(el).attr('class') || "";
        // On évite les conteneurs géants qui s'appellent "buttons-container"
        if (!cls.includes('container') && !cls.includes('wrapper')) {
            addItem('buttons', el, 'class-match');
        }
    });

    // 3. Sémantique HTML
    $("button, a[role='button']").each((_, el) => addItem('buttons', el, 'semantic'));


    // B. DÉTECTION DES NAVBARS
    // 1. Framer specific (souvent en haut, fixed)
    $("[data-framer-name*='Nav'], [data-framer-name*='Header'], [class*='framer-'][class*='nav']").each((_, el) => addItem('navbars', el, 'framer'));
    
    // 2. Standard
    $("nav, header, .navbar, .nav-wrapper").each((_, el) => addItem('navbars', el, 'standard'));


    // C. DÉTECTION DES CARDS / SECTIONS
    // C'est le plus dur. On cherche des blocs répétés ou des noms explicites.
    $("[class*='card'], [class*='tile'], [class*='item'], article").each((_, el) => {
        // Filtrage par taille: ni trop petit (icone), ni trop gros (page entière)
        const content = $(el).html() || "";
        if (content.length > 150 && content.length < 4000) {
            addItem('cards', el, 'class-match');
        }
    });

    // Framer "Stack" ou "Container" qui ressemble à une card
    $("[data-framer-name*='Card'], [data-framer-name*='Item']").each((_, el) => addItem('cards', el, 'framer'));


    // D. LIMITATION ET NETTOYAGE
    // On ne garde que les X premiers uniques pour ne pas crasher le front
    const uniqueFilter = (items: any[]) => {
        const seen = new Set();
        return items.filter(item => {
            const duplicate = seen.has(item.html);
            seen.add(item.html);
            return !duplicate;
        }).slice(0, 12); // Max 12 éléments par catégorie
    };

    extracted.buttons = uniqueFilter(extracted.buttons);
    extracted.cards = uniqueFilter(extracted.cards);
    extracted.navbars = uniqueFilter(extracted.navbars);

    return NextResponse.json({
      success: true,
      globalCSS, 
      data: extracted
    });

  } catch (err: any) {
    console.error("Extract Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
    }
