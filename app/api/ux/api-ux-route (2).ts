import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

type ColorData = { hex: string; frequency: number; zone: string }[];

/** Transforme les couleurs canvas en variables CSS directement utilisables */
function colorsToCSS(colorsRaw: string): { cssVars: string; zoneMap: Record<string, string[]> } {
  const colors: ColorData = JSON.parse(colorsRaw);
  const byZone: Record<string, { hex: string; frequency: number }[]> = {};

  for (const c of colors) {
    if (!byZone[c.zone]) byZone[c.zone] = [];
    byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
  }

  const mapping: Record<string, { varBg: string; varText: string; varBorder: string }> = {
    "sidebar-gauche":    { varBg: "--sidebar-bg",   varText: "--sidebar-text",   varBorder: "--sidebar-border" },
    "header-top":        { varBg: "--header-bg",    varText: "--header-text",    varBorder: "--header-border"  },
    "coin-haut-gauche":  { varBg: "--brand-bg",     varText: "--brand-text",     varBorder: "--brand-border"   },
    "contenu-principal": { varBg: "--main-bg",      varText: "--main-text",      varBorder: "--main-border"    },
    "milieu-centre":     { varBg: "--card-bg",      varText: "--card-text",      varBorder: "--card-border"    },
    "colonne-droite":    { varBg: "--panel-bg",     varText: "--panel-text",     varBorder: "--panel-border"   },
    "bas-page":          { varBg: "--footer-bg",    varText: "--footer-text",    varBorder: "--footer-border"  },
  };

  const lines: string[] = [];
  const zoneMap: Record<string, string[]> = {};

  for (const [zone, cols] of Object.entries(byZone)) {
    const sorted = [...cols].sort((a, b) => b.frequency - a.frequency);
    const vars = mapping[zone];
    zoneMap[zone] = sorted.map(c => c.hex);
    if (!vars) continue;
    if (sorted[0]) lines.push(`  ${vars.varBg}: ${sorted[0].hex};   /* ${zone} — fond dominant */`);
    if (sorted[1]) lines.push(`  ${vars.varText}: ${sorted[1].hex};   /* ${zone} — texte/icônes */`);
    if (sorted[2]) lines.push(`  ${vars.varBorder}: ${sorted[2].hex};   /* ${zone} — bordure/accent */`);
  }

  return { cssVars: lines.join("\n"), zoneMap };
}

/** Injecte CDNs + code JS dans le HTML après génération — sans que le modèle le sache */
function injectJs(html: string, cdns: string[], jsCode: string): string {
  if (!cdns.length && !jsCode) return html;
  let out = html;

  if (cdns.length) {
    const tags = cdns.map(u => `  <script src="${u}"></script>`).join("\n");
    out = out.includes("</head>")
      ? out.replace("</head>", `${tags}\n</head>`)
      : out.replace("<body", `${tags}\n<body`);
  }
  if (jsCode) {
    const tag = `\n<script>\n${jsCode}\n</script>`;
    out = out.includes("</body>")
      ? out.replace(/(<\/body>)(?![\s\S]*<\/body>)/, `${tag}\n$1`)
      : out + tag;
  }
  return out;
}

/** Parse le bloc js-features pour extraire CDNs et code */
function parseJsFeatures(raw: string): { cdns: string[]; code: string } {
  const block = (raw.match(/```js-features\n?([\s\S]*?)```/) || [null, raw])[1]!;
  const cdnBlock = block.match(/\[CDNS\]([\s\S]*?)\[\/CDNS\]/);
  const cdns: string[] = [];
  if (cdnBlock) {
    cdnBlock[1].split("\n").forEach(l => {
      const t = l.replace(/^\/\/\s*/, "").trim();
      if (t.startsWith("http")) cdns.push(t);
    });
  }
  const code = block
    .replace(/\/\/ \[CDNS\][\s\S]*?\/\/ \[\/CDNS\]/, "")
    .replace(/\[CDNS\][\s\S]*?\[\/CDNS\]/, "")
    .trim();
  return { cdns, code };
}

/** Extrait les IDs DOM que le JS attend — pour créer les bons conteneurs */
function extractDomRequirements(jsCode: string): string[] {
  const ids = new Set<string>();
  const rules = [
    /querySelector\s*\(\s*['"`]#([\w-]+)['"`]\)/g,
    /getElementById\s*\(\s*['"`]([\w-]+)['"`]\)/g,
  ];
  for (const rx of rules) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(jsCode)) !== null) ids.add(m[1]);
  }
  return [...ids].filter(id => id.length > 2).slice(0, 25);
}

/** Extrait le bloc HTML de la réponse markdown */
function extractHtmlBlock(text: string): string {
  const m = text.match(/```html\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  const t = text.trim();
  if (t.startsWith("<!") || t.startsWith("<html")) return t;
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

const RULES_COMMON = `
ICÔNES : Tabler Icons UNIQUEMENT, partout, toujours.
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-NOM"></i>
JAMAIS d'emoji à la place d'icône. JAMAIS d'autre librairie d'icônes.
Noms Tabler disponibles : home search settings user users bell message chart-bar chart-line chart-pie
chevron-right chevron-left chevron-down chevron-up dots-vertical dots-horizontal plus minus x check
check-circle mail calendar clock file file-text folder edit pencil trash eye lock shield
filter refresh copy database cloud trending-up trending-down alert-triangle info-circle
brand-github brand-stripe brand-google brand-paypal layout-dashboard layout-sidebar
layout-grid list wallet credit-card coins package truck shopping-cart receipt upload download
tag external-link adjustments logout login user-circle map-pin world star star-filled heart
bookmark arrow-left arrow-right sort-ascending sort-descending zoom-in zoom-out maximize

IMAGES (sources réelles uniquement) :
  Logos   : <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:16px;height:16px;object-fit:contain">
  Avatars : <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Alice&backgroundColor=b6e3f4" style="width:26px;height:26px;border-radius:50%">
  Photos  : <img src="https://picsum.photos/seed/ui1/400/300" style="width:100%;object-fit:cover">

CONTENU VIVANT — zéro placeholder, zéro hollow :
  ✗ Bouton vide · Card sans données · Lorem ipsum · Graphique vide · "User Name"
  ✓ Min 5 items par liste · Données réalistes cohérentes · Statuts variés
`;

const SYSTEM_CLONE = `Tu es un expert de reproduction d'interfaces pixel-perfect. Tu génères du HTML/CSS complet — jamais interrompu avant </html>.

MISSION : produire un clone si fidèle que l'image originale et ton HTML sont indiscernables côte à côte.

━━━━ PROCESSUS EN 5 ÉTAPES ━━━━

① ANALYSE PIXEL PAR PIXEL
Avant de coder, lis l'image avec une précision maximale :
· Largeur de la sidebar en % (18% ? 22% ? 28% ?)
· Hauteur du header en pixels (44px ? 52px ? 64px ?)
· Padding des boutons (3px 8px ? 5px 12px ? 8px 16px ?)
· Font-size de chaque type : navigation, labels, body, headings
· Font-weight : 400 normal, 500 medium, 600 semibold, 700 bold
· Border-radius de CHAQUE composant individuellement (pas pareil pour tous)
· Épaisseur des bordures et si elles sont visibles ou non
· Présence ou absence d'ombres (légères ? fortes ? inexistantes ?)
· Espacement entre items de liste (2px ? 4px ? 8px ?)
· Nombre exact de colonnes, cards, items — reproduit EXACTEMENT

② UTILISE LES VARIABLES CSS DÉJÀ CALCULÉES
Les variables CSS dans [CSS_VARS_CALCULÉES] sont des FAITS IMMUABLES issus de mesures pixel réelles.
Tu dois les copier TELS QUELS dans ton :root {}.
INTERDIT : arrondir, éclaircir, assombrir, remplacer par "proche".

③ REPRODUCTION STRUCTURELLE EXACTE
· Chaque section visible dans l'image = présente dans le HTML, dans le même ordre
· Textes : copiés mot pour mot depuis l'image
· Icônes : Tabler Icons equivalent le plus proche
· Même nombre de colonnes de tableau, même nombre de cards métriques
· Si l'image a une sidebar — ton HTML a une sidebar. Si non — non.
· Si l'image a un header — ton HTML a un header. Si non — non.

④ COMPOSANTS FIDÈLES
· Boutons : taille compacte par défaut (height 28-32px, padding 4px 10px)
· Inputs : height 30-34px, padding 5px 10px
· Nav items : compact, padding 5px 8px
· Si l'image montre clairement des composants plus grands → reproduis-les plus grands
· En cas de doute → petit

⑤ MICRO-DÉTAILS
· Item actif dans nav → indicateur visible (background, border-left coloré, ou texte coloré)
· Hover states sur éléments cliquables (transition 0.12s)
· Scrollbar stylisée sur fonds sombres ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius:2px }

INTERDICTIONS :
✗ Inventer des sections non présentes dans l'image
✗ Modifier les couleurs fournies dans [CSS_VARS_CALCULÉES]
✗ Utiliser Bootstrap ou Tailwind (CSS custom uniquement)
✗ Standardiser le border-radius (chaque composant = valeur individuelle lue sur l'image)

${RULES_COMMON}
RÉPONSE : un seul bloc \`\`\`html\`\`\`. Rien avant. Rien après.`;

const SYSTEM_CREATE = `Tu es un Designer UI/UX de génie et Ingénieur Frontend Senior. Tu génères du HTML/CSS complet — jamais interrompu avant </html>.

MISSION : extraire l'ADN visuel de l'image, puis créer une interface NOUVELLE qui partage le même ADN mais avec une architecture entièrement réinventée.

⚠️ ERREUR FATALE À ÉVITER : changer seulement les couleurs de fond = ÉCHEC TOTAL.
Ce mode = RÉINVENTION ARCHITECTURALE. Pas un reskin.

━━━━ ÉTAPE 1 : EXTRAIRE L'ADN (ce qui NE change PAS) ━━━━
· Palette exacte → variables CSS depuis [CSS_VARS_CALCULÉES]
· Ambiance : dark/light, sharp/arrondi, dense/aéré, glassmorphism/flat
· Typographie → Google Fonts équivalent chargé dans <head>
· Qualité de finition : premium, minimal, playful

━━━━ ÉTAPE 2 : RÉINVENTER L'ARCHITECTURE (ce qui CHANGE) ━━━━
Transforme chaque pattern structurel. Exemples de transformations valides :

  Sidebar verticale fixe  →  Navbar pill flottante (position:fixed, backdrop-filter:blur)
  Tabs horizontaux        →  Sidebar mini avec icônes + tooltip au hover
  Header standard         →  Header sticky avec effet de scroll (shadow au scroll)
  Grille de cards         →  Bento grid asymétrique (colspan différents)
  Tableau plat            →  Cards expansibles avec détail inline
  Liste simple            →  Timeline avec marqueurs et dates
  Breadcrumb              →  Stepper visuel avec états completed/active/pending
  Modal centré            →  Drawer latéral glissant

Règle : garde la FONCTION, réinvente la FORME et la POSITION.

━━━━ ÉTAPE 3 : CRÉATION ━━━━
· Données réalistes inventées (vrais noms, vrais chiffres, vraies dates récentes)
· 2-3 micro-animations CSS ciblées (keyframes purposeful, pas décoratives)
· Profondeur visuelle : ombres multi-couches ou glassmorphism si dark
· Google Fonts : chargée depuis fonts.googleapis.com
· Sparklines SVG inline pour les métriques
· Color coding cohérent pour les statuts

Layout par usage (pas par image) :
  SaaS/Admin   → sidebar 220px + header + main
  Dashboard    → bento grid métriques + charts
  E-commerce   → header + grille + filtres latéraux
  CRM          → sidebar étroite + table + panel droit

${RULES_COMMON}
RÉPONSE : un seul bloc \`\`\`html\`\`\`. Rien avant. Rien après.`;

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION MODE
// ─────────────────────────────────────────────────────────────────────────────

function detectMode(msg: string | null): "clone" | "create" {
  if (!msg?.trim()) return "clone";
  const m = msg.toLowerCase();
  const c = ["clone","reproduis","reproduit","copie","pixel-perfect","identique","refais","recrée","exact","reproduce"].filter(k => m.includes(k)).length;
  const d = ["crée","créer","génère","fais","construis","build","create","make","generate","une app","un dashboard","une plateforme","un site","une boutique","landing","je veux","j'ai besoin","design","nouvelle","new","similaire","inspiré"].filter(k => m.includes(k)).length;
  return d > c || (d > 0 && c === 0) ? "create" : "clone";
}

// ─────────────────────────────────────────────────────────────────────────────
// POST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const fd        = await req.formData();
    const message   = fd.get("message")   as string | null;
    const imageFile = fd.get("image")     as File   | null;
    const histRaw   = fd.get("history")   as string | null;
    const colorsRaw = fd.get("colors")    as string | null;
    const jsScripts = fd.get("jsScripts") as string | null;
    const modeRaw   = fd.get("mode")      as string | null;

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");
    const mode = (modeRaw === "clone" || modeRaw === "create") ? modeRaw : detectMode(message);

    // ── Parse JS scripts (si présents) ───────────────────────────────────────
    let jsCdns: string[] = [];
    let jsCode = "";
    let domIds: string[] = [];
    if (jsScripts?.trim()) {
      const parsed = parseJsFeatures(jsScripts);
      jsCdns = parsed.cdns;
      jsCode = parsed.code;
      domIds = extractDomRequirements(jsCode);
    }

    // ── Construit les variables CSS depuis les couleurs canvas ────────────────
    let cssVarsBlock = "";
    if (colorsRaw) {
      try {
        const { cssVars } = colorsToCSS(colorsRaw);
        cssVarsBlock = `\n\n[CSS_VARS_CALCULÉES — COPIE CES VALEURS EXACTES DANS :root {}]\n:root {\n${cssVars}\n}`;
      } catch {}
    }

    // ── Prompt principal (SANS le code JS) ────────────────────────────────────
    let prompt = mode === "clone"
      ? `Reproduis cette interface en HTML/CSS pixel-perfect.${message?.trim() ? `\nInstructions : "${message.trim()}"` : ""}
Composants compacts par défaut. Border-radius : lis chaque composant individuellement sur l'image.
Reproduis EXACTEMENT ce que tu vois — pas ce que tu penses être mieux.`
      : `CRÉATION — "${message?.trim()}"
Extrais l'ADN visuel de l'image. Réinvente l'architecture complètement.
Pas un changement de couleurs — une transformation structurelle profonde.`;

    if (cssVarsBlock) prompt += cssVarsBlock;

    // ── Informations DOM pour le JS (sans envoyer le code JS au modèle) ───────
    if (domIds.length > 0) {
      prompt += `\n\n[CONTENEURS DOM REQUIS PAR LE JS ASSOCIÉ]
Intègre ces éléments dans ta structure HTML avec leurs IDs exacts :
${domIds.map(id => `  <div id="${id}"></div>  ← conteneur fonctionnel`).join("\n")}
Stylise-les naturellement dans le design (dimensions appropriées, visible dans la page).
[/FIN CONTENEURS]`;
    }

    // ── Appel Gemini ──────────────────────────────────────────────────────────
    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    type MsgContent = { role: "user" | "model"; parts: Part[] };

    const gemHist: MsgContent[] = history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const parts: Part[] = [];
    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: Buffer.from(bytes).toString("base64") } });
    }
    parts.push({ text: prompt });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (s: string) => controller.enqueue(encoder.encode(s));
        try {
          const response = await ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [...gemHist, { role: "user", parts }],
            config: {
              systemInstruction: mode === "clone" ? SYSTEM_CLONE : SYSTEM_CREATE,
              maxOutputTokens: 65536,
              temperature: mode === "clone" ? 0.1 : 0.65, // 0.1 = fidélité maximale
            },
          });

          let fullOutput = "";
          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) {
              fullOutput += txt;
              emit(txt);
            }
          }

          // ── Injection JS côté serveur APRÈS génération ──────────────────────
          // Le modèle n'a pas vu le JS → il a fait son meilleur design possible
          // On injecte maintenant de façon chirurgicale
          if (jsCode || jsCdns.length) {
            const rawHtml = extractHtmlBlock(fullOutput);
            if (rawHtml) {
              const withJs = injectJs(rawHtml, jsCdns, jsCode);
              emit(`\n[JS_INJECTED]${JSON.stringify(withJs)}[/JS_INJECTED]`);
            }
          }

        } catch (err: any) {
          emit(`\n[Erreur UX: ${err.message}]\n`);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "X-Mode": mode,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
