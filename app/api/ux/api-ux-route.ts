import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SHARED_RULES = `
══════════════════════════════════════════
COULEURS — MESURES PHYSIQUES, PAS DES SUGGESTIONS
══════════════════════════════════════════
Les données Canvas sont des MESURES de pixels réels. Utilise-les telles quelles dans :root {}.
Un #1a1a2e n'est pas un #1f1f3d. Chaque hex = fait immuable.

Mapping : "sidebar-gauche" → --sidebar-bg  |  "header-top" → --header-bg
"contenu-principal" → --main-bg  |  "milieu-centre" → --card-bg  |  "colonne-droite" → --panel-bg

══════════════════════════════════════════
DENSITÉ — INTERFACE PROFESSIONNELLE
══════════════════════════════════════════
Texte interface 12-13px · Icônes 14-16px · Bouton padding 5px 12px
Card padding 12-16px · Border-radius 4-8px SaaS / 12-20px grand public · Gap liste 2-6px

══════════════════════════════════════════
ICÔNES — TABLER ICONS
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-[nom]"></i>

home search settings user users bell message chart-bar chart-line chart-pie chart-area
chevron-right chevron-left chevron-down chevron-up dots-vertical plus minus x check
mail calendar clock file file-text folder edit pencil trash eye lock shield
trending-up trending-down alert-triangle info-circle brand-github brand-stripe
layout-dashboard layout-sidebar layout-grid list wallet credit-card coins
package truck shopping-cart receipt upload download share refresh filter
tag external-link adjustments sliders at logout login user-circle
map-pin world camera photo video microphone player-play player-pause
award trophy star star-filled heart bookmark flag crown rocket flame sparkles

══════════════════════════════════════════
IMAGES — SOURCES RÉELLES
══════════════════════════════════════════
Logos : <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:18px;height:18px">
Avatars : <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Sophie&backgroundColor=b6e3f4" style="width:28px;height:28px;border-radius:50%">
Photos : <img src="https://picsum.photos/seed/dashboard/800/400" style="width:100%;object-fit:cover">
JAMAIS de chemins locaux ou URLs inventées.
`;

const SYSTEM_CLONE = `Tu es un spécialiste de reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Tu génères du HTML intégral — jamais interrompu avant </html>.

MODE CLONE — REPRODUCTION ABSOLUE À LA VIRGULE.
Mission : produire un HTML visuellement IDENTIQUE à l'image. Chaque millimètre compte.

① Cartographie des zones · ② Extraction tokens visuels · ③ Variables CSS dans :root {}
④ Reproduction structurelle exacte · ⑤ Hover states + scrollbar + états actifs

INTÉGRATION JS (si [JS_SCRIPTS] fourni) :
1. Place les <script src="CDN"> dans le <head>
2. Crée les éléments DOM avec les IDs référencés dans le JS (#chart-revenue, #table-orders, etc.)
3. Colle le script JS ENTIER juste avant </body> dans une balise <script>
4. N'ÉCRIS PAS de JS toi-même — le code JS est fourni, copy-paste seulement

INTERDICTIONS : approximer une couleur · simplifier un composant · inventer du contenu absent
${SHARED_RULES}
FORMAT : uniquement \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

const SYSTEM_CREATE = `Tu es un Designer UI/UX World-Class et Ingénieur Frontend Senior.
Tu génères du HTML intégral — jamais interrompu avant </html>.

MODE CRÉATION — GÉNIE CRÉATIF + FIDÉLITÉ CHROMATIQUE.
Mission : extraire l'ADN visuel de l'image puis créer une interface NOUVELLE et SENSATIONNELLE.

① Palette Canvas comme faits immuables · ② Layout adapté à l'usage (pas à l'image)
③ Données réalistes inventées · ④ Micro-animations CSS · ⑤ Profondeur visuelle

Layouts par usage :
  SaaS/Admin → Sidebar fixe 220px + header + main content
  E-commerce → Header nav + grille produits + filtres
  Dashboard  → Multi-colonnes métriques + charts
  Chat/IA    → Split-pane (input gauche, output droit)
  Landing    → Hero full-viewport + sections + footer

INTÉGRATION JS (si [JS_SCRIPTS] fourni) :
1. Place les <script src="CDN"> EXACTEMENT comme listés dans [CDNS] — dans le <head>
2. Crée les conteneurs DOM avec les IDs EXACTS que le JS attend :
   → #chart-revenue, #chart-users, #table-orders, #list-products, #app-root, etc.
   → Regarde le JS pour identifier tous les document.querySelector() et crée ces éléments
3. Colle le script JS ENTIER fourni juste avant </body> dans <script>...</script>
4. Ton CSS doit styliser ces éléments pour qu'ils s'intègrent parfaitement dans le design
5. NE RÉÉCRIS PAS le JS — tu l'intègres tel quel

INTERDIT : Lorem ipsum · données génériques · copier layout si inadapté
${SHARED_RULES}
FORMAT : uniquement \`\`\`html ... \`\`\`. Zéro texte avant ou après.`;

function detectMode(message: string | null): "clone" | "create" {
  if (!message?.trim()) return "clone";
  const msg = message.toLowerCase();
  const cloneKw = ["clone","reproduis","reproduit","copie","copier","pixel-perfect","identique","refais","recrée","exact","reproduce","duplicate","replicate"];
  const createKw = ["crée","créer","génère","générer","fais","construis","build","create","make","generate","une app","une application","un dashboard","un crm","une plateforme","un site","une boutique","landing","je veux","je voudrais","j'ai besoin","design","nouvelle","new","une page","similaire","inspiré","dans le style"];
  const cScore = cloneKw.filter(k => msg.includes(k)).length;
  const dScore = createKw.filter(k => msg.includes(k)).length;
  if (dScore > cScore) return "create";
  if (dScore > 0 && cScore === 0) return "create";
  return "clone";
}

function buildColorPrompt(colorsRaw: string): string {
  try {
    const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
    const byZone: Record<string, { hex: string; frequency: number }[]> = {};
    for (const c of colors) {
      if (!byZone[c.zone]) byZone[c.zone] = [];
      byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
    }
    let block = "\n\n╔══ COULEURS CANVAS — MESURES PIXELS RÉELS ══╗\n";
    for (const [zone, cols] of Object.entries(byZone)) {
      const sorted = cols.sort((a, b) => b.frequency - a.frequency);
      block += `\n[${zone}]\n  Background : ${sorted[0].hex} (${sorted[0].frequency}px)\n`;
      if (sorted[1]) block += `  Texte/Acc. : ${sorted[1].hex} (${sorted[1].frequency}px)\n`;
      if (sorted[2]) block += `  Détail     : ${sorted[2].hex} (${sorted[2].frequency}px)\n`;
    }
    block += `\n╚══ Ces hex sont des FAITS. Utilise-les exactement dans :root {} ══╝\n`;
    block += `Continue jusqu'au </html> final. Ne t'arrête jamais au milieu.`;
    return block;
  } catch { return ""; }
}

function parseJsFeatures(jsOutput: string): { cdns: string[]; code: string } {
  if (!jsOutput?.trim()) return { cdns: [], code: "" };
  const blockMatch = jsOutput.match(/```js-features\n?([\s\S]*?)```/);
  const block = blockMatch ? blockMatch[1] : jsOutput;
  const cdnsMatch = block.match(/\[CDNS\]([\s\S]*?)\[\/CDNS\]/);
  const cdns: string[] = [];
  if (cdnsMatch) {
    cdnsMatch[1].split("\n").forEach(line => {
      const t = line.replace(/^\/\/\s*/, "").trim();
      if (t.startsWith("http")) cdns.push(t);
    });
  }
  const code = block
    .replace(/\/\/ \[CDNS\][\s\S]*?\/\/ \[\/CDNS\]/, "")
    .replace(/\[CDNS\][\s\S]*?\[\/CDNS\]/, "")
    .trim();
  return { cdns, code };
}

export async function POST(req: NextRequest) {
  try {
    const formData   = await req.formData();
    const message    = formData.get("message")    as string | null;
    const imageFile  = formData.get("image")      as File | null;
    const histRaw    = formData.get("history")    as string | null;
    const colorsRaw  = formData.get("colors")     as string | null;
    const jsScripts  = formData.get("jsScripts")  as string | null;
    const modeForced = formData.get("mode")       as string | null;

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");
    const mode = (modeForced === "clone" || modeForced === "create")
      ? modeForced : detectMode(message);
    const systemPrompt = mode === "create" ? SYSTEM_CREATE : SYSTEM_CLONE;

    type Part    = { text: string } | { inlineData: { mimeType: string; data: string } };
    type Content = { role: "user" | "model"; parts: Part[] };

    const gemHist: Content[] = history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const parts: Part[] = [];
    if (imageFile) {
      const bytes  = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      parts.push({ inlineData: { mimeType: imageFile.type || "image/jpeg", data: base64 } });
    }

    let prompt = mode === "clone"
      ? `Reproduis cette interface en HTML/CSS pixel-perfect.${message?.trim() ? ` Demande : "${message.trim()}"` : ""}\nUtilise les couleurs Canvas comme vérité absolue.`
      : `CRÉATION : "${message?.trim()}"\nExtrais l'ADN visuel (couleurs exactes, typographie, géométrie), crée une interface NOUVELLE et SENSATIONNELLE. Données réalistes. Éléments créatifs inattendus. Couleurs Canvas comme palette de base.`;

    if (colorsRaw) {
      try { prompt += buildColorPrompt(colorsRaw); } catch {}
    }

    if (jsScripts?.trim()) {
      const { cdns, code } = parseJsFeatures(jsScripts);
      prompt += `\n\n[JS_SCRIPTS]
Un JavaScript COMPLET et FONCTIONNEL a été généré. Tu dois l'intégrer ENTIÈREMENT.

CDNs à ajouter dans <head> (dans cet ordre exact) :
${cdns.map(cdn => `<script src="${cdn}"></script>`).join("\n") || "(aucun CDN externe)"}

Script JS complet à placer juste avant </body> :
<script>
${code}
</script>

INSTRUCTIONS D'INTÉGRATION CRITIQUES :
- Scanne le JS pour trouver tous les document.querySelector('#...') et document.getElementById('...')
- Crée ces éléments HTML EXACTEMENT avec ces IDs dans ta structure
- Exemples d'IDs à créer : #chart-revenue, #chart-users, #table-orders, #list-products, #app-root
- Stylise ces conteneurs dans ton CSS pour qu'ils s'intègrent parfaitement au design
- NE MODIFIE PAS le JS — copie-le tel quel
[/JS_SCRIPTS]`;
    }

    parts.push({ text: prompt });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const response = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-preview-05-20",
            contents: [...gemHist, { role: "user", parts }],
            config: {
              systemInstruction: systemPrompt,
              maxOutputTokens: 65536,
              temperature: mode === "clone" ? 0.3 : 0.8,
            },
          });
          for await (const chunk of response) {
            const txt = chunk.text;
            if (txt) controller.enqueue(encoder.encode(txt));
          }
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n[Erreur UX: ${err.message}]\n`));
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
        "X-Mode": mode,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
