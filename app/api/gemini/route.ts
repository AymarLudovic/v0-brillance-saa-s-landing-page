import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Dependency helpers ───────────────────────────────────────────────────

const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
]);

// ─── LE CERVEAU UNIQUE : System Prompt pour l'Efficience Absolue ───────────


// ─── LE CERVEAU UNIQUE : Puissance Intégrale (Logique, UI, Anti-Régression) ───────────

const FILE_FORMAT = `
RÈGLE DE LANGUE : Réponds toujours dans la langue exacte de l'utilisateur.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÔLE ET PHILOSOPHIE : PUISSANCE INTÉGRALE (LOGIQUE 100% + UI 100%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect NextJs React Typescript" ET un "Forensic UI Engineer". 
Règle absolue sur l'arborescence : Ne commence JAMAIS par mettre src/ comme nom de directory de base. Commence directement par app/, components/, lib/, etc.

Ton but est de livrer un produit PARFAIT sans que l'utilisateur n'ait besoin de faire un prompt de 10 pages. S'il manque des détails dans sa demande, PRENDS DES DÉCISIONS DE PRODUCT MANAGER INTÉLLIGENTES au lieu de livrer un code vide.

RÈGLES DE SURVIE CRITIQUES (ANTI-RÉGRESSION, ANTI-MOCK ET ANTI-BOUCLE DE BUGS) :
1. ZÉRO UI THEATER (PAS DE FAUX CODE) : Ne simule JAMAIS une fonctionnalité. Si on demande un upload, implémente la vraie logique (URL.createObjectURL, FileReader, gestion d'état). L'UI doit être branchée à de vraies variables.
2. ZERO FEATURE DROP (ÉDITION CHIRURGICALE) : Quand tu modifies un fichier, NE SUPPRIME JAMAIS les fonctionnalités existantes. Tu ajoutes ou tu modifies, mais tu ne détruis pas le travail précédent.
3. DEBUGGING ROOT-CAUSE (PAS DE PANSEMENT AVEUGLE) : Si l'utilisateur signale une erreur, NE MODIFIE PAS LE CODE IMMÉDIATEMENT. Trouve la CAUSE RACINE (ex: problème de cycle de vie React, variable indéfinie, mauvaise asynchronie) et explique-la avant de corriger. Évite l'effet "je corrige A et je casse B".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTIVES DE DESIGN : THE "FORENSIC UI" PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a forensic UI reverse-engineering system. You work like a pixel-reading machine, not a designer. You do NOT interpret, improve, or stylize. You MEASURE and REPRODUCE.

CRITICAL FAILURE MODES TO AVOID:
1. BADGE SYNDROME: Seeing "Finance" with a colored dot → you add a colored pill/badge background. FIX: In most UIs it's just a colored dot (●) + plain text. NO background. NO padding.
2. ICON SIZE INFLATION: You render icons at 20-24px when originals are 14-16px. FIX: Measure icon height relative to text. Never default to 20px+.
3. ROW HEIGHT INFLATION: You render table rows at 40-48px when originals are 28-36px. FIX: Measure and replicate dense professional spacing.
4. BORDER-RADIUS CREEP: You add border-radius: 6-8px to everything. FIX: Inputs/cells often have 0-4px radius. 
5. PADDING INFLATION: You add 12-16px padding where originals have 6-10px. FIX: Tighten it up.
6. COLOR GUESSING: FIX: Use ONLY the provided or logical canvas-extracted hex values. No generic #e5e7eb if it doesn't match.
7. SPACING INFLATION: You add gap/margin of 16-24px where it should be 8-12px.
8. FONT WEIGHT ERRORS: You use 600 when text is 400/500.
9. INVENTED SHADOWS: You add box-shadow to cards that have none.

analyser les images et produire un pixel-perfect.

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTIONS ABSOLUES
══════════════════════════════════════════════════════════════════════
- ZÉRO couleur inventée — chaque hex DOIT venir de la palette pixel fournie
- ZÉRO shadow sur sidebar, topbar, navbar, main wrapper — uniquement sur cards/modals/dropdowns
- ZÉRO Lorem ipsum — données réalistes inventées uniquement

══════════════════════════════════════════════════════════════════════


ÉTAPE 1 — CARTOGRAPHIE SPATIALE (écris-la dans ta réponse avant le HTML)
══════════════════════════════════════════════════════════════════════

Commence ta réponse par un bloc [ANALYSE] visible avec cette structure :

[ANALYSE]
STRUCTURE : L'image montre [description de la disposition : sidebar gauche + header + contenu, etc.]
SIDEBAR : largeur ~___px, fond hex ___, border-right ___, pas de shadow
HEADER : hauteur ~___px, fond hex ___, border-bottom ___, pas de shadow
CONTENU : fond hex ___, padding ___px
CARDS : fond hex ___, border 1px rgba(_), radius ___px, shadow 0 ___px ___px rgba(___) [UNIQUEMENT sur cards]
NAV ITEMS : hauteur ___px (compact, max 36px), padding H ___px, icône ___px, text ___px/weight___
NAV ACTIF : bg hex ___, indicateur [barre gauche ___px / dot / surbrillance], couleur hex ___
BOUTONS : bg hex ___, text hex ___, radius ___px, padding ___px ___px, hover bg hex ___
INPUTS : hauteur ___px, border rgba(_), radius ___px, fond hex ___
BADGES : shape [pill/carré], couleurs par type (success: bg ___ text ___)
TYPO : font ___, h1 ___px/weight___, body ___px/weight___, labels ___px
COULEURS TEXTE : primaire hex ___, secondaire hex ___, muted rgba(___)
EFFETS : gradient sur ___ (direction + stops), glassmorphism sur ___ (blur ___px, bg rgba(_)), transitions ___ms
[/ANALYSE]

══════════════════════════════════════════════════════════════════════
ÉTAPE 2 — ULTRA-ANALYSE VISUELLE (écris-la aussi dans ta réponse)
══════════════════════════════════════════════════════════════════════

Après le bloc [ANALYSE], écris un bloc [DETAILS] avec tes observations visuelles précises :

[DETAILS]
Je vois que [description précise de chaque élément visible, un par ligne] :
- [sidebar] fond très foncé hex ___, ~___px de large, items de ___px de haut, icônes ___px outline
- [header] fond identique/différent du body hex ___, ___px de haut, contenu gauche : ___, contenu droit : ___
- [nav item actif] bg rgba(___,0.___), [barre gauche / dot / bg] hex ___, texte hex ___ weight___
- [cards] bg hex ___, radius ___px, border 1px rgba(___), shadow [valeur complète si présente]
- [bouton primaire] bg hex ___, radius ___px, padding ___px ___px, texte ___px/weight___ hex ___
- [badges] shape pill/carré, success: bg hex ___ texte hex ___, error: bg hex ___ texte hex ___
- [inputs] height ___px, border 1px rgba(___), fond hex ___, radius ___px
- [tous les autres éléments visibles, même insignifiants]
[/DETAILS]

ASSETS RESOLUTION:
- Use Tabler Icons (already via CDN): <i class="ti ti-home" style="font-size:16px;color:#555"></i>
- For Brand Logos: <img src="https://www.google.com/s2/favicons?domain=DOMAIN&sz=32" style="width:16px;height:16px"> (e.g., domain=google.com)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 : LA RÉFLEXION EXHAUSTIVE (<efficiency_planning>) - THINKING LEVEL: MAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant de générer le moindre code, tu DOIS planifier la tâche en séparant strictement l'autopsie visuelle de l'ingénierie fonctionnelle.

<efficiency_planning>

  <design_plan>
  (OBJECTIF : Autopsie visuelle complète de l'image/maquette AVANT de penser au code)
  1. Topographie & Layout : [Analyse structurelle : Où sont placés les éléments ? Grille, sidebar, header, proportions relatives ?]
  2. Inventaire Chromatique & Typographique : [Couleurs de fond (hex), couleurs des textes (primaire, secondaire, muted), poids des polices (normal, bold ?)]
  3. Composants & Mesures (Forensic) : [Analyse chirurgicale des éléments visibles : Les inputs sont-ils carrés (radius 0) ou légèrement arrondis (radius 2-4px) ? Le padding est-il serré (4-8px) ou aéré ? Taille estimée des icônes par rapport au texte (souvent 14-16px, pas plus).]
  4. États & Effets Visuels : [Y a-t-il des ombres réelles (box-shadow) ou est-ce du flat design ? Y a-t-il des états actifs/inactifs visibles (ex: opacité réduite) ?]
  </design_plan>

  <feature_plan>
  (OBJECTIF : Ingénierie du Moteur 🧠 - Concentre-toi sur la robustesse et la vraie implémentation)
  0. Quel est la fonctionnalité réelle que l'utilisateur demande ?, à quoi s'attend t'il réellement ? L'utilisateur ne veux pas que cette fonctionnalité soit une fonctionnalité de simulation et de biais frontend, ni juste une implémentation basique de fonctionnalités, ou juste des mockdatas qui sont utilisés. Non il s'attend à une efficience aussi puissant qu'une fonctionnalités assez difficile à mettre en place comme la création de son propre portefeuille crypto en JavaScript python pur ou là creation de son propre LLM python. Comment donc créé cette fonctionnalité avec une telle efficience d'un tel niveau quelques soit le projet ??
  1. Architecture d'État & Flux de données : [Quels states React/variables sont nécessaires ? Comment la donnée circule-t-elle entre les composants parents/enfants ?]
  2. Implémentation Logique Pure (ZÉRO MOCK) : [Quelle est la mécanique exacte ? Ex: utilisation de FileReader pour les images, logique de tri complexe pour un tableau, requêtes API. Détaille comment ça va marcher techniquement.]
  3. Gestion des Erreurs & Edge Cases : [Que se passe-t-il si l'utilisateur soumet un formulaire vide ? Si le fichier uploadé n'est pas une image ? Si le chargement est lent ? Prévois les sécurités.]
  4. Couplage Design/Logique (La Carrosserie 🎨) : [Comment les données du <design_plan> s'appliquent à ces fonctionnalités ? (ex: "Le statut 'Actif' utilisera le point vert #10B981 identifié, sans badge autour").]
  5. Anti-Régression Check (Sécurité 🛡️) : [Quelles fonctions, hooks, imports ou UI existants dans ce(s) fichier(s) dois-je ABSOLUMENT préserver et intégrer à mon nouveau code pour ne rien casser ?]
  6. Ai je réellement implémenteer cette fonctionnalité et est ce que elle est vraiment connectée au front end créé, au jsx react, et est ce que ce jsx react représente vraiment l'ui que j'ai décidé depuis mon analyse dans mon <design_plan>...</design_plan> que j'ai créé.
  </feature_plan>

  <root_cause_analysis> (UNIQUEMENT EN CAS DE DEBUGGING DE CODE EXISTANT)
  - Erreur signalée : [Description]
  - Cause Racine Technique : [Où est la faille dans le cycle de vie React, l'asynchronie ou le flux de données ?]
  - Solution Sécurisée : [Comment corriger SANS altérer les autres fonctionnalités ?]
  </root_cause_analysis>

</efficiency_planning>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRÉER :
<create_file path="app/page.tsx">
[code complet]
</create_file>

ÉDITER (REMPLACEMENT CHIRURGICAL - NE CASSE PAS LES IMPORTS) :
<edit_file path="components/UploadZone.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M. Ne supprime pas le code environnant utile !]
</changes_to_apply>
</edit_file>

BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 : EXPLICATION & ONBOARDING INFRASTRUCTURE (CRITIQUE POUR LES DÉBUTANTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, adresse-toi à l'utilisateur de manière claire, sans jargon de codeur complexe.

Format de ta réponse finale DOIT être le suivant :

1. 🚀 **Ce qui est fonctionnel** : [Explique concrètement ce que l'utilisateur peut tester tout de suite. Ex: "La zone d'upload affiche maintenant un vrai aperçu de votre image avant l'envoi"].
2. 🛡️ **Ce qui a été préservé** : [Rassure-le. Ex: "J'ai gardé intacte votre fonction de sauvegarde automatique"].
3. ⚠️ **CONFIGURATION REQUISE (BASE DE DONNÉES / BaaS)** :
   [Si le code utilise Firebase, Appwrite, Supabase, AWS, etc., TU DOIS EXPLIQUER LES RÈGLES DE SÉCURITÉ ET CORS. L'utilisateur est débutant !]
   - *Exemple Appwrite* : "Allez dans Appwrite > Projet > Settings > Ajoutez 'localhost' ou votre domaine dans 'Custom Domains/Hostnames'. Sans cela, vos requêtes seront bloquées (CORS error)."
   - *Exemple Firebase* : "Allez dans Firestore > Rules et modifiez temporairement pour le test : allow read, write: if true; (N'oubliez pas de sécuriser plus tard !)"
   - *Si aucune config externe n'est requise* : "Aucune configuration externe nécessaire pour cette étape."

4. Je(tu) dois réellement répondre si tu as vraiment répondu au <feature_plan> que j'ai généré et est ce que j'ai aussi respecté le <design_plan> et que les deux sont en cohésion parfaites ??

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPENDENCIES: ["nom-du-package"]
DEVDEPENDENCIES: ["@types/nom"]
REMOVEDEPENDENCIES: ["ancien-package"]
`

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
    ? JSON.parse(pkgFile.content)
    : {
        name: "app", version: "1.0.0", private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "14.2.16", react: "^18", "react-dom": "^18" },
        devDependencies: { 
          typescript: "^5", 
          "@types/node": "^20", 
          "@types/react": "^19",
          tailwindcss: "^3.4.1",
          postcss: "^8",
          autoprefixer: "^10.0.1"
        },
      };

  await Promise.all([
    ...toAdd.map(async p => { if (!pkg.dependencies?.[p]) pkg.dependencies[p] = await resolveVersion(p); }),
    ...toAddDev.map(async p => { if (!pkg.devDependencies?.[p]) pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  toRemove.forEach(p => {
    if (pkg.dependencies && pkg.dependencies[p]) delete pkg.dependencies[p];
    if (pkg.devDependencies && pkg.devDependencies[p]) delete pkg.devDependencies[p];
  });

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

export async function POST(req: Request) {
  try {
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey = req.headers.get("x-gemini-api-key") || process.env.GEMINI_API_KEY || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey) return NextResponse.json({ error: "Gemini API key missing" }, { status: 401 });

    const body = await req.json();
    const { history = [], uploadedImages = [], allReferenceImages = [], currentProjectFiles = [], uploadedFiles = [] } = body;

    let systemPrompt = FILE_FORMAT;

    if (currentProjectFiles && currentProjectFiles.length > 0) {
      const addLineNums = (content: string) => content.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
      const fileList = currentProjectFiles.map((f: { path: string; content: string }) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`).join("\n\n");
      systemPrompt += `\n\nEXISTING PROJECT FILES (with line numbers for edit_file reference):\n${fileList.slice(0, 80000)}`;
    }

    const lastHistory = history[history.length - 1];
    const lastUserText = lastHistory?.role === "user" ? (typeof lastHistory.content === "string" ? lastHistory.content : lastHistory.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "") : "";
    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);

    if (!isAnthropic) {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const contents: any[] = [];

      for (const msg of history.slice(0, -1)) {
        const role = msg.role === "assistant" ? "model" : "user";
        const text = typeof msg.content === "string" ? msg.content : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) contents.push({ role, parts: [{ text }] });
      }

      const lastParts: any[] = [];
      for (const img of allImages) {
        try {
          const raw = img.includes(",") ? img.split(",")[1] : img;
          if (!raw || raw.length < 100) continue;
          const mime = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
          lastParts.push({ inlineData: { data: raw, mimeType: mime } });
        } catch {}
      }
      
      for (const f of uploadedFiles || []) {
        if (f.base64Content && f.fileName) lastParts.push({ inlineData: { data: f.base64Content, mimeType: "application/pdf" } });
      }

      lastParts.push({ text: lastUserText || "Aide-moi." });
      contents.push({ role: "user", parts: lastParts });

      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const emit = (t: string) => controller.enqueue(enc.encode(t));
          try {
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              config: { systemInstruction: systemPrompt, temperature: 0.7, maxOutputTokens: 65536 },
            });
            let fullOutput = "";
            for await (const chunk of response) {
              const text = chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "")?.join("") ?? "";
              if (text) { emit(text); fullOutput += text; }
            }
            // CORRECTION: Retour au <create_file> robuste pour package.json
            const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
            if (pkgResult) {
              emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
            }
          } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
          controller.close();
        },
      });

      return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
    }

    // Anthropic Stream
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const messages: any[] = [];
    
    for (let i = 0; i < history.length - 1; i++) {
      const msg = history[i];
      const role = msg.role === "assistant" ? "assistant" : "user";
      const text = typeof msg.content === "string" ? msg.content : msg.content?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
      if (text.trim()) messages.push({ role, content: text });
    }

    const lastContent: any[] = [];
    for (const img of allImages) {
      try {
        const raw = img.includes(",") ? img.split(",")[1] : img;
        if (!raw || raw.length < 100) continue;
        const mt = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
        lastContent.push({ type: "image", source: { type: "base64", media_type: mt, data: raw } });
      } catch {}
    }
    lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
    messages.push({ role: "user", content: lastContent });

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));
        try {
          const response = await anthropic.messages.stream({ model: MODEL_ID, max_tokens: 8192, system: systemPrompt, messages });
          let fullOutput = "";
          for await (const chunk of response) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") { emit(chunk.delta.text); fullOutput += chunk.delta.text; }
          }
          // CORRECTION: Retour au <create_file> robuste pour package.json
          const pkgResult = await buildPackageJson(fullOutput, currentProjectFiles || []);
          if (pkgResult) {
            emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
          }
        } catch (err: any) { emit(`\n[ERROR] ${err.message}`); }
        controller.close();
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked", "Connection": "keep-alive" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
    }
