import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// gemini-3-flash-preview : vision activée, free tier, le meilleur flash pour la vision
const MODEL = "gemini-3-flash-preview";

const PIXEL_PERFECT_SYSTEM_PROMPT = `Tu es un expert absolu en reproduction pixel-perfect d'interfaces utilisateur en HTML/CSS pur.

Quand on te donne une image d'une interface :
1. ANALYSE minutieusement : couleurs exactes (utilise eyedropper mental), espacements, typographie, ombres, border-radius, opacités
2. GÉNÈRE un fichier HTML complet et auto-suffisant (tout en inline, pas de fichiers externes sauf Google Fonts si nécessaire)
3. RÈGLES STRICTES de reproduction :
   - Utilise les couleurs EXACTES visibles (hex précis)
   - Reproduis chaque pixel de padding/margin/gap
   - Copie la hiérarchie visuelle identiquement
   - Inclus les icônes avec des SVG inline ou des caractères Unicode proches
   - Utilise Flexbox/Grid pour reproduire les layouts exactement
   - Ajoute les box-shadow, border, border-radius exacts
   - Reproduis les états hover si visibles
   - Respecte les font-weight, font-size, line-height, letter-spacing

FORMAT DE RÉPONSE :
- Si l'utilisateur envoie une image → réponds UNIQUEMENT avec le bloc HTML complet entre balises \`\`\`html et \`\`\`
- Si l'utilisateur pose une question textuelle → réponds normalement en français
- Ne jamais mettre d'explication avant ou après le bloc HTML quand tu reproduis une image

QUALITÉ : Vise 95%+ de fidélité visuelle. Chaque détail compte.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const imageFile = formData.get("image") as File | null;
    const historyRaw = formData.get("history") as string;

    let history: { role: string; content: string }[] = [];
    try {
      history = JSON.parse(historyRaw || "[]");
    } catch {
      history = [];
    }

    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: PIXEL_PERFECT_SYSTEM_PROMPT,
    });

    // Construire l'historique au format Gemini
    const geminiHistory = history.slice(0, -0).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: {
        maxOutputTokens: 8192, // Large pour les gros HTML
        temperature: 0.1,      // Très bas pour la précision
      },
    });

    // Construire le contenu du message
    type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: GeminiPart[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const mimeType = imageFile.type || "image/jpeg";

      parts.push({
        inlineData: { mimeType, data: base64 },
      });
      parts.push({
        text: message || "Reproduis cette interface en HTML/CSS pixel-perfect. Génère le code complet.",
      });
    } else {
      parts.push({ text: message || "" });
    }

    const result = await chat.sendMessage(parts);
    const rawContent = result.response.text();

    // Extraire le bloc HTML s'il existe
    const htmlMatch = rawContent.match(/```html\n?([\s\S]*?)```/i);
    const htmlCode = htmlMatch ? htmlMatch[1].trim() : null;

    return NextResponse.json({
      content: rawContent,
      htmlCode,          // HTML extrait pour l'iframe
      hasImage: !!imageFile,
      model: MODEL,
    });
  } catch (error: unknown) {
    console.error("Erreur Gemini Vision:", error);
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  }
