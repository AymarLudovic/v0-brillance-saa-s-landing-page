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

IMPORTANT:
- Return ONLY valid JSON
- Do NOT use Markdown or backticks
- Do NOT include any explanation or commentary
- The JSON must include exactly the keys: "pkg" and "plan"
- Wrap generated files using your XML artifact <create_file path="">code</create_file> if needed

Return ONLY valid JSON.
IMPORTANT:
- Always include "pages", "features", and "interactions" keys, even if empty.
{
  "pages": {},
  "features": {},
  "interactions": {}
}

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
