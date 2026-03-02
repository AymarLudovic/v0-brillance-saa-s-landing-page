import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// =============================================================================
// RÈGLES PARTAGÉES
// =============================================================================

const SHARED_RULES = `
══════════════════════════════════════════
COULEURS — VÉRITÉ ABSOLUE PAR ZONE
══════════════════════════════════════════
Les données Canvas sont des MESURES PIXEL RÉELLES. Chaque hex = fait immuable.
Mapping STRICT zone → variable CSS :
  "sidebar-gauche"    → --sidebar-bg, --sidebar-text, --sidebar-border
  "header-top"        → --header-bg, --header-text
  "coin-haut-gauche"  → --brand-bg, --brand-text
  "contenu-principal" → --main-bg, --main-text
  "milieu-centre"     → --card-bg, --card-border, --card-text
  "colonne-droite"    → --panel-bg, --panel-text
  "bas-page"          → --footer-bg

LOI : La couleur de sidebar-gauche va sur la sidebar — JAMAIS ailleurs.
La couleur de header-top va sur le header — JAMAIS ailleurs.
N'utilise JAMAIS une couleur d'une zone pour styliser une autre zone.

══════════════════════════════════════════
TAILLE DES COMPOSANTS — INTERFACES PRO = COMPACT
══════════════════════════════════════════
DÉFAUT (si l'image ne montre pas explicitement du grand) :
  Boutons :    height 28-32px · padding 4px 10px · font-size 12px
  Inputs :     height 30-34px · padding 5px 10px · font-size 13px
  Labels :     font-size 11-12px · font-weight 500
  Icônes :     14-16px
  Nav items :  padding 5px 8px · font-size 12px
  Cards :      padding 10px 14px · gap 8px entre éléments

Si l'image montre CLAIREMENT des composants plus grands → reproduis exactement.
Si tu as un doute → PETIT.

══════════════════════════════════════════
BORDER-RADIUS — LIS L'IMAGE, N'INVENTE PAS
══════════════════════════════════════════
Lis chaque composant individuellement. Exemples :
  Input de recherche arrondi → border-radius 9999px
  Bouton légèrement arrondi → 4-6px
  Card avec coins → 8-12px
  Badge pill → 9999px
  Tableau sans radius → 0px
NE standardise pas tous les composants au même radius.
Chaque composant a son radius propre.

══════════════════════════════════════════
ICÔNES — TABLER ICONS UNIQUEMENT
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-[nom]"></i>

UTILISE TABLER ICONS PARTOUT. Jamais d'emoji à la place d'icônes.
Catalogue : home search settings user users bell message chart-bar chart-line chart-pie
chevron-right chevron-left chevron-down chevron-up dots-vertical dots-horizontal
plus minus x check check-circle circle-x mail calendar clock
file file-text folder edit pencil trash eye lock shield
trending-up trending-down alert-triangle info-circle
brand-github brand-stripe brand-google brand-paypal brand-figma
layout-dashboard layout-sidebar layout-grid list wallet credit-card
package truck shopping-cart receipt upload download share refresh filter
tag external-link adjustments sliders logout login user-circle
map-pin world camera photo microphone player-play player-pause
award trophy star star-filled heart bookmark flag crown rocket flame

══════════════════════════════════════════
IMAGES — SOURCES RÉELLES
══════════════════════════════════════════
Logos : <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:16px;height:16px;object-fit:contain">
Avatars : <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Sophie&backgroundColor=b6e3f4" style="width:26px;height:26px;border-radius:50%">
Photos : <img src="https://picsum.photos/seed/dash1/400/200" style="width:100%;object-fit:cover">
JAMAIS de chemins locaux, /placeholder, URLs inventées.

══════════════════════════════════════════
COMPOSANTS VIVANTS — ZÉRO HOLLOW GHOSTING
══════════════════════════════════════════
Chaque élément DOIT avoir un contenu réel et du sens.
INTERDIT :
  ✗ Bouton vide sans label ni icône
  ✗ Card sans contenu
  ✗ Colonne sans données
  ✗ Liste avec 1 seul item générique
  ✗ "Lorem ipsum" ou "Placeholder text"
  ✗ Graphique sans données
OBLIGATOIRE :
  ✓ Données réalistes inventées (noms, chiffres, dates cohérents)
  ✓ Minimum 3-5 items dans chaque liste
  ✓ Graphiques avec données SVG inline ou canvas
  ✓ Statuts variés (actif/inactif/pending dans des proportions réalistes)
`;

// =============================================================================
// SYSTEM CLONE — pixel-perfect absolu
// =============================================================================

const SYSTEM_CLONE = `Tu es le meilleur ingénieur de reproduction UI pixel-perfect au monde.
Ton HTML, placé côte à côte avec l'image originale, est VISUELLEMENT IDENTIQUE au millimètre.
Tu génères du HTML intégral — jamais interrompu avant </html>.

╔══════════════════════════════════════════════════════════════════════════╗
║  MODE CLONE — REPRODUCTION PIXEL-PERFECT ABSOLUE                        ║
╚══════════════════════════════════════════════════════════════════════════╝

PROCESSUS OBLIGATOIRE EN 5 ÉTAPES :

① ANALYSE VISUELLE PROFONDE
  Examine l'image pixel par pixel :
  - Dimensions relatives de chaque zone (sidebar = 20% ? 25% ?)
  - Hauteur précise du header (52px ? 60px ?)
  - Épaisseur des bordures (1px ? 2px ?)
  - Espacement réel entre les éléments (gap 4px ? 8px ? 16px ?)
  - Typographie : taille de chaque type de texte, weight, letter-spacing
  - Ombres : visibles ou absentes ? intensité ?

② EXTRACTION DES TOKENS CSS PRÉCIS
  Déclare TOUT dans :root {} avec les valeurs EXACTES observées.
  Exemple pour une sidebar sombre :
  :root {
    --sidebar-w: 220px;
    --sidebar-bg: [hex zone sidebar-gauche];
    --sidebar-text: [hex couleur texte sidebar];
    --sidebar-border: 1px solid rgba(255,255,255,0.08);
    --header-h: 52px;
    --header-bg: [hex zone header-top];
    --card-radius: 6px;     /* lu sur l'image */
    --btn-radius: 4px;      /* lu sur l'image */
    --input-radius: 6px;    /* lu sur l'image */
    --font-size-label: 12px;
    --font-size-body: 13px;
    --font-size-heading: 15px;
  }

③ STRUCTURE HTML IDENTIQUE
  Chaque section, panneau, composant visible dans l'image = présent dans le HTML.
  Même ordre, même position, mêmes proportions.
  Textes de l'image → reproduits mot pour mot.
  Icônes → Tabler Icons équivalent le plus proche.
  Si l'image a un tableau de 5 colonnes → ton HTML a exactement 5 colonnes.
  Si l'image a 4 cartes métriques → ton HTML en a exactement 4.

④ FIDÉLITÉ CHROMATIQUE ABSOLUE
  Utilise les couleurs Canvas par zone (voir règles ci-dessous).
  La zone sidebar-gauche définit la couleur de ta sidebar.
  La zone header-top définit la couleur de ton header.
  JAMAIS de couleur approximée ou inventée.

⑤ ÉTATS ET MICRO-DÉTAILS
  Item actif dans la nav → background de sélection visible.
  Hover states sur tous les éléments cliquables (transition 0.12s).
  Scrollbar CSS si fond sombre.
  Badges, points de statut, indicateurs colorés → reproduits exactement.

INTÉGRATION JS (si [JS_SCRIPTS] fourni) :
  1. CDNs dans <head> : <script src="URL"></script>
  2. Conteneurs DOM avec IDs exacts que le JS attend
  3. Script JS complet juste avant </body>
  4. NE MODIFIE PAS le JS

${SHARED_RULES}
FORMAT : uniquement \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

// =============================================================================
// SYSTEM CREATE — restructuration profonde, pas un changement de couleur
// =============================================================================

const SYSTEM_CREATE = `Tu es un Designer UI/UX de génie créatif et Ingénieur Frontend Senior.
Tu génères du HTML intégral — jamais interrompu avant </html>.

╔══════════════════════════════════════════════════════════════════════════╗
║  MODE CRÉATION — RESTRUCTURATION PROFONDE + ADN VISUEL FIDÈLE           ║
╚══════════════════════════════════════════════════════════════════════════╝

⚠️ ERREUR FATALE À ÉVITER : changer juste la couleur de fond et appeler ça une "création".
Ce mode n'est PAS un changement de couleur. C'est une RÉINVENTION ARCHITECTURALE.

ÉTAPE 1 — EXTRACTION DE L'ADN VISUEL (garde ces éléments inchangés)
  ✓ Palette de couleurs exacte (depuis les données Canvas)
  ✓ Style des composants (sharp/arrondi, dense/aéré, avec/sans ombres)
  ✓ Typographie (famille détectée → Google Fonts équivalent + hiérarchies de taille)
  ✓ Ambiance générale (dark tech, light minimal, glassmorphism, etc.)
  ✓ Qualité de finition (pro/minimal/playful)

ÉTAPE 2 — RESTRUCTURATION ARCHITECTURALE (réinvente tout ça)
  Transforme chaque pattern structurel en quelque chose de nouveau :

  Exemples de transformations valides :
    Sidebar fixe           → Navbar flottante pill avec blur backdrop
    Navigation verticale   → Navigation horizontale avec indicateur animé
    Header standard        → Header collant avec scroll effect
    Liste de cards         → Grille masonry asymétrique
    Tableau de données     → Cards expansibles avec preview inline
    Header avec tabs       → Sidebar miniature avec icônes + tooltips
    Footer basique         → Panel de statuts flottant en bas à droite
    Modal centré           → Drawer latéral avec overlay gradué
    Breadcrumb horizontal  → Trail vertical avec étapes visuelles

  RÈGLE DE TRANSFORMATION :
  - Identifie chaque composant de l'image
  - Réimagine sa FORME et sa POSITION en gardant sa FONCTION
  - Le résultat doit sembler "le même système, redesigné à fond"

ÉTAPE 3 — CRÉATION GÉNIALE
  Données réalistes inventées avec cohérence du domaine.
  Micro-animations CSS purposeful (max 3-4 éléments animés).
  Profondeur visuelle : ombres multi-couches, glassmorphism si dark.
  Nouveaux composants qui naissent naturellement de l'ADN de l'image.
  Google Fonts adapté à l'ambiance, chargé dans le <head>.
  Sparklines SVG inline pour les métriques numériques.

LAYOUT PAR USAGE (pas par image) :
  SaaS/Admin  → Sidebar 220px + header + main
  E-commerce  → Header + grille + filtres
  Dashboard   → Multi-colonnes métriques + charts
  Landing     → Hero + sections verticales
  Chat/IA     → Split-pane
  CRM         → Sidebar étroite + table + panel droit

INTÉGRATION JS (si [JS_SCRIPTS] fourni) :
  1. CDNs dans <head>
  2. Éléments DOM avec IDs attendus par le JS
  3. Script JS entier avant </body>
  4. CSS adapté pour intégrer les conteneurs JS dans le design

${SHARED_RULES}
FORMAT : uniquement \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

// =============================================================================
// DÉTECTION MODE
// =============================================================================

function detectMode(message: string | null): "clone" | "create" {
  if (!message?.trim()) return "clone";
  const msg = message.toLowerCase();
  const cloneKw = ["clone","reproduis","reproduit","copie","copier","pixel-perfect","identique","refais","recrée","exact","à l'identique","reproduce","duplicate","replicate"];
  const createKw = ["crée","créer","génère","générer","fais","construis","build","create","make","generate","une app","une application","un dashboard","un crm","une plateforme","un site","une boutique","landing","je veux","je voudrais","j'ai besoin","design","nouvelle","new","une page","similaire","inspiré","dans le style"];
  const cScore = cloneKw.filter(k => msg.includes(k)).length;
  const dScore = createKw.filter(k => msg.includes(k)).length;
  if (dScore > cScore) return "create";
  if (dScore > 0 && cScore === 0) return "create";
  return "clone";
}

function buildColorPrompt(colorsRaw: string): string {
  try {
    const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
    const byZone: Record<string, { hex: string; frequency: number }[]> = {};
    for (const c of colors) {
      if (!byZone[c.zone]) byZone[c.zone] = [];
      byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
    }
    let block = "\n\n╔══ COULEURS CANVAS — VÉRITÉ ABSOLUE PAR ZONE ══╗\n";
    block += "Utilise chaque couleur EXCLUSIVEMENT dans sa zone.\n";
    for (const [zone, cols] of Object.entries(byZone)) {
      const sorted = cols.sort((a, b) => b.frequency - a.frequency);
      block += `\n[${zone}]\n`;
      block += `  Background dominant : ${sorted[0].hex}  (${sorted[0].frequency} px)\n`;
      if (sorted[1]) block += `  Texte / accent      : ${sorted[1].hex}  (${sorted[1].frequency} px)\n`;
      if (sorted[2]) block += `  Bordure / détail    : ${sorted[2].hex}  (${sorted[2].frequency} px)\n`;
    }
    block += `\n╚══ Utilise EXACTEMENT ces hex dans :root {} — pas d'approximations ══╝\n`;
    block += `Continue jusqu'au </html> final sans jamais t'arrêter.`;
    return block;
  } catch { return ""; }
}

function parseJsFeatures(jsOutput: string): { cdns: string[]; code: string } {
  if (!jsOutput?.trim()) return { cdns: [], code: "" };
  const blockMatch = jsOutput.match(/```js-features\n?([\s\S]*?)```/);
  const block = blockMatch ? blockMatch[1] : jsOutput;
  const cdnsMatch = block.match(/\[CDNS\]([\s\S]*?)\[\/CDNS\]/);
  const cdns: string[] = [];
  if (cdnsMatch) {
    cdnsMatch[1].split("\n").forEach(line => {
      const t = line.replace(/^\/\/\s*/, "").trim();
      if (t.startsWith("http")) cdns.push(t);
    });
  }
  const code = block.replace(/\/\/ \[CDNS\][\s\S]*?\/\/ \[\/CDNS\]/, "").replace(/\[CDNS\][\s\S]*?\[\/CDNS\]/, "").trim();
  return { cdns, code };
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const formData   = await req.formData();
    const message    = formData.get("message")    as string | null;
    const imageFile  = formData.get("image")      as File | null;
    const histRaw    = formData.get("history")    as string | null;
    const colorsRaw  = formData.get("colors")     as string | null;
    const jsScripts  = formData.get("jsScripts")  as string | null;
    const modeForced = formData.get("mode")       as string | null;

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");
    const mode = (modeForced === "clone" || modeForced === "create") ? modeForced : detectMode(message);
    const systemPrompt = mode === "create" ? SYSTEM_CREATE : SYSTEM_CLONE;

    type Part    = { text: string } | { inlineData: { mimeType: string; data: string } };
    type Content = { role: "user" | "model"; parts: Part[] };

    const gemHist: Content[] = history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const parts: Part[] = [];
    if (imageFile) {
      const bytes  = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    let prompt = mode === "clone"
      ? `Reproduis cette interface pixel-perfect en HTML/CSS.${message?.trim() ? ` Instructions : "${message.trim()}"` : ""}\nRéfère-toi aux couleurs Canvas comme vérité absolue. Taille des composants : petite par défaut. Border-radius : lis l'image. Chaque composant visible doit être présent avec du contenu réel.`
      : `CRÉATION : "${message?.trim()}"\nExtrais l'ADN visuel (couleurs, typographie, style de composants, ambiance). Réinvente COMPLÈTEMENT la structure (pas juste les couleurs). Transforme sidebar → navbar, liste → grille, etc. Garde l'ADN, change l'architecture. Composants vivants avec données réalistes.`;

    if (colorsRaw) {
      try { prompt += buildColorPrompt(colorsRaw); } catch {}
    }

    if (jsScripts?.trim()) {
      const { cdns, code } = parseJsFeatures(jsScripts);
      prompt += `\n\n[JS_SCRIPTS]
JavaScript COMPLET à intégrer :

CDNs (<head>) :
${cdns.map(cdn => `<script src="${cdn}"></script>`).join("\n") || "(aucun CDN)"}

Script (avant </body>) :
<script>
${code}
</script>

INSTRUCTIONS : Scanne le JS pour tous les querySelector('#id') et getElementById('id').
Crée ces éléments HTML avec ces IDs EXACTS. Stylise-les dans ton CSS.
NE MODIFIE PAS le JS.
[/JS_SCRIPTS]`;
    }

    parts.push({ text: prompt });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [...gemHist, { role: "user", parts }],
            config: {
              systemInstruction: systemPrompt,
              maxOutputTokens: 65536,
              temperature: mode === "clone" ? 0.2 : 0.7,
            },
          });
          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) controller.enqueue(encoder.encode(txt));
          }
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n[Erreur UX: ${err.message}]\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "X-Mode": mode },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
