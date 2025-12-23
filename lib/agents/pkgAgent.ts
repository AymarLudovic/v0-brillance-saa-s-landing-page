import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generatePKG(idea: string, apiKey: string): Promise<PKG> {
  const ai = new GoogleGenAI(apiKey); // Syntaxe de ton projet
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const prompt = `Tu es un architecte produit. Génère un PKG complet au format JSON uniquement.
  Structure : { "pkg": { "pages": {...}, "features": {...}, "interactions": {...} } }`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: idea }] }],
    generationConfig: {
      systemInstruction: prompt,
      responseMimeType: "application/json",
    }
  });

  const text = result.response.text();
  return JSON.parse(text);
}
