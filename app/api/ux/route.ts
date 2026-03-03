import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

type ImagePart   = { inlineData: { mimeType: string; data: string } };
type TextPart    = { text: string };
type Part        = TextPart | ImagePart;
type MsgContent  = { role: "user" | "model"; parts: Part[] };

function colorsToCSS(colorsRaw: string): string {
  try {
    const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
    const byZone: Record<string, { hex: string; frequency: number }[]> = {};
    for (const c of colors) {
      if (!byZone[c.zone]) byZone[c.zone] = [];
      byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
    }
    const mapping: Record<string, [string, string, string]> = {
      "sidebar-gauche":    ["--sidebar-bg", "--sidebar-text", "--sidebar-border"],
      "header-top":        ["--header-bg",  "--header-text",  "--header-border"],
      "coin-haut-gauche":  ["--brand-bg",   "--brand-text",   "--brand-border"],
      "contenu-principal": ["--main-bg",    "--main-text",    "--main-border"],
      "milieu-centre":     ["--card-bg",    "--card-text",    "--card-border"],
      "colonne-droite":    ["--panel-bg",   "--panel-text",   "--panel-border"],
      "bas-page":          ["--footer-bg",  "--footer-text",  "--footer-border"],
    };
    const lines: string[] = [];
    for (const [zone, cols] of Object.entries(byZone)) {
      const sorted = [...cols].sort((a, b) => b.frequency - a.frequency);
      const vars = mapping[zone];
      if (!vars) continue;
      if (sorted[0]) lines.push(`  ${vars[0]}: ${sorted[0].hex};`);
      if (sorted[1]) lines.push(`  ${vars[1]}: ${sorted[1].hex};`);
      if (sorted[2]) lines.push(`  ${vars[2]}: ${sorted[2].hex};`);
    }
    return `:root {\n${lines.join("\n")}\n}`;
  } catch { return ""; }
}

function parseJsFeatures(raw: string): { cdns: string[]; code: string } {
  const block = (raw.match(/```js-features\n?([\s\S]*?)```/) || [null, raw])[1]!;
  const cdnBlock = block.match(/\[CDNS\]([\s\S]*?)\[\/CDNS\]/);
  const cdns: string[] = [];
  if (cdnBlock) {
    cdnBlock[1].split("\n").forEach(l => {
      const t = l.replace(/^\/\/\s*/, "").trim();
      if (t.startsWith("http")) cdns.push(t);
    });
  }
  const code = block
    .replace(/\/\/ \[CDNS\][\s\S]*?\/\/ \[\/CDNS\]/, "")
    .replace(/\[CDNS\][\s\S]*?\[\/CDNS\]/, "")
    .trim();
  return { cdns, code };
}

function extractDomIds(jsCode: string): string[] {
  const ids = new Set<string>();
  [/querySelector\s*\(\s*['"`]#([\w-]+)['"`]\)/g, /getElementById\s*\(\s*['"`]([\w-]+)['"`]\)/g]
    .forEach(rx => { let m; while ((m = rx.exec(jsCode)) !== null) ids.add(m[1]); });
  return [...ids].filter(id => id.length > 2).slice(0, 25);
}

function injectJs(html: string, cdns: string[], code: string): string {
  let out = html;
  if (cdns.length) {
    const tags = cdns.map(u => `  <script src="${u}"></script>`).join("\n");
    out = out.includes("</head>")
      ? out.replace("</head>", `${tags}\n</head>`)
      : out.replace("<body", `${tags}\n<body`);
  }
  if (code) {
    const tag = `\n<script>\n${code}\n</script>`;
    out = out.includes("</body>")
      ? out.replace(/(<\/body>)(?![\s\S]*<\/body>)/, `${tag}\n$1`)
      : out + tag;
  }
  return out;
}

function extractHtmlBlock(text: string): string {
  const m = text.match(/```html\n?([\s\S]*?)```/);
  if (m) return m[1].trim();
  const t = text.trim();
  if (t.startsWith("<!") || t.startsWith("<html")) return t;
  return "";
}

function detectMode(msg: string | null): "clone" | "create" {
  if (!msg?.trim()) return "clone";
  const m = msg.toLowerCase();
  const c = ["clone","reproduis","reproduit","copie","pixel-perfect","identique","refais","recrée","exact","reproduce"].filter(k => m.includes(k)).length;
  const d = ["crée","créer","génère","fais","construis","build","create","make","generate","une app","un dashboard","une plateforme","un site","une boutique","landing","je veux","j'ai besoin","design","nouvelle","new","similaire","inspiré"].filter(k => m.includes(k)).length;
  return d > c || (d > 0 && c === 0) ? "create" : "clone";
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 1 — ULTRA-ANALYSE CSS PIXEL PAR PIXEL
// Appel non-streaming avec thinking HIGH. Résultat stocké serveur, jamais envoyé au client.
// ─────────────────────────────────────────────────────────────────────────────

const ANALYSIS_SYSTEM = `Tu es un expert en analyse visuelle d'interfaces utilisateur avec une précision de scanner.
Tu analyses des images d'interfaces et tu extrais ABSOLUMENT TOUS les styles CSS de chaque élément visible.
Ton analyse est exhaustive, méticuleuse, et ne laisse passer aucun détail.`;

async function performUltraAnalysis(
  imagePart: ImagePart,
  colorsCSS: string,
  mode: "clone" | "create"
): Promise<string> {
  const analysisPrompt = `Effectue une ULTRA-ANALYSE CSS exhaustive de cette interface.

Tu dois analyser ABSOLUMENT TOUS les éléments visibles, même les plus insignifiants.
Aucun élément ne doit être omis. Aucun style ne doit être deviné ou approximé.

${colorsCSS ? `COULEURS MESURÉES PAR ZONE (vérité absolue) :\n${colorsCSS}\n` : ""}

ANALYSE REQUISE POUR CHAQUE ÉLÉMENT VISIBLE :

Pour chaque composant (layout, header, sidebar, navbar, contenu, cards, boutons, inputs, 
textes, icônes, badges, tables, listes, formulaires, modals, tooltips, scrollbars, 
séparateurs, images, avatars, graphiques, etc.) extrait EXACTEMENT :

1. DIMENSIONS
   - width / height (en px, %, vw/vh — mesure visuellement)
   - min-width / max-width si pertinent
   - flex ou grid layout avec tous leurs paramètres

2. POSITIONNEMENT ET LAYOUT
   - position (relative, absolute, fixed, sticky)
   - display (flex, grid, block, inline-flex)
   - flex-direction, align-items, justify-content, gap, flex-wrap
   - grid-template-columns/rows si applicable

3. ESPACEMENT
   - padding (top right bottom left — valeurs précises)
   - margin (top right bottom left — valeurs précises)
   - gap entre les enfants

4. TYPOGRAPHIE
   - font-family (détecte la famille : sans-serif moderne? serif? monospace?)
   - font-size (mesure chaque niveau : nav, body, label, heading, caption)
   - font-weight (400, 500, 600, 700, 800)
   - line-height
   - letter-spacing
   - text-transform (uppercase, capitalize, none)
   - color (hex exact depuis les couleurs Canvas ou observable sur l'image)
   - text-overflow / white-space / overflow si applicable

5. COULEURS ET FOND
   - background-color (hex exact)
   - background (gradient si applicable)
   - color (hex exact du texte)
   - opacity si < 1

6. BORDURES
   - border (width style color — ex: 1px solid rgba(255,255,255,0.08))
   - border-radius (chaque composant individuellement — bouton: 4px? 6px? 9999px?)
   - border-top/bottom/left/right si seulement certains côtés
   - outline si applicable

7. OMBRES ET EFFETS
   - box-shadow (h-offset v-offset blur spread color)
   - text-shadow si applicable
   - filter (blur, brightness, backdrop-filter)
   - backdrop-filter si glassmorphism visible

8. ÉTATS INTERACTIFS (déduis de la logique visuelle)
   - :hover background / color / transform
   - .active / .selected état visible (background, border-left, color)
   - :focus outline

9. ANIMATIONS ET TRANSITIONS
   - transition (property duration easing)
   - transform visible (scale, rotate, translate)

FORMAT DE SORTIE — ultra-précis, par composant :

═══ LAYOUT GLOBAL ═══
display: flex; height: 100vh; overflow: hidden;

═══ SIDEBAR ═══
width: 220px; background: var(--sidebar-bg); [...]

═══ SIDEBAR — ITEM NAV ═══
padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; [...]
ÉTAT ACTIF: background: rgba(255,255,255,0.08); color: #ffffff;

═══ HEADER ═══
height: 52px; background: var(--header-bg); [...]

═══ BOUTON PRIMAIRE ═══
height: 30px; padding: 0 12px; border-radius: 5px; font-size: 12px; [...]

[Continue pour CHAQUE élément visible sans exception]

${mode === "create" 
  ? "\nPour le MODE CRÉATION : analyse l'ADN visuel complet (ambiance, typographie, style de finition) afin de recréer une interface différente mais avec le même ADN."
  : "\nPour le MODE CLONE : chaque mesure sera utilisée directement dans le code HTML/CSS."
}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [imagePart, { text: analysisPrompt }] }],
    config: {
      systemInstruction: ANALYSIS_SYSTEM,
      maxOutputTokens: 16384,
      temperature: 1, // requis avec thinkingConfig
      thinkingConfig: {
        thinkingLevel: "high",
      },
    },
  });

  // Extrait uniquement le texte de réponse (pas les thoughts)
  let analysis = "";
  const candidates = (response as any).candidates;
  if (candidates?.[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (!part.thought && part.text) analysis += part.text;
    }
  }
  if (!analysis && response.text) analysis = response.text;
  return analysis;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS — GÉNÉRATION HTML
// ─────────────────────────────────────────────────────────────────────────────

const RULES_COMMON = `
ICÔNES — Tabler Icons UNIQUEMENT :
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-NOM"></i>
JAMAIS d'emoji comme icône. JAMAIS d'autre librairie d'icônes.
Tabler : home search settings user users bell message chart-bar chart-line chart-pie
chevron-right chevron-left chevron-down chevron-up dots-vertical dots-horizontal
plus minus x check check-circle mail calendar clock file file-text folder edit
pencil trash eye lock shield filter refresh database cloud trending-up trending-down
alert-triangle info-circle brand-github brand-stripe brand-google layout-dashboard
layout-sidebar layout-grid list wallet credit-card package truck shopping-cart
receipt upload download tag external-link logout login user-circle star heart
arrow-left arrow-right sort-ascending sort-descending

IMAGES réelles :
Logos   : <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style="width:16px;height:16px">
Avatars : <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Alex&backgroundColor=b6e3f4" style="width:26px;height:26px;border-radius:50%">
Photos  : <img src="https://picsum.photos/seed/img1/400/300" style="width:100%;object-fit:cover">

CONTENU VIVANT :
✗ Bouton vide · Card sans données · Lorem ipsum · "User 1"
✓ Min 5 items par liste · Données réalistes · Statuts variés
`;

const SYSTEM_CLONE_GEN = `Tu es l'expert mondial de reproduction pixel-perfect d'interfaces en HTML/CSS.
Tu génères du HTML complet — jamais interrompu avant </html>.

Une ULTRA-ANALYSE CSS détaillée de l'image t'est fournie dans [ULTRA_ANALYSE].
Cette analyse contient TOUS les styles CSS mesurés pixel par pixel pour chaque élément.
Tu dois l'utiliser comme référence absolue pour chaque valeur CSS que tu écris.

PROCESSUS :

① Lis l'[ULTRA_ANALYSE] comme une spécification technique absolue.
   Chaque valeur dans l'analyse = valeur dans ton code. Pas d'interprétation. Pas d'approximation.

② Copie les variables CSS calculées dans :root {}.
   Ces couleurs sont des mesures pixel réelles — immuables.

③ Construis la structure HTML identique à l'image.
   Même ordre. Mêmes proportions. Mêmes composants.
   Textes copiés mot pour mot. Icônes Tabler équivalentes.

④ Applique CHAQUE style CSS extrait dans l'analyse.
   font-size: 12px → 12px dans ton code.
   border-radius: 6px → 6px dans ton code.
   padding: 5px 12px → 5px 12px dans ton code.
   Aucune valeur ne doit différer de l'analyse.

⑤ États et interactions :
   Items actifs dans nav → reproduits.
   Hover states → transition 0.12s ease.
   Scrollbar CSS si fond sombre.

INTERDICTIONS :
✗ Inventer des valeurs non présentes dans l'analyse
✗ Modifier les couleurs fournies
✗ Tailwind ou Bootstrap
✗ Standardiser le border-radius (chaque composant = valeur individuelle de l'analyse)
✗ Oublier un élément visible dans l'image

${RULES_COMMON}
RÉPONSE : un seul bloc \`\`\`html\`\`\`. Rien avant. Rien après.`;

const SYSTEM_CREATE_GEN = `Tu es un Designer UI/UX de génie et Ingénieur Frontend Senior.
Tu génères du HTML complet — jamais interrompu avant </html>.

Une ULTRA-ANALYSE CSS de l'image t'est fournie dans [ULTRA_ANALYSE].
Elle contient l'ADN visuel complet : couleurs, typographie, style de finition, ambiance.
Tu dois t'en inspirer totalement pour créer une interface NOUVELLE avec le même ADN.

PROCESSUS :

① Extrais l'ADN depuis [ULTRA_ANALYSE] :
   Ambiance (dark/light, sharp/arrondi, dense/aéré, glassmorphism/flat)
   Typographie (famille détectée → Google Fonts équivalent à charger)
   Style de finition (premium, minimal, playful)
   Palette de couleurs → variables CSS dans :root {}

② RÉINVENTE L'ARCHITECTURE COMPLÈTEMENT :
   ⚠️ Pas juste un changement de couleurs = ÉCHEC.
   
   Transformations obligatoires :
   Sidebar verticale      → Navbar pill flottante (position:fixed, backdrop-filter:blur)
   Tabs horizontaux       → Sidebar mini icônes + tooltip hover
   Header standard        → Header sticky avec scroll-shadow
   Grille cards uniformes → Bento grid asymétrique
   Tableau plat           → Cards expansibles avec détail inline
   Liste simple           → Timeline avec marqueurs
   Breadcrumb             → Stepper visuel avec états
   Garde la FONCTION, réinvente la FORME et la POSITION.

③ CRÉE avec le même niveau de finition que l'original :
   Google Fonts chargée. Données réalistes. Micro-animations CSS.
   Profondeur visuelle (ombres ou glassmorphism). Sparklines SVG si métriques.

${RULES_COMMON}
RÉPONSE : un seul bloc \`\`\`html\`\`\`. Rien avant. Rien après.`;

// ─────────────────────────────────────────────────────────────────────────────
// POST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const fd        = await req.formData();
    const message   = fd.get("message")   as string | null;
    const imageFile = fd.get("image")     as File   | null;
    const histRaw   = fd.get("history")   as string | null;
    const colorsRaw = fd.get("colors")    as string | null;
    const jsScripts = fd.get("jsScripts") as string | null;
    const modeRaw   = fd.get("mode")      as string | null;

    const history: { role: string; content: string }[] = JSON.parse(histRaw || "[]");
    const mode = (modeRaw === "clone" || modeRaw === "create") ? modeRaw : detectMode(message);

    // ── Parse JS ─────────────────────────────────────────────────────────────
    let jsCdns: string[] = [];
    let jsCode = "";
    let domIds: string[] = [];
    if (jsScripts?.trim()) {
      const parsed = parseJsFeatures(jsScripts);
      jsCdns = parsed.cdns;
      jsCode = parsed.code;
      domIds = extractDomIds(jsCode);
    }

    // ── Couleurs → CSS vars ───────────────────────────────────────────────────
    const colorsCSS = colorsRaw ? colorsToCSS(colorsRaw) : "";

    // ── Prépare l'image ───────────────────────────────────────────────────────
    let imagePart: ImagePart | null = null;
    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      imagePart = { inlineData: { mimeType: imageFile.type || "image/jpeg", data: Buffer.from(bytes).toString("base64") } };
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (s: string) => controller.enqueue(encoder.encode(s));

        try {
          // ══════════════════════════════════════════════════════════════════
          // ÉTAPE 1 — ULTRA-ANALYSE (serveur uniquement, invisible au client)
          // ══════════════════════════════════════════════════════════════════
          let ultraAnalysis = "";
          if (imagePart) {
            try {
              ultraAnalysis = await performUltraAnalysis(imagePart, colorsCSS, mode);
            } catch (analysisErr: any) {
              // Si l'analyse échoue, on continue quand même avec ce qu'on a
              ultraAnalysis = `[Analyse partielle — ${analysisErr.message}]`;
            }
          }

          // ══════════════════════════════════════════════════════════════════
          // ÉTAPE 2 — GÉNÉRATION HTML (streaming vers le client)
          // ══════════════════════════════════════════════════════════════════

          // Construit le prompt de génération
          let genPrompt = mode === "clone"
            ? `Reproduis cette interface en HTML/CSS pixel-perfect.${message?.trim() ? `\nInstructions : "${message.trim()}"` : ""}`
            : `CRÉATION — "${message?.trim() || "interface inspirée de l'image"}"\nRéinvente l'architecture complètement en gardant l'ADN visuel.`;

          if (colorsCSS) {
            genPrompt += `\n\n[COULEURS CANVAS — VÉRITÉ ABSOLUE]\n${colorsCSS}\nUtilise ces valeurs exactes dans :root {}.`;
          }

          if (ultraAnalysis) {
            genPrompt += `\n\n[ULTRA_ANALYSE — STYLES CSS MESURÉS PIXEL PAR PIXEL]\n${ultraAnalysis}\n[/ULTRA_ANALYSE]\n\nUtilise cette analyse comme spécification technique absolue pour chaque valeur CSS.`;
          }

          if (jsCode) {
            // Passe le JS complet (tronqué si trop long) pour que l'agent UX
            // comprenne TOUTES les fonctionnalités à accueillir visuellement,
            // pas seulement les IDs DOM.
            const jsPreview = jsCode.length > 6000
              ? jsCode.slice(0, 5800) + "\n// [...tronqué — voir suite dans le merger]"
              : jsCode;

            genPrompt += `\n\n[CONTEXTE JAVASCRIPT — FONCTIONNALITÉS À ACCUEILLIR]
Le JavaScript suivant a été généré pour cette demande.
Ton HTML doit créer des zones UI cohérentes pour CHAQUE fonctionnalité décrite.
IDs DOM impératifs : ${domIds.length > 0 ? domIds.join(", ") : "voir querySelector dans le code"}

\`\`\`js
${jsPreview}
\`\`\`

Règles :
- Crée TOUS les conteneurs DOM référencés dans ce JS (IDs, data-attributes, types d'éléments).
- Pour chaque feature (chart, éditeur, player, modal, sidebar, etc.) crée une zone UI dédiée.
- Ne laisse aucun querySelector orphelin : son conteneur doit exister dans le HTML.
- Adapte les dimensions de chaque conteneur à ce que le JS y affichera.
[/CONTEXTE JAVASCRIPT]`;
          }

          const genParts: Part[] = [];
          if (imagePart) genParts.push(imagePart); // L'image reste aussi en contexte direct
          genParts.push({ text: genPrompt });

          const gemHist: MsgContent[] = history.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          }));

          const genResponse = await ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: [...gemHist, { role: "user", parts: genParts }],
            config: {
              systemInstruction: mode === "clone" ? SYSTEM_CLONE_GEN : SYSTEM_CREATE_GEN,
              maxOutputTokens: 65536,
              temperature: 1, // requis avec thinkingConfig
              thinkingConfig: {
                thinkingLevel: "high",
              },
            },
          });

          let fullOutput = "";
          for await (const chunk of genResponse) {
            // Stream uniquement les parts non-thought
            const candidates = (chunk as any).candidates;
            if (candidates?.[0]?.content?.parts) {
              for (const part of candidates[0].content.parts) {
                if (!part.thought && part.text) {
                  fullOutput += part.text;
                  emit(part.text);
                }
              }
            } else if (chunk.text) {
              fullOutput += chunk.text;
              emit(chunk.text);
            }
          }

          // NOTE : L'injection JS est désormais gérée par l'agent Merger (/api/merger)
          // qui connecte intelligemment HTML et JS. On ne fait plus d'injection mécanique ici.

        } catch (err: any) {
          emit(`\n[Erreur UX: ${err.message}]\n`);
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
