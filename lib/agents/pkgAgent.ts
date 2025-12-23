import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generatePKG(
  idea: string,
  apiKey: string
): Promise<PKG> {
  const ai = new GoogleGenAI({ apiKey })

  const prompt = `
You are a PRODUCT ARCHITECT.
Generate a COMPLETE Product Knowledge Graph (PKG) in JSON.

Rules:
- Return ONLY valid JSON.
- No markdown, no backticks, no text before or after the JSON.
- Structure: { "pkg": { "pages": {...}, "features": {...}, "interactions": {...} }, "plan": {...} }
`

  const res = await ai.models.generateContent({
    model: "gemini-3-flash-preview", // Utilise 1.5-flash pour plus de stabilité
    contents: [{
      role: "user",
      parts: [{ text: idea }]
    }],
    config: {
      systemInstruction: prompt,
      // On force l'IA à répondre en format JSON si possible
      responseMimeType: "application/json" 
    }
  })

  const rawText = res.response.text();

  try {
    // Tentative de parsing direct
    return JSON.parse(rawText)
  } catch (e) {
    // Si ça échoue, on tente d'extraire ce qui ressemble à du JSON
    console.warn("Parsing direct échoué, tentative d'extraction...")
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("L'IA n'a pas renvoyé un format JSON valide : " + rawText.substring(0, 100));
  }
}
