import { GoogleGenAI } from "@google/genai"
import { PKG } from "../types"

export async function generateBackend(pkg: PKG, apiKey: string) {
  const genAI = new GoogleGenAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const system = `Génère la logique backend. 
  Utilise : <create_file path="lib/backend.ts">code</create_file>`;

  return model.generateContentStream({
    contents: [{ role: "user", parts: [{ text: JSON.stringify(pkg) }] }],
    generationConfig: { systemInstruction: system }
  });
}
