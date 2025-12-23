import { GoogleGenAI, SchemaType } from "@google/genai"
import { PKG } from "../types"

export async function generatePKG(
  idea: string,
  apiKey: string
): Promise<PKG> {
  const ai = new GoogleGenAI({ apiKey })
  // Utilisation de la méthode getGenerativeModel conforme à ton autre projet
  const model = ai.getGenerativeModel({ 
    model: "gemini-3-flash-preview",
  })

  const prompt = `
You are a PRODUCT ARCHITECT. Generate a Product Knowledge Graph (PKG).
Format: JSON ONLY.
Structure:
{
  "pkg": {
    "pages": { "page_name": { "path": "...", "logic": "..." } },
    "features": { "name": { "functionality": "..." } },
    "interactions": { "name": { "trigger": "..." } }
  }
}
`

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: idea }] }],
    generationConfig: {
      systemInstruction: prompt,
      responseMimeType: "application/json", // Force la sortie JSON
    }
  })

  const response = result.response;
  const text = response.text();

  try {
    // Nettoyage au cas où Gemini ajouterait des backticks malgré le mimeType
    const cleanJson = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson);
  } catch (e) {
    console.error("PKG Parsing Error. Raw text:", text);
    throw new Error("Failed to parse PKG JSON");
  }
}
