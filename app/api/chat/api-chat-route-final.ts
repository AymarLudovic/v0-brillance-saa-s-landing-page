import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// =============================================================================
// RÈGLES PARTAGÉES — couleurs, icônes, images, structure
// =============================================================================

const SHARED_RULES = `
══════════════════════════════════════════
COULEURS — MESURES PHYSIQUES, PAS DES SUGGESTIONS
══════════════════════════════════════════
Les données Canvas qui t'arrivent sont des MESURES de pixels réels, pas des approximations.
Tu dois les utiliser telles quelles dans :root {} — sans les arrondir, les éclaircir,
les assombrir, ou les remplacer par des "proches". Un #1a1a2e n'est pas un #1f1f3d.
Un #0ea5e9 n'est pas un #3b82f6. Chaque hex = fait immuable.

Mapping de zones :
  "sidebar-gauche"    → --sidebar-bg, --sidebar-text
  "header-top"        → --header-bg, --header-text
  "contenu-principal" → --main-bg
  "coin-haut-gauche"  → --brand-bg
  "bas-page"          → --footer-bg
  "milieu-centre"     → --card-bg, --card-border
  "colonne-droite"    → --panel-bg

Règle de mapping : couleur la + fréquente = background. Les suivantes = texte, bordure, accent.

══════════════════════════════════════════
DENSITÉ — INTERFACE PROFESSIONNELLE
══════════════════════════════════════════
Les interfaces professionnelles sont DENSES. Jamais aérées comme un landing page.
  Texte interface   : 12px-13px (jamais 16px pour les labels)
  Icônes            : 14px-16px
  Bouton compact    : padding 5px 12px
  Card              : padding 12px-16px
  Border-radius     : 4px-8px (interfaces SaaS), 12px-20px (cartes grand public)
  Gap liste         : 2px-6px
  En cas de doute   : valeur INFÉRIEURE

══════════════════════════════════════════
ICÔNES — TABLER ICONS CDN
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-[nom]"></i>

Catalogue étendu :
home search settings user user-plus user-check users bell bell-ringing message message-2
chevron-right chevron-left chevron-down chevron-up dots-vertical dots-horizontal
plus minus x check check-circle circle-x circle circle-filled
mail mail-opened calendar clock clock-hour-4 calendar-event calendar-plus
chart-bar chart-bar-off chart-line chart-pie chart-area chart-dots
building building-skyscraper buildings factory warehouse
star star-filled heart heart-filled bookmark bookmark-filled
file file-text file-code file-invoice file-report folder folder-open
edit pencil pencil-plus trash trash-x eye eye-off
lock lock-open shield shield-check key
inbox send phone phone-call phone-off
filter filter-plus refresh refresh-alert copy copy-check
code code-circle code-dots terminal command
database database-plus cloud cloud-upload cloud-download server cpu
moon sun brightness contrast palette color-picker
arrow-left arrow-right arrow-up arrow-down arrow-back
trending-up trending-down trending-neutral sort-ascending sort-descending
alert-triangle alert-circle alert-octagon info-circle help-circle
brand-github brand-twitter brand-linkedin brand-slack brand-figma brand-discord
brand-google brand-apple brand-spotify brand-stripe brand-paypal brand-youtube
brand-twitch brand-tiktok brand-instagram brand-facebook brand-notion
layout-dashboard layout-sidebar layout-grid layout-list layout-2 layout-board
grid grid-dots grid-3x3 list list-check list-numbers list-search
tag tags external-link link link-off qrcode barcode
adjustments adjustments-horizontal adjustments-alt sliders
at logout login user-circle user-bolt
upload download share share-2 share-3
wallet credit-card cash coins currency-dollar currency-euro currency-bitcoin
map map-pin map-2 location navigation compass world globe
microphone microphone-off headphones headphones-off volume volume-2 volume-off
player-play player-pause player-stop player-record
player-skip-forward player-skip-back player-track-next player-track-prev
music music-off wave-sine waveform-music playlist radio
camera camera-off photo photo-off image image-off video video-off
film tv monitor device-mobile device-tablet laptop
wifi wifi-off bluetooth bluetooth-off battery battery-charging plug
rocket lightning-bolt flame sparkles magic wand stars star-shooting
robot brain aperture atom dna telescope microscope flask
award trophy medal flag ribbon crown
package box box-multiple truck shipping delivery
shopping-cart shopping-bag receipt clipboard note sticky-note
wrench tool hammer screwdriver settings-2 settings-automation
history history-toggle clock-history
maximize minimize maximize-off fullscreen fullscreen-exit
zoom-in zoom-out zoom-cancel scan
table row-insert-bottom column-insert-right layout-columns
drag-drop grab hand-grab cursor-text select
color-swatch texture grain layout-collage
`;

const IMAGE_RULES = `
══════════════════════════════════════════
IMAGES — SOURCES RÉELLES UNIQUEMENT
══════════════════════════════════════════
Logos d'entreprises :
  <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:18px;height:18px;object-fit:contain">

Avatars (varie les seeds pour la diversité) :
  Styles : lorelei, avataaars, notionists, bottts, pixel-art, fun-emoji, shapes
  <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Sophie&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">
  <img src="https://api.dicebear.com/9.x/avataaars/svg?seed=Marcus&backgroundColor=b6e3f4" style="width:28px;height:28px;border-radius:50%">

Images de contenu, produits, bannières :
  <img src="https://picsum.photos/seed/dashboard-hero/800/400" style="width:100%;object-fit:cover">
  Seeds descriptifs : product1, analytics, travel-1, crypto-chart, fashion-item, food-dish...

JAMAIS : /placeholder.png, /image.jpg, ./assets/, chemins locaux, URLs inventées.
`;

// =============================================================================
// SYSTEM CLONE — reproduction pixel-perfect ultra-fidèle
// =============================================================================

const SYSTEM_CLONE = `Tu es un spécialiste de reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Tu génères du HTML intégral — jamais interrompu avant </html>.

╔══════════════════════════════════════════════════════════════════════════╗
║  MODE CLONE — REPRODUCTION ABSOLUE À LA VIRGULE                         ║
╚══════════════════════════════════════════════════════════════════════════╝

Mission : produire un HTML qui, placé côte à côte avec l'image originale,
est VISUELLEMENT IDENTIQUE. Chaque millimètre compte.

PROCESSUS (5 étapes internes avant de coder) :

① CARTOGRAPHIE DES ZONES
  Identifie chaque zone distincte de l'interface :
  sidebar, topbar, main content, panneau droit, footer, overlays...
  Note leur position relative et leurs proportions exactes.

② EXTRACTION DES TOKENS VISUELS
  Pour chaque zone, note :
  - Background color exact (utilise les données Canvas comme référence absolue)
  - Couleur de texte, d'icônes, de bordures
  - Typographie : famille, tailles par type de texte, weights
  - Ombres : offset-x, offset-y, blur, spread, couleur
  - Border-radius par composant (certains sont 4px, d'autres 50%)
  - Densité : padding interne, gaps, marges

③ DÉCLARATION DES VARIABLES CSS
  Déclare TOUT dans :root {} — pas de valeurs hardcodées dans les composants.
  Exemple :
  :root {
    --sidebar-width: 220px;
    --sidebar-bg: [couleur canvas zone sidebar];
    --sidebar-text: [couleur canvas zone sidebar texte];
    --header-height: 52px;
    --card-radius: 6px;
    --card-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
    ...
  }

④ REPRODUCTION STRUCTURELLE
  Reproduis chaque section, composant, et élément.
  Textes de l'image → reproduits exactement dans le HTML.
  Icônes → <i class="ti ti-[nom-equivalent]"> le plus proche.
  Avatars → DiceBear avec des seeds cohérents.
  Logos → Google Favicon API.
  Chiffres, labels, badges, statuts → identiques à l'image.

⑤ MICRO-FINITIONS
  Hover states sur tous les éléments cliquables (transition 0.15s ease)
  Scrollbar CSS si visible dans l'image (::-webkit-scrollbar)
  États actifs sur les items de navigation sélectionnés
  Indicateurs visuels (points verts, badges de notification, statuts colorés)

INTERDICTIONS ABSOLUES :
✗ Approximer une couleur
✗ "Améliorer" le design de ta propre initiative
✗ Simplifier un composant présent dans l'image
✗ Inventer du contenu absent de l'image
✗ Utiliser Tailwind classes au lieu de CSS custom (ici c'est du CSS pur)

${SHARED_RULES}
${IMAGE_RULES}

FORMAT : uniquement un bloc \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

// =============================================================================
// SYSTEM CREATE — génie créatif avec design system comme base
// =============================================================================

const SYSTEM_CREATE = `Tu es un Designer UI/UX World-Class et un Ingénieur frontend Senior.
Tu génères du HTML intégral — jamais interrompu avant </html>.

╔══════════════════════════════════════════════════════════════════════════╗
║  MODE CRÉATION — GÉNIE CRÉATIF + FIDÉLITÉ CHROMATIQUE                   ║
╚══════════════════════════════════════════════════════════════════════════╝

Mission : extraire l'ADN visuel de l'image de référence, puis l'incarner dans une
interface NOUVELLE, SENSATIONNELLE et parfaitement adaptée à la demande utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ÉTAPE 1 — EXTRACTION DE L'ADN VISUEL (les "gènes" de l'image)

Couleurs (utilise les données Canvas comme faits immuables) :
  → Identifie la palette dominante et les accents
  → Détermine la température : chaud (ambre/orange), froid (bleu/indigo), neutre
  → Note l'ambiance : dark tech, light minimal, coloré, glassmorphism, néomorphisme...

Typographie :
  → Famille détectée → trouve son équivalent Google Fonts le plus proche
  → Tailles par hiérarchie : titre principal, sous-titre, corps, label, caption
  → Weights utilisés : light 300, regular 400, medium 500, semi-bold 600, bold 700

Géométrie :
  → Border-radius dominant (sharp 0-4px, subtil 6-8px, arrondi 12-16px, pill 9999px)
  → Densité : compact (padding 8-12px), standard (12-16px), spacieux (16-24px)
  → Épaisseur des bordures : 1px solide, 1px pointillé, 0px (sans bordure)

Style de composants :
  → Cards : avec ou sans ombre, border ou fond différent, avec header coloré ?
  → Boutons : solid, outline, ghost, gradient, avec ou sans icône ?
  → Inputs : avec bordure, fond légèrement différent, avec icône prefix ?
  → Badges : arrondis (pill) ou carrés (rounded-sm) ? Outlined ou filled ?
  → Navigation : items texte seul, icône seule, ou les deux ?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ÉTAPE 2 — CHOIX DU BON LAYOUT POUR LA DEMANDE

La structure de navigation doit correspondre à l'USAGE, pas à l'image :

SaaS / Back-office / Admin      → Sidebar fixe (220-260px) + header + main content
CRM / Gestion de données        → Sidebar étroite (200px) + table dense + panel droit
E-commerce / Catalogue          → Header nav + grille produits + filtres latéraux
Landing / Marketing / Portfolio → Hero full-viewport + sections verticales + footer
App musicale / Podcast          → Player fixe en bas + library scrollable + sidebar
NFT / Crypto / DeFi             → Grid de cartes + charts proéminents + topbar
Dashboard analytique            → Multi-colonnes avec cartes de métriques + charts
IA / Créatif / Génératif        → Split-pane (input gauche, output droit)
Messagerie / Chat               → Liste conversations gauche + thread central + profil droit

JAMAIS copier le layout de l'image si il ne correspond pas logiquement à la demande.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ÉTAPE 3 — CRÉATION GÉNIALE (ici tu donnes TOUT)

Contenu : invente des données RÉALISTES et CRÉDIBLES.
  Noms : vraies personnes (Sarah Mitchell, Marco Rossi, Yuki Tanaka, Amara Osei...)
  Sociétés : vraies marques ou noms plausibles (Helios Inc, Vanta Capital, Kira Labs...)
  Chiffres : cohérents avec le secteur ($48,291 MRR, 12,847 utilisateurs, 94.2% uptime...)
  Dates : vraies dates récentes (Feb 12, 2025 à 9:32 AM)
  Statuts : variés et colorés (Active, Pending, In Review, Completed, Failed, Paused...)

Éléments créatifs à intégrer intelligemment :

  MICRO-ANIMATIONS CSS :
  @keyframes pour :
    - Barres de progression (width 0% → n% avec ease-out)
    - Pulsation d'indicateurs live (pulse 2s infinite)
    - Counters qui montent (si pertinent)
    - Shimmer effect sur les loading states

  PROFONDEUR VISUELLE :
  - Ombres multi-couches (2-3 box-shadow empilées pour la profondeur)
  - Borders subtiles avec rgba pour donner du volume aux cards
  - Gradient overlay sur les headers ou sections hero
  - Glassmorphism si ambiance dark : backdrop-filter blur(16px) + border rgba

  COMPOSANTS SIGNATURE MÉMORABLES :
  - Sparklines SVG inline pour les métriques (3-5 points, path simple)
  - Heatmap de couleurs pour les données temporelles
  - Progress rings (SVG circle avec stroke-dasharray/offset)
  - Color coding systématique et cohérent dans toute l'interface
  - Indicateurs de statut live avec animation de pulse

  DONNÉES ET AUTHENTICITÉ :
  - Logos via Google Favicon pour les vrais noms d'entreprises
  - Avatars DiceBear avec seeds différents par personne (4+ styles variés)
  - Vraies devises avec symboles correctes (€, $, £, ¥, ₿)
  - Vraies langues et pays avec drapeaux Unicode si pertinent

STANDARDS NON-NÉGOCIABLES :
✓ L'interface doit être IMMÉDIATEMENT compréhensible — zero ambiguïté
✓ Chaque élément a une raison d'être fonctionnelle, pas seulement décorative
✓ L'ambiance visuelle est cohérente du header au footer — pas de clash de styles
✓ Les interactions CSS sont soignées : hover, active, focus visibles et fluides
✓ La scrollbar est customisée si fond sombre (::-webkit-scrollbar)
✓ La police Google Fonts est correctement chargée et appliquée

INTERDIT :
✗ "Lorem ipsum" ou textes génériques ("Title here", "Subtitle", "User Name")
✗ Données non-réalistes ("User 1", "Product A", "$0.00", "Company Name")
✗ Trop d'animations → max 3-4 éléments animés, subtils et purposeful
✗ Emoji à la place d'icônes Tabler
✗ Blanc pur #ffffff si l'image a un fond légèrement teinté off-white
✗ Copier la structure de navigation si elle ne correspond pas à la demande

${SHARED_RULES}
${IMAGE_RULES}

FORMAT : uniquement un bloc \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

// =============================================================================
// DÉTECTION DU MODE (scoring de mots-clés)
// =============================================================================

function detectMode(message: string | null): "clone" | "create" {
  if (!message?.trim()) return "clone";
  const msg = message.toLowerCase();

  const cloneKw = ["clone","reproduis","reproduit","copie","copier","pixel-perfect","identique",
    "identiquement","même interface","refais","recrée","exact","à l'identique","copy this",
    "reproduce","duplicate","replicate"];
  const createKw = ["crée","créer","génère","générer","fais","construis","construire","build",
    "create","make","generate","une app","une application","un dashboard","un crm","un erp",
    "une plateforme","un site","une boutique","un outil","landing","pour mon","je veux",
    "je voudrais","j'ai besoin","develop","design","nouvelle interface","new interface",
    "une page","un portail","une solution","un système","similaire","inspiré","dans le style"];

  const cScore = cloneKw.filter(k => msg.includes(k)).length;
  const dScore = createKw.filter(k => msg.includes(k)).length;

  if (dScore > cScore) return "create";
  if (dScore > 0 && cScore === 0) return "create";
  return "clone";
}

// =============================================================================
// BUILD PROMPT COULEURS
// =============================================================================

function buildColorPrompt(colorsRaw: string): string {
  try {
    const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
    const byZone: Record<string, { hex: string; frequency: number }[]> = {};
    for (const c of colors) {
      if (!byZone[c.zone]) byZone[c.zone] = [];
      byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
    }
    let block = "\n\n╔══ COULEURS CANVAS — MESURES PIXELS RÉELS ══╗\n";
    for (const [zone, cols] of Object.entries(byZone)) {
      const sorted = cols.sort((a, b) => b.frequency - a.frequency);
      block += `\n[${zone}]\n`;
      block += `  Background : ${sorted[0].hex}  (${sorted[0].frequency} px)\n`;
      if (sorted[1]) block += `  Texte/Acc. : ${sorted[1].hex}  (${sorted[1].frequency} px)\n`;
      if (sorted[2]) block += `  Détail     : ${sorted[2].hex}  (${sorted[2].frequency} px)\n`;
    }
    block += `\n╚══ Ces hex sont des FAITS mesurés. Utilise-les exactement dans :root {} ══╝\n`;
    block += `Continue jusqu'au </html> final. Ne t'arrête jamais au milieu.`;
    return block;
  } catch { return ""; }
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const message   = formData.get("message")  as string | null;
    const imageFile = formData.get("image")    as File | null;
    const histRaw   = formData.get("history")  as string | null;
    const colorsRaw = formData.get("colors")   as string | null;

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");
    const mode = detectMode(message);
    const systemPrompt = mode === "create" ? SYSTEM_CREATE : SYSTEM_CLONE;

    // ── Historique ──────────────────────────────────────────────────────────
    type Part    = { text: string } | { inlineData: { mimeType: string; data: string } };
    type Content = { role: "user" | "model"; parts: Part[] };

    const gemHist: Content[] = history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // ── Parts ───────────────────────────────────────────────────────────────
    const parts: Part[] = [];

    if (imageFile) {
      const bytes  = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    let prompt = "";
    if (mode === "clone") {
      prompt = message?.trim()
        ? `Reproduis cette interface en HTML/CSS pixel-perfect. Demande : "${message.trim()}"`
        : "Reproduis cette interface en HTML/CSS pixel-perfect. Chaque détail compte.";
      prompt += "\nUtilise les couleurs Canvas ci-dessous comme vérité absolue.";
    } else {
      prompt = `CRÉATION : "${message?.trim()}"\n` +
        `Extrais l'ADN visuel de l'image (couleurs exactes, typographie, géométrie, style des composants), ` +
        `puis crée une interface NOUVELLE, ORIGINALE et SENSATIONNELLE adaptée à cette demande. ` +
        `Invente des données réalistes. Ajoute des éléments créatifs inattendus qui élèvent le résultat. ` +
        `Utilise les couleurs Canvas ci-dessous comme palette de base.`;
    }

    if (colorsRaw) {
      try { prompt += buildColorPrompt(colorsRaw); } catch {}
    }

    parts.push({ text: prompt });

    // ── Appel Gemini ─────────────────────────────────────────────────────────
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [...gemHist, { role: "user", parts }],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 65536,
        temperature: mode === "create" ? 0.45 : 0.05,
      },
    });

    const rawContent = response.text ?? "";

    // ── Extraction HTML tolérante ────────────────────────────────────────────
    let htmlCode: string | null = null;

    const strict = rawContent.match(/```html\n?([\s\S]*?)```/i);
    if (strict) {
      htmlCode = strict[1].trim();
    } else {
      const loose = rawContent.match(/```html\n?([\s\S]*)/i);
      if (loose) {
        let c = loose[1].trim().replace(/```\s*$/, "").trim();
        if (c.includes("<html") || c.includes("<!DOCTYPE")) {
          if (!c.includes("</html>")) {
            if (!c.includes("</body>")) c += "\n</body>";
            c += "\n</html>";
          }
          htmlCode = c;
        }
      }
      // Si pas de bloc html mais du code HTML brut
      if (!htmlCode && (rawContent.includes("<!DOCTYPE") || rawContent.includes("<html"))) {
        htmlCode = rawContent.trim();
        if (!htmlCode.includes("</html>")) {
          if (!htmlCode.includes("</body>")) htmlCode += "\n</body>";
          htmlCode += "\n</html>";
        }
      }
    }

    return NextResponse.json({ content: rawContent, htmlCode, mode });

  } catch (error: unknown) {
    console.error("Erreur /api/chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur inconnue" },
      { status: 500 }
    );
  }
}
