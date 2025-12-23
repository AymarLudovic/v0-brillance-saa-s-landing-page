import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateUI(page: string, pkg: PKG, apiKey: string) {
  const ai = new GoogleGenAI(apiKey);
  const model = ai.getGenerativeModel({ model: "gemini-3-flash-preview" });

  const system = `Génère le code Next.js pour la page : ${page}. 
  Utilise impérativement le format : <create_file path="app/${page}/page.tsx">code</create_file>`;

  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ page, pkg }) }] }],
    config: { systemInstruction: system } // Utilisation de 'config' comme dans ton exemple
  });
}
