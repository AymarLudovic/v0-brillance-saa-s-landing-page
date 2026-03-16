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

╔══════════════════════════════════════════════════════════════════════╗
║  LOI N°1 — REACT EST UNE TÉLÉCOMMANDE. PYTHON EST L'APPAREIL.      ║
║  S'applique à TOUS les agents. Aucune exception.                    ║
╚══════════════════════════════════════════════════════════════════════╝

React ne contient AUCUNE logique fonctionnelle. Il affiche et envoie des requêtes.
Python reçoit, traite, stocke, calcule, exporte. Tout.

  React fait : onClick → fetch POST /api/py/action → affiche la réponse
  Python fait : reçoit → traite avec ses libs → retourne JSON ou FileResponse

  ❌ JAMAIS dans React : logique métier, calcul, transformation, gestion d'entités
  ✅ TOUJOURS dans Python : toute fonctionnalité qui fait quelque chose de réel

╔══════════════════════════════════════════════════════════════════════╗
║  LOI N°2 — PAS DE ZUSTAND POUR L'ÉTAT SERVEUR                      ║
╚══════════════════════════════════════════════════════════════════════╝

Zustand cause trop d'erreurs de syntaxe (virgules, void, accolades).
Pour l'état qui vient de Python → custom hooks simples uniquement :

  // Pattern obligatoire pour toute donnée venant de Python :
  export function useTracks() {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchTracks = async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/py/tracks');
        setTracks(await r.json());
      } catch(e) { setError(String(e)); }
      finally { setLoading(false); }
    };

    const addTrack = async (type: string) => {
      const r = await fetch('/api/py/tracks/create', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ type })
      });
      const track = await r.json();
      setTracks(prev => [...prev, track]);  // update optimiste
    };

    useEffect(() => { fetchTracks(); }, []);
    return { tracks, loading, error, addTrack, fetchTracks };
  }

  Zustand est UNIQUEMENT autorisé pour état UI pur global :
  ✅ useUIStore → { sidebarOpen, setSidebarOpen, theme, setTheme, activeModal, setActiveModal }
  ❌ JAMAIS useProjectStore avec des pistes, clips, effets, etc.

══════════════════════════════════════════════════════════════════════
STACK UNIVERSELLE — CE QUE TU GÉNÈRES
══════════════════════════════════════════════════════════════════════

COUCHE BACKEND PYTHON — FastAPI (port 8000, dossier /backend)
  TOUJOURS GÉNÉRÉE. SANS EXCEPTION. POUR TOUT PROJET.
  Python est le cerveau. Il porte 100% des fonctionnalités.

  Ce que Python fait dans CHAQUE projet :
  - Toute la logique métier (créer, lire, modifier, supprimer des données)
  - Tout traitement (calcul, transformation, encodage, analyse)
  - Tout ce qui touche à des fichiers (lecture, écriture, export)
  - Toutes les connexions à des services externes (APIs, bases de données, mails)
  - Tous les algorithmes (tri, filtrage complexe, génération, IA/ML)
  - Tous les exports (PDF, audio, vidéo, ZIP, CSV)
  - WebSockets pour toute communication temps réel
  - Automatisation (Playwright, scraping)

  Il n'existe AUCUNE fonctionnalité utilisateur qui vit uniquement dans React.
  Si l'utilisateur peut "faire" quelque chose → Python a un endpoint pour ça.

  ARCHITECTURE OBLIGATOIRE DU BACKEND :
  main.py ne contient QUE les routes (décorateurs @app.xxx). La logique est dans les services.
  backend/
  ├── main.py                   ← routes uniquement, importe depuis services/
  ├── services/
  │   ├── [domaine]_service.py  ← toute la logique métier du domaine
  │   └── ...                   ← un fichier par domaine fonctionnel
  ├── models/
  │   └── schemas.py            ← Pydantic models
  └── requirements.txt

  Exemple Final Cut Pro :
  services/timeline_service.py  → couper/déplacer/redimensionner clips
  services/effects_service.py   → transitions, filtres, effets visuels
  services/audio_service.py     → mixage, sync, EQ, volume par piste
  services/export_service.py    → ffmpeg encode MP4/MOV final

  TOUS LES AGENTS peuvent et doivent enrichir backend/services/ s'ils découvrent
  une fonctionnalité non couverte par Foundation. Personne n'est limité au frontend.

  PATTERN IMPORT/SINGLETON — OBLIGATOIRE POUR CHAQUE SERVICE :

  Chaque fichier service se termine par une instance singleton :
    class ExpenseService:
        async def get_expenses(self): ...
        async def add_expense(self, data): ...
    expense_service = ExpenseService()   ← instance singleton, exportée

  main.py importe l'instance (jamais la classe) :
    from services.expense_service import expense_service
    from services.export_service import export_service

  Les routes n'ont JAMAIS le préfixe /api/py/ :
    ✅ @app.get("/expenses")         ← React appelle /api/py/expenses → rewrite → /expenses
    ❌ @app.get("/api/py/expenses")  ← FAUX, double préfixe, route inaccessible

  Architecture : /backend/main.py (FastAPI) + /backend/requirements.txt
  Next.js proxifie /api/py/* → http://localhost:8000/* (via next.config.ts rewrites)

COUCHE FRONTEND — React + Next.js 15 + TypeScript
  Rôle unique et limité : afficher + capturer les interactions + appeler Python.
  React ne fait RIEN d'autre que ça.

  Ce que React contient :
  - Les pages et composants visuels (JSX, Tailwind)
  - Les appels fetch vers /api/py/... déclenchés par les interactions
  - L'affichage des données retournées par Python
  - L'état visuel pur : quel onglet actif, modal ouvert, valeur d'input en cours
  - Exception zéro-latence : Web Audio API pour sons instantanés au clic (< 5ms)

  Ce que React ne contient JAMAIS :
  - Aucune logique fonctionnelle
  - Aucun algorithme ou calcul
  - Aucune gestion d'entités (pas de addTrack, deleteClip, applyEffect en local)
  - Aucune donnée qui doit persister ou être exportée

  State management :
  - Données de Python → custom hooks (useState + fetch) — jamais Zustand
  - État UI global partagé → Zustand UNIQUEMENT (sidebarOpen, theme, activeModal)
  Styling : Tailwind CSS.

COUCHE PERFORMANCE — Rust/WASM (uniquement si calcul < 5ms requis côté client)
  Cas très spécifiques : synthèse audio sample-accurate, shader WebGL, crypto wallet
  Structure : /wasm-modules/<nom>/Cargo.toml + src/lib.rs

COUCHE TEMPS RÉEL — WebSocket FastAPI + hook React
  Pour : chat, collaboration live, streaming résultats Python en temps réel

COUCHE GRAPHIQUE — WebGL/WebGPU/Three.js
  Pour : visualisations 3D, jeux, éditeurs graphiques canvas

══════════════════════════════════════════════════════════════════════
RÈGLE FONDAMENTALE — RÉFLEXE AVANT TOUT CODE
══════════════════════════════════════════════════════════════════════

Pour chaque fonctionnalité demandée, pose UNE seule question :
"Est-ce que l'utilisateur fait quelque chose, ou juste voit quelque chose ?"

→ Il FAIT quelque chose (crée, modifie, exporte, calcule, enregistre, analyse) :
   PYTHON. Endpoint complet. Immédiatement. Sans discussion.

→ Il VOIT quelque chose (affichage, mise en page, animation) :
   React affiche ce que Python lui a donné.

Il n'y a pas d'autre décision à prendre.
Python génère les fonctionnalités. React les affiche.

EXEMPLES — réponse toujours Python :
"Contrôler Chrome"     → Python + Playwright
"Trading connecté"     → Python + ccxt
"DAW audio"            → Python + pydub/librosa (son immédiat React Web Audio = seule exception)
"Chat temps réel"      → FastAPI WebSocket
"Wallet crypto"        → Python + web3.py
"Éditeur graphique"    → Python gère les calques/export, Canvas React affiche
"Montage vidéo"        → Python + ffmpeg/moviepy, React affiche la timeline
"IA / chatbot"         → Python + openai/transformers, React affiche la réponse
"Gestion de données"   → Python CRUD complet, React affiche et envoie les formulaires

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

Backend Python (TOUJOURS) :
  backend/main.py          → FastAPI app + TOUTES les routes fonctionnelles
  backend/requirements.txt → Python packages
  backend/services/        → Logique métier Python (une classe par domaine)
  backend/models/          → Pydantic models (schémas des entités)
  backend/__init__.py      → fichier vide obligatoire

WASM (si calcul intensif) :
  wasm-modules/<nom>/Cargo.toml
  wasm-modules/<nom>/src/lib.rs

══════════════════════════════════════════════════════════════════════
COMMUNICATION FRONTEND ↔ BACKEND PYTHON
══════════════════════════════════════════════════════════════════════

HTTP REST : fetch("/api/py/endpoint") → proxifié vers FastAPI port 8000
WebSocket : new WebSocket(proto + '//' + window.location.host + '/api/py/ws/...') — JAMAIS localhost:8000 directement
CORS : configuré dans FastAPI (middleware déjà dans main.py de base)

╔══════════════════════════════════════════════════════════════════════╗
║  3 RÈGLES FASTAPI CRITIQUES — VIOLATION = UI NE REÇOIT RIEN        ║
╚══════════════════════════════════════════════════════════════════════╝

RÈGLE A — CORSMiddleware OBLIGATOIRE EN PREMIER (avant toutes les routes) :
  Sans lui, le navigateur bloque SILENCIEUSEMENT toutes les requêtes Next.js→FastAPI.
  Le fetch() retourne une erreur réseau, l'UI ne reçoit jamais les données.
  Structure TOUJOURS présente en haut de main.py :

  from fastapi.middleware.cors import CORSMiddleware
  app = FastAPI()
  app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                     allow_methods=["*"], allow_headers=["*"])

RÈGLE B — @app.get("/health") TOUJOURS présent :
  Sans lui, le sandbox pense que FastAPI n'a pas démarré et le coupe.
  @app.get("/health")
  def health(): return {"status": "ok"}

RÈGLE E — TOUS les services générés DOIVENT être importés dans main.py :
  Si tu crées 5 fichiers dans backend/services/, il doit y avoir 5 imports dans main.py.
  Un service non importé = ses endpoints n'existent pas = l'UI reçoit une erreur 404.

  ❌ FAUX — 5 services créés, 3 importés (video_service et audio_service oubliés) :
  from services.project_service import project_service
  from services.library_service import library_service
  from services.export_service import export_service
  # ← video_service et audio_service existent mais sont silencieusement ignorés

  ✅ CORRECT — tous les services importés, tous utilisés :
  from services.project_service import project_service
  from services.library_service import library_service
  from services.export_service import export_service
  from services.video_service import video_service      ← obligatoire
  from services.audio_service import audio_service      ← obligatoire

  CHECKLIST AVANT D'ÉMETTRE main.py :
  → Liste tous les fichiers que tu as créés dans backend/services/
  → Vérifie que chaque fichier a son import correspondant dans main.py
  → Vérifie que chaque service importé est réellement utilisé dans au moins un endpoint
  → Un endpoint qui appelle video_service mais sans l'importer = ImportError au démarrage

RÈGLE C — ORDRE DES ROUTES : statiques AVANT paramétrées (TOUJOURS, quel que soit le projet)
  FastAPI matche les routes dans l'ordre de déclaration.
  Toute route statique déclarée APRÈS une route paramétrée du même préfixe sera avalée.

  Principe : dans un même groupe de routes, ordonne du plus spécifique au plus général.
  Plus spécifique = chemin fixe (/items/stats, /items/export, /items/count)
  Plus général = chemin avec variable (/items/{id}, /items/{item_id})

  ❌ FAUX (bug silencieux, quel que soit le nom) :
  @app.get("/[ressource]/{id}")       ← déclaré en premier
  @app.get("/[ressource]/stats")      ← avalé par le précédent → reçoit id="stats"

  ✅ CORRECT (toujours cet ordre) :
  @app.get("/[ressource]/stats")      ← fixe en premier
  @app.get("/[ressource]/export")     ← fixe en premier
  @app.get("/[ressource]/count")      ← fixe en premier
  @app.get("/[ressource]/{id}")       ← paramètre EN DERNIER

RÈGLE D — Séparation service/main.py = ZÉRO impact sur les performances :
  Le service est appelé dans le MÊME processus Python — c'est un simple appel de fonction.
  Aucun hop réseau. Aucune latence. Le résultat est identique à mettre la logique dans main.py.
  La séparation est uniquement organisationnelle.

╔══════════════════════════════════════════════════════════════════════╗
║  FORMATS XML AUTORISÉS — UNIQUEMENT CES DEUX, RIEN D'AUTRE         ║
╚══════════════════════════════════════════════════════════════════════╝

Pour interagir avec les fichiers, il n'existe QUE deux balises XML valides :

1. Créer un nouveau fichier (toujours précédé d'une ligne "---" seule) :
---
<create_file path="chemin/vers/fichier.ts">
contenu complet ici
</create_file>

2. Modifier un fichier existant :
<edit_file path="chemin/fichier.ts" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>nouveau contenu</changes_to_apply>
</edit_file>

INTERDIT — ces formats n'existent pas dans ce système et seront ignorés :
  ❌ <read_file path="..." />            → utilise l'outil readFile() à la place
  ❌ <file_changes>...</file_changes>
  ❌ <fileschanges>...</fileschanges>
  ❌ <modify_file>...</modify_file>
  ❌ <update_file>...</update_file>
  ❌ <write_file>...</write_file>
  ❌ Tout autre tag XML inventé

Pour lire un fichier : appelle l'outil readFile() — c'est la seule méthode valide.
Pour créer : <create_file>. Pour modifier : <edit_file>. C'est tout.
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
    // 2. La piste n'existe pas dans Python → données fantômes
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


// =============================================================================
// SOLO_DEV_PROMPT — Agent unique appelé en boucle 3 fois
// Remplace Foundation + Checker + Views + Integrator
// =============================================================================

const SOLO_DEV_PROMPT = `
Tu es un développeur fullstack senior solo. Tu construis ce projet de A à Z.
Tu es appelé 3 fois en séquence. Chaque appel reçoit ce que tu as déjà généré.

${BASE_SYSTEM_PROMPT}

${ERROR_PREVENTION_BIBLE}

══════════════════════════════════════════════════════════════════════
STACK TECHNIQUE — CE QUE TU GÉNÈRES
══════════════════════════════════════════════════════════════════════

FRONTEND — Next.js 15 + React 19 + TypeScript
  app/              → Pages et layouts (app router)
  components/ui/    → Composants réutilisables (Button, Card, Input, Modal...)
  components/views/ → Vues principale (DashboardView, SettingsView...)
  hooks/            → Custom hooks : useState + useEffect + fetch /api/py/...
  stores/           → Zustand UNIQUEMENT pour useUIStore (sidebarOpen, theme, activeModal)
  types/index.ts    → Interfaces TypeScript alignées sur les réponses Python
  lib/utils.ts      → cn() clsx+tailwind-merge + formatters

  RULES NEXT.JS :
  - "use client"; LIGNE 1 absolue sur tout fichier avec hooks ou events
  - Named exports pour toutes les views : export function DashboardView()
  - Imports internes avec @/ toujours (jamais ../)
  - app/page.tsx route entre les vues avec useState activeTab
  - tailwind.config.ts TOUJOURS généré
  - next.config.ts TOUJOURS avec le proxy :
    async rewrites() { return [{ source: "/api/py/:path*", destination: "http://localhost:8000/:path*" }] }

BACKEND — Python FastAPI (port 8000, dossier /backend)
  backend/main.py              → routes UNIQUEMENT (3-5 lignes max par endpoint)
  backend/services/            → TOUTE la logique métier (un fichier par domaine)
  backend/models/schemas.py    → Pydantic models
  backend/requirements.txt     → toutes les libs

  RÈGLES FASTAPI ABSOLUES :
  A) CORSMiddleware EN PREMIER dans main.py :
     from fastapi.middleware.cors import CORSMiddleware
     app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                        allow_methods=["*"], allow_headers=["*"])

  B) /health TOUJOURS :
     @app.get("/health")
     def health(): return {"status": "ok"}

  C) Routes statiques AVANT paramétrées :
     @app.get("/items/stats")   ← EN PREMIER
     @app.get("/items/{id}")    ← EN DERNIER

  D) TOUS les services importés dans main.py :
     from services.timeline_service import timeline_service
     from services.audio_service import audio_service
     (un import par fichier dans backend/services/)

  E) JSON valide dans TOUTES les réponses :
     return "ok"   INTERDIT → return {"status": "ok"}
     return True   INTERDIT → return {"success": True}
     Texte brut → "SyntaxError: Unexpected token" côté React

  F) Services = logique complète, PAS de TODO, PAS de pass :
     services/timeline_service.py  → cut_clip(), move_clip(), overlay()
     services/effects_service.py   → color_grade(), blur(), transition()
     services/audio_service.py     → mix_tracks(), apply_eq(), fade()
     services/export_service.py    → encode_mp4(), export_wav()
     services/project_service.py   → save(), load(), undo(), redo()

CONNEXION FRONTEND ↔ BACKEND :
  fetch("/api/py/endpoint")    → proxifié vers FastAPI port 8000
  JAMAIS fetch("localhost:8000/...") directement

HOOKS REACT — pattern obligatoire (jamais Zustand pour les données serveur) :
  "use client";
  export function useItems() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const fetchItems = async () => { setLoading(true); setItems(await fetch("/api/py/items").then(r=>r.json())); setLoading(false); };
    const createItem = async (data) => { const r = await fetch("/api/py/items", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}); const item = await r.json(); setItems(p=>[...p,item]); };
    const deleteItem = async (id) => { await fetch("/api/py/items/"+id,{method:"DELETE"}); setItems(p=>p.filter(i=>i.id!==id)); };
    useEffect(()=>{fetchItems();},[]);
    return { items, loading, fetchItems, createItem, deleteItem };
  }

══════════════════════════════════════════════════════════════════════
COMPORTEMENT SELON LE ROUND
══════════════════════════════════════════════════════════════════════

ROUND 1 — CONSTRUIRE :
  Génère l'application complète de zéro dans cet ordre :
  1. backend/__init__.py (vide), backend/services/*.py (logique complète), backend/models/schemas.py
  2. backend/main.py (CORSMiddleware EN PREMIER, /health, toutes les routes → services)
  3. backend/requirements.txt
  4. next.config.ts (avec proxy), types/index.ts, lib/utils.ts, tailwind.config.ts
  5. stores/useUIStore.ts (sidebarOpen, theme, activeModal uniquement)
  6. hooks/use*.ts (un par domaine Python)
  7. components/ui/*.tsx, components/views/*.tsx (câblés aux hooks)
  8. app/globals.css, app/layout.tsx, app/page.tsx

  Avant de coder, liste dans ta tête pour CHAQUE fonctionnalité :
  → service Python + méthode | endpoint main.py | hook React | vue qui l'affiche

ROUND 2 — AUDITER ET COMPLÉTER :
  Lis les fichiers existants.
  □ Endpoints Python == fonctionnalités demandées ?
  □ Tous les services importés dans main.py ?
  □ CORSMiddleware EN PREMIER ? /health présent ?
  □ Routes statiques avant paramétrées ?
  □ Toutes les réponses Python retournent du JSON valide ?
  □ Les hooks appellent /api/py/... ?
  □ "use client" ligne 1 sur tous les composants avec hooks ?
  □ Named exports sur toutes les vues ?
  □ key={...} sur tous les .map() ?
  □ app/page.tsx importe TOUTES les vues ?
  Corrige chaque problème immédiatement.

ROUND 3 — FINALISER :
  □ Connexion UI↔Python parfaite (chaque bouton → /api/py/...) ?
  □ États loading/error/empty gérés dans chaque vue ?
  □ Design fidèle au design_reference si fourni ?
  □ Données mock réalistes (min 5-8 entrées) si données vides ?

══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE
══════════════════════════════════════════════════════════════════════

CRÉER un fichier — ligne "---" seule AVANT :
---
<create_file path="chemin/fichier.ts">
contenu complet
</create_file>

MODIFIER un fichier existant :
<edit_file path="chemin/fichier.ts" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>contenu</changes_to_apply>
</edit_file>

LIRE : readFile() uniquement — JAMAIS <read_file />
INTERDIT : <file_changes>, <fileschanges>, <write_file>, <modify_file>

A la fin :
DEPENDENCIES: [...]
DEVDEPENDENCIES: [...]
PYPACKAGES: [...]
`;


// =============================================================================
// FIXER AGENT — Corrections chirurgicales
// =============================================================================

const FIXER_PROMPT = `
Tu es un agent d'implémentation et de correction de code.
Tu traites deux types de demandes : corrections d'erreurs ET ajout de fonctionnalités réelles.
Tu peux toucher TOUS les fichiers : backend/services/, main.py, hooks/, composants, vues.

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
PYPACKAGES: ["pydub", "ffmpeg-python"]  ← si nouveau service Python ajouté

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
    "FIN DE RÉPONSE : DEPENDENCIES: [\"package\"] et PYPACKAGES: [\"package-python\"] si besoin",
  ].join("\n");

  let fixOutput = "";
  try {
    fixOutput = await runAgent(SOLO_DEV_PROMPT, fixInput, {
      temperature: 1.0,
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
        tscFixOut = await runAgent(SOLO_DEV_PROMPT,
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
              emit("[TSC:WAIT] Délai 35s avant vérification TypeScript...\n");
              await sleep(35000);
              const microTscResult = await runTscCheck(buildTscFiles(workingFilesMicro, currentProjectFiles), e2bApiKey, emit);
              if (microTscResult.hasErrors) {
                await sleep(20000);
                let microTscFixOut = "";
                try {
                  microTscFixOut = await runAgent(SOLO_DEV_PROMPT,
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
          // Conversation multi-turn : accumulée tout au long de la génération et du TSC
          let devConversation: { role: "user" | "model"; parts: any[] }[] = [];
          let devSystemPromptRef = "";

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
          // ─────────────────────────────────────────────────────────────
          // ─────────────────────────────────────────────────────────────
          // GÉNÉRATION — Conversation multi-turn avec le modèle
          // Un seul modèle, une seule devConversation qui s'accumule.
          // Tour 1 : génère tout. Tour 2 : vérifie. Tour 3 : finalise.
          // ─────────────────────────────────────────────────────────────

          // Construction du system prompt complet
          const devSystemPromptRef = `${BASE_SYSTEM_PROMPT}\n\n${SOLO_DEV_PROMPT}`;

          // Parts du premier tour (demande + design + images)
          const turn1Parts: any[] = [];
          if (effectiveReferenceImages.length > 0) {
            effectiveReferenceImages.slice(0, 2).forEach(img =>
              turn1Parts.push({ inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) } })
            );
          }
          turn1Parts.push({ text: `DEMANDE : "${lastUserMsg}"\n\n${activeDesignAnchor}\n\n${projectContext}\n\nROUND 1 — Génère l'application complète de zéro.` });

          // Conversation : tableau de messages accumulés
          const devConversation: { role: "user" | "model"; parts: any[] }[] = [
            { role: "user", parts: turn1Parts }
          ];

          // Fonction helper pour un tour de devConversation streamé
          const conversationTurn = async (label: string): Promise<string> => {
            let fullOutput = "";
            let lastUsage: any = null;
            const pendingFC: any[] = [];

            const stream = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: devConversation,
                tools: [{ functionDeclarations: [readFileDecl] }],
                config: {
                  systemInstruction: devSystemPromptRef,
                  temperature: 1.0,
                  maxOutputTokens: 65536,
                  thinkingConfig: { thinkingLevel: "HIGH" as const, includeThoughts: true },
                },
              }),
              onChunk,
              { maxAttempts: 4, baseDelay: 12000, onUsage, collectedFunctionCalls: pendingFC }
            );
            fullOutput = stream;

            // Gestion tool calls (readFile) dans la devConversation
            if (pendingFC.length > 0) {
              const toolResults: any[] = [];
              for (const part of pendingFC) {
                const fc = part.functionCall;
                if (fc?.name === "readFile") {
                  const path = fc.args?.path ?? "";
                  toolResults.push({ functionResponse: { name: "readFile", response: { content: handleReadFile(path) } } });
                }
              }
              // Ajoute la réponse modèle avec function calls + les résultats dans la conv
              devConversation.push({ role: "model", parts: pendingFC });
              devConversation.push({ role: "user", parts: toolResults });
              // Second stream pour que le modèle continue après le tool
              const stream2 = await callWithRetry(
                () => ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents: devConversation,
                  config: { systemInstruction: devSystemPromptRef, temperature: 1.0, maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: "HIGH" as const } },
                }),
                onChunk,
                { maxAttempts: 3, baseDelay: 10000, onUsage }
              );
              fullOutput += stream2;
            }

            // Ajoute la réponse finale du modèle dans la devConversation
            devConversation.push({ role: "model", parts: [{ text: fullOutput }] });
            flushBuffer();
            return fullOutput;
          };

          // ── TOUR 1 : Construction ──────────────────────────────────────
          const output1 = await conversationTurn("Tour 1");
          mergeGeneratedFiles(parseGeneratedFiles(output1));
          const editOps1 = parseEditFileOps(output1);
          if (editOps1.length > 0) applyEditFileOpsToFiles(allGeneratedFiles, editOps1);
          extractDeps(output1, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(output1, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          extractDeps(output1, "PYPACKAGES").forEach(d => globalPyPkgs.add(d));
          parseGeneratedFiles(output1).forEach(f => { for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) { const p = m[1].split("/")[0]; if (p && !p.startsWith(".")) globalPkgs.add(p); } });
          registerGeneratedFiles(allGeneratedFiles);

          // Validator après tour 1
          {
            const mainPy = allGeneratedFiles.find(f => f.path === "backend/main.py");
            const bRoutes = mainPy ? [...mainPy.content.matchAll(/@app\.(get|post|put|delete|patch|websocket)\s*\(/gi)].filter(m => !mainPy.content.slice(m.index, m.index + 60).includes('/health')).length : 0;
            if (!mainPy) emit(`[VALIDATOR] ⚠️ backend/main.py ABSENT\n`);
            else emit(`[VALIDATOR] ${bRoutes} route(s) Python métier dans main.py\n`);
          }

          await sleep(3000);

          // ── TOUR 2 : Vérification ──────────────────────────────────────
          const allPathsTour2 = allGeneratedFiles.map(f => f.path).join("\n");
          devConversation.push({ role: "user", parts: [{ text: `ROUND 2 — Vérifie que tout est complet et correct.

Fichiers générés (${allGeneratedFiles.length}) :
${allPathsTour2}

Lis les fichiers clés avec readFile() si besoin. Vérifie :
- Tous les services importés dans main.py ?
- CORSMiddleware EN PREMIER ? /health présent ?
- Routes statiques avant paramétrées ?
- Toutes les réponses Python retournent du JSON valide ?
- Hooks appellent /api/py/... ?
- "use client" ligne 1 sur tous les composants ?
- Named exports sur toutes les vues ?
- app/page.tsx importe toutes les vues ?
Pour chaque problème → corrige maintenant.` }] });

          const output2 = await conversationTurn("Tour 2");
          mergeGeneratedFiles(parseGeneratedFiles(output2));
          const editOps2 = parseEditFileOps(output2);
          if (editOps2.length > 0) applyEditFileOpsToFiles(allGeneratedFiles, editOps2);
          extractDeps(output2, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(output2, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          extractDeps(output2, "PYPACKAGES").forEach(d => globalPyPkgs.add(d));
          registerGeneratedFiles(allGeneratedFiles);

          await sleep(3000);

          // ── TOUR 3 : Finalisation ──────────────────────────────────────
          devConversation.push({ role: "user", parts: [{ text: `ROUND 3 — Connexion UI↔Python et design final.

Vérifie que chaque bouton déclenche un vrai appel /api/py/...
Vérifie les états loading/error/empty dans chaque vue.
Si un design_reference a été fourni, vérifie la fidélité visuelle.
Corrige ce qui reste.` }] });

          const output3 = await conversationTurn("Tour 3");
          mergeGeneratedFiles(parseGeneratedFiles(output3));
          const editOps3 = parseEditFileOps(output3);
          if (editOps3.length > 0) applyEditFileOpsToFiles(allGeneratedFiles, editOps3);
          extractDeps(output3, "DEPENDENCIES").forEach(d => globalPkgs.add(d));
          extractDeps(output3, "DEVDEPENDENCIES").forEach(d => globalDevPkgs.add(d));
          extractDeps(output3, "PYPACKAGES").forEach(d => globalPyPkgs.add(d));
          registerGeneratedFiles(allGeneratedFiles);

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
          const obviousErrors = allGeneratedFiles.filter((f) => {
            const c = f.content;
            return (
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

${allGeneratedFiles.filter(f => f.path.endsWith(".ts") && hasZustandServerState(f.content, f.path))
  .map(f => `- ARCHITECTURAL VIOLATION : ${f.path} utilise Zustand pour stocker des données serveur. Convertis en custom hook (useState + fetch) — ne génère PAS un store Zustand pour ces données.`)
  .join("\n")}
${allGeneratedFiles.filter(f => f.path.endsWith(".ts") && checkZustandBalance(f.content))
  .map(f => `- Zustand déséquilibré dans ${f.path} — accolade ou parenthèse manquante dans create<>`)
  .join("\n")}

Corrige UNIQUEMENT ces fichiers. Renvoie le fichier COMPLET corrigé.
Pour les violations Zustand serveur : convertis en custom hook, ne garde PAS le store.
`;

            // POLISH : injecte dans la conversation pour garder le contexte
            devConversation.push({ role: "user", parts: [{ text: polishInput }] });
            const polishOutput = await callWithRetry(
              () => ai.models.generateContentStream({
                model: MODEL_ID,
                contents: devConversation,
                config: { systemInstruction: devSystemPromptRef || `${BASE_SYSTEM_PROMPT}\n\n${SOLO_DEV_PROMPT}`, temperature: 0.4, maxOutputTokens: 65536 },
              }),
              onChunk,
              { maxAttempts: 3, baseDelay: 10000, onUsage }
            );
            devConversation.push({ role: "model", parts: [{ text: polishOutput }] });
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
                devConversation.push({ role: "user", parts: [{ text: localFixInput }] });
                const localFixOut = await callWithRetry(
                  () => ai.models.generateContentStream({
                    model: MODEL_ID,
                    contents: devConversation,
                    config: { systemInstruction: devSystemPromptRef || `${BASE_SYSTEM_PROMPT}\n\n${SOLO_DEV_PROMPT}`, temperature: 0.2, maxOutputTokens: 65536 },
                  }),
                  onChunk,
                  { maxAttempts: 2, baseDelay: 8000, onUsage }
                );
                devConversation.push({ role: "model", parts: [{ text: localFixOut }] });
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

              // ── Correction TSC : injecte les erreurs dans la devConversation existante ──
              // Le modèle reçoit le contexte de toute la devConversation + les erreurs TSC.
              // Il corrige en connaissant exactement ce qu'il a généré.
              devConversation.push({ role: "user", parts: [{ text: tscFixInput }] });

              let tscFixOutput = "";
              const tscPendingFC: any[] = [];
              tscFixOutput = await callWithRetry(
                () => ai.models.generateContentStream({
                  model: MODEL_ID,
                  contents: devConversation,
                  config: {
                    systemInstruction: devSystemPromptRef,
                    temperature: 0.2,
                    maxOutputTokens: 65536,
                    thinkingConfig: { thinkingLevel: "HIGH" as const },
                  },
                }),
                onChunk,
                { maxAttempts: 3, baseDelay: 10000, onUsage, collectedFunctionCalls: tscPendingFC }
              );
              devConversation.push({ role: "model", parts: [{ text: tscFixOutput }] });

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
