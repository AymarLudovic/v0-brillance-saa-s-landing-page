import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateBackend(pkg: PKG, apiKey: string) {
  const ai = new GoogleGenAI({ apiKey })
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" })

  const system = `
   DIRECTIVE : BACKEND & LOGIC
   Génère la logique API et les modèles de données.
   Format XML obligatoire.
   <create_file path="lib/backend.ts">code</create_file>
  `

  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify(pkg) }] }],
    generationConfig: { systemInstruction: system }
  })
                       }
