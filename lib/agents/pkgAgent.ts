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
- Every page must be real
- Every feature must be functional
- No fake data
- No UI without logic
- Include 404, auth, empty states
- Think like Netflix / Spotify level product

Return ONLY valid JSON.
`

  const res = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{
      role: "user",
      parts: [{ text: idea }]
    }],
    config: {
      systemInstruction: prompt
    }
  })

  return JSON.parse(res.text!)
}
