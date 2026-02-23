import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// =============================================================================
// RÈGLES PARTAGÉES — identiques dans les deux modes
// =============================================================================

const SHARED_RULES = `
══════════════════════════════════════════
COULEURS — MAPPING PAR ZONE OBLIGATOIRE
══════════════════════════════════════════
Le frontend t'envoie les couleurs EXACTES extraites par Canvas API, organisées par zone :
- "sidebar-gauche"    → fond et textes de la sidebar
- "header-top"        → fond et textes du header
- "contenu-principal" → fond du contenu main
- "coin-haut-gauche"  → zone logo/titre
- "bas-page"          → footer ou barre basse
- "milieu-centre"     → cards et composants centraux
- "colonne-droite"    → panneau droit si présent

RÈGLE : la couleur la plus fréquente d'une zone = son background. Les moins fréquentes = textes/bordures.
Déclare tout en CSS variables :root {} avec des noms sémantiques clairs.
N'invente AUCUNE couleur. N'approxime rien.

══════════════════════════════════════════
ESPACEMENTS — TOUJOURS SERRÉ
══════════════════════════════════════════
- En cas de doute : prendre la valeur INFÉRIEURE
- Texte interface = 12px-13px
- Icônes = 14px-16px
- Padding bouton compact = 4px 10px
- Padding card = 10px-14px max
- Border-radius subtil = 4px-6px
- Gap items liste = 2px-4px

══════════════════════════════════════════
ICÔNES — TABLER ICONS UNIQUEMENT
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-[nom]"></i>
Noms : home, search, settings, user, bell, message, chevron-right, dots-vertical, plus, x, check,
mail, calendar, chart-bar, building, users, star, file, folder, edit, trash, eye, lock, inbox,
send, phone, filter, refresh, copy, code, database, cloud, moon, sun, arrow-left, arrow-right,
trending-up, trending-down, alert-triangle, info-circle, circle-check, brand-github,
brand-twitter, brand-linkedin, brand-slack, brand-figma, layout-dashboard, layout-sidebar,
grid-dots, list, tag, external-link, adjustments, at, logout, upload, download

══════════════════════════════════════════
IMAGES & URLS — SOURCES RÉELLES OBLIGATOIRES
══════════════════════════════════════════
Logos entreprises  : https://www.google.com/s2/favicons?domain=[domaine]&sz=64
  → <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:18px;height:18px;object-fit:contain">

Avatars utilisateurs : https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9
  → <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Alice&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">

Images de contenu (produits, covers, illustrations) : https://picsum.photos/seed/[mot-clé]/[largeur]/[hauteur]
  → <img src="https://picsum.photos/seed/product1/300/200" style="width:100%;object-fit:cover">

JAMAIS : /placeholder.png, /avatar.jpg, des chemins locaux inventés, ou des images cassées.
Toutes les src d'images dans le HTML généré doivent être des URLs qui fonctionnent.

══════════════════════════════════════════
STRUCTURE HTML — NE JAMAIS S'ARRÊTER AVANT </html>
══════════════════════════════════════════
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=FONT&display=swap" rel="stylesheet">
  <style>
    :root { /* variables couleurs par zone */ }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'FONT', system-ui, sans-serif; }
  </style>
</head>
<body><!-- Contenu complet --></body>
</html>

IMPORTANT : génère TOUJOURS le HTML complet jusqu'au </html> final.
Ne t'arrête jamais au milieu. Si tu dois tronquer, complète quand même les balises ouvertes.`;

// =============================================================================
// SYSTEM PROMPT UNIFIÉ — auto-détection clone vs création
// L'agent décide lui-même du mode selon la demande utilisateur.
// Plus besoin de passer mode="clone" ou mode="create" depuis le client.
// =============================================================================

const SYSTEM_UNIFIED = `Tu es un expert en design d'interfaces et en reproduction d'UX.
Tu reçois une image de référence et (parfois) une demande utilisateur.
Tu génères du HTML/CSS complet, sans jamais te couper avant </html>.

══════════════════════════════════════════
ÉTAPE 1 — AUTO-DÉTECTION DU MODE (silencieuse, jamais mentionnée dans la réponse)
══════════════════════════════════════════

Analyse la demande utilisateur et choisis automatiquement :

▶ MODE CLONE — si l'utilisateur veut reproduire l'image telle quelle :
  Indices : "clone", "reproduis", "copie", "pixel-perfect", "même interface", "refais cette page",
  aucun texte fourni, ou demande vague sans description d'application différente.

▶ MODE CRÉATION — si l'utilisateur décrit une application ou page DIFFÉRENTE de l'image :
  Indices : "crée une app de...", "génère une interface pour...", "je veux un CRM", "fais moi un dashboard pour...",
  toute description qui ne correspond pas au contenu visible de l'image.

Si aucun texte → MODE CLONE par défaut.

══════════════════════════════════════════
COMPORTEMENT MODE CLONE — PIXEL-PERFECT
══════════════════════════════════════════

Reproduis l'image à l'identique :
- Copie chaque élément visible : layout, typographie, couleurs, ombres, bordures, icônes, avatars, logos
- Respecte les proportions et espacements exacts
- Ce que tu vois sur l'image doit être identique dans le HTML généré
- Utilise les couleurs extraites par zone pour chaque section correspondante
- Textes et icônes en couleur noire ou très proche du noir, jamais gris bleuté
- Tables denses et compactes avec colonnes réduites

══════════════════════════════════════════
COMPORTEMENT MODE CRÉATION — DESIGN SYSTEM ADAPTÉ
══════════════════════════════════════════

L'image est ta PALETTE DE STYLE, pas un layout à copier. Procède en 3 étapes :

ÉTAPE A — EXTRAIT le design system de l'image :
  → Couleurs exactes (hex) par zone → CSS variables :root {}
  → Typographie : famille de police, tailles, poids utilisés
  → Style des composants : border-radius, ombres, densité, paddings
  → Ambiance générale (dark/light, dense/aéré, coloré/neutre, glassmorphism...)
  → Ne PAS copier la structure de navigation ou le layout de l'image

ÉTAPE B — DÉDUIS le bon layout selon la demande :
  → App dashboard / SaaS / back-office   → sidebar de navigation + main content
  → Landing page / marketing / startup   → header + sections verticales + footer
  → E-commerce / marketplace             → grille produits + filtres latéraux
  → CRM / ERP / base de données          → table dense + filtres + sidebar étroite
  → App mobile web                       → bottom navigation + cartes scrollables
  → Adapte la structure à l'USAGE demandé, pas à l'image

ÉTAPE C — CONSTRUIS une interface qui :
  → Utilise les couleurs, typographie et styles de composants extraits à l'étape A
  → Adopte le layout logiquement adapté à la demande (étape B)
  → Contient du VRAI CONTENU pertinent pour cet usage (jamais Lorem ipsum)
  → Paraît appartenir au même univers visuel que l'image de référence
  → Est structurellement et fonctionnellement taillée pour l'usage demandé

Exemple concret :
  Image = dashboard analytics dark avec sidebar violet
  Demande = "crée un landing page pour une startup fintech"
  → Extraire : fond sombre, accent violet, typographie, style cards, border-radius
  → Layout : hero + features + pricing + CTA — SANS sidebar
  → Ne pas imposer la sidebar de l'image dans le landing page

${SHARED_RULES}

FORMAT DE RÉPONSE : UNIQUEMENT \`\`\`html ... \`\`\` — Question sans image → réponse en français`;

// =============================================================================
// Construction du prompt couleurs depuis les zones Canvas envoyées par le client
// =============================================================================

function buildColorPrompt(colorsRaw: string): string {
  try {
    const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
    const byZone: Record<string, { hex: string; frequency: number }[]> = {};
    for (const c of colors) {
      if (!byZone[c.zone]) byZone[c.zone] = [];
      byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
    }
    let block = "\n══ COULEURS CANVAS PAR ZONE ══\n";
    for (const [zone, cols] of Object.entries(byZone)) {
      const sorted = cols.sort((a, b) => b.frequency - a.frequency);
      block += `\n[${zone}]\n  → fond : ${sorted[0].hex}\n`;
      const rest = sorted.slice(1, 3).map((c) => c.hex).join(", ");
      if (rest) block += `  → textes/détails : ${rest}\n`;
    }
    block += `\nRègle de mapping : sidebar-gauche → --sidebar-bg, header-top → --header-bg, contenu-principal → --main-bg, milieu-centre → --card-bg, colonne-droite → --right-panel-bg. Génère jusqu'au </html> final sans jamais t'arrêter.`;
    return block;
  } catch {
    return "";
  }
}

// =============================================================================
// POST handler
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message    = formData.get("message")  as string | null;
    const imageFile  = formData.get("image")    as File | null;
    const historyRaw = formData.get("history")  as string | null;
    const colorsRaw  = formData.get("colors")   as string | null;

    const history: { role: string; content: string }[] = JSON.parse(historyRaw || "[]");

    // ── Historique au format @google/genai ──────────────────────────────────
    type Part    = { text: string } | { inlineData: { mimeType: string; data: string } };
    type Content = { role: "user" | "model"; parts: Part[] };

    const geminiHistory: Content[] = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // ── Parts du message courant ────────────────────────────────────────────
    const parts: Part[] = [];

    // Injection de l'image si présente
    if (imageFile) {
      const bytes  = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({
        inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 },
      });
    }

    // Construction du prompt — le modèle détecte lui-même le mode
    let prompt = message?.trim()
      ? `Demande utilisateur : "${message.trim()}"\n\nAnalyse cette demande, détermine si tu es en mode CLONE ou CRÉATION, puis génère le HTML/CSS approprié selon les règles de ton système.`
      : "Analyse cette image et reproduis-la en HTML/CSS pixel-perfect.";

    if (colorsRaw) {
      prompt += buildColorPrompt(colorsRaw);
    }

    parts.push({ text: prompt });

    // ── Appel @google/genai — même pattern que dans le code existant ─────────
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...geminiHistory,
        { role: "user", parts },
      ],
      config: {
        systemInstruction: SYSTEM_UNIFIED,
        maxOutputTokens: 65536,
        temperature: 0.05,
      },
    });

    const rawContent = response.text ?? "";

    // ── Extraction HTML tolérante (identique à avant) ───────────────────────
    let htmlCode: string | null = null;

    const strictMatch = rawContent.match(/```html\n?([\s\S]*?)```/i);
    if (strictMatch) {
      htmlCode = strictMatch[1].trim();
    } else {
      const looseMatch = rawContent.match(/```html\n?([\s\S]*)/i);
      if (looseMatch) {
        let candidate = looseMatch[1].trim().replace(/```\s*$/, "").trim();
        if (candidate.includes("<html") || candidate.includes("<!DOCTYPE")) {
          if (!candidate.includes("</html>")) {
            if (!candidate.includes("</body>")) candidate += "\n</body>";
            candidate += "\n</html>";
          }
          htmlCode = candidate;
        }
      }
    }

    return NextResponse.json({ content: rawContent, htmlCode });

  } catch (error: unknown) {
    console.error("Erreur Gemini /api/chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur inconnue" },
      { status: 500 }
    );
  }
    }
