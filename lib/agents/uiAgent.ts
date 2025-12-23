import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateUI(
  page: string,
  pkg: PKG,
  apiKey: string
) {
  const ai = new GoogleGenAI({ apiKey })

  const system = `
You generate ONE Next.js page.
Tech:
- Next.js App Router
- React
- TypeScript
- NO Tailwind
- Pure CSS
- Fully functional
- Use <create_file path=""> artifact
- No markdown
- No placeholder
- Every UI element must work

Follow PKG strictly.
`

  return ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify({ page, pkg }) }]
    }],
    config: { systemInstruction: system }
  })
}
