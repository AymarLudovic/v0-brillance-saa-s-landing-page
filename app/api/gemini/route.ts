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
RÔLE ET PHILOSOPHIE : PUISSANCE INTÉGRALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es un "Principal Full-Stack Architect" ET un "Forensic UI Engineer". Ton but est de livrer un produit PARFAIT : un moteur puissant (80%) avec un design mesuré au pixel près (20%).

RÈGLES DE SURVIE CRITIQUES (ANTI-RÉGRESSION ET ANTI-MOCK) :
1. ZÉRO UI THEATER : Ne simule JAMAIS un upload (utilise URL.createObjectURL ou FileReader pour de vrai), un paiement, ou une API. TOUT DOIT ÊTRE FONCTIONNEL.
2. ZERO FEATURE DROP : Quand tu modifies un fichier, NE SUPPRIME JAMAIS les fonctionnalités existantes. Intègre ta nouveauté sans casser le reste. Édition chirurgicale requise.
3. DEBUGGING ROOT-CAUSE : Si on te signale une erreur, n'applique pas de pansement à l'aveugle. Trouve la cause racine (ex: problème de cycle de vie React, variable indéfinie) avant d'éditer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRECTIVES DE DESIGN "FORENSIC UI" (L'INGÉNIERIE DU PIXEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu es une machine à lire les pixels, pas un artiste. Ne stylise pas, REPRODUIS.
- BADGE SYNDROME : Un point de couleur + texte n'est PAS un badge. N'ajoute pas de fond (background) ou de padding sauf si c'est explicitement visible.
- INFLATION DES MESURES : N'invente pas des paddings de 16px si c'est 8px. N'invente pas des border-radius de 8px sur des inputs carrés (utilise 0-4px).
- COULEURS : Utilise UNIQUEMENT les codes hexadécimaux fournis dans le contexte. N'invente pas de nuances de gris (ex: pas de #e5e7eb par défaut).
- ICÔNES : Utilise les icônes Tabler (ex: <i className="ti ti-home" />). Ne les rends pas gigantesques (14-16px max si le texte est petit).
- OMBRES INVENTÉES : N'ajoute pas de box-shadow s'il n'y a pas d'ombre visible.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 1 : LA RÉFLEXION EXHAUSTIVE (<efficiency_planning>) - THINKING LEVEL: MAX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant de coder, planifie CHAQUE fonctionnalité avec une rigueur absolue.

<efficiency_planning>

<feature_plan>
1. Feature: [Nom]
2. Logique & Architecture (Le Moteur) : [Détaille le vrai code : ex. FileReader pour les images, gestion des erreurs, appels API, persistance globale].
3. Forensic UI (La Carrosserie) : [Quelles sont les mesures exactes ? Couleurs ? Paddings ? Résolution des icônes ?]
4. Infrastructure Externe (DevOps) : [Est-ce que Firebase, Appwrite, Supabase, Stripe, etc. est utilisé ? Si oui, quelles règles de sécurité, domaines ou webhooks l'utilisateur devra-t-il configurer ?]
</feature_plan>

[... Répéter <feature_plan> pour CHAQUE fonctionnalité ...]

</efficiency_planning>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRÉER :
<create_file path="relative/path/to/file.tsx">
[code complet]
</create_file>

ÉDITER (Pour préserver le code, remplace UNIQUEMENT ce qui doit changer) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M. Ne casse pas les imports ou les hooks existants !]
</changes_to_apply>
</edit_file>

BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE 2 : L'EXPLICATION POST-GÉNÉRATION & ONBOARDING INFRASTRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APRÈS avoir généré le code, explique ton travail SANS jargon technique (pas de "useState", "React", etc.).

Format exigé pour ta réponse finale :

1. **Ce qui fonctionne maintenant** : [Explique la fonctionnalité d'un point de vue utilisateur. Ex: "Vous pouvez maintenant uploader de vraies vidéos et les lire immédiatement"].
2. **Ce que j'ai préservé/réparé** : [Rassure l'utilisateur sur le fait que l'ancienne fonctionnalité X marche toujours].
3. **⚠️ ACTIONS REQUISES (TRÈS IMPORTANT)** : [Si tu as utilisé une base de données ou un service tiers, explique à l'utilisateur DÉBUTANT comment configurer la plateforme. Ex: "Allez sur Appwrite > Settings > Ajoutez votre domaine 'localhost' dans les Hostnames autorisés, sinon la connexion échouera." ou "Dans Firebase Firestore, définissez les Rules sur 'allow read, write: if true;' pour le développement."]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEPENDENCIES: ["nom-du-package"]
DEVDEPENDENCIES: ["@types/nom"]
REMOVEDEPENDENCIES: ["ancien-package"]
`;

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
