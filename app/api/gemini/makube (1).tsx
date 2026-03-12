import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
// basePrompt remplacé par BASE_SYSTEM_PROMPT — stack universelle
// (plus d'import @/lib/prompt qui était Next.js-only)
import packageJson from "package-json";
import sharp from "sharp";
import { Sandbox } from "@e2b/code-interpreter";


// ═══════════════════════════════════════════════════════════════════════════
// BASE_SYSTEM_PROMPT — Connaissance universelle de la stack
// Remplace l'ancien basePrompt Next.js-only
// Injecté dans chaque agent à la place de basePrompt
// ═══════════════════════════════════════════════════════════════════════════
const BASE_SYSTEM_PROMPT = `
Tu es un expert en développement fullstack avec une maîtrise complète de la stack universelle suivante.

══════════════════════════════════════════════════════════════════════
STACK UNIVERSELLE — CE QUE TU GÉNÈRES
══════════════════════════════════════════════════════════════════════

COUCHE FRONTEND — React + Next.js 15 + TypeScript
  Toujours présente. UI, routing, pages, composants, hooks.
  State management : Zustand.
  Styling : Tailwind CSS.

COUCHE BACKEND PYTHON — FastAPI (port 8000, dossier /backend)
  Toujours générée si le projet a besoin de :
  - Logique métier complexe, traitement de données
  - Connexions à des APIs tierces (trading, paiement, email...)
  - Automatisation web (Playwright — contrôle vrai navigateur)
  - IA / ML / traitement NLP (PyTorch, HuggingFace, OpenAI...)
  - WebSockets serveur pour temps réel
  - Tout ce que JavaScript ne peut pas faire nativement

  Architecture : /backend/main.py (FastAPI) + /backend/requirements.txt
  Next.js proxifie /api/py/* → http://localhost:8000/* (via next.config.ts rewrites)

COUCHE PERFORMANCE — Rust → WebAssembly (si calcul intensif requis)
  Utilisée si le projet a besoin de :
  - Audio temps réel bas niveau (DAW, synthétiseur, effets)
  - Rendu graphique intensif (canvas, WebGL, shader)
  - Cryptographie (wallet, hashing)
  - Calculs lourds (simulation, compression, traitement signal)
  
  Structure : /wasm-modules/<nom>/ avec Cargo.toml + src/lib.rs
  Compilé en WASM avec wasm-pack, importé comme module npm

COUCHE TEMPS RÉEL — WebSockets + WebRTC (si collaboration/live requis)
  WebSockets : via FastAPI (WebSocket endpoint) + hook React côté client
  WebRTC : pour vidéo/audio peer-to-peer, streaming live
  Utilisé si : chat, collaboration, live stream, notifications push

COUCHE GRAPHIQUE — WebGL + WebGPU (si rendu 3D/avancé requis)
  Three.js ou direct WebGL/WebGPU pour : visualisations 3D, jeux, éditeurs graphiques

══════════════════════════════════════════════════════════════════════
RÈGLE FONDAMENTALE — COMMENT CHOISIR
══════════════════════════════════════════════════════════════════════

Avant de générer quoi que ce soit, identifie :
1. Ce que l'utilisateur veut FAIRE (pas juste voir)
2. Quelle couche technique peut RÉELLEMENT implémenter ça
3. Génère les fichiers de la bonne couche, pas une simulation

EXEMPLES :
"Contrôler Chrome" → Python + Playwright (pas une WebView)
"Trading connecté" → Python + ccxt (pas fetch mock)
"DAW/audio pro" → Rust/WASM + Web Audio API (pas HTML5 audio simple)
"Chat en temps réel" → FastAPI WebSocket + hook React (pas setTimeout polling)
"Wallet crypto" → Python + web3.py OU Rust WASM (pas localStorage)
"Clone Figma" → Canvas + WebGL (pas divs CSS)

══════════════════════════════════════════════════════════════════════
STRUCTURE DES FICHIERS GÉNÉRÉS
══════════════════════════════════════════════════════════════════════

Frontend Next.js (toujours) :
  app/              → Pages et layout
  components/       → Composants React
  hooks/            → Custom hooks (useWebSocket, usePython, etc.)
  stores/           → Zustand stores
  types/            → Interfaces TypeScript
  lib/              → Utils, helpers, env
  public/           → Assets statiques

Backend Python (si nécessaire) :
  backend/main.py         → FastAPI app + routes
  backend/requirements.txt → Python packages
  backend/services/       → Logique métier Python
  backend/models/         → Pydantic models

WASM (si calcul intensif) :
  wasm-modules/<nom>/Cargo.toml
  wasm-modules/<nom>/src/lib.rs

══════════════════════════════════════════════════════════════════════
COMMUNICATION FRONTEND ↔ BACKEND PYTHON
══════════════════════════════════════════════════════════════════════

HTTP REST : fetch("/api/py/endpoint") → proxifié vers FastAPI port 8000
WebSocket : new WebSocket(`${proto}//${window.location.host}/api/py/ws/...`) — JAMAIS localhost:8000 directement
CORS : configuré dans FastAPI (middleware déjà dans main.py de base)
`;

const BATCH_SIZE = 256;
const MODEL_ID = "gemini-3-flash-preview";

// =============================================================================
// TYPES
// =============================================================================

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// =============================================================================
// UTILITAIRES
// =============================================================================

function getMimeType(dataUrl: string) {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return m ? m[1] : "application/octet-stream";
}
function cleanBase64(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}
function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch { const r = m[1].match(/"([a-zA-Z0-9-@/.]+)"/g); return r ? r.map(s => s.replace(/"/g, "")) : []; }
  }
  return [];
}
function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  // Cas normal : tag fermant présent
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });

  // Cas tronqué : tag ouvrant présent mais tag fermant absent (stream coupé)
  // On récupère quand même le contenu partiel si le fichier n'a pas déjà été parsé
  if (output.includes("<create_file ")) {
    const rxOpen = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxOpen.exec(output)) !== null) {
      const path = mo[1];
      const content = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (content.length > 50 && !files.find(f => f.path === path)) {
        files.push({ path, content });
      }
    }
  }
  return files;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// STR_REPLACE — édition chirurgicale de fichiers (legacy, gardé pour compat)
// =============================================================================

interface StrReplaceOp { path: string; oldStr: string; newStr: string; }

function parseStrReplaceOps(output: string): StrReplaceOp[] {
  const ops: StrReplaceOp[] = [];
  const rx = /<str_replace path="([^"]+)">\s*<old_str>([\s\S]*?)<\/old_str>\s*<new_str>([\s\S]*?)<\/new_str>\s*<\/str_replace>/g;
  let m;
  while ((m = rx.exec(output)) !== null) ops.push({ path: m[1].trim(), oldStr: m[2], newStr: m[3] });
  return ops;
}

function applyStrReplaceToFiles(
  allFiles: { path: string; content: string }[],
  ops: StrReplaceOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];
  for (const op of ops) {
    const idx = allFiles.findIndex(f => f.path === op.path);
    if (idx < 0) { failed.push({ path: op.path, reason: "Fichier introuvable" }); continue; }
    if (!allFiles[idx].content.includes(op.oldStr)) { failed.push({ path: op.path, reason: "old_str introuvable" }); continue; }
    allFiles[idx] = { ...allFiles[idx], content: allFiles[idx].content.replace(op.oldStr, op.newStr) };
    applied++;
  }
  return { applied, failed };
}

// =============================================================================
// EDIT_FILE — édition par numéros de lignes (format moderne, préféré)
// Remplace str_replace pour les agents. Robuste même sur de gros fichiers.
// =============================================================================

type EditFileAction = "replace" | "insert_after" | "insert_before" | "delete" | "append";

interface EditFileOp {
  path: string;
  action: EditFileAction;
  startLine?: number;  // 1-indexed
  endLine?: number;    // 1-indexed (inclusive)
  changes: string;     // contenu à insérer/remplacer (vide pour delete)
}

function parseEditFileOps(output: string): EditFileOp[] {
  const ops: EditFileOp[] = [];
  const rx = /<edit_file\s+path="([^"]+)"\s+action="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) {
    const path = m[1].trim();
    const action = m[2].trim() as EditFileAction;
    const body = m[3];

    const startMatch = body.match(/<start_line>\s*(\d+)\s*<\/start_line>/);
    const endMatch   = body.match(/<end_line>\s*(\d+)\s*<\/end_line>/);
    const changesMatch = body.match(/<changes_to_apply>([\s\S]*?)<\/changes_to_apply>/);

    ops.push({
      path,
      action,
      startLine: startMatch ? parseInt(startMatch[1], 10) : undefined,
      endLine:   endMatch   ? parseInt(endMatch[1], 10)   : undefined,
      changes:   changesMatch ? changesMatch[1] : "",
    });
  }
  return ops;
}

/**
 * Applique une seule opération edit_file sur le contenu d'un fichier.
 * Retourne le nouveau contenu ou null en cas d'erreur.
 */
function applyEditFileOpToContent(content: string, op: EditFileOp): { result: string; error?: string } {
  const lines = content.split("\n");
  const total = lines.length;

  const clamp = (n: number) => Math.max(1, Math.min(n, total));
  const sl = op.startLine !== undefined ? clamp(op.startLine) : undefined;
  const el = op.endLine   !== undefined ? clamp(op.endLine)   : sl;

  // Nouvelles lignes à insérer (trim trailing newline for cleanliness)
  const newLines = op.changes.replace(/\n$/, "").split("\n");

  switch (op.action) {
    case "replace": {
      if (sl === undefined) return { result: content, error: "start_line requis pour replace" };
      const start = sl - 1;
      const end   = (el ?? sl) - 1;
      if (start > end || start < 0 || end >= total) {
        return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl} (total: ${total})` };
      }
      const updated = [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)];
      return { result: updated.join("\n") };
    }
    case "insert_after": {
      if (sl === undefined) return { result: content, error: "start_line requis pour insert_after" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) {
        return { result: content, error: `Ligne ${sl} hors limites (total: ${total})` };
      }
      const updated = [...lines.slice(0, idx + 1), ...newLines, ...lines.slice(idx + 1)];
      return { result: updated.join("\n") };
    }
    case "insert_before": {
      if (sl === undefined) return { result: content, error: "start_line requis pour insert_before" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) {
        return { result: content, error: `Ligne ${sl} hors limites (total: ${total})` };
      }
      const updated = [...lines.slice(0, idx), ...newLines, ...lines.slice(idx)];
      return { result: updated.join("\n") };
    }
    case "delete": {
      if (sl === undefined) return { result: content, error: "start_line requis pour delete" };
      const start = sl - 1;
      const end   = (el ?? sl) - 1;
      if (start < 0 || end >= total || start > end) {
        return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl}` };
      }
      const updated = [...lines.slice(0, start), ...lines.slice(end + 1)];
      return { result: updated.join("\n") };
    }
    case "append": {
      return { result: content + "\n" + op.changes };
    }
    default:
      return { result: content, error: `Action inconnue: ${op.action}` };
  }
}

/**
 * Applique toutes les edit_file ops sur un tableau de fichiers.
 * Les ops d'un même fichier sont triées et appliquées intelligemment.
 */
function applyEditFileOpsToFiles(
  allFiles: { path: string; content: string }[],
  ops: EditFileOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];

  // Groupe les ops par fichier
  const byFile = new Map<string, EditFileOp[]>();
  for (const op of ops) {
    if (!byFile.has(op.path)) byFile.set(op.path, []);
    byFile.get(op.path)!.push(op);
  }

  for (const [filePath, fileOps] of byFile.entries()) {
    const idx = allFiles.findIndex(f => f.path === filePath);
    if (idx < 0) { failed.push({ path: filePath, reason: "Fichier introuvable" }); continue; }

    // Trier les ops de bas en haut pour ne pas décaler les numéros de ligne
    const sorted = [...fileOps].sort((a, b) => {
      const al = a.action === "append" ? Infinity : (a.startLine ?? 0);
      const bl = b.action === "append" ? Infinity : (b.startLine ?? 0);
      return bl - al; // descendant
    });

    let currentContent = allFiles[idx].content;
    for (const op of sorted) {
      const { result, error } = applyEditFileOpToContent(currentContent, op);
      if (error) {
        failed.push({ path: filePath, reason: error });
      } else {
        currentContent = result;
        applied++;
      }
    }
    allFiles[idx] = { ...allFiles[idx], content: currentContent };
  }
  return { applied, failed };
}

function detectEnvVars(files: { path: string; content: string }[]): string[] {
  const envSet = new Set<string>();
  const rx = /process\.env\.([A-Z_][A-Z0-9_]+)/g;
  for (const f of files) { let m; while ((m = rx.exec(f.content)) !== null) envSet.add(m[1]); }
  const builtins = new Set(["NODE_ENV","PORT","VERCEL","VERCEL_URL","NEXT_RUNTIME"]);
  return Array.from(envSet).filter(v => !builtins.has(v)).sort();
}

// =============================================================================
// FUNCTION DECLARATION — readFile (tool pour les agents)
// =============================================================================

const readFileDecl: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet. Utilise-le pour consulter les fichiers existants.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// DESIGN ANCHOR
// =============================================================================

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef) return "";
  return `
╔═══════════════════════════════════════════════════════════╗
║  DESIGN CONTRACT — AUTORITÉ ABSOLUE SUR LE VISUEL        ║
╚═══════════════════════════════════════════════════════════╝
LOI 1 — CSS variables :root {} du HTML → app/globals.css (toutes, sans exception)
LOI 2 — <link> CDN du HTML → app/layout.tsx (Tabler Icons, Google Fonts...)
LOI 3 — Couleurs exactes : bg-[#1a1a2e] jamais bg-gray-900
LOI 4 — Icônes : <i className="ti ti-[name]" /> via CDN du layout
LOI 5 — Images réelles : favicons.google / dicebear / picsum UNIQUEMENT

HTML/CSS DE RÉFÉRENCE :
\`\`\`html
${htmlRef.slice(0, 12000)}
\`\`\`
`;
}

// =============================================================================
// RETRY — backoff automatique sur 503/429
// =============================================================================

async function callWithRetry(
  fn: () => Promise<AsyncIterable<any>>,
  onChunk: (txt: string) => void,
  opts: { maxAttempts?: number; baseDelay?: number; onThought?: (txt: string) => void; onUsage?: (usage: { totalTokenCount: number; promptTokenCount: number; candidatesTokenCount: number }) => void; collectedFunctionCalls?: any[] } = {}
): Promise<string> {
  const { maxAttempts = 6, baseDelay = 15000, onThought, onUsage, collectedFunctionCalls = [] } = opts;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 15s, 30s, 60s, 60s, 60s
      const waitMs = Math.min(baseDelay * Math.pow(2, attempt - 1), 60000);
      onChunk(`\n[RETRY ${attempt}/${maxAttempts - 1}] Modèle surchargé — reprise dans ${Math.round(waitMs / 1000)}s...\n`);
      await sleep(waitMs);
    }
    try {
      const stream = await fn();
      let fullOutput = "";
      // Track last seen usageMetadata — only fire onUsage once at stream end
      let lastUsage: { totalTokenCount: number; promptTokenCount: number; candidatesTokenCount: number } | null = null;
      for await (const chunk of stream) {
        // Capture usageMetadata — always overwrite with latest (last chunk is the real total)
        if (chunk.usageMetadata) {
          lastUsage = {
            totalTokenCount: chunk.usageMetadata.totalTokenCount ?? 0,
            promptTokenCount: chunk.usageMetadata.promptTokenCount ?? 0,
            candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
        // Handle thought parts (from thinkingConfig.includeThoughts)
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts && parts.length > 0) {
          for (const part of parts) {
            // Collect function calls (tool use by the model)
            if ((part as any).functionCall) {
              // Préserver le part ENTIER — la thoughtSignature est un champ parallèle
              // sur le part, pas dans functionCall. La perdre = 400 error sur Gemini 3.
              collectedFunctionCalls.push(part as any);
              continue;
            }
            if (!part.text) continue;
            if (part.thought) {
              // Capture thought content separately
              if (onThought) onThought(part.text);
            } else {
              fullOutput += part.text;
              onChunk(part.text);
            }
          }
        } else {
          // Fallback for non-thinking chunks
          const txt = chunk.text;
          if (txt) { fullOutput += txt; onChunk(txt); }
        }
      }
      // Fire onUsage exactly ONCE with the final accumulated token count
      if (lastUsage && onUsage) onUsage(lastUsage);
      return fullOutput;
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err ?? "");
      const isRetryable =
        msg.includes("503") || msg.includes("502") || msg.includes("429") ||
        msg.includes("UNAVAILABLE") || msg.includes("high demand") ||
        msg.includes("Service Unavailable") || msg.includes("overloaded");
      if (!isRetryable || attempt === maxAttempts - 1) throw err;
      // backoff handled at top of loop
    }
  }
  throw lastErr;
}

// =============================================================================
// PACKAGE RESOLUTION
// =============================================================================

const BUNDLED_TYPES = new Set([
  "react","react-dom","next","typescript","node","@types/node",
  "tailwindcss","postcss","autoprefixer","eslint","eslint-config-next",
]);
const TYPES_MAP: Record<string,string> = {
  "express": "@types/express",
  "lodash": "@types/lodash",
  "node-fetch": "@types/node-fetch",
};

async function resolveTypes(pkgs: string[], existing: Record<string,string>): Promise<Record<string,string>> {
  const needed: Record<string,string> = {};
  await Promise.all(pkgs.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

// =============================================================================
// DÉTECTION PATCH MODE (erreurs de build collées dans le chat)
// =============================================================================

function isPatchRequest(msg: string): boolean {
  return (
    msg.includes("Failed to compile") ||
    msg.includes("Build Error") ||
    msg.includes("SyntaxError") ||
    msg.includes("Module parse failed") ||
    msg.includes("Cannot find module") ||
    msg.includes("Type error:") ||
    msg.includes("Error:   x ") ||
    (msg.includes("error TS") && msg.includes(".ts")) ||
    /\.\/(app|components|stores|hooks|services|lib|types)\/.*\.(ts|tsx)\n/.test(msg)
  );
}

function parseBrokenFiles(msg: string): string[] {
  const files = new Set<string>();
  const nextPatterns = msg.matchAll(/\.\/((?:app|components|stores|hooks|services|lib|types|pages)[^\s\n]+\.tsx?)/g);
  for (const m of nextPatterns) files.add(m[1]);
  const tsPatterns = msg.matchAll(/\/((?:app|components|stores|hooks|services|lib|types)[^\s(]+\.tsx?)(?:\(|\s)/g);
  for (const m of tsPatterns) files.add(m[1]);
  return Array.from(files);
}

// =============================================================================
// SMART PATCH DETECTION — Détecte si c'est une petite modification vs reconstruction
// =============================================================================

function isSmallModificationRequest(msg: string, hasExistingFiles: boolean): boolean {
  if (!hasExistingFiles) return false;
  // Keywords indicating a full rebuild
  const rebuildKw = [
    "crée", "créer", "génère", "générer", "construis", "refais tout", "nouveau projet",
    "from scratch", "reconstruit", "entière", "entièrement", "toute l\'application",
    "create", "build", "rebuild", "complete", "full app",
  ];
  const lm = msg.toLowerCase();
  if (rebuildKw.some(k => lm.includes(k))) return false;
  // Keywords indicating a small change
  const smallKw = [
    "ajoute", "ajouter", "modifie", "modifier", "change", "changer", "fixe", "corriger",
    "rajoute", "mets", "mettre", "remplace", "supprimer", "supprime", "update", "add",
    "modify", "remove", "delete", "small", "just", "only", "simple", "quick",
    "améliore", "améliorer", "style", "couleur", "texte", "bouton", "section",
  ];
  const hasSmallKw = smallKw.some(k => lm.includes(k));
  const isShortMsg = msg.length < 300;
  return hasSmallKw && isShortMsg;
}

// =============================================================================
// DESIGN EXTRACTION — extrait les couleurs d'une image base64 côté serveur (via sharp)
// =============================================================================

async function extractDominantColorsFromBase64(base64: string): Promise<{ hex: string; zone: string }[]> {
  try {
    const data = base64.includes(",") ? base64.split(",")[1] : base64;
    const buf = Buffer.from(data, "base64");
    const { data: pixels, info } = await sharp(buf).resize(200, 200, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, ch = info.channels;
    const zones = [
      { name: "global",   x1: 0,        y1: 0,        x2: W,        y2: H },
      { name: "sidebar",  x1: 0,        y1: 0,        x2: W * 0.22, y2: H },
      { name: "header",   x1: 0,        y1: 0,        x2: W,        y2: H * 0.12 },
      { name: "content",  x1: W * 0.22, y1: H * 0.12, x2: W,        y2: H },
    ];
    const result: { hex: string; zone: string }[] = [];
    for (const zone of zones) {
      const colorMap: Record<string, number> = {};
      for (let y = Math.floor(zone.y1); y < Math.floor(zone.y2); y += 4) {
        for (let x = Math.floor(zone.x1); x < Math.floor(zone.x2); x += 4) {
          const i = (y * W + x) * ch;
          const r = Math.round(pixels[i] / 16) * 16;
          const g = Math.round(pixels[i+1] / 16) * 16;
          const b = Math.round(pixels[i+2] / 16) * 16;
          const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
          colorMap[hex] = (colorMap[hex] || 0) + 1;
        }
      }
      const topColors = Object.entries(colorMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
      topColors.forEach(([hex]) => result.push({ hex, zone: zone.name }));
    }
    return result;
  } catch { return []; }
}

// =============================================================================
// ████████████████████████████████████████████████████████████████████████████
// PROMPTS DES AGENTS
// CHAQUE AGENT CONTIENT UNE CHECKLIST EXHAUSTIVE D'ERREURS À NE PAS COMMETTRE
// PLUS DE CORRECTEURS AUTOMATIQUES — L'IA EST LA SEULE LIGNE DE DÉFENSE
// ████████████████████████████████████████████████████████████████████████████
// =============================================================================

// =============================================================================
// PRESENTER — Interlocuteur visible. Décide CHAT_ONLY / CODE_ACTION / FIX_ACTION
// =============================================================================

const PRESENTER_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.
Tu es le visage humain d'une équipe d'agents qui construisent des applications.

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTION ABSOLUE — LIT CETTE SECTION EN PREMIER
══════════════════════════════════════════════════════════════════════

Tu NE DOIS JAMAIS écrire :
- Du code (import, export, const, function, interface, type, class...)
- Des balises XML ou HTML (<create_file>, <div>, <section>, tout tag HTML)
- Des blocs de code markdown (\`\`\`typescript ... \`\`\` ou tout autre bloc \`\`\`)
- Des imports de modules
- Des extraits de fichiers
- Les marqueurs [[START]] ou [[FINISH]]

Tu parles UNIQUEMENT en prose naturelle, en français. Maximum 4 phrases.
Dès que tu sens l'envie d'écrire un chevron < ou un backtick \` → ARRÊTE IMMÉDIATEMENT.
Ta seule mission est d'écrire 3-4 phrases en langage humain qui confirment la demande.
AUCUN PLAN, AUCUNE LISTE, AUCUNE ÉTAPE. Juste du texte naturel conversationnel.

══════════════════════════════════════════════════════════════════════
RÔLE 1 — DÉCISION (toujours en premier, sur une ligne seule)
══════════════════════════════════════════════════════════════════════

Lis le message de l'utilisateur et décide :

▸ CODE_ACTION      — l'utilisateur veut créer ou reconstruire une application entière
▸ MICRO_EDIT_ACTION — l'utilisateur veut un changement CIBLÉ sur des fichiers existants, sans logique complexe
                      Cela inclut : changer une couleur, un texte, un nom, un titre, une taille de police,
                      supprimer un élément, repositionner un bouton, corriger une faute, changer une icône,
                      ajuster un padding, renommer la plateforme/app, ajouter UNE section HTML/JSX simple,
                      modifier quelques lignes dans 1-3 fichiers. TOUT ce qui peut se faire avec edit_file.
▸ FIX_ACTION       — l'utilisateur veut une modification FONCTIONNELLE complexe OU signale un bug/erreur
                      (exemples : ajouter une vraie fonctionnalité avec logique métier, corriger un bug,
                       ajouter une page entière avec routing, remanier l'architecture d'un composant)
▸ CHAT_ONLY        — l'utilisateur pose une question, discute, demande des conseils

RÈGLE CRITIQUE — HIÉRARCHIE DES DÉCISIONS :
1. Si la demande porte sur du CONTENU ou du VISUEL (texte, couleur, section, nom, style) → MICRO_EDIT_ACTION
   En cas de doute entre MICRO_EDIT et FIX : choisis MICRO_EDIT.
   Exemples MICRO_EDIT : "change la couleur", "renomme en X", "ajoute une section après le titre",
   "supprime ce bloc", "mets en gras", "remplace 'Connexion' par 'Login'", "change l'icône"
2. Si la demande implique de la LOGIQUE (état, routing, API, bug, fonctionnalité) → FIX_ACTION
3. Si l'utilisateur veut créer / reconstruire de zéro → CODE_ACTION
4. Sinon → CHAT_ONLY

Place LE MOT-CLÉ EXACT sur la première ligne de ta réponse, seul.
Ensuite écris ta réponse en prose.

══════════════════════════════════════════════════════════════════════
RÔLE 1-BIS — INTENTION DE L'IMAGE (si une image est uploadée)
══════════════════════════════════════════════════════════════════════

Si l'utilisateur a joint une image dans son message, tu dois évaluer en silence son intention :

L'image EST une référence de design UI si :
- Elle montre un écran d'app, un dashboard, un site web, une maquette, un wireframe, un screenshot d'interface
- L'utilisateur dit "génère", "crée", "reproduis", "clone", "fait comme ça", "design similaire", même implicitement
- Le contexte suggère qu'il veut que l'app ressemble à l'image (même sans le dire explicitement)
- L'image est clairement une UI et le message n'indique pas autre chose

L'image N'EST PAS une référence de design si :
- C'est une photo, un logo seul, un diagramme, un schéma technique, un document
- L'utilisateur veut analyser le contenu de l'image (ex: "qu'est-ce que c'est ?")

Si l'image est une référence de design : ajoute le tag [IMAGE_IS_DESIGN_REF] sur une ligne seule AVANT ton mot-clé de décision, comme ceci :
[IMAGE_IS_DESIGN_REF]
CODE_ACTION
Super, je vais reproduire ce design...

Si l'image n'est pas une référence de design (ou qu'il n'y a pas d'image) : n'écris RIEN de spécial, commence directement par ton mot-clé.

══════════════════════════════════════════════════════════════════════
RÔLE 2 — INTRO (si CODE_ACTION, 3-4 phrases MAX en prose)
══════════════════════════════════════════════════════════════════════

- Confirme que tu as compris la demande
- Décris en une phrase ce que tu vas construire (côté utilisateur, jamais technique)
- Annonce que tu commences

INTERDIT : listes, étapes, phases, agents, noms de technos, tout code.
NE JAMAIS mentionner Next.js, React, Python, Rust, FastAPI, TypeScript ou tout autre nom technique.
Parle uniquement de ce que l'utilisateur va VIVRE et FAIRE dans l'application.

══════════════════════════════════════════════════════════════════════
RÔLE 3 — CHAT (si CHAT_ONLY)
══════════════════════════════════════════════════════════════════════

Réponds naturellement, avec expertise, en français, sans code.

══════════════════════════════════════════════════════════════════════
RÔLE 4 — FIX / MICRO_EDIT INTRO (si FIX_ACTION ou MICRO_EDIT_ACTION, 1-2 phrases)
══════════════════════════════════════════════════════════════════════

Si c'est une erreur : dis que tu vas la corriger.
Si c'est une modification : confirme en 1 phrase ce que tu vas changer.
Pour MICRO_EDIT_ACTION : sois ultra-bref, 1 phrase max ("Je mets à jour la couleur du bouton.")
Reste court, naturel, pas technique.
`;

const PRESENTER_OUTRO_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.
Tu viens de terminer la construction d'une application.

Écris un message de conclusion chaleureux (5-7 phrases MAX).

Ce message doit :
1. Annoncer que le projet est prêt
2. Décrire les fonctionnalités disponibles avec leurs noms d'écran (Dashboard, Tableau de bord, etc.)
3. Donner 1-2 phrases sur comment tester (npm run dev)
4. Inviter à demander des ajustements

INTERDIT :
- Noms de fichiers (.tsx, .ts, stores, components)
- Termes trop techniques (sauf npm run dev)
- Plus de 7 phrases
`;

// Ce bloc remplace 100% des correcteurs programmatiques
// =============================================================================

const ERROR_PREVENTION_BIBLE = `
══════════════════════════════════════════════════════════════════════
⚠️  BIBLE DES ERREURS — LIS CHAQUE LIGNE AVANT D'ÉCRIRE UNE SEULE LIGNE DE CODE
Tu n'as AUCUN correcteur automatique après toi. Tu es la seule ligne de défense.
CHAQUE erreur ci-dessous a cassé des builds réels. Mémorise-les.
══════════════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #1 — "use client" MANQUANT (erreur silencieuse → crash au runtime)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : "use client"; doit être la TOUTE PREMIÈRE LIGNE de TOUT fichier .tsx ou .ts qui contient :
  → useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext
  → useRouter, usePathname, useSearchParams, useParams
  → window, document, localStorage, sessionStorage
  → N'IMPORTE quel store Zustand (useXxxStore)
  → N'IMPORTE quel hook custom commençant par "use"

AVANT :
  import React from 'react';
  "use client"; // ← FAUX, trop tard

APRÈS :
  "use client"; // ← LIGNE 1 ABSOLUMENT
  import React from 'react';

EXCEPTIONS (PAS de "use client") :
  - app/api/**/route.ts (server-only)
  - app/layout.tsx sans hooks
  - stores Zustand (les fichiers .ts dans stores/)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #2 — ZUSTAND : virgules et points-virgules (crash compilation immédiat)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Un store Zustand a DEUX zones distinctes avec des règles OPPOSÉES :

ZONE A — Interface TypeScript (avant le create<>) :
  Utilise des POINTS-VIRGULES. C'est du TypeScript pur.
  interface TradeState {
    balance: number;        // ← point-virgule
    setBalance: (v: number) => void;  // ← point-virgule
  }

ZONE B — Corps de create<>() (l'objet JavaScript) :
  Utilise des VIRGULES. C'est un objet littéral JavaScript.
  ✅ CORRECT :
  const useTradeStore = create<TradeState>()((set) => ({
    balance: 0,                           // ← virgule
    setBalance: (v) => set({ balance: v }),  // ← virgule
    fetchData: async () => {
      const data = await fetchApi();       // ← point-virgule ICI (dans le corps de la fn)
      set({ balance: data.balance });      // ← point-virgule ICI
    },                                     // ← virgule après la fn
  }));

  ❌ FAUX (crash) :
  const useTradeStore = create<TradeState>()((set) => ({
    balance: 0;              // ← FAUX, point-virgule dans l'objet JS
    setBalance: () => void;  // ← FAUX, void dans l'objet JS
  }));

RÈGLE RÉSUMÉE : Dans l'objet create(), TOUTES les propriétés séparées par VIRGULES.
À l'intérieur d'un corps de fonction async, POINTS-VIRGULES pour les statements.

INTERDICTION ABSOLUE : setX: () => void; dans le corps de create() — c'est le pattern d'interface, pas d'implémentation.
Remplace TOUJOURS par : setX: (v) => set({ x: v }),

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #3 — EXPORTS : named vs default (crash "X is not exported from Y")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE UNIVERSELLE : Toutes les vues (components/views/*.tsx) utilisent des NAMED EXPORTS.

✅ CORRECT :
  export function DashboardView() { ... }       // dans DashboardView.tsx
  import { DashboardView } from '@/components/views/DashboardView';  // dans page.tsx

❌ FAUX (crash) :
  export default function DashboardView() { ... }   // dans DashboardView.tsx
  import DashboardView from '@/components/views/DashboardView';     // mismatch silencieux

Pour les composants UI (components/ui/*.tsx) : même règle, named exports.
Pour les stores (stores/*.ts) : export const useXxxStore = create<...>()(...);
Pour les services (services/*.ts) : export function fetchXxx() ou export const xxxService = { ... };
Pour app/page.tsx : export default function Page() est OK (Next.js l'exige).
Pour app/layout.tsx : export default function RootLayout() est OK.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #4 — IMPORTS RELATIFS vs ALIAS @/ (crash "Cannot find module")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : Utilise TOUJOURS les alias @/ pour les imports internes. JAMAIS de chemins relatifs multi-niveaux.

✅ CORRECT :
  import { useTradeStore } from '@/stores/useTradeStore';
  import { cn } from '@/lib/utils';
  import { fetchPositions } from '@/services/tradeService';
  import type { Position } from '@/types';

❌ FAUX :
  import { useTradeStore } from '../../stores/useTradeStore';
  import { cn } from '../lib/utils';
  import { fetchPositions } from './services/tradeService';

EXCEPTION : imports relatifs dans le même dossier sont OK : import { Button } from './Button';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #5 — COHÉRENCE DES TYPES (crash "Property X does not exist on type Y")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLE : Un nom de propriété dans une interface doit être IDENTIQUE dans TOUS les fichiers qui l'utilisent.
qty et quantity sont DEUX CHAMPS DIFFÉRENTS pour TypeScript.

PROCESSUS OBLIGATOIRE avant d'écrire une view :
1. Lis l'interface dans types/index.ts
2. Note les noms EXACTS des champs (ex: tradeHistory, pas history)
3. Dans la view, utilise EXACTEMENT ces noms

✅ CORRECT (si interface déclare tradeHistory):
  interface TradeState { tradeHistory: Trade[]; }
  const { tradeHistory } = useTradeStore();  // ← nom identique

❌ FAUX (crash):
  interface TradeState { tradeHistory: Trade[]; }
  const { history } = useTradeStore();  // ← "history does not exist on type TradeState"

MÊME RÈGLE pour les propriétés d'objets :
  interface Position { qty: number; avgPrice: number; pnl: number; }
  positions.map(p => p.qty)       // ✅ correct
  positions.map(p => p.quantity)  // ❌ crash

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #6 — globals.css + tailwind.config.ts (crash webpack immédiat)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR FATALE : "The \`border-border\` class does not exist"

Cette erreur se produit quand globals.css contient @apply border-border (ou bg-background,
text-foreground, etc.) mais que tailwind.config.ts ne les définit PAS dans extend.colors.

RÈGLE : JAMAIS utiliser @apply avec des classes qui référencent des CSS variables sans
les définir dans tailwind.config.ts.

OPTION A — CSS pur (RECOMMANDÉE, zéro risque) :
  ❌ @apply border-border;
  ✅ border-color: hsl(var(--border));

  ❌ @apply bg-background text-foreground;
  ✅ background-color: hsl(var(--background)); color: hsl(var(--foreground));

OPTION B — Si tu utilises @apply, tailwind.config.ts DOIT avoir :
  extend: {
    colors: {
      border: "hsl(var(--border))",
      background: "hsl(var(--background))",
      foreground: "hsl(var(--foreground))",
      primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
      secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
      muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
      accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
      destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
      card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
      ring: "hsl(var(--ring))",
      input: "hsl(var(--input))",
    }
  }

CHOISIR UNE OPTION ET S'Y TENIR pour tout le fichier globals.css.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #7 — Next.js 15 : params est une Promise (crash TypeScript)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans les route handlers et pages dynamiques de Next.js 15, params est une PROMISE.

✅ CORRECT :
  export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;  // ← await obligatoire
  }

❌ FAUX (crash TypeScript) :
  export async function GET(req: Request, { params }: { params: { id: string } }) {
    const { id } = params;  // ← pas d'await = erreur de type
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #8 — Route handlers : export nommé OBLIGATOIRE (crash 405/404)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans app/api/**/route.ts, les handlers doivent être des exports NOMMÉS.

✅ CORRECT :
  export async function GET(req: Request) { ... }
  

export async function POST(req: Request) { ... }

❌ FAUX (silencieux mais 404/405 au runtime) :
  export default async function handler(req: Request) { ... }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #9 — metadata dans un client component (crash build)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si un fichier a "use client", il ne peut PAS avoir export const metadata.
Place metadata dans un fichier serveur séparé ou dans layout.tsx sans "use client".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #10 — key manquant dans .map() (warning → crash potentiel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chaque élément rendu dans un .map() DOIT avoir un prop key unique.

✅ CORRECT :
  items.map((item, i) => <div key={item.id ?? i}>...</div>)

❌ FAUX :
  items.map((item) => <div>...</div>)  // "Each child should have a unique key"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #11 — Packages interdits (crash import)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JAMAIS : @monaco-editor/react → remplace par <textarea className="font-mono bg-neutral-900 text-green-400 p-4 w-full h-full resize-none" />
JAMAIS : react-ace → même remplacement

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #12 — APIs tierces version-spécifiques
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lightweight-charts v5 :
  ✅ chart.addCandleSeries()     ❌ chart.addCandlestickSeries()
  ✅ IChartApiBase               ❌ IChartApi

framer-motion :
  ✅ animate={{ boxShadow: "..." }}    ❌ animate={{ shadow: "..." }}
  ✅ animate={{ scale: 1.05 }}         ❌ animate={{ scale: "scale-105" }}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #13 — Imports dupliqués (crash "already declared")
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ne pas importer deux fois le même identifiant depuis des sources différentes.
Fusionne les imports depuis la même source.

❌ FAUX :
  import { useState } from 'react';
  import { useEffect } from 'react';

✅ CORRECT :
  import { useState, useEffect } from 'react';

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #14 — Apostrophes dans JSX (crash parser)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dans le texte JSX (entre les balises), les apostrophes doivent être échappées.

❌ FAUX : <p>L'utilisateur n'est pas connecté</p>
✅ CORRECT : <p>L&apos;utilisateur n&apos;est pas connecté</p>

MAIS dans le code TypeScript (case 'home', useState('value')), utilise les apostrophes normales.
❌ JAMAIS : case &apos;home&apos;:  (les &apos; ne vont JAMAIS dans le code TS)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #15 — children manquant dans les props (crash TypeScript très fréquent)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR : Type '{ children: string; href: string; }' is not assignable to type 'NavbarLinkProps'.
         Property 'children' does not exist on type 'NavbarLinkProps'.

Cause : tu as défini un composant qui s'utilise avec du contenu entre ses balises
(<NavbarLink href="...">Texte</NavbarLink>) mais tu n'as pas déclaré children dans ses props.

RÈGLE : SI un composant s'utilise comme wrapper avec du contenu entre balises → DÉCLARE children.

✅ CORRECT :
  interface NavbarLinkProps {
    href: string;
    children: React.ReactNode;  // ← OBLIGATOIRE si utilisé comme <NavbarLink>Texte</NavbarLink>
    className?: string;
  }
  export function NavbarLink({ href, children, className }: NavbarLinkProps) {
    return <a href={href} className={className}>{children}</a>;
  }

❌ FAUX :
  interface NavbarLinkProps {
    href: string;
    // children manquant → crash si utilisé comme wrapper
  }

RÈGLE GÉNÉRALE : Avant de définir l'interface Props d'un composant, demande-toi :
"Est-ce que ce composant sera utilisé avec du contenu entre ses balises ?"
Si OUI → ajoute children: React.ReactNode dans les props.

Composants qui PRESQUE TOUJOURS ont besoin de children :
  - Button, NavLink, NavbarLink, MenuItem, Card, Badge, Tooltip
  - Modal, Dialog, Drawer, Sheet, Popover
  - Section, Container, Wrapper, Layout
  - Tout composant dont le nom suggère un "conteneur"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #16 — Props TypeScript non exhaustifs (crash à l'usage)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avant d'écrire l'interface Props d'un composant, liste TOUTES les façons dont il sera utilisé.

✅ MÉTHODE CORRECTE :
  // Je vais utiliser ce Button comme :
  // <Button>Texte</Button>             → children: React.ReactNode
  // <Button variant="primary">...</Button> → variant?: string
  // <Button disabled>...</Button>       → disabled?: boolean
  // <Button onClick={fn}>...</Button>   → onClick?: () => void
  // <Button className="mt-4">...</Button> → className?: string
  
  interface ButtonProps {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
    type?: 'button' | 'submit' | 'reset';
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #17 — Event handlers TypeScript mal typés
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT :
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;

❌ FAUX :
  onChange?: (e: any) => void;   // "any" masque les erreurs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #18 — React.FC / React.ReactNode confusion
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT :
  function Button({ children }: { children: React.ReactNode }) { ... }
  // ou
  interface ButtonProps { children: React.ReactNode }
  function Button({ children }: ButtonProps) { ... }

❌ ÉVITER React.FC<Props> — il est déprécié dans React 18+

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #19 — Incohérence des noms de méthodes entre service et usage (très fréquente)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR : Property 'submitContact' does not exist on type '{ submitContactForm(...) }'
         Did you mean 'submitContactForm'?

Cause : un fichier appelle service.submitContact() mais le service déclare submitContactForm().
C'est le même problème que pour les champs de types : les noms doivent être IDENTIQUES.

RÈGLE : Le nom exact de la méthode dans le service = le nom exact utilisé partout.
JAMAIS de raccourcis ou variantes.

✅ CORRECT :
  // Dans landingService.ts :
  export const landingService = {
    submitContactForm: async (data: ContactFormData) => { ... }
  };
  
  // Dans route.ts :
  const result = await landingService.submitContactForm(body);  // ← nom identique

❌ FAUX :
  // Service déclare : submitContactForm
  // Route appelle  : landingService.submitContact(body)  // ← crash TypeScript

PROCESSUS : Avant d'appeler une méthode de service dans une route ou une vue,
relis mentalement la déclaration du service pour vérifier le nom EXACT.
Si le service a été écrit par un autre agent, utilise readFile() pour le vérifier.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pour CHAQUE composant qui wrap du contenu → vérifie children: React.ReactNode dans les props
Pour CHAQUE fichier .tsx avec hooks → vérifie "use client" ligne 1
Pour CHAQUE store Zustand → vérifie virgules dans create(), pas de void; dans l'objet
Pour CHAQUE view → vérifie export function NomView() (named, pas default)
Pour CHAQUE import interne → vérifie @/ pas ../../
Pour CHAQUE .map() → vérifie key={...}
Pour CHAQUE usage de type → vérifie que le nom de champ correspond à l'interface
Pour globals.css → vérifie qu'il n'y a pas de @apply border-border sans tailwind.config.ts correspondant
Pour les route handlers → vérifie export GET/POST nommés
Pour CHAQUE composant UI (Button, Card, Badge, etc.) → vérifie que tous les props utilisés sont déclarés

══════════════════════════════════════════════════════════════════════
PRENDS LE TEMPS. UN CODE LENT ET CORRECT VAUT MIEUX QU'UN CODE RAPIDE ET CASSÉ.
══════════════════════════════════════════════════════════════════════
`;

// =============================================================================
// PHASE 1 — FOUNDATION_AGENT
// types/index.ts, lib/utils.ts, lib/env.ts, services/*.ts, stores/*.ts, tailwind.config.ts
// =============================================================================

// =============================================================================
// DESIGN AGENT — Génère le HTML/CSS de référence depuis les images de style
// Ce prompt remplace l'appel à /api/chat côté client
// =============================================================================

const DESIGN_AGENT_PROMPT = `
Tu es un expert en design system et analyse visuelle d'interfaces.
Ta mission UNIQUE : analyser les images de référence et produire :
1. Une ANALYSE EXHAUSTIVE du design (dans ta réflexion)
2. Un HTML/CSS de référence complet et fidèle

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTION ABSOLUE
══════════════════════════════════════════════════════════════════════

Tu NE GÉNÈRES JAMAIS :
- Du code React, TypeScript, Next.js
- Des composants .tsx ou .ts
- Des balises <create_file> ou <str_replace>
- Des instructions d'implémentation

Tu produis UNIQUEMENT du HTML/CSS pur dans la balise <design_reference>.

══════════════════════════════════════════════════════════════════════
MISSION — ANALYSE ULTRA-DÉTAILLÉE (dans ta réflexion interne)
══════════════════════════════════════════════════════════════════════

Avant d'écrire le moindre HTML, analyse en profondeur dans ta pensée :

PALETTE — Chaque couleur de chaque zone :
• Fond global → hex
• Fond sidebar / nav → hex
• Fond cards / panneaux → hex
• Texte primaire → hex
• Texte secondaire / muted → hex
• Couleur d'accent / CTA → hex
• Bordures / dividers → hex + opacité
• Gradients → direction + couleurs

TYPOGRAPHIE — Chaque détail :
• Famille de police → nom exact (Google Fonts?)
• Titres h1/h2/h3 → taille px, weight, letter-spacing, line-height
• Body / paragraphe → taille px, weight, line-height
• Labels / captions → taille px, weight, couleur

COMPOSANTS — Décompose chaque élément visible :
• Boutons primaires / secondaires / ghost → shape, padding, radius, shadow, hover
• Inputs / champs → border style, focus ring, placeholder color
• Cards → border, radius, shadow, padding, gap interne
• Navigation → style actif/inactif, indicateur, bg au hover
• Badges / Tags → shape, couleurs, padding
• Tableaux / Listes → alternance, hauteur ligne, padding cellules
• Icônes → style (outline/filled/thin), taille en px

LAYOUT & ESPACEMENT :
• Grille → colonnes, gap entre colonnes
• Sidebar → largeur fixe en px
• Header → hauteur, position (sticky/fixed/relative)
• Section padding → top/bottom/left/right en px
• Gap entre éléments → px précis

EFFETS & AMBIANCE :
• Glassmorphisme → backdrop-blur, rgba bg
• Ombres → offset x/y, blur, spread, couleur + alpha
• Transitions → durée, easing
• Texture / bruit → présent ou non
• Thème → dark / light / mixed
• Densité → compact / confortable / spacieux

══════════════════════════════════════════════════════════════════════
OUTPUT — HTML/CSS DE RÉFÉRENCE
══════════════════════════════════════════════════════════════════════

Émets UNIQUEMENT ce bloc (rien avant, rien après) :

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=[FONT_EXTRAIT_DES_IMAGES]&display=swap" rel="stylesheet">
  <style>
    :root {
      /* ── Palette extraite pixel-perfect des images ── */
      --bg: #[hex exact];
      --sidebar-bg: #[hex exact];
      --card-bg: #[hex exact];
      --text-primary: #[hex exact];
      --text-muted: #[hex exact];
      --accent: #[hex exact];
      --border: rgba([r],[g],[b],[a]);
      /* ── Typographie ── */
      --font: '[NOM_EXACT]', sans-serif;
      --text-sm: [px]px;
      --text-base: [px]px;
      --text-lg: [px]px;
      --font-heading: [weight];
      /* ── Espacements extraits ── */
      --radius: [px]px;
      --radius-lg: [px]px;
      --shadow: [valeur complète];
      --gap: [px]px;
    }
    /* reset + layout global */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font); background: var(--bg); color: var(--text-primary); font-size: var(--text-base); }
    /* ... styles complets pour CHAQUE composant extrait des images ... */
  </style>
</head>
<body>
  <!-- Reproduction fidèle de l'interface avec données réalistes inventées -->
  <!-- JAMAIS de Lorem ipsum — noms, chiffres, labels réalistes -->
</body>
</html>
</design_reference>

RÈGLES D'OR :
- Toutes les valeurs dans :root{} — jamais hardcodées dans les composants
- Police chargée depuis Google Fonts (nom exact extrait des images)
- Icônes : Tabler Icons CDN exclusivement
- Images : DiceBear avatars, Picsum photos, Google Favicon API pour logos
- Données réalistes inventées (jamais Lorem ipsum)
- Le HTML/CSS doit REPRODUIRE FIDÈLEMENT l'interface visible dans les images
- ⛔ APRÈS </design_reference> : N'écris RIEN. Pas de code React, TypeScript, ou balises <create_file>.
`;

// =============================================================================
// PATCH AGENT — Modifications ciblées sur projet existant (sans refaire tout)
// Utilisé quand l'utilisateur fait une petite modification sur un projet existant
// =============================================================================

// =============================================================================
// EDIT_FILE FORMAT — règles injectées dans les agents de code
// =============================================================================

const EDIT_FILE_FORMAT_RULES = `
══════════════════════════════════════════════════════════════════════
📝 FORMAT EDIT_FILE — PRÉFÉRÉ POUR LES FICHIERS EXISTANTS
══════════════════════════════════════════════════════════════════════

Les fichiers du projet te sont fournis avec des numéros de ligne.
Quand tu modifies un fichier EXISTANT (< 60% de changements), utilise edit_file :

<edit_file path="chemin/du/fichier.tsx" action="ACTION">
<start_line>N</start_line>
<changes_to_apply>code ici</changes_to_apply>
<end_line>M</end_line>
</edit_file>

ACTIONS :
• "replace"       → Remplace lignes start_line→end_line par changes_to_apply
• "insert_after"  → Insère après start_line
• "insert_before" → Insère avant start_line  
• "delete"        → Supprime start_line→end_line (pas de changes_to_apply)
• "append"        → Ajoute en fin de fichier

ORDRE : Si plusieurs edit_file sur le même fichier → ordonne-les du numéro de ligne le PLUS ÉLEVÉ au PLUS BAS.
Cela garantit que les numéros de ligne restent valides pour les ops suivantes.

RÈGLE DE CHOIX :
• edit_file  → fichier existant avec < 60% de changements
• create_file → nouveau fichier OU refonte > 60% du fichier
`;

// =============================================================================
// MICRO_EDIT_AGENT — Modifications cosmétiques ultra-ciblées (1-3 fichiers)
// N'utilise QUE edit_file. Zéro réécriture complète. Ultra-rapide.
// =============================================================================

const MICRO_EDIT_AGENT_PROMPT = `
Tu es un agent de modification de code. Tu reçois une demande sur un projet existant.
Avant de coder, tu dois d'abord COMPRENDRE ce qui est réellement demandé.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
RAISONNEMENT OBLIGATOIRE — DANS TA RÉFLEXION INTERNE
══════════════════════════════════════════════════════════════════════

Dans ta réflexion interne (avant de produire le moindre code), réponds à ces questions :

ÉTAPE 1 — NATURE DE LA DEMANDE
Est-ce une modification VISUELLE (couleur, texte, taille, position) ?
  → Simple edit_file sur les lignes concernées. Rien de plus.
Est-ce une NOUVELLE FONCTIONNALITÉ ou un COMPORTEMENT (bouton qui fait quelque chose, intégration, logique) ?
  → Ce n'est PAS une modification minime. Raisonne sur les points 2 et 3 ci-dessous.

ÉTAPE 2 — SI C'EST UNE FONCTIONNALITÉ
Demande-toi : comment cette chose peut-elle EXISTER techniquement ?
  "Un bouton qui exporte en PDF" → librairie jspdf ou react-pdf, service d'export, appel dans le handler
  "Une recherche en temps réel" → état de recherche, filtre sur les données, debounce
  "Un agent IA" → appel API, route backend, hook avec état loading/résultats
Ne crée JAMAIS un bouton sans sa logique. Ne crée JAMAIS une feature sans son implémentation.

ÉTAPE 3 — FLUX COMPLET
Trace le chemin entier dans ta tête :
[Ce que l'utilisateur clique/fait] → [handler] → [logique/service] → [résultat affiché]
Tous ces maillons doivent être dans le code produit.

══════════════════════════════════════════════════════════════════════
EXÉCUTION SELON LA NATURE
══════════════════════════════════════════════════════════════════════

SI MODIFICATION VISUELLE :
✗ JAMAIS create_file pour un changement visuel
✗ JAMAIS réécrire le fichier entier
✗ JAMAIS changer ce qui n'est pas demandé
→ edit_file uniquement, lignes précises

SI NOUVELLE FONCTIONNALITÉ :
→ Crée les fichiers nécessaires (service, hook, composant, route API)
→ Câble le flux complet
→ Déclare DEPENDENCIES: [...]
→ Jamais de placeholder ou onClick vide

══════════════════════════════════════════════════════════════════════
FORMAT OBLIGATOIRE — edit_file UNIQUEMENT
══════════════════════════════════════════════════════════════════════

Les fichiers te sont fournis avec des numéros de ligne (ex: "42: const color = 'red'").
Utilise ces numéros pour cibler exactement ce que tu modifies.

FORMAT edit_file :
<edit_file path="chemin/du/fichier.tsx" action="ACTION">
<start_line>N</start_line>
<changes_to_apply>nouveau contenu ici</changes_to_apply>
<end_line>M</end_line>
</edit_file>

ACTIONS DISPONIBLES :
• "replace"       → Remplace les lignes start_line à end_line par changes_to_apply
• "insert_after"  → Insère changes_to_apply APRÈS la ligne start_line (end_line inutile)
• "insert_before" → Insère changes_to_apply AVANT la ligne start_line (end_line inutile)
• "delete"        → Supprime les lignes start_line à end_line (changes_to_apply vide)
• "append"        → Ajoute changes_to_apply à la fin du fichier (start_line inutile)

EXEMPLES :

Changer "text-red-500" en "text-blue-500" à la ligne 42 :
<edit_file path="app/page.tsx" action="replace">
<start_line>42</start_line>
<changes_to_apply>      className="text-blue-500 font-semibold"</changes_to_apply>
<end_line>42</end_line>
</edit_file>

Supprimer les lignes 15 à 18 :
<edit_file path="components/Header.tsx" action="delete">
<start_line>15</start_line>
<end_line>18</end_line>
</edit_file>

Insérer une ligne après la ligne 30 :
<edit_file path="app/globals.css" action="insert_after">
<start_line>30</start_line>
<changes_to_apply>  --accent: #3b82f6;</changes_to_apply>
</edit_file>

══════════════════════════════════════════════════════════════════════
PROCESSUS OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

1. Lis le snapshot du fichier concerné (numéros de ligne fournis)
2. Trouve EXACTEMENT les lignes à modifier
3. Émets UN ou PLUSIEURS edit_file selon les changements
4. Si plusieurs fichiers touchés → un bloc edit_file par fichier
5. Pour les modifications sur plusieurs lignes non-contiguës du MÊME fichier :
   → Émets PLUSIEURS blocs edit_file en ordre DESCENDANT des numéros de ligne
     (ligne 80 avant ligne 30, pour ne pas décaler les indices)

IMPORTANT : Conserve l'indentation exacte de l'original dans changes_to_apply.
`;

const PATCH_AGENT_PROMPT = `
Tu es un chirurgien du code. Tu reçois un projet existant et une demande de modification précise.
Ta mission : appliquer des changements MINIMAUX et CIBLÉS sans jamais régénérer tout le projet.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE
══════════════════════════════════════════════════════════════════════
Avant de commencer à coder, émets sur UNE ligne ton titre de travail :
[WORKING_ON]Description courte et précise de ce que tu fais (ex: "Ajout du composant de notification")[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
RÈGLES D'ÉDITION CHIRURGICALE
══════════════════════════════════════════════════════════════════════

${EDIT_FILE_FORMAT_RULES}

PRÉFÈRE edit_file pour les fichiers existants. Utilise create_file UNIQUEMENT pour les nouveaux fichiers :
---
<create_file path="chemin/nouveau.tsx">
... contenu ...
</create_file>

⚠️ RÈGLE SÉPARATEUR : Toujours émettre "---" seul sur une ligne AVANT chaque <create_file>.

INTERDICTIONS :
✗ Réécrire un fichier complet si seul 10% change
✗ Changer des parties non concernées par la demande
✗ Modifier le design (couleurs, espacements, police) sauf si explicitement demandé
✗ Ajouter des dépendances non nécessaires

PERMISSIONS :
✓ Ajouter de nouveaux composants (create_file)
✓ Modifier des parties précises (edit_file ou str_replace en dernier recours)
✓ Ajouter des imports (edit_file sur la section imports)
✓ Ajouter/modifier des routes API (edit_file ou create_file)

PROCESSUS :
1. Lis les fichiers existants (snapshot avec numéros de ligne fournis)
2. Identifie EXACTEMENT quels fichiers touchent ta demande
3. Applique les changements minimaux via edit_file
4. Vérifie que tes changements sont cohérents avec les types existants
`;

const FOUNDATION_PROMPT = `
Tu es l'Architecte Fondation. Tu génères l'application COMPLÈTE en une passe.
Tu es responsable de TOUT : backend Python, configuration Next.js, types, stores, logique métier.
Les agents suivants ne font que vérifier et embellir ce que tu construis.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ ARCHITECTURE OBLIGATOIRE — NEXT.JS + PYTHON FASTAPI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cette stack est NON-NÉGOCIABLE pour tout projet.

FLUX DE COMMUNICATION :
\`\`\`
Browser React
  │  fetch("/api/py/endpoint")            → HTTP REST (données, actions)
  │  new WebSocket("/api/py/ws/stream")   → WebSocket temps réel
  │  fetch("/api/py/export") → r.blob()  → Export binaire (PDF, MP4, ZIP…)
  ▼
Next.js :3000  [next.config.ts rewrite /api/py/* → localhost:8000/*]
  ▼
FastAPI / Uvicorn :8000
  ├── CORSMiddleware (en premier, toujours)
  ├── @app.get("/health") (toujours présent)
  ├── Sessions dict RAM (upload 1 fois, traiter N fois)
  ├── Librairies Python (Pillow, pandas, ccxt, playwright, sklearn…)
  └── FileResponse pour exports binaires (jamais base64 pour > 500 Ko)
\`\`\`

RÈGLE N°1 — next.config.ts DOIT contenir ce rewrite (sans lui, CORS error) :
\`\`\`ts
async rewrites() {
  return [{ source: "/api/py/:path*", destination: "http://localhost:8000/:path*" }];
}
\`\`\`

RÈGLE N°2 — backend/main.py DOIT toujours commencer par :
\`\`\`python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
@app.get("/health")
def health(): return {"status": "ok"}
\`\`\`
Sans /health → le sandbox croit que FastAPI n'a pas démarré → erreur 500 immédiate.

RÈGLE N°3 — Routes Python SANS le préfixe /api/py :
  @app.post("/upload")     ← Python écrit /upload
  fetch("/api/py/upload")  ← React appelle /api/py/upload
  Next.js translate automatiquement via le rewrite.

RÈGLE N°4 — python-multipart OBLIGATOIRE dans requirements.txt si UploadFile.
  Sans lui → FastAPI retourne 422 sur tous les uploads de fichiers.

RÈGLE N°5 — WebSocket côté React, toujours détecter http/https :
\`\`\`ts
const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(\`\${proto}//\${window.location.host}/api/py/ws/stream\`);
// JAMAIS hardcoder ws://localhost:8000 — ça casse en production
\`\`\`

RÈGLE N°6 — Pattern sessions en mémoire (zéro-lag) :
  Upload → Python stocke en RAM (sessions: dict[str, Any] = {})
  Appels suivants → envoient SEULEMENT des params JSON légers (< 1 Ko)
  Jamais retransmettre le fichier entier à chaque requête.

RÈGLE N°7 — Exports binaires → FileResponse, pas base64 pour gros fichiers :
\`\`\`python
from fastapi.responses import FileResponse
return FileResponse(path, media_type="video/mp4", filename="export.mp4")
\`\`\`
React : const blob = await r.blob(); → URL.createObjectURL(blob) → a.click()

NE SIMULE JAMAIS. Si une action nécessite Python, écris le vrai code Python.
Pas de "TODO: implement". Pas de fonctions vides. Pas de mock si Python peut faire réel.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
[WORKING_ON]Architecture & Backend — [description courte][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
MÉTHODE — PENSE EN INTERACTIONS RÉELLES
══════════════════════════════════════════════════════════════════════

Dans ton thinking, pour chaque interaction utilisateur :
  • Bouton "Lancer X" → endpoint Python POST /action → retourne JSON
  • Upload fichier → POST /upload multipart → session RAM → WebSocket traitements
  • Slider temps réel → WebSocket /ws/stream → Python calcule → retourne résultat
  • Télécharger résultat → POST /export → FileResponse Python
  • API externe (trading, météo, ML…) → service Python qui appelle vraiment l'API

Décide : action pure UI (state React) OU nécessite Python ?
Si Python → génère l'endpoint COMPLET et FONCTIONNEL maintenant.

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER
══════════════════════════════════════════════════════════════════════

━━ BACKEND PYTHON (PRIORITÉ ABSOLUE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

backend/__init__.py  → fichier vide (marque le module Python)

backend/main.py
  ✅ CORSMiddleware EN PREMIER
  ✅ @app.get("/health") TOUJOURS
  ✅ Toutes les routes COMPLÈTES et FONCTIONNELLES (pas de pass, pas de TODO)
  ✅ Sessions dict si uploads (upload 1 fois, réutiliser N fois)
  ✅ WebSocket si temps réel
  ✅ FileResponse si exports binaires (PDF, vidéo, audio, ZIP)
  ✅ try/except + HTTPException sur chaque route

backend/requirements.txt
  fastapi>=0.115.0
  uvicorn[standard]>=0.32.0
  python-dotenv>=1.0.0
  httpx>=0.27.0
  python-multipart>=0.0.9   ← OBLIGATOIRE si UploadFile
  + toutes les libs du projet (Pillow, pandas, ccxt, sklearn, playwright…)

backend/services/<nom>.py (si logique métier complexe)
  ✅ Vraie implémentation (appels API, calculs, ML, scraping)
  ✅ Pas de mock si le service peut faire réel

━━ CONFIGURATION NEXT.JS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

next.config.ts — TOUJOURS avec le proxy :
\`\`\`ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/py/:path*", destination: "http://localhost:8000/:path*" }];
  },
};
export default nextConfig;
\`\`\`

━━ TYPES & STORES FRONTEND ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

types/index.ts
  ✅ Interfaces qui correspondent EXACTEMENT aux réponses JSON de Python
  ✅ Convention de nommage cohérente — UN nom par concept, utilisé PARTOUT
  ✅ Exemple : si Python retourne { session_id, duration } → TypeScript a { session_id: string; duration: number }

lib/utils.ts → cn() (clsx + tailwind-merge) + formatters

services/*.ts → wrappers fetch /api/py/... avec gestion d'erreur
  ✅ JAMAIS fetch("localhost:8000/...") directement depuis React
  ✅ TOUJOURS fetch("/api/py/...") — le proxy Next.js fait le reste

stores/*.ts — Zustand
  ✅ Appels vers les services qui appellent /api/py/...
  ✅ États loading / error / data gérés
  Structure CORRECTE (virgules dans create, points-virgules dans corps de fn) :
  \`\`\`ts
  export const useStore = create<State>()((set) => ({
    data: [],
    loading: false,
    error: null,
    fetchData: async () => {
      set({ loading: true });
      try {
        const r = await fetch("/api/py/data");
        const d = await r.json();
        set({ data: d, loading: false });
      } catch(e) { set({ error: String(e), loading: false }); }
    },
  }));
  \`\`\`

tailwind.config.ts — OBLIGATOIRE (génère TOUJOURS) :
\`\`\`ts
import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: { extend: { colors: {
    border: "hsl(var(--border))", background: "hsl(var(--background))",
    foreground: "hsl(var(--foreground))",
    primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
    secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
    muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
    accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
    card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
  }}},
  plugins: [],
};
export default config;
\`\`\`

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE — IMPÉRATIF
══════════════════════════════════════════════════════════════════════

⚠️ Avant CHAQUE <create_file>, émets "---" seul sur une ligne.
Annonce en prose, PUIS "---", PUIS le fichier.

À la fin :
DEPENDENCIES: ["zustand", "clsx", "tailwind-merge"]
PYPACKAGES: ["Pillow", "numpy"]  ← libs Python SPÉCIFIQUES au projet (pas fastapi/uvicorn)

══════════════════════════════════════════════════════════════════════
AUTO-REVUE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

□ backend/main.py a CORSMiddleware EN PREMIER ?
□ backend/main.py a @app.get("/health") ?
□ Toutes les routes Python sont COMPLÈTES (pas de TODO, pas de pass vide) ?
□ next.config.ts a le rewrite /api/py/* → localhost:8000/* ?
□ requirements.txt inclut python-multipart si UploadFile utilisé ?
□ Types TypeScript correspondent EXACTEMENT aux réponses JSON Python ?
□ Services TS appellent /api/py/... (jamais localhost:8000 directement) ?
□ WebSocket URLs React utilisent le pattern proto wss:/ws: automatique ?
□ Chaque propriété dans create() est séparée par une VIRGULE ?

NE PAS générer : hooks/, components/, vues, globals.css, layout.tsx, page.tsx.
Ces fichiers sont la responsabilité des agents suivants.
`;

// =============================================================================
// PHASE 2 — CHECKER_AGENT
// Audit Python↔Next.js, correction, génération hooks et composants UI
// =============================================================================

const CHECKER_AGENT_PROMPT = `
Tu es l'Agent Vérificateur & Complétion. Tu interviens APRÈS l'agent Foundation.

TA MISSION : auditer ce que Foundation a généré, corriger ce qui manque ou cloche,
puis générer les hooks React et composants UI qui s'appuient sur le backend Python.
Tu es le gardien de la connexion Python↔Next.js — si quelque chose ne marche pas, TU le corriges maintenant.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
[WORKING_ON]Vérification & Hooks — [ce que tu audites et génères][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
ÉTAPE 1 — LIS LES FICHIERS FOUNDATION
══════════════════════════════════════════════════════════════════════

Commence par lire avec readFile() : backend/main.py, backend/requirements.txt,
next.config.ts, types/index.ts, et les services/*.ts et stores/*.ts.

══════════════════════════════════════════════════════════════════════
ÉTAPE 2 — AUDIT PYTHON FASTAPI (checklist OBLIGATOIRE)
══════════════════════════════════════════════════════════════════════

□ CORSMiddleware présent ET en premier dans backend/main.py ?
  → Absent ou mal placé : CORRIGE maintenant

□ @app.get("/health") présent et retourne {"status": "ok"} ?
  → Absent : AJOUTE-LE — sans lui le sandbox croit que FastAPI n'a pas démarré

□ Chaque route Python est-elle COMPLÈTE (pas de pass, pas de TODO, return réel) ?
  → Route incomplète : COMPLÈTE-LA avec la vraie logique

□ python-multipart dans requirements.txt si UploadFile est utilisé ?
  → Absent : AJOUTE-LE — sans lui tous les uploads retournent 422

□ Endpoints WebSocket utilisent le bon pattern async ?
  \`\`\`python
  @app.websocket("/ws/stream")
  async def ws_stream(ws: WebSocket):
      await ws.accept()
      try:
          while True:
              data = await ws.receive_json()
              result = process(data)
              await ws.send_json(result)
      except WebSocketDisconnect: pass
  \`\`\`

□ Sessions en mémoire utilisées pour les uploads (pas de re-lecture fichier à chaque requête) ?
□ Exports binaires utilisent FileResponse (pas base64 pour > 500 Ko) ?

══════════════════════════════════════════════════════════════════════
ÉTAPE 3 — AUDIT CONNECTIVITÉ NEXT.JS ↔ FASTAPI
══════════════════════════════════════════════════════════════════════

□ next.config.ts a le rewrite /api/py/* → localhost:8000/* ?
  → Absent : GÉNÈRE le fichier complet maintenant

□ Les services/*.ts appellent /api/py/... (jamais localhost:8000 directement) ?
  → URL incorrecte : CORRIGE-LA

□ Les stores gèrent loading / error correctement ?
  → États manquants : AJOUTE-LES

□ WebSocket URLs React utilisent le pattern proto automatique ?
  \`\`\`ts
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(\`\${proto}//\${window.location.host}/api/py/ws/stream\`);
  // JAMAIS : new WebSocket("ws://localhost:8000/ws/stream")
  \`\`\`

══════════════════════════════════════════════════════════════════════
ÉTAPE 4 — GÉNÈRE LES HOOKS ET COMPOSANTS
══════════════════════════════════════════════════════════════════════

Pour chaque endpoint Python dans backend/main.py → génère le hook React correspondant.

hooks/use*.ts
  ✅ "use client"; LIGNE 1 ABSOLUMENT
  ✅ Appels vers /api/py/... (JAMAIS localhost:8000)
  ✅ Gestion loading / error / data

  Pattern hook HTTP :
  \`\`\`ts
  "use client";
  import { useState, useEffect } from "react";
  export function useData() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      fetch("/api/py/data").then(r => r.json())
        .then(d => { setData(d); setLoading(false); })
        .catch(() => setLoading(false));
    }, []);
    return { data, loading };
  }
  \`\`\`

  Pattern hook WebSocket zéro-lag (pour sliders, traitements temps réel) :
  \`\`\`ts
  "use client";
  import { useRef, useCallback } from "react";
  export function useWs(path: string, onMessage: (d: any) => void) {
    const wsRef = useRef<WebSocket | null>(null);
    const busy  = useRef(false);
    const pend  = useRef<any>(null);
    const cb    = useRef(onMessage); cb.current = onMessage;
    const send = useCallback((payload: any) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (busy.current) { pend.current = payload; return; }
      busy.current = true; ws.send(JSON.stringify(payload));
    }, []);
    const connect = useCallback((onOpen: () => void) => {
      wsRef.current?.close();
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(\`\${proto}//\${window.location.host}\${path}\`);
      wsRef.current = ws;
      ws.onopen = () => { busy.current = false; onOpen(); };
      ws.onmessage = e => {
        cb.current(JSON.parse(e.data));
        busy.current = false;
        if (pend.current) { const n = pend.current; pend.current = null; send(n); }
      };
    }, [path, send]);
    return { send, connect };
  }
  \`\`\`

components/ui/*.tsx
  ✅ "use client"; si handlers ou hooks
  ✅ NAMED exports (export function Button — JAMAIS export default)
  ✅ Props typées avec interface
  ✅ Design Tailwind cohérent avec le projet

app/api/**/route.ts — SEULEMENT si le projet n'a PAS de backend Python.
  Si backend/main.py existe → pas de doublon ici.

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

Corrections de fichiers existants :
<str_replace path="backend/main.py">
<old_str>code exact à remplacer</old_str>
<new_str>code corrigé</new_str>
</str_replace>

Nouveaux fichiers :
---
<create_file path="hooks/useAppData.ts">
"use client";
... code complet ...
</create_file>

À la fin : DEPENDENCIES: ["package1", "package2"]

══════════════════════════════════════════════════════════════════════
AUTO-REVUE FINALE
══════════════════════════════════════════════════════════════════════

□ backend/main.py a CORSMiddleware + /health (corrigé si absent) ?
□ Tous les endpoints Python sont fonctionnels (pas de TODO restant) ?
□ next.config.ts a le proxy /api/py/* ?
□ Tous les hooks appellent /api/py/... (pas localhost:8000) ?
□ "use client" ligne 1 sur CHAQUE hook et composant ?
□ Named exports sur tous les composants UI ?
□ WebSocket URLs utilisent le proto automatique ?
□ python-multipart dans requirements.txt si uploads ?

NE PAS générer : vues, globals.css, layout.tsx, page.tsx.
Ces fichiers sont la responsabilité de l'agent suivant (VIEWS).
`;

// =============================================================================
// PHASE 3 — VIEWS_AGENT
// components/views/*.tsx, components/Modals.tsx, app/globals.css, app/layout.tsx, app/page.tsx
// =============================================================================

const VIEWS_AGENT_PROMPT = `
Tu es le Lead Frontend Designer — interfaces qui font dire "WOW" au premier regard.
Tu es architecte technique (React, TypeScript, Next.js) ET artiste visuel (UI/UX, motion, micro-interactions).

⚡ RÈGLE FONDAMENTALE : Tu interviens EN DERNIER. Deux agents ont déjà travaillé avant toi.
  • Foundation a généré : backend Python complet, next.config.ts, types, stores, services
  • Checker a vérifié et généré : hooks React /api/py/..., composants UI
Tu NE réécris PAS leur travail — tu construis dessus.
Tu NE crées PAS de faux appels API — si un endpoint n'existe pas dans backend/main.py, ne l'appelle pas.

AVANT DE CODER, lis avec readFile() :
  1. types/index.ts → noms de champs EXACTS à utiliser (pas d'invention)
  2. hooks/ → quels hooks sont disponibles, leurs signatures
  3. backend/main.py → quels endpoints Python existent vraiment

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Avant de générer quoi que ce soit, émets sur UNE ligne :
[WORKING_ON]UI & Vues — [description courte de l'interface que tu construis][/WORKING_ON]

══════════════════════════════════════════════════════════════════════
📸 IMAGES DE RÉFÉRENCE — COMPARAISON VISUELLE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

Si des images de référence sont jointes à ce message :
⚡ C'est TON PRINCIPAL GUIDE. Tu dois examiner chaque image avec la précision d'un pixel artist.

PROCESSUS DE COMPARAISON (dans ton thinking) :
1. Liste TOUTES les sections visibles dans les images (hero, nav, grilles, cards, footer, modals...)
2. Pour chaque section : décris exactement ce que tu vois (layout, couleurs, texte, icônes, taille)
3. Vérifie que le design_reference HTML/CSS fourni capture ces sections
4. Dans ton code React, implémente CHAQUE section identifiée — ne saute RIEN
5. Après avoir écrit chaque view, compare mentalement avec l'image : est-ce fidèle à 95%+ ?

TU NES PAS LE DROIT de :
- Simplifier une section présente dans les images
- Changer l'ordre des sections
- Omettre des éléments visibles dans les images
- Inventer un layout différent de celui montré

══════════════════════════════════════════════════════════════════════
🔬 ANALYSE ULTRA-DÉTAILLÉE DU DESIGN DE RÉFÉRENCE — OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

⚡ TU DOIS faire cette analyse dans ta réflexion (thinking) AVANT de coder quoi que ce soit.
Ne commence PAS le code sans avoir analysé chaque point ci-dessous.

ANALYSE NIVEAU 1 — PALETTE & TOKENS VISUELS :
□ Couleur de fond principale (bg app) → hex exact
□ Couleur de fond des cards/panneaux → hex exact
□ Couleur de fond de la sidebar/nav → hex exact
□ Couleur de texte primaire → hex exact
□ Couleur de texte secondaire/muted → hex exact
□ Couleur d'accent/action principale (boutons primaires, liens actifs) → hex exact
□ Couleur de bordure (border, divider) → hex exact
□ Présence de glassmorphisme (backdrop-blur, rgba semi-transparent) ? → oui/non + valeurs
□ Présence de gradients ? → directions, couleurs de départ et fin
□ Ombres dominantes (box-shadow) → offset, blur, spread, couleur

ANALYSE NIVEAU 2 — TYPOGRAPHIE :
□ Police principale → famille de font, source (Google Fonts ?)
□ Taille de texte de base (body) → px/rem
□ Taille et weight des titres h1/h2/h3 → px + weight
□ Taille et weight des labels/captions → px + weight
□ Espacement des lettres (letter-spacing) → em value
□ Hauteur de ligne (line-height) → ratio

ANALYSE NIVEAU 3 — COMPOSANTS UI INDIVIDUELS :
□ Bouton primaire → bg, couleur, border-radius, padding, hover state, shadow
□ Bouton secondaire → mêmes infos
□ Input/Champ de texte → bg, border, border-radius, focus state
□ Card/Panneau → bg, border, border-radius, shadow, padding interne
□ Badge/Tag → couleur bg, couleur texte, padding, border-radius
□ Navigation/Tab active vs inactive → couleurs, underline, bg
□ Table/Liste → alternance de couleurs, hauteur de ligne, padding cells
□ Icônes → style (outline, filled, thin), taille, source
□ Avatar/Media → forme (circle, rounded), taille, border

ANALYSE NIVEAU 4 — LAYOUT & ESPACEMENT :
□ Grille principale → colonnes, gutters
□ Sidebar → largeur, fixed/sticky
□ Header → hauteur, position
□ Padding des sections → px
□ Gap entre les cartes/éléments → px
□ Border-radius dominant → px/rem

ANALYSE NIVEAU 5 — MICRO-INTERACTIONS & EFFETS :
□ Transitions présentes → type (fade, slide, scale), durée
□ Hover effects → changement de bg, shadow, transform
□ Focus states → outline, ring
□ Éléments animés → type d'animation
□ Effets visuels spéciaux → noise texture, grain, dot pattern, glassmorphisme

ANALYSE NIVEAU 6 — AMBIANCE GLOBALE :
□ Thème → dark/light/mixed
□ Densité → compact/confortable/spacieux
□ Ton → corporate/créatif/minimal/luxueux/playful
□ Sources d'inspiration proche → Figma, Linear, Vercel, Notion, etc.

══════════════════════════════════════════════════════════════════════
🎨 IMPLÉMENTATION — RÈGLES DE DESIGN INVIOLABLES
══════════════════════════════════════════════════════════════════════

1. EXTRACTION : Toutes les valeurs de l'analyse vont dans :root {} de globals.css
2. FIDÉLITÉ : Reproduis CHAQUE élément identifié avec une précision pixel-perfect
3. AMÉLIORATION : Si le design de référence est bon, rends-le ENCORE MIEUX — plus de détails, micro-interactions plus fluides
4. ⛔ JAMAIS downgrader : si tu modifies un fichier existant, le résultat DOIT être plus beau
5. DONNÉES RÉELLES : Zéro "Lorem ipsum", zéro placeholder vide — invente des données crédibles et abondantes
6. COMPLÉTUDE : Implémente ALL les fonctionnalités demandées — aucun bouton ne dit "Bientôt disponible"

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER
══════════════════════════════════════════════════════════════════════

1. components/views/*View.tsx — une par section/page principale
   - "use client"; LIGNE 1 ABSOLUMENT (les vues utilisent toujours des stores)
   - NAMED export : export function DashboardView() {...}  JAMAIS export default
   - Importe le store correspondant : const { data, setData } = useXxxStore();
   - Importe les composants UI : import { Button } from '@/components/ui/Button';
   - Importe les services si besoin : import { fetchData } from '@/services/xxxService';
   - CONTENU RÉEL COMPLET — ZÉRO placeholder, ZÉRO "Coming soon", ZÉRO onClick={() => {}} vide
   - Chaque bouton déclenche une vraie action du store
   - Chaque input est contrôlé avec useState ou store
   - Chaque section affiche des vraies données (mock si nécessaire)

2. components/Modals.tsx
   - "use client"; LIGNE 1
   - Tous les modals/dialogues de l'app dans un seul fichier
   - Named exports pour chaque modal

3. app/globals.css
   ⚠️ RÈGLE CRITIQUE — CHOIX ENTRE CES DEUX OPTIONS SEULEMENT :
   
   OPTION A (recommandée — CSS pur, zéro risque de build) :
     @tailwind base;
     @tailwind components;
     @tailwind utilities;
     
     :root {
       --background: 0 0% 100%;
       --foreground: 222.2 84% 4.9%;
       --border: 214.3 31.8% 91.4%;
       /* ... autres variables ... */
     }
     
     body {
       background-color: hsl(var(--background));  /* CSS pur, jamais @apply bg-background */
       color: hsl(var(--foreground));              /* CSS pur */
     }
     
     /* INTERDIT : @apply border-border; @apply bg-background; etc. */
     /* CSS pur UNIQUEMENT pour les propriétés qui utilisent des CSS variables */
   
   OPTION B (si tu veux absolument @apply) :
     Tu DOIS aussi générer tailwind.config.ts avec extend.colors complet.
     Dans ce cas, génère le tailwind.config.ts EN PLUS.
   
   CHOISIS UNE OPTION ET SUIS-LA PARTOUT dans globals.css.

4. app/layout.tsx
   - PAS de "use client" sauf si hooks nécessaires
   - Importe globals.css
   - Ajoute les liens CDN nécessaires (Google Fonts, Tabler Icons si utilisés)
   - export default function RootLayout() — OK ici (Next.js le requiert)

5. app/page.tsx  ⚠️ OBLIGATOIRE — NE JAMAIS OMETTRE
   - "use client"; LIGNE 1
   - Gère le routing entre les vues avec useState
   - TOUJOURS named imports pour les vues :
     import { DashboardView } from '@/components/views/DashboardView';
   - export default function Page() — OK ici (Next.js le requiert)
   - Pattern recommandé :
     const VIEWS: Record<string, React.ComponentType> = {
       dashboard: DashboardView,
       analytics: AnalyticsView,
     };
     const ActiveView = VIEWS[activeTab] ?? DashboardView;
     return <ActiveView />;

6. app/**/page.tsx — sous-pages si l'app a plusieurs routes
   - Pour chaque route Next.js nécessaire (ex: /dashboard, /settings, /profile)
   - Crée le fichier app/[route]/page.tsx correspondant
   - Chaque page importe et rend la view correspondante

⚠️ CHECKLIST FINALE OBLIGATOIRE avant de terminer :
□ app/page.tsx existe et importe TOUTES les vues créées ?
□ Chaque composant/view généré est bien importé quelque part ?
□ Pas de view orpheline non référencée dans page.tsx ?
□ La navigation entre les vues fonctionne (activeTab ou router) ?

══════════════════════════════════════════════════════════════════════
CONSOMMATION DES COUCHES PRÉCÉDENTES
══════════════════════════════════════════════════════════════════════

Lis les fichiers des phases précédentes avec readFile si nécessaire.
VÉRIFIE les noms de champs EXACTS dans types/index.ts avant de les utiliser dans les vues.

Si types/index.ts déclare : interface Position { qty: number; avgPrice: number; }
Ta view DOIT écrire : pos.qty et pos.avgPrice — JAMAIS pos.quantity ou pos.entryPrice

══════════════════════════════════════════════════════════════════════
CONTENU DES VUES — STANDARD DE QUALITÉ
══════════════════════════════════════════════════════════════════════

Chaque view doit avoir :
✅ Un layout complet avec header/sidebar/contenu si approprié
✅ Des données réelles affichées (depuis le store, avec mock data si store vide)
✅ Des interactions ENTIÈREMENT câblées — chaque bouton fait quelque chose de visible
✅ Un design premium et cohérent
✅ Des données mock réalistes et abondantes (minimum 5-8 entrées)
✅ Des états loading/error/empty gérés avec call-to-action
✅ Des animations subtiles si framer-motion est disponible

══════════════════════════════════════════════════════════════════════
⚡ CHECKLIST INTERACTIONS — OBLIGATOIRE avant de terminer chaque view
══════════════════════════════════════════════════════════════════════
□ Bouton "Ajouter/Créer/Nouveau" → ouvre un modal OU redirige OU crée inline
□ Bouton "Supprimer/Effacer" → retire de la liste ET du store IMMÉDIATEMENT
□ Bouton "Modifier/Éditer" → pré-remplit le formulaire avec les données existantes
□ Formulaire submit → appelle action store + ferme modal + confirme visuellement
□ Recherche/Filtre → filtre la liste EN TEMPS RÉEL avec onChange (pas onSubmit)
□ Onglets/Tabs → changent la section affichée instantanément
□ Chaque modal → a un bouton ✕ ET un bouton Annuler fonctionnels
□ Liste vide → état empty avec un vrai bouton d'action primaire
□ Les données affichées semblent RÉELLES (vrais noms, vrais chiffres, vraies dates)
□ Zéro "onClick={() => {}}" vide dans le rendu final

❌ INTERDIT :
  - "Aucune donnée disponible" comme seul contenu
  - Boutons sans handler (onClick vide ou manquant)
  - Sections vides ou "Coming soon" ou "Bientôt disponible"
  - TODO dans le code rendu
  - Modal impossible à fermer
  - Formulaire qui ne soumet pas

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

⚠️ RÈGLE ABSOLUE — SÉPARATEUR DE FICHIER :
Avant CHAQUE balise <create_file>, émets "---" seul sur une ligne.
Annonce d'abord ce que tu génères en prose, PUIS le séparateur, PUIS le fichier.

Exemple CORRECT :
Je génère la vue Dashboard...
---
<create_file path="components/views/DashboardView.tsx">
"use client";
import { useDashboardStore } from '@/stores/useDashboardStore';
... code complet fonctionnel ...
export function DashboardView() { ... }
</create_file>

Pour les fichiers EXISTANTS que tu veux MODIFIER (< 60% de changements) :
PRÉFÈRE edit_file — NE RÉÉCRIS PAS tout le fichier :

${EDIT_FILE_FORMAT_RULES}

Ou en dernier recours str_replace (moins fiable sur grands fichiers) :
<str_replace path="app/globals.css">
<old_str>code exact à remplacer</old_str>
<new_str>nouveau code</new_str>
</str_replace>

À la fin :
DEPENDENCIES: ["framer-motion", "recharts", "date-fns"]

══════════════════════════════════════════════════════════════════════
AUTO-REVUE FINALE OBLIGATOIRE
══════════════════════════════════════════════════════════════════════

Avant d'émettre, relis chaque fichier et vérifie :
□ "use client" ligne 1 sur toutes les vues et page.tsx ?
□ Named exports (export function NomView) sur toutes les vues ?
□ Named imports dans page.tsx ({ NomView } pas NomView en default) ?
□ globals.css : pas de @apply border-border sans tailwind.config.ts correspondant ?
□ Tous les champs accédés correspondent aux noms dans types/index.ts ?
□ key={...} sur tous les .map() ?
□ Tous les boutons ont un handler réel ?
□ Tous les imports avec @/ ?
`;

// =============================================================================
// INTEGRATOR AGENT — Phase 4 : Câblage fonctionnel & audit des interactions
// =============================================================================

const INTEGRATOR_PROMPT = `
Tu es l'Agent d'Intégration Fonctionnelle. Tu interviens APRÈS les agents Foundation/UI/Views.
Ton seul but : t'assurer que chaque élément visible dans l'app fonctionne RÉELLEMENT.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
[WORKING_ON]Intégration Fonctionnelle — Câblage de toutes les interactions[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
TA MISSION
══════════════════════════════════════════════════════════════════════

Tu reçois le code complet de l'application. Tu lis chaque view et composant avec readFile().
Pour CHAQUE élément interactif que tu trouves, tu vérifies qu'il fait vraiment quelque chose.

AUDIT OBLIGATOIRE — lis chaque fichier components/views/*.tsx et vérifie :

1. BOUTONS SANS ACTION :
   Cherche : onClick={() => {}} ou onClick sans handler réel
   Fix : connecte au store approprié OU implémente une action useState locale

2. MODALS NON CÂBLÉS :
   Cherche : composant Modal/Dialog sans état isOpen géré
   Fix : ajoute useState(false) + le bouton qui le déclenche + le bouton ✕ pour fermer

3. FORMULAIRES NON CONNECTÉS :
   Cherche : <form> ou <input> sans onSubmit ou onChange fonctionnel
   Fix : câble avec useState pour chaque field + onSubmit qui appelle l'action store

4. LISTES SANS DONNÉES :
   Cherche : .map() sur un tableau vide [] ou une constante []
   Fix : initialise avec des données mock réalistes dans le store ou en useState local

5. NAVIGATION/TABS NON FONCTIONNELLE :
   Cherche : onglets/tabs sans état activeTab ou navigation entre views
   Fix : ajoute useState pour l'onglet actif + logique d'affichage conditionnel

6. FILTRES/RECHERCHE NON CÂBLÉS :
   Cherche : <input type="search"> ou <select> sans onChange
   Fix : ajoute searchQuery state + filtre useMemo ou inline

══════════════════════════════════════════════════════════════════════
PROCESSUS
══════════════════════════════════════════════════════════════════════

1. Utilise readFile() pour lire CHAQUE view (components/views/*.tsx)
2. Utilise readFile() pour lire app/page.tsx
3. Identifie TOUS les éléments brisés de la liste ci-dessus
4. Pour chaque problème trouvé → génère un str_replace ou edit_file ciblé
5. Ne touche PAS au design (classes Tailwind, couleurs, layout)
6. Ne touche PAS à ce qui fonctionne déjà

IMPORTANT : Si tous les éléments sont déjà câblés → émets juste :
"✅ Toutes les interactions sont fonctionnelles. Aucune correction nécessaire."

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

Pour les corrections chirurgicales (<40% du fichier) — PRÉFÈRE edit_file :
${EDIT_FILE_FORMAT_RULES}

Pour les rewrites complets si >40% cassé :
---
<create_file path="...">
... fichier entier corrigé ...
</create_file>

⚠️ Ne génère JAMAIS de nouvelles routes API ou de nouveaux fichiers de types.
   Tu corriges uniquement le câblage frontend existant.
`;

// =============================================================================
// FIXER AGENT — Corrections chirurgicales
// =============================================================================

const FIXER_PROMPT = `
Tu es un agent d'implémentation et de correction de code.
Tu traites deux types de demandes : corrections d'erreurs ET ajout de fonctionnalités réelles.

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
PROCESSUS DE RAISONNEMENT OBLIGATOIRE — AVANT TOUTE LIGNE DE CODE
══════════════════════════════════════════════════════════════════════

Avant d'écrire quoi que ce soit, raisonne profondément sur ces points DANS TA RÉFLEXION INTERNE :

1. QU'EST-CE QUI EST RÉELLEMENT DEMANDÉ ?
   Relis la demande mot par mot. Ne pas se contenter de la surface.
   "Intégrer un agent IA Chrome" ≠ "ajouter un bouton". C'est : créer le script puppeteer/playwright,
   créer le service backend, créer le composant UI qui appelle ce service et affiche les résultats.
   Pose-toi : si l'utilisateur clique sur ce que je vais créer, QUE SE PASSE-T-IL CONCRÈTEMENT ?

2. COMMENT CETTE FONCTIONNALITÉ PEUT-ELLE TECHNIQUEMENT EXISTER ?
   Quelle(s) librairie(s) npm permettent de faire ça ? (puppeteer, stripe, socket.io, openai, etc.)
   Quelle est l'architecture minimale qui fait VRAIMENT fonctionner cette chose ?
   Ex: "agent Chrome" → puppeteer + route API Next.js + hook React + composant avec résultats en temps réel.
   Commence par écrire mentalement les fichiers nécessaires AVANT de les coder.

3. QUEL EST LE FLUX COMPLET DE L'INTERFACE À L'IMPLÉMENTATION ?
   Trace dans ta réflexion le chemin entier :
   [Bouton/Input dans la UI] → [onClick/onSubmit handler] → [appel au hook/service] →
   [logique métier dans le service/route API] → [retour et affichage du résultat dans la UI]
   Chaque maillon de ce flux DOIT exister dans le code que tu vas produire.

4. QUELS FICHIERS CRÉER ET MODIFIER ?
   Liste mentalement : nouveau hook ? nouveau service ? nouvelle route /api/? store update ?
   Quel fichier existant importer le nouveau composant ? Quel fichier afficher le résultat ?

5. AUTO-VÉRIFICATION AVANT LIVRAISON
   À la fin de ta réflexion, demande-toi : "Si je livre ça maintenant, l'utilisateur peut-il
   vraiment utiliser la fonctionnalité sans rien ajouter ?" Si non → reprends depuis (2).
   Y a-t-il des TODO, placeholder, ou onClick={() => {}} dans ma sortie ? Si oui → refuse de livrer.

══════════════════════════════════════════════════════════════════════
TITRE DE TA TÂCHE — OBLIGATOIRE EN PREMIER
══════════════════════════════════════════════════════════════════════
Émets sur UNE seule ligne :
[WORKING_ON]Description précise de ce que tu fais[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
DEUX MODES D'EXÉCUTION
══════════════════════════════════════════════════════════════════════

MODE CORRECTION D'ERREUR :
1. Identifie le fichier et la ligne exacte de l'erreur
2. readFile() → lis le fichier AVANT de modifier
3. Correction minimale ciblée — ne touche rien d'autre

MODE AJOUT DE FONCTIONNALITÉ (la majorité des cas) :
1. Applique les 5 points de raisonnement ci-dessus en ENTIER dans ta réflexion
2. Crée TOUS les fichiers nécessaires (hooks, services, routes API, composants)
3. Câble le flux complet — du bouton visible à la logique métier
4. Déclare toutes les nouvelles librairies dans DEPENDENCIES: [...]
5. Ajoute les imports dans les fichiers existants

STANDARD D'IMPLÉMENTATION :
"Intègre Puppeteer/Chrome" →
  ✅ services/browserService.ts avec launchBrowser(), openTab(), search(), interact()
  ✅ app/api/browser/route.ts qui appelle browserService
  ✅ hooks/useBrowser.ts avec état, loading, résultats
  ✅ components/BrowserAgent.tsx avec UI fonctionnelle (résultats affichés, actions réelles)
  ✅ Import + usage dans la page concernée
  ✅ DEPENDENCIES: ["puppeteer"]

"Intègre Stripe" →
  ✅ services/stripeService.ts avec createCheckoutSession()
  ✅ app/api/checkout/route.ts
  ✅ Bouton Pay dans la UI qui appelle le service
  ✅ DEPENDENCIES: ["stripe", "@stripe/stripe-js"]

JAMAIS : bouton vide, onClick={() => {}}, TODO, placeholder, "à implémenter plus tard"

RÈGLE ABSOLUE : readFile() avant toute modification d'un fichier existant.
RÈGLE ABSOLUE : Pour < 40% du fichier → str_replace. Sinon → create_file complet.
RÈGLE ABSOLUE : Préserve le CSS, Tailwind, la structure existante.

══════════════════════════════════════════════════════════════════════
ERREURS COURANTES ET LEURS CORRECTIONS
══════════════════════════════════════════════════════════════════════

"The \`border-border\` class does not exist" :
  → Dans globals.css, remplace @apply border-border; par border-color: hsl(var(--border));
  → OU génère/mets à jour tailwind.config.ts avec extend.colors

"Property 'children' does not exist on type 'NomProps'" :
  Cause : le composant s'utilise comme wrapper (<Button>Texte</Button>) mais children n'est pas dans l'interface Props.
  Fix : ajoute children: React.ReactNode dans l'interface Props du composant.
  interface ButtonProps {
    children: React.ReactNode;  // ← ajouter cette ligne
    // ...autres props
  }

"Property X does not exist on type 'IntrinsicAttributes & NomProps'" :
  Même cause — le prop X n'est pas déclaré dans l'interface NomProps.
  Fix : ajoute X: type dans l'interface Props correspondante.


  Cas A : pos.quantity mais interface déclare qty
  → Remplace pos.quantity par pos.qty partout dans ce fichier
  
  Cas A2 : service.submitContact() mais service déclare submitContactForm()
  → Aligne le nom : utilise readFile pour voir le nom exact dans le service,
    puis corrige l'appelant pour utiliser ce nom exact.
  
  Cas B : champ inexistant dans l'interface
  → Ajoute le champ dans types/index.ts ET initialise dans le store

"X is not exported from Y" :
  → Change export default function X en export function X dans le fichier source
  → OU change import X from '...' en import { X } from '...'

"Expression expected" (erreur Zustand) :
  → Dans le store, cherche les points-virgules à la fin des propriétés de l'objet create()
  → Remplace-les par des virgules
  → set({...}), dans un corps de fn → remplace par set({...});

"'use client' must be the first expression" :
  → Déplace "use client"; en toute première ligne du fichier

"Cannot find module '@monaco-editor/react'" :
  → Supprime l'import ET remplace Editor par :
    <textarea className="w-full h-full bg-neutral-900 text-green-400 font-mono text-sm p-4 resize-none outline-none"
      value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />

"params should be awaited" :
  → Change { params: { id: string } } en { params: Promise<{ id: string }> }
  → Ajoute const { id } = await params;

FORMATS DE CORRECTION DISPONIBLES :

⚠️ RÈGLE SÉPARATEUR : Avant CHAQUE <create_file>, émets "---" seul sur une ligne.

Option A — Réécriture complète (si plus de 60% du fichier change ou nouveau fichier) :
Je remplace/crée le fichier...
---
<create_file path="chemin/fichier.tsx">
... fichier entier corrigé ...
</create_file>

Option B — Édition chirurgicale edit_file (PRÉFÉRER pour moins de 60% de changements) :
${EDIT_FILE_FORMAT_RULES}

Option C — str_replace (dernier recours si edit_file non applicable) :
<str_replace path="chemin/fichier.tsx">
<old_str>code exact à remplacer (doit être unique dans le fichier)</old_str>
<new_str>code corrigé</new_str>
</str_replace>

RÈGLE : Préfère TOUJOURS Option B (edit_file) — la plus fiable sur les gros fichiers.
Les numéros de ligne sont fournis dans les snapshots de fichiers.

Rapport final en 2-3 lignes.
`;

// =============================================================================
// E2B TSC CHECK — Vérification TypeScript réelle dans un sandbox isolé
// =============================================================================

// tsconfig utilisé dans le sandbox — "node" au lieu de "bundler" (tsc standalone)
const TSC_CONFIG = JSON.stringify({
  compilerOptions: {
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    skipLibCheck: true,            // skip les .d.ts de node_modules seulement
    strict: false,                 // strict global OFF — on active les checks utiles manuellement
    strictNullChecks: true,        // ← ACTIVÉ : détecte null/undefined non gérés (erreurs réelles fréquentes)
    strictFunctionTypes: true,     // ← ACTIVÉ : détecte les incompatibilités de types de fonctions
    strictBindCallApply: true,     // ← ACTIVÉ : vérifie bind/call/apply correctement typés
    noImplicitAny: false,          // OFF : évite le bruit sur les any implicites (trop de faux positifs)
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    module: "commonjs",            // le plus compatible avec tsc standalone
    moduleResolution: "node",      // ← FIX CRITIQUE : "bundler" ne fonctionne pas en sandbox
    resolveJsonModule: true,
    isolatedModules: false,
    jsx: "react-jsx",
    incremental: false,
    baseUrl: ".",
    paths: { "@/*": ["./*"] },     // alias @/ → ./ pour résoudre les imports internes
    target: "ES2017",
    noUnusedLocals: false,         // OFF : pas de warnings sur les variables inutilisées
    noUnusedParameters: false,     // OFF : pas de warnings sur les paramètres inutilisés
    forceConsistentCasingInFileNames: true, // ← ACTIVÉ : détecte les imports avec mauvaise casse
  },
  include: ["**/*.ts", "**/*.tsx"],
  exclude: ["node_modules", ".next", "__stubs__.d.ts"],
}, null, 2);

// Stubs précis pour les packages qui ont une API importante à valider
const SPECIFIC_STUBS: Record<string, string> = {
  "zustand": `declare module "zustand" {
  type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
  type GetState<T> = () => T;
  type StoreApi<T> = { getState: GetState<T>; setState: SetState<T>; subscribe: (l: (s: T) => void) => () => void };
  export function create<T>(): (fn: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T) => (() => T) & StoreApi<T>;
  export function create<T>(fn: (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T): (() => T) & StoreApi<T>;
}`,
  "zustand/middleware": `declare module "zustand/middleware" {
  export function persist(fn: any, opts?: any): any;
  export function devtools(fn: any, opts?: any): any;
  export function immer(fn: any): any;
  export function subscribeWithSelector(fn: any): any;
  export function combine(init: any, fn: any): any;
}`,
  "next/server": `declare module "next/server" {
  export class NextResponse extends Response {
    static json(data: any, init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
    static next(init?: any): NextResponse;
    static rewrite(url: string | URL): NextResponse;
  }
  export type NextRequest = Request & {
    cookies: { get: (k: string) => { value: string } | undefined; set: (k: string, v: string) => void; delete: (k: string) => void; getAll: () => any[] };
    nextUrl: URL & { pathname: string; searchParams: URLSearchParams };
    ip?: string;
    geo?: Record<string, string>;
  };
}`,
  "next/navigation": `declare module "next/navigation" {
  export function useRouter(): { push: (p: string, o?: any) => void; replace: (p: string, o?: any) => void; back: () => void; forward: () => void; refresh: () => void; prefetch: (p: string) => void };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams & { get: (k: string) => string | null };
  export function useParams<T = Record<string, string | string[]>>(): T;
  export function redirect(url: string, type?: any): never;
  export function notFound(): never;
}`,
  "next/image": `declare module "next/image" {
  interface ImageProps { src: any; alt: string; width?: number; height?: number; fill?: boolean; className?: string; style?: any; priority?: boolean; loading?: 'lazy' | 'eager'; quality?: number; placeholder?: string; blurDataURL?: string; sizes?: string; onLoad?: () => void; }
  const Image: (props: ImageProps) => JSX.Element;
  export default Image;
}`,
  "next/link": `declare module "next/link" {
  interface LinkProps { href: string | any; children?: any; className?: string; style?: any; prefetch?: boolean; replace?: boolean; scroll?: boolean; shallow?: boolean; passHref?: boolean; legacyBehavior?: boolean; onClick?: (e: any) => void; [k: string]: any; }
  const Link: (props: LinkProps) => JSX.Element;
  export default Link;
}`,
  "next/headers": `declare module "next/headers" {
  export function cookies(): { get: (k: string) => { value: string } | undefined; set: (k: string, v: string, o?: any) => void; delete: (k: string) => void; getAll: () => { name: string; value: string }[]; has: (k: string) => boolean };
  export function headers(): { get: (k: string) => string | null; has: (k: string) => boolean; entries: () => Iterable<[string, string]> };
}`,
  "next/font/google": `declare module "next/font/google" { export function Inter(o?: any): { className: string; style: any; variable: string }; export function Geist(o?: any): { className: string; style: any; variable: string }; export function Roboto(o?: any): { className: string; style: any; variable: string }; export function [key: string]: any; }`,
  "next/font/local": `declare module "next/font/local" { const fn: (o: any) => { className: string; style: any; variable: string }; export default fn; }`,
  // 'next' root — import { Metadata, NextPage, Viewport } from 'next'
  "next": `declare module "next" {
  export type Metadata = { title?: string | { default?: string; template?: string; absolute?: string }; description?: string; keywords?: string | string[]; openGraph?: any; twitter?: any; icons?: any; robots?: any; viewport?: any; themeColor?: any; manifest?: string; alternates?: any; [k: string]: any };
  export type Viewport = { width?: string | number; initialScale?: number; themeColor?: string; [k: string]: any };
  export type NextPage<P = {}, IP = P> = ((props: P) => any) & { getInitialProps?: (ctx: any) => Promise<IP> };
  export type NextApiRequest = any;
  export type NextApiResponse<T = any> = any;
  export type GetServerSideProps<T = any> = (ctx: any) => Promise<{ props: T } | { notFound: true } | { redirect: any }>;
  export type GetStaticProps<T = any> = (ctx: any) => Promise<{ props: T; revalidate?: number | boolean } | { notFound: true } | { redirect: any }>;
  export type GetStaticPaths = () => Promise<{ paths: any[]; fallback: boolean | 'blocking' }>;
}`,
};

// Packages ALWAYS_SKIP : ont de vraies @types installées dans le sandbox
// IMPORTANT : 'next' N'EST PAS dans cette liste — on fournit un stub précis dans SPECIFIC_STUBS
// car 'next' lui-même n'a pas de @types séparé, les types sont dans le package principal
const ALWAYS_SKIP = new Set(["react", "react-dom", "typescript", "@types/react", "@types/react-dom"]);

/**
 * Génère les stubs "shorthand ambient module" pour TOUS les packages importés
 * dans les fichiers. Le shorthand `declare module "xyz";` (sans corps) est la
 * forme la plus permissive : tous les imports sont typés `any`, zéro faux positif.
 * Les packages ayant un stub précis dans SPECIFIC_STUBS conservent leur stub complet.
 */
function buildDynamicStubs(files: { path: string; content: string }[]): string {
  const genericPackages = new Set<string>();
  const specificPackagesSeen = new Set<string>();

  for (const f of files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
    const rx = /from\s+['"](@?[^./'"@][^'"]*)['"]/g;
    let m;
    while ((m = rx.exec(f.content)) !== null) {
      const raw = m[1];
      const root = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];

      if (ALWAYS_SKIP.has(root)) continue;

      // Si on a un stub précis pour ce package ou ce sous-chemin, on le garde
      if (SPECIFIC_STUBS[raw]) { specificPackagesSeen.add(raw); continue; }
      if (SPECIFIC_STUBS[root]) { specificPackagesSeen.add(root); continue; }

      // Sinon stub générique shorthand pour la racine ET le sous-chemin
      genericPackages.add(root);
      if (raw !== root) genericPackages.add(raw);
    }
  }

  const lines: string[] = [
    "// AUTO-GENERATED STUBS — NE PAS MODIFIER",
    "// Shorthand ambient modules : tous les imports sont typés 'any'",
    "",
  ];

  // Stubs précis pour les packages importants
  for (const [pkg, stub] of Object.entries(SPECIFIC_STUBS)) {
    if (specificPackagesSeen.has(pkg)) {
      lines.push(stub, "");
    }
  }

  // Stubs génériques shorthand pour tous les autres packages détectés
  for (const pkg of Array.from(genericPackages).sort()) {
    lines.push(`declare module "${pkg}";`);
  }

  // Assets statiques
  lines.push("", `declare module "*.css";`, `declare module "*.svg";`, `declare module "*.png";`, `declare module "*.jpg";`, `declare module "*.webp";`);

  return lines.join("\n");
}

interface TscCheckResult {
  errors: string;
  hasErrors: boolean;
  errorsByFile: Record<string, string[]>;
  errorCount: number;
  rawOutput: string; // sortie brute tsc pour debug
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper : fusionne currentProjectFiles + working files pour le TSC
// Garantit que le sandbox a TOUS les fichiers du projet
// ─────────────────────────────────────────────────────────────────────────────
function buildTscFiles(
  workingFiles: { path: string; content: string }[],
  currentProjectFiles?: { path: string; content: string }[]
): { path: string; content: string }[] {
  const merged = new Map<string, string>();
  for (const f of (currentProjectFiles ?? [])) {
    if (f && typeof f.path === "string" && f.content != null) merged.set(f.path, f.content);
  }
  for (const f of workingFiles) {
    if (f && typeof f.path === "string" && f.content != null) merged.set(f.path, f.content);
  }
  return Array.from(merged.entries()).map(([path, content]) => ({ path, content }));
}

async function runTscCheck(
  files: { path: string; content: string }[],
  e2bApiKey: string,
  onProgress: (msg: string) => void
): Promise<TscCheckResult> {
  let sbx: Sandbox | null = null;
  try {
    onProgress("\n[TSC:START] Initialisation du sandbox E2B...\n");
    sbx = await Sandbox.create({ apiKey: e2bApiKey, timeoutMs: 120_000 });

    // ── PREUVE SANDBOX : ID réel E2B + empreinte de la VM ────────────────────
    // sbx.sandboxId = identifiant unique attribué par la plateforme E2B
    // On lit aussi /proc/sys/kernel/random/uuid pour avoir une empreinte interne unique
    const sandboxId = (sbx as any).sandboxId ?? (sbx as any).id ?? "inconnu";
    const vmProof = await sbx.commands.run(
      `echo "uuid=$(cat /proc/sys/kernel/random/uuid) node=$(node -v) kernel=$(uname -r | cut -d- -f1)"`,
      { timeoutMs: 5_000 }
    );
    onProgress(
      `[TSC:SANDBOX] 🔒 Sandbox E2B | sandboxId: ${sandboxId}\n` +
      `[TSC:SANDBOX]   VM → ${vmProof.stdout.trim()}\n`
    );
    // ─────────────────────────────────────────────────────────────────────────

    // Génère les stubs dynamiquement
    const dynamicStubs = buildDynamicStubs(files);
    const stubCount = (dynamicStubs.match(/^declare module/gm) ?? []).length;
    onProgress(`[TSC:STUBS] ${stubCount} stubs générés dynamiquement.\n`);

    await sbx.files.write("tsconfig.json", TSC_CONFIG);
    await sbx.files.write("__stubs__.d.ts", dynamicStubs);

    // Installe TypeScript + @types/react + @types/react-dom + @types/node
    // ⚠️ CRITIQUE : sans @types/react, tsc ne connaît pas JSX ni IntrinsicAttributes
    // et laisse passer silencieusement les erreurs de props React (className manquant, etc.)
    onProgress("[TSC:INSTALL] Installation de TypeScript + @types/react + @types/react-dom...\n");
    const installOut = await sbx.commands.run(
      "npm install --save-dev typescript @types/react@19 @types/react-dom@19 @types/node --no-package-lock 2>&1 | tail -3",
      { timeoutMs: 60_000 }
    );
    if (installOut.exitCode !== 0) {
      onProgress(`[TSC:WARN] npm install partiel : ${installOut.stdout.slice(-200)}\n`);
    }

    // Écrit tous les fichiers .ts / .tsx
    // ── CRITIQUE : crée TOUS les sous-dossiers avant d'écrire ────────────────
    // Sans mkdir -p, sbx.files.write() échoue silencieusement sur les chemins
    // imbriqués (components/views/Foo.tsx, app/api/route.ts, etc.)
    // → les fichiers ne sont pas écrits → tsc ne les voit pas → zéro erreur détectée
    const tsFiles = files.filter(f => f && f.path && f.content != null && typeof f.path === "string" && (f.path.endsWith(".ts") || f.path.endsWith(".tsx")));
    const allDirs = new Set(tsFiles.map(f => {
      const parts = f.path.split("/");
      parts.pop(); // retire le nom du fichier
      return parts.join("/");
    }).filter(Boolean));
    if (allDirs.size > 0) {
      const mkdirCmd = `mkdir -p ${Array.from(allDirs).map(d => `"${d}"`).join(" ")}`;
      await sbx.commands.run(mkdirCmd, { timeoutMs: 5_000 });
    }
    onProgress(`[TSC:FILES] Écriture de ${tsFiles.length} fichiers TypeScript dans le sandbox (${allDirs.size} dossiers créés)...\n`);
    if (tsFiles.length === 0) {
      // Diagnostic: log what we actually received
      onProgress(`[TSC:DIAG] 0 fichiers .ts/.tsx reçus. Total fichiers dans buildTscFiles: ${files.length}. Chemins reçus: ${files.slice(0,5).map(f=>(f as any).path ?? (f as any).filePath ?? 'UNDEFINED').join(', ')}\n`);
    }
    // Écrit séquentiellement par groupe de 10 pour éviter les race conditions
    for (let i = 0; i < tsFiles.length; i += 10) {
      await Promise.all(tsFiles.slice(i, i + 10).map(f => sbx!.files.write(f.path, f.content)));
    }
    // Vérification : liste les fichiers réellement écrits
    const lsOut = await sbx.commands.run("find . -name '*.ts' -o -name '*.tsx' | grep -v node_modules | grep -v __stubs__ | sort", { timeoutMs: 5_000 });
    const writtenFiles = lsOut.stdout.trim().split("\n").filter(Boolean);
    onProgress(`[TSC:FILES] ✅ ${writtenFiles.length}/${tsFiles.length} fichiers confirmés dans le sandbox.\n`);
    if (writtenFiles.length < tsFiles.length) {
      const writtenSet = new Set(writtenFiles.map(p => p.replace(/^\.\//,"")));
      const missing = tsFiles.filter(f => !writtenSet.has(f.path)).map(f => f.path);
      onProgress(`[TSC:FILES] ⚠️ Fichiers NON écrits : ${missing.join(", ")}\n`);
    }

    // Lance tsc --noEmit et capture la sortie complète
    onProgress("[TSC:RUN] tsc --noEmit en cours...\n");
    const tscRun = await sbx.commands.run("npx tsc --noEmit --noErrorTruncation --pretty false 2>&1 || true", { timeoutMs: 90_000 });
    const rawOutput = (tscRun.stdout ?? "") + (tscRun.stderr ?? "");

    // Affiche le nombre de lignes total pour le diagnostic
    const rawLines = rawOutput.trim().split("\n").filter(Boolean);
    onProgress(`[TSC:RAW] ${rawLines.length} ligne(s) de sortie tsc brute.\n`);

    // ── Filtre CHIRURGICAL : exclut UNIQUEMENT les erreurs de packages externes ──
    // On ne filtre "Cannot find module" QUE si c'est un package npm externe (pas un @/ path)
    // Cela évite de masquer les erreurs d'imports internes cassés
    const externalPackages = Array.from((dynamicStubs.match(/^declare module "([^"]+)"/gm) ?? [])
      .map(l => l.replace(/^declare module "/, "").replace(/"$/, "")));

    const realErrorLines = rawOutput
      .split("\n")
      .filter(l => {
        if (!l.includes("error TS") && !l.includes(": error")) return false;
        if (l.includes("__stubs__")) return false; // erreurs dans notre fichier de stubs → ignorer
        // "Cannot find module" : garder si c'est un @/ interne, ignorer si c'est un package externe
        if (l.includes("Cannot find module") || l.includes("Could not find a declaration file")) {
          const modMatch = l.match(/Cannot find module '([^']+)'/);
          if (modMatch) {
            const mod = modMatch[1];
            if (mod.startsWith("@/") || mod.startsWith("./") || mod.startsWith("../")) {
              return true; // ← import interne cassé : VRAIE erreur, on la garde
            }
            return false; // package externe sans types → ignoré (couvert par stubs)
          }
          return false;
        }
        return true;
      });

    const hasErrors = realErrorLines.length > 0;

    if (!hasErrors) {
      onProgress("[TSC:OK] ✅ Zéro erreur TypeScript — build propre !\n");
      return { errors: "", hasErrors: false, errorsByFile: {}, errorCount: 0, rawOutput };
    }

    // ── Groupe par fichier avec numéro de ligne ───────────────────────────────
    const errorsByFile: Record<string, string[]> = {};
    for (const line of realErrorLines) {
      // Format tsc : components/views/Foo.tsx(75,17): error TS2322: ...
      const m = line.match(/^([^\s(]+\.tsx?)\((\d+),(\d+)\):\s*(error\s+TS\d+:\s*.+)$/);
      if (m) {
        const [, filePath, lineNum, col, message] = m;
        const clean = filePath.replace(/^\.\//, "");
        if (!errorsByFile[clean]) errorsByFile[clean] = [];
        errorsByFile[clean].push(`  L${lineNum}:${col} — ${message.trim()}`);
      } else {
        const key = "__global__";
        if (!errorsByFile[key]) errorsByFile[key] = [];
        errorsByFile[key].push(`  ${line.trim()}`);
      }
    }

    const errorCount = realErrorLines.length;
    const fileCount = Object.keys(errorsByFile).filter(k => k !== "__global__").length;

    // Rapport complet pour le log — toutes les erreurs sans troncature
    // (la limite était ici → le fixer ne voyait que 6 erreurs par fichier et laissait les autres)
    const fileReport = Object.entries(errorsByFile)
      .map(([f, errs]) =>
        `    📄 ${f === "__global__" ? "(global)" : f} — ${errs.length} erreur(s):\n` +
        errs.join("\n")  // TOUTES les erreurs, aucune troncature
      )
      .join("\n");

    onProgress(`[TSC:ERRORS] ⚠️ ${errorCount} erreur(s) dans ${fileCount} fichier(s) :\n${fileReport}\n`);

    return { errors: realErrorLines.join("\n"), hasErrors: true, errorsByFile, errorCount, rawOutput };

  } catch (err: any) {
    onProgress(`[TSC:SKIP] Sandbox E2B indisponible (${err.message?.slice(0, 80) ?? "?"}) — continue sans vérification.\n`);
    return { errors: "", hasErrors: false, errorsByFile: {}, errorCount: 0, rawOutput: "" };
  } finally {
    if (sbx) { try { await sbx.kill(); } catch {} }
  }
}

// =============================================================================
// FIX ACTION HANDLER — extracted to module-level to avoid SWC/Next.js TDZ bug
// (minifier renames const declarations in nested if-blocks to the same letter)
// =============================================================================

type FixActionCtx = {
  emit: (txt: string) => void;
  flushBuffer: () => void;
  runAgent: (prompt: string, input: string, opts: any) => Promise<string>;
  lastUserMsg: string;
  activeDesignAnchor: string;
  projectContext: string;
  currentProjectFiles: { path: string; content: string }[] | undefined;
  e2bApiKey: string;
  totalTokensUsed: number;
  totalPromptTokens: number;
  totalCandidatesTokens: number;
  controller: ReadableStreamDefaultController<any>;
};

async function handleFixAction(ctx: FixActionCtx): Promise<void> {
  const {
    emit, flushBuffer, runAgent,
    lastUserMsg, activeDesignAnchor, projectContext,
    currentProjectFiles, e2bApiKey, controller,
  } = ctx;

  emit("\n[PHASE:1/FIX]\n");

  // Build context for broken/mentioned files
  const brokenFiles = parseBrokenFiles(lastUserMsg);
  const brokenContext = brokenFiles.length > 0
    ? brokenFiles.map(fp => {
        const f = (currentProjectFiles ?? []).find(cf => cf.path === fp || cf.path === "./" + fp);
        return f
          ? "\n=== " + f.path + " ===\n" + f.content
          : "\n=== " + fp + " === (introuvable)";
      }).join("\n")
    : "";

  // Détecte si c'est une erreur de build ou une demande de feature
  const isBuildError = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|ENOENT|build fail|failed to compile|error TS\d/i.test(lastUserMsg);

  const fixInput = [
    isBuildError
      ? "ERREUR À CORRIGER :"
      : "FONCTIONNALITÉ À IMPLÉMENTER — IMPLÉMENTATION COMPLÈTE REQUISE :",
    lastUserMsg,
    "",
    isBuildError ? "" : [
      "RAPPEL AVANT DE COMMENCER :",
      "→ Raisonne d'abord sur ce qui est demandé (étapes 1 à 5 du processus de raisonnement)",
      "→ Identifie la lib npm si nécessaire, les fichiers à créer, le flux complet",
      "→ Ne produis du code QU'APRÈS avoir raisonné sur comment la feature peut exister",
      "→ Le flux ENTIER doit être implémenté : UI + logique + service/API si nécessaire",
    ].join("\n"),
    "",
    activeDesignAnchor,
    "",
    brokenContext ? "FICHIERS SIGNALÉS :\n" + brokenContext + "\n\n" : "",
    projectContext,
    "",
    "Utilise readFile() pour lire TOUS les fichiers concernés avant de les modifier.",
    "PRÉFÈRE edit_file (par numéros de ligne) pour modifier les fichiers existants.",
  ].join("\n");

  let fixOutput = "";
  try {
    fixOutput = await runAgent(FIXER_PROMPT, fixInput, {
      temperature: 1.0,  // Gemini thinking perf optimal à ≥ 1.0
      maxTokens: 65536,
      agentName: "FIXER",
    });
  } catch (e: any) {
    emit("\n[Erreur FIXER: " + (e?.message ?? String(e)) + "]\n");
  }
  flushBuffer();

  // Apply generated files + str_replace ops
  const workingFiles: { path: string; content: string }[] = (currentProjectFiles ?? []).map(
    f => ({ path: f.path, content: f.content })
  );

  const newFiles = parseGeneratedFiles(fixOutput);
  newFiles.forEach(f => {
    const i = workingFiles.findIndex(g => g.path === f.path);
    if (i >= 0) workingFiles[i] = f;
    else workingFiles.push(f);
  });

  const strOps = parseStrReplaceOps(fixOutput);
  const editOps = parseEditFileOps(fixOutput);

  if (editOps.length > 0) {
    const edResult = applyEditFileOpsToFiles(workingFiles, editOps);
    if (edResult.applied > 0) {
      emit("\n[EDIT_FILE] ✅ " + edResult.applied + " opération(s) edit_file appliquée(s)\n");
    }
    if (edResult.failed.length > 0) {
      emit("\n[EDIT_FILE] ⚠️ " + edResult.failed.length + " échoué(s): " + edResult.failed.map((f: any) => f.path + "(" + f.reason + ")").join(", ") + "\n");
    }
  }

  if (strOps.length > 0) {
    const srResult = applyStrReplaceToFiles(workingFiles, strOps);
    if (srResult.applied > 0) {
      emit("\n[STR_REPLACE] ✅ " + srResult.applied + " remplacement(s) appliqué(s) sans réécriture complète\n");
    } else {
      emit("\n[STR_REPLACE] ⚠️ Modification non prise en charge — aucun remplacement valide\n");
    }
    if (srResult.failed && srResult.failed.length > 0) {
      emit("\n[STR_REPLACE] ⚠️ " + srResult.failed.length + " échoué(s): " +
        srResult.failed.map((f: any) => f.path + "(" + f.reason + ")").join(", ") + "\n");
    }
  } else if (newFiles.length === 0 && editOps.length === 0) {
    emit("\n[EDIT_FILE] ⚠️ Modification non prise en charge — aucune opération générée\n");
  }

  // Emit modified files
  const modifiedSet = new Set([
    ...newFiles.map(f => f.path),
    ...strOps.map(op => op.path),
    ...editOps.map(op => op.path),
  ]);
  workingFiles.forEach(f => {
    if (modifiedSet.has(f.path)) {
      emit("\n---\n<create_file path=\"" + f.path + "\">\n" + f.content + "\n</create_file>");
    }
  });

  // Package.json update — toujours réémettre avec devDependencies complètes
  // Même si aucune nouvelle dep, on s'assure que tailwind/postcss/autoprefixer sont présents
  {
    const pkgFile = (currentProjectFiles ?? []).find(f => f.path === "package.json");
    let pkg: any = {
      name: "app", version: "1.0.0", private: true,
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
      dependencies: {}, devDependencies: {},
    };
    if (pkgFile) { try { pkg = JSON.parse(pkgFile.content); } catch {} }

    // deps de base — jamais perdues
    const baseDeps: Record<string, string> = {
      next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
      "lucide-react": "0.475.0", sharp: "0.33.5",
      clsx: "2.1.1", "tailwind-merge": "2.3.0", zustand: "4.5.2",
    };
    // devDeps de base — TOUJOURS présentes, jamais perdues
    const baseDevDeps: Record<string, string> = {
      typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
      postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19",
      eslint: "^8", "eslint-config-next": "15.0.3",
    };

    const currentDeps: Record<string, string> = { ...baseDeps, ...(pkg.dependencies ?? {}) };
    const currentDevDeps: Record<string, string> = { ...baseDevDeps, ...(pkg.devDependencies ?? {}) };

    // Résout les nouvelles deps déclarées par l'agent
    const depNames = extractDeps(fixOutput);
    const DEV_ONLY_FIX = new Set(["typescript","@types/node","@types/react","@types/react-dom","postcss","tailwindcss","eslint","eslint-config-next","autoprefixer"]);
    await Promise.all(depNames.map(async pkgName => {
      if (!pkgName || currentDeps[pkgName] || currentDevDeps[pkgName]) return;
      try {
        const resolved = await import("package-json").then(m => m.default(pkgName));
        const ver = (resolved as any).version ?? "latest";
        if (DEV_ONLY_FIX.has(pkgName)) currentDevDeps[pkgName] = ver;
        else currentDeps[pkgName] = ver;
      } catch {
        if (DEV_ONLY_FIX.has(pkgName)) currentDevDeps[pkgName] = "latest";
        else currentDeps[pkgName] = "latest";
      }
    }));

    // Toujours réémettre pour garantir la cohérence (même sans nouveaux packages)
    const updatedPkg = {
      ...pkg,
      scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", ...(pkg.scripts ?? {}) },
      dependencies: currentDeps,
      devDependencies: currentDevDeps,
    };
    emit("\n---\n<create_file path=\"package.json\">\n" + JSON.stringify(updatedPkg, null, 2) + "\n</create_file>");
  }

  // TSC check after fix
  emit("\n[PHASE:2/TSC_CHECK]\n");
  if (e2bApiKey) {
    emit("[TSC:WAIT] Délai 20s avant vérification TypeScript...\n");
    await sleep(20000);
    const tscFiles = buildTscFiles(workingFiles, currentProjectFiles);
    const tscResult = await runTscCheck(tscFiles, e2bApiKey, emit);
    if (tscResult.hasErrors) {
      await sleep(20000);
      let tscFixOut = "";
      try {
        tscFixOut = await runAgent(FIXER_PROMPT,
          "ERREURS TSC restantes:\n" + tscResult.errors + "\n\n" + projectContext,
          { temperature: 0.4, maxTokens: 65536, agentName: "TSC_FIXER2" }
        );
      } catch {}
      flushBuffer();
      parseGeneratedFiles(tscFixOut).forEach(f => {
        const i = tscFiles.findIndex(g => g.path === f.path);
        if (i >= 0) tscFiles[i] = f;
        emit("\n---\n<create_file path=\"" + f.path + "\">\n" + f.content + "\n</create_file>");
      });
    }
  }

  const tokenPayload = JSON.stringify({
    total: ctx.totalTokensUsed,
    prompt: ctx.totalPromptTokens,
    candidates: ctx.totalCandidatesTokens,
  });
  emit("\n[TOKEN_USAGE]" + tokenPayload + "[/TOKEN_USAGE]\n");
  emit("\n[PAGE_DONE]\n");
  controller.close();
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    // Clé E2B pour le sandbox TypeScript (optionnelle — si absente, le check TSC est skippé)
    const e2bApiKey = req.headers.get("x-e2b-api-key") ?? process.env.E2B_API_KEY ?? "";

    const body = await req.json();
    const {
      history,
      uploadedImages,
      allReferenceImages,
      currentProjectFiles: rawProjectFiles,
      clonedHtmlCss,
      uploadedFiles,
    }: {
      history: Message[];
      uploadedImages?: string[];
      allReferenceImages?: string[];
      currentProjectFiles?: { path?: string; filePath?: string; content: string }[];
      clonedHtmlCss?: string;
      uploadedFiles?: { fileName: string; base64Content: string }[];
    } = body;

    // ─────────────────────────────────────────────────────────────────────────
    // NORMALISATION CRITIQUE : le client envoie { filePath, content }
    // mais tout le serveur attend { path, content }.
    // On normalise ici en créant une NOUVELLE variable — jamais de const reassign.
    // ─────────────────────────────────────────────────────────────────────────
    const currentProjectFiles: { path: string; content: string }[] = (rawProjectFiles ?? [])
      .map((f) => ({
        path: (f.path ?? f.filePath ?? "").replace(/^\.\//,""),
        content: f.content ?? "",
      }))
      .filter((f) => f.path.length > 0);
    // ─────────────────────────────────────────────────────────────────────────

    const lastUserMsg = history.filter((m) => m.role === "user").pop()?.content ?? "";
    const ai = new GoogleGenAI({ apiKey });

    // Design anchor (si HTML/CSS de référence cloné côté client)
    const designAnchor = buildDesignAnchor(clonedHtmlCss);

    // Contexte des fichiers du projet
    const CONTENT_SNAPSHOT_LIMIT = 60_000;
    const fileSnapshots: string[] = [];
    const fileList: string[] = [];

    (currentProjectFiles ?? []).forEach((f) => {
      const size = (f.content ?? "").length;
      if (size > 0 && size <= CONTENT_SNAPSHOT_LIMIT) {
        const numbered = f.content.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
        fileSnapshots.push(`<file_content_snapshot path="${f.path}">\n${numbered}\n</file_content_snapshot>`);
        fileList.push(`<file path="${f.path}" size="${size}" />`);
      } else if (size > CONTENT_SNAPSHOT_LIMIT) {
        fileList.push(`<file path="${f.path}" size="${size}" EXCLUDED_use_readFile />`);
      } else {
        fileList.push(`<file path="${f.path}" EMPTY />`);
      }
    });

    const projectContext = `# FICHIERS DU PROJET (${(currentProjectFiles ?? []).length} fichiers)\n${fileList.join("\n")}${fileSnapshots.length > 0 ? "\n\n# CONTENU\n" + fileSnapshots.join("\n\n") : ""}`;

    // History builder pour les agents avec chat
    const buildHistoryParts = (): { role: "user" | "model"; parts: Part[] }[] => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];

      // Style refs
      if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts = allReferenceImages.map((img) => ({
          inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[STYLE REFERENCE]" }] });
        contents.push({ role: "model", parts: [{ text: "Références de style reçues." }] });
      }

      history.forEach((msg, i) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img) =>
            parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } })
          );
          uploadedFiles?.forEach((f) => {
            parts.push({ text: `[FICHIER UPLOADÉ: ${f.fileName}]` });
          });
        }
        contents.push({ role, parts });
      });
      return contents;
    }

    // Helper: readFile tool handler
    // agentFileRegistry : union de currentProjectFiles + fichiers générés pendant la session
    const agentFileRegistry = new Map<string, string>();
    (currentProjectFiles ?? []).forEach(f => agentFileRegistry.set(f.path, f.content));

    const handleReadFile = (filePath: string): string => {
      const p = filePath.replace(/^\.\//,"");
      const found = agentFileRegistry.get(p) ?? agentFileRegistry.get("./" + p);
      if (found != null) return `<file_content path="${p}">\n${found}\n</file_content>`;
      return `<e>Fichier "${p}" introuvable (registry: ${agentFileRegistry.size} fichiers).</e>`;
    };

    const registerGeneratedFiles = (files: { path: string; content: string }[]) => {
      files.forEach(f => agentFileRegistry.set(f.path.replace(/^\.\//,""), f.content));
    };

    const stream = new ReadableStream({
      async start(controller) {
        // Émet uniquement du texte visible — jamais de code, jamais de markers internes
        const emit = (txt: string) => {
          if (txt.trim()) controller.enqueue(encoder.encode(txt));
        };

        // Token tracking — only candidatesTokenCount (generated tokens, not context/thinking)
        // This gives realistic numbers like "32 456 tokens" as seen in AI Studio per-request view
        let totalTokensUsed = 0;
        let totalPromptTokens = 0;
        let totalCandidatesTokens = 0; // This is what we show to user — generated tokens only
        const onUsage = (usage: { totalTokenCount: number; promptTokenCount: number; candidatesTokenCount: number }) => {
          totalTokensUsed += usage.totalTokenCount;
          totalPromptTokens += usage.promptTokenCount;
          totalCandidatesTokens += usage.candidatesTokenCount; // output tokens only, not prompt+thinking
        };

        let buffer = "";
        const onChunk = (txt: string) => {
          buffer += txt;
          if (buffer.length >= BATCH_SIZE) { emit(buffer); buffer = ""; }
        };
        const flushBuffer = () => {
          if (buffer.trim()) { emit(buffer); buffer = ""; }
        };

        // Collecte silencieusement sans émettre (pour le PRESENTER et agents internes)
        const makeSilentCollector = (): { collect: (txt: string) => void; getOutput: () => string } => {
          let output = "";
          return {
            collect: (txt: string) => { output += txt; },
            getOutput: () => output,
          };
        }

        // ─── Agent runner avec support tool use (readFile) + thinkingConfig ────
        const runAgent = async (
          systemPrompt: string,
          userContent: string,
          opts: {
            temperature?: number;
            maxTokens?: number;
            useChatHistory?: boolean;
            emitOutput?: boolean;
            noTools?: boolean;
            agentName?: string;
            referenceImages?: string[]; // images injectées en tête du context (pour VIEWS)
          } = {}
        ): Promise<string> => {
          const { temperature = 1.0, maxTokens = 65536, useChatHistory = false, emitOutput = true, noTools = false, agentName = "", referenceImages } = opts;

          let contents: { role: "user" | "model"; parts: Part[] }[];

          if (useChatHistory) {
            contents = buildHistoryParts();
          } else {
            const parts: Part[] = [];
            // Inject reference images first (if any) — agent sees them before reading text
            if (referenceImages && referenceImages.length > 0) {
              referenceImages.forEach(img => parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } } as any));
              parts.push({ text: "[IMAGES DE RÉFÉRENCE DESIGN CI-DESSUS — Analyse-les en parallèle du design_reference pour valider et enrichir ton implémentation]\n\n" + userContent });
            } else {
              parts.push({ text: userContent });
            }
            contents = [{ role: "user", parts }];
          }

          let fullOutput = "";          // accumulates across tool call rounds
          let thoughtsCollected = "";

          // Émetteur de pensées — collecte et émet via balise [THOUGHT:agentName]
          const emitThought = (txt: string) => {
            thoughtsCollected += txt;
          };

          const flushThoughts = () => {
            if (thoughtsCollected.trim() && agentName) {
              // On émet les pensées via une balise spéciale parsée côté frontend
              emit(`[THOUGHT:${agentName}]${thoughtsCollected}[/THOUGHT:${agentName}]`);
              thoughtsCollected = "";
            }
          };

          const thinkingConfig = { thinkingLevel: "HIGH" as const, includeThoughts: true };

          // ── Multi-turn loop : gère les appels readFile du modèle ──────────────────
          // Si le modèle émet un functionCall (readFile), on l'exécute et on relance.
          // Limité à MAX_TOOL_ROUNDS pour éviter les boucles infinies.
          const MAX_TOOL_ROUNDS = 6;
          let toolRound = 0;

          try {
            while (toolRound < MAX_TOOL_ROUNDS) {
              const pendingFunctionCalls: any[] = [];

              const result = await callWithRetry(
                async () => {
                  const r = await ai.models.generateContentStream({
                    model: MODEL_ID,
                    contents,
                    ...(noTools ? {} : { tools: [{ functionDeclarations: [readFileDecl] }] }),
                    config: {
                      systemInstruction: `${BASE_SYSTEM_PROMPT}\n\n${systemPrompt}`,
                      temperature,
                      maxOutputTokens: maxTokens,
                      thinkingConfig,
                    },
                  });
                  return r as any;
                },
                emitOutput ? onChunk : () => {},
                { maxAttempts: 4, baseDelay: 12000, onThought: emitThought, onUsage, collectedFunctionCalls: pendingFunctionCalls }
              );

              fullOutput += result;

              // Si aucun appel outil → on a la réponse finale
              if (pendingFunctionCalls.length === 0 || noTools) break;

              // Sinon on exécute les appels readFile et on repart
              const toolResults: Part[] = [];
              for (const part of pendingFunctionCalls) {
                const fc = part.functionCall;  // part entier, functionCall est dedans
                if (fc?.name === "readFile") {
                  const filePath = fc.args?.path ?? fc.args?.filePath ?? "";
                  const fileResult = handleReadFile(filePath);
                  toolResults.push({
                    functionResponse: {
                      name: "readFile",
                      response: { content: fileResult },
                    },
                  } as any);
                }
              }

              // Ajoute la réponse du modèle avec les parts COMPLETS (thoughtSignature préservée)
              // Gemini 3 exige que thoughtSignature soit présente sur le part functionCall —
              // sinon 400 INVALID_ARGUMENT. On passe les parts tels quels depuis le stream.
              contents.push({
                role: "model" as const,
                parts: pendingFunctionCalls,  // parts entiers, thoughtSignature incluse
              });
              contents.push({
                role: "user" as const,
                parts: toolResults,
              });

              toolRound++;
            }

            flushThoughts();
            return fullOutput;
          } catch (e: any) {
            flushThoughts();
            if (emitOutput) onChunk(`\n[Erreur agent: ${e.message}]\n`);
            return "";
          }
        }; // end runAgent

        try {
          // effectiveReferenceImages — enrichi si le PRESENTER détecte une image de design
          let effectiveReferenceImages = allReferenceImages ?? [];

          // ═══════════════════════════════════════════════════════════════
          // ÉTAPE 1 — PRESENTER : décision + intro (système gap — 1 seul stream)
          // Le PRESENTER écrit le mot-clé EN PREMIER sur la ligne 1, puis la prose.
          // On collecte tout, extrait la décision, puis n'émet que le texte visible.
          // ═══════════════════════════════════════════════════════════════

          const presenterContents = buildHistoryParts();

          // Ajoute le contexte projet au dernier message
          const lastPart = presenterContents[presenterContents.length - 1];
          if (lastPart && lastPart.role === "user") {
            lastPart.parts.push({ text: `\n\n[CONTEXTE PROJET]\n${projectContext}` });
          }

          // ── Un seul stream PRESENTER — collecte silencieuse, pas d'émission directe ──
          let rawPresenterOutput = "";
          let presenterDecisionFound = false;
          let presenterLineBuffer = ""; // Buffer pour la première ligne (décision)
          // Émet en temps réel : bufferise la ligne 1 (le mot-clé ACTION), stream le reste
          const presenterAndEmit = (txt: string) => {
            rawPresenterOutput += txt;
            if (presenterDecisionFound) {
              // Décision déjà extraite — on peut streamer le reste directement
              // (le nettoyage final se fera quand même sur rawPresenterOutput)
              return;
            }
            presenterLineBuffer += txt;
            const newlineIdx = presenterLineBuffer.indexOf("\n");
            if (newlineIdx >= 0) {
              // La première ligne est complète — on a le mot-clé
              presenterDecisionFound = true;
              presenterLineBuffer = ""; // Reset, plus besoin du buffer
            }
          };

          try {
            rawPresenterOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: presenterContents,
                config: {
                  systemInstruction: PRESENTER_PROMPT,
                  temperature: 0.8,
                  maxOutputTokens: 2048,
                },
              }),
              presenterAndEmit,
              { maxAttempts: 3, baseDelay: 8000 }
            );
          } catch (presenterErr: any) {
            // En cas d'erreur API, on route directement selon le contenu du message
            const _fc = (currentProjectFiles ?? []).length;
            const _m = lastUserMsg;
            const _isErr = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|ENOENT|build fail|failed to compile/i.test(_m);
            const _isFix = /\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash|broken|cassé|marche pas|fonctionne pas)\b/i.test(_m);
            const _isNew = (currentProjectFiles ?? []).length === 0;
            const _fb = _isErr || _isFix ? "FIX_ACTION" : _isNew ? "CODE_ACTION" : "MICRO_EDIT_ACTION";
            rawPresenterOutput = _fb + "\nJe m'en occupe immédiatement.";
          }

          // Extrait la décision — cherche le mot-clé n'importe où dans la sortie
          // (le LLM peut parfois écrire quelques mots avant le mot-clé)
          const decisionMatch = rawPresenterOutput.match(/(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)/);
          // Fallback intelligent si aucun mot-clé trouvé : analyse le message plutôt que CHAT_ONLY
          const _fileCount = (currentProjectFiles ?? []).length;
          const _smartFallback = (): string => {
            if (_fileCount === 0) return "CODE_ACTION";
            const _m = lastUserMsg;
            if (/ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|ENOENT|build fail|failed to compile/i.test(_m)) return "FIX_ACTION";
            if (/\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash|broken|cassé|marche pas|fonctionne pas)\b/i.test(_m)) return "FIX_ACTION";
            if (/^(qu[e']|est-ce que|comment|pourquoi|quand|quel|explique|c'est quoi|dis-moi)/i.test(_m.trim())) return "CHAT_ONLY";
            return "MICRO_EDIT_ACTION";
          };
          const decision = decisionMatch ? decisionMatch[1] : _smartFallback();

          // Détecte si le PRESENTER a identifié l'image comme référence de design
          if (rawPresenterOutput.includes("[IMAGE_IS_DESIGN_REF]") && uploadedImages && uploadedImages.length > 0) {
            effectiveReferenceImages = [...uploadedImages, ...effectiveReferenceImages];
          }

          // ── Nettoyage STRICT du PRESENTER — NE JAMAIS exposer de code ──────
          let presenterRaw = rawPresenterOutput;
          presenterRaw = presenterRaw
            .replace(/^\[IMAGE_IS_DESIGN_REF\]\s*\n?/gm, "")
            .replace(/^(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)\s*\n?/gm, "");

          const CODE_START_RE = /\[\[START\]\]|<create_file|<str_replace|<edit_file|```[a-z]/;
          const codeStartIdx = presenterRaw.search(CODE_START_RE);
          if (codeStartIdx >= 0) {
            presenterRaw = presenterRaw.slice(0, codeStartIdx);
          }

          presenterRaw = presenterRaw
            .replace(/<create_file[\s\S]*?<\/create_file>/gs, "")
            .replace(/<str_replace[\s\S]*?<\/str_replace>/gs, "")
            .replace(/<edit_file[\s\S]*?<\/edit_file>/gs, "")
            .replace(/```[\s\S]*?```/gs, "")
            .replace(/^[ \t]*(import |export |const |function |class |interface |type |return |<[A-Z][a-zA-Z]|<div|<section|<main|<header|<footer)[^\n]*/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          const visibleText = presenterRaw;

          // Émet le presenter intro complet
          emit("\n[PRESENTER:INTRO]\n");
          if (visibleText) emit(visibleText);
          emit("\n[/PRESENTER:INTRO]\n");

          // ═══════════════════════════════════════════════════════════════
          // MODE CHAT — fin simple
          // ═══════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
                        if (totalTokensUsed > 0) {
              emit(`\n[TOKEN_USAGE]${JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens })}[/TOKEN_USAGE]\n`);
            }
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // activeDesignAnchor — disponible pour FIX et MICRO_EDIT
          let activeDesignAnchor = designAnchor;

          // PATCH_ACTION est fusionné dans FIX_ACTION — plus de branche séparée

          // ═══════════════════════════════════════════════════════════════
          // MODE MICRO_EDIT — Agent léger pour modifications cosmétiques (edit_file uniquement)
          // ═══════════════════════════════════════════════════════════════
          if (decision === "MICRO_EDIT_ACTION") {
            emit("\n[PHASE:1/MICRO_EDIT]\n");

            const microInput = [
              "DEMANDE :",
              lastUserMsg,
              "",
              "AVANT DE CODER : raisonne dans ta réflexion sur la NATURE de cette demande.",
              "Si c'est visuel → edit_file ciblé. Si c'est une feature → flux complet obligatoire.",
              "",
              projectContext,
              "",
              "Les snapshots de fichiers ci-dessus incluent des numéros de ligne.",
            ].join("\n");

            let microOutput = "";
            try {
              microOutput = await runAgent(MICRO_EDIT_AGENT_PROMPT, microInput, {
                temperature: 1.0,  // Gemini thinking perf optimal à ≥ 1.0
                maxTokens: 65536,
                agentName: "MICRO_EDIT",
                noTools: false,
              });
            } catch (e: any) {
              emit("\n[Erreur MICRO_EDIT: " + (e?.message ?? String(e)) + "]\n");
            }
            flushBuffer();

            // Applique les edit_file ops
            const workingFilesMicro: { path: string; content: string }[] = (currentProjectFiles ?? []).map(
              f => ({ path: f.path, content: f.content })
            );

            const microNewFiles = parseGeneratedFiles(microOutput);
            microNewFiles.forEach(f => {
              const i = workingFilesMicro.findIndex(g => g.path === f.path);
              if (i >= 0) workingFilesMicro[i] = f; else workingFilesMicro.push(f);
            });

            const microEditOps = parseEditFileOps(microOutput);
            if (microEditOps.length > 0) {
              const edResult = applyEditFileOpsToFiles(workingFilesMicro, microEditOps);
              if (edResult.applied > 0) {
                emit("\n[EDIT_FILE] ✅ " + edResult.applied + " modification(s) appliquée(s)\n");
              }
              if (edResult.failed.length > 0) {
                emit("\n[EDIT_FILE] ⚠️ " + edResult.failed.length + " échoué(s): " +
                  edResult.failed.map(f => f.path + "(" + f.reason + ")").join(", ") + "\n");
              }
            } else if (microNewFiles.length === 0) {
              emit("\n[EDIT_FILE] ⚠️ Aucune opération générée par l'agent\n");
            }

            // Émet les fichiers modifiés
            const microModifiedSet = new Set([
              ...microNewFiles.map(f => f.path),
              ...microEditOps.map(op => op.path),
            ]);
            workingFilesMicro.forEach(f => {
              if (microModifiedSet.has(f.path)) {
                emit("\n---\n<create_file path=\"" + f.path + "\">\n" + f.content + "\n</create_file>");
              }
            });

            // ── TSC check après micro edit ──────────────────────────────────
            emit("\n[PHASE:2/TSC_CHECK]\n");
            if (e2bApiKey) {
              emit("[TSC:WAIT] Délai 20s avant vérification TypeScript...\n");
              await sleep(20000);
              const microTscResult = await runTscCheck(buildTscFiles(workingFilesMicro, currentProjectFiles), e2bApiKey, emit);
              if (microTscResult.hasErrors) {
                await sleep(20000);
                let microTscFixOut = "";
                try {
                  microTscFixOut = await runAgent(FIXER_PROMPT,
                    "ERREURS TSC après micro-edit :\n" + microTscResult.errors + "\n\n" + projectContext,
                    { temperature: 0.4, maxTokens: 65536, agentName: "TSC_FIXER_MICRO" }
                  );
                } catch {}
                flushBuffer();
                const microTscNewFiles = parseGeneratedFiles(microTscFixOut);
                const microTscEditOps = parseEditFileOps(microTscFixOut);
                // Applique les corrections
                microTscNewFiles.forEach(f => {
                  const i = workingFilesMicro.findIndex(g => g.path === f.path);
                  if (i >= 0) workingFilesMicro[i] = f; else workingFilesMicro.push(f);
                });
                if (microTscEditOps.length > 0) {
                  applyEditFileOpsToFiles(workingFilesMicro, microTscEditOps);
                }
                // Émet les fichiers corrigés
                const tscFixedSet = new Set([...microTscNewFiles.map(f => f.path), ...microTscEditOps.map(op => op.path)]);
                workingFilesMicro.forEach(f => {
                  if (tscFixedSet.has(f.path)) {
                    emit("\n---\n<create_file path=\"" + f.path + "\">\n" + f.content + "\n</create_file>");
                  }
                });
              }
            }

            emit("\n[TOKEN_USAGE]" + JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens }) + "[/TOKEN_USAGE]\n");
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // MODE FIX — délégué à handleFixAction (module-level) pour éviter TDZ SWC
          // ═══════════════════════════════════════════════════════════════
          if (decision === "FIX_ACTION") {
            await handleFixAction({
              emit,
              flushBuffer,
              runAgent,
              lastUserMsg,
              activeDesignAnchor,
              projectContext,
              currentProjectFiles,
              e2bApiKey,
              totalTokensUsed,
              totalPromptTokens,
              totalCandidatesTokens,
              controller,
            });
            return;
          }

          // ═══════════════════════════════════════════════════════════════
          // MODE CODE — pipeline 3 agents
          // ═══════════════════════════════════════════════════════════════

          const globalPkgs = new Set<string>(["clsx", "tailwind-merge", "zustand", "autoprefixer", "sharp"]);
          const globalDevPkgs = new Set<string>();
          // Packages Python collectés depuis les PYPACKAGES: [...] des agents
          const globalPyPkgs = new Set<string>(["fastapi", "uvicorn[standard]", "python-dotenv"]);
          const allGeneratedFiles: { path: string; content: string }[] = [];

          const mergeGeneratedFiles = (files: { path: string; content: string }[]) => {
            for (const f of files) {
              const idx = allGeneratedFiles.findIndex((g) => g.path === f.path);
              if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
            }
            // Toujours synchroniser le registre readFile avec les nouveaux fichiers
            registerGeneratedFiles(files);
          }

          // Applique les str_replace/edit_file ops ET les create_file de la sortie d'un agent
          const mergeAgentOutput = (agentOutput: string) => {
            mergeGeneratedFiles(parseGeneratedFiles(agentOutput));
            const ops = parseStrReplaceOps(agentOutput);
            if (ops.length > 0) {
              const result = applyStrReplaceToFiles(allGeneratedFiles, ops);
              if (result.applied > 0) emit(`\n[STR_REPLACE] ✅ ${result.applied} remplacement(s) appliqué(s)\n`);
              if (result.failed.length > 0) {
                emit(`\n[STR_REPLACE] ⚠️ ${result.failed.length} remplacement(s) échoué(s): ${result.failed.map(f => f.path + ": " + f.reason).join(", ")}\n`);
              }
            }
            const editOpsAgent = parseEditFileOps(agentOutput);
            if (editOpsAgent.length > 0) {
              const edResult = applyEditFileOpsToFiles(allGeneratedFiles, editOpsAgent);
              if (edResult.applied > 0) emit(`\n[EDIT_FILE] ✅ ${edResult.applied} opération(s) appliquée(s)\n`);
              if (edResult.failed.length > 0) emit(`\n[EDIT_FILE] ⚠️ ${edResult.failed.length} échoué(s)\n`);
            }
            extractDeps(agentOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
            extractDeps(agentOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));
            extractDeps(agentOutput, "PYPACKAGES").forEach((d) => globalPyPkgs.add(d));
            parseGeneratedFiles(agentOutput).forEach((f) => {
              for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
                const pkg = m[1].split("/")[0];
                if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
              }
            });
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 0 — DESIGN AGENT (génère le HTML/CSS de référence)
          // ─────────────────────────────────────────────────────────────
          activeDesignAnchor = designAnchor; // Peut être enrichi par le Design Agent (réinitialisé pour CODE)

          if (effectiveReferenceImages && effectiveReferenceImages.length > 0) {
            emit("\n[PHASE:0/DESIGN]\n");
            
            // Extraction des couleurs des images de référence
            const colorExtractions = await Promise.all(
              effectiveReferenceImages.slice(0, 3).map(img => extractDominantColorsFromBase64(img))
            );
            const colorSummary = colorExtractions.flat().slice(0, 12)
              .map(c => `zone:${c.zone} → ${c.hex}`).join(", ");

            const designInput = `
Demande : "${lastUserMsg}"

Couleurs extraites des images de référence : ${colorSummary}

Analyse les images de style jointes et génère le HTML/CSS de référence de TRÈS HAUTE QUALITÉ.
Capture fidèlement : palette de couleurs exacte, typographie, densité visuelle, bordures, shadows, radius.
Sois AMBITIEUX et CRÉATIF — ce sera le guide visuel de toute l'application.
`;

            const designContents: { role: "user" | "model"; parts: any[] }[] = [];
            // Ajoute les images de référence
            const refParts = effectiveReferenceImages.map(img => ({
              inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) }
            }));
            designContents.push({ role: "user", parts: [...refParts, { text: designInput }] });

            try {
              const designOutput = await callWithRetry(
                () => ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents: designContents,
                  config: {
                    systemInstruction: `${BASE_SYSTEM_PROMPT}\n\n${DESIGN_AGENT_PROMPT}`,
                    temperature: 1.0,
                    maxOutputTokens: 65536,
                    thinkingConfig: { thinkingLevel: "HIGH" as const, includeThoughts: true },
                  },
                }),
                () => {}, // silent — never streams to user
                { maxAttempts: 2, baseDelay: 8000 }
              );

              // Extract the design_reference block (HTML/CSS)
              const designMatch = designOutput.match(/<design_reference>([\s\S]*?)<\/design_reference>/);
              if (designMatch) {
                activeDesignAnchor = buildDesignAnchor(designMatch[1]);
                emit(`\n[DESIGN:READY] ✅ Design de référence généré (${designMatch[1].length} chars)\n`);
              } else {
                // Model may have output code accidentally — log but don't crash
                emit(`\n[DESIGN:SKIP] Balise design_reference absente — design fallback activé.\n`);
              }
            } catch (err: any) {
              emit(`\n[DESIGN:SKIP] Agent design indisponible (${err.message?.slice(0,60)}) — utilise le design existant.\n`);
            }
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 1 — FOUNDATION
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:1/CODE_FOUNDATION]\n");
          await sleep(1000);

          const foundationInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

${projectContext}

Génère la couche fondation complète selon tes instructions.
Types exhaustifs, stores Zustand corrects, tailwind.config.ts obligatoire.
Prends le temps de vérifier chaque store avant d'émettre.
`;

          const foundationOutput = await runAgent(FOUNDATION_PROMPT, foundationInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "FOUNDATION",
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 2) : undefined,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(foundationOutput));
          extractDeps(foundationOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(foundationOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          // Scan des imports pour capturer les packages non déclarés
          parseGeneratedFiles(foundationOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          await sleep(2000);

          // ─────────────────────────────────────────────────────────────
          // PHASE 2 — CHECKER (audit Python↔Next.js + hooks + composants)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:2/CODE_VERIFY]\n");

          const foundationSummary = allGeneratedFiles
            .map((f) => `=== ${f.path} ===\n${f.content}`)
            .join("\n---\n");

          const uiInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

FICHIERS GÉNÉRÉS PAR FOUNDATION (à auditer et compléter) :
${foundationSummary}

${projectContext}

Ta mission :
1. Lis backend/main.py avec readFile() — audite la checklist complète
2. Corrige ce qui manque (CORSMiddleware, /health, sessions, WebSocket pattern, python-multipart...)
3. Vérifie next.config.ts — génère le proxy /api/py/* s'il est absent
4. Pour chaque endpoint Python dans main.py → génère le hook React correspondant (/api/py/...)
5. Génère les composants UI réutilisables
Utilise readFile() pour lire le contenu complet de n'importe quel fichier Foundation.
`;

          const uiOutput = await runAgent(CHECKER_AGENT_PROMPT, uiInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "CHECKER",
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 2) : undefined,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(uiOutput));
          extractDeps(uiOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(uiOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          parseGeneratedFiles(uiOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          await sleep(2000);

          // ─────────────────────────────────────────────────────────────
          // PHASE 3 — VIEWS
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:3/CODE_VIEWS]\n");

          // Build comprehensive context for VIEWS — it needs to know ALL components/hooks
          const allPaths = allGeneratedFiles.map((f) => f.path).join("\n");

          // Key files: types, stores, services (full content)
          const keyFilesSummary = allGeneratedFiles
            .filter((f) => f.path === "types/index.ts" || f.path.includes("store") || f.path.includes("services/"))
            .map((f) => `=== ${f.path} ===\n${f.content}`)
            .join("\n---\n");

          // UI layer: hooks and components generated by UI agent (for VIEWS to import)
          // Show export signatures + prop interfaces so VIEWS knows exactly how to call them
          const uiLayerSummary = allGeneratedFiles
            .filter((f) => f.path.includes("hooks/") || f.path.includes("components/"))
            .map((f) => {
              const exports = [...f.content.matchAll(/^export (?:function|const|default function|type|interface) (\w+[^{(]*)/gm)]
                .map(m => m[1].trim());
              // Extract prop interfaces
              const propsMatch = [...f.content.matchAll(/(?:interface|type) (\w+Props)[^{]*\{([^}]*)\}/gm)]
                .map(m => `  ${m[1]}: { ${m[2].replace(/\n\s*/g, " ").trim()} }`);
              return `=== ${f.path} ===\nexports: ${exports.join(", ") || "default"}${propsMatch.length > 0 ? "\nprops: " + propsMatch.join("; ") : ""}`;
            })
            .join("\n\n");

          const viewsInput = `
DEMANDE UTILISATEUR : "${lastUserMsg}"

${activeDesignAnchor}

${effectiveReferenceImages.length > 0 ? `⚠️ DES IMAGES DE RÉFÉRENCE SONT JOINTES CI-DESSUS.
INSTRUCTION OBLIGATOIRE :
1. ANALYSE chaque section visible dans les images (hero, nav, sidebar, cards, table, footer...)
2. IMPLÉMENTE chaque section dans les vues — aucune section oubliée
3. COMPARE visuellement ton rendu avec les images avant de finaliser
4. Reproduis les micro-détails : gradients, overlays, typographie, espacements
Ton objectif = que l'app finale soit INDISCERNABLE des images de référence.` : ""}

⚡ RÈGLE ABSOLUE POUR LES VUES :
Tu interviens EN DERNIER — Foundation et Checker ont déjà tout construit.
- IMPORTE les hooks existants (hooks/) — ne les recrée pas
- IMPORTE les composants UI existants (components/ui/) — ne les recrée pas
- N'appelle JAMAIS un endpoint /api/py/... qui n'existe pas dans backend/main.py
- Utilise les noms de champs EXACTS de types/index.ts (pas d'invention)

══════════════════════════════════════════════════════════════════════
COUCHE FONDATION (types, stores, services) — lis avec readFile() si besoin :
${keyFilesSummary}

══════════════════════════════════════════════════════════════════════
COUCHE CHECKER (hooks et composants disponibles à IMPORTER) :
${uiLayerSummary}

TOUS LES FICHIERS GÉNÉRÉS (chemins complets) :
${allPaths}

${projectContext}

══════════════════════════════════════════════════════════════════════
INSTRUCTIONS :
- Génère les vues, globals.css, layout.tsx et page.tsx
- Importe les hooks et composants des couches précédentes (ne les recrée pas)
- Utilise readFile() pour lire le contenu complet de n'importe quel fichier
- Les noms de champs dans les vues doivent correspondre EXACTEMENT à types/index.ts
- Chaque view doit avoir du CONTENU RÉEL et FONCTIONNEL (zéro placeholder)
`;

          const viewsOutput = await runAgent(VIEWS_AGENT_PROMPT, viewsInput, {
            temperature: 1.4,
            maxTokens: 65536,
            agentName: "VIEWS",
            // Pass reference images directly so the agent can compare visually
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 3) : undefined,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(viewsOutput));
          extractDeps(viewsOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(viewsOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));

          parseGeneratedFiles(viewsOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          // ─────────────────────────────────────────────────────────────
          // PHASE 4 — INTEGRATOR : Audit fonctionnel et câblage des interactions
          // Vérifie que chaque bouton/form/modal/liste EST câblé et fonctionnel
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:4/INTEGRATOR]\n");

          {
            // Construit le contexte : liste de tous les fichiers générés
            const integratorFileList = allGeneratedFiles
              .filter(f => f.path.endsWith(".tsx") || f.path.endsWith(".ts"))
              .map(f => `- ${f.path} (${f.content.split("\n").length} lignes)`)
              .join("\n");

            // Embed les contenus de tous les fichiers .tsx directement dans le prompt
            // Évite de dépendre de readFile (multi-turn) pour les fichiers clés
            const integratorFileContents = allGeneratedFiles
              .filter(f => f.path.endsWith(".tsx") || f.path === "app/page.tsx")
              .map(f => `=== ${f.path} ===\n${f.content.split("\n").map((l, i) => `${i+1}: ${l}`).join("\n")}`)
              .join("\n\n");

            const integratorInput = [
              "AUDIT FONCTIONNEL OBLIGATOIRE",
              "",
              "Voici TOUT le code frontend de l'application. Identifie les interactions NON câblées et corrige-les.",
              "Priorité : que chaque bouton, formulaire, modal, liste et filtre FASSE quelque chose de visible.",
              "",
              "CODE COMPLET DE L'APPLICATION :",
              integratorFileContents || "(aucun fichier .tsx généré)",
              "",
              "Pour chaque problème trouvé → génère le fix directement (str_replace ou create_file).",
              "Si tout est déjà câblé → dis-le clairement en une phrase.",
            ].join("\n");

            let integratorOutput = "";
            try {
              integratorOutput = await runAgent(INTEGRATOR_PROMPT, integratorInput, {
                temperature: 0.4,
                maxTokens: 65536,
                agentName: "INTEGRATOR",
                noTools: false,
              });
            } catch (e: any) {
              emit("\n[INTEGRATOR] Erreur: " + (e?.message ?? String(e)) + "\n");
            }
            flushBuffer();
            mergeAgentOutput(integratorOutput);
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 4b — POLISH (fixer léger si erreurs détectées)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:4b/POLISH]\n");

          // Détection légère d'erreurs manifestes
          const obviousErrors = allGeneratedFiles.filter((f) => {
            const c = f.content;
            return (
              // Zustand void; dans le corps du create (hors interface)
              (f.path.endsWith(".ts") && c.includes("create<") &&
                (() => {
                  const withoutInterfaces = c.replace(/interface\s+\w+[\s\S]*?\n\}/g, "");
                  return /:\s*\(\s*\)\s*=>\s*void\s*;/.test(withoutInterfaces);
                })()) ||
              // "use client" manquant sur une view
              (f.path.includes("views/") && !c.includes('"use client"') && !c.includes("'use client'")) ||
              // Export default sur une view
              (f.path.includes("views/") && /export\s+default\s+function/.test(c) && !/export\s+function/.test(c)) ||
              // globals.css avec @apply de classes shadcn sans tailwind config
              (f.path.endsWith("globals.css") && /@apply\s+(border-border|bg-background|text-foreground)/.test(c) &&
                !allGeneratedFiles.some((tf) => tf.path === "tailwind.config.ts" && tf.content.includes('"border"')))
            );
          });

          if (obviousErrors.length > 0) {
            const errorContext = obviousErrors
              .map((f) => `\n=== ${f.path} ===\n${f.content}`)
              .join("\n");

            const polishInput = `
Ces fichiers contiennent des erreurs détectées automatiquement. Corrige-les :

${errorContext}

ERREURS DÉTECTÉES :
${allGeneratedFiles.find((f) => f.path.includes("store") && f.content.includes(": () => void;")) ? "- Zustand: void; trouvé dans le corps create()" : ""}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && !f.content.includes('"use client"')).map((f) => `- "use client" manquant : ${f.path}`).join("\n")}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && /export\s+default/.test(f.content)).map((f) => `- export default au lieu de named export : ${f.path}`).join("\n")}
${allGeneratedFiles.find((f) => f.path.endsWith("globals.css") && /@apply\s+border-border/.test(f.content)) ? "- globals.css: @apply border-border sans tailwind.config.ts" : ""}

Corrige UNIQUEMENT ces fichiers. Renvoie le fichier COMPLET corrigé.
`;

            const polishOutput = await runAgent(FIXER_PROMPT, polishInput, {
              temperature: 0.4,
              maxTokens: 65536,
              agentName: "POLISH",
            });
            flushBuffer();

            mergeGeneratedFiles(parseGeneratedFiles(polishOutput));
            extractDeps(polishOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          } else {
            // Pas d'erreurs détectées — émet un signal vide pour la phase
            emit("\nVérification : aucune erreur manifeste détectée.\n");
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 5 — TSC CHECK E2B (vérification TypeScript réelle)
          // Reproduit ce que Lovable/v0 font : sandbox isolé, tsc --noEmit,
          // boucle de correction automatique si des erreurs sont trouvées.
          // Transparent pour l'utilisateur — ne bloque pas le stream.
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:5/TSC_CHECK]\n");

          if (e2bApiKey) {
            const MAX_TSC_FIX_ROUNDS = 5; // max 5 rounds de correction — sécurité anti-boucle infinie

            // Délai avant le premier check TSC — les agents précédents ont chauffé le LLM
            emit("[TSC:WAIT] Délai 20s avant vérification TypeScript...\n");
            await sleep(20000);

            // Premier check TSC
            let tscResult = await runTscCheck(buildTscFiles(allGeneratedFiles, currentProjectFiles), e2bApiKey, emit);
            let round = 0;

            // Boucle : on continue tant qu'il y a des erreurs ET qu'on n'a pas atteint la limite
            while (tscResult.hasErrors && round < MAX_TSC_FIX_ROUNDS) {
              // ── Délai avant le fixer — Gemini a déjà enchaîné 3+ agents ──────────────
              // Sans délai, on risque un 429 / RESOURCE_EXHAUSTED
              const fixerDelay = round === 0 ? 20000 : 20000;
              emit(`\n[TSC:FIXER] Round ${round + 1}/${MAX_TSC_FIX_ROUNDS} — délai ${fixerDelay / 1000}s avant correction...\n`);
              await sleep(fixerDelay);
              emit(`[TSC:FIXER] Appel du Fixer Agent...\n`);

              // ── Identifie les fichiers cassés depuis le rapport errorsByFile ────────
              const brokenPaths = new Set<string>(Object.keys(tscResult.errorsByFile).filter(p => p !== "__global__"));
              const typesFile = allGeneratedFiles.find(f => f.path === "types/index.ts");
              const addLineNumbers = (content: string): string =>
                content.split("\n").map((l, i) => `${String(i + 1).padStart(4, " ")} | ${l}`).join("\n");

              // ── Contexte complet pour le fixer ────────────────────────────────
              // CRITIQUE : le fixer reçoit TOUS les fichiers cassés sans troncature
              // + les fichiers de référence (types, stores, services) pour comprendre les dépendances
              const brokenFilesContext = Array.from(brokenPaths)
                .map(p => {
                  const f = allGeneratedFiles.find(g => g.path === p);
                  if (!f) return `\n// FICHIER INTROUVABLE : ${p}`;
                  const errList = (tscResult.errorsByFile[p] ?? []).join("\n");
                  return (
                    `\n${"=".repeat(60)}\n` +
                    `FICHIER : ${f.path} (${f.content.split("\n").length} lignes)\n` +
                    `ERREURS TSC DANS CE FICHIER :\n${errList}\n` +
                    `${"=".repeat(60)}\n` +
                    addLineNumbers(f.content)
                  );
                })
                .filter(Boolean)
                .join("\n"); // PAS de .slice() — toutes les erreurs, tous les fichiers

              // Fichiers de référence non cassés mais dont dépendent les fichiers cassés
              // (stores, services, utils — indispensables pour corriger les erreurs de types)
              const referencePaths = new Set<string>();
              for (const p of brokenPaths) {
                const f = allGeneratedFiles.find(g => g.path === p);
                if (!f) continue;
                // Cherche les imports @/ dans le fichier cassé
                for (const m of f.content.matchAll(/from\s+['"](@\/[^'"]+)['"]/g)) {
                  const importPath = m[1].replace("@/", "") + ".ts";
                  const importPathTsx = m[1].replace("@/", "") + ".tsx";
                  const found = allGeneratedFiles.find(g =>
                    g.path === importPath || g.path === importPathTsx ||
                    g.path === importPath.replace(".ts", "/index.ts")
                  );
                  if (found && !brokenPaths.has(found.path)) referencePaths.add(found.path);
                }
              }

              const typesContext = typesFile
                ? `\n${"=".repeat(60)}\nRÉFÉRENCE TYPES : ${typesFile.path}\n${"=".repeat(60)}\n${addLineNumbers(typesFile.content)}`
                : "";

              const referenceContext = Array.from(referencePaths)
                .filter(p => p !== "types/index.ts") // déjà dans typesContext
                .map(p => {
                  const f = allGeneratedFiles.find(g => g.path === p)!;
                  return `\n${"─".repeat(60)}\nRÉFÉRENCE (importé par les fichiers cassés) : ${f.path}\n${"─".repeat(60)}\n${f.content}`;
                })
                .join("\n");

              const globalErrors = tscResult.errorsByFile["__global__"]
                ? `\nERREURS GLOBALES :\n${tscResult.errorsByFile["__global__"].join("\n")}`
                : "";

              const tscFixInput = `
Tu es un correcteur TypeScript de précision chirurgicale.
Voici la sortie exacte de "tsc --noEmit" pour les fichiers générés.

COMMENT LIRE LES ERREURS :
- Format : L<ligne>:<colonne> — error TSxxxx: <message>
- Les fichiers sont affichés avec numéros de ligne : "  42 | code ici"
- Navigue jusqu'à la ligne indiquée pour voir le code exact à corriger

ERREURS TYPESCRIPT RÉELLES (${tscResult.errorCount} erreurs) :
${"─".repeat(60)}
${tscResult.errors}
${"─".repeat(60)}
${globalErrors}

FICHIERS CASSÉS (avec numéros de ligne) :
${brokenFilesContext || "(aucun fichier localisé — cherche dans les stores et types)"}
${typesContext}
${referenceContext}

INSTRUCTIONS DE CORRECTION :
1. Lis le numéro de ligne dans l'erreur tsc (ex: L45)
2. Repère la ligne 45 dans le fichier (marquée "  45 | ...")
3. Corrige UNIQUEMENT ce qui est cassé — ne change RIEN d'autre
4. Émets le fichier COMPLET corrigé (sans les numéros de ligne — code propre)

PATTERNS FRÉQUENTS :
- "Property X does not exist on type 'IntrinsicAttributes'" → le composant n'a pas X dans ses Props → ajoute-le
- "Property X does not exist on type Y" → champ mal nommé vs types/index.ts, aligne les noms
- "Module has no exported member X" → export default vs named export, corrige l'import/export
- "Argument of type A is not assignable to parameter of type B" → cast ou correction de type
- "() => void" dans Zustand create() → remplace par l'implémentation réelle avec set()
- "'use client' must be first" → déplace en ligne 1 absolue
`;

              // ── Appel réel du FIXER_AGENT — visible dans le stream ───────────────────
              // noTools: true → le fixer ne peut pas appeler readFile mid-stream.
              // Il reçoit déjà tout le contexte dans le prompt (fichiers cassés + références).
              // Sans noTools, le model appelle readFile, chunk.text devient vide,
              // callWithRetry arrête de collecter → fichier tronqué → 0 fichier parsé → break.
              const tscFixOutput = await runAgent(FIXER_PROMPT, tscFixInput, {
                temperature: 0.2,
                maxTokens: 65536, // augmenté : 32768 pouvait couper les gros fichiers
                agentName: "TSC_FIXER",
                emitOutput: true,
                noTools: true, // ← CRITIQUE : empêche l'interruption mid-stream par tool call
              });

              const fixedFiles = parseGeneratedFiles(tscFixOutput);
              const strReplaceOps = parseStrReplaceOps(tscFixOutput);
              const hasChanges = fixedFiles.length > 0 || strReplaceOps.length > 0;

              if (fixedFiles.length > 0) {
                emit(`\n[TSC:FIXER] ✅ ${fixedFiles.length} fichier(s) réécrits : ${fixedFiles.map(f => f.path).join(", ")}\n`);
                mergeGeneratedFiles(fixedFiles);
                extractDeps(tscFixOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
              }
              if (strReplaceOps.length > 0) {
                const srResult = applyStrReplaceToFiles(allGeneratedFiles, strReplaceOps);
                emit(`\n[TSC:FIXER] ✅ ${srResult.applied} str_replace(s) appliqué(s)\n`);
                if (srResult.failed.length > 0) {
                  emit(`\n[TSC:FIXER] ⚠️ ${srResult.failed.length} str_replace(s) échoué(s) : ${srResult.failed.map(f => f.path + ": " + f.reason).join(", ")}\n`);
                }
              }
              if (!hasChanges) {
                // Pas de fichiers émis — on log mais on NE BREAK PAS.
                // Le re-check TSC déterminera s'il reste vraiment des erreurs.
                emit(`\n[TSC:FIXER] ⚠️ Aucune modification émise par le fixer ce round.\n`);
              }

              round++;

              // Re-run TSC pour vérifier si les corrections ont tout résolu
              if (round < MAX_TSC_FIX_ROUNDS) {
                emit(`\n[TSC:RECHECK] Relance tsc après correction (round ${round})...\n`);
                tscResult = await runTscCheck(buildTscFiles(allGeneratedFiles, currentProjectFiles), e2bApiKey, emit);
                if (!tscResult.hasErrors) {
                  emit(`\n[TSC:OK] ✅ Plus aucune erreur après ${round} round(s) de correction !\n`);
                }
              }
            }

            if (tscResult.hasErrors && round >= MAX_TSC_FIX_ROUNDS) {
              emit(`\n[TSC:WARN] ⚠️ ${tscResult.errorCount} erreur(s) persistent après ${MAX_TSC_FIX_ROUNDS} rounds — le projet peut encore contenir des erreurs TypeScript.\n`);
            }
          } else {
            emit("[TSC:SKIP] Clé E2B manquante — ajoutez E2B_API_KEY dans vos variables d'environnement pour activer la vérification TypeScript automatique.\n");
          }
          // ─────────────────────────────────────────────────────────────

          // Helper de scan d'imports - capture AUSSI les @scope/package
          // L'ancienne regex [^@./] excluait @radix-ui, @tanstack, etc.
          const scanImports = (c: string) => {
            const pkgRx = /from\s+['"]([^'"]+)['"]/g;
            let pkgM; while ((pkgM = pkgRx.exec(c)) !== null) {
              const raw = pkgM[1];
              if (raw.startsWith('.') || raw.startsWith('@/')) continue;
              const root = raw.startsWith('@') ? raw.split('/').slice(0,2).join('/') : raw.split('/')[0];
              if (root && root !== 'next' && root !== 'react' && root !== 'react-dom') globalPkgs.add(root);
            }
          };
          // Scan final des imports (inclut fichiers corrigés par TSC fixer)
          for (const f of allGeneratedFiles) scanImports(f.content);


          // Émet tous les fichiers
          for (const f of allGeneratedFiles) {
            emit(`<create_file path="${f.path}">\n${f.content}\n</create_file>`);
          }

          // ─────────────────────────────────────────────────────────────
          // PACKAGE.JSON — MERGE INTELLIGENT ET CUMULATIF
          // Règle : on ne perd JAMAIS une dépendance existante.
          // On ajoute uniquement les nouvelles. On ne réécrit jamais l'existant.
          // ─────────────────────────────────────────────────────────────

          // 1. Scan deja fait ci-dessus via scanImports()

          // 2. Packages à exclure des deps (dev-only ou builtin)
          const DEV_ONLY = new Set([
            "typescript", "@types/node", "@types/react", "@types/react-dom",
            "postcss", "tailwindcss", "eslint", "eslint-config-next",
            "autoprefixer", "@types/autoprefixer",
          ]);
          const PACKAGES_TO_IGNORE = new Set(["react", "react-dom", "next", "sharp", "autoprefixer"]);

          // 3. Charge le package.json existant (version complète, pas juste les deps)
          const existPkgFile = (currentProjectFiles ?? []).find((f) => f.path === "package.json");
          let existingPkg: any = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: {},
            devDependencies: {},
          };
          if (existPkgFile) {
            try { existingPkg = JSON.parse(existPkgFile.content); } catch {}
          }

          // 4. Deps de base toujours présentes
          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.475.0", sharp: "0.33.5",
            clsx: "2.1.1", "tailwind-merge": "2.3.0", zustand: "4.5.2",
            "@e2b/code-interpreter": "^1.0.0",
          };

          const baseDev: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
            postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19",
            eslint: "^8", "eslint-config-next": "15.0.3",
          };

          // 5. Commence avec tout ce qui est déjà dans le package.json existant
          const finalDeps: Record<string, string> = {
            ...baseDeps,
            ...(existingPkg.dependencies ?? {}),
          };
          const finalDevDeps: Record<string, string> = {
            ...baseDev,
            ...(existingPkg.devDependencies ?? {}),
          };

          // 6. Résout les nouvelles dépendances détectées (celles qui ne sont pas déjà présentes)
          const newPkgsToResolve = Array.from(globalPkgs).filter(
            (pkg) => pkg && !finalDeps[pkg] && !finalDevDeps[pkg] && !PACKAGES_TO_IGNORE.has(pkg)
          );
          const newDevPkgsToResolve = Array.from(globalDevPkgs).filter(
            (pkg) => pkg && !finalDeps[pkg] && !finalDevDeps[pkg]
          );

          await Promise.all([
            ...newPkgsToResolve.map(async (pkg) => {
              if (DEV_ONLY.has(pkg)) {
                try { const d = await packageJson(pkg); finalDevDeps[pkg] = d.version as string; } catch { finalDevDeps[pkg] = "latest"; }
              } else {
                try { const d = await packageJson(pkg); finalDeps[pkg] = d.version as string; } catch { finalDeps[pkg] = "latest"; }
              }
            }),
            ...newDevPkgsToResolve.map(async (pkg) => {
              try { const d = await packageJson(pkg); finalDevDeps[pkg] = d.version as string; } catch { finalDevDeps[pkg] = "latest"; }
            }),
          ]);

          // 7. Résout les @types automatiques pour les nouvelles deps
          const autoTypes = await resolveTypes(newPkgsToResolve, finalDevDeps);
          Object.assign(finalDevDeps, autoTypes);

          // 8. Émission du package.json fusionné
          const pkgJson = {
            ...existingPkg,
            name: existingPkg.name || "app",
            version: existingPkg.version || "1.0.0",
            private: true,
            scripts: {
              dev: "next dev", build: "next build", start: "next start", lint: "next lint",
              ...(existingPkg.scripts ?? {}),
            },
            dependencies: finalDeps,
            devDependencies: finalDevDeps,
          };
          emit(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);

          // Générer/mettre à jour requirements.txt si des packages Python ont été collectés
          // ou si des fichiers backend/ ont été générés
          const hasPythonFiles = allGeneratedFiles.some(f => f.path.startsWith("backend/"));
          if (hasPythonFiles || globalPyPkgs.size > 3) {
            // Fusionner avec requirements.txt existant si présent
            const existingReq = allGeneratedFiles.find(f => f.path === "backend/requirements.txt");
            const existingPyLines = existingReq
              ? existingReq.content.split("\n").map(l => l.split(">=")[0].split("==")[0].trim()).filter(Boolean)
              : [];
            const allPyPkgs = new Set([...existingPyLines, ...globalPyPkgs]);
            // Base toujours présente
            ["fastapi>=0.115.0", "uvicorn[standard]>=0.32.0", "python-dotenv>=1.0.0"].forEach(p => allPyPkgs.add(p));
            // Retirer les doublons bare (ex: "fastapi" si "fastapi>=0.115.0" déjà présent)
            const reqContent = Array.from(allPyPkgs)
              .filter(p => p.length > 0)
              .sort()
              .join("\n") + "\n";
            const reqIdx = allGeneratedFiles.findIndex(f => f.path === "backend/requirements.txt");
            if (reqIdx >= 0) allGeneratedFiles[reqIdx].content = reqContent;
            else allGeneratedFiles.push({ path: "backend/requirements.txt", content: reqContent });
            emit(`\n---\n<create_file path="backend/requirements.txt">\n${reqContent}</create_file>`);
            emit(`\n[STACK] ✅ Backend Python détecté — requirements.txt généré (${allPyPkgs.size} packages)\n`);
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 6 — SUMMARY (résumé utilisateur + variables d'env requises)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:6/SUMMARY]\n");

          const requiredEnvVars = detectEnvVars(allGeneratedFiles);
          const filesSummary = allGeneratedFiles
            .map(f => `- ${f.path}`)
            .join("\n");

          const summaryInput = `
Tu viens de terminer la construction d'une application Next.js pour l'utilisateur.
Voici ce qui a été généré :

FICHIERS CRÉÉS :
${filesSummary}

${requiredEnvVars.length > 0 ? `VARIABLES D'ENVIRONNEMENT REQUISES (détectées dans le code) :
${requiredEnvVars.map(v => `- ${v}`).join("\n")}` : "Aucune variable d'environnement requise détectée."}

DEMANDE ORIGINALE DE L'UTILISATEUR : "${lastUserMsg}"

Écris un message de conclusion structuré avec :
1. Une phrase d'annonce que le projet est prêt
2. Ce que l'application fait concrètement (fonctionnalités utilisateur)
3. Si des variables d'environnement sont requises : une section claire "🔑 Variables d'environnement requises" listant chaque variable avec une courte description de ce qu'elle représente
4. Comment lancer le projet (npm install puis npm run dev)
5. Une invitation à demander des modifications

Format : prose naturelle en français, max 10 phrases. Pas de code. Pas de noms de fichiers techniques.
`;

          let summaryOutput = "";
          try {
            summaryOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: [{ role: "user", parts: [{ text: summaryInput }] }],
                config: {
                  systemInstruction: `${BASE_SYSTEM_PROMPT}\n\n${PRESENTER_OUTRO_PROMPT}`,
                  temperature: 0.7,
                  maxOutputTokens: 65536,
                  thinkingConfig: { thinkingLevel: "LOW" as const },
                },
              }),
              () => {},
              { maxAttempts: 2, baseDelay: 5000 }
            );
          } catch { summaryOutput = "Ton application est prête ! Lance \`npm install\` puis \`npm run dev\` pour la démarrer."; }

          emit("\n[PRESENTER:OUTRO]\n");
          emit(summaryOutput.trim());
          if (requiredEnvVars.length > 0) {
            emit("\n\n[ENV_VARS]" + JSON.stringify(requiredEnvVars) + "[/ENV_VARS]");
          }
          emit("\n[/PRESENTER:OUTRO]\n");

          flushBuffer();
          // Émet les tokens consommés pour la session
          if (totalTokensUsed > 0) {
            emit(`\n[TOKEN_USAGE]${JSON.stringify({ total: totalTokensUsed, prompt: totalPromptTokens, candidates: totalCandidatesTokens })}[/TOKEN_USAGE]\n`);
          }
          emit("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Pipeline error:", err);
          // Detect quota errors
          const isQuota = String(err.message).includes("429") || String(err.message).includes("RESOURCE_EXHAUSTED") || String(err.message).includes("quota");
          if (isQuota) {
            emit(`\n[QUOTA_EXCEEDED]${JSON.stringify({ message: err.message, resetHint: "La limite quotidienne Gemini API sera réinitialisée demain à minuit (PST)." })}[/QUOTA_EXCEEDED]\n`);
          }
          emit(`\n[ERREUR]: ${err.message}\n[PAGE_DONE]\n`);
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
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
