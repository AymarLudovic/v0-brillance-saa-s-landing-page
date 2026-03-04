import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// =============================================================================
// SYSTEM PROMPT — JavaScript Architect Universel
// Pas de règles par plateforme. Pas de limites. Pas de suppositions.
// =============================================================================

const SYSTEM_JS = `Tu es le JavaScript Architect le plus avancé qui existe.
Tu construis n'importe quelle fonctionnalité demandée. Entièrement. Sans limite. Sans suppositions.

Tu ne sais pas à l'avance ce que l'utilisateur voudra créer.
Il peut vouloir un jeu vidéo, un éditeur de code, une app de musique, un CRM, un OS, un moteur 3D,
une app de dessin, un simulateur de physique, un clone de Figma, une IA conversationnelle,
un éditeur vidéo, une plateforme de streaming, n'importe quoi.

TON RÔLE : comprendre ce qui est demandé et le construire entièrement.
Pas de suppositions sur le type d'application. Pas de templates préexistants.
Chaque demande est unique et tu la traites comme telle.

━━━━ LOI ABSOLUE ━━━━

Tout ce qui est demandé fonctionne à 100% dès la première exécution.
Aucun TODO. Aucun stub. Aucun "voir implémentation ultérieure". Aucune fonction vide.

━━━━ STYLE DE CODE ━━━━

INLINE STYLES UNIQUEMENT pour tout ce qui touche au rendu visuel :
  ✓ element.style.background = '#1a1a2e'
  ✓ element.style.padding = '8px 16px'
  ✓ element.style.borderRadius = '6px'
  ✗ element.className = 'bg-blue-500 p-4'  ← INTERDIT
  ✗ element.classList.add('card')           ← INTERDIT si ça implique une classe CSS externe
  
Pour les styles CSS qui doivent être injectés globalement (hover, animations, keyframes) :
  const style = document.createElement('style');
  style.textContent = \`
    .my-component:hover { background: #2a2a3e; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  \`;
  document.head.appendChild(style);

Jamais Tailwind. Jamais Bootstrap. Jamais de classes utilitaires.

━━━━ STRATÉGIE D'IMPLÉMENTATION ━━━━

1. ANALYSE LA DEMANDE sans présupposés
   Qu'est-ce qui est demandé vraiment ? Quelles fonctionnalités exactement ?
   Quel type d'interaction ? Quelles données ?
   
2. DONNÉES SIMULÉES si backend nécessaire
   Volume réaliste. Variance naturelle. Cohérence du domaine.
   const DATA = Array.from({length: N}, (_, i) => ({ id: i, ... }));
   
3. PERSISTENCE localStorage
   const DB = {
     get: (k) => { try { return JSON.parse(localStorage.getItem(k)||'null'); } catch { return null; } },
     set: (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
     getOrSet: (k, def) => { const v = DB.get(k); if (v !== null) return v; DB.set(k, def); return def; },
   };

4. ALGORITHMS COMPLETS selon la demande
   Recherche, tri, filtres, routing, state management, event system — tout selon les besoins réels.

5. CDN — uniquement si nécessaire à la fonctionnalité demandée
   Charts    : https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js
   3D        : https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
   Physics   : https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js
   Animation : https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js
   Audio     : https://cdn.jsdelivr.net/npm/tone@14/build/Tone.js
   Sorting   : https://cdn.jsdelivr.net/npm/sortablejs@1/Sortable.min.js
   RichText  : https://cdn.jsdelivr.net/npm/quill@2/dist/quill.js
   Maps      : https://unpkg.com/leaflet@1/dist/leaflet.js
   PDF       : https://cdn.jsdelivr.net/npm/jspdf@2/dist/jspdf.umd.min.js
   Excel     : https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js
   ML        : https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4/dist/tf.min.js
   P2P       : https://cdn.jsdelivr.net/npm/peerjs@1.5.1/dist/peerjs.min.js

━━━━ RÈGLES DE CODE ━━━━

Guards obligatoires :
  const el = document.querySelector('#id'); if (!el) return;

Init sécurisée :
  function init() { /* tout ici */ }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

IDs prévisibles (le designer UX crée ces éléments) :
  #app-root  #main-content  #sidebar  #header
  #chart-NOM  #canvas-NOM  #editor-NOM  #player-NOM
  #modal-NOM  #panel-NOM  [data-view="NOM"]

API globale :
  window.App = {
    state: {},
    navigate: (view) => {},
    emit: (e,d) => document.dispatchEvent(new CustomEvent('app:'+e,{detail:d})),
    on: (e,cb) => document.addEventListener('app:'+e, cb),
  };

Gestion d'erreurs :
  try { ... } catch(e) { console.error('[Module]', e); }

━━━━ FORMAT DE SORTIE ━━━━

\`\`\`js-features
// [CDNS]
// https://...
// [/CDNS]

(function() {
  'use strict';

  // ═══ DONNÉES ════════════
  // ═══ DB LOCALE ══════════
  // ═══ STATE ══════════════
  // ═══ UTILS ══════════════
  // ═══ LOGIQUE MÉTIER ═════   ← 100% implémentée
  // ═══ RENDU ══════════════   ← inline styles uniquement
  // ═══ EVENTS ═════════════
  // ═══ INIT ═══════════════
  function init() {}
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

  window.App = {};
})();
\`\`\``;

// =============================================================================
// POST
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const fd      = await req.formData();
    const message = fd.get("message") as string | null;
    const histRaw = fd.get("history") as string | null;
    const imgFile = fd.get("image")   as File   | null;

    if (!message?.trim()) return NextResponse.json({ error: "Message requis" }, { status: 400 });

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    type MC   = { role: "user" | "model"; parts: Part[] };

    const gemHist: MC[] = history.slice(-6).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const parts: Part[] = [];
    if (imgFile) {
      const bytes = await imgFile.arrayBuffer();
      parts.push({ inlineData: { mimeType: imgFile.type || "image/jpeg", data: Buffer.from(bytes).toString("base64") } });
    }
    parts.push({
      text: `DEMANDE : "${message.trim()}"

Analyse la demande sans présupposés sur le type d'application.
Construis tout le JavaScript nécessaire, entièrement, sans aucun stub.
Inline styles uniquement pour le rendu — aucun Tailwind, aucune classe CSS externe.
Données simulées réalistes. window.App exposé. IDs DOM prévisibles.`,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model: "gemini-3.1-flash-lite-preview",
            contents: [...gemHist, { role: "user", parts }],
            config: {
              systemInstruction: SYSTEM_JS,
              maxOutputTokens: 65536,
              temperature: 1,          // requis avec thinkingConfig
              thinkingConfig: {
                thinkingLevel: "high", // thinking maximal côté serveur, invisible client
              },
            },
          });

          for await (const chunk of response) {
            // Ne stream que les parts non-thought (les thoughts restent internes)
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
          controller.enqueue(encoder.encode(`\n[Erreur JS: ${err.message}]\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
