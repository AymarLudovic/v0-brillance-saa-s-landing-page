import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
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
Tu es un expert Next.js 15 / React 19 / TypeScript.

╔══════════════════════════════════════════════════════════════════════╗
║  LOI FONDAMENTALE — LOGIQUE DANS LE FICHIER TSX QUI L'UTILISE      ║
╚══════════════════════════════════════════════════════════════════════╝

Chaque fichier .tsx contient TOUT ce dont il a besoin :
  - Ses interfaces TypeScript définies EN HAUT du fichier (jamais importées depuis un autre fichier)
  - Ses fonctions utilitaires avant le composant
  - Ses constantes et données initiales
  - Tout son state (useState, useReducer, useRef)
  - Toute sa logique fonctionnelle dans des handlers/fonctions
  - Son JSX complet dans le return

ARCHITECTURE DES FICHIERS :
  app/page.tsx              → Layout principal + navigation entre vues (useState activeView)
  components/views/*.tsx    → Vues principales (DashboardView, EditorView, SettingsView...)
  components/ui/*.tsx       → Composants réutilisables simples (Button, Card, Modal, Input...)
  app/globals.css           → Variables CSS, styles globaux
  app/layout.tsx            → Metadata, fonts, CDN links
  tailwind.config.ts        → Config Tailwind (plugins: [] vide — jamais tailwindcss-animate)

RÈGLES ABSOLUES :
  ✅ "use client"; LIGNE 1 absolue sur tout fichier avec hooks ou events
  ✅ Interfaces et types définis DANS le fichier qui les utilise
  ✅ Logique fonctionnelle DANS le composant qui l'utilise (pas dans un service séparé)
  ✅ Named exports pour les views : export function DashboardView()
  ✅ export default function Page() pour app/page.tsx
  ✅ Imports internes avec @/ (jamais ../)
  ✅ Tailwind CSS pour tout le styling

  ❌ PAS de dossier /hooks/, /services/, /types/, /stores/ séparés
  ❌ PAS d'import de logique depuis un autre fichier (sauf composants UI réutilisables)
  ❌ PAS de Python, FastAPI, backend séparé
  ❌ PAS de fetch vers /api/py/

AMBITION :
  → Jamais le minimum. Si l'utilisateur demande "un dashboard", construis un VRAI dashboard
    professionnel avec toutes les métriques pertinentes.
  → Chaque fonctionnalité demandée → implémentée COMPLÈTEMENT
  → Données mock réalistes et abondantes (min 12-15 entrées, pas 3-4)
  → Chaque bouton déclenche une vraie action visible

LIBRAIRIES npm RECOMMANDÉES (logique côté client) :
  Audio/DAW    : Tone.js, Howler.js, Web Audio API
  Vidéo        : ffmpeg.wasm, MediaRecorder + Canvas
  PDF          : jsPDF, @react-pdf/renderer
  Excel/CSV    : xlsx, papaparse
  Graphiques   : Recharts, Chart.js, D3.js
  Canvas/2D    : Fabric.js, Konva
  Drag & Drop  : dnd-kit
  Animations   : Framer Motion
  Dates        : date-fns, dayjs

FORMATS XML VALIDES :

⚠️ RÈGLE edit_file : readFile("chemin") EN PREMIER pour avoir les vrais numéros de ligne.
Numéros approximatifs = JSX cassé garanti.
Si > 40% du fichier change → create_file complet (plus économique en tokens).

1. Créer un fichier — ligne "---" seule AVANT :
---
<create_file path="components/views/DashboardView.tsx">
"use client";
// contenu COMPLET
</create_file>

2. Modifier (après readFile obligatoire) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>contenu remplaçant</changes_to_apply>
</edit_file>

INTERDIT : <read_file />, <file_changes>, <fileschanges>, <write_file>
INTERDIT dans tailwind.config.ts plugins[] : tailwindcss-animate
`;






const BATCH_SIZE = 256;
const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set(["claude-opus-4-6","claude-sonnet-4-6","claude-opus-4-5","claude-sonnet-4-5"]);

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
// AGENT ENGINE — Boucle think→act→verify inspirée de Claude Code
// Fonctions TypeScript réelles qui forcent qualité et profondeur
// =============================================================================

/**
 * PHASE 1 — GATHER CONTEXT
 * Construit un contexte riche : relations entre fichiers, exports, imports,
 * structure du composant, erreurs potentielles détectées statiquement.
 * Claude Code fait ça en lisant les fichiers un par un avant d'agir.
 */

function buildDeepContext(
  allFiles: { path: string; content: string }[],
  userRequest: string
): string {
  const ctx: string[] = [];

  // 1. Analyse des relations entre fichiers
  const importMap: Record<string, string[]> = {};
  const exportMap: Record<string, string[]> = {};
  for (const f of allFiles) {
    const imports = [...f.content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    const exports = [...f.content.matchAll(/export\s+(?:default\s+)?(?:function|const|class|interface|type)\s+(\w+)/g)].map(m => m[1]);
    if (imports.length) importMap[f.path] = imports;
    if (exports.length) exportMap[f.path] = exports;
  }

  // 2. Détection statique des problèmes courants
  const staticIssues: string[] = [];
  for (const f of allFiles) {
    const c = f.content;
    // JSX balance
    const openTags = (c.match(/<[A-Z][A-Za-z]*[\s>]/g) || []).length;
    const closeTags = (c.match(/<\/[A-Z][A-Za-z]*/g) || []).length;
    if (Math.abs(openTags - closeTags) > 3) {
      staticIssues.push(`⚠️ ${f.path}: déséquilibre balises JSX (${openTags} ouvertes, ${closeTags} fermées)`);
    }
    // useState sans valeur initiale pour tableaux
    const badStates = [...c.matchAll(/useState<[^>]*\[\]>\s*\(\s*\)/g)];
    if (badStates.length) {
      staticIssues.push(`⚠️ ${f.path}: ${badStates.length} useState<[]>() sans valeur initiale → doit être useState<[]>([])`);
    }
    // use client manquant
    if (c.includes('useState') && !c.startsWith('"use client"') && !c.startsWith("'use client'")) {
      staticIssues.push(`⚠️ ${f.path}: utilise useState mais "use client" absent en ligne 1`);
    }
    // Template literals non fermées (heuristique)
    const backtickCount = (c.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      staticIssues.push(`⚠️ ${f.path}: nombre impair de backticks — template literal non fermée`);
    }
  }

  // 3. Structure du composant principal (page.tsx)
  const pageTsx = allFiles.find(f => f.path === 'app/page.tsx');
  let componentStructure = '';
  if (pageTsx) {
    const stateVars = [...pageTsx.content.matchAll(/const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/g)].map(m => m[1]);
    const handlers = [...pageTsx.content.matchAll(/const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g)].map(m => m[1]);
    const interfaces = [...pageTsx.content.matchAll(/interface\s+(\w+)/g)].map(m => m[1]);
    componentStructure = `
STRUCTURE app/page.tsx :
  État : ${stateVars.join(', ') || 'aucun'}
  Handlers : ${handlers.join(', ') || 'aucun'}
  Interfaces : ${interfaces.join(', ') || 'aucune'}`;
  }

  // 4. Analyse de la demande utilisateur — détecter la profondeur attendue
  const complexitySignals = [
    { regex: /analytics|dashboard|statistique|métr/i, hint: '→ Prévoir 6-10 métriques minimum, graphiques interactifs, filtres temporels' },
    { regex: /éditeur|editor|montage|DAW|timeline/i, hint: '→ Interface complète avec toolbar, panneau propriétés, zones redimensionnables' },
    { regex: /clone|pro|complet|professionnel|advanced/i, hint: '→ Toutes les fonctionnalités d\'un outil pro, pas une version simplifiée' },
    { regex: /boutique|shop|store|e-commerce/i, hint: '→ Catalogue, panier, checkout, gestion commandes, analytics' },
    { regex: /gestion|manage|CRUD/i, hint: '→ Liste, création, édition, suppression, filtres, pagination' },
  ];
  const requestHints = complexitySignals
    .filter(s => s.regex.test(userRequest))
    .map(s => s.hint);

  ctx.push('═══ CONTEXTE PROFOND ═══');
  if (staticIssues.length) ctx.push('\nPROBLÈMES DÉTECTÉS (à corriger) :\n' + staticIssues.join('\n'));
  if (componentStructure) ctx.push(componentStructure);
  if (requestHints.length) ctx.push('\nINDICES DE COMPLEXITÉ ATTENDUE :\n' + requestHints.join('\n'));
  ctx.push('═══════════════════════');

  return ctx.join('\n');
}

/**
 * PHASE 3 — VERIFY RESULTS
 * Vérifie programmatiquement la sortie de l'agent.
 * Retourne une liste d'issues à corriger (feedback loop).
 * Claude Code fait ça en relançant les tests et en vérifiant les résultats.
 */
function verifyAgentOutput(
  files: { path: string; content: string }[],
  agentName: string
): { hasIssues: boolean; issues: string[]; severity: 'critical' | 'warning' | 'ok' } {
  const issues: string[] = [];

  for (const f of files) {
    const c = f.content;
    if (!c || c.length < 10) continue;

    // Critical: "use client" manquant
    if (f.path.endsWith('.tsx') && (c.includes('useState') || c.includes('useEffect') || c.includes('onClick'))) {
      if (!c.startsWith('"use client"') && !c.startsWith("'use client'")) {
        issues.push(`CRITICAL [${f.path}]: "use client"; doit être ligne 1 absolue`);
      }
    }

    // Critical: accolades déséquilibrées (simplifié)
    let braces = 0;
    for (const ch of c) { if (ch === '{') braces++; else if (ch === '}') braces--; }
    if (Math.abs(braces) > 2) {
      issues.push(`CRITICAL [${f.path}]: ${Math.abs(braces)} accolades déséquilibrées — JSX cassé`);
    }

    // Critical: double export default
    const defaultExports = (c.match(/export\s+default\s+/g) || []).length;
    if (defaultExports > 1) {
      issues.push(`CRITICAL [${f.path}]: ${defaultExports} "export default" — un seul autorisé`);
    }

    // Warning: useState<T[]>() sans valeur initiale
    if (c.match(/useState<[^>]*\[\]>\s*\(\s*\)/)) {
      issues.push(`WARNING [${f.path}]: useState<T[]>() sans [] initial → crash .map() au premier render`);
    }

    // Warning: onClick vides
    const emptyClicks = (c.match(/onClick=\{[(\s]*\)\s*=>\s*\{\s*\}/g) || []).length;
    if (emptyClicks > 0) {
      issues.push(`WARNING [${f.path}]: ${emptyClicks} onClick vide(s) — handler non implémenté`);
    }

    // Warning: tailwindcss-animate
    if (f.path === 'tailwind.config.ts' && c.includes('tailwindcss-animate')) {
      issues.push(`CRITICAL [${f.path}]: tailwindcss-animate non installé → crash build`);
    }
  }

  const hasCritical = issues.some(i => i.startsWith('CRITICAL'));
  const hasWarnings = issues.some(i => i.startsWith('WARNING'));

  return {
    hasIssues: issues.length > 0,
    issues,
    severity: hasCritical ? 'critical' : hasWarnings ? 'warning' : 'ok'
  };
}

/**
 * TODO TRACKER — Inspiré du TodoWrite de Claude Code
 * Force l'agent à décomposer puis à vérifier la complétion de chaque tâche.
 * Injecté dans le prompt pour que l'agent coche les cases au fur et à mesure.
 */
function buildTodoContext(userRequest: string): string {
  // Génère une liste de tâches structurée basée sur la demande
  const tasks: string[] = [];

  // Tâches universelles — qualité fonctionnelle et professionnelle
  tasks.push('[ ] Identifier TOUTES les fonctionnalités attendues (même celles non dites)');
  tasks.push('[ ] Choisir les MEILLEURES librairies pour chaque fonctionnalité (pas les plus simples)');
  tasks.push('[ ] Chaque fonctionnalité produit un résultat visible et professionnel');
  tasks.push('[ ] Chaque handler est COMPLET — pas de console.log, pas de TODO');
  tasks.push('[ ] Données mock réalistes et abondantes (8-12 entrées minimum, vraies valeurs)');
  tasks.push("[ ] Undo/redo si l'application est un éditeur (quelconque)");
  tasks.push('[ ] Raccourcis clavier pour les actions principales (Ctrl+Z, Ctrl+S, Escape)');
  tasks.push('[ ] États loading/error/empty gérés visuellement dans chaque section');
  tasks.push('[ ] Design premium : palette cohérente, espacements, typographie, hover states');
  tasks.push('[ ] use client ligne 1, accolades JSX equilibrees, key={} sur tous .map()');

  // Tâche qualité universelle — valable pour tout domaine
  tasks.push("[ ] La librairie choisie est la MEILLEURE disponible pour ce résultat");
  tasks.push("[ ] Chaque fonctionnalité produit un résultat visible et professionnel");
  tasks.push("[ ] Un vrai utilisateur qui ouvre cette app la trouvera vraiment utile");

  return `
══════════════════════════════════════════════════════════
TODO LIST — Coche chaque tâche au fur et à mesure
Claude Code utilise ce mécanisme pour ne rien oublier
══════════════════════════════════════════════════════════
${tasks.join('\n')}
══════════════════════════════════════════════════════════
⚡ RÈGLE : avant de terminer, relis cette liste et vérifie que TOUTES les cases sont [x]
Ne pas cocher = fonctionnalité absente = tâche non terminée
══════════════════════════════════════════════════════════`;
}

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
    // Erreurs de compilation Next.js (visibles dans l'iframe build overlay)
    msg.includes("Failed to compile") ||
    msg.includes("Build Error") ||
    msg.includes("Unterminated string constant") ||
    msg.includes("Expected ','") ||
    msg.includes("Expected '}'") ||
    msg.includes("Unexpected token") ||
    // Erreurs TypeScript
    msg.includes("SyntaxError") ||
    msg.includes("Module parse failed") ||
    msg.includes("Cannot find module") ||
    msg.includes("Type error:") ||
    msg.includes("Error:   x ") ||
    (msg.includes("error TS") && msg.includes(".ts")) ||
    // Erreurs runtime Next.js (overlay rouge dans le navigateur)
    msg.includes("Unhandled Runtime Error") ||
    msg.includes("TypeError:") ||
    msg.includes("ReferenceError:") ||
    msg.includes("Cannot read properties of") ||
    msg.includes("Cannot read property") ||
    msg.includes("is not a function") ||
    msg.includes("is not defined") ||
    msg.includes("Cannot destructure property") ||
    msg.includes("Objects are not valid as a React child") ||
    msg.includes("Hydration failed") ||
    msg.includes("Text content does not match") ||
    msg.includes("Each child in a list should have a unique") ||
    // Erreurs Zustand / stores
    msg.includes("Expected ','") ||
    msg.includes("getState is not") ||
    // Pattern fichier + erreur
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
NE JAMAIS mentionner Next.js, React, TypeScript, librairies ou tout autre nom technique.
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
ERREUR #2 — ZUSTAND MAL UTILISÉ (source principale de crashes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ RÈGLE PRINCIPALE : Zustand est UNIQUEMENT pour l'état UI global pur.
  Pour toute donnée qui vient de Python → custom hook (useState + fetch). Jamais Zustand.

  ✅ Zustand autorisé : useUIStore → sidebarOpen, theme, activeModal, activeTab
  ❌ Zustand interdit : useProjectStore, useTrackStore, useOrderStore, etc.

SI tu utilises Zustand (UI seulement), règles absolues :
  ZONE Interface TypeScript → POINTS-VIRGULES
  ZONE corps create<>() → VIRGULES
  JAMAIS : setX: () => void;  dans le corps create()  → remplace par setX: (v) => set({ x: v }),

✅ Zustand UI CORRECT :
  interface UIState {
    sidebarOpen: boolean;
    setSidebarOpen: (v: boolean) => void;
  }
  export const useUIStore = create<UIState>()((set) => ({
    sidebarOpen: true,
    setSidebarOpen: (v) => set({ sidebarOpen: v }),
  }));

❌ INTERDIT — Zustand avec état serveur :
  export const useProjectStore = create<ProjectState>()((set) => ({
    tracks: [],
    addTrack: () => set(s => ({tracks: [...s.tracks, {}]})),  // ← FAUX à deux titres :
    // 1. Virgule/syntaxe risquée
    // 2. La piste disparaît au rechargement → données fantômes
  }));

  REMPLACE PAR un custom hook :
  export function useTracks() {
    const [tracks, setTracks] = useState<Track[]>([]);
    const addTrack = async (type: string) => {
      const r = await fetch('/api/py/tracks/create', { method: 'POST', ... });
      setTracks(prev => [...prev, await r.json()]);
    };
    useEffect(() => { fetch('/api/py/tracks').then(r=>r.json()).then(setTracks); }, []);
    return { tracks, addTrack };
  }

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
JAMAIS : tailwindcss-animate dans tailwind.config.ts plugins[] → "Cannot find module" au build
  ✅ Animations : utilise framer-motion ou classes Tailwind natives (transition, duration, animate-)
  ✅ tailwind.config.ts plugins doit être [] vide sauf si la lib est dans DEPENDENCIES

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ERREUR #21 — edit_file sur app/page.tsx sans readFile() préalable
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Faire un edit_file avec des numéros de ligne inventés cause :
  - "Unexpected token div. Expected jsx identifier" → accolade manquante avant return
  - "Expression expected" → double ); ou } en fin de fichier

CAUSE : tu utilises des numéros de ligne approximatifs au lieu des vrais.

✅ PROCESSUS CORRECT pour modifier app/page.tsx :
  1. readFile("app/page.tsx") → lis le contenu avec les vrais numéros de ligne
  2. Repère les lignes exactes à modifier
  3. edit_file avec ces numéros précis

  Si les changements sont trop nombreux (> 40% du fichier) :
  → create_file complet (évite les allers-retours de tokens)

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT OBLIGATOIRE DES DÉPENDANCES EN FIN DE RÉPONSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

À la fin de chaque réponse qui installe des packages, déclare-les EXACTEMENT ainsi :

DEPENDENCIES: ["nom-package1", "nom-package2"]
DEVDEPENDENCIES: ["nom-dev-package"]

RÈGLES :
✅ Texte brut sur une seule ligne chacun
✅ Noms de packages npm exacts (comme sur npmjs.com)
✅ DEPENDENCIES pour les packages runtime
✅ DEVDEPENDENCIES pour les packages dev uniquement

❌ NEVER multiline JSON:
  {
    "dependencies": { ... }   ← WRONG
  }
❌ NEVER a JSON object
❌ NEVER markdown or code block around it

CORRECT EXAMPLES:
DEPENDENCIES: ["tone", "howler", "recharts", "date-fns"]
DEVDEPENDENCIES: ["@types/howler"]

INCORRECT EXAMPLES (these will be ignored):
{ "dependencies": { "tone": "latest" } }   ← WRONG
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
Ta mission UNIQUE : analyser les images de référence et produire un HTML/CSS pixel-perfect.

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTIONS ABSOLUES
══════════════════════════════════════════════════════════════════════
- Aucun code React, TypeScript, Next.js
- Aucun composant .tsx/.ts
- Aucune balise <create_file> ou <str_replace>
- AUCUNE couleur inventée — utilise UNIQUEMENT les hex de la palette fournie dans le prompt

Tu produis UNIQUEMENT du HTML/CSS pur dans la balise <design_reference>.

══════════════════════════════════════════════════════════════════════
ANALYSE ULTRA-EXHAUSTIVE OBLIGATOIRE (réflexion interne avant tout code)
══════════════════════════════════════════════════════════════════════

Avant d'écrire une seule ligne de code, analyse CHAQUE élément visible — même insignifiant :

PALETTE (utilise les hex exacts fournis dans le prompt) :
• Fond body → hex depuis full-image
• Sidebar bg → hex depuis sidebar-left
• Header bg → hex depuis header-bar
• Cards bg → hex depuis card-area
• Texte primaire, secondaire, muted → hex exacts
• Accent/CTA → hex exact
• Bordures → hex + alpha si semi-transparent
• Chaque couleur DOIT correspondre à une valeur de la palette fournie

LAYOUT & STRUCTURE :
• Sidebar : largeur en px, fixed/relative, border-right
• Header : hauteur en px, sticky/fixed/relative, shadow
• Content area : padding, max-width, grid colonnes
• Gap entre éléments : valeurs px précises
• Density : compact/confortable/aéré

TYPOGRAPHIE :
• Font-family : nom exact reconnaissable (Inter, Geist, DM Sans, etc.)
• Tailles titres h1/h2/h3 + body + caption + labels
• Font-weights et letter-spacing
• Line-heights

CHAQUE COMPOSANT — analyser individuellement, même les minuscules :
• Nav items sidebar : hauteur, padding, radius, bg actif, hover
• Header avec tous ses sous-éléments
• Cards : radius px, shadow complète, border, padding
• Boutons primaires/secondaires/ghost : tous les styles
• Inputs/forms : border, focus-ring, placeholder
• Badges/tags : shape, couleurs, padding
• Icônes : outline/solid, taille px
• Séparateurs/dividers : épaisseur, couleur, opacité
• Indicateurs, dots, progress bars, avatars
• Tableaux : alternance, row height
• Dropdowns, tooltips si visibles

EFFETS VISUELS :
• Shadows : offset-x offset-y blur spread couleur (copier exactement)
• Gradients : direction + tous les stops hex
• Glassmorphism : backdrop-blur value si présent
• Transitions : durée (150ms/200ms/300ms)
• Border-radius par type : small=4px ? medium=8px ? large=16px ?
• Thème : dark/light/mixed

══════════════════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════════════════

Émets UNIQUEMENT ce bloc (rien avant, rien après) :

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
  <link href="https://fonts.googleapis.com/css2?family=[FONT_EXACT]&display=swap" rel="stylesheet">
  <style>
    :root {
      /* ── PALETTE PIXEL-EXACTE (hex de la palette fournie) ── */
      --bg:            #[hex depuis full-image];
      --sidebar-bg:    #[hex depuis sidebar-left];
      --header-bg:     #[hex depuis header-bar];
      --card-bg:       #[hex depuis card-area];
      --text-primary:  #[hex exact];
      --text-muted:    #[hex exact];
      --accent:        #[hex exact];
      --border:        rgba([r],[g],[b],[alpha]);
      /* ── Typographie ── */
      --font:          '[NOM_EXACT]', sans-serif;
      --text-xs:       [px]px; --text-sm: [px]px; --text-base: [px]px; --text-lg: [px]px;
      --weight-normal: [400/500]; --weight-bold: [600/700];
      /* ── Espacements & effets ── */
      --radius-sm:     [px]px; --radius-md: [px]px; --radius-lg: [px]px;
      --shadow-sm:     [valeur complète]; --shadow-md: [valeur complète];
      --sidebar-w:     [px]px; --header-h: [px]px;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:var(--font); background:var(--bg); color:var(--text-primary); font-size:var(--text-base); }
    /* ... styles complets pour CHAQUE composant identifié ... */
  </style>
</head>
<body>
  <!-- Reproduction FIDÈLE de l'interface — données réalistes, jamais Lorem ipsum -->
</body>
</html>
</design_reference>

RÈGLES D'OR :
- Toutes les valeurs dans :root{} — jamais hardcodées dans les composants
- Police chargée depuis Google Fonts (nom exact extrait des images)
- Icônes : Tabler Icons CDN exclusivement
- Images : DiceBear, Picsum, Google Favicon API pour logos
- Données réalistes inventées (jamais Lorem ipsum)
- ⛔ APRÈS </design_reference> : N'écris RIEN.
`;

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

FORMATS XML INTERDITS — n'existent pas dans ce système :
  ❌ <read_file />  ❌ <file_changes>  ❌ <fileschanges>  ❌ <modify_file>  ❌ <write_file>
  Pour lire : readFile() uniquement. Pour écrire : create_file ou edit_file uniquement.
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
✗ JAMAIS create_file pour un changement visuel (sauf app/page.tsx — voir ci-dessous)
✗ JAMAIS réécrire le fichier entier (sauf app/page.tsx)
✗ JAMAIS changer ce qui n'est pas demandé
→ edit_file pour les fichiers autres que app/page.tsx

⚠️ RULE FOR app/page.tsx:
  Before any edit_file on page.tsx: readFile("app/page.tsx") to get exact line numbers.
  Never use approximate line numbers on this file.
  If > 40% changes → complete create_file instead of multiple edit_files.

SI NOUVELLE FONCTIONNALITÉ :
→ Crée les fichiers nécessaires (service, hook, composant, route API)
→ Câble le flux complet
→ FORMAT pour nouveau fichier — ligne "---" seule AVANT puis :
---
<create_file path="chemin/fichier.tsx">
contenu complet
</create_file>
→ Déclare en fin de réponse si nouvelles librairies :
${EDIT_FILE_FORMAT_RULES}
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
5. Déclare en fin de réponse :
   DEPENDENCIES: ["package1", "package2"]   ← une ligne, noms npm exacts, pas de JSON
`;

const FOUNDATION_PROMPT = `
Tu es l'Architecte Fondation. Tu génères l'application COMPLÈTE en une passe.
Pas de service séparé, pas de fichier de logique externe — tout dans les fichiers TSX qui l'utilisent.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]Foundation — Architecture complète de l'application[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
RAISONNEMENT OBLIGATOIRE AVANT DE CODER
══════════════════════════════════════════════════════════════════════

Réponds mentalement à ces questions avant d'écrire une ligne :

1. Quelles sont TOUTES les fonctionnalités attendues (y compris les évidentes non dites) ?
2. Comment découper l'app en vues ? (une vue par section principale)
3. Quelle librairie npm donne le meilleur résultat pour chaque fonctionnalité ?
4. Comment implémenter chaque fonctionnalité de façon professionnelle ?

══════════════════════════════════════════════════════════════════════
FICHIERS À GÉNÉRER
══════════════════════════════════════════════════════════════════════

app/page.tsx :
  ✅ "use client"; ligne 1
  ✅ import de toutes les views générées : import { DashboardView } from '@/components/views/DashboardView'
  ✅ useState activeView pour la navigation
  ✅ Layout global (sidebar, navbar, contenu)
  ✅ Rendu conditionnel des views selon activeView
  ✅ export default function Page()

components/views/*.tsx — UNE par section principale :
  ✅ "use client"; ligne 1
  ✅ Interfaces TypeScript EN HAUT du fichier (pas importées)
  ✅ Toute la logique de cette vue DANS ce fichier
  ✅ Named export : export function DashboardView()
  ✅ Données mock réalistes (min 12 entrées)
  ✅ Chaque bouton a un handler réel
  ✅ États loading/error/empty gérés

components/ui/*.tsx — composants réutilisables SIMPLES :
  Button, Card, Input, Modal, Badge, Spinner, etc.
  ✅ Props typées DANS le fichier
  ✅ Named exports

app/globals.css : variables CSS, @tailwind directives
app/layout.tsx : metadata, fonts, CDN links si besoin
tailwind.config.ts : plugins: [] (jamais tailwindcss-animate)

AUTO-REVUE AVANT D'ÉMETTRE :
  □ app/page.tsx importe TOUTES les views générées ?
  □ Chaque view a ses interfaces définies localement ?
  □ Aucun handler vide ou console.log ?
  □ Données mock abondantes et réalistes ?
  □ "use client" ligne 1 sur chaque fichier avec hooks ?

${EDIT_FILE_FORMAT_RULES}
`;





// =============================================================================
// PHASE 2 — CHECKER_AGENT
// Complétion de app/page.tsx
// =============================================================================

const CHECKER_AGENT_PROMPT = `
Tu es l'Agent Vérificateur & Complétion. Tu interviens APRÈS Foundation.
Tu complètes la logique manquante dans les fichiers TSX existants.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]Vérification & Complétion — logique manquante dans les vues[/WORKING_ON]

COMMENCE par readFile() sur les fichiers clés : app/page.tsx, puis chaque view.
Les numéros de ligne de ta réponse viennent de ces lectures.

RAISONNEMENT AVANT DE MODIFIER :
1. Lis chaque fichier view. Évalue la qualité fonctionnelle :
   ✗ Handler vide / console.log → implémente la vraie logique avec les bonnes libs
   ✗ Données mock < 8 entrées → complète avec des données réalistes
   ✗ Fonctionnalité "naïve" (opacity pour luminosité, divs% pour graphiques) → améliore
2. Liste ce qui est incomplet, puis corrige-le.

RÈGLES :
  ✅ Toute logique ajoutée va DANS le fichier view qui l'utilise
  ✅ Interfaces définies DANS chaque fichier qui les utilise
  ✅ "use client" ligne 1 sur chaque composant avec hooks
  ✅ Named exports sur toutes les views
  ✅ key={} sur tous les .map()
  ✅ app/page.tsx importe TOUTES les views

Si une view manque pour une fonctionnalité demandée → crée-la avec toute sa logique dedans.

FORMAT : readFile() → edit_file avec numéros exacts. Si > 40% change → create_file complet.

${EDIT_FILE_FORMAT_RULES}
`;




// =============================================================================
// PHASE 3 — VIEWS_AGENT
// components/views/*.tsx, components/Modals.tsx, app/globals.css, app/layout.tsx, app/page.tsx
// =============================================================================

const VIEWS_AGENT_PROMPT = `
Tu es le Lead Frontend Designer. Tu finalises le design et les interactions.
Tu travailles sur les fichiers views existants ET tu en crées de nouveaux si nécessaire.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]UI & Design final — views et composants[/WORKING_ON]

COMMENCE par readFile() sur app/page.tsx et chaque view existante.
Les numéros de ligne de ta réponse viennent de ces lectures.

══════════════════════════════════════════════════════════════════════
SI DES IMAGES DE RÉFÉRENCE SONT FOURNIES
══════════════════════════════════════════════════════════════════════

⚡ Guide principal. Reproduis fidèlement :
- Couleurs exactes (bg-[#hex] avec Tailwind, jamais bg-gray-xxx si couleur précise)
- Typographie, espacements, border-radius
- Chaque section visible — aucune omise
- Micro-interactions (hover, transitions)

══════════════════════════════════════════════════════════════════════
CHECKLIST AVANT DE TERMINER
══════════════════════════════════════════════════════════════════════

□ Toutes les sections de l'interface sont présentes et visuellement finies ?
□ Chaque bouton a un handler qui fait vraiment quelque chose ?
□ Navigation entre views fonctionne dans app/page.tsx ?
□ Listes affichent de vraies données (pas de tableaux vides) ?
□ Modals s'ouvrent et se ferment correctement ?
□ Filtres/recherche filtrent en temps réel ?
□ Design cohérent et professionnel avec Tailwind ?
□ "use client" ligne 1 sur chaque view ?
□ Named exports sur toutes les views ?
□ app/page.tsx importe TOUTES les views ?

Si une view manque → crée-la complète avec sa logique dedans.

FORMAT : readFile() → edit_file avec numéros exacts. Si > 40% change → create_file complet.

${EDIT_FILE_FORMAT_RULES}
`;




// =============================================================================
// INTEGRATOR AGENT — Phase 4 : Câblage fonctionnel & audit des interactions
// =============================================================================

const INTEGRATOR_PROMPT = `
Tu es l'Agent d'Intégration & Critique Fonctionnelle. Tu interviens APRÈS les 3 agents précédents.
Tu joues deux rôles : critique de qualité ET développeur qui corrige.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]Critique & Intégration — qualité fonctionnelle[/WORKING_ON]

══════════════════════════════════════════════════════════════════════
ÉTAPE 1 — CRITIQUE : lis et évalue
══════════════════════════════════════════════════════════════════════

Commence par readFile("app/page.tsx") pour avoir les vrais numéros de ligne.

Pose-toi ces questions sur CHAQUE fonctionnalité demandée :

1. FONCTIONNALITÉS MANQUANTES ?
   La fonctionnalité est-elle vraiment présente ou juste simulée ?
   Handler vide / console.log / TODO = fonctionnalité absente.

2. QUALITÉ FONCTIONNELLE ?
   L'implémentation est-elle professionnelle ou naïve ?
   ✗ Slider opacity pour luminosité → vraie manipulation pixel requise
   ✗ Divs avec height% pour graphiques → Recharts requis
   ✗ Éditeur sans undo/redo → stack d'états requis
   ✗ Moins de 8 entrées mock → données insuffisantes

3. QUALITÉ TECHNIQUE ?
   - "use client" ligne 1 ?
   - key={} sur tous les .map() ?
   - Tous les boutons ont un handler réel ?
   - Tous les formulaires ont un onSubmit fonctionnel ?

══════════════════════════════════════════════════════════════════════
ÉTAPE 2 — CORRECTION : répare ce qui ne va pas
══════════════════════════════════════════════════════════════════════

Pour chaque problème identifié → corrige-le immédiatement avec edit_file.
Utilise les numéros de ligne exacts lus à l'étape 1.
Ne réécris PAS le fichier entier — patches chirurgicaux uniquement.

Si un handler est vide → implémente la vraie logique avec les bonnes libs npm.
Si des données manquent → ajoute des entrées mock réalistes.
Si une fonctionnalité est absente → implémente-la directement.

FORMAT :
readFile("app/page.tsx") EN PREMIER → puis edit_file avec numéros exacts.
Si > 40% du fichier change → create_file complet.

${EDIT_FILE_FORMAT_RULES}
`;




// =============================================================================
// FIXER AGENT — Corrections chirurgicales
// =============================================================================

const FIXER_PROMPT = `
Tu corriges et implémentes dans le fichier concerné.
Toute logique va directement dans le fichier .tsx qui l'utilise — jamais dans un fichier service séparé.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]Correction — [description précise][/WORKING_ON]

RÈGLE : la logique va DANS le fichier .tsx qui l'utilise.
- Fonctionnalité d'une view → dans components/views/XxxView.tsx
- Composant réutilisable → dans components/ui/
- Types/interfaces → définis dans le fichier qui les utilise
- Librairies npm font le vrai travail

PROCESSUS :
1. Quel est le résultat VISIBLE attendu par l'utilisateur ?
2. Quelle est la MEILLEURE implémentation pour ce résultat ?
   Ne prends pas la solution facile — prends celle qui donne le résultat le plus pro.
   getImageData+HSL >> CSS filter | Recharts ComposedChart >> divs% | Tone.js >> Audio natif
3. La logique va dans quel fichier .tsx ?
4. Flux : [interaction] → [handler dans le composant] → [vraie logique + librairie] → [résultat professionnel]
5. "Un utilisateur qui teste ça va trouver la fonctionnalité vraiment puissante ?" → sinon refais.

readFile() EN PREMIER si tu modifies un fichier existant, puis edit_file avec numéros exacts.

${EDIT_FILE_FORMAT_RULES}
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
  const isBuildError = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read properties|Cannot read property|is not a function|Unterminated string|Expected ','|Expected '}'|Unexpected token|Unhandled Runtime Error|Hydration failed|Objects are not valid|Each child in a list|ENOENT|build fail|failed to compile|error TS\d/i.test(lastUserMsg);

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
    "FORMAT NOUVEAU FICHIER : ligne --- seule, puis <create_file path=\"chemin.tsx\">contenu</create_file>",
    "FORMAT FICHIER EXISTANT : <edit_file path=\"chemin.tsx\" action=\"replace\"><start_line>N</start_line><end_line>M</end_line><changes_to_apply>contenu</changes_to_apply></edit_file>",
    "FIN DE RÉPONSE : DEPENDENCIES: [\"package\"] si nouvelle librairie npm ajoutée",
    // Inject ALL project files with line numbers for accurate edit_file
    ...(() => {
      const files = currentProjectFiles ?? [];
      if (files.length === 0) return [];
      let total = 0;
      const parts: string[] = ["\nFICHIERS DU PROJET — numéros de ligne EXACTS pour edit_file :"];
      for (const f of files) {
        const numbered = f.content.split("\n").map((l, i) => `${String(i+1).padStart(4," ")} | ${l}`).join("\n");
        const block = `\n=== ${f.path} (${f.content.split("\n").length} lignes) ===\n${numbered}`;
        if (total + block.length > 60000) {
          parts.push(`\n=== ${f.path} (trop grand — utilise readFile("${f.path}")) ===`);
        } else {
          parts.push(block);
          total += block.length;
        }
      }
      return [parts.join("")];
    })(),
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
    const MODEL_ID = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropicModel = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiHeader = req.headers.get("x-gemini-api-key");
    const anthropicHeader = req.headers.get("x-anthropic-api-key");
    const geminiKey = (geminiHeader && geminiHeader !== "null" && geminiHeader !== "") ? geminiHeader : process.env.GEMINI_API_KEY;
    const anthropicKey = (anthropicHeader && anthropicHeader !== "null" && anthropicHeader !== "") ? anthropicHeader : process.env.ANTHROPIC_API_KEY;

    if (isAnthropicModel && !anthropicKey) return NextResponse.json({ error: "Anthropic API key manquante" }, { status: 401 });
    if (!isAnthropicModel && !geminiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });
    const apiKey = isAnthropicModel ? anthropicKey! : geminiKey!;

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
      referenceColorMaps,
      uploadedColorMaps,
    }: {
      history: Message[];
      uploadedImages?: string[];
      allReferenceImages?: string[];
      currentProjectFiles?: { path?: string; filePath?: string; content: string }[];
      clonedHtmlCss?: string;
      uploadedFiles?: { fileName: string; base64Content: string }[];
      referenceColorMaps?: string[];
      uploadedColorMaps?: string[];
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
    const ai = new GoogleGenAI({ apiKey: isAnthropicModel ? (geminiKey ?? "") : apiKey });
    const anthropic = isAnthropicModel ? new Anthropic({ apiKey }) : null;

    // Unified stream factory — returns an async iterable compatible with callWithRetry
    const createStream = async (model: string, systemInstruction: string, contents: any[], opts: { temperature?: number; maxTokens?: number; tools?: any; thinkingConfig?: any } = {}) => {
      if (isAnthropicModel && anthropic) {
        const msgs: Anthropic.MessageParam[] = contents
          .map((c: any) => ({
            role: c.role === "model" ? "assistant" : "user",
            content: (c.parts as any[]).filter(p => p.text).map(p => ({ type: "text" as const, text: p.text }))
          } as Anthropic.MessageParam))
          .filter((m: any) => (m.content as any[]).length > 0);
        const stream = await anthropic.messages.stream({ model, max_tokens: opts.maxTokens ?? 65536, system: systemInstruction, messages: msgs });
        return {
          [Symbol.asyncIterator]: async function*() {
            for await (const ev of stream) {
              if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
                yield { candidates: [{ content: { parts: [{ text: ev.delta.text }] }, finishReason: undefined }] };
              if (ev.type === "message_stop")
                yield { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] };
            }
          }
        } as any;
      }
      return await ai.models.generateContentStream({
        model, contents,
        ...(opts.tools ? { tools: opts.tools } : {}),
        config: { systemInstruction, temperature: opts.temperature ?? 1.0, maxOutputTokens: opts.maxTokens ?? 65536, ...(opts.thinkingConfig ? { thinkingConfig: opts.thinkingConfig } : {}) },
      }) as any;
    };

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
                  const r = await createStream(MODEL_ID, `${BASE_SYSTEM_PROMPT}\n\n${systemPrompt}`, contents, {
                    temperature, maxTokens: maxTokens,
                    tools: noTools ? undefined : [{ functionDeclarations: [readFileDecl] }],
                    thinkingConfig,
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
              () => createStream(MODEL_ID, PRESENTER_PROMPT, presenterContents, { temperature: 0.8, maxTokens: 2048 }),
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

            // Inject ALL files with line numbers for MICRO_EDIT
            const allFilesSnapshotMicro = (() => {
              const files = currentProjectFiles ?? [];
              if (files.length === 0) return "";
              let total = 0;
              const parts: string[] = ["\nFICHIERS DU PROJET — numéros de ligne EXACTS :"];
              for (const f of files) {
                const numbered = f.content.split("\n").map((l, i) => `${String(i+1).padStart(4," ")} | ${l}`).join("\n");
                const block = `\n=== ${f.path} ===\n${numbered}`;
                if (total + block.length > 50000) {
                  parts.push(`\n=== ${f.path} (trop grand — utilise readFile("${f.path}")) ===`);
                } else { parts.push(block); total += block.length; }
              }
              return parts.join("");
            })();

            const microInput = [
              "DEMANDE :",
              lastUserMsg,
              "",
              "AVANT DE CODER : raisonne dans ta réflexion sur la NATURE de cette demande.",
              "Si c'est visuel → edit_file ciblé avec les numéros EXACTS ci-dessous. Si c'est une feature → flux complet.",
              "",
              projectContext,
              allFilesSnapshotMicro,
              "",
              "Utilise les numéros de ligne ci-dessus (EXACTS) pour tes edit_file sur n'importe quel fichier.",
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
              emit("[TSC:WAIT] Délai 35s avant vérification TypeScript...\n");
              await sleep(35000);
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
          const allGeneratedFiles: { path: string; content: string }[] = [];

          // Génère le snapshot de TOUS les fichiers avec numéros de ligne
          // Utilisé par chaque agent pour faire des edit_file précis
          const buildAllFilesSnapshot = (maxChars = 80000): string => {
            let total = 0;
            const parts: string[] = [];
            for (const f of allGeneratedFiles) {
              const numbered = f.content.split("\n")
                .map((l, i) => `${String(i+1).padStart(4," ")} | ${l}`)
                .join("\n");
              const block = `=== ${f.path} (${f.content.split("\n").length} lignes) ===\n${numbered}`;
              if (total + block.length > maxChars) {
                parts.push(`=== ${f.path} (trop grand — utilise readFile("${f.path}") pour lire) ===`);
              } else {
                parts.push(block);
                total += block.length;
              }
            }
            return parts.join("\n\n---\n\n");
          };

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

            // Priorité : palette pré-calculée côté client (canvas, précision pixel)
            // Fallback : extraction serveur via sharp si pas reçue
            let colorSummary = "";
            if (referenceColorMaps && referenceColorMaps.length > 0) {
              // Client sent precise zone-based color maps — use them directly
              colorSummary = referenceColorMaps.join(" || IMG_SEPARATOR || ");
            } else {
              // Fallback: server-side extraction
              const colorExtractions = await Promise.all(
                effectiveReferenceImages.slice(0, 3).map(img => extractDominantColorsFromBase64(img))
              );
              const allColors = colorExtractions.flat();
              const byZone: Record<string, { hex: string; coverage: number }[]> = {};
              for (const c of allColors) {
                if (!byZone[c.zone]) byZone[c.zone] = [];
                byZone[c.zone].push({ hex: c.hex, coverage: c.coverage });
              }
              colorSummary = Object.entries(byZone)
                .map(([zone, cols]) => `${zone}:${cols.map(c => `${c.hex}(${c.coverage}%)`).join(",")}`)
                .join("|");
            }

            // Couleurs des images uploadées (portraits, captures d'écran ajoutées par l'utilisateur)
            const uploadedColorInfo = (uploadedColorMaps && uploadedColorMaps.length > 0)
              ? `\nCouleurs des images uploadées :\n${uploadedColorMaps.join("\n")}`
              : "";

            const designInput = `
Demande : "${lastUserMsg}"

════════════════════════════════════════════════════════════════════
PALETTE DE COULEURS PIXEL-EXACTE PAR ZONE — OBLIGATION ABSOLUE
Extraite pixel par pixel depuis les images de référence
Tu DOIS utiliser ces hex EXACTEMENT pour chaque zone — AUCUNE substitution
════════════════════════════════════════════════════════════════════
${colorSummary}
${uploadedColorInfo}

════════════════════════════════════════════════════════════════════
MISSION : ULTRA-ANALYSE PUIS HTML/CSS PIXEL-PERFECT
════════════════════════════════════════════════════════════════════

ÉTAPE 1 — ULTRA-ANALYSE EXHAUSTIVE (dans ta réflexion — OBLIGATOIRE avant tout code)
Analyse CHAQUE élément visible dans les images, même les plus insignifiants :

COULEURS — utilise la palette ci-dessus pour CHAQUE zone :
  • Fond body/page : hex exact depuis full-image
  • Sidebar background : hex exact depuis sidebar-left
  • Header/topbar : hex exact depuis header-bar  
  • Cards/panels : hex exact depuis card-area
  • Contenu principal : hex exact depuis main-content
  • Texte primaire, secondaire, désactivé : hex exact
  • Accents, CTA, boutons actifs : hex exact
  • Bordures, séparateurs : hex exact + opacité si semi-transparent
  • Aucune couleur inventée — tout depuis la palette fournie

LAYOUT & PROPORTIONS :
  • Width sidebar (ex: 240px ou 20% de la page)
  • Height header (ex: 56px)
  • Padding interne de chaque zone (top/right/bottom/left)
  • Grid/Flex: nombre de colonnes, gaps, justification

TYPOGRAPHIE :
  • Font-family (sans-serif, serif, monospace, ou nom Google Font reconnaissable)
  • Tailles h1/h2/h3/body/caption en px/rem
  • Font-weight des éléments importants
  • Letter-spacing, line-height observés

COMPOSANTS (analyser UN PAR UN, même les détails minuscules) :
  • Sidebar : items nav, icônes, indicateur actif, spacing
  • Header : logo, titre, actions droite, border-bottom
  • Cards : radius exact (ex: 12px), shadow (ex: 0 2px 8px rgba(0,0,0,.12)), border, padding
  • Boutons : filled/outline/ghost, radius, padding, shadow hover
  • Inputs : border-style, radius, focus-ring couleur
  • Badges/tags : shape, taille, couleurs background/text
  • Icônes : style outline/solid, taille en px
  • Séparateurs : épaisseur, couleur, opacité
  • États hover/active/focus : décrire les changements visuels

EFFETS VISUELS :
  • Shadows (valeurs exactes si visibles)
  • Gradients : direction + couleurs hex
  • Glassmorphism/backdrop-blur si présent
  • Border-radius de chaque type de composant
  • Transitions/animations suggérées

ÉTAPE 2 — GÉNÈRE LE HTML/CSS
- Variables CSS :root{} avec TOUTES les couleurs de la palette
- Reproduire CHAQUE composant identifié pixel-perfect
- Couvrir TOUS les états (normal, hover, active, focus, disabled)
- Inclure les effets (shadows, transitions, radius) observés
- Même les éléments insignifiants (séparateurs, badges, petits indicateurs)
`;

            const designContents: { role: "user" | "model"; parts: any[] }[] = [];
            const refParts = effectiveReferenceImages.map(img => ({
              inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) }
            }));
            designContents.push({ role: "user", parts: [...refParts, { text: designInput }] });

            try {
              const designOutput = await callWithRetry(
                () => createStream(MODEL_ID, `${BASE_SYSTEM_PROMPT}\n\n${DESIGN_AGENT_PROMPT}`, designContents, { temperature: 1.0, maxTokens: 65536, thinkingConfig: { thinkingLevel: "HIGH" as const, includeThoughts: true } }),
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

          // ── THINK : contexte profond + TODO avant d'agir (Claude Code phase 1) ──
          const _deepCtx = buildDeepContext(allGeneratedFiles, lastUserMsg);
          const _todoCtx = buildTodoContext(lastUserMsg);

          const foundationInput = `
DEMANDE : "${lastUserMsg}"

${activeDesignAnchor}

${_deepCtx}

${_todoCtx}

${projectContext}

Génère l'application complète :
- app/page.tsx : routeur + navigation entre views
- components/views/*.tsx : une view par section principale, logique complète dedans
- components/ui/*.tsx : composants réutilisables
- app/globals.css, app/layout.tsx, tailwind.config.ts
`;          const foundationOutput = await runAgent(FOUNDATION_PROMPT, foundationInput, {
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

          // ── VERIFY : feedback loop syntaxique sur Foundation ──────────
          {
            const _verify = verifyAgentOutput(allGeneratedFiles, "FOUNDATION");
            emit(`\n[VERIFY:FOUNDATION] ${_verify.severity === "ok" ? "✅ OK" : _verify.issues.join(" | ")}\n`);
            (globalThis as any)._foundationIssues = _verify.issues;
          }


          await sleep(2000);

          // ─────────────────────────────────────────────────────────────
          // PHASE 2 — CHECKER (complétion de app/page.tsx)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:2/CODE_VERIFY]\n");

          const foundationSummary = allGeneratedFiles
            .map((f) => `=== ${f.path} ===\n${f.content}`)
            .join("\n---\n");

          const validatorWarning = (globalThis as any)._validatorWarning ?? "";

          // ── THINK : réévalue le contexte après Foundation + issues détectés ──
          const _deepCtxChecker = buildDeepContext(allGeneratedFiles, lastUserMsg);
          const _foundationIssues: string[] = (globalThis as any)._foundationIssues ?? [];

          const uiInput = `
DEMANDE : "${lastUserMsg}"

${activeDesignAnchor}

${_deepCtxChecker}

${_foundationIssues.length > 0 ? `⚠️ PROBLÈMES DÉTECTÉS PAR VERIFY (à corriger EN PREMIER) :\n${_foundationIssues.map((i: string) => "  · " + i).join("\n")}` : "✅ Aucun problème critique à corriger"}

CURRENT FILES WITH EXACT LINE NUMBERS (for edit_file):
${buildAllFilesSnapshot(50000)}

Utilise ces numéros de ligne exacts pour tes edit_file.
Corrige les problèmes listés. Complète la logique dans chaque view.
Si une view manque pour une fonctionnalité demandée → crée-la complète.

${projectContext}
`;

          // ── ACT : Checker corrige et complète ──────────────────────────
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

          // ── VERIFY : feedback loop syntaxique après Checker ──────────
          {
            const _v = verifyAgentOutput(allGeneratedFiles, "CHECKER");
            emit(`\n[VERIFY:CHECKER] ${_v.severity === "ok" ? "✅ OK" : _v.issues.join(" | ")}\n`);
            (globalThis as any)._checkerIssues = _v.issues;
          }


          await sleep(2000);

          // ── THINK : contexte mis à jour pour Views ──────────────────────
          const _checkerIssues: string[] = (globalThis as any)._checkerIssues ?? [];
          const viewsInput = `
DEMANDE : "${lastUserMsg}"

${activeDesignAnchor}

${effectiveReferenceImages.length > 0 ? "DES IMAGES DE RÉFÉRENCE SONT JOINTES. Reproduis le design fidèlement." : ""}

${_checkerIssues.length > 0 ? `⚠️ PROBLÈMES RESTANTS (à corriger) :\n${_checkerIssues.map((i: string) => "  · " + i).join("\n")}` : "✅ Aucun problème critique restant"}

CURRENT FILES WITH EXACT LINE NUMBERS (for edit_file):
${buildAllFilesSnapshot(50000)}

Utilise ces numéros de ligne exacts. readFile("chemin") si fichier trop grand.
Finalise le design sur chaque view. Crée les views manquantes si nécessaire.
Vérifie que app/page.tsx importe toutes les views.

${projectContext}
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

          // ── VERIFY : feedback loop syntaxique après Views ─────────────
          {
            const _vViews = verifyAgentOutput(allGeneratedFiles, "VIEWS");
            emit(`\n[VERIFY:VIEWS] ${_vViews.severity === "ok" ? "✅ OK" : _vViews.issues.join(" | ")}\n`);
          }


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
            // All generated files with line numbers for accurate edit_file
            const integratorFileContents = buildAllFilesSnapshot(50000);

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

          // ── Détecteur de syntaxe Zustand : déséquilibre accolades ────────────
          const checkZustandBalance = (code: string): boolean => {
            // Extrait le bloc create<>()((set) => ({ ... })) et vérifie l'équilibre
            const createMatch = code.match(/create<[^>]*>\s*\(\s*\)\s*\(\s*\(set(?:,\s*get)?\)\s*=>\s*\(\{([\s\S]*)\}\)\s*\)/);
            if (!createMatch) return false;
            const body = createMatch[1];
            let depth = 0;
            let inStr = false; let sc = '';
            for (let i = 0; i < body.length; i++) {
              const ch = body[i];
              if (inStr) { if (ch === sc && body[i-1] !== '\\') inStr = false; continue; }
              if (ch === '"' || ch === "'" || ch === '`') { inStr = true; sc = ch; continue; }
              if (ch === '{' || ch === '(') depth++;
              if (ch === '}' || ch === ')') { depth--; if (depth < 0) return true; }
            }
            return depth !== 0;
          };

          // ── Détecteur de Zustand utilisé pour l'état serveur ─────────────────
          // Zustand avec tracks, clips, projects, items... = violation architecturale
          const SERVER_STATE_NAMES = /(track|clip|project|item|order|user|product|note|song|layer|channel|effect|sample|video|photo|file|record|session|task|event|message|post|comment|category)\w*/i;
          const hasZustandServerState = (code: string, path: string): boolean => {
            if (!code.includes('create<')) return false;
            if (path.includes('useUI') || path.includes('UIStore')) return false; // UI store = OK
            // Cherche des propriétés Zustand qui sont des tableaux d'entités serveur
            const arrayProps = [...code.matchAll(/(\w+)\s*:\s*\[\s*\]/g)].map(m => m[1]);
            return arrayProps.some(name => SERVER_STATE_NAMES.test(name));
          };

          // Détection légère d'erreurs manifestes
          // Vérification spéciale pour app/page.tsx — déséquilibre JSX
          const checkPageTsx = (code: string): { ok: boolean; issue: string } => {
            // Compte les { et } (hors strings et commentaires)
            let braces = 0; let parens = 0;
            let inStr = false; let strCh = ''; let inLineComment = false; let inBlockComment = false;
            for (let i = 0; i < code.length; i++) {
              const ch = code[i]; const next = code[i+1] || '';
              if (inLineComment) { if (ch === "\n") inLineComment = false; continue; }
              if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
              if (!inStr && ch === '/' && next === '/') { inLineComment = true; continue; }
              if (!inStr && ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
              if (inStr) { if (ch === strCh && code[i-1] !== '\\') inStr = false; continue; }
              if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
              if (ch === '{') braces++; else if (ch === '}') braces--;
              if (ch === '(') parens++; else if (ch === ')') parens--;
            }
            if (braces !== 0) return { ok: false, issue: `Accolades déséquilibrées: ${braces > 0 ? '+' : ''}${braces} (edit_file a cassé la structure)` };
            if (parens !== 0) return { ok: false, issue: `Parenthèses déséquilibrées: ${parens > 0 ? '+' : ''}${parens}` };
            return { ok: true, issue: '' };
          };

          const obviousErrors = allGeneratedFiles.filter((f) => {
            const c = f.content;
            return (
              // app/page.tsx avec accolades/parenthèses déséquilibrées (edit_file destructeur)
              (f.path === "app/page.tsx" && (() => {
                const check = checkPageTsx(c);
                return !check.ok;
              })()) ||
              // Zustand void; dans le corps du create (hors interface)
              (f.path.endsWith(".ts") && c.includes("create<") &&
                (() => {
                  const withoutInterfaces = c.replace(/interface\s+\w+[\s\S]*?\n\}/g, "");
                  return /:\s*\(\s*\)\s*=>\s*void\s*;/.test(withoutInterfaces);
                })()) ||
              // Zustand avec déséquilibre d'accolades
              (f.path.endsWith(".ts") && checkZustandBalance(c)) ||
              // Zustand utilisé pour état serveur (architectural violation)
              (f.path.endsWith(".ts") && hasZustandServerState(c, f.path)) ||
              // Accès à propriété sur valeur potentiellement undefined (→ runtime TypeError)
              // Cherche des patterns comme .map() .filter() sur une variable non initialisée
              (f.path.endsWith(".tsx") && (() => {
                // Check for .map() or .filter() on values that could be undefined
                const dangerousAccess = /(\w+)\.map\(|(\w+)\.filter\(|(\w+)\.find\(|(\w+)\.forEach\(/.test(c);
                // Check if those variables have a default value or optional chaining
                const hasNoSafeDefault = dangerousAccess && 
                  /useState\(\)|useState<[^>]+>\(\)/.test(c) &&
                  !/useState\(\[\]\)|useState<[^>]+>\(\[\]\)/.test(c);
                return false; // Trop de faux positifs - désactivé, laisse TSC gérer
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
              .map((f) => {
                const numbered = f.content.split("\n").map((l, i) => `${String(i+1).padStart(4," ")} | ${l}`).join("\n");
                return `\n=== ${f.path} (${f.content.split("\n").length} lignes) ===\n${numbered}`;
              })
              .join("\n");

            const polishInput = `
Ces fichiers contiennent des erreurs détectées automatiquement. Corrige-les :

${errorContext}

ERREURS DÉTECTÉES :
${allGeneratedFiles.find((f) => f.path.includes("store") && f.content.includes(": () => void;")) ? "- Zustand: void; trouvé dans le corps create()" : ""}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && !f.content.includes('"use client"')).map((f) => `- "use client" manquant : ${f.path}`).join("\n")}
${allGeneratedFiles.filter((f) => f.path.includes("views/") && /export\s+default/.test(f.content)).map((f) => `- export default au lieu de named export : ${f.path}`).join("\n")}
${allGeneratedFiles.find((f) => f.path.endsWith("globals.css") && /@apply\s+border-border/.test(f.content)) ? "- globals.css: @apply border-border sans tailwind.config.ts" : ""}

${allGeneratedFiles.filter(f => f.path.endsWith(".ts") && hasZustandServerState(f.content, f.path))
  .map(f => `- ARCHITECTURAL VIOLATION : ${f.path} utilise Zustand pour stocker des données serveur. Convertis en custom hook (useState + fetch) — ne génère PAS un store Zustand pour ces données.`)
  .join("\n")}
${allGeneratedFiles.filter(f => f.path.endsWith(".ts") && checkZustandBalance(f.content))
  .map(f => `- Zustand déséquilibré dans ${f.path} — accolade ou parenthèse manquante dans create<>`)
  .join("\n")}

${allGeneratedFiles.filter(f => f.path === "app/page.tsx" && !checkPageTsx(f.content).ok)
  .map(f => `- CRITIQUE app/page.tsx : ${checkPageTsx(f.content).issue}. Renvoie le fichier COMPLET corrigé via create_file (JAMAIS edit_file).`)
  .join("\n")}

Corrige UNIQUEMENT ces fichiers. Renvoie le fichier COMPLET corrigé via create_file.
Pour app/page.tsx : TOUJOURS create_file, JAMAIS edit_file.
Pour les violations Zustand serveur : convertis en custom hook, ne garde PAS le store.
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
          // PHASE 4c — PACKAGE.JSON ANTICIPÉ (émis avant TSC pour survivre aux crashes)
          // Si le stream se coupe pendant TSC, le package.json est déjà livré au client.
          // ─────────────────────────────────────────────────────────────
          {
            const earlyBaseDeps: Record<string, string> = {
              next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
              "lucide-react": "0.475.0", sharp: "0.33.5",
              clsx: "2.1.1", "tailwind-merge": "2.3.0", zustand: "4.5.2",
              "@e2b/code-interpreter": "^1.0.0",
            };
            const earlyBaseDev: Record<string, string> = {
              typescript: "^5", "@types/node": "^20", "@types/react": "^19",
              "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1",
              autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3",
            };
            // Résout rapidement les packages collectés (sans appel réseau pour les inconnus)
            const earlyDeps: Record<string, string> = { ...earlyBaseDeps };
            const earlyDevDeps: Record<string, string> = { ...earlyBaseDev };
            // Ajoute ce qu'on a déjà collecté (packages connus via DEPENDENCIES: [...])
            for (const pkg of Array.from(globalPkgs)) {
              if (pkg && !earlyDeps[pkg] && !earlyDevDeps[pkg]) {
                earlyDeps[pkg] = "latest"; // sera affiné en PHASE 5b si nécessaire
              }
            }
            const earlyPkg = {
              name: "app", version: "1.0.0", private: true,
              scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
              dependencies: earlyDeps,
              devDependencies: earlyDevDeps,
            };
            emit(`\n---\n<create_file path="package.json">\n${JSON.stringify(earlyPkg, null, 2)}\n</create_file>`);
            emit("\n[PKG:EARLY] ✅ package.json anticipé émis — survit aux interruptions de stream\n");
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 5 — TSC CHECK E2B (vérification TypeScript réelle)
          // Reproduit ce que Lovable/v0 font : sandbox isolé, tsc --noEmit,
          // boucle de correction automatique si des erreurs sont trouvées.
          // Transparent pour l'utilisateur — ne bloque pas le stream.
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:5/TSC_CHECK]\n");

          // ── Fallback syntaxique LOCAL (même sans E2B) ──────────────────────
          // Attrape les erreurs Zustand / virgules / accolades sans sandbox
          if (!e2bApiKey) {
            const syntaxIssues: string[] = [];
            for (const f of allGeneratedFiles) {
              if (!f.path.endsWith(".ts") && !f.path.endsWith(".tsx")) continue;
              const c = f.content;
              // Zustand void;
              const withoutInterfaces = c.replace(/interface\s+\w+[\s\S]*?\n\}/g, "");
              if (c.includes("create<") && /:\s*\(\s*\)\s*=>\s*void\s*;/.test(withoutInterfaces)) {
                syntaxIssues.push(`${f.path}: Zustand void; dans create() — remplace par implémentation avec set()`);
              }
              // "use client" manquant
              if (f.path.includes("views/") && !c.includes('"use client"') && !c.includes("'use client'")) {
                syntaxIssues.push(`${f.path}: "use client" manquant ligne 1`);
              }
            }
            if (syntaxIssues.length > 0) {
              emit("\n[SYNTAX:LOCAL] ⚠️ Erreurs syntaxiques détectées sans E2B :\n" + syntaxIssues.join("\n") + "\n");
              const localFixInput = [
                "ERREURS SYNTAXIQUES DÉTECTÉES AUTOMATIQUEMENT :",
                syntaxIssues.join("\n"),
                "",
                "FICHIERS CONCERNÉS :",
                ...syntaxIssues.map(issue => {
                  const path = issue.split(":")[0].trim();
                  const f = allGeneratedFiles.find(g => g.path === path);
                  return f ? `\n=== ${f.path} ===\n${f.content}` : "";
                }),
                "",
                "Corrige ces fichiers. Renvoie chaque fichier COMPLET corrigé avec <create_file>.",
              ].join("\n");
              try {
                const localFixOut = await runAgent(FIXER_PROMPT, localFixInput, {
                  temperature: 0.2, maxTokens: 65536, agentName: "SYNTAX_FIXER", noTools: true
                });
                flushBuffer();
                mergeGeneratedFiles(parseGeneratedFiles(localFixOut));
              } catch {}
            }
          }

          if (e2bApiKey) {
            const MAX_TSC_FIX_ROUNDS = 5; // max 5 rounds de correction — sécurité anti-boucle infinie

            // Délai avant le premier check TSC — les agents précédents ont chauffé le LLM
            emit("[TSC:WAIT] Délai 35s avant vérification TypeScript...\n");
            await sleep(35000);

            // Premier check TSC
            let tscResult = await runTscCheck(buildTscFiles(allGeneratedFiles, currentProjectFiles), e2bApiKey, emit);
            let round = 0;

            // Boucle : on continue tant qu'il y a des erreurs ET qu'on n'a pas atteint la limite
            while (tscResult.hasErrors && round < MAX_TSC_FIX_ROUNDS) {
              // ── Délai avant le fixer — Gemini a déjà enchaîné 3+ agents ──────────────
              // Sans délai, on risque un 429 / RESOURCE_EXHAUSTED
              const fixerDelay = round === 0 ? 35000 : 30000;
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
              () => createStream(MODEL_ID, `${BASE_SYSTEM_PROMPT}\n\n${PRESENTER_OUTRO_PROMPT}`, [{ role: "user", parts: [{ text: summaryInput }] }], { temperature: 0.7, maxTokens: 65536, thinkingConfig: { thinkingLevel: "LOW" as const } }),
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
