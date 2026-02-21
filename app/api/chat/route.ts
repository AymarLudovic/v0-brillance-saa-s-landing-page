import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

const SYSTEM = `Tu es un expert en reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Quand tu reçois une image d'interface :
- Analyse chaque couleur exacte (hex), espacement, typographie, ombre, border-radius
- Génère un fichier HTML complet et auto-suffisant (tout inline, Google Fonts si besoin, SVG pour les icônes)
- Utilise Flexbox/Grid pour reproduire les layouts fidèlement
- Réponds UNIQUEMENT avec le code HTML entre balises \`\`\`html et \`\`\`
Si l'utilisateur pose une question textuelle sans image, réponds normalement en français.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const imageFile = formData.get("image") as File | null;
    const historyRaw = formData.get("history") as string;
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
      generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
    });

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    parts.push({ text: message || "Reproduis cette interface en HTML/CSS pixel-perfect." });

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
