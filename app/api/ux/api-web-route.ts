import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SYSTEM_WEB = `Tu es un assistant de recherche web expert et transparent.
Tu utilises Google Search pour répondre aux questions avec des informations réelles et actualisées.

COMPORTEMENT :
- Utilise Google Search pour toute question nécessitant des informations récentes ou factuelles
- Cite tes sources avec précision
- Synthétise les résultats de manière claire et structurée
- Sois honnête sur ce que tu trouves et ne trouves pas
- Pour les questions techniques, inclus des exemples de code si pertinent
- Pour les questions de design/UI, décris les tendances actuelles avec des exemples réels

STYLE DE RÉPONSE :
- Réponse directe et actionnable
- Sources citées inline quand tu utilises une information précise
- Structure claire : contexte → réponse principale → détails → sources
`;

export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const message   = formData.get("message")  as string | null;
    const histRaw   = formData.get("history")  as string | null;
    const imageFile = formData.get("image")    as File | null;

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message requis" }, { status: 400 });
    }

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");

    type Part    = { text: string } | { inlineData: { mimeType: string; data: string } };
    type Content = { role: "user" | "model"; parts: Part[] };

    const gemHist: Content[] = history.slice(-8).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const parts: Part[] = [];
    if (imageFile) {
      const bytes  = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }
    parts.push({ text: message.trim() });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (data: string) => controller.enqueue(encoder.encode(data));

        try {
          // ── Call Gemini avec Google Search grounding ──────────────────────
          const response = await ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [...gemHist, { role: "user", parts }],
            config: {
              systemInstruction: SYSTEM_WEB,
              maxOutputTokens: 8192,
              temperature: 1.0, // recommandé par la doc pour le grounding
              tools: [{ googleSearch: {} }] as any,
            },
          });

          let groundingMeta: any = null;

          // Stream du texte en temps réel
          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) emit(txt);

            // Récupère le groundingMetadata sur n'importe quel chunk (arrive souvent sur le dernier)
            const meta = (chunk as any).candidates?.[0]?.groundingMetadata;
            if (meta) groundingMeta = meta;
          }

          // ── Émet les métadonnées de recherche à la fin ────────────────────
          // Le client parsera ce bloc pour afficher les sources et requêtes
          if (groundingMeta) {
            const searchData = {
              queries:     groundingMeta.webSearchQueries || groundingMeta.searchQueries || [],
              chunks:      (groundingMeta.groundingChunks || []).map((c: any) => ({
                title: c.web?.title || c.retrievedContext?.title || "",
                uri:   c.web?.uri   || c.retrievedContext?.uri   || "",
              })).filter((c: any) => c.uri),
              supports:    (groundingMeta.groundingSupports || []).map((s: any) => ({
                text:    s.segment?.text || "",
                indices: s.groundingChunkIndices || [],
              })),
            };
            emit(`\n[SEARCH_META]${JSON.stringify(searchData)}[/SEARCH_META]`);
          }

        } catch (err: any) {
          emit(`\n[Erreur recherche: ${err.message}]\n`);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      },
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
