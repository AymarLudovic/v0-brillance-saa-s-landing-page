import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generatePKG(idea: string, apiKey: string): Promise<PKG> {
  const genAI = new GoogleGenAI(apiKey); // Correction ici: direct apiKey
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `Tu es un architecte produit. Génère un PKG complet au format JSON uniquement.
  Structure : { "pkg": { "pages": {...}, "features": {...}, "interactions": {...} } }`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: idea }] }],
    generationConfig: {
      responseMimeType: "application/json",
    }
  });

  const text = result.response.text();
  return JSON.parse(text);
}
