import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

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
LOGOS D'ENTREPRISES
══════════════════════════════════════════
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:18px;height:18px;object-fit:contain">
Format : https://www.google.com/s2/favicons?domain=[domaine]&sz=64

══════════════════════════════════════════
AVATARS
══════════════════════════════════════════
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">

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
</html>`;

const SYSTEM_CLONE = `Tu es un expert en reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Génère du HTML complet, sans jamais te couper avant </html>.

MODE : CLONE PIXEL-PERFECT
Ton objectif est de reproduire l'image fournie à l'identique :
- Copie chaque élément visible : layout, typographie, couleurs, ombres, bordures, icônes, avatars, logos
- Respecte les proportions et espacements exacts (voir règles ci-dessous)
- Ce que tu vois sur l'image doit être identique dans le HTML généré
${SHARED_RULES}

FORMAT : Image → UNIQUEMENT \`\`\`html ... \`\`\` — Question → français`;

const SYSTEM_CREATE = `Tu es un expert UI/UX qui crée de nouvelles interfaces HTML/CSS à partir d'un design system de référence.
Génère du HTML complet, sans jamais te couper avant </html>.

MODE : CRÉATION AVEC DESIGN SYSTEM
L'utilisateur t'envoie une image de référence qui contient un design system (composants, couleurs, typographie, style visuel).
Ton objectif est DOUBLE :
1. ANALYSER l'image de référence pour extraire le design system :
   - Identifier tous les composants réutilisables (sidebar, cards, boutons, badges, tables, inputs, avatars, headers...)
   - Extraire leur style exact : couleurs, border-radius, ombres, padding, typographie
   - Comprendre la grammaire visuelle : est-ce minimal ? dense ? arrondi ? plat ? coloré ?
2. CRÉER la nouvelle page demandée par l'utilisateur en utilisant ce design system :
   - Reproduis fidèlement les composants existants (même style CSS exact)
   - Utilise les mêmes couleurs, les mêmes espacements, la même typographie
   - Construis la page demandée avec du VRAI CONTENU pertinent (pas de Lorem ipsum)
   - La nouvelle page doit sembler faire partie de la même application que l'image de référence
   - Invente les données/contenu appropriés pour la page demandée

IMPORTANT : tu ne reproduis PAS l'image — tu crées quelque chose de NOUVEAU en restant dans le même univers visuel.
${SHARED_RULES}

FORMAT : Image + demande → UNIQUEMENT \`\`\`html ... \`\`\` — Question → français`;

function buildColorPrompt(colorsRaw: string): string {
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
  block += `\nRègle : chaque hex va sur l'élément correspondant à sa zone. sidebar-gauche → --sidebar-bg, header-top → --header-bg, contenu-principal → --main-bg, milieu-centre → --card-bg. Génère jusqu'au </html> final sans t'arrêter.`;
  return block;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const imageFile = formData.get("image") as File | null;
    const historyRaw = formData.get("history") as string;
    const colorsRaw = formData.get("colors") as string | null;
    const mode = (formData.get("mode") as string) || "clone";
    const history: { role: string; content: string }[] = JSON.parse(historyRaw || "[]");

    const systemPrompt = mode === "create" ? SYSTEM_CREATE : SYSTEM_CLONE;

    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: systemPrompt,
    });

    const geminiHistory = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: { maxOutputTokens: 65536, temperature: 0.05 },
    });

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    let prompt = message || (mode === "create"
      ? "Crée une nouvelle page en utilisant le design system de cette image."
      : "Reproduis cette interface en HTML/CSS pixel-perfect.");

    if (colorsRaw) prompt += buildColorPrompt(colorsRaw);
    parts.push({ text: prompt });

    const result = await chat.sendMessage(parts);
    const rawContent = result.response.text();

    // Extraction HTML tolérante
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
    console.error("Erreur Gemini:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur inconnue" },
      { status: 500 }
    );
  }
  }
