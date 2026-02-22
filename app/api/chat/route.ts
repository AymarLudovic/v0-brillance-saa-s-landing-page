import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM = `Tu es un expert en reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Génère du HTML complet, sans jamais te couper en chemin. Si le code est long, continue jusqu'au </html> final.

══════════════════════════════════════════
1. COULEURS — MAPPING PAR ZONE OBLIGATOIRE
══════════════════════════════════════════
Le frontend t'envoie les couleurs EXACTES extraites par Canvas API, organisées par zone visuelle de l'image :
- "sidebar-gauche"    → couleurs présentes dans le panneau latéral gauche
- "header-top"        → couleurs de la barre du haut
- "contenu-principal" → couleurs de la zone principale de contenu
- "coin-haut-gauche"  → couleurs du logo/titre en haut à gauche
- "bas-page"          → couleurs du footer ou barre du bas
- "milieu-centre"     → couleurs des cards/composants centraux
- "colonne-droite"    → couleurs du panneau droit si présent

RÈGLE ABSOLUE : Applique chaque couleur à l'élément correspondant à sa zone.
- Les couleurs de "sidebar-gauche" → vont sur le CSS de la sidebar
- Les couleurs de "header-top" → vont sur le CSS du header
- Les couleurs de "contenu-principal" → vont sur le CSS du main/body
- La couleur la plus fréquente dans une zone = son fond (background)
- La couleur moins fréquente dans une zone = ses textes ou bordures

Déclare tout en CSS variables dans :root avec des noms clairs :
:root {
  --sidebar-bg: [hex de la couleur dominante de sidebar-gauche];
  --sidebar-text: [hex du texte dans sidebar-gauche];
  --header-bg: [hex de header-top];
  --main-bg: [hex de contenu-principal];
  --card-bg: [hex de milieu-centre];
  etc.
}

══════════════════════════════════════════
2. ESPACEMENTS — TOUJOURS SERRÉ
══════════════════════════════════════════
- En cas de doute sur un espacement : prendre la valeur INFÉRIEURE
- Texte d'interface = 12px-13px (pas 16px)
- Icônes = 14px-16px (pas 24px)
- Padding bouton compact = 4px 10px
- Padding card = 10px-14px max
- Border-radius subtil = 4px-6px, pas 12px sauf si clairement arrondi
- Gap entre items de liste = 2px-4px

══════════════════════════════════════════
3. ICÔNES — TABLER ICONS UNIQUEMENT
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
Usage : <i class="ti ti-[nom]"></i>
Noms : home, search, settings, user, bell, message, chevron-right, dots-vertical, plus, x,
check, mail, calendar, chart-bar, building, users, star, file, folder, edit, trash, eye,
lock, inbox, send, phone, filter, refresh, copy, code, database, cloud, moon, sun,
arrow-left, arrow-right, trending-up, trending-down, alert-triangle, info-circle,
circle-check, brand-github, brand-twitter, brand-linkedin, brand-slack, brand-figma,
layout-dashboard, layout-sidebar, grid-dots, list, tag, external-link, adjustments

══════════════════════════════════════════
4. LOGOS D'ENTREPRISES
══════════════════════════════════════════
Google Favicons (gratuit, sans clé) :
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:18px;height:18px;object-fit:contain">
Remplace "apple.com" par le domaine voulu : google.com, openai.com, slack.com, notion.so,
stripe.com, github.com, figma.com, zoom.us, trello.com, asana.com, linear.app, vercel.com,
clickup.com, meta.com, microsoft.com, salesforce.com, hubspot.com, intercom.io

══════════════════════════════════════════
5. AVATARS
══════════════════════════════════════════
DiceBear lorelei (propres, colorés) :
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">
Remplace NOM par le prénom/nom visible dans l'image.

══════════════════════════════════════════
6. STRUCTURE OBLIGATOIRE — NE JAMAIS S'ARRÊTER AVANT </html>
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
<body>
  <!-- REPRODUCTION COMPLÈTE — ne jamais couper -->
</body>
</html>

FORMAT : Image → UNIQUEMENT \`\`\`html ... \`\`\` — Question → français`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const imageFile = formData.get("image") as File | null;
    const historyRaw = formData.get("history") as string;
    const colorsRaw = formData.get("colors") as string | null;
    const history: { role: string; content: string }[] = JSON.parse(historyRaw || "[]");

    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: SYSTEM,
    });

    const geminiHistory = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: {
        maxOutputTokens: 65536, // max possible pour ne jamais couper
        temperature: 0.05,
      },
    });

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    let prompt = message || "Reproduis cette interface en HTML/CSS pixel-perfect.";

    if (colorsRaw) {
      const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);

      // Groupe par zone pour un mapping clair
      const byZone: Record<string, { hex: string; frequency: number }[]> = {};
      for (const c of colors) {
        if (!byZone[c.zone]) byZone[c.zone] = [];
        byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
      }

      let colorBlock = "\n══ COULEURS CANVAS PAR ZONE (hex exact — applique chaque couleur à sa zone) ══\n";
      for (const [zone, cols] of Object.entries(byZone)) {
        const sorted = cols.sort((a, b) => b.frequency - a.frequency);
        const dominant = sorted[0];
        const secondary = sorted.slice(1, 3).map((c) => c.hex).join(", ");
        colorBlock += `\n[${zone}]\n`;
        colorBlock += `  → FOND (le plus fréquent) : ${dominant.hex}\n`;
        if (secondary) colorBlock += `  → textes/bordures : ${secondary}\n`;
      }

      colorBlock += `
INSTRUCTIONS COULEURS :
- Utilise exactement ces hex dans tes CSS variables :root {}
- sidebar-gauche dominant = --sidebar-bg
- header-top dominant = --header-bg  
- contenu-principal dominant = --main-bg
- milieu-centre dominant = --card-bg
- N'invente AUCUNE couleur, n'approxime rien
- Génère le HTML COMPLET jusqu'à </html> sans jamais t'arrêter`;

      prompt += colorBlock;
    }

    parts.push({ text: prompt });

    const result = await chat.sendMessage(parts);
    const rawContent = result.response.text();

    // Extraction HTML tolérante : accepte même si la balise fermante ``` manque
    let htmlCode: string | null = null;
    const strictMatch = rawContent.match(/```html\n?([\s\S]*?)```/i);
    if (strictMatch) {
      htmlCode = strictMatch[1].trim();
    } else {
      // Fallback : prend tout ce qui suit ```html jusqu'à la fin
      const looseMatch = rawContent.match(/```html\n?([\s\S]*)/i);
      if (looseMatch) {
        let candidate = looseMatch[1].trim();
        // Retire le ``` final s'il est là sans le \n
        candidate = candidate.replace(/```\s*$/, "").trim();
        // Valide qu'on a au moins un <html ou <!DOCTYPE
        if (candidate.includes("<html") || candidate.includes("<!DOCTYPE")) {
          // Si le HTML est incomplet (pas de </html>), ferme proprement
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
