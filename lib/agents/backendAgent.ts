import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateBackend(
  pkg: PKG,
  apiKey: string
) {
  const ai = new GoogleGenAI({ apiKey })

  return ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify(pkg) }]
    }],
    config: {
      systemInstruction: `
Generate backend logic.
- Auth
- Data models
- APIs
- Security
- No fake logic
- IndexedDB allowed for demo
- Use <create_file />
`
    }
  })
}
