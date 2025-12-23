import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateUI(page: string, pkg: PKG, apiKey: string) {
  const genAI = new GoogleGenAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const system = `Génère le code Next.js pour la page : ${page}. 
  Utilise impérativement le format : <create_file path="app/${page}/page.tsx">code</create_file>`;

  // Utilisation correcte de generateContentStream sur le modèle
  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ page, pkg }) }] }],
    generationConfig: { systemInstruction: system }
  });
}
