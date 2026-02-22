import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM = `Tu es un expert en reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.

══════════════════════════════════════════
1. COULEURS — DONNÉES CANVAS FOURNIES
══════════════════════════════════════════
Le frontend t'envoie une liste des couleurs EXACTES extraites pixel par pixel depuis l'image via Canvas API.
Chaque couleur inclut : hex exact, région de l'image (haut-gauche, centre, etc.), fréquence d'apparition.
Tu DOIS utiliser UNIQUEMENT ces couleurs HEX exactes dans ton CSS. 
Ne jamais inventer ou approximer une couleur. Si une couleur est #1a2b3c, tu écris #1a2b3c, pas #1a2b40.
Centralise toutes les couleurs en CSS variables dans :root { } au début du <style>.

══════════════════════════════════════════
2. ESPACEMENTS & PROPORTIONS — SOIS CONSERVATEUR
══════════════════════════════════════════
RÈGLE D'OR : Quand tu es incertain d'un espacement, choisis la valeur PLUS PETITE.
- Si tu hésites entre padding: 8px et padding: 12px → choisis 8px
- Si tu hésites entre gap: 12px et gap: 16px → choisis 12px
- Si le border-radius semble subtil → 4px max, pas 12px
- Les icônes dans l'interface : taille par défaut 14px-16px, jamais 24px sauf si clairement grand
- Les font-size : du texte d'interface normal = 12px-13px, pas 16px
- Le padding d'un bouton compact = 4px 10px, d'un bouton normal = 6px 14px
- Le padding d'une card = 12px-16px max sauf si clairement spacieux dans l'image
- Ne jamais mettre de padding/margin par défaut généreux, toujours serré puis ajuster

══════════════════════════════════════════
3. ICÔNES — TABLER ICONS UNIQUEMENT
══════════════════════════════════════════
Dans le <head> TOUJOURS :
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">

Utilisation : <i class="ti ti-[nom]"></i>
Exemples : ti-home, ti-search, ti-settings, ti-user, ti-bell, ti-message, ti-chevron-right,
ti-dots-vertical, ti-plus, ti-x, ti-check, ti-mail, ti-calendar, ti-chart-bar, ti-building,
ti-users, ti-star, ti-file, ti-folder, ti-edit, ti-trash, ti-eye, ti-lock, ti-inbox, ti-send,
ti-phone, ti-filter, ti-refresh, ti-copy, ti-code, ti-database, ti-cloud, ti-moon, ti-sun,
ti-arrow-left, ti-arrow-right, ti-trending-up, ti-trending-down, ti-alert-triangle,
ti-info-circle, ti-circle-check, ti-brand-github, ti-brand-twitter, ti-brand-linkedin,
ti-brand-slack, ti-brand-figma, ti-layout-dashboard, ti-layout-sidebar, ti-grid-dots, ti-list

Taille : contrôle via font-size dans le style de l'élément parent ou une classe CSS.
JAMAIS de SVG inline. JAMAIS d'autres bibliothèques d'icônes.

══════════════════════════════════════════
4. LOGOS D'ENTREPRISES
══════════════════════════════════════════
Utilise Google Favicons HD (gratuit, sans clé API) :
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:20px;height:20px;object-fit:contain">

Exemples :
- Apple    → https://www.google.com/s2/favicons?domain=apple.com&sz=64
- Google   → https://www.google.com/s2/favicons?domain=google.com&sz=64
- OpenAI   → https://www.google.com/s2/favicons?domain=openai.com&sz=64
- Slack    → https://www.google.com/s2/favicons?domain=slack.com&sz=64
- Notion   → https://www.google.com/s2/favicons?domain=notion.so&sz=64
- Stripe   → https://www.google.com/s2/favicons?domain=stripe.com&sz=64
- GitHub   → https://www.google.com/s2/favicons?domain=github.com&sz=64
- Figma    → https://www.google.com/s2/favicons?domain=figma.com&sz=64
- Zoom     → https://www.google.com/s2/favicons?domain=zoom.us&sz=64
- Trello   → https://www.google.com/s2/favicons?domain=trello.com&sz=64
- Asana    → https://www.google.com/s2/favicons?domain=asana.com&sz=64
- Linear   → https://www.google.com/s2/favicons?domain=linear.app&sz=64
- Vercel   → https://www.google.com/s2/favicons?domain=vercel.com&sz=64
- ClickUp  → https://www.google.com/s2/favicons?domain=clickup.com&sz=64
- Meta     → https://www.google.com/s2/favicons?domain=meta.com&sz=64
→ Format général : https://www.google.com/s2/favicons?domain=[domaine]&sz=64

══════════════════════════════════════════
5. AVATARS DE PROFIL — 3D RÉALISTES
══════════════════════════════════════════
Utilise DiceBear style "lorelei" pour des avatars illustrés de qualité :
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Alice&backgroundColor=b6e3f4" style="width:32px;height:32px;border-radius:50%">

Ou style "personas" pour un rendu plus réaliste :
<img src="https://api.dicebear.com/9.x/personas/svg?seed=John" style="width:32px;height:32px;border-radius:50%">

Adapte le seed au prénom/nom visible dans l'image pour des avatars cohérents.

══════════════════════════════════════════
6. STRUCTURE HTML OBLIGATOIRE
══════════════════════════════════════════
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=FONT_ICI&display=swap" rel="stylesheet">
  <style>
    :root { /* couleurs extraites canvas */ }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'FONT_ICI', system-ui, sans-serif; background: var(--bg); }
  </style>
</head>
<body>...</body>
</html>

══════════════════════════════════════════
7. FORMAT DE RÉPONSE
══════════════════════════════════════════
- Image reçue → réponds UNIQUEMENT avec le bloc \`\`\`html ... \`\`\`
- Question textuelle → réponds en français
- Aucune explication avant/après le HTML`;

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
      generationConfig: { maxOutputTokens: 8192, temperature: 0.05 },
    });

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    // Build the text prompt with canvas color data
    let prompt = message || "Reproduis cette interface en HTML/CSS pixel-perfect.";

    if (colorsRaw) {
      const colors: { hex: string; frequency: number; region: string; xPct: number; yPct: number }[] = JSON.parse(colorsRaw);
      const colorLines = colors
        .map((c) => `  ${c.hex}  →  région: ${c.region} (x:${c.xPct}%, y:${c.yPct}%)  fréquence: ${c.frequency}`)
        .join("\n");
      prompt += `

══════════════════════════════════════════
COULEURS EXTRAITES PAR CANVAS (pixel exact) — UTILISE CES VALEURS HEX UNIQUEMENT :
══════════════════════════════════════════
${colorLines}

INSTRUCTIONS :
1. Ces couleurs sont extraites pixel par pixel depuis l'image via Canvas API — elles sont 100% exactes
2. Utilise-les telles quelles dans tes CSS variables
3. La couleur la plus fréquente est généralement le fond principal
4. Les couleurs rares sont souvent des accents, bordures ou textes spéciaux
5. La région indique où dans l'image cette couleur apparaît majoritairement
6. Respecte des espacements SERRÉS — préfère toujours la valeur plus petite en cas de doute`;
    }

    parts.push({ text: prompt });

    const result = await chat.sendMessage(parts);
    const content = result.response.text();
    const htmlMatch = content.match(/```html\n?([\s\S]*?)```/i);
    const htmlCode = htmlMatch ? htmlMatch[1].trim() : null;

    return NextResponse.json({ content, htmlCode });
  } catch (error: unknown) {
    console.error("Erreur Gemini:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur inconnue" },
      { status: 500 }
    );
  }
      }
