import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: Request) {
  try {
    const { userPrompt, availableStyles } = await req.json();
    
    // On utilise la même clé que l'autre route
    const apiKey = process.env.GEMINI_API_KEY; 
    if (!apiKey) return NextResponse.json({ selectedId: null });

    const ai = new GoogleGenAI({ apiKey });
    const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prompt de décision ultra-rapide
    const prompt = `
    Role: Senior Art Director.
    Task: Select the best matching UI Style for a user project from a list.
    
    User Project Request: "${userPrompt}"
    
    Available Styles:
    ${JSON.stringify(availableStyles)}
    
    Instructions:
    1. Analyze the user's intent (e.g., "Crypto" needs dark/tech themes, "Bakery" needs warm/light themes).
    2. Pick the ONE style ID that fits best.
    3. If absolutely nothing fits, return null.
    4. Return ONLY a JSON object: { "selectedId": "..." } or { "selectedId": null }
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Nettoyage du JSON
    const cleanJson = responseText.replace(/```json|```/g, '').trim();
    const decision = JSON.parse(cleanJson);

    return NextResponse.json(decision);

  } catch (error) {
    console.error("Design selection error:", error);
    return NextResponse.json({ selectedId: null });
  }
}
