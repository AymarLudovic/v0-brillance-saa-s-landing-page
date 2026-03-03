import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// =============================================================================
// SYSTEM PROMPT — Merger / Integration Architect
// Reçoit le HTML de l'agent UX + le JS de l'agent JS.
// Produit un fichier HTML complet, unifié, 100% fonctionnel.
// NE DOWNGRADE PAS le travail des deux agents — il sert d'assembleur intelligent.
// =============================================================================

const SYSTEM_MERGER = `Tu es le Senior Full-Stack Integration Architect.
Tu reçois deux artefacts produits indépendamment :
  [HTML] — interface générée par l'agent UX Designer (HTML/CSS pur, aucun JS)
  [JS]   — logique générée par l'agent JS Architect (JavaScript complet, aucun HTML)

TON UNIQUE MISSION : fusionner ces deux artefacts en un seul fichier HTML parfaitement fonctionnel.

━━━━ PRINCIPES ABSOLUS ━━━━

① NE DOWNGRADE JAMAIS le code existant.
  - Conserve CHAQUE ligne de CSS, CHAQUE règle visuelle de [HTML].
  - Conserve CHAQUE fonction, CHAQUE logique de [JS].
  - Tu ne réécris pas — tu CONNECTES et COMPLÈTES.

② ANALYSE LES DÉSYNCHRONISATIONS DOM.
  Pour chaque querySelector / getElementById du JS :
  - L'ID existe-t-il dans le HTML ? → Si non, crée le conteneur manquant au bon endroit.
  - Le conteneur a-t-il les bonnes dimensions / position pour accueillir le rendu JS ?
  - Le type de conteneur est-il approprié (canvas, div, table, ul...) ?

③ ANALYSE LES FONCTIONNALITÉS ORPHELINES.
  Pour chaque feature JS (chart, editor, player, modal, form...) :
  - Y a-t-il une zone UI dans le HTML qui l'accueille visuellement ?
  - Si non, insère cette zone avec des styles cohérents avec le reste du design.
  - Intègre-la à l'endroit le plus logique dans la hiérarchie UI existante.

④ RÉSOUS LES CONFLITS DE NOMMAGE.
  Si le JS cible #sidebar-nav mais que le HTML a #nav-sidebar :
  - Choisis le nom du JS (car le JS est plus précis dans ses références).
  - Met à jour le HTML pour correspondre au JS — JAMAIS l'inverse.

⑤ ORDRE DE CHARGEMENT CORRECT.
  Structure finale du <head> :
  1. <meta charset> et <meta viewport>
  2. Google Fonts si utilisées
  3. Tabler Icons CSS
  4. Toutes les <link> CSS
  5. CDN scripts du JS (chart.js, three.js, etc.) avec defer si possible
  Avant </body> :
  1. window.App = {} et tout code global
  2. Le script JS complet dans un seul <script>

⑥ GESTION DES EVENTS ET INIT.
  Assure-toi que :
  - L'init JS s'exécute après le DOM (DOMContentLoaded ou readyState check)
  - Les event listeners JS ciblent des éléments qui existent dans le HTML final
  - Les data-attributes requis par le JS sont présents sur les bons éléments HTML

━━━━ CE QUE TU NE FAIS PAS ━━━━

✗ Réécrire le CSS de zéro
✗ Changer l'ambiance visuelle ou la palette de couleurs
✗ Simplifier la logique JS
✗ Ajouter Tailwind ou Bootstrap
✗ Laisser des TODO ou stubs
✗ Tronquer le HTML avant </html>

━━━━ FORMAT DE SORTIE ━━━━

Un seul bloc \`\`\`html\`\`\` contenant le fichier HTML complet et intégré.
Rien avant. Rien après.`;

// =============================================================================
// POST
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const fd      = await req.formData();
    const message = fd.get("message")  as string | null;
    const htmlCode = fd.get("htmlCode") as string | null;
    const jsCode   = fd.get("jsCode")   as string | null;
    const histRaw  = fd.get("history")  as string | null;

    if (!htmlCode?.trim() || !jsCode?.trim()) {
      return NextResponse.json({ error: "htmlCode et jsCode requis" }, { status: 400 });
    }

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");

    type Part = { text: string };
    type MC   = { role: "user" | "model"; parts: Part[] };

    const gemHist: MC[] = history.slice(-4).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const mergerPrompt = `DEMANDE ORIGINALE DE L'UTILISATEUR : "${message?.trim() || "interface complète"}"

━━━━ [HTML] — INTERFACE GÉNÉRÉE PAR L'AGENT UX ━━━━
${htmlCode.trim()}
━━━━ [/HTML] ━━━━

━━━━ [JS] — LOGIQUE GÉNÉRÉE PAR L'AGENT JS ━━━━
${jsCode.trim()}
━━━━ [/JS] ━━━━

TÂCHE :
1. Analyse les désynchronisations DOM entre [JS] et [HTML].
2. Identifie toutes les features JS qui n'ont pas de zone UI dans [HTML] et vice-versa.
3. Produis le fichier HTML final unifié, complet, 100% fonctionnel.
   Conserve intégralement le CSS de [HTML] et la logique de [JS].
   Ajoute uniquement ce qui manque pour connecter les deux.`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [...gemHist, { role: "user", parts: [{ text: mergerPrompt }] }],
            config: {
              systemInstruction: SYSTEM_MERGER,
              maxOutputTokens: 65536,
              temperature: 1,
              thinkingConfig: {
                thinkingLevel: "high",
              },
            },
          });

          for await (const chunk of response) {
            const candidates = (chunk as any).candidates;
            if (candidates?.[0]?.content?.parts) {
              for (const part of candidates[0].content.parts) {
                if (!part.thought && part.text) {
                  controller.enqueue(encoder.encode(part.text));
                }
              }
            } else if (chunk.text) {
              controller.enqueue(encoder.encode(chunk.text));
            }
          }
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n[Erreur Merger: ${err.message}]\n`));
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
