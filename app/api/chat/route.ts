// app/api/chat/route.ts
// Vercel AI Gateway avec OIDC — pas besoin de clé API côté utilisateur
// En prod sur Vercel : VERCEL_OIDC_TOKEN est auto-disponible
// En local : lance `vercel env pull` pour récupérer le token

import { streamText } from "ai";

export const maxDuration = 250; // Fluid compute sur Vercel

export async function POST(req: Request) {
  const { messages, model = "anthropic/claude-opus-4-6" } = await req.json();

  // AI SDK utilise automatiquement VERCEL_OIDC_TOKEN en prod
  // ou AI_GATEWAY_API_KEY si défini (fallback local)
  const result = streamText({
    model, // format "provider/model-name" → routing auto via AI Gateway
    system:
      "Tu es un assistant intelligent. Réponds de manière claire et concise.",
    messages,
  });

  return result.toDataStreamResponse();
}
