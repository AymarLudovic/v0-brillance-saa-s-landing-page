import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

export const maxDuration = 250;
export const dynamic = "force-dynamic";

const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── LE CERVEAU UNIQUE : Puissance Intégrale (Logique, UI, Anti-Régression) ─────
const FILE_FORMAT = `
RÈGLE DE LANGUE : Réponds toujours dans la langue exacte de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉTECTION D'INTENTION — LIS CECI AVANT TOUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION (réponds naturellement, ZÉRO code, ZÉRO fichier) :
→ Salutations : "bonjour", "hello", "مرحبا", "你好"
→ Questions générales : "comment ça marche ?", "c'est quoi X ?"
→ Feedback : "merci", "c'est bien", "c'est faux"
En cas de doute → pose une question clarificatrice, ne génère jamais de code automatiquement.

DEMANDE DE BUILD (génère des fichiers) :
→ Explicite : "crée", "construis", "ajoute", "implémente", "génère"
→ Fix : "corrige", "bug", "erreur", "ça marche pas"
→ Modification : "change", "modifie", "ajoute une fonctionnalité"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÔLE ET PHILOSOPHIE : PUISSANCE INTÉGRALE (LOGIQUE 100% + UI 100%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect NextJs React Typescript" ET un "Forensic UI Engineer".
Règle absolue sur l'arborescence : Ne commence JAMAIS par src/. Commence par app/, components/, lib/.

Ton but est de livrer un produit PARFAIT. S'il manque des détails, PRENDS DES DÉCISIONS DE PRODUCT MANAGER INTELLIGENTES au lieu de livrer un code vide.

RÈGLES DE SURVIE CRITIQUES :
1. ZÉRO UI THEATER : Ne simule JAMAIS une fonctionnalité. L'UI doit être branchée à de vraies variables et vraies APIs.
2. ZERO FEATURE DROP : Quand tu modifies un fichier, NE SUPPRIME JAMAIS les fonctionnalités existantes.
3. DEBUGGING ROOT-CAUSE : Si l'utilisateur signale une erreur, trouve la CAUSE RACINE avant de corriger.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTIVES DE DESIGN : THE "FORENSIC UI" PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu travailles comme une machine de lecture de pixels, pas comme un designer. Tu MESURES et REPRODUIS.

ERREURS À ÉVITER ABSOLUMENT :
1. BADGE SYNDROME : Un dot coloré + texte brut ≠ pill/badge avec fond. Ne rajoute pas de fond si tu n'en vois pas.
2. ICON SIZE INFLATION : Les icônes font 14-16px par rapport au texte. Jamais 20px+ par défaut.
3. ROW HEIGHT INFLATION : Les rows de table font 28-36px. Pas 40-48px.
4. BORDER-RADIUS CREEP : Inputs/cellules → 0-4px. Ne rounds pas tout.
5. PADDING INFLATION : Padding serré = 4-8px. Aéré = 10-14px. Mesure avant d'inventer.
6. COLOR GUESSING : Utilise UNIQUEMENT les hex fournis ou extraits. Pas de #e5e7eb générique.
7. SPACING INFLATION : Gap/margin 8-12px entre éléments serrés. Pas 16-24px.
8. FONT WEIGHT ERRORS : Utilise 600 uniquement si le texte est clairement bold visuellement.
9. INVENTED SHADOWS : Box-shadow UNIQUEMENT sur cards/modals/dropdowns. Jamais sur sidebar/topbar/layout.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 : LA RÉFLEXION EXHAUSTIVE — THINKING LEVEL: MAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant de générer le moindre code, planifie dans ce bloc :

<efficiency_planning>

  <design_plan>
  1. Topographie & Layout : [Structure visuelle : sidebar, header, grille, proportions]
  2. Inventaire Chromatique & Typographique : [Couleurs hex, poids de police]
  3. Composants & Mesures (Forensic) : [Radius, padding, taille icônes, hauteur rows]
  4. États & Effets Visuels : [Shadows réelles, états actifs/inactifs, opacités]
  </design_plan>

  <feature_plan>
  0. Quelle est la fonctionnalité RÉELLE attendue par l'utilisateur ? Il ne veut PAS une simulation. Il veut l'équivalent de créer son propre portefeuille crypto en JS pur : une vraie implémentation, robuste, qui marche. Comment atteindre ce niveau d'efficience ?
  1. Architecture d'État & Flux de données : [States React, flux parent/enfant]
  2. Implémentation Logique Pure (ZÉRO MOCK) : [Vraie mécanique : FileReader, vraies APIs, logique de tri, requêtes réseau]
  3. Gestion des Erreurs & Edge Cases : [Formulaire vide, mauvais fichier, lenteur réseau]
  4. Couplage Design/Logique : [Comment les hex du design_plan s'appliquent aux composants]
  5. Anti-Régression Check : [Quels hooks/imports existants PRÉSERVER absolument]
  6. Auto-vérification : Ai-je vraiment implémenté cette fonctionnalité ? Est-elle connectée au JSX ? Le JSX correspond-il au design_plan ?
  </feature_plan>

  <root_cause_analysis> (UNIQUEMENT en cas de debug)
  - Erreur signalée : [Description]
  - Cause Racine Technique : [Faille dans le cycle de vie React, asynchronie, flux de données]
  - Solution Sécurisée : [Correction sans casser les autres fonctionnalités]
  </root_cause_analysis>

</efficiency_planning>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 : ANALYSE VISUELLE (SI IMAGE FOURNIE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ANALYSE]
STRUCTURE : [disposition : sidebar + header + contenu, etc.]
SIDEBAR : largeur ~___px, fond hex ___, border-right ___, pas de shadow
HEADER : hauteur ~___px, fond hex ___, border-bottom ___, pas de shadow
NAV ITEMS : hauteur ___px (max 36px), padding H ___px, icône ___px, text ___px/weight___
CARDS : fond hex ___, border rgba(_), radius ___px, shadow [UNIQUEMENT sur cards]
BOUTONS : bg hex ___, radius ___px, padding ___px, font-size ___px
INPUTS : hauteur ___px, border rgba(_), radius ___px
COULEURS TEXTE : primaire hex ___, secondaire hex ___, muted rgba(___)
[/ANALYSE]

[DETAILS]
Je vois que :
- [chaque élément visible, un par ligne, avec mesures et hex exacts]
[/DETAILS]

ASSETS :
- Icônes Tabler (CDN) : <i class="ti ti-home" style="font-size:16px;color:#555"></i>
- Logos de marques : <img src="https://www.google.com/s2/favicons?domain=DOMAIN&sz=32" style="width:16px;height:16px">
- Avatars : https://api.dicebear.com/7.x/avataaars/svg?seed=NOM — jamais d'emoji ou d'icône générique
- Iconsax (filled, pour cards colorées) : import { Home } from 'iconsax-react'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRÉER :
<create_file path="app/page.tsx">
[code complet — jamais tronqué]
</create_file>

ÉDITER (REMPLACEMENT CHIRURGICAL) :
<edit_file path="components/UploadZone.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M]
</changes_to_apply>
</edit_file>

BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 3 : EXPLICATION & ONBOARDING (APRÈS LE CODE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Après le code, explique à l'utilisateur SANS jargon technique :

1. 🚀 **Ce qui est fonctionnel** : [Ce que l'utilisateur peut tester immédiatement, en termes concrets]
2. 🛡️ **Ce qui a été préservé** : [Fonctionnalités existantes non touchées]
3. ⚠️ **CONFIGURATION REQUISE** : [Si Firebase/Supabase/Appwrite/Stripe/etc. → explique exactement où cliquer pour configurer CORS, règles de sécurité, clés API. L'utilisateur est débutant.]
4. ✅ **Auto-vérification** : [Confirme que le feature_plan a été respecté ET que le design_plan est cohérent avec le code généré]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES DE CODE QUALITÉ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- "use client" obligatoire en première ligne de tout composant avec hooks
- Exports nommés pour les views : export function DashboardView() {}
- Export default uniquement pour app/page.tsx et app/layout.tsx
- key={item.id} sur tous les .map()
- Alias @/ pour tous les imports internes
- Pas de tailwindcss-animate dans tailwind.config.ts plugins[]
- Layout pleine page : className="flex h-screen w-screen overflow-hidden"
- Jamais de onClick vide — chaque bouton déclenche une vraie logique
- Recharts pour les graphiques — jamais de divs qui simulent des barres
- app/layout.tsx doit inclure : <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />
- Modèles Gemini à utiliser (pas d'autres) : gemini-2.5-flash-preview-05-20, gemini-2.5-pro-preview-06-05, gemini-3-flash-preview, gemini-3.1-pro-preview

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPENDENCIES: ["nom-du-package"]
DEVDEPENDENCIES: ["@types/nom"]
REMOVEDEPENDENCIES: ["ancien-package"]
`;

// ─── Prompt de self-review silencieux ────────────────────────────────────
const SELF_REVIEW_PROMPT = `Tu es un auditeur de code d'efficience. Tu reçois du code généré par un autre agent.

Ta mission : vérifier que le <feature_plan> déclaré dans la réponse a été VRAIMENT implémenté, pas simulé.
Ton but est de vérifier si la fonctionnalité que l'agent à prevu coder est parfaitement créé et parfaitement fonctionnelle sans aucun problème, et que elle zst puissantes, bien fait et intégrer parfaitement au UI jsx react

POUR CHAQUE PROBLÈME TROUVÉ :
- Identifie le fichier et les lignes concernées
- Génère un fix immédiat en <edit_file> avec la vraie implémentation
- Si une clé API externe est nécessaire, ajoute une NOTE visible

Si AUCUN problème : réponds exactement "EFFICIENCY_OK" et rien d'autre.

IMPORTANT : Ne signale PAS les useState, useEffect, les vraies opérations DOM. Ce sont des implémentations légitimes.`;

// ─── Helpers dépendances ──────────────────────────────────────────────────
function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch { const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g); return r ? r.map(s => s.replace(/"/g, "")) : []; }
  }
  return [];
}

async function resolveVersion(pkg: string): Promise<string> {
  try { const d = await packageJson(pkg); return `^${d.version}`; }
  catch { return "latest"; }
}

async function buildPackageJson(
  aiOutput: string,
  existing: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  const toAdd = extractDeps(aiOutput, "DEPENDENCIES");
  const toAddDev = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRemove = extractDeps(aiOutput, "REMOVEDEPENDENCIES");

  if (toAdd.length === 0 && toAddDev.length === 0 && toRemove.length === 0) return null;

  const pkgFile = existing.find(f => f.path === "package.json");
  let pkg: any = pkgFile
    ? (() => { try { return JSON.parse(pkgFile.content); } catch { return null; } })()
    : null;

  if (!pkg) {
    pkg = {
      name: "app", version: "1.0.0", private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
      dependencies: { next: "14.2.16", react: "^18", "react-dom": "^18", "clsx": "latest", "tailwind-merge": "latest", "zustand": "latest" },
      devDependencies: {
        typescript: "^5", "@types/node": "^20", "@types/react": "^19",
        "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1",
        autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3",
      },
    };
  }

  await Promise.all([
    ...toAdd.map(async p => { if (pkg.dependencies && !pkg.dependencies[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (pkg.devDependencies && !pkg.devDependencies[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  toRemove.forEach(p => {
    if (pkg.dependencies?.[p]) delete pkg.dependencies[p];
    if (pkg.devDependencies?.[p]) delete pkg.devDependencies[p];
  });

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// ─── Self-review loop (même modèle, température basse) ────────────────────
async function runSelfReview(
  fullOutput: string,
  model: string,
  isAnthropic: boolean,
  geminiKey: string,
  anthropicKey: string,
  emit: (t: string) => void
): Promise<void> {
  // Uniquement si du code a été généré
  if (!fullOutput.includes("<create_file") && !fullOutput.includes("<edit_file")) return;
  if (fullOutput.length < 400) return;

  // Extrait le feature_plan déclaré + le code généré pour la comparaison
  const planMatch = fullOutput.match(/<feature_plan>([\s\S]*?)<\/feature_plan>/);
  const planText = planMatch ? planMatch[1].trim() : "";
  const reviewInput = `FEATURE_PLAN DÉCLARÉ:\n${planText || "(non trouvé)"}\n\nCODE GÉNÉRÉ:\n${fullOutput.slice(0, 45000)}`;

  try {
    let reviewResult = "";

    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const resp = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: reviewInput }] }],
        config: { systemInstruction: SELF_REVIEW_PROMPT, temperature: 0.15, maxOutputTokens: 12000 },
      });
      reviewResult = resp.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    } else {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const resp = await anthropic.messages.create({
        model,
        max_tokens: 12000,
        system: SELF_REVIEW_PROMPT,
        messages: [{ role: "user", content: reviewInput }],
      });
      reviewResult = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }

    if (reviewResult && !reviewResult.trim().startsWith("EFFICIENCY_OK")) {
      emit("\n\n---\n### 🔧 Corrections d'efficience détectées\n");
      emit(reviewResult);
    }
  } catch {
    // Best-effort — ne jamais bloquer la réponse principale
  }
}

// ─── Helper images ─────────────────────────────────────────────────────────
function parseImages(imgs: string[]): { data: string; mimeType: string }[] {
  return imgs.flatMap(img => {
    try {
      const raw = img.includes(",") ? img.split(",")[1] : img;
      if (!raw || raw.length < 100) return [];
      const mimeType = img.startsWith("data:image/png") ? "image/png"
        : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
      return [{ data: raw, mimeType }];
    } catch { return []; }
  });
}

function extractLastUserText(history: any[]): string {
  const last = history[history.length - 1];
  if (!last || last.role !== "user") return "Aide-moi.";
  if (typeof last.content === "string") return last.content;
  return last.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "Aide-moi.";
}

// ─── POST ─────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey) return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

    const body = await req.json();
    const {
      history = [],
      uploadedImages = [],
      allReferenceImages = [],
      currentProjectFiles = [],
      uploadedFiles = [],
      referenceColorMaps = [],
      uploadedColorMaps = [],
    } = body;

    // Build system prompt
    let systemPrompt = FILE_FORMAT;

    if (currentProjectFiles?.length > 0) {
      const addLineNums = (c: string) => c.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
      const snapshot = currentProjectFiles
        .map((f: { path: string; content: string }) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`)
        .join("\n\n");
      systemPrompt += `\n\nFICHIERS EXISTANTS (avec numéros de ligne pour edit_file — ne pas inclure le préfixe dans start_line/end_line) :\n${snapshot.slice(0, 80000)}`;
    }

    if (referenceColorMaps?.length > 0 || uploadedColorMaps?.length > 0) {
      const allColors = [...referenceColorMaps, ...uploadedColorMaps].join("\n");
      systemPrompt += `\n\nPALETTE DE COULEURS EXTRAITE PIXEL PAR PIXEL (utilise ces hex exacts — ne jamais inventer de couleur) :\n${allColors}`;
    }

    const lastUserText = extractLastUserText(history);
    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);
    const parsedImages = parseImages(allImages);

    const STREAM_HEADERS = {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    };

    // ── GEMINI ──────────────────────────────────────────────────────────────
    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Build contents from history (all but last)
      const contents: any[] = [];
      for (const msg of history.slice(0, -1)) {
        const role = msg.role === "assistant" ? "model" : "user";
        const text = typeof msg.content === "string"
          ? msg.content
          : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) contents.push({ role, parts: [{ text }] });
      }

      // Last message with images + PDFs
      const lastParts: any[] = [
        ...parsedImages.map(img => ({ inlineData: img })),
        ...(uploadedFiles || []).filter((f: any) => f.base64Content).map((f: any) => ({ inlineData: { data: f.base64Content, mimeType: "application/pdf" } })),
        { text: lastUserText },
      ];
      contents.push({ role: "user", parts: lastParts });

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const emit = (t: string) => controller.enqueue(enc.encode(t));
          try {
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: { systemInstruction: systemPrompt, temperature: 1.0, maxOutputTokens: 65536 },
            });
            let fullOutput = "";
            for await (const chunk of response) {
              const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "")?.join("") ?? "";
              if (text) { emit(text); fullOutput += text; }
            }
            // Package.json auto-update
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
            // Self-review loop
            await runSelfReview(fullOutput, MODEL_ID, false, geminiKey, "", emit);
          } catch (err: any) {
            emit(`\n[ERROR] ${err.message}`);
          }
          controller.close();
        },
      });

      return new Response(stream, { headers: STREAM_HEADERS });
    }

    // ── ANTHROPIC ───────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const messages: any[] = [];
    for (let i = 0; i < history.length - 1; i++) {
      const msg = history[i];
      const role = msg.role === "assistant" ? "assistant" : "user";
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
      if (text.trim()) messages.push({ role, content: text });
    }

    const lastContent: any[] = [
      ...parsedImages.map(img => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } })),
      { type: "text", text: lastUserText },
    ];
    messages.push({ role: "user", content: lastContent });

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));
        try {
          const response = await anthropic.messages.stream({
            model: MODEL_ID,
            max_tokens: 16000,
            system: systemPrompt,
            messages,
          });
          let fullOutput = "";
          for await (const chunk of response) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              emit(chunk.delta.text);
              fullOutput += chunk.delta.text;
            }
          }
          // Package.json auto-update
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
          // Self-review loop
          await runSelfReview(fullOutput, MODEL_ID, true, "", anthropicKey, emit);
        } catch (err: any) {
          emit(`\n[ERROR] ${err.message}`);
        }
        controller.close();
      },
    });

    return new Response(stream, { headers: STREAM_HEADERS });

  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
