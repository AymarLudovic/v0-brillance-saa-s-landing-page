import { GoogleGenAI } from '@google/genai';

// On garde la config maxDuration pour Vercel (même si le stream aide à contourner le timeout initial)
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // 1. Récupération des données
    const { imageBase64, scannedElements } = await req.json();

    // 2. Init AI (Avec ta clé d'env)
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    // 3. Prompt Spécifique Wireframe
    const promptText = `
      Tu es un Architecte Frontend "Wireframe".
      Ton but : Générer un fichier HTML unique qui reconstruit EXACTEMENT la page fournie.

      RÈGLES CRITIQUES :
      - Renvoie UNIQUEMENT le code HTML brut. Pas de markdown, pas de \`\`\`html.
      - Utilise 'position: absolute' pour placer les éléments selon les coordonnées box_2d.
      - STYLE : Fond blanc, bordures noires 1px, pas d'ombrage, police monospace.
      - COORDONNÉES : Les 'box_2d' sont en [ymin, xmin, ymax, xmax] sur une échelle 0-1000. Convertis en % (top, left, width, height).
      
      DONNÉES SCANNÉES :
      ${JSON.stringify(scannedElements).substring(0, 20000)}
    `;

    // 4. Lancement du Stream avec le nouveau SDK
    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            { inlineData: { mimeType: 'image/png', data: imageBase64.split(',')[1] } },
          ],
        },
      ],
    });

    // 5. Création du ReadableStream "Raw" (Comme dans ton exemple qui marche)
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          // Itération directe sur la réponse (SDK @google/genai)
          for await (const chunk of response) {
            const chunkText = chunk.text();
            if (chunkText) {
              controller.enqueue(encoder.encode(chunkText));
            }
          }
          controller.close();
        } catch (err) {
          console.error("Stream pump error:", err);
          controller.error(err);
        }
      },
    });

    // 6. Retourne une Response native (Pas NextResponse)
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error: any) {
    console.error("Reconstruct Error:", error);
    // En cas d'erreur avant le stream, on renvoie un JSON classique
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
        }
