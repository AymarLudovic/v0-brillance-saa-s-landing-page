import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateUI(page: string, pkg: PKG, apiKey: string) {
  const ai = new GoogleGenAI({ apiKey })
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" })

  const system = `
   DIRECTIVE : GÉNÉRATION UI NEXT.JS
   Tu génères le code pour la page : ${page}
   STRICT : Utilise uniquement du CSS pur. Format XML obligatoire.
   <create_file path="app/${page}/page.tsx">code</create_file>
  `

  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ page, pkg }) }] }],
    generationConfig: { systemInstruction: system }
  })
}
