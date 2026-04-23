"use client"

import React from "react"
import  { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import CodeMirror from "@uiw/react-codemirror"
import { javascript } from "@codemirror/lang-javascript"
import { xcodeLight } from "@uiw/codemirror-theme-xcode"
import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight" 
// En haut de gamme de produits de votre fichier de composant (par exemple, components/Chat.tsx)
import ApiKeyModal, { getApiKeyFromIDB, saveApiKeyToIDB } from '@/components/ApiKeyModal'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth'
import { getFirestore, collection, getDocs, doc, getDoc, onSnapshot, query, orderBy } from 'firebase/firestore'
import { 
    getHistory, 
    updateHistory, 
    replaceLastHistoryMessage 
} from '@/utils/history'; // Ajustez le chemin si nécessaire
import VercelDeployModal from '@/components/VercelDeployModal';

import { getRandomVibes } from '@/lib/indexedDB'; // gardé pour fallback IDB
// Imports à ajouter dans votre liste d'imports existante
import { IndexedChunk, indexFileContent, updateProjectEmbeddings } from '@/lib/rag-utils';

// Assurez-vous que useCallback est dans les imports React (e.g., import { useState, useRef, useEffect, useMemo, useCallback } from "react")


// REMPLACER CodeMirror par Monaco Editor
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor'; // Pour les types
// NOTE : Vous n'avez plus besoin d'importer javascript, xcodeLight, EditorView, etc.
// ... autres imports Lucide et autres




import {
  Copy,
  Zap,
  Github,
  ChevronsUpDown,
  HardDrive,
  ArrowRight,
  RefreshCw,
  Code,
  Eye,
  ExternalLink,
  Image,
  Plus,
  Save,
  AtSign,
  ArrowUp,
  X,
  Sidebar,
  ChevronRight,
  Monitor,
  Check,
  Download,
  Loader,
  LogOut,
  Trash2,
  ImagePlus,
  Search,
  ChevronLeft,
  PanelLeftClose,
    Home,
    RotateCw,
    Tally1,
    ArrowUpRight
} from "lucide-react"


import GitHubDeployModal from '@/components/GitHubDeployModal';

// ── Firebase ──────────────────────────────────────────────────────────────────
const _fbApp = getApps().length ? getApps()[0] : initializeApp({
  apiKey: "AIzaSyAVoDcDQJyPkHj5SAzdeUDqg3GbSV3Xu1U",
  authDomain: "myapp-cbf8d.firebaseapp.com",
  projectId: "myapp-cbf8d",
  storageBucket: "myapp-cbf8d.firebasestorage.app",
  messagingSenderId: "215809852481",
  appId: "1:215809852481:web:32035e4ac0a4700b0d32c0",
  measurementId: "G-C49XQRMEQL",
});
const _fbAuth = getAuth(_fbApp);
const _fbDb = getFirestore(_fbApp);
const _googleProvider = new GoogleAuthProvider();

// ── Model definitions ─────────────────────────────────────────────────────────
type ModelProvider = 'gemini' | 'anthropic';
interface ModelOption { id: string; label: string; provider: ModelProvider; badge?: string; }
const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gemini-3-flash-preview',      label: 'Gemini 3 Flash',    provider: 'gemini',    badge: 'Fast'   },
  { id: 'gemini-3.1-pro-preview',      label: 'Gemini 3.1 Pro',    provider: 'gemini',    badge: 'Pro'    },
  { id: 'claude-opus-4-7',             label: 'Claude Opus 4.7',   provider: 'anthropic', badge: 'Best'   },
  { id: 'claude-opus-4-6',             label: 'Claude Opus 4.6',   provider: 'anthropic', badge: 'Opus'   },
  { id: 'claude-sonnet-4-6',           label: 'Claude Sonnet 4.6', provider: 'anthropic', badge: 'Sonnet' },
  { id: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5',  provider: 'anthropic', badge: 'Fast'   },
  { id: 'claude-sonnet-4-5-20250929',  label: 'Claude Sonnet 4.5', provider: 'anthropic'                  },
  { id: 'claude-3-5-haiku-20241022',   label: 'Claude Haiku 3.5',  provider: 'anthropic'                  },
];

// --- INTERFACES ET TYPES (SIMPLIFIÉS) ---
interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}






// Interfaces fournies par l'utilisateur (utilisées ici pour le contexte)
interface Message {
    id?: string;
  role: "user" | "assistant" | "system"
  content: string 
 htmlCode?: string;
  images?: string[]
  externalFiles?: { fileName: string; base64Content: string }[] 
  mentionedFiles?: string[],
phases?: { id: number; name: string; label: string; content: string; thoughts?: string }[];
  presenterIntro?: string;
  presenterOutro?: string;
  activePhaseId?: number;
  envVars?: string[];
  currentStreamingFilePath?: string;
  quotaExceeded?: { message: string; resetHint: string };
  buildError?: { action: string; stderr: string }; // erreur build/install transmise à l'IA
  fileBadgesCompleted?: string[];
  currentlyWritingFile?: string;
  timestamp?: number;
  thinkDurationMs?: number;
  agentWorkingOn?: string;
  copyBlocks?: { label: string; content: string }[];
  requestingVibes?: boolean; // true pendant le fetch des images après request_vibes
  streamRetrying?: { attempt: number; max: number; delaySecs: number } | null; // retry 503 en cours
  
  artifactData?: { 
    type: 'files' | 'url' | 'fileChanges' | null
    rawJson: string
    parsedList: any[]
  }
}



interface ProjectFile { filePath: string; content: string }
interface Project {
  id: string
  name: string
  createdAt: string
  files: ProjectFile[]
  messages: Message[]
}

// --- NOUVELLE STRUCTURE POUR LE STREAMING ---

interface FileArtifact {
  filePath: string;
  type: 'create' | 'changes' | 'edit'; // 'create' pour <create_file>, 'changes' pour <file_changes>, 'edit' pour <edit_file>
  content: string; // Contient soit le code complet, soit le JSON des changements, soit le XML edit_file brut
  editAction?: string; // Pour type 'edit': action (replace|insert_after|insert_before|delete|append)
  startLine?: number;  // Pour type 'edit'
  endLine?: number;    // Pour type 'edit'
}


// ─── Types et parseur des phases de progression ───────────────────────────────
interface PhaseInfo {
  id: string;
  label: string;
  status: "processing" | "done" | "error";
  detail?: string;
}

function parsePhaseBlocks(rawText: string): {
  phases: PhaseInfo[];
  cleanText: string;
} {
  const phaseMap = new Map<string, PhaseInfo>();

  // On itère sur tous les blocs <div data-phase-id="..."> du stream
  const blockRegex =
    /<div\s+data-phase-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
  let match;

  while ((match = blockRegex.exec(rawText)) !== null) {
    const id = match[1];
    const fullBlock = match[0];

    // Détermine le statut depuis la couleur de la bordure gauche injectée par le serveur
    const isDone = fullBlock.includes("#22c55e");
    const isError = fullBlock.includes("#ef4444");
    const status: PhaseInfo["status"] = isError
      ? "error"
      : isDone
      ? "done"
      : "processing";

    // Extrait le label (span avec font-weight:600)
    const labelMatch = fullBlock.match(
      /font-weight:600[^>]*>\s*([^<]{2,}?)\s*<\/span>/
    );
    const label = labelMatch ? labelMatch[1].trim() : id;

    // Extrait le détail (span avec color:#9ca3af)
    const detailMatch = fullBlock.match(
      /color:#9ca3af[^>]*>\s*([^<]+?)\s*<\/span>/
    );
    const detail = detailMatch ? detailMatch[1].trim() : undefined;

    // On garde toujours la version la plus récente du bloc (done écrase processing)
    const existing = phaseMap.get(id);
    if (!existing || existing.status === "processing") {
      phaseMap.set(id, { id, label, status, detail });
    }
  }

  // Supprime tous les blocs HTML de phase + les balises <script> du texte affiché
  const cleanText = rawText
    .replace(/<div\s+data-phase-id="[^"]*"[\s\S]*?<\/div>/g, "")
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .trim();

  return { phases: Array.from(phaseMap.values()), cleanText };
}

/**
 * Extraction couleur pixel-perfect via Canvas API.
 * Produit : 48 couleurs dominantes (hex + rgb + fréquence + position) + grille 6×6 de zones.
 * Ce bloc structuré est envoyé tel quel au design agent — il n'a plus à deviner une seule couleur.
 */
interface _ColorInfo { hex: string; r: number; g: number; b: number; count: number; xPercent: number; yPercent: number; }
interface _ColorZone { name: string; row: number; col: number; dominant: string; colors: string[]; }
interface _ExtractedColorData { dominantPalette: _ColorInfo[]; zones: _ColorZone[]; imageWidth: number; imageHeight: number; totalSampled: number; }

function _extractRichColors(canvas: HTMLCanvasElement, img: HTMLImageElement): _ExtractedColorData {
  const ctx = canvas.getContext("2d")!;
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  ctx.drawImage(img, 0, 0);
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const STEP = 3, Q = 8;
  const mkHex = (r: number, g: number, b: number) =>
    `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  const cmap = new Map<string,{r:number;g:number;b:number;count:number;x:number;y:number}>();
  let total = 0;
  for (let y = 0; y < height; y += STEP) {
    for (let x = 0; x < width; x += STEP) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i+1], b = pixels[i+2], a = pixels[i+3];
      if (a < 20) continue;
      const qr = Math.round(r/Q)*Q, qg = Math.round(g/Q)*Q, qb = Math.round(b/Q)*Q;
      const k = `${qr}|${qg}|${qb}`;
      if (cmap.has(k)) cmap.get(k)!.count++; else cmap.set(k,{r:qr,g:qg,b:qb,count:1,x,y});
      total++;
    }
  }
  const dominantPalette = Array.from(cmap.values())
    .sort((a,b) => b.count - a.count).slice(0, 64)
    .map(v => ({ hex: mkHex(v.r,v.g,v.b), r:v.r, g:v.g, b:v.b, count:v.count,
      xPercent: Math.round(v.x/width*100), yPercent: Math.round(v.y/height*100) }));
  const COLS=6, ROWS=6, zw=Math.floor(width/COLS), zh=Math.floor(height/ROWS), ZQ=16;
  const rL=["top","upper","mid-upper","mid-lower","lower","bottom"];
  const cL=["far-left","ctr-left","near-left","near-right","ctr-right","far-right"];
  const zones: _ColorZone[] = [];
  for (let row=0; row<ROWS; row++) {
    for (let col=0; col<COLS; col++) {
      const x0=col*zw, y0=row*zh, x1=Math.min(x0+zw,width), y1=Math.min(y0+zh,height);
      const zm = new Map<string,number>();
      for (let y=y0; y<y1; y+=STEP) {
        for (let x=x0; x<x1; x+=STEP) {
          const i=(y*width+x)*4, r=pixels[i], g=pixels[i+1], b=pixels[i+2], a=pixels[i+3];
          if (a<20) continue;
          const h = mkHex(Math.round(r/ZQ)*ZQ, Math.round(g/ZQ)*ZQ, Math.round(b/ZQ)*ZQ);
          zm.set(h,(zm.get(h)??0)+1);
        }
      }
      const top = Array.from(zm.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([h])=>h);
      zones.push({name:`${rL[row]}_${cL[col]}`, row, col, dominant: top[0]??"#000", colors: top});
    }
  }
  return { dominantPalette, zones, imageWidth: width, imageHeight: height, totalSampled: total };
}

/**
 * Formate les données canvas en bloc structuré pour le design agent.
 * Produit : 48 couleurs dominantes triées par fréquence + zone map 6×6 avec coordonnées pixel exactes.
 * Chaque couleur inclut sa fréquence ET sa position d'origine dans l'image → zéro invention possible.
 */
function _formatCanvasColorBlock(cd: _ExtractedColorData): string {
  const { imageWidth: W, imageHeight: H } = cd;

  // Correspondance zones 6×6 → composant UI typique (pour aider l'agent à mapper)
  const zoneToComponent: Record<string, string> = {
    "top_far-left":    "sidebar-top",
    "top_ctr-left":    "sidebar-top",
    "top_near-left":   "sidebar-top",
    "top_near-right":  "header/topbar",
    "top_ctr-right":   "header/topbar",
    "top_far-right":   "header/topbar",
    "upper_far-left":  "sidebar-nav",
    "upper_ctr-left":  "sidebar-nav",
    "upper_near-left": "sidebar-nav",
    "upper_near-right":"main-content-top",
    "upper_ctr-right": "main-content-top",
    "upper_far-right": "main-content-top",
    "mid-upper_far-left":  "sidebar-mid",
    "mid-upper_ctr-left":  "sidebar-mid",
    "mid-upper_near-left": "sidebar-mid",
    "mid-upper_near-right":"content-area",
    "mid-upper_ctr-right": "content-area",
    "mid-upper_far-right": "right-panel",
    "mid-lower_far-left":  "sidebar-lower",
    "mid-lower_ctr-left":  "sidebar-lower",
    "mid-lower_near-left": "sidebar-lower",
    "mid-lower_near-right":"content-area",
    "mid-lower_ctr-right": "content-area",
    "mid-lower_far-right": "right-panel",
    "lower_far-left":  "sidebar-bottom",
    "lower_ctr-left":  "sidebar-bottom",
    "lower_near-left": "sidebar-bottom",
    "lower_near-right":"content-bottom",
    "lower_ctr-right": "content-bottom",
    "lower_far-right": "content-bottom",
    "bottom_far-left": "footer-left",
    "bottom_ctr-left": "footer",
    "bottom_near-left":"footer",
    "bottom_near-right":"footer",
    "bottom_ctr-right":"footer",
    "bottom_far-right":"footer-right",
  };

  const zw = Math.floor(W / 6), zh = Math.floor(H / 6);

  const lines: string[] = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "CANVAS PIXEL-EXTRACTED COLOR DATA",
    "(Extracted pixel-by-pixel via Canvas API — use ONLY these exact hex values, zero approximation)",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `IMAGE SIZE: ${W}×${H}px | PIXELS SAMPLED: ${cd.totalSampled.toLocaleString()}`,
    "",
    `── TOP ${Math.min(cd.dominantPalette.length, 48)} DOMINANT COLORS (sorted by pixel frequency) ──`,
    cd.dominantPalette.slice(0, 48).map((c, i) =>
      `  ${String(i+1).padStart(2)}. ${c.hex}  rgb(${c.r},${c.g},${c.b})  ` +
      `freq:${c.count.toLocaleString()}px (${(c.count/cd.totalSampled*100).toFixed(1)}%)  ` +
      `origin:pixel(${Math.round(c.xPercent/100*W)},${Math.round(c.yPercent/100*H)}) → @(${c.xPercent}%,${c.yPercent}%)`
    ).join("\n"),
    "",
    `── ZONE MAP 6×6 (each zone = ${zw}×${zh}px — UI component mapping) ──`,
    cd.zones.map(z => {
      const px0 = z.col * zw, py0 = z.row * zh;
      const px1 = Math.min(px0 + zw, W), py1 = Math.min(py0 + zh, H);
      const comp = zoneToComponent[z.name] ?? "unknown";
      return `  [${z.row},${z.col}] ${z.name.padEnd(24)} pixels:(${px0},${py0})→(${px1},${py1})  UI:${comp.padEnd(20)} dom:${z.dominant}  palette:[${z.colors.join(", ")}]`;
    }).join("\n"),
    "",
    "── USAGE RULES FOR DESIGN AGENT ──",
    "  • Each hex above is measured directly from pixels — do NOT substitute with Tailwind named colors",
    "  • bg-[#hex] and text-[#hex] with exact values from this list ONLY",
    "  • Map zone dominant colors to their UI component (sidebar, header, card, etc.)",
    "  • If two zones share the same hex → same background across those components",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ];
  return lines.join("\n");
}

/**
 * Extrait et formate les données couleur canvas depuis une image base64.
 * Retourne le bloc structuré prêt à être injecté dans le prompt du design agent.
 */
async function extractColorsFromBase64(base64: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const cd = _extractRichColors(canvas, img);
        resolve(_formatCanvasColorBlock(cd));
      } catch { resolve(""); }
    };
    img.onerror = () => resolve("");
    img.src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  });
}

// ─── Composant React d'une phase — respecte ta charte #37322F / #f6f4ec ─────
function PhaseCard({ phase }: { phase: PhaseInfo }) {
  const isProcessing = phase.status === "processing";
  const isDone = phase.status === "done";
  const isError = phase.status === "error";

  const borderColor = isDone
    ? "#22c55e"
    : isError
    ? "#ef4444"
    : "#6366f1";

  const textColor = isDone
    ? "text-green-600"
    : isError
    ? "text-red-500"
    : "text-indigo-500";

  const statusLabel = isDone ? "Terminé" : isError ? "Erreur" : "En cours...";

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 my-1 rounded-lg text-[#37322F] text-xs font-medium"
      style={{
        background: "rgba(55,50,47,0.04)",
        border: "1px solid rgba(55,50,47,0.08)",
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* Icône de statut */}
      <span className={`flex-shrink-0 ${textColor}`}>
        {isProcessing ? (
          <svg
            className="w-3.5 h-3.5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 12a9 9 0 1 1-6.219-8.56"
            />
          </svg>
        ) : isDone ? (
          <svg
            className="w-3.5 h-3.5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            className="w-3.5 h-3.5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
      </span>

      {/* Label */}
      <span className="flex-1 font-semibold">{phase.label}</span>

      {/* Statut */}
      <span className={`font-medium ${textColor}`}>{statusLabel}</span>

      {/* Détail optionnel */}
      {phase.detail && (
        <span className="text-[#37322F]/40 text-[10px] font-normal ml-1">
          {phase.detail}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// ApiKeyInlinePanelSidebar — compact API key editor embedded in sidebar
function ApiKeyInlinePanelSidebar({ onClose }: { onClose: () => void }) {
  const [key, setKey] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    // Load existing key from IDB settings
    const loadKey = async () => {
      try {
        const db: any = await new Promise((res, rej) => {
          const r = indexedDB.open("StudioCode_DB", 1);
          r.onsuccess = (e: any) => res(e.target.result);
          r.onerror = () => rej();
        });
        const tx = db.transaction("settings", "readonly");
        const store = tx.objectStore("settings");
        const req = store.get("gemini_api_key");
        req.onsuccess = () => { if (req.result) setKey(req.result); };
      } catch {}
    };
    loadKey();
  }, []);

  const handleSave = async () => {
    try {
      const db: any = await new Promise((res, rej) => {
        const r = indexedDB.open("StudioCode_DB", 1);
        r.onsuccess = (e: any) => res(e.target.result);
        r.onerror = () => rej();
      });
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(key.trim(), "gemini_api_key");
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1200);
    } catch {}
  };

  return (
    <div style={{ background: "rgba(55,50,47,0.04)", border: "1px solid rgba(55,50,47,0.1)", borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
      <div className="flex items-center justify-between mb-2">
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(55,50,47,0.6)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Gemini API Key</span>
        <button onClick={onClose} style={{ fontSize: 14, color: "rgba(55,50,47,0.4)", lineHeight: 1 }}>✕</button>
      </div>
      <input
        type="password"
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="AIza..."
        className="w-full px-2 py-1.5 rounded-md text-xs font-mono outline-none"
        style={{ background: "#fff", border: "1px solid rgba(55,50,47,0.12)", color: "#37322F" }}
        onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
      />
      <button
        onClick={handleSave}
        className="w-full mt-2 py-1.5 rounded-md text-xs font-semibold transition-colors"
        style={{ background: saved ? "#22c55e" : "#37322F", color: "#fff" }}
      >
        {saved ? "✓ Saved!" : "Save key"}
      </button>
    </div>
  );
}

// AgentPhaseRow — style Claude Code exact (file tree + vertical line, transparent)
// =============================================================================

// Extension de l'interface pour inclure les fichiers par phase
interface PhaseFile { path: string; content?: string; }
interface AgentPhaseRowProps {
  phase: { id: number; name: string; label: string; content: string; thoughts?: string; workingOn?: string; files?: PhaseFile[] };
  isActive: boolean;
  isDone: boolean;
  isPastPhase: boolean;
  isLast: boolean;
  streamingFilePath?: string;
  isLastItem?: boolean;
}

// Icône de fichier selon extension
function FileIcon({ ext, size = 13 }: { ext: string; size?: number }) {
  const color = ext === "tsx" || ext === "ts" ? "#4da6ff" : ext === "css" ? "#f9a825" : ext === "json" ? "#98c379" : "#aaa";
  const label = ext.toUpperCase().slice(0, 3);
  return (
    <div style={{ width: size + 4, height: size + 4, border: `1px solid ${color}30`, borderRadius: 2, background: `${color}10`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 5, fontWeight: 700, color, letterSpacing: -0.5, fontFamily: "monospace" }}>{label}</span>
    </div>
  );
}

// Icône terminé (check circle style Claude)
function DoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.25)" strokeWidth="1.5"/>
      <path d="M5.5 8L7 9.5L10.5 6" stroke="rgba(55,50,47,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Spinner style Claude (dark, thin)
function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.12)" strokeWidth="1.5"/>
      <path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(55,50,47,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function AgentPhaseRow({ phase, isActive, isDone, isPastPhase, isLast, streamingFilePath }: AgentPhaseRowProps) {
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (isActive) setExpanded(true);
    else if (!isActive && !isPastPhase) setExpanded(false);
  }, [isActive]);

  // Title: use agent-generated workingOn if available, else fallback to label
  const displayTitle = phase.workingOn || phase.label;

  // Content to display: filter out XML create_file tags, show only agent prose + TSC logs
  const cleanContent = (phase.content || "")
    .replace(/<create_file[^>]*>[\s\S]*?<\/create_file>/g, "")
    .replace(/<str_replace[^>]*>[\s\S]*?<\/str_replace>/g, "")
    .replace(/\[THOUGHT:[^\]]+\][\s\S]*?\[\/THOUGHT:[^\]]+\]/g, "")
    .replace(/\[WORKING_ON\][\s\S]*?\[\/WORKING_ON\]/g, "")
    .trim();

  const hasFiles = phase.files && phase.files.length > 0;
  const hasThoughts = phase.thoughts && phase.thoughts.trim().length > 0;
  const hasContent = cleanContent.length > 10 || hasThoughts || hasFiles;

  return (
    <div style={{ position: "relative" }}>
      {/* Vertical line continuation (not on last) */}
      {!isLast && (
        <div style={{
          position: "absolute", left: 6, top: 28, bottom: 0, width: 1,
          background: "rgba(55,50,47,0.1)", zIndex: 0
        }} />
      )}

      {/* Main row */}
      <div
        className="flex items-start gap-2.5 py-1.5 cursor-pointer select-none"
        style={{ paddingLeft: 0, position: "relative", zIndex: 1 }}
        onClick={() => hasContent && setExpanded(v => !v)}
      >
        {/* Status icon with background */}
        <div style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isActive ? <SpinnerIcon /> : isPastPhase ? <DoneIcon /> : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3" fill="rgba(55,50,47,0.18)"/>
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span style={{
              fontSize: 13,
              color: isActive ? "#37322F" : isPastPhase ? "rgba(55,50,47,0.7)" : "rgba(55,50,47,0.35)",
              fontWeight: isActive ? 500 : 400,
              lineHeight: 1.4,
            }}>
              {displayTitle}
            </span>

            {/* Streaming file hint inline */}
            {isActive && streamingFilePath && (
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(55,50,47,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                {streamingFilePath}
              </span>
            )}

            {/* Chevron — right when collapsed, down when expanded */}
            {hasContent && (
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                style={{ flexShrink: 0, opacity: 0.35, transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>

          {/* Expanded content */}
          {expanded && hasContent && (
            <div style={{ marginTop: 6, paddingBottom: 6 }}>
              {/* Thoughts */}
              {hasThoughts && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: "rgba(55,50,47,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                    <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=16" alt="" style={{ width: 10, height: 10, opacity: 0.5 }} />
                    Réflexion
                  </div>
                  <pre style={{ fontSize: 11, color: "rgba(55,50,47,0.45)", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 120, overflowY: "auto", fontFamily: "inherit" }}>
                    {phase.thoughts?.slice(0, 800)}{(phase.thoughts?.length ?? 0) > 800 ? "…" : ""}
                  </pre>
                </div>
              )}

              {/* Logs (TSC, etc.) — only non-empty, non-xml */}
              {cleanContent.length > 10 && (
                <pre style={{ fontSize: 11, color: "rgba(55,50,47,0.5)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 100, overflowY: "auto", fontFamily: "ui-monospace, monospace" }}>
                  {cleanContent.slice(0, 500)}{cleanContent.length > 500 ? "…" : ""}
                </pre>
              )}

              {/* Files created in this phase */}
              {hasFiles && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                  {phase.files!.map((f, i) => {
                    const ext = f.path.split(".").pop() ?? "";
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <FileIcon ext={ext} />
                        <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "rgba(55,50,47,0.5)" }}>{f.path}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



/**
 * Extrait les balises de création/modification de fichiers (<create_file>, <file_changes>, <edit_file>)
 * d'une chaîne de texte streamée.
 */
const extractFileArtifacts = (content: string): FileArtifact[] => {
  const artifacts: FileArtifact[] = [];

  // 1. Extraction des balises <create_file>
  const createRegex = /<create_file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/create_file>/g;
  let createMatch;
  while ((createMatch = createRegex.exec(content)) !== null) {
    artifacts.push({
      filePath: createMatch[1].trim(),
      type: 'create',
      content: createMatch[2].trim(),
    });
  }

  // 2. Extraction des balises <file_changes>
  const changesRegex = /<file_changes\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file_changes>/g;
  let changesMatch;
  while ((changesMatch = changesRegex.exec(content)) !== null) {
    artifacts.push({
      filePath: changesMatch[1].trim(),
      type: 'changes',
      content: changesMatch[2].trim(),
    });
  }

  // 3. Extraction des balises <edit_file>
  const editRegex = /<edit_file\s+path=["']([^"']+)["']\s+action=["']([^"']+)["']\s*>([\s\S]*?)<\/edit_file>/g;
  let editMatch;
  while ((editMatch = editRegex.exec(content)) !== null) {
    const body = editMatch[3];
    const startMatch   = body.match(/<start_line>\s*(\d+)\s*<\/start_line>/);
    const endMatch     = body.match(/<end_line>\s*(\d+)\s*<\/end_line>/);
    const changesInner = body.match(/<changes_to_apply>([\s\S]*?)<\/changes_to_apply>/);
    artifacts.push({
      filePath:   editMatch[1].trim(),
      type:       'edit',
      content:    changesInner ? changesInner[1] : "",
      editAction: editMatch[2].trim(),
      startLine:  startMatch ? parseInt(startMatch[1], 10) : undefined,
      endLine:    endMatch   ? parseInt(endMatch[1], 10)   : undefined,
    });
  }

  return artifacts;
};

/**
 * Met à jour l'arbre des fichiers du projet si de nouveaux chemins de fichiers sont détectés
 * pendant le streaming.
 */
const addFilesIfNew = (
  artifactPaths: { path: string, type: 'create' | 'changes' }[],
  currentFiles: ProjectFile[],
  currentActiveFile: string,
  setActiveFile: (path: string) => void,
  setCurrentProject: (update: (prev: Project | null) => Project | null) => void,
) => {
  let filesChanged = false;
  const updatedFiles = [...currentFiles];
  let newActiveFile = "";

  artifactPaths.forEach(artifact => {
    // Ajoute le fichier seulement s'il n'existe pas déjà
    if (!currentFiles.some(f => f.filePath === artifact.path)) {
      // Ajout du fichier avec contenu vide initial
      updatedFiles.push({ filePath: artifact.path, content: "" });
      filesChanged = true;
      // Met le premier nouveau fichier en actif si aucun n'est actif
      if (!newActiveFile && !currentActiveFile) newActiveFile = artifact.path;
    }
  });

  if (filesChanged) {
    setCurrentProject(prevProject => {
      if (!prevProject) return prevProject;
      return { ...prevProject, files: updatedFiles };
    });
    if (newActiveFile) {
      setActiveFile(newActiveFile);
    }
  }
};
  
// Définition de l'interface pour un Nœud dans l'arborescence de fichiers


// --- NOUVELLES INTERFACES POUR L'ARBORESCENCE DE FICHIERS ---
interface FileTreeNode {
  name: string // Nom du dossier ou du fichier (ex: 'app' ou 'page.tsx')
  path: string // Chemin complet (pour l'action de clic)
  type: 'directory' | 'file'
  children?: FileTree // Présent uniquement si 'type' est 'directory'
  index?: number // Index dans le tableau 'files' original (pour savoir quel fichier éditer)
}

// Le type FileTree sera un Map pour des recherches rapides
type FileTree = Map<string, FileTreeNode>


// --- FONCTION DE CONSTRUCTION DE L'ARBORESCENCE (LOGIQUE PURE) ---

 // Assurez-vous d'avoir cet import si vous utilisez <React.Fragment>

// --- NOUVEAU COMPOSANT FILE BREADCRUMB ---

interface FileBreadcrumbProps {
  filePath: string;
}

// 🆕 NOUVELLES INTERFACES
interface ConsoleLog {
  type: 'STDOUT' | 'STDERR' | 'INFO' | 'ERROR';
  content: string;
  timestamp: number;
}

interface ConsolePanelProps {
  sandboxId: string | undefined;
}



// ─── Parsing des phases agents depuis le stream ───────────────────────────────



// Ces codes sont temporaires. Vous les remplacerez par vos propres SVGs.
// Types nécessaires pour la base de données
type DatabaseProvider = 'appwrite' | 'firebase' | 'supabase' | null;

interface DatabaseConfig {
  provider: DatabaseProvider;
  credentials: {
    [key: string]: string;
  };
}

// Icônes SVG (temporaires)
const IconAppwrite = () => (
    <svg class="max-w-full" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 112 98"
  fill="none">
  <path
    d="M111.1 73.4729V97.9638H48.8706C30.7406 97.9638 14.9105 88.114 6.44112 73.4729C5.2099 71.3444 4.13229 69.1113 3.22835 66.7935C1.45387 62.2516 0.338421 57.3779 0 52.2926V45.6712C0.0734729 44.5379 0.189248 43.4135 0.340647 42.3025C0.650124 40.0227 1.11768 37.7918 1.73218 35.6232C7.54544 15.0641 26.448 0 48.8706 0C71.2932 0 90.1935 15.0641 96.0068 35.6232H69.3985C65.0302 28.9216 57.4692 24.491 48.8706 24.491C40.272 24.491 32.711 28.9216 28.3427 35.6232C27.0113 37.6604 25.9782 39.9069 25.3014 42.3025C24.7002 44.4266 24.3796 46.6664 24.3796 48.9819C24.3796 56.0019 27.3319 62.3295 32.0653 66.7935C36.4515 70.9369 42.3649 73.4729 48.8706 73.4729H111.1Z"
    fill="#FD366E" />
  <path
    d="M111.1 42.3027V66.7937H65.6759C70.4094 62.3297 73.3616 56.0021 73.3616 48.9821C73.3616 46.6666 73.041 44.4268 72.4399 42.3027H111.1Z"
    fill="#FD366E" />
</svg>
);
const IconFirebase = () => (
    <svg width="20" height="20" viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M213.918 560.499C237.166 569.856 262.387 575.408 288.87 576.333C324.71 577.585 358.792 570.175 389.261 556.099C352.724 541.744 319.634 520.751 291.392 494.651C273.086 523.961 246.01 547.113 213.918 560.499Z" fill="#FF9100"/>
<path d="M291.389 494.66C226.923 435.038 187.815 348.743 191.12 254.092C191.228 251.019 191.39 247.947 191.58 244.876C180.034 241.89 167.98 240.068 155.576 239.635C137.821 239.015 120.626 241.217 104.393 245.788C87.1838 275.933 76.7989 310.521 75.5051 347.569C72.1663 443.18 130.027 526.723 213.914 560.508C246.007 547.121 273.082 523.998 291.389 494.66Z" fill="#FFC400"/>
<path d="M291.39 494.657C306.378 470.671 315.465 442.551 316.523 412.254C319.306 332.559 265.731 264.003 191.581 244.873C191.391 247.944 191.229 251.016 191.121 254.089C187.816 348.74 226.924 435.035 291.39 494.657Z" fill="#FF9100"/>
<path d="M308.231 20.8584C266 54.6908 232.652 99.302 212.475 150.693C200.924 180.129 193.665 211.748 191.546 244.893C265.696 264.023 319.272 332.579 316.489 412.273C315.431 442.57 306.317 470.663 291.355 494.677C319.595 520.804 352.686 541.77 389.223 556.124C462.56 522.224 514.593 449.278 517.606 362.997C519.558 307.096 498.08 257.273 467.731 215.219C435.68 170.742 308.231 20.8584 308.231 20.8584Z" fill="#DD2C00"/>
</svg>
);
const IconSupabase = () => (
    <svg width="21" height="21" viewBox="0 0 109 113" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)"/>
<path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint1_linear)" fill-opacity="0.2"/>
<path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
<defs>
<linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
<stop stop-color="#249361"/>
<stop offset="1" stop-color="#3ECF8E"/>
</linearGradient>
<linearGradient id="paint1_linear" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
<stop/>
<stop offset="1" stop-opacity="0"/>
</linearGradient>
</defs>
</svg>
);

// Données des fournisseurs
const providersData = [
    { 
        id: 'appwrite', 
        name: 'Appwrite', 
        icon: IconAppwrite, 
        credentials: ['NEXT_PUBLIC_APPWRITE_ENDPOINT', 'NEXT_PUBLIC_APPWRITE_PROJECT_ID'] 
    },
    { 
        id: 'firebase', 
        name: 'Firebase', 
        icon: IconFirebase, 
        credentials: ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID'] 
    },
    { 
        id: 'supabase', 
        name: 'Supabase', 
        icon: IconSupabase, 
        credentials: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] 
    },
];
          











// 🆕 NOUVEAU COMPOSANT : CONSOLEPANEL
const ConsolePanel: React.FC<ConsolePanelProps> = ({ sandboxId }) => {
  const [logs, setLogs] = useState<ConsoleLog[]>([
    { type: 'INFO', content: 'Console active. En attente du démarrage du serveur...', timestamp: Date.now() }
  ]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [stdoutLength, setStdoutLength] = useState(0); 
  const [stderrLength, setStderrLength] = useState(0); 

  const fetchLogs = async () => {
    if (!sandboxId) return;

    try {
      const res = await fetch('/api/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getLogs', sandboxId }),
      });
      const data = await res.json();

      if (data.success && data.logs) {
        let newLogs: ConsoleLog[] = [];
        let newStdoutLength = stdoutLength;
        let newStderrLength = stderrLength;

        data.logs.forEach((log: ConsoleLog) => {
          if (log.type === 'STDOUT' && log.content.length > stdoutLength) {
            newLogs.push({
                type: 'STDOUT',
                content: log.content.substring(stdoutLength), 
                timestamp: Date.now(),
            });
            newStdoutLength = log.content.length;
          } else if (log.type === 'STDERR' && log.content.length > stderrLength) {
            newLogs.push({
                type: 'STDERR',
                content: log.content.substring(stderrLength),
                timestamp: Date.now(),
            });
            newStderrLength = log.content.length;
          }
        });
        
        if (newLogs.length > 0) {
            setLogs(prev => [...prev, ...newLogs]);
            setStdoutLength(newStdoutLength);
            setStderrLength(newStderrLength);
        }
      }
    } catch (e) {
      // Gérer l'erreur de connexion ou de sandbox
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [sandboxId]);
  
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const getLogColor = (type: ConsoleLog['type']) => {
    switch (type) {
      case 'STDERR': 
      case 'ERROR': 
        return 'text-red-400';
      case 'STDOUT': 
        return 'text-green-400';
      case 'INFO':
      default: 
        return 'text-gray-300';
    }
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-gray-900 text-white font-mono text-xs p-4">
      {logs.map((log, index) => (
          <div key={index} className={`whitespace-pre-wrap ${getLogColor(log.type)}`}>
            <span className="text-gray-600 mr-2">
                {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.content}
          </div>
        ))}
        <div ref={logsEndRef} />
    </div>
  )
              }



  // Assurez-vous d'importer useEffect : import { useState, useRef, useEffect, useMemo } from "react" 

// ... (déclarations de useState, useMemo, etc.)

// 🛑 NOUVEAU BLOC : Synchronisation de l'état local 'files' avec la source de vérité 'currentProject.files'

// Dépend de currentProject (pour le changement de projet) et de la variable files elle-même


// ... (le reste de votre composant)
      
              



const FileBreadcrumb: React.FC<FileBreadcrumbProps> = ({ filePath }) => {
  if (!filePath) return null;

  // Sépare le chemin en répertoires/parties (ex: app/page.tsx -> ["app", "page.tsx"])
  const parts = filePath.split('/').filter(part => part.length > 0);

  return (
    <div className="flex items-center space-x-1 text-sm text-[#37322F] truncate">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {/* Le nom du répertoire ou du fichier */}
          <span className="font-medium text-[rgba(55,50,47,0.8)]">
            {part}
          </span>
          
          {/* Ajout de la flèche de séparation si ce n'est pas le dernier élément */}
          {index < parts.length - 1 && (
            <ChevronRight className="h-4 w-4 text-[rgba(55,50,47,0.4)] flex-shrink-0" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};



/**
 * Construit une structure d'arbre de fichiers (Map imbriquée) à partir d'une liste plate de fichiers.
 * @param files Le tableau d'objets fichiers ({ filePath: string, content: string }[]).
 * @returns La Map représentant le répertoire racine.
 */
const buildFileTree = (files: { filePath: string; content: string }[]): FileTree => {
  const root: FileTree = new Map()

  files.forEach((file, originalIndex) => {
    const parts = file.filePath.split('/')
    let currentNode = root
    let currentPath = ''

    parts.forEach((part, i) => {
      // Met à jour le chemin d'accès complet pour ce niveau
      currentPath = currentPath + (currentPath ? '/' : '') + part
      
      const isFile = i === parts.length - 1

      if (!currentNode.has(part)) {
        // Crée un nouveau nœud si non existant
        const newNode: FileTreeNode = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          // On crée une nouvelle Map d'enfants seulement si c'est un répertoire
          children: isFile ? undefined : new Map(),
          index: isFile ? originalIndex : undefined,
        }
        currentNode.set(part, newNode)
      }

      // Descend dans le nœud (si ce n'est pas le fichier final)
      if (!isFile) {
        currentNode = currentNode.get(part)!.children as FileTree
      }
    })
  })

  return root
}




/**
 * Extrait le contenu JSON brut (potentiellement incomplet) entre ```json et ```.
 * Si le bloc n'est pas fermé, il prend tout jusqu'à la fin de la chaîne.
 */
const extractRawJson = (content: string): string | null => {
  const startMatch = content.match(/```json\s*/)
  if (!startMatch) return null

  // Trouve l'index de début après '```json' et les espaces
  const startIndex = startMatch.index + startMatch[0].length
  const substringAfterStart = content.substring(startIndex)
  
  // Cherche le triple backtick de fermeture
  const endMatch = substringAfterStart.match(/\s*```/)

  if (endMatch) {
    // Le bloc est fermé, prend le contenu avant la fermeture
    return substringAfterStart.substring(0, endMatch.index)
  } else {
    // Le bloc est ouvert, prend tout jusqu'à la fin du stream
    return substringAfterStart
  }
}
  


// ------------------------------------------------------
// --- LOGIQUE INDEXEDDB (À placer hors du composant) ---
const DB_NAME = 'StudioCodeDB';
const DB_VERSION = 3; // v3: ajout store vibes_usage

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Store pour les clés API
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
      
      // Store pour les projets
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      // Store pour la rotation des images vibes (keyPath = path de l'image)
      if (!db.objectStoreNames.contains('vibes_usage')) {
        db.createObjectStore('vibes_usage', { keyPath: 'path' });
      }
    };
  });
};

// ── Helpers rotation vibes ─────────────────────────────────────────────────────

/** Retourne le numéro du tour courant (compteur global de relances vibes) */
const getVibesTurnCount = async (): Promise<number> => {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get('vibes_turn_counter');
    req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : 0);
    req.onerror = () => resolve(0);
  });
};

/** Incrémente et retourne le nouveau numéro de tour */
const incrementVibesTurn = async (): Promise<number> => {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const getReq = store.get('vibes_turn_counter');
    getReq.onsuccess = () => {
      const next = (typeof getReq.result === 'number' ? getReq.result : 0) + 1;
      store.put(next, 'vibes_turn_counter');
      resolve(next);
    };
    getReq.onerror = () => resolve(1);
  });
};

/** Retourne les paths des images utilisées dans les WINDOW derniers tours */
const getRecentlyUsedVibePaths = async (currentTurn: number, window = 4): Promise<Set<string>> => {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('vibes_usage')) { resolve(new Set()); return; }
    const tx = db.transaction('vibes_usage', 'readonly');
    const req = tx.objectStore('vibes_usage').getAll();
    req.onsuccess = () => {
      const used = new Set<string>();
      (req.result as { path: string; lastUsedTurn: number }[]).forEach(r => {
        if (currentTurn - r.lastUsedTurn < window) used.add(r.path);
      });
      resolve(used);
    };
    req.onerror = () => resolve(new Set());
  });
};

/** Marque un ensemble de paths comme utilisés au tour donné */
const markVibesAsUsed = async (paths: string[], turn: number): Promise<void> => {
  if (!paths.length) return;
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('vibes_usage')) { resolve(); return; }
    const tx = db.transaction('vibes_usage', 'readwrite');
    const store = tx.objectStore('vibes_usage');
    paths.forEach(path => store.put({ path, lastUsedTurn: turn }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

// Récupérer la Clé API — importée depuis @/components/ApiKeyModal

const saveProjectToIDB = async (project: any) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const request = store.put(project); 
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getRandomImages = (images: string[], count: number) => {
  return images.sort(() => 0.5 - Math.random()).slice(0, count);
};

const getImagesFromStore = async (storeName: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const request = indexedDB.open("VibeCodingDB", 1);
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result.map((item: any) => item.content));
    };
    request.onerror = () => resolve([]);
  });
};


const getAllProjectsFromIDB = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const store = tx.objectStore('projects');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

const deleteProjectFromIDB = async (projectId: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const request = store.delete(projectId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Token usage IDB helpers — persist daily token consumption
const TOKEN_STORE_KEY = "gemini-tokens-v1";
const getTokenUsageFromIDB = async (): Promise<{ date: string; total: number }> => {
  try {
    const raw = localStorage.getItem(TOKEN_STORE_KEY);
    if (!raw) return { date: "", total: 0 };
    return JSON.parse(raw);
  } catch { return { date: "", total: 0 }; }
};
const saveTokenUsageToIDB = async (total: number): Promise<void> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(TOKEN_STORE_KEY, JSON.stringify({ date: today, total }));
  } catch {}
};

// --- FONCTION SILENCIEUSE : RÉCUPÉRER L'IMAGE ACTIVE DU SHOP ---
const getActiveShopImage = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const request = indexedDB.open('StudioCode_Assets', 1); // On ouvre la DB du Shop
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('refs')) { resolve(null); return; }
      
      const tx = db.transaction('refs', 'readonly');
      const store = tx.objectStore('refs');
      const getAll = store.getAll();
      
      getAll.onsuccess = () => {
        // On cherche l'image marquée comme active
        const activeImg = getAll.result.find((img: any) => img.isActive);
        resolve(activeImg ? activeImg.base64 : null);
      };
      getAll.onerror = () => resolve(null);
    };
  });
};


// Récupérer seulement les métadonnées (ID et Nom) pour que l'IA choisisse vite
const getReferenceMetadata = async (): Promise<{id: string, name: string}[]> => {
  const db = await initImageDB();
  return new Promise((resolve) => {
    const tx = db.transaction('refs', 'readonly');
    const store = tx.objectStore('refs');
    const request = store.getAll();
    
    request.onsuccess = () => {
      // On mappe pour ne renvoyer que ce qui est nécessaire à la décision
      const metadata = request.result.map((img: any) => ({
        id: img.id,
        name: img.name
      }));
      resolve(metadata);
    };
    request.onerror = () => resolve([]);
  });
};

// Récupérer une image spécifique par son ID (une fois choisie)
const getRefImageById = async (id: string): Promise<string | null> => {
  const db = await initImageDB();
  return new Promise((resolve) => {
    const tx = db.transaction('refs', 'readonly');
    const store = tx.objectStore('refs');
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result ? request.result.base64 : null);
    request.onerror = () => resolve(null);
  });
};


// --- RÉCUPÉRER TOUTES LES IMAGES DU SHOP ---
// --- UTILITAIRE : RÉCUPÉRER TOUS LES STYLES ---

// --- UTILITAIRES DE LECTURE SHOP (DANS CHAT PAGE) ---

const getAllShopImages = async (): Promise<string[]> => {
  return new Promise((resolve) => {
    // On ouvre sans préciser de version pour prendre la plus récente existante
    const request = indexedDB.open('StudioCode_Assets');
    
    request.onerror = (e) => {
        console.error("Erreur ouverture DB Shop depuis Chat", e);
        resolve([]);
    };
    
    request.onsuccess = (event: any) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('refs')) { 
          console.warn("Le store 'refs' n'existe pas dans la DB Shop.");
          resolve([]); 
          return; 
      }
      
      const tx = db.transaction('refs', 'readonly');
      const req = tx.objectStore('refs').getAll();
      
      req.onsuccess = () => {
          const results = req.result || [];
          console.log(`[DEBUG] Chat a trouvé ${results.length} images dans le Shop.`);
          resolve(results.map((img: any) => img.base64));
      };
      
      req.onerror = () => {
          console.error("Erreur lecture store refs");
          resolve([]);
      };
    };
  });
};

const getShopCssUrl = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const request = indexedDB.open('StudioCode_Assets');
    
    request.onerror = () => resolve(null);
    request.onsuccess = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('settings')) { resolve(null); return; }
      
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get('master_css_url');
      
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    };
  });
};

const fetchInspirationCSS = async (url: string): Promise<string> => {
  if (!url) return "";
  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    return data.success && data.fullCSS ? data.fullCSS : "";
  } catch (e) { return ""; }
};
        
// ------------------------------------------------------

// --- LOGIQUE D'ANALYSE (Fonctions pures) ---
const parseRootVariables = (css: string): { name: string; value: string }[] => {
  const variables: { name: string; value: string }[] = []
  const globalBlocksMatch = css.match(/:root\s*{[^}]*}|html\s*{[^}]*}|body\s*{[^}]*}/g)
  if (!globalBlocksMatch) return variables
  const globalContent = globalBlocksMatch.join("\n")
  const variableRegex = /(--[\w-]+)\s*:\s*([^;]+);/g
  let match
  while ((match = variableRegex.exec(globalContent)) !== null) {
    variables.push({ name: match[1].trim(), value: match[2].trim() })
  }
  return variables
}
const extractFontFaces = (css: string): string => {
  const fontFaceRegex = /@font-face\s*{[^}]*}/g
  const matches = css.match(fontFaceRegex)
  return matches ? matches.join("\n\n") : ""
}
const findPotentialComponents = (html: string): { tag: string; selector: string }[] => {
  if (typeof window === "undefined") return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const components: { tag: string; selector: string }[] = []
  const tagsToFind = ["header", "img", "aside", "ul", "li", "h1", "h2", "h3", "h4", "p", "span", "a", "nav", "footer", "section", "button"]
  tagsToFind.forEach((tag) => {
    if (doc.querySelector(tag)) components.push({ tag, selector: tag })
  })
  const cards: { tag: string; selector: string }[] = []
  doc.querySelectorAll("div").forEach((div, index) => {
    if (div.querySelector("img") && div.querySelector("h1, h2, h3, p, span, header, nav, a, button, aside, footer, section, img, video, ul, li, ol")) {
      const uniqueSelector = `[data-gemini-card-id="${index}"]`
      div.setAttribute("data-gemini-card-id", `${index}`)
      cards.push({ tag: `Card (div)`, selector: uniqueSelector })
    }
  })
  if (cards.length > 0) {
    components.push(...cards.slice(0, 5))
  }
  return components
}
const cloneWithComputedStyles = (element: Element): HTMLElement => {
  const clone = element.cloneNode(false) as HTMLElement
  const computedStyle = window.getComputedStyle(element)
  const stylePropertiesToCopy = [
    "display",
    "flex-direction",
    "align-items",
    "justify-content",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "margin",
    "padding",
    "border",
    "border-radius",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "text-align",
    "text-decoration",
    "box-shadow",
    "opacity",
    "transform",
    "transition",
    "overflow",
  ]
  let styleString = ""
  for (const prop of stylePropertiesToCopy) {
    const value = computedStyle.getPropertyValue(prop)
    if (value) styleString += `${prop}: ${value}; `
  }
  clone.setAttribute("style", styleString)
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) clone.appendChild(cloneWithComputedStyles(child as Element))
    else if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode())
  })
  return clone
}




// --- COULEURS ET STYLE DE BASE ---

// --- COULEURS ET STYLE DE BASE (Mise à jour) ---
// --- COULEURS ET STYLE DE BASE (MISES À JOUR) ---
// --- CONFIGURATION DU THÈME MOZILLA (STYLE VISUEL SEUL) ---
const customThemeColors = {
  editorBackground: "#FFFFFF",
  lineNumberBackground: "#FFFFFF",
  lineNumberColor: "#888888", // Numéros de ligne inactifs
  cursorColor: "#333333",
  selectionBackground: "rgba(180, 215, 255, 0.4)",
  activeLineBackground: "#FAFAFA",
  
  // POLICE DU CODE (Mozilla Text)
  fontFamily: '"Mozilla Headline", sans-serif', 
  fontSize: '14px', 
  
  // POLICE DES NUMÉROS DE LIGNE (Mozilla Headline)
  lineNumberFontSize: '15px',
  lineNumberFontFamily: '"Mozilla Headline", sans-serif', 
};


// --- THÈME GLOBAL (EditorView.theme) ---

const customEditorTheme = EditorView.theme({
  "&": {
    // Le texte du code sera noir (la couleur par défaut)
    color: "#333333", 
    backgroundColor: customThemeColors.editorBackground,
    fontFamily: customThemeColors.fontFamily, 
    fontSize: customThemeColors.fontSize,
    height: "100%",
  },
  ".cm-content": {
    caretColor: customThemeColors.cursorColor,
    padding: "16px 0",
  },
  
  // Gouttière (Numéros de ligne)
  ".cm-gutters": {
    backgroundColor: customThemeColors.lineNumberBackground, // Blanc
    color: customThemeColors.lineNumberColor, // Gris #888
    border: "none",
    paddingRight: "10px", 
    width: "48px", 
    fontSize: customThemeColors.lineNumberFontSize, 
    fontFamily: customThemeColors.lineNumberFontFamily, 
  },
  
  ".cm-line": {
    padding: "0 16px 0 0",
  },
  
  // Ligne et numéro actif
  ".cm-activeLine": {
    backgroundColor: customThemeColors.activeLineBackground,
  },
  ".cm-activeLineGutter": {
    backgroundColor: customThemeColors.lineNumberBackground, 
    color: "#000000", // Noir
    fontWeight: "600",
  },
  
  // Sélection
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: customThemeColors.selectionBackground,
  },
}, { dark: false });


// --- EXTENSION FINALE (SANS COLORATION SYNTAXIQUE) ---
export const customEditorExtension = [
  customEditorTheme,
];


    


// --- DÉBUT DU COMPOSANT DatabaseConnector ---

interface DatabaseConnectorProps {
    dbConfig: DatabaseConfig | null;
    setDbConfig: (config: DatabaseConfig | null) => void;
    sendChat: (message: string) => Promise<void>;
}

const DatabaseConnector: React.FC<DatabaseConnectorProps> = ({ dbConfig, setDbConfig, sendChat }) => {
    const [isSelectingProvider, setIsSelectingProvider] = useState(false);
    const [selectedProviderId, setSelectedProviderId] = useState<DatabaseProvider>(null);
    const [tempCredentials, setTempCredentials] = useState<{ [key: string]: string }>({});

    // Récupère l'icône du fournisseur actif
    const ActiveIcon = useMemo(() => {
        if (!dbConfig) return null;
        const provider = providersData.find(p => p.id === dbConfig.provider);
        return provider ? provider.icon : null;
    }, [dbConfig]);
    
    // Logique de connexion et notification de l'IA
    const handleConnect = async () => {
        if (!selectedProviderId) return;

        const providerInfo = providersData.find(p => p.id === selectedProviderId);
        if (!providerInfo) return;
        
        // 1. Mise à jour de la configuration
        const newConfig: DatabaseConfig = {
            provider: selectedProviderId,
            credentials: tempCredentials,
        };
        
        setDbConfig(newConfig); // Met à jour l'état et le localStorage
        setIsSelectingProvider(false);
        setSelectedProviderId(null);
        setTempCredentials({});

        // 2. Préparation et envoi du message à l'IA pour créer le .env
        const envContent = Object.entries(tempCredentials)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
            
        const aiMessage = `[AUTOMATED ACTION] L'utilisateur a connecté la base de données ${providerInfo.name}. Veuillez créer un fichier d'environnement nommé .env à la racine du projet avec le contenu suivant pour configurer l'accès au backend :\n\n\`\`\`\n${envContent}\n\`\`\nAssurez-vous que les clés sont bien les variables d'environnement nécessaires pour ${providerInfo.name}.`;

        await sendChat(aiMessage);
    };

    // La modale/le panneau de configuration
    const ConfigurationPanel = () => {
        const currentProvider = providersData.find(p => p.id === selectedProviderId);

        if (!currentProvider) {
            // Vue de sélection du fournisseur (Dropdown)
            return (
                <div className="p-4 border flex flex-col gap-2 rounded-[12px] shadow-lg bg-[#F7F5F3] w-[350px] h-auto">
                    <h3 className="font-semibold mb-3 text-sm">Choose provider</h3>
                    {providersData.map(p => (
                        <button 
                            key={p.id}
                            className="w-full border  bg-transparent border-[rgba(55,50,47,0.90)] text-black h-[35px] rounded-[8px] flex items-center gap-2 justify-center p-1"
                            onClick={() => {
                                const initialCreds = dbConfig?.provider === p.id ? dbConfig.credentials : {};
                                setTempCredentials(initialCreds);
                                setSelectedProviderId(p.id as DatabaseProvider);
                            }}
                        >
                            {p.icon()} <span className="text-sm">{p.name}</span>
                        </button>
                    ))}
                    {dbConfig && (
                        <button 
                            onClick={() => { setDbConfig(null); setIsSelectingProvider(false); }} 
                            className="w-full mt-3 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[30px]  rounded-[12px] flex items-center justify-center p-1"
                        >
                            Disconnect
                        </button>
                    )}
                </div>
            );
        }

        // Vue de saisie des identifiants (si un provider est sélectionné)
        return (
            <div className="p-4 border rounded-[12px] shadow-lg bg-[#F7F5F3] w-83">
                <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">{currentProvider.icon()} {currentProvider.name} Credentials</h3>
                {currentProvider.credentials.map(key => (
                    <div key={key} className="mb-3">
                        <label className="block text-xs font-medium mb-1">{key}</label>
                        <input
                            type="text"
                            className="w-full p-1 h-[28px] border rounded-[10px] text-sm"
                            value={tempCredentials[key] || ''}
                            onChange={(e) => setTempCredentials({ ...tempCredentials, [key]: e.target.value })}
                            placeholder={key}
                        />
                    </div>
                ))}
                <button 
                    onClick={handleConnect} 
                    className="w-full mt-3 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[30px]  rounded-[12px] flex items-center justify-center p-1"
                    disabled={currentProvider.credentials.some(key => !tempCredentials[key] || tempCredentials[key] === '')}
                >
                    Connecter {currentProvider.name}
                </button>
                <button 
                    onClick={() => setSelectedProviderId(null)} 
                    className="w-full text-gray-600 py-1 text-sm mt-2  pt-2"
                >
                     Back to selection
                </button>
            </div>
        );
    };

    return (
        <div className="relative">
            <button
                className={`w-auto px-2 py-1 h-[25px] border rounded-[8px] flex items-center justify-center gap-2 text-sm transition-colors ${dbConfig ? 'bg-green-100 border-green-500 text-green-700 font-medium' : 'border-black hover:bg-gray-50'}`}
                onClick={() => {
                    setIsSelectingProvider(!isSelectingProvider);
                    if (isSelectingProvider) { 
                        setSelectedProviderId(null);
                        setTempCredentials({});
                    }
                }}
            >
                {ActiveIcon ? (
                    <>
                        {ActiveIcon()} 
                        <p className="text-xs">{dbConfig.provider}</p>
                    </>
                ) : (
                    <p className="text-sm">Connect database</p>
                )}
            </button>
            
            {/* Rendu du panneau (positionné absolument) */}
            {isSelectingProvider && (
                <div className="absolute top-full mt-2 right-0 z-50">
                    <ConfigurationPanel />
                </div>
            )}
        </div>
    );
};





// En haut de votre fichier SandboxPage.tsx (avant export default function SandboxPage() { ... })
const READ_FILE_REGEX = /<read_file\s+path=["']([^"']+)["']\s*\/>/;

// ... (vos types, imports, et autres constantes globales)



// Nouveau format d’artefact de lecture
const FETCH_FILE_REGEX = /<fetch_file\s+path=["']([^"']+)["']\s*\/>/;






// ── ModelSelector ──────────────────────────────────────────────────────────────
function ModelSelector({ selected, onChange }: { selected: ModelOption; onChange: (m: ModelOption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-[rgba(55,50,47,0.12)] bg-white/60 hover:bg-white transition-colors text-[11px] font-semibold text-[#37322F]/70 hover:text-[#37322F]"
      >
        {selected.provider === 'gemini'
          ? <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=16" alt="" className="w-3 h-3 rounded-sm" />
          : <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=32" alt="" className="w-3 h-3 rounded-sm" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
        }
        <span>{selected.label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-50 bg-white rounded-xl border border-[rgba(55,50,47,0.10)] shadow-xl overflow-hidden min-w-[210px] py-1">
            <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-[#37322F]/40">Google Gemini</p>
            {MODEL_OPTIONS.filter(m => m.provider === 'gemini').map(m => (
              <button key={m.id} onClick={() => { onChange(m); setOpen(false); }}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors hover:bg-[#f7f4ed] ${selected.id === m.id ? 'bg-[#f7f4ed] font-semibold text-[#37322F]' : 'text-[#37322F]/70'}`}>
                <img src="https://www.google.com/s2/favicons?domain=gemini.google.com&sz=16" alt="" className="w-3 h-3 rounded-sm shrink-0" />
                {m.label}
                {m.badge && <span className="ml-auto text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">{m.badge}</span>}
              </button>
            ))}
            <div className="border-t border-[rgba(55,50,47,0.07)] mt-1" />
            <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-[#37322F]/40">Anthropic Claude</p>
            {MODEL_OPTIONS.filter(m => m.provider === 'anthropic').map(m => (
              <button key={m.id} onClick={() => { onChange(m); setOpen(false); }}
                className={`w-full px-3 py-2 flex items-center gap-2 text-left text-xs transition-colors hover:bg-[#f7f4ed] ${selected.id === m.id ? 'bg-[#f7f4ed] font-semibold text-[#37322F]' : 'text-[#37322F]/70'}`}>
                <img src="https://www.google.com/s2/favicons?domain=claude.ai&sz=32" alt="" className="w-3 h-3 rounded-sm shrink-0" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
                {m.label}
                {m.badge && <span className="ml-auto text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">{m.badge}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── AuthModal ──────────────────────────────────────────────────────────────────
function AuthModal({ onClose }: { onClose?: () => void }) {
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);

  const doAuth = async (fn: () => Promise<any>) => {
    setLoading(true); setError('');
    try { await fn(); onClose?.(); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative bg-[#fafaf9] rounded-2xl border border-[rgba(55,50,47,0.12)] shadow-2xl w-[380px]">
        {onClose && <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-[rgba(55,50,47,0.08)] text-[#37322F]/50 transition-colors"><X size={16} /></button>}
        <div className="p-8 flex flex-col gap-4">
          <div className="flex flex-col items-center gap-1 mb-1">
            <div className="w-10 h-10 rounded-xl bg-[#37322F] flex items-center justify-center mb-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10h12M10 4v12" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            </div>
            <h2 className="text-xl font-bold text-[#37322F]">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
            <p className="text-xs text-[#37322F]/50">Studio Code 1.0</p>
          </div>
          <button onClick={() => doAuth(() => signInWithPopup(_fbAuth, _googleProvider))} disabled={loading}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-[rgba(55,50,47,0.15)] bg-white hover:bg-[#f7f4ed] text-sm font-medium text-[#37322F] transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M15.54 8.18c0-.59-.05-1.15-.15-1.7H8v3.22h4.23c-.18.97-.73 1.8-1.56 2.35v1.95h2.52c1.48-1.36 2.33-3.36 2.33-5.82z" fill="#4285F4"/><path d="M8 16c2.12 0 3.9-.7 5.2-1.9l-2.52-1.95c-.7.47-1.6.75-2.68.75-2.06 0-3.8-1.39-4.42-3.27H.98v2.02A7.97 7.97 0 0 0 8 16z" fill="#34A853"/><path d="M3.58 9.63A4.82 4.82 0 0 1 3.33 8c0-.57.1-1.12.25-1.63V4.35H.98A7.97 7.97 0 0 0 0 8c0 1.29.31 2.5.98 3.65l2.6-2.02z" fill="#FBBC05"/><path d="M8 3.18c1.16 0 2.2.4 3.02 1.18l2.27-2.27C11.9.7 10.13 0 8 0A7.97 7.97 0 0 0 .98 4.35l2.6 2.02C4.2 4.57 5.95 3.18 8 3.18z" fill="#EA4335"/></svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-[rgba(55,50,47,0.1)]"/><span className="text-[10px] text-[#37322F]/40 uppercase tracking-widest">or</span><div className="flex-1 h-px bg-[rgba(55,50,47,0.1)]"/></div>
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] bg-white text-sm text-[#37322F] placeholder:text-[#37322F]/30 outline-none focus:border-[rgba(55,50,47,0.4)] transition-colors"/>
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') doAuth(()=> mode==='login' ? signInWithEmailAndPassword(_fbAuth,email,password) : createUserWithEmailAndPassword(_fbAuth,email,password));}} className="h-10 px-3 rounded-xl border border-[rgba(55,50,47,0.15)] bg-white text-sm text-[#37322F] placeholder:text-[#37322F]/30 outline-none focus:border-[rgba(55,50,47,0.4)] transition-colors"/>
          {error && <p className="text-xs text-red-500 -mt-2">{error}</p>}
          <button onClick={() => doAuth(() => mode==='login' ? signInWithEmailAndPassword(_fbAuth,email,password) : createUserWithEmailAndPassword(_fbAuth,email,password))}
            disabled={loading||!email||!password} className="w-full h-10 bg-[#37322F] hover:bg-[rgba(55,50,47,0.85)] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
            {loading ? 'Signing in...' : mode==='login' ? 'Sign in' : 'Create account'}
          </button>
          <p className="text-center text-xs text-[#37322F]/50">
            {mode==='login' ? "No account? " : "Already have an account? "}
            <button onClick={()=>setMode(mode==='login'?'signup':'login')} className="text-[#37322F] font-semibold hover:underline">{mode==='login'?'Sign up':'Sign in'}</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── ShowcaseSlider — infinite auto-sliding carousel from Firebase ─────────────
interface ShowcaseSlideItem { id: string; imageUrl: string; title: string; category: string; order: number; }
function ShowcaseSlider({ slides }: { slides: ShowcaseSlideItem[] }) {
  const [active, setActive] = React.useState(0);
  const [dir, setDir] = React.useState<'next'|'prev'>('next');
  const [animating, setAnimating] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const go = React.useCallback((d: 'next' | 'prev') => {
    if (animating || slides.length < 2) return;
    setDir(d);
    setAnimating(true);
    setActive(prev => {
      if (d === 'next') return (prev + 1) % slides.length;
      return (prev - 1 + slides.length) % slides.length;
    });
    setTimeout(() => setAnimating(false), 520);
  }, [animating, slides.length]);

  useEffect(() => {
    timerRef.current = setInterval(() => go('next'), 4500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [go]);

  if (!slides.length) return null;

  return (
    <div style={{ width: '100%', margin: '0', padding: '0 0 28px' }}>
      <style>{`
        @keyframes sc-sl-next { from { transform:translateX(110%) scale(0.95); opacity:0 } to { transform:translateX(0) scale(1); opacity:1 } }
        @keyframes sc-sl-prev { from { transform:translateX(-110%) scale(0.95); opacity:0 } to { transform:translateX(0) scale(1); opacity:1 } }
        .sc-sl-in-next { animation: sc-sl-next 0.5s cubic-bezier(0.25,0.46,0.45,0.94) both; }
        .sc-sl-in-prev { animation: sc-sl-prev 0.5s cubic-bezier(0.25,0.46,0.45,0.94) both; }
      `}</style>

      {/* Title */}
      <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(55,50,47,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        What you can build
      </p>

      {/* Track */}
      <div style={{ position: 'relative', width: '100%', height: 320, borderRadius: 0, overflow: 'hidden', background: 'rgba(55,50,47,0.05)' }}>
        {slides.map((slide, i) => {
          const isActive = i === active;
          return (
            <div
              key={slide.id}
              className={isActive && animating ? (dir === 'next' ? 'sc-sl-in-next' : 'sc-sl-in-prev') : ''}
              style={{
                position: 'absolute', inset: 0,
                opacity: isActive ? 1 : 0,
                transition: !animating ? 'opacity 0.2s' : undefined,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              {slide.imageUrl ? (
                <img
                  src={slide.imageUrl} alt={slide.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,rgba(55,50,47,0.07),rgba(55,50,47,0.03))' }}>
                  <span style={{ fontSize: 14, color: 'rgba(55,50,47,0.28)', fontWeight: 500 }}>{slide.category}</span>
                </div>
              )}
              {/* Bottom gradient overlay */}
              <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'linear-gradient(to top,rgba(0,0,0,0.65) 0%,transparent 100%)', padding:'40px 18px 16px', borderRadius:0 }}>
                <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.6)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{slide.category}</span>
                <div style={{ fontSize:17, fontWeight:700, color:'#fff', marginTop:3, lineHeight:1.2 }}>{slide.title}</div>
              </div>
            </div>
          );
        })}

        {/* Arrow buttons */}
        {(['prev','next'] as const).map(d => (
          <button
            key={d}
            onClick={() => go(d)}
            style={{
              position:'absolute', top:'50%', transform:'translateY(-50%)',
              [d === 'prev' ? 'left' : 'right']: 12,
              width:36, height:36, borderRadius:'50%',
              background:'rgba(255,255,255,0.92)', border:'none',
              boxShadow:'0 2px 12px rgba(0,0,0,0.18)',
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', zIndex:5, transition:'transform 0.15s, background 0.15s',
              outline:'none',
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(-50%) scale(1)')}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#37322F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {d === 'prev'
                ? <polyline points="10,3 5,8 10,13"/>
                : <polyline points="6,3 11,8 6,13"/>}
            </svg>
          </button>
        ))}
      </div>

      {/* Dot indicators */}
      <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:14 }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => { if (i !== active) { setDir(i > active ? 'next' : 'prev'); setAnimating(true); setActive(i); setTimeout(() => setAnimating(false), 520); } }}
            style={{ width: i === active ? 20 : 6, height:6, borderRadius:999, background: i === active ? '#37322F' : 'rgba(55,50,47,0.18)', border:'none', cursor:'pointer', transition:'all 0.3s ease', padding:0 }}
          />
        ))}
      </div>
    </div>
  );
}

// --- COMPOSANT PRINCIPAL ---
export default function SandboxPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  // ── isAiStreaming : true UNIQUEMENT pendant sendChat (pas pendant runAction) ──
  const isAiStreamingRef = React.useRef(false);
  const [isAiStreaming, setIsAiStreaming] = useState(false);
  // ── Reload animation ──
  const [isReloading, setIsReloading] = useState(false);
  // ── Quota 429 : timestamp de reset stocké dans localStorage ─────────────────
  const [quotaResetAt, setQuotaResetAt] = React.useState<number | null>(() => {
    try {
      const v = localStorage.getItem('quota_reset_at');
      if (v) { const t = parseInt(v, 10); if (t > Date.now()) return t; }
    } catch {}
    return null;
  });
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // ── Build steps for preview area progress display ─────────────────────────
  interface BuildStep { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; }
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);
  // ── isRunning: true ONLY during runSequence (not sendChat) — controls preview UI ──
  const [isRunning, setIsRunning] = useState(false);
  // ── Sandbox TTL: E2B resets 15 min after the LAST API call — track it ────
  // If now - lastSandboxActivity > 13 min, consider sandbox dead, force re-create
  const SANDBOX_INACTIVITY_TTL_MS = 13 * 60 * 1000;
  const lastSandboxActivityRef = React.useRef<number | null>(null);
  // ── Track package.json content at last install, for smart run detection ───
  const runSeqPkgJsonRef = React.useRef<string>("");
  // ── Auto-run trigger: set true after AI produces file artifacts ───────────
  const [pendingAutoRun, setPendingAutoRun] = useState(false);
  // ── Abort token: increment to cancel in-flight runSequence on project switch ──
  const runSeqTokenRef = React.useRef(0);
  // ── Page-load auto-run: true on each fresh component mount ───────────────
  const isPageLoadRef = React.useRef(true);
  // ── Track previous project id to detect project switches ─────────────────
  const prevProjectIdRef = React.useRef<string | null>(null);
  const [files, setFiles] = useState<{ filePath: string; content: string }[]>([])
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Hello! Let's build something." }])
  const [chatInput, setChatInput] = useState("")
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview")
  const [activeFile, setActiveFile] = useState(0)
  // Track if user manually selected a file during stream — prevents auto-switching to streaming file
  const userSelectedFileRef = React.useRef<number | null>(null);
  const isStreamingRef = React.useRef(false);
  const sessionTokensProcessedRef = React.useRef(false); // reset each sendChat
  const streamReaderRef = React.useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const srLoggedRef = React.useRef<Set<string>>(new Set()); // dedup STR_REPLACE logs per session
  const monacoEditorRef = React.useRef<any>(null); // Monaco editor instance for imperative setValue
  // ── Timer global — persiste à travers le double sendChat (vibes relaunch) ───
  const globalStreamStartRef = React.useRef<number | null>(null);
  // ── liveFile : fichier actuellement en cours d'écriture (path + contenu partiel) ──
  // Mis à jour atomiquement à chaque chunk → pilote Editor, FileTree, Breadcrumb
  const [liveFile, setLiveFile] = React.useState<{ path: string; content: string } | null>(null);
  // Wrapped setActiveFile that records user intent
  const setActiveFileUser = React.useCallback((idx: number) => {
    if (isStreamingRef.current) {
      userSelectedFileRef.current = idx; // User explicitly clicked a file during stream
    }
    setActiveFile(idx);
  }, []);
  const [logsHeight, setLogsHeight] = useState(25)
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false)
  // ── Model selector ───────────────────────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState<ModelOption>(MODEL_OPTIONS[0]);
  // Ref version so sendChat always reads the CURRENT model even in stale closures
  const selectedModelRef = React.useRef<ModelOption>(MODEL_OPTIONS[0]);
  // Keep ref in sync with state
  React.useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
  const [pendingApiKeyProvider, setPendingApiKeyProvider] = useState<ModelProvider | null>(null);
  // ── Firebase auth ────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // ── Showcase slider (Firebase) ────────────────────────────────────────────────
  interface ShowcaseSlide { id: string; imageUrl: string; title: string; category: string; order: number; }
  const [showcaseSlides, setShowcaseSlides] = useState<ShowcaseSlide[]>([]);
  const [sliderIndex, setSliderIndex] = useState(0);
  const [sliderAnimating, setSliderAnimating] = useState(false);
  const sliderTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderTrackRef = React.useRef<HTMLDivElement>(null);

  // ── Audio recording ───────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  const [iframeRoute, setIframeRoute] = useState("/")
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  // ⚠️ À placer au début de votre composant SandboxPage
const [isCloning, setIsCloning] = useState(false)
const [cloneUrl, setCloneUrl] = useState("")
// Assurez-vous d'importer les icônes nécessaires de Lucide React
  // Dans votre composant principal (e.g., SandboxPage)
const [copiedFileIndex, setCopiedFileIndex] = useState(null);
const [isGitHubOpen, setIsGitHubOpen] = useState(false);
const [previewModalHtml, setPreviewModalHtml] = useState<string | null>(null);
// ... et d'ajouter ces états dans votre composant principal (e.g., SandboxPage)
const [copiedMessageIndex, setCopiedMessageIndex] = useState(null);
const [expandedMessageIndex, setExpandedMessageIndex] = useState(null);
// Dans votre composant parent (e.g. SandboxPage)

// Assurez-vous d'importer Check, Copy, Download (pour les boutons de fichier) si ce n'est pas déjà fait.

// État pour contrôler l'ouverture de la modal
// ==============================================================================
// 🛑 ÉTATS ET LOGIQUE DE DÉPLOIEMENT VERCEL (Intégrés)
// ==============================================================================

// État du Token (à côté de vos autres useState)
const [vercelToken, setVercelToken] = useState<string>('');
const [tokenError, setTokenError] = useState<string>('');
const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
const [isVercelModalOpen, setIsVercelModalOpen] = useState<boolean>(false);
  // DANS VOTRE COMPOSANT PRINCIPAL (où vous avez déjà vos autres useState)

// Nouveaux états de contrôle de l'UI
const [isDeploymentModalOpen, setIsDeploymentModalOpen] = useState(false);
const [deploymentDetails, setDeploymentDetails] = useState({ 
    status: 'idle', // 'idle', 'deploying', 'success', 'error'
    message: '', 
    url: null, 
    error: null 
});

// État 'connections' qui contient le jeton Vercel (à adapter à votre structure)
// ANCIENNE VERSION FRAGILE (à remplacer)
// const [connections, setConnections] = useState({ vercel: typeof window !== 'undefined' && localStorage.getItem('vercel_access_token') ? { token: localStorage.getItem('vercel_access_token') } : null });

// 🟢 NOUVELLE VERSION SÛRE : Initialisation simple et sans dépendance
const [connections, setConnections] = useState({ 
    vercel: null,
    github: null // Ajoutez d'autres plateformes si nécessaire
});


  // DANS VOTRE COMPOSANT PRINCIPAL
useEffect(() => {
    const unsub = onAuthStateChanged(_fbAuth, (user) => {
      setCurrentUser(user);
      // Fermer automatiquement le modal d'auth dès que l'utilisateur est connecté
      if (user) setShowAuthModal(false);
    });
    return () => unsub();
  }, []);

useEffect(() => {
    // Exécuté uniquement côté client (après le premier rendu)
    if (typeof window !== 'undefined') {
        const vercelToken = localStorage.getItem('vercel_access_token');
        if (vercelToken) {
            setConnections(prev => ({
                ...prev,
                vercel: { token: vercelToken }
            }));
        }
    }
}, []);

  const [showDeploymentStatus, setShowDeploymentStatus] = useState(false);


    const [isSearchOpen, setIsSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState("");
const [searchFilter, setSearchFilter] = useState<"all"|"today"|"week"|"recent">("all");
// Token usage tracking (daily, stored in IDB)
const [dailyTokensUsed, setDailyTokensUsed] = useState(0);       // total tokens (prompt+output+thinking)
const [sessionCandidateTokens, setSessionCandidateTokens] = useState(0); // output tokens only (what user cares about)
const DAILY_TOKEN_LIMIT = 10_000_000; // 10M daily window
const TOKEN_IDB_KEY = "gemini-daily-tokens";
const [showApiKeyPanel, setShowApiKeyPanel] = useState(false);


    

// Fonction placeholder (à adapter si vous avez une modale dédiée pour l'entrée du jeton)
const setShowTokenModal = (platform) => { 
    alert(`Veuillez d'abord enregistrer votre jeton d'accès Vercel.`);
    // Vous pouvez ici implémenter la logique pour ouvrir la modal de jeton
};

// État de chargement global pour le déploiement (utilisé pour désactiver le bouton)
const [isConnecting, setIsConnecting] = useState({ deploy: false });

// ... (vos autres états existants : sandboxId, currentProject, etc.)
// État du Déploiement
type DeployState = 'IDLE' | 'TOKEN_VALIDATED' | 'DEPLOYING' | 'MONITORING' | 'SUCCESS' | 'ERROR';
const DEPLOYMENT_STATES: Record<DeployState, DeployState> = {
    IDLE: 'IDLE',
    TOKEN_VALIDATED: 'TOKEN_VALIDATED',
    DEPLOYING: 'DEPLOYING',
    MONITORING: 'MONITORING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR',
};
interface LogEntry { timestamp: string; message: string; type: 'info' | 'error' | 'success' | 'start' | 'status'; }

const [deployState, setDeployState] = useState<DeployState>(DEPLOYMENT_STATES.IDLE);
const [deployLogs, setDeployLogs] = useState<LogEntry[]>([]); // Renommés pour ne pas confondre avec 'logs'
const [deployUrl, setDeployUrl] = useState<string>('');
const logIntervalRef = useRef<NodeJS.Timeout | null>(null); 
const VERCEL_TOKEN_KEY = 'vercel_access_token';
const VERCEL_TOKEN_URL = 'https://vercel.com/account/tokens'; 

// NOUVEAUX ÉTATS POUR LE DÉPLOIEMENT SIMPLIFIÉ

const [deploying, setDeploying] = useState(false); // État de chargement du bouton
const [deployStatus, setDeployStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR' | 'LOADING'>('IDLE');
const [deployResult, setDeployResult] = useState<string | null>(null); // URL ou message d'erreur

// Référence pour le scroll des logs
const logsEndRef = useRef<HTMLDivElement>(null);


// 1. Déclarer ces états en haut de ton composant
const [isSaaSMode, setIsSaaSMode] = useState(false);
const [saasTodo, setSaasTodo] = useState<{name: string, status: 'pending' | 'building' | 'done'}[]>([]);

// 2. La fonction liée à ton bouton "Activer Mode SaaS"
const startBuildSaasMode = async (appDescription: string) => {
  setIsSaaSMode(true);
  setSaasTodo([]);
  addLog("🚀 Lancement du Mode Build SaaS...");

  // On force le CLASSIFICATION: CHAT_ONLY pour que l'API s'arrête juste après l'Architecte
  const prompt = `Voici mon idée de SaaS : ${appDescription}. 
  Génère UNIQUEMENT un plan strict sous format XML avec les pages à créer, au format exact :
  <saas-pages>
    <page>Dashboard</page>
    <page>Settings</page>
  </saas-pages>
  N'ajoute aucun code. Ajoute OBLIGATOIREMENT "CLASSIFICATION: CHAT_ONLY" à la fin de ta réponse pour stopper la chaîne.`;
  
  

    const result = await sendChat(prompt);
  const responseText = result?.text;
  

    if (responseText) {
    const saasPagesMatch = responseText.match(/<saas-pages>([\s\S]*?)<\/saas-pages>/);
    if (saasPagesMatch) {
       const pages = [...saasPagesMatch[1].matchAll(/<page>(.*?)<\/page>/g)].map(m => m[1]);
       const todoList = pages.map(p => ({ name: p, status: 'pending' as const }));
       setSaasTodo(todoList);
       
       addLog(`📋 Plan généré : ${pages.length} pages à construire.`);
       
       // IMPORTANT : On passe le currentProject actuel pour démarrer la boucle
       setTimeout(() => processNextSaasPage(todoList, currentProject), 3000);
    } else {
       addLog("❌ Erreur: Le plan XML n'a pas été détecté.");
       setIsSaaSMode(false);
    }
  }
};

// 3. L'Orchestrateur (La boucle de todo list)


const processNextSaasPage = async (
    currentTodo: {name: string, status: 'pending' | 'building' | 'done'}[], 
    accumulatedProjectContext: any // <--- NOUVEL ARGUMENT CRUCIAL
) => {
   const nextIndex = currentTodo.findIndex(p => p.status === 'pending');
   
   if (nextIndex === -1) {
       addLog("🎉 SaaS Build Mode terminé !");
       setIsSaaSMode(false);
       return;
                  }
    const updatedTodo = [...currentTodo];
   updatedTodo[nextIndex].status = 'building';
   setSaasTodo(updatedTodo);

   const pageName = updatedTodo[nextIndex].name;
   addLog(`⚙️ Construction de la page : ${pageName}...`);

   const prompt = `[MODE SAAS ACTIF] Construis la page : "${pageName}"...`;

    // IMPORTANT : On passe accumulatedProjectContext au lieu de laisser sendChat prendre le state React
   const result = await sendChat(prompt, accumulatedProjectContext);

   // On récupère le texte ET le projet mis à jour
   const responseText = result?.text;
   const newProjectState = result?.updatedProject || accumulatedProjectContext; 

   if (responseText?.includes('[PAGE_DONE]')) {
       const finishedTodo = [...updatedTodo];
       finishedTodo[nextIndex].status = 'done';
       setSaasTodo(finishedTodo);
       
       addLog(`✅ Page ${pageName} terminée.`);

    
       
       setTimeout(() => {
           // ON PASSE LE "newProjectState" À LA PROCHAINE ITÉRATION
           processNextSaasPage(finishedTodo, newProjectState);
       }, 5000); 
   } else {
       // ... gestion erreur
       addLog(`⚠️ La page ${pageName} n'a pas renvoyé le signal de fin. Mode SaaS interrompu par sécurité.`);
 
       setIsSaaSMode(false);
   }
};
// ----------------------
// Fonctions de la Modal
// ----------------------

const addDeployLog = useCallback((message: string, type: LogEntry['type']) => {
    const timestamp = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    setDeployLogs(prev => [...prev, { timestamp, message, type }]);
}, []);

const stopLogPolling = useCallback(() => {
    if (logIntervalRef.current) {
        clearInterval(logIntervalRef.current);
        logIntervalRef.current = null;
    }
}, []);

const fetchVercelLogs = useCallback(async (id: string, currentUrl: string) => {
    const statusUrl = `https://api.vercel.com/v13/deployments/${id}`;
    const token = localStorage.getItem(VERCEL_TOKEN_KEY);
    if (!token) {
        addDeployLog('Erreur: Jeton Vercel manquant pour le suivi.', 'error');
        stopLogPolling();
        setDeployState(DEPLOYMENT_STATES.ERROR);
        return;
    }

    try {
        const response = await fetch(statusUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        if (!response.ok) {
            addDeployLog(`Erreur de l'API Vercel pendant le suivi: ${data.error?.message || 'Erreur inconnue'}`, 'error');
            stopLogPolling();
            setDeployState(DEPLOYMENT_STATES.ERROR);
            return;
        }

        const currentState = data.state as string; 
        
        if (!deployLogs.find(log => log.message.includes(`Statut: ${currentState}`))) {
             addDeployLog(`Statut: ${currentState}`, 'status');
        }
        
        if (currentState === 'READY' || currentState === 'CANCELED' || currentState === 'ERROR') {
            stopLogPolling();
        }

        if (currentState === 'READY') {
            addDeployLog(`✅ Déploiement terminé avec succès! URL: ${currentUrl}`, 'success');
            setDeployState(DEPLOYMENT_STATES.SUCCESS);
        } else if (currentState === 'ERROR') {
            addDeployLog('❌ Déploiement ÉCHOUÉ. Veuillez consulter le tableau de bord Vercel.', 'error');
            setDeployState(DEPLOYMENT_STATES.ERROR);
        } 
    } catch (error) {
        addDeployLog(`Erreur de Polling: ${(error as Error).message}`, 'error');
        stopLogPolling();
        setDeployState(DEPLOYMENT_STATES.ERROR);
    }
}, [addDeployLog, stopLogPolling, deployLogs]); // Attention aux dépendances pour éviter les boucles

const startLogPolling = useCallback((id: string, currentUrl: string) => {
    stopLogPolling();
    logIntervalRef.current = setInterval(() => {
        fetchVercelLogs(id, currentUrl);
    }, 3000); 
}, [fetchVercelLogs, stopLogPolling]);

// DANS VOTRE COMPOSANT REACT PRINCIPAL (SandboxPage ou autre)

// ... vos autres fonctions et états

const startDeployment = useCallback(async () => {
    if (deployState === DEPLOYMENT_STATES.DEPLOYING || deployState === DEPLOYMENT_STATES.MONITORING) return;
    
    const token = localStorage.getItem(VERCEL_TOKEN_KEY);

    if (!token) {
        setTokenError('Jeton manquant. Veuillez l\'enregistrer.');
        return;
    }
    
    // Vérification des dépendances critiques
    if (!currentProject || !currentProject.files || currentProject.files.length === 0 || !sandboxId) {
        addDeployLog('Erreur: Projet, fichiers ou Sandbox ID manquant.', 'error');
        return;
    }

    addDeployLog(`Début du déploiement pour '${currentProject.name}'...`, 'start');
    setDeployState(DEPLOYMENT_STATES.DEPLOYING);
    setDeployLogs([]);
    setDeployUrl('');
    stopLogPolling();

    // 🛑 CONVERSION ET INCLUSION DES FICHIERS DU PROJET
    // Convertir l'array de fichiers du projet ({filePath, content}) en un objet (map)
    // où la clé est le path et la valeur est le contenu. (Format attendu par la route API)
    const projectFilesMap: Record<string, string> = {};
    currentProject.files.forEach(file => {
        // Assurez-vous que le chemin est relatif (ex: app/page.tsx)
        const relativePath = file.filePath.startsWith('/') ? file.filePath.substring(1) : file.filePath;
        projectFilesMap[relativePath] = file.content;
    });

    const deploymentPayload = {
        projectName: currentProject.name,
        token: token,
        sandboxId: sandboxId,
        files: projectFilesMap, // 🟢 PASSAGE DIRECT DES FICHIERS
    };

    try {
        const response = await fetch('/api/deploy/vercel', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deploymentPayload),
        });

        const data: { success: boolean; error?: string; deploymentId?: string; url?: string } = await response.json();

        if (!response.ok || !data.success || !data.deploymentId || !data.url) {
            const errorMsg = data.error || 'Erreur inconnue lors du lancement du déploiement.';
            addDeployLog(`ÉCHEC: ${errorMsg}`, 'error');
            setDeployState(DEPLOYMENT_STATES.ERROR);
            setTokenError(errorMsg); 
            return;
        }

        // Succès du lancement
        addDeployLog(`Déploiement lancé avec succès! ID: ${data.deploymentId}`, 'success');
        setDeployUrl(data.url);
        setDeployState(DEPLOYMENT_STATES.MONITORING);

        // Commence le Polling des Logs Vercel
        startLogPolling(data.deploymentId, data.url);

    } catch (error) {
        addDeployLog(`Erreur critique de la requête API: ${(error as Error).message}`, 'error');
        setDeployState(DEPLOYMENT_STATES.ERROR);
    }
}, [deployState, currentProject, sandboxId, startLogPolling, stopLogPolling, addDeployLog]);

// ... le reste du code JSX de votre modal

// Effet pour le scroll des logs
useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [deployLogs]);

// Assurez-vous que cette fonction fait partie de votre composant principal
// où les états connections, currentSandboxId, currentProject, projectName,
// setDeploymentDetails, et setIsConnecting sont disponibles.



      
  
// ----------------------
// Fonctions utilitaires du Token (à appeler dans le JSX)
// ----------------------
const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVercelToken(e.target.value.trim());
    setTokenError('');
};

const saveToken = () => {
    if (vercelToken) { 
        localStorage.setItem(VERCEL_TOKEN_KEY, vercelToken);
        setDeployState(DEPLOYMENT_STATES.TOKEN_VALIDATED);
        setShowTokenInput(false);
        setTokenError('');
    } else {
        setTokenError('Veuillez entrer un jeton d\'accès Vercel valide (trop court).');
    }
};

const removeToken = () => {
    localStorage.removeItem(VERCEL_TOKEN_KEY);
    setVercelToken('');
    setDeployState(DEPLOYMENT_STATES.IDLE);
    setShowTokenInput(true);
    setDeployLogs([]);
    stopLogPolling();
    addDeployLog('Jeton Vercel supprimé. Veuillez en fournir un nouveau.', 'info');
};


      

        // DANS VOTRE COMPOSANT REACT PRINCIPAL


// ... autres états (deploying, deployStatus, deployResult)



// ... (Vos autres états)
const [uploadedImages, setUploadedImages] = useState<string[]>([]);
// 🛑 NOUVEAUX ÉTATS
const [uploadedFiles, setUploadedFiles] = useState<{ fileName: string; base64Content: string }[]>([]);
const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);
const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
const [isMentionDropdownOpen, setIsMentionDropdownOpen] = useState(false);
const MAX_FILES = 5; // Limite générale pour les fichiers et images
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
 const [pendingAutoSend, setPendingAutoSend] = useState(false)

const [viewMode, setViewMode] = useState("chat"); // 'chat' ou 'preview'

// Fonction pour basculer
const toggleViewMode = (mode) => {
  setViewMode(mode);
};
  
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  
const [currentPlan, setCurrentPlan] = useState("");
const [showProjectSelect, setShowProjectSelect] = useState(false) // <-- AJOUTEZ CET ÉTAT
         
  const [showSidebar, setShowSidebar] = useState(false)



    // 🛑 NOUVEL ÉTAT RAG : Le cache vectoriel du projet 🛑
    const [projectEmbeddings, setProjectEmbeddings] = useState<IndexedChunk[]>([]);
    
    // --- LOGIQUE D'INDEXATION DES FICHIERS ---
    
    const reindexFile = useCallback(async (file: any /* Utilisez votre type ProjectFile réel ici */) => {
        if (file.content.length < 50) return; 
        
        const newChunks = await indexFileContent(file);
        
        setProjectEmbeddings(prevEmbeddings => 
            updateProjectEmbeddings(newChunks, prevEmbeddings)
        );
    }, []);

    // --- GESTION DE L'INDEXATION LORS DU CHARGEMENT DE PROJET ---
    
    useEffect(() => {
        if (currentProject) {
            currentProject.files.forEach((file: any /* Utilisez votre type ProjectFile réel ici */) => {
                 reindexFile(file);
            });
        } else {
            setProjectEmbeddings([]); // Réinitialiser si aucun projet
        }
    }, [currentProject, reindexFile]);


  useEffect(() => {
  if (currentProject) {
    if (files !== currentProject.files) {
      setFiles(currentProject.files)
    }
  } else if (files.length > 0) {
    setFiles([])
  }
}, [currentProject])
  
  


  // --- NOUVEAUX ÉTATS/RÉFÉRENCES (À placer avec vos autres const [state, ...] = useState) ---
const chatBottomRef = useRef<HTMLDivElement>(null); // Pour le scrolling automatique du chat
// Vous utilisez déjà `loading` pour le spinner, mais ce state peut être utile pour l'UI chat
const [isChatDisabled, setIsChatDisabled] = useState(false); 
  

// --- DANS SandboxPage(), après vos autres const [state, setState] = useState(...) ---

// NOUVEAUX ÉTATS ET FONCTIONS POUR LA BASE DE DONNÉES
const [dbConfig, setDbConfigState] = useState<DatabaseConfig | null>(null);

// Fonction enveloppe pour gérer l'état de la DB et le localStorage
const setDbConfig = (config: DatabaseConfig | null) => {
    setDbConfigState(config);
    
    if (config) {
        localStorage.setItem('dbConfig', JSON.stringify(config));
    } else {
        localStorage.removeItem('dbConfig');
    }
    
    // Notification à l'IA en cas de DÉCONNEXION
    if (!config && dbConfigState?.provider) {
         sendChat(`[AUTOMATED ACTION] L'utilisateur a déconnecté la base de données ${dbConfigState.provider}. Veuillez supprimer le fichier .env et notifier que le projet est maintenant sans backend configuré.`);
    }
};

// USE EFFECT 1: Chargement initial depuis le localStorage
useEffect(() => {
    const savedConfig = localStorage.getItem('dbConfig');
    if (savedConfig) {
        try {
            setDbConfigState(JSON.parse(savedConfig));
        } catch (e) {
            console.error("Failed to parse dbConfig from localStorage", e);
            localStorage.removeItem('dbConfig');
        }
    }
}, []);

// USE EFFECT 2: Synchronisation de l'état 'files' (Celui que nous avons corrigé précédemment)
useEffect(() => {
    if (currentProject) {
        if (currentProject.files !== files) {
             setFiles(currentProject.files);
        }
    } else if (files.length > 0) {
        setFiles([]);
    }
}, [currentProject, files, setFiles]);

// ... (Vos autres fonctions et logiques)
  



  
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { setShowSidebar(false); setShowProjectSelect(false); }
  }
  // Click outside sidebar to close
  const onClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (showProjectSelect && !target.closest('[data-sidebar]')) {
      setShowProjectSelect(false);
    }
    if (showSidebar && !target.closest('[data-sidebar-panel]')) {
      setShowSidebar(false);
    }
  }
  window.addEventListener("keydown", onKey)
  window.addEventListener("mousedown", onClickOutside)
  return () => {
    window.removeEventListener("keydown", onKey)
    window.removeEventListener("mousedown", onClickOutside)
  }
}, [showProjectSelect, showSidebar])
  

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const chatScrollAreaRef = useRef<HTMLDivElement>(null)

  // ── Auto-run after AI produces file artifacts ──────────────────────────────
  useEffect(() => {
    if (pendingAutoRun && !loading && !isAiStreaming) {
      setPendingAutoRun(false);
      setTimeout(() => runSequence(), 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun, loading, isAiStreaming]);

  // ── Load showcase slides from Firebase ───────────────────────────────────────
  useEffect(() => {
    const q = query(collection(_fbDb, "showcase_slides"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setShowcaseSlides(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShowcaseSlide)));
    }, () => {
      setShowcaseSlides([
        { id: '1', imageUrl: '', title: 'SaaS Dashboard', category: 'Dashboard', order: 1 },
        { id: '2', imageUrl: '', title: 'E-Commerce Store', category: 'E-commerce', order: 2 },
        { id: '3', imageUrl: '', title: 'Landing Page', category: 'Landing Page', order: 3 },
      ]);
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Project switch / page-load auto-run ───────────────────────────────────
  useEffect(() => {
    const newId = currentProject?.id ?? null;
    const prevId = prevProjectIdRef.current;

    if (newId !== prevId) {
      // ── Abort any in-flight runSequence from previous project ─────────────
      runSeqTokenRef.current++;       // invalidates old run
      setLoading(false);
      setIsRunning(false);
      setBuildSteps([]);

      // Reset sandbox state when switching to a different project
      if (prevId !== null && newId !== null) {
        setSandboxId(null);
        setPreviewUrl(null);
        lastSandboxActivityRef.current = null;
        runSeqPkgJsonRef.current = "";
      }

      prevProjectIdRef.current = newId;

      // ── Page-load: run on every fresh mount (works for reload + new tab) ──
      // ── Project switch: run for the newly loaded project ──────────────────
      // Skip if: no project, empty project (new chat), or first render is null→null
      if (newId && currentProject && currentProject.files.length > 0) {
        const isProjectSwitch = prevId !== null && prevId !== newId;
        const isPageLoad = isPageLoadRef.current;
        isPageLoadRef.current = false;

        if (isPageLoad || isProjectSwitch) {
          setTimeout(() => runSequence(), isPageLoad ? 1500 : 400);
        }
      } else {
        // New chat / empty project — just mark page load as done
        isPageLoadRef.current = false;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem("studio-projects")
      if (savedProjects) {
        setProjects(JSON.parse(savedProjects))
      }
    } catch (error) {
      console.error("Failed to load projects from localStorage", error)
    }
  }, [])

  useEffect(() => {
    if (chatScrollAreaRef.current) {
      chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [messages])

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const saveProjectsToLocalStorage = (updatedProjects: Project[]) => {
    try {
      localStorage.setItem("studio-projects", JSON.stringify(updatedProjects))
    } catch (error) {
      addLog("Error saving projects to localStorage.")
    }
  }


// DANS VOTRE COMPOSANT PRINCIPAL


  
  

// DANS VOTRE COMPOSANT PRINCIPAL (utilisant useCallback)

const handleDeploy = async () => {
    // 0. Démarrage initial et configuration de l'état de chargement
    setShowDeploymentStatus(true);
    setDeploymentDetails({ status: 'idle', message: 'Démarrage du processus de déploiement...', url: null, error: null });
    setIsConnecting(prev => ({ ...prev, deploy: true })); // Début du chargement

    // === 1. COLLECTE ET VÉRIFICATION SÛRE DES DONNÉES ESSENTIELLES ===
    
    // Extraction sûre des valeurs nécessaires
    const token = connections?.vercel?.token;
    const project = currentProject;
    const sandbox = sandboxId; // Récupère la valeur du scope
    
    // Conditions de garde strictes
    if (!token) {
        setDeploymentDetails({ status: "error", message: "Jeton Vercel manquant.", error: "Veuillez enregistrer votre jeton d'accès." });
        setShowTokenModal("vercel"); 
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return; 
    }
    
    if (!sandbox) {
        setDeploymentDetails({ status: "error", message: "Sandbox ID manquant.", error: "Impossible de déployer sans une sandbox active." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return;
    }
    
    if (!project || !project.name || !project.files || project.files.length === 0) {
        setDeploymentDetails({ status: "error", message: "Projet incomplet.", error: "Nom du projet ou fichiers manquants." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return;
    }

    // === 2. NORMALISATION DU NOM VERCEL (OBLIGATOIRE POUR L'API) ===
    let vercelProjectName = project.name.toLowerCase().trim();
    
    // Nettoyage pour respecter Vercel (minuscules, tirets)
    vercelProjectName = vercelProjectName.replace(/[^a-z0-9._-]/g, '-');
    vercelProjectName = vercelProjectName.replace(/-{2,}/g, '-');
    vercelProjectName = vercelProjectName.replace(/^[._-]+|[._-]+$/g, '');
    vercelProjectName = vercelProjectName.substring(0, 100);

    if (vercelProjectName.length === 0) {
        vercelProjectName = `default-app-${sandbox.substring(0, 4)}`;
    }
    
    // === 3. PRÉPARATION DES FICHIERS ===
    let projectFilesMap = {};
    try {
        project.files.forEach(file => {
            const relativePath = file.filePath.startsWith('/') ? file.filePath.substring(1) : file.filePath;
            if (file.content) {
              projectFilesMap[relativePath] = file.content;
            }
        });
        
        if (Object.keys(projectFilesMap).length === 0) {
            throw new Error("Aucun fichier valide à déployer n'a été trouvé dans le projet.");
        }
    } catch (e) {
        setDeploymentDetails({ status: "error", message: "Erreur de préparation des fichiers.", error: e.message || "Problème avec la structure de 'project.files'." });
        setIsConnecting(prev => ({ ...prev, deploy: false }));
        return; 
    }
    
    setDeploymentDetails(prev => ({ ...prev, status: "deploying", message: `Déploiement de "${vercelProjectName}" en cours...` }));

    // === 4. APPEL À L'API ===
    try {
      const response = await fetch("/api/deploy/vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: projectFilesMap,
          projectName: vercelProjectName,
          token: token,
          sandboxId: sandbox, 
        }),
      });

      const data = await response.json();
      if (data.success) {
        setDeploymentDetails({
          status: "success",
          message: "Déploiement lancé avec succès ! L'URL est en ligne.",
          url: data.url,
        });
      } else {
        setDeploymentDetails({
          status: "error",
          message: `Déploiement échoué : ${data.error || "Erreur inconnue"}`,
          error: data.details || data.error || "Erreur Vercel. Vérifiez les logs.",
        });
      }
    } catch (error) {
      console.error("[v0] Échec du déploiement:", error);
      setDeploymentDetails({
        status: "error",
        message: "Échec du déploiement (erreur réseau ou interne)",
        error: error.message || "Erreur inattendue. Voir la console.",
      });
    } finally {
      setIsConnecting(prev => ({ ...prev, deploy: false }));
    }
};
      



const parseMessageContent = (content: string) => {
  
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
  
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonContent = JSON.parse(jsonMatch[1])
      
      // 1. Détection de la structure de Fichiers (Création/Modification complète)
      if (
        Array.isArray(jsonContent) &&
        jsonContent.length > 0 &&
        typeof jsonContent[0] === 'object' &&
        'filePath' in jsonContent[0] &&
        'content' in jsonContent[0]
      ) {
        return {
          type: 'files',
          data: jsonContent.map((f: any) => f.filePath as string), 
          raw: content, 
        }
      } 
      // 2. Détection de la structure de Changements de Fichiers (Patch: fileChanges)
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'fileChanges' &&
        jsonContent.filePath
      ) {
        return {
          type: 'fileChanges', // Nouveau type
          data: [jsonContent.filePath as string], // Un seul fichier affecté
          raw: content, 
        }
      }
      // 3. Détection de l'URL d'inspiration
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'inspirationUrl' &&
        jsonContent.url
      ) {
        return {
          type: 'url',
          data: jsonContent.url as string,
          raw: content,
        }
      }

    } catch (e) {
      // Ignorer l'erreur et afficher le contenu comme texte
    }
  }

  // 4. Cas par défaut: Contenu texte normal ou JSON mal formé/inconnu
  return {
    type: 'text',
    data: content,
  }
}
  


    // 1. CHARGEMENT INITIAL (Ajoute ceci dans tes useEffect)
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const storedProjects = await getAllProjectsFromIDB();
        if (storedProjects && storedProjects.length > 0) {
           setProjects(storedProjects);
        }
        // Load daily token usage
        const tokenData = await getTokenUsageFromIDB();
        const today = new Date().toISOString().slice(0, 10);
        if (tokenData.date === today) {
          setDailyTokensUsed(tokenData.total);
        }
      } catch (error) {
        console.error("Erreur chargement IDB:", error);
        addLog("Failed to load projects from database.");
      }
    };
    loadInitialData();
  }, []);


  // 2. FONCTION DE SAUVEGARDE GLOBALE
  // Remplace ton ancienne fonction saveProjectsToLocalStorage par celle-ci
  const saveProject = async () => {
  if (!currentProject) return;

  // On récupère les données les plus fraîches directement
  const updatedProject = {
      ...currentProject,
      files: files,      
      messages: messages 
  };

  try {
      await saveProjectToIDB(updatedProject);
      
      // Mise à jour de la liste latérale sans recharger tout le projet
      setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
  } catch (error) {
      console.error("Save error:", error);
  }
};


  // 3. CRÉATION DE PROJET
  const createNewProject = async () => {
    const projectNamje = prompt("Enter project name:", `Project ${projects.length + 1}`)
    if (!projectName) return
    
    const newPrpoject = { 
      id: crypto.randomUUID(),
      name: projectName,
      createdAt: new Date().toISOString(),
      files: [],
      messages: [{ role: "assistant", content: `Project "${projectName}" is ready. What should we build?` }],
    }

    try {
        // On sauvegarde d'abord dans la DB pour être sûr
        await saveProjectToIDB(newProject);
        
        // Ensuite on met à jour l'UI
        const updatedProjects = [...projects, newProject]
        setProjects(updatedProjects)
        
        // Et on charge
        loadProject(newProject.id)
        addLog(`Project "${projectName}" created.`)
        
    } catch (err) {
        addLog("Error creating project in DB.")
    }
  }



  const confirmCreateProject = async () => {
    if (!newProjectName.trim()) return
    
    const newProject = { 
      id: crypto.randomUUID(),
      name: newProjectName,
      createdAt: new Date().toISOString(),
      files: [],
      messages: [{ role: "assistant", content: `Project "${newProjectName}" is ready. What should we build?` }],
    }

    try {
        await saveProjectToIDB(newProject)
        const updatedProjects = [...projects, newProject]
        setProjects(updatedProjects)
        loadProject(newProject.id)
        
        setIsModalOpen(false)
        setNewProjectName("")
        addLog(`Project "${newProjectName}" created.`)
    } catch (err) {
        addLog("Error creating project in DB.")
    }
        }
    

  // 4. CHARGEMENT D'UN PROJET
  // Note : loadProject reste synchrone ici car on lit depuis l'état 'projects' 
  // qui a été peuplé par le useEffect au démarrage.
    const loadProject = (projectId: string) => {
    const projectToLoad = projects.find((p) => p.id === projectId)
    if (!projectToLoad) return

    setSandboxId(null)
    setPreviewUrl(null)
    setIsRunning(false)
    setBuildSteps([])
    runSeqTokenRef.current++ // abort any in-flight run
    setIframeRoute("/") // reset la route iframe pour ne pas charger l'URL de l'ancien projet
    addLog("Sandbox reset for new project.")
    
    setCurrentProject(projectToLoad)
    // Defensive: old projects may have undefined files/messages
    setFiles(Array.isArray(projectToLoad.files) ? projectToLoad.files : [])
    setMessages(Array.isArray(projectToLoad.messages) && projectToLoad.messages.length > 0
      ? projectToLoad.messages
      : [{ role: "assistant", content: "Hello! Let's build something." }])
    setActiveFile(0)

    // Mise à jour de l'URL : nom-du-projet+ID
    const slug = `${projectToLoad.name.replace(/\s+/g, '-').toLowerCase()}+${projectToLoad.id}`
    window.history.pushState({}, '', `/chat/${slug}`)

    addLog(`Project "${projectToLoad.name}" loaded.`)
    }
    
  const goToDashboard = () => {
    setCurrentProject(null)
    setFiles([])
    setMessages([])
    setSandboxId(null)
    setChatInput("")
    window.history.pushState({}, '', '/chat')
  }
    

    

  // 5. CHANGEMENT DE PROJET (CLICK)
  const handleProjectClick = async (projectId: string) => {
    if (currentProject) {
      // On attend que la sauvegarde soit finie avant de changer
      await saveProject() 
    }
    loadProject(projectId)
    setShowSidebar(false)
        }

const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation(); // Empêche le clic de charger le projet alors qu'on veut le supprimer
    
    if (!confirm("Voulez-vous vraiment supprimer ce projet définitivement ?")) return;

    try {
        // 1. Supprimer de la DB
        await deleteProjectFromIDB(projectId);
        
        // 2. Mettre à jour l'interface (liste locale)
        const updatedList = projects.filter(p => p.id !== projectId);
        setProjects(updatedList);

        // 3. Si on supprime le projet en cours, on réinitialise
        if (currentProject?.id === projectId) {
            setCurrentProject(null);
            setFiles([]);
            setMessages([]);
            setSandboxId(null);
        }
        
        addLog("Projet supprimé avec succès.", "success");
    } catch (err) {
        console.error(err);
        addLog("Erreur lors de la suppression.", "error");
    }
            }
    

  const updateFile = (value: string, viewUpdate: any) => {
  if (viewUpdate.docChanged) {
    setFiles(prev => {
      const updated = [...prev]
      if (updated[activeFile]) updated[activeFile] = { ...updated[activeFile], content: value }
      return updated
    })

    if (currentProject) {
      const newFiles = [...currentProject.files]
      if (newFiles[activeFile]) newFiles[activeFile].content = value
      setCurrentProject({ ...currentProject, files: newFiles })
    }
  }
  }


useEffect(() => {
  const path = window.location.pathname;
  if (path.includes('/chat/')) {
    const slug = path.split('/chat/')[1];
    if (slug && slug.includes('+')) {
      const projectId = slug.split('+').pop();
      
      // On cherche dans l'IDB directement au lieu d'attendre l'état 'projects'
      if (projectId) {
        getAllProjectsFromIDB().then(all => {
          const toLoad = all.find(p => p.id === projectId);
          if (toLoad) {
            setCurrentProject(toLoad);
            setFiles(toLoad.files);
            setMessages(toLoad.messages);
          }
        });
      }
    }
  }
}, []); // 👈 VIDE ! Ne pas mettre [projects] ici.
      
    


const handleSelectProject = async (projectId: string) => {
  if (currentProject) {
    await saveProject();
  }
  loadProject(projectId);
  setIsSearchOpen(false);
  if (typeof setShowSidebar === 'function') setShowSidebar(false);
  if (typeof setShowProjectSelect === 'function') setShowProjectSelect(false);
};

const groupedProjects = useMemo(() => {
  const sorted = [...projects].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const groups: Record<string, typeof projects> = {};

  sorted.forEach((project) => {
    const date = new Date(project.createdAt);
    const dateKey = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(project);
  });

  return groups;
}, [projects]);

const filteredProjects = projects.filter(p => {
  const matchesQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase());
  if (!matchesQuery) return false;
  const now = Date.now();
  const created = new Date(p.createdAt).getTime();
  const lastOpened = p.lastOpenedAt ? new Date(p.lastOpenedAt).getTime() : created;
  if (searchFilter === "today") return (now - lastOpened) < 86400000;
  if (searchFilter === "week") return (now - lastOpened) < 604800000;
  if (searchFilter === "recent") return (now - lastOpened) < 259200000; // 3 days
  return true;
});




          
const applyAndSetFiles = (responses: any[]) => {
  if (!currentProject) return;

  // UTILISE l'état 'files' actuel, pas celui de 'currentProject'
  setFiles(prevFiles => {
    const newFiles = [...prevFiles];
    let filesUpdated = false;

    responses.forEach((res) => {
      if (res.type === "inspirationUrl") return;

      if (res.type === "fileChanges" && res.filePath && res.changes) {
        const idx = newFiles.findIndex(f => f.filePath === res.filePath);
        if (idx !== -1) {
          newFiles[idx].content = applyChanges(newFiles[idx].content, res.changes);
          filesUpdated = true;
        }
      } else if (res.filePath && typeof res.content === "string") {
        const cleanContent = res.content.replace(/```[\s\S]*?```/g, "").replace(/^diff\s*/gm, "").trim();
        const idx = newFiles.findIndex(f => f.filePath === res.filePath);
        if (idx !== -1) {
          newFiles[idx].content = cleanContent;
        } else {
          newFiles.push({ filePath: res.filePath, content: cleanContent });
        }
        filesUpdated = true;
      }
    });

    if (filesUpdated) {
        // On met à jour le projet global avec ces nouveaux fichiers
        const updatedProject = { ...currentProject, files: newFiles, messages: messages };
        saveProjectToIDB(updatedProject); 
        setActiveTab("code");
    }
    return newFiles;
  });
};


  // NOTE: Cette fonction doit être définie dans le même scope que sendChat.


  const applyChanges = (originalContent: string, changes: any[]): string => {
  const lines = originalContent.split("\n");

  const deletions = changes.filter(c => c.action === "delete").sort((a, b) => b.startLine - a.startLine);
  const insertions = changes.filter(c => c.action === "insertAfter").sort((a, b) => b.lineNumber - a.lineNumber);
  const replacements = changes.filter(c => c.action === "replace");

  deletions.forEach(change => {
    const start = change.startLine - 1;
    const end = change.endLine - 1;
    if (start >= 0 && end >= start && end < lines.length) {
      lines.splice(start, end - start + 1);
    }
  });

  insertions.forEach(change => {
    const index = change.lineNumber - 1;
    if (index >= -1 && index < lines.length) {
      lines.splice(index + 1, 0, change.contentToInsert);
    }
  });

  replacements.forEach(change => {
    const index = change.lineNumber - 1;
    if (index >= 0 && index < lines.length) {
      lines[index] = change.newContent;
    }
  });

  return lines.join("\n");
};

  /**
   * Applique une opération edit_file sur un contenu de fichier.
   * Retourne le nouveau contenu ou le contenu original en cas d'erreur.
   */
  const applyEditFileOp = (
    content: string,
    action: string,
    changes: string,
    startLine?: number,
    endLine?: number
  ): { result: string; error?: string } => {
    const lines = content.split("\n");
    const total = lines.length;
    const clamp = (n: number) => Math.max(1, Math.min(n, total));

    const sl = startLine !== undefined ? clamp(startLine) : undefined;
    const el = endLine   !== undefined ? clamp(endLine)   : sl;
    const newLines = changes.replace(/\n$/, "").split("\n");

    switch (action) {
      case "replace": {
        if (sl === undefined) return { result: content, error: "start_line requis pour replace" };
        const start = sl - 1;
        const end   = (el ?? sl) - 1;
        if (start < 0 || end >= total || start > end)
          return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl} (total: ${total})` };
        return { result: [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)].join("\n") };
      }
      case "insert_after": {
        if (sl === undefined) return { result: content, error: "start_line requis pour insert_after" };
        const idx = sl - 1;
        if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
        return { result: [...lines.slice(0, idx + 1), ...newLines, ...lines.slice(idx + 1)].join("\n") };
      }
      case "insert_before": {
        if (sl === undefined) return { result: content, error: "start_line requis pour insert_before" };
        const idx = sl - 1;
        if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
        return { result: [...lines.slice(0, idx), ...newLines, ...lines.slice(idx)].join("\n") };
      }
      case "delete": {
        if (sl === undefined) return { result: content, error: "start_line requis pour delete" };
        const start = sl - 1;
        const end   = (el ?? sl) - 1;
        if (start < 0 || end >= total || start > end)
          return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl}` };
        return { result: [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n") };
      }
      case "append": {
        return { result: content + "\n" + changes };
      }
      default:
        return { result: content, error: `Action inconnue: ${action}` };
    }
  };
  


                                   


  const applyArtifactsToProject = (finalArtifacts: FileArtifact[], projectOverride?: typeof currentProject) => {
  const targetProject = projectOverride ?? currentProject;
  if (!targetProject) {
    addLog("❌ Aucun projet chargé, impossible d'appliquer les artifacts.");
    return;
  }

  const newFiles = [...targetProject.files];
  let projectUpdated = false;

  // ── Traite d'abord les edit_file (groupés par fichier, triés descendant) ──────
  const editArtifactsByFile = new Map<string, FileArtifact[]>();
  finalArtifacts.filter(a => a.type === 'edit').forEach(a => {
    if (!editArtifactsByFile.has(a.filePath)) editArtifactsByFile.set(a.filePath, []);
    editArtifactsByFile.get(a.filePath)!.push(a);
  });

  for (const [filePath, ops] of editArtifactsByFile.entries()) {
    const index = newFiles.findIndex(f => f.filePath === filePath);
    if (index === -1) {
      addLog(`⚠️ Fichier introuvable pour edit_file: ${filePath}`);
      continue;
    }
    const sortedOps = [...ops].sort((a, b) => {
      const al = a.editAction === "append" ? Infinity : (a.startLine ?? 0);
      const bl = b.editAction === "append" ? Infinity : (b.startLine ?? 0);
      return bl - al; // descendant pour préserver les numéros de ligne
    });
    let currentContent = newFiles[index].content;
    let opCount = 0;
    for (const op of sortedOps) {
      const { result, error } = applyEditFileOp(
        currentContent,
        op.editAction ?? "replace",
        op.content,
        op.startLine,
        op.endLine
      );
      if (error) {
        addLog(`⚠️ edit_file échoué sur ${filePath} (${op.editAction}@${op.startLine}): ${error}`);
      } else {
        currentContent = result;
        opCount++;
      }
    }
    if (opCount > 0) {
      newFiles[index] = { ...newFiles[index], content: currentContent };
      addLog(`✏️ ${opCount} edit_file appliqué(s) sur ${filePath}`);
      projectUpdated = true;
    }
  }

  // ── Traite ensuite les create et changes ──────────────────────────────────────
  finalArtifacts.filter(a => a.type !== 'edit').forEach((artifact) => {
    const index = newFiles.findIndex((f) => f.filePath === artifact.filePath);

    // Nettoyage du contenu reçu
    let rawContent = artifact.content || "";
    let cleanContent = rawContent
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^diff\s*/gm, "")
      .trim();

    if (artifact.type === "create") {
      // Création ou remplacement complet
      if (index === -1) {
        newFiles.push({ filePath: artifact.filePath, content: cleanContent });
        addLog(`🆕 Fichier créé : ${artifact.filePath}`);
      } else {
        newFiles[index].content = cleanContent;
        addLog(`♻️ Fichier remplacé : ${artifact.filePath}`);
      }
      projectUpdated = true;
    }

    else if (artifact.type === "changes") {
      if (index !== -1) {
        try {
          let patchData: any[] = [];
          try {
            patchData = JSON.parse(cleanContent || "[]");
          } catch {
            addLog(`⚠️ Patch JSON invalide pour ${artifact.filePath}, ignoré.`);
            return;
          }

          if (Array.isArray(patchData) && patchData.length > 0) {
            const original = newFiles[index].content;
            const newContent = applyChanges(original, patchData);
            newFiles[index].content = newContent;
            addLog(`✏️ ${patchData.length} changements appliqués à ${artifact.filePath}`);
            projectUpdated = true;
          } else {
            addLog(`⚠️ Aucun changement valide à appliquer pour ${artifact.filePath}`);
          }
        } catch (e) {
          addLog(`❌ Échec du patch sur ${artifact.filePath}: ${e}`);
        }
      } else {
        addLog(`⚠️ Fichier introuvable pour patch (${artifact.filePath})`);
      }
    }
  });

  if (projectUpdated) {
    if (projectOverride) {
      const updatedProject = { ...targetProject, files: newFiles };
      setCurrentProject(updatedProject);
      setFiles(newFiles);
      saveProjectToIDB(updatedProject);
    } else {
      setCurrentProject((prev) =>
        prev ? { ...prev, files: newFiles } : null
      );
      saveProject();
    }
    addLog(`✅ Projet mis à jour après application des artifacts.`);
    setActiveTab("code");
  }
};


  
      

  
  const fillFilesFromGeminiResponse = (text: string) => {
    // --- Ligne de débogage ---
    // Affiche la réponse exacte de l'IA dans la console de votre navigateur (accessible avec F12)
    console.log("Texte brut reçu par fillFilesFromGeminiResponse:", text)

    let jsonString = ""
    // On cherche les délimiteurs d'un objet JSON `{...}`
    const firstBrace = text.indexOf("{")
    const lastBrace = text.lastIndexOf("}")

    // On cherche les délimiteurs d'un tableau JSON `[...]`
    const firstBracket = text.indexOf("[")
    const lastBracket = text.lastIndexOf("]")

    // On décide quelle structure extraire en priorité
    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      // Si on trouve un objet, et qu'il apparaît avant un éventuel tableau, on le choisit.
      jsonString = text.substring(firstBrace, lastBrace + 1)
    } else if (firstBracket !== -1 && lastBracket > firstBracket) {
      // Sinon, on choisit le tableau.
      jsonString = text.substring(firstBracket, lastBracket + 1)
    }

    if (!jsonString) {
      addLog(`❌ N'a trouvé aucune structure JSON ({...} ou [...]) dans la réponse.`)
      return
    }

    try {
      const parsed = JSON.parse(jsonString)

      if (Array.isArray(parsed)) {
        // Cas 1: C'est un tableau (pour la création de fichiers)
        applyAndSetFiles(parsed)
      } else if (typeof parsed === "object" && parsed !== null && parsed.type === "fileChanges") {
        // Cas 2: C'est un objet unique pour la modification d'un fichier
        applyAndSetFiles([parsed]) // On l'encapsule dans un tableau pour la fonction suivante
      } else {
        addLog(`❌ Le JSON a été parsé mais son format n'est pas reconnu.`)
      }
    } catch (e: any) {
      addLog(`❌ Échec du parsage du JSON extrait. Erreur: ${e.message}`)
      addLog(`--- Chaîne qui a échoué ---`)
      addLog(jsonString)
      addLog(`--------------------------`)
    }
  }

  




// ⚠️ À placer APRÈS la déclaration de vos states (e.g., `logsHeight`, `currentProject`, `messages`, `loading`, etc.)

/**
 * Lit les données d'analyse volumineuses stockées temporairement,
 * crée les fichiers Next.js correspondants dans le sandbox (app/page.tsx et app/globals.css),
 * puis notifie le LLM.
 */


  
// SandboxPage.tsx

/**
 * Traite le résultat de l'analyse d'URL après clonage, met à jour les fichiers locaux 
 * du projet et envoie un prompt d'injection détaillé à Gemini.
 */
const processAnalysisResult = async (fullHTML: string, fullCSS: string, fullJS: string, urlToAnalyze: string,) => {
    // Vérification de l'état du projet (inchangée)
    if (!currentProject || !setCurrentProject) {
        addLog("ERROR: Project state is missing or cannot be updated.")
        throw new Error("Project state is missing or cannot be updated.")
    }

    addLog(`[CLONE-FLOW] Phase 2: Updating local project files for ${urlToAnalyze}...`)
    setAnalysisStatus(`2/2: Mise à jour du projet local...`)

    // --- 1. Préparation du contenu des fichiers ---
    const trimmedHTML = fullHTML.trim();
    const trimmedJS = fullJS.trim();

    // Fonction d'échappement pour intégrer le contenu dans les templates litéraux (backticks)
    const escapeContent = (content: string) => {
        return content
            .replace(/\\/g, '\\\\') 
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');
    };
    
    const escapedHTML = escapeContent(trimmedHTML);
    const escapedJS = escapeContent(trimmedJS);

    // Contenu du nouveau app/page.tsx (avec CSS et JS intégrés)
    const newPageContent = `"use client"\n\nimport React from 'react'\n\nconst ClonedPage = () => {\n  return (\n    <>\n      <div\n        dangerouslySetInnerHTML={{ __html: \`${escapedHTML}\` }}\n      />\n      {${!!trimmedJS} && (\n          <script\n            dangerouslySetInnerHTML={{ __html: \`${escapedJS}\` }}\n          />\n      )}\n    </>\n  )\n}\n\nexport default ClonedPage`
    
    // Fichiers à mettre à jour
    const filesToUpdate = [
        { filePath: "app/globals.css", content: fullCSS },
        { filePath: "app/page.tsx", content: newPageContent },
    ]

    // --- 2. Mise à jour de l'état local du projet ---
    const newFilesMap = new Map(currentProject.files.map(f => [f.filePath, f]))

    for (const { filePath, content } of filesToUpdate) {
        newFilesMap.set(filePath, { filePath, content })
    }

    const updatedFiles = Array.from(newFilesMap.values())

    setCurrentProject(prevProject => {
        if (!prevProject) return null
        return {
            ...prevProject,
            files: updatedFiles, 
        }
    })
    
    addLog("[CLONE-FLOW] ✅ Local project files updated.");

    // --- 3. Construction du prompt d'injection de contexte pour Gemini ---
    let injectionContext = `
[ACTION AUTOMATISÉE DE CLONAGE]
Le code du site ${urlToAnalyze} a été cloné et écrit dans les fichiers suivants. Vous avez maintenant ce code pour référence dans ce tour de conversation.
`;

    filesToUpdate.forEach(file => {
        addLog(`[CLONE-FLOW] Injecting ${file.filePath} (${file.content.length} chars) into Gemini's prompt.`);

        injectionContext += `
[CONTENU DU FICHIER: ${file.filePath}]
\`\`\`${file.filePath.split('.').pop() || 'text'}
${file.content}
\`\`\`
[FIN CONTENU FICHIER: ${file.filePath}]

`;
    });

    // 🛑 NOUVEAU: On combine le contexte d'injection avec la demande originale. 
    // Cela force l'IA à considérer TOUT ce bloc comme son dernier message utilisateur.
    const finalInjectionPrompt = `
    Le site web ${urlToAnalyze} a été cloné. Les fichiers code source de celui-ci ont été créé et je pense que tu peux les voir dans ton historique. Confirme si tu peux les voir a l'utilisateur sans faire comme si tu répondais au message actuel. Et donne lui juste un peu de détails sur les fichiers du style à voir de quoi le site web parle et ce su'il contient. Pas besoin d'ultra analyse. C'est juste une confirmation.
    `;

    addLog("[CLONE-FLOW] ✅ Notifying Gemini with full file content...");
    
    // Appel de la fonction sendChat (qui est maintenant stable sans useCallback)
    await sendChat(finalInjectionPrompt) 
  }
          

  
  
              


/**
 * Gère le flux d'analyse complet, de l'envoi de l'URL à la création des fichiers.
 * Cette fonction est appelée soit par l'input (Clone website), soit par sendChat (artefact 'url').
 */



  

// ⚠️ Assurez-vous que parseRootVariables, extractFontFaces, findPotentialComponents, 
// cloneWithComputedStyles et sendChat sont disponibles dans le scope.
const runIsolationAndGeneration = async (
  fullHTML: string,
  fullCSS: string,
  baseURL: string,
  urlToAnalyze: string,
  originalUserPrompt: string
) => {
  setAnalysisStatus(`2/4: Analyse CSS et recherche des composants...`)
  
  const globalCssVariables = parseRootVariables(fullCSS)
  const fontFaces = extractFontFaces(fullCSS)
  const componentsToFind = findPotentialComponents(fullHTML)
  const isolatedComponents: { name: string; html: string }[] = []

  addLog(`[AUTO-FLOW] Found ${componentsToFind.length} relevant components to isolate.`)

  // --- Isolation de chaque composant ---
  for (const comp of componentsToFind) {
    setAnalysisStatus(`3/4: Isolation du composant: ${comp.tag}...`)
    addLog(`[AUTO-FLOW] Isolating component: ${comp.tag} (${comp.selector})`)

    const hiddenIframe = document.createElement("iframe")
    hiddenIframe.style.display = "none"
    document.body.appendChild(hiddenIframe)

    const isolatedHtml = await new Promise<string>((resolve, reject) => {
      hiddenIframe.onload = () => {
        const iframeDoc = hiddenIframe.contentDocument
        if (!iframeDoc) return reject(new Error("Could not access iframe document."))
        const element = iframeDoc.querySelector(comp.selector)
        if (element) resolve(cloneWithComputedStyles(element).outerHTML)
        else resolve("")
        document.body.removeChild(hiddenIframe)
      }
      hiddenIframe.srcdoc = `<!DOCTYPE html><html><head><base href="${baseURL}"><style>${fullCSS}</style></head><body>${fullHTML}</body></html>`
    })

    if (isolatedHtml) {
      isolatedComponents.push({ name: comp.tag, html: isolatedHtml })
      addLog(`[AUTO-FLOW] ✅ Component ${comp.tag} isolated successfully.`)
    }
  }

  setAnalysisStatus(`4/4: Préparation des données d'analyse...`)
  addLog(`[AUTO-FLOW] Analysis done. Returning structured data.`)

  return {
    urlToAnalyze,
    globalCssVariables,
    fontFaces,
    isolatedComponents,
    originalUserPrompt
  }
                                      }
          


             // -----------------------------------------------------
// 🔗 Liaison entre Gemini et le module d'analyse automatique
// -----------------------------------------------------
const handleInspirationUrl = async (url: string, originalUserPrompt: string) => {
  try {
    addLog(`[AUTO-FLOW] 🚀 Inspiration URL détectée: ${url}`);
    addLog(`[AUTO-FLOW] Déclenchement automatique de runAutomatedAnalysis pour ${url}`);
    
    // On appelle directement ta logique principale
    await runAutomatedAnalysis(url, originalUserPrompt, false);

  } catch (err: any) {
    addLog(`❌ Erreur pendant handleInspirationUrl: ${err.message}`);
  }
};


const runAutomatedAnalysis = async (
  urlToAnalyze: string,
  originalUserPrompt: string,
  isCloning: boolean = false
) => {
  if (!sandboxId) { 
    addLog("⚠️ Please create a sandbox first.");
    return;
  }

  setLoading(true);
  setIsCloning(false);
  setCloneUrl("");

  let fullCSS = '';
  let fullHTML = '';
  let fullJS = '';
  let baseURL = '';
  
  // 🛑 Tags structuraux clés à cibler par l'IA (Les blocs de design à réutiliser)
  const STRUCTURAL_TAGS = [
      'header', 'nav', 'main', 'aside', 'footer', 'section', 'article', 
      'h1', 'h2', 'a', 'button', 'input', 'form', 'figure', 'div[class*="card"]', 'div[class*="cta"]'
  ];
  const tagsList = STRUCTURAL_TAGS.join(', ');

  // =========================================================================
  // === DÉBUT DU FLUX RUNAUTOMATEDANALYSIS ===
  // =========================================================================

  try {
    setAnalysisStatus(`1/2: Analyse de ${urlToAnalyze} (Récupération des données)...`);
    addLog(`[AUTO-FLOW] Phase 1: Calling analysis API for ${urlToAnalyze}`);

    // --- Étape 1 : Récupération des données via ton API analyse ---
    const analysisRes = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlToAnalyze }),
    });

    const analysisData = await analysisRes.json();

    if (!analysisRes.ok || !analysisData.success) {
      addLog(`❌ Analysis API responded with error: ${analysisData.error || analysisRes.statusText}`);
      throw new Error(`Analysis API failed: ${analysisData.error || analysisRes.statusText}`);
    }

    // --- Étape 2 : Extraction du contenu ---
    fullCSS = analysisData.fullCSS || '';
    fullHTML = analysisData.fullHTML || '';
    fullJS = analysisData.fullJS || '';

    addLog(`[DEBUG] HTML size: ${fullHTML.length}, CSS size: ${fullCSS.length}, JS size: ${fullJS.length}`);

    baseURL = new URL(urlToAnalyze).origin;

    if (!fullHTML || !fullCSS || fullCSS.trim().length < 50) {
      throw new Error("Analysis failed: Le fullHTML ou le fullCSS est manquant/vide. Impossible de procéder à la génération de design.");
    }
    
    // --- Étape 3 : DISPATCH logique selon mode ---
    if (isCloning) {
      await processAnalysisResult(fullHTML, fullCSS, fullJS, urlToAnalyze); 
    } else {
      // 🧠 NOUVELLE ÉTAPE : Création du contexte avec FULL HTML et instructions renforcées
      setAnalysisStatus(`2/2: Envoi du contexte d'analyse renforcé à l'IA...`);
      addLog("[AUTO-FLOW] Sending FULL HTML + FULL CSS with maximum reinforced application instructions to Gemini.");
      
      const analysisContext = `
        

        Voici le fullcss que tu as demandé : 

        ${fullCSS}
      `;
      
      // 🚀 Envoi à ton système IA (api/gemini)
      await sendChat(`${analysisContext}`);
    }

  } catch (err: any) {
    const errorMessage = err.message || "Une erreur inconnue est survenue.";
    addLog(`❌ ERROR during automated analysis: ${errorMessage}`);
    setAnalysisStatus(`Erreur durant l'analyse: ${errorMessage}`);
  } finally {
    setLoading(false);
    setAnalysisStatus(null);
  }
};
                                                  
      

const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const remainingSlots = MAX_FILES - (uploadedImages.length + uploadedFiles.length);

    if (remainingSlots <= 0) {
        addLog("ERROR: Limite maximale d'uploads (images + fichiers) atteinte.");
        event.target.value = '';
        return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    const readAndProcessFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            addLog(`ERROR: Fichier non supporté: ${file.name}`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Url = e.target?.result as string;

            setUploadedImages((prev) => {
                // 🛑 CORRECTION: Vérification de l'existence par le Base64 
                // ou par un identifiant unique (ici, nous utilisons le Base64).
                // Cette vérification garantit l'idempotence contre le Strict Mode.
                if (prev.includes(base64Url)) {
                    return prev;
                }
                return [...prev, base64Url];
            });
        };
        reader.readAsDataURL(file);
    };

    filesToProcess.forEach(readAndProcessFile);
    
    // Réinitialise l'input
    event.target.value = '';
};
                                        
  



const handleScreenshot = async () => {
    if (uploadedImages.length + uploadedFiles.length >= MAX_FILES) {
        addLog("Limite d'uploads atteinte.");
        setIsPlusDropdownOpen(false);
        return;
    }
    
    setIsPlusDropdownOpen(false);

    // 🛑 VÉRIFICATION ROBUSTE de l'existence de l'API
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
        addLog("ERROR: Votre navigateur ou l'environnement actuel ne supporte pas la fonction de capture d'écran d'onglet (getDisplayMedia).");
        return;
    }

    try {
        addLog("Démarrage de la capture d'écran. Veuillez sélectionner l'onglet à partager...");
        
        // 1. Demande de capture
        // Utilisation du type correct pour garantir la compatibilité
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { mediaSource: 'tab' as any }, // 'tab' est une bonne suggestion pour cibler un onglet
            audio: false,
        });

        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) throw new Error("Capture annulée ou aucune piste vidéo n'a pu être obtenue.");

        // 2. Capture de l'image
        const imageCapture = new (window as any).ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        // 3. Conversion en Base64
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Impossible de créer le contexte du canvas.");
        ctx.drawImage(bitmap, 0, 0);

        const base64Url = canvas.toDataURL('image/png');
        
        // 4. Nettoyage
        videoTrack.stop();
        stream.getTracks().forEach(track => track.stop());
        
        // 5. Mise à jour de l'état
        setUploadedImages(prev => [...prev, base64Url]);
        addLog("Capture d'écran ajoutée avec succès.");

    } catch (err: any) {
        // Gère l'erreur d'annulation par l'utilisateur (nom souvent différent)
        if (err.name === "NotAllowedError" || err.message.includes("cancelled")) {
            addLog("Capture d'écran annulée par l'utilisateur.");
        } else {
             addLog(`ERROR: Échec de la capture d'écran: ${err.message}`);
        }
    }
};
          



const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const readAndProcessFile = (file: File) => {
        // Exclut les types non supportés (Audio, Vidéo, Images, etc.)
        if (file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type.startsWith('image/')) {
            addLog(`ERROR: Le type de fichier ${file.type} n'est pas supporté par ce bouton.`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Url = e.target?.result as string;
            // Extrait la partie Base64 pure pour l'envoi à l'IA
            const base64Content = base64Url.split(',')[1] || ""; 
            
            setUploadedFiles((prev) => {
                if (prev.length >= MAX_FILES) return prev;
                return [...prev, { fileName: file.name, base64Content }];
            });
        };
        reader.readAsDataURL(file); // Utiliser DataURL pour obtenir le Base64
    };

    Array.from(files).slice(0, MAX_FILES - (uploadedImages.length + uploadedFiles.length)).forEach(readAndProcessFile);
    event.target.value = '';
    setIsPlusDropdownOpen(false);
};
      

  



  const handleMentionFile = (filePath: string) => {
    setMentionedFiles((prev) => {
        // Basculement : si déjà présent, on le retire, sinon on l'ajoute
        if (prev.includes(filePath)) {
            return prev.filter(p => p !== filePath);
        }
        return [...prev, filePath];
    });
};

const handleRemoveMention = (filePath: string) => {
    setMentionedFiles((prev) => prev.filter(p => p !== filePath));
};
                

  

  
      
        // --- MISE À JOUR DES MESSAGES DANS LE STATE ---



// --- NOUVELLE FONCTION D'INDEXATION RAG (À placer avec vos autres fonctions) ---

/**
 * Fonction pour mettre à jour les embeddings du projet (logique RAG)
 * Utilisée pour l'indexation du code du projet dans la base de données vectorielle.
 */
// --- Empêche les répétitions et les boucles RAG infinies ---
const ragRunningRef = useRef(false);

const handleUpdateEmbeddings = useCallback(async () => {
  if (!currentProject || !currentProject.id) return;
  if (ragRunningRef.current) return;
  
  ragRunningRef.current = true;
  try {
    const files = currentProject.files || [];
    const indexChunks: IndexedChunk[] = [];

if (!files || files.length === 0 || files.every(f => !f.content?.trim())) {
  addLog(`[RAG] ⚠️ Aucun contenu détecté à indexer — arrêt de la boucle.`);
  return;
    }
            
  
    addLog(`[RAG] 🧠 Démarrage de la mise à jour des embeddings pour ${files.length} fichiers...`);

    for (const file of files) {
      const chunks = indexFileContent(file);
      if (Array.isArray(chunks)) indexChunks.push(...chunks);
    }

    if (indexChunks.length === 0) {
      addLog(`[RAG] Aucun contenu à indexer.`);
      return;
    }

    const success = await updateProjectEmbeddings(currentProject.id, indexChunks);
    if (success) addLog(`[RAG] ✅ Indexation réussie.`);
  } catch (err: any) {
    addLog(`[RAG] ❌ Erreur: ${err.message}`);
  } finally {
    ragRunningRef.current = false;
  }
}, [currentProject, addLog]);
  


// --- NOUVELLE FONCTION POUR SOUMETTRE LE CHAT (Formulaire) ---
const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Votre sendChat existant prend l'input du chat en interne
    sendChat(); 
}





  // SandboxPage.tsx

/**
 * Lit le contenu d'un fichier du projet et relance sendChat avec le contenu injecté.
 * Cette fonction est appelée UNIQUEMENT après la détection de l'artefact <read_file> dans le stream.
 * * @param filePath Le chemin du fichier demandé par l'IA.
 * @param currentProjectFiles La liste des fichiers disponibles pour la lecture.
 * @param messages L'historique des messages pour déterminer la dernière requête utilisateur.
 */

  

  /**
 * Lit le contenu d'un fichier du projet et l'envoie à Gemini via sendFileToGemini.
 * Déclenchée quand l'IA émet <read_file path="..."/>.
 */

      
  
 
            // --- FONCTION sendChat INTÉGRALE ET FINALE (RAG, Historique, Artefacts) ---

                
// SandboxPage.tsx


  /**
 * Nouvelle version : lecture de fichier via <fetch_file path="..."/> 
 * sans utiliser l’ancien artefact <read_file>.
 */

/**
 * 🧩 Version améliorée : lecture et analyse de fichier envoyée à Gemini
 */

      
    

/**
 * Envoie directement le contenu d’un fichier à Gemini sans passer par sendChat().
 * Utilisé quand l’IA demande <read_file path="..."/>.
 */
const sendFileToGemini = async (
  filePath: string,
  fileContent: string,
  lastUserMessage: string,
  addLog: (msg: string) => void,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  currentProjectFiles: ProjectFile[]
) => {
  try {
    addLog(`📤 [sendFileToGemini] Injection du fichier ${filePath} vers Gemini...`);

    // 🧩 Création du prompt d'injection
    const injectionPrompt = `
[CONTENU DU FICHIER REQUIS PAR VOUS : ${filePath}]

[FIN CONTENU FICHIER]

✅ Vous avez maintenant le contenu COMPLET du fichier ${filePath}.
Veuillez analyser ce fichier et continuer votre réponse à la dernière requête utilisateur :
"${lastUserMessage}"

Ne redemandez PAS ce fichier. Si vous avez besoin d'un autre, émettez simplement une autre balise <read_file path="..."/>.
`;

    addLog(`✅ [sendFileToGemini] ${filePath} injecté (${fileContent.length} caractères)`);

    // 🧠 Affiche dans le chat
    setMessages((prev) => [
      ...prev,
      { role: "system", content: `✅ Fichier ${filePath} injecté avec succès (${fileContent.length} caractères)` },
    ]);

    // 🔄 Envoi direct à ton API Gemini
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: [
          { role: "user", content: injectionPrompt }
        ],
        currentProjectFiles: currentProjectFiles,
      }),
    });

    if (!res.ok) throw new Error(`Gemini API request failed: ${res.statusText}`);
    const data = await res.text();

    addLog(`💬 [sendFileToGemini] Réponse reçue (${data.length} caractères)`);

    // 🪄 Affiche la réponse de Gemini dans le chat
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: data },
    ]);

  } catch (err: any) {
    addLog(`❌ [sendFileToGemini] Erreur: ${err.message}`);
    setMessages((prev) => [
      ...prev,
      { role: "system", content: `Erreur lors de l'envoi du fichier ${filePath}: ${err.message}` },
    ]);
  }
};
  

    

// SandboxPage.tsx

// Constante pour la regex (à s'assurer qu'elle est définie au début du composant)


              

    

                    
            // ---------------------- GLOBALS ----------------------
  // Constante pour la regex (à s'assurer qu'elle est définie au début du composant)
// Exemple: const FETCH_FILE_REGEX = /<fetch_file\s+path=["']([^"']+)["'][^>]*\/>/i;

// ---------------------- GLOBALS ----------------------
let isFetchInProgress = false; // Bloque les fetch en double

// **NOUVEAU:** Cache local pour cette session, pour éviter les relectures non nécessaires d'un fichier déjà injecté.
// Ceci n'est pas géré par le code ci-dessous, mais sera géré par la logique dans sendChat.

// ---------------------- HANDLE FETCH FILE ----------------------
/**
 * Lit un fichier et retourne son contenu formaté (sans relancer sendChat)
 */
const handleFetchFileAction = async (
  filePath: string,
  projectFiles: ProjectFile[],
  // NOTE: Le paramètre 'messages' n'est pas utilisé ici et peut être omis.
): Promise<string> => { 
  if (isFetchInProgress) {
    // Si déjà en cours, retourne immédiatement.
    addLog(`⚠️ [FETCH_FILE] Ignoré (déjà en cours pour ${filePath})`);
    return "";
  }

  isFetchInProgress = true;

  try {
    addLog(`📂 [FETCH_FILE] Demande de lecture du fichier : ${filePath}`);

    const targetFile = projectFiles.find(f => f.filePath === filePath);
    if (!targetFile) {
      addLog(`❌ [FETCH_FILE] Fichier introuvable : ${filePath}`);
      // Retourne une balise d'erreur pour que l'IA le voie.
      return `<file_content path="${filePath}" error="File not found."></file_content>`;
    }

    const content = targetFile.content || "";
    const lines = content.split("\n");
    const totalLines = lines.length;

    addLog(`✅ [FETCH_FILE] Fichier trouvé (${content.length} caractères, ${totalLines} lignes). Préparation pour envoi...`);

    // Formatte le contenu ligne par ligne
    const formattedFile = [
      `<file_content path="${filePath}" totalLines="${totalLines}">`,
      ...lines.map((line, i) => `${i + 1} | ${line}`),
      `</file_content>`
    ].join("\n");

    addLog(`📤 [FETCH_FILE] Contenu prêt pour injection (${totalLines} lignes)`);

    return formattedFile;
  } finally {
    isFetchInProgress = false;
  }
};


// ---------------------- SEND CHAT ----------------------


     // ---------------------- DÉFINITIONS GLOBALES (VÉRIFIEZ BASE_DELAY_MS) ----------------------
// Définir ces constantes au début du composant, en dehors de sendChat
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 500; 
const CONTENT_SNAPSHOT_LIMIT = 50000; 

const inspirationUrlRegex = /```json\s*\{[\s\S]*?"type"\s*:\s*"inspirationUrl"[\s\S]*?\}/;
const PLAN_REGEX = /<plan>([\s\S]*?)<\/plan>/;

// Définitions
// Assurez-vous que FETCH_FILE_REGEX est aussi définie ici si elle n'est pas globale
// const FETCH_FILE_REGEX = /<fetch_file path=["']([^"']+)["'][^>]*\/>/g; 


  // 2. Préparation du placeholder initial (pour le plan)

  

    


      // On crée une NOUVELLE bulle de message Assistant pour chaque fichier
      
                
// ---------------------- SEND CHAT (AVEC CONTEXTE ET FILTRAGE) ----------------------


  


  



    

// ── CopyBlockCard — artifact copiable généré par l'agent ─────────────────────
function CopyBlockCard({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="w-full mt-2 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(55,50,47,0.12)", background: "#fdfcfa" }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(55,50,47,0.07)", background: "rgba(55,50,47,0.03)" }}>
        {label ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(55,50,47,0.6)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        ) : (
          <span style={{ fontSize: 11, color: "rgba(55,50,47,0.4)" }}>Code / Rules</span>
        )}
        <button
          onClick={handleCopy}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: copied ? "#22c55e" : "rgba(55,50,47,0.45)", padding: 0 }}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          )}
          <span style={{ fontSize: 11, fontWeight: 500 }}>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
      <pre style={{ margin: 0, padding: "10px 12px", fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#37322F", whiteSpace: "pre-wrap", overflowX: "auto", lineHeight: 1.55, maxHeight: 320, overflowY: "auto" }}>
        {content}
      </pre>
    </div>
  );
}

// ── BuildErrorCard — erreur build/install avec dropdown ───────────────────────
function BuildErrorCard({ action, stderr }: { action: string; stderr: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="w-full mt-2 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(55,50,47,0.10)", background: "#f7f4ed" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
        style={{ background: "none", border: "none", cursor: "pointer" }}
      >
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ color: "rgba(55,50,47,0.5)", flexShrink: 0 }}>
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#37322F" }}>{action} error detected</span>
          <span style={{ fontSize: 11, color: "rgba(55,50,47,0.4)" }}>— sent to AI for fix</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.35, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", flexShrink: 0 }}>
          <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid rgba(55,50,47,0.07)" }}>
          <pre style={{ margin: 0, padding: "10px 12px", fontSize: 11, fontFamily: "ui-monospace, monospace", color: "rgba(55,50,47,0.7)", whiteSpace: "pre-wrap", lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}>
            {stderr}
          </pre>
        </div>
      )}
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  DESIGN:            "Génération du design de référence",
  PRODUCT_THINKING:  "Analyse du produit",
  FEATURE_INVENTORY: "Inventaire des fonctionnalités",
  CODE_FOUNDATION:   "Architecture & fondation",
  CODE_UI:           "Hooks, API routes & composants",
  CODE_VIEWS:        "Vues & interface utilisateur",
  WIRE_VERIFICATION: "Vérification",
  SELF_AUDIT:        "Audit TypeScript",
  POLISH:            "Vérification & finitions",
  TSC_CHECK:         "Compilation TypeScript",
  FIX:               "Modification & correction",
  PATCH:             "Modification ciblée",
  SUMMARY:           "Résumé du projet",
};

const PHASE_ICONS: Record<string, string> = {
  CODE_FOUNDATION: "🏗️",
  CODE_UI:         "⚡",
  CODE_VIEWS:      "🎨",
  POLISH:          "✨",
  TSC_CHECK:       "🔍",
  FIX:             "✏️",
  SUMMARY:         "📋",
};

function extractThoughtsFromText(text: string, agentName: string): string {
  const rx = new RegExp(`\\[THOUGHT:${agentName}\\]([\\s\\S]*?)\\[\/THOUGHT:${agentName}\\]`, "g");
  let thoughts = "";
  let m;
  while ((m = rx.exec(text)) !== null) thoughts += m[1];
  return thoughts.trim();
}

function extractEnvVarsFromText(text: string): string[] {
  const m = text.match(/\[ENV_VARS\](.*?)\[\/ENV_VARS\]/s);
  if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}

function extractPhases(text: string): {
  presenterIntro: string;
  phases: { id: number; name: string; label: string; content: string; thoughts: string }[];
  presenterOutro: string;
  activePhaseId: number;
  envVars: string[];
} {
  const introMatch = text.match(/\[PRESENTER:INTRO\]([\s\S]*?)(?:\[\/PRESENTER:INTRO\]|\[PHASE:)/);
  const presenterIntro = introMatch
    ? introMatch[1].replace(/\[PAGE_DONE\]/g, "").replace(/\[RETRY[^\]]*\]/g, "").trim()
    : "";

  const outroMatch = text.match(/\[PRESENTER:OUTRO\]([\s\S]*?)(?:\[\/PRESENTER:OUTRO\]|\[PAGE_DONE\]|$)/);
  const rawOutro = outroMatch
    ? outroMatch[1].replace(/\[PAGE_DONE\]/g, "").replace(/\[RETRY[^\]]*\]/g, "").replace(/\[ENV_VARS\][\s\S]*?\[\/ENV_VARS\]/g, "").trim()
    : "";
  const presenterOutro = rawOutro;

  const envVars = extractEnvVarsFromText(text);

  const markers = [...text.matchAll(/\[PHASE:(\d+)\/([A-Z_]+)\]/g)];
  const agentNames: Record<string, string> = {
    CODE_FOUNDATION: "FOUNDATION",
    CODE_UI: "FEATURES",
    CODE_VIEWS: "VIEWS",
    POLISH: "POLISH",
    FIX: "FIXER",
    TSC_CHECK: "TSC_FIXER",
  };

  const phases = markers.map((m, i) => {
    const phaseName = m[2];
    const start = (m.index ?? 0) + m[0].length;
    const nextMarker = markers[i + 1]?.index;
    const outroStart = text.indexOf("[PRESENTER:OUTRO]");
    const end = Math.min(
      nextMarker ?? Infinity,
      outroStart >= 0 ? outroStart : Infinity,
      text.length
    );
    const rawContent = text.slice(start, end);
    const thoughts = extractThoughtsFromText(rawContent, agentNames[phaseName] ?? phaseName);

    // Extract [WORKING_ON] tag for dynamic phase title
    const workingOnMatch = rawContent.match(/\[WORKING_ON\]([\s\S]*?)\[\/WORKING_ON\]/);
    const workingOn = workingOnMatch ? workingOnMatch[1].trim() : undefined;

    // Extract files created in this phase
    const phaseFiles: { path: string }[] = [];
    const createRegex = /<create_file\s+path=["']([^"']+)["']/g;
    let cfm;
    while ((cfm = createRegex.exec(rawContent)) !== null) {
      phaseFiles.push({ path: cfm[1] });
    }

    const content = rawContent
      .replace(/---\s*\n?\s*<create_file[\s\S]*?<\/create_file>/gs, "") // --- separator blocks (completed)
      .replace(/---\s*\n?\s*<create_file[^>]*>[\s\S]*/s, "") // open --- block (still streaming)
      .replace(/<create_file[\s\S]*?<\/create_file>/gs, "")
      .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, "")
      .replace(/<edit_file[\s\S]*?<\/edit_file>/gs, "")
      .replace(/<str_replace[\s\S]*?<\/str_replace>/gs, "")
      .replace(/\[THOUGHT:[A-Z_]+\][\s\S]*?\[\/THOUGHT:[A-Z_]+\]/g, "")
      .replace(/\[WORKING_ON\][\s\S]*?\[\/WORKING_ON\]/g, "")
      .replace(/\[PAGE_DONE\]/g, "")
      .replace(/\[RETRY[^\]]*\]/g, "")
      .replace(/\[STR_REPLACE\][^\n]*/g, "")
      .replace(/\[EDIT_FILE\][^\n]*/g, "")
      .replace(/\[DESIGN:INTENT\][^\n]*/g, "")
      .replace(/\[DESIGN:READY\][^\n]*/g, "")
      .replace(/\[DESIGN:SKIP\][^\n]*/g, "")
      .replace(/\[TOKEN_USAGE\][\s\S]*?\[\/TOKEN_USAGE\]/g, "")
      .trim();
    return { id: parseInt(m[1]), name: phaseName, label: PHASE_LABELS[phaseName] ?? phaseName, content, thoughts, workingOn, files: phaseFiles };
  });

  return {
    presenterIntro,
    phases,
    presenterOutro,
    activePhaseId: markers.length > 0 ? parseInt(markers[markers.length - 1][1]) : 0,
    envVars,
  };
}

/**
 * Fetche les images vibes depuis Firestore en appliquant la rotation IDB.
 * Les images utilisées dans les 4 derniers tours sont exclues.
 * Après sélection, marque les images choisies comme utilisées dans IDB.
 */
const fetchVibesWithRotation = async (
  rvMatches: RegExpMatchArray[],
  fbApp: any
): Promise<string[]> => {
  const blobToB64 = (blob: Blob): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob);
  });

  const _firestoreDB = getFirestore(fbApp);
  const snap = await getDocs(collection(_firestoreDB, "vibes_selection"));

  // Grouper par catégorie
  const byCategory: Record<string, string[]> = {};
  snap.forEach(d => {
    const data = d.data();
    if (data.selected && data.path) {
      const cat = data.category ?? "UI";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(data.path);
    }
  });

  // Obtenir le tour courant et les images récemment utilisées
  const currentTurn = await incrementVibesTurn();
  const recentlyUsed = await getRecentlyUsedVibePaths(currentTurn, 4);

  const pickedPaths: string[] = [];
  const vibeImagesArr: string[] = [];

  for (const m of rvMatches) {
    const cat = m[1];
    const count = parseInt(m[2], 10);
    const allAvailable = byCategory[cat] ?? byCategory[Object.keys(byCategory)[0]] ?? [];

    // Exclure les images récemment utilisées ; si plus rien de dispo, reprendre tout
    const fresh = allAvailable.filter(p => !recentlyUsed.has(p));
    const pool = fresh.length >= count ? fresh : allAvailable;

    // Si on prend autant ou plus que tout le pool disponible → rotation inutile,
    // on ne marque pas ces images (évite de bloquer toute la catégorie)
    const willTakeAll = count >= allAvailable.length;

    const shuffled = [...pool].sort(() => 0.5 - Math.random()).slice(0, count);
    for (const imgPath of shuffled) {
      try {
        const r2 = await fetch(imgPath);
        if (r2.ok) {
          const b64 = await blobToB64(await r2.blob());
          if (b64) {
            vibeImagesArr.push(b64);
            if (!willTakeAll) pickedPaths.push(imgPath); // n'indexer que si rotation utile
          }
        }
      } catch {}
    }
  }

  // Marquer les images choisies comme utilisées dans IDB (seulement si la rotation a du sens)
  if (pickedPaths.length > 0) await markVibesAsUsed(pickedPaths, currentTurn);

  return vibeImagesArr;
};

const sendChat = async (
  promptOverride?: string,
  projectContext?: any,
  vibeImages?: string[],      // images fetched after <request_vibes>
  forceDesignRef?: boolean,   // force le Design Agent même sans image uploadée par l'user
) => {
  const userPrompt = promptOverride || chatInput;
  const activeProject = projectContext || currentProject;

  if (!userPrompt && uploadedImages.length === 0 && uploadedFiles.length === 0 && mentionedFiles.length === 0) return;
  if (!activeProject) {
    addLog("Please create or load a project before starting a conversation.");
    return;
  }

  // ── Timer "Thought for Xs" — démarre dès le clic Envoyer ──────────────────
  // globalStreamStartRef persiste à travers les relances vibes pour un timer continu
  if (globalStreamStartRef.current === null) {
    globalStreamStartRef.current = Date.now();
  }
  const streamStartMs = globalStreamStartRef.current;

  const assistantMsgId = crypto.randomUUID();

  let contextForPrompt = "";
  if (mentionedFiles.length > 0 && activeProject) {
    contextForPrompt = "\n[MENTIONED PROJECT FILES: " + mentionedFiles.join(', ') + "]";
  }
  const finalUserPrompt = userPrompt + contextForPrompt;

  const userMsgId = crypto.randomUUID();
  const userMsg: Message = {
    id: userMsgId,
    role: "user",
    content: finalUserPrompt,
    artifactData: { type: null, rawJson: "", parsedList: [] },
    images: uploadedImages,
    externalFiles: uploadedFiles,
    mentionedFiles,
    timestamp: Date.now(),
  };

  const assistantPlaceholder: Message = {
    id: assistantMsgId,
    role: "assistant",
    content: "",
    phases: [],
    presenterIntro: "",
    presenterOutro: "",
    activePhaseId: 0,
    artifactData: { type: null, rawJson: "", parsedList: [] }
  };

  const baseHistory = projectContext ? [] : messages;
  let currentHistory = [...baseHistory, userMsg];

  setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
  // Always clear input fields after sending (even when called with promptOverride)
  setChatInput("");
  setUploadedImages([]);
  setUploadedFiles([]);
  setMentionedFiles([]);
  // Reset per-session refs
  sessionTokensProcessedRef.current = false;
  srLoggedRef.current = new Set();
  setSessionCandidateTokens(0); // reset per-session output token counter
  userSelectedFileRef.current = null;

  const currentProjectFiles = activeProject.files.map((f: any) => ({
    filePath: f.filePath,
    content: f.content
  }));

  const filesList: string[] = [];
  const filesContentSnapshots: string[] = [];
  let filesExcludedCount = 0;

  currentProjectFiles.forEach(file => {
    const content = file.content || "";
    const size = content.length;
    if (size > 0 && size <= CONTENT_SNAPSHOT_LIMIT) {
      const lines = content.split('\n');
      const contentWithLineNumbers = lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
      filesContentSnapshots.push(`<file_content_snapshot path="${file.filePath}" totalLines="${lines.length}">\n${contentWithLineNumbers}\n</file_content_snapshot>`);
      filesList.push(`<project_file path="${file.filePath}" (Content snapshot INCLUDED: ${size} chars)/>`);
    } else if (size > CONTENT_SNAPSHOT_LIMIT) {
      filesExcludedCount++;
      filesList.push(`<project_file path="${file.filePath}" (Content EXCLUDED: ${size} chars > ${CONTENT_SNAPSHOT_LIMIT} limit)/>`);
    } else {
      filesList.push(`<project_file path="${file.filePath}" (EMPTY file)/>`);
    }
  });

  const systemFileContext: Message = {
    role: "system",
    content: `# PROJECT FILES (${currentProjectFiles.length} files total)\n` +
             `[Use the <fetch_file path="..."/> artifact to read content for files excluded.]\n` +
             (filesExcludedCount > 0 ? `⚠️ ${filesExcludedCount} files were EXCLUDED.\n` : '') +
             filesList.join("\n") +
             (filesContentSnapshots.length > 0 ? `\n\n# INJECTED FILE CONTENT SNAPSHOTS\n` + filesContentSnapshots.join("\n\n") : "")
  };

  let historyForApi = [systemFileContext, ...currentHistory];
  const readFilesCache = new Set<string>();

  setLoading(true);
  isAiStreamingRef.current = true;
  setIsAiStreaming(true);
  // No need for /api/chat call — the Design Agent (Phase 0) does it server-side
  let clonedHtmlCss: string | null = null; // kept for backward compat but unused

  // ── ÉTAPE 2 : Ressources design ────────────────────────────────────────────
  let shopImages: string[] = [];
  let inspirationCSS = "";

  try {
    addLog("🎨 Gathering design resources...");
    const images = await getAllShopImages();
    const cssUrl = await getShopCssUrl();
    shopImages = images;
    if (cssUrl) inspirationCSS = await fetchInspirationCSS(cssUrl);
    if (shopImages.length > 0) addLog(`✅ Loaded ${shopImages.length} visual refs.`);
    if (inspirationCSS) addLog(`✅ Loaded CSS System.`);
  } catch (e: any) {
    console.error("Design load error", e);
  }

  // ── Catégories vibes — uniquement les noms, envoyés comme contexte à l'agent ─
  // Les images réelles ne sont fetched QUE si l'agent émet <request_vibes>
  // → zéro latence ici, zéro payload inutile
  let vibeCategoryNames: string[] = [];
  try {
    const _firestoreDB = getFirestore(_fbApp);
    const catSnap = await getDoc(doc(_firestoreDB, "config", "vibes_categories"));
    if (catSnap.exists()) vibeCategoryNames = catSnap.data().categories ?? [];
  } catch { /* Firestore indispo — pas bloquant */ }

  // ── Extraction couleurs pour les images uploadées par l'user ────────────────
  let uploadedColorMaps: string[] = [];
  try {
    if (uploadedImages && uploadedImages.length > 0) {
      uploadedColorMaps = await Promise.all(
        uploadedImages.slice(0, 3).map((img: string) => extractColorsFromBase64(img))
      );
      uploadedColorMaps = uploadedColorMaps.filter(Boolean);
    }
  } catch (colorErr) { console.warn("Color extraction error:", colorErr); }

  let apiKey = "";
  try {
    // Use ref (not state) to always get the current model — avoids stale closure issues
    const currentModel = selectedModelRef.current;
    const dbKey = await getApiKeyFromIDB(currentModel.provider);
    if (dbKey) apiKey = dbKey;
    if (!apiKey) { setPendingApiKeyProvider(currentModel.provider); return; }
  } catch (e) { console.warn("Erreur API Key:", e); }


  // ── ÉTAPE 4 : Appel /api/gemini avec stream ────────────────────────────────
  let urlArtifact: any = null;
  let text = "";
  let retryCount = 0;
  let finalAssistantMessage: Message | undefined = undefined;

  try {
    let res: Response | null = null;
    let apiCallSuccessful = false;

    while (!apiCallSuccessful && retryCount < MAX_RETRIES) {
      try {
        if (retryCount > 0) {
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const currentModel = selectedModelRef.current;
        res = await fetch("/api/gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key":    currentModel.provider === 'gemini'    ? apiKey : "",
            "x-anthropic-api-key": currentModel.provider === 'anthropic' ? apiKey : "",
            "x-model-id": currentModel.id,
          },
          body: JSON.stringify({
            history: historyForApi,
            currentProjectFiles,
            uploadedImages: vibeImages ? [...(uploadedImages || []), ...vibeImages] : uploadedImages,
            uploadedFiles,
            currentPlan,
            vibeCategoryNames,
            uploadedColorMaps,
            forceDesignRef: !!forceDesignRef,
            modelId: currentModel.id,
            ...(clonedHtmlCss ? { clonedHtmlCss } : {}),
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => res.statusText);
          const isQuotaErr = res.status === 429 || errBody.includes('429') ||
            errBody.includes('RESOURCE_EXHAUSTED') || errBody.includes('quota') ||
            errBody.includes('Too Many Requests') || errBody.includes('overloaded') ||
            res.status === 529;
          if (isQuotaErr) {
            // Ne repousse le timer QUE si pas déjà actif
            setQuotaResetAt(prev => {
              if (prev && prev > Date.now()) return prev;
              const t = Date.now() + 24 * 60 * 60 * 1000;
              try { localStorage.setItem('quota_reset_at', String(t)); } catch {}
              return t;
            });
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? { ...msg, content: '', quotaExceeded: { message: "API quota reached", resetHint: "Try again in 24h or reload your API key." } }
                : msg
            ));
            return;
          }
          throw new Error(`API failed: ${res.statusText}`);
        }
        if (!res.body) throw new Error('No response body');
        apiCallSuccessful = true;
      } catch (e: any) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) throw e;
      }
    }

    if (!res || !res.body) return;
    let reader = res.body.getReader();
    streamReaderRef.current = reader; // store for abort
    const decoder = new TextDecoder();
    const MAX_503_RETRIES = 6;

    streamLoop: while (true) {
    // Boucle interne de lecture des chunks du stream courant
    while (true) {
      // Check if user stopped the stream
      if (streamReaderRef.current === null) { try { reader.cancel(); } catch {} break streamLoop; }
      const { done, value } = await reader.read();
      if (done) break streamLoop;

      const chunk = decoder.decode(value, { stream: true });
      text += chunk;

      // ── Détection quota 429 dans le stream (route émet [ERROR] {...429...}) ──
      const errorInStream = text.match(/\[ERROR\]\s*(\{[\s\S]*?\}|\S.*)/);
      if (errorInStream) {
        const errStr = errorInStream[1] ?? '';
        const isQuotaStream = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('quota') || errStr.includes('Too Many Requests') ||
          errStr.includes('overloaded') || errStr.includes('529');
        if (isQuotaStream) {
          setQuotaResetAt(prev => {
            if (prev && prev > Date.now()) return prev;
            const t = Date.now() + 24 * 60 * 60 * 1000;
            try { localStorage.setItem('quota_reset_at', String(t)); } catch {}
            return t;
          });
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: '', quotaExceeded: { message: "API quota reached", resetHint: "Try again in 24h or reload your API key." } }
              : msg
          ));
          try { reader.cancel(); } catch {}
          return;
        }

        // ── Détection 503 UNAVAILABLE dans le stream — retry automatique ──────
        const is503Stream = errStr.includes('503') || errStr.includes('UNAVAILABLE') ||
          errStr.includes('high demand') || errStr.includes('Service Unavailable');
        if (is503Stream) {
          if (retryCount < MAX_503_RETRIES) {
            retryCount++;
            const delay503 = 12000 + Math.random() * 6000; // 12–18s
            const delaySecs = Math.round(delay503 / 1000);
            addLog(`⏳ Modèle surchargé (503) — retry ${retryCount}/${MAX_503_RETRIES} dans ${delaySecs}s…`);
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? { ...msg, content: '', streamRetrying: { attempt: retryCount, max: MAX_503_RETRIES, delaySecs } }
                : msg
            ));
            try { reader.cancel(); } catch {}
            text = ""; // reset accumulator pour le nouveau stream
            await new Promise(resolve => setTimeout(resolve, delay503));
            // Refetch et recommencer la lecture depuis le début (continue streamLoop)
            try {
              const retryRes = await fetch("/api/gemini", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-gemini-api-key":    selectedModelRef.current.provider === 'gemini'    ? apiKey : "",
                  "x-anthropic-api-key": selectedModelRef.current.provider === 'anthropic' ? apiKey : "",
                  "x-model-id": selectedModelRef.current.id,
                },
                body: JSON.stringify({
                  history: historyForApi,
                  currentProjectFiles,
                  uploadedImages: vibeImages ? [...(uploadedImages || []), ...vibeImages] : uploadedImages,
                  uploadedFiles,
                  currentPlan,
                  vibeCategoryNames,
                  uploadedColorMaps,
                  forceDesignRef: !!forceDesignRef,
                  modelId: selectedModelRef.current.id,
                  ...(clonedHtmlCss ? { clonedHtmlCss } : {}),
                }),
              });
              if (retryRes.ok && retryRes.body) {
                // On efface streamRetrying dès que le retry démarre
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMsgId ? { ...msg, content: '', streamRetrying: null } : msg
                ));
                reader = retryRes.body.getReader();
                streamReaderRef.current = reader;
                continue streamLoop; // reprend la boucle externe avec le nouveau reader
              }
            } catch (_retryErr) { /* ignore, tombera en erreur au prochain tour */ }
          } else {
            addLog(`❌ Modèle indisponible après ${MAX_503_RETRIES} retries (503).`);
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMsgId
                ? { ...msg, content: '', streamRetrying: null,
                    quotaExceeded: { message: "Modèle temporairement indisponible.", resetHint: "Réessaie dans quelques minutes." } }
                : msg
            ));
            try { reader.cancel(); } catch {}
            return;
          }
        }
      }

      const fetchFileMatch = text.match(FETCH_FILE_REGEX);
      if (fetchFileMatch && !isFetchInProgress) {
        const filePath = fetchFileMatch[1].trim();
        if (!readFilesCache.has(filePath)) {
          const fileContent = await handleFetchFileAction(filePath, currentProjectFiles);
          if (fileContent) {
            text += `\n${fileContent}\n`;
            readFilesCache.add(filePath);
          }
        }
      }

      // ── <request_vibes> détecté en LIVE — interrompre le stream immédiatement ──
      // L'agent a déclaré vouloir des vibes → on coupe avant qu'il génère du code,
      // on fetche les images, puis on relance sendChat proprement (une seule génération)
      // GUARD: ne pas déclencher si c'est déjà un appel relancé avec vibeImages/forceDesignRef
      const earlyRvMatch = !forceDesignRef && !vibeImages && text.match(/<request_vibes\s+category="([^"]+)"\s+count="?(\d+)"?\s*\/>/);
      if (earlyRvMatch) {
        try { reader.cancel(); } catch {}
        streamReaderRef.current = null;
        // Le contenu est déjà blanqué dans le setMessages per-chunk (pendingVibesRequest)
        // On s'assure juste que requestingVibes est bien à true
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsgId ? { ...msg, content: "", requestingVibes: true } : msg
        ));
        addLog(`🎨 Agent demande des vibes — stream interrompu, fetch en cours…`);

        const allRvMatches = [...text.matchAll(/<request_vibes\s+category="([^"]+)"\s+count="?(\d+)"?\s*\/>/g)];
        let vibeImagesArr: string[] = [];
        try {
          vibeImagesArr = await fetchVibesWithRotation(allRvMatches, _fbApp);
        } catch (e) { console.warn("Vibe fetch error:", e); }

        // Supprimer les deux messages (user + assistant) — recréés par le relancement
        setMessages(prev => prev.filter(m => m.id !== assistantMsgId && m.id !== userMsgId));

        // Relancer sendChat avec les vibes — une seule génération finale
        setLoading(false);
        isAiStreamingRef.current = false;
        setIsAiStreaming(false);
        isStreamingRef.current = false;
        await sendChat(userPrompt, activeProject, vibeImagesArr.length > 0 ? vibeImagesArr : undefined, true);
        return;
      }

      const urlMatch = text.match(inspirationUrlRegex);
      if (urlMatch) {
        try {
          const jsonString = urlMatch[0].replace(/```json|```/g, '').trim();
          const parsedUrlData = JSON.parse(jsonString);
          if (parsedUrlData.type === 'inspirationUrl') urlArtifact = { url: parsedUrlData.url };
        } catch (e) {}
      }

      const planMatch = text.match(PLAN_REGEX);
      if (planMatch) {
        const extractedPlan = planMatch[1].trim();
        if (extractedPlan && extractedPlan !== currentPlan) setCurrentPlan(extractedPlan);
      }

      const fileArtifacts = extractFileArtifacts(text);
      let newArtifactData = undefined;
      const artifactList: any[] = [];

      if (fileArtifacts.length > 0) {
        fileArtifacts.forEach(a => artifactList.push({ path: a.filePath, type: a.type }));
        if (activeProject) {
          addFilesIfNew(artifactList, activeProject.files, activeFile, setActiveFile, setCurrentProject);
        }
        newArtifactData = { type: 'files', parsedList: artifactList, rawJson: text };
      }

      // ── Parsing des phases + presenter ────────────────────────────────────
      const { presenterIntro, phases, presenterOutro, activePhaseId, envVars } = extractPhases(text);

      // ── Parse STR_REPLACE / EDIT_FILE logs — log each operation once ─────────
      const strReplaceMatches = [...text.matchAll(/\[STR_REPLACE\] ([^\n]+)/g)];
      strReplaceMatches.forEach(m => {
        const msg = m[1].trim();
        if (!msg) return;
        if (!srLoggedRef.current.has(msg)) {
          srLoggedRef.current.add(msg);
          addLog(msg.startsWith('⚠️') ? msg : `✏️ ${msg}`);
        }
      });
      const editFileMatches = [...text.matchAll(/\[EDIT_FILE\] ([^\n]+)/g)];
      editFileMatches.forEach(m => {
        const msg = m[1].trim();
        if (!msg) return;
        if (!srLoggedRef.current.has("EF:" + msg)) {
          srLoggedRef.current.add("EF:" + msg);
          addLog(msg.startsWith('⚠️') ? msg : `✏️ ${msg}`);
        }
      });

      // ── Parsing token usage — traité UNE SEULE FOIS par session ────────────
      const tokenUsageMatch = text.match(/\[TOKEN_USAGE\](\{[^}]*\})\[\/TOKEN_USAGE\]/);
      if (tokenUsageMatch && !sessionTokensProcessedRef.current) {
        try {
          const usage = JSON.parse(tokenUsageMatch[1]);
          const sessionTotal = (usage.total ?? 0);
          const sessionCandidates = (usage.candidates ?? 0);
          if (sessionTotal > 0) {
            sessionTokensProcessedRef.current = true;
            // Save total for daily accumulation
            setDailyTokensUsed(prev => {
              const newTotal = prev + sessionTotal;
              saveTokenUsageToIDB(newTotal);
              return newTotal;
            });
            // Save output tokens for display (realistic numbers like AI Studio shows)
            if (sessionCandidates > 0) {
              setSessionCandidateTokens(prev => prev + sessionCandidates);
              addLog("📊 " + sessionCandidates.toLocaleString("fr-FR") + " tokens générés cette session");
            }
          }
        } catch {}
      }

      // ── Parse quota exceeded ────────────────────────────────────────────────
      const quotaMatch = text.match(/\[QUOTA_EXCEEDED\]({.*?})\[\/QUOTA_EXCEEDED\]/s);
      if (quotaMatch) {
        try {
          const quotaInfo = JSON.parse(quotaMatch[1]);
          // Will be rendered as a special message
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId ? { ...msg, quotaExceeded: quotaInfo } : msg
          ));
        } catch {}
      }

      // ── Détection du fichier en cours d'écriture via --- separator (prioritaire) ──
      // On cherche d'abord un bloc --- ouvert, sinon un <create_file> nu non fermé
      const SEP_OPEN_RE = /---\s*\n\s*<create_file\s+path="([^"]+)">([^]*)$/s;
      const sepOpenMatch = text.match(SEP_OPEN_RE);
      const isOpenSepBlock = sepOpenMatch && !text.match(/---\s*\n\s*<create_file\s+path="[^"]+">[^]*<\/create_file>\s*$/s);

      // Also look for bare <create_file> (without ---) for backward compat
      const bareOpenMatch = text.match(/<create_file path="([^"]+)">[^]*$/s);
      const isOpenBareBlock = bareOpenMatch && !text.endsWith("</create_file>");

      // Current file being written (--- block takes priority)
      const streamingPath = isOpenSepBlock
        ? sepOpenMatch![1]
        : (isOpenBareBlock ? bareOpenMatch![1] : undefined);

      // Partial content for Monaco
      const streamingPartial = isOpenSepBlock
        ? sepOpenMatch![2].trimStart()
        : (isOpenBareBlock
            ? (() => {
                const openTag = `<create_file path="${bareOpenMatch![1]}">`;
                const tagIdx = text.lastIndexOf(openTag);
                const raw = tagIdx >= 0 ? text.slice(tagIdx + openTag.length) : "";
                const closeIdx = raw.indexOf("</create_file>");
                return closeIdx >= 0 ? raw.slice(0, closeIdx).trim() : raw.trimStart();
              })()
            : undefined);

      // Last closed file path (for when file just finished streaming)
      const lastClosedCreateFile = [...text.matchAll(/---\s*\n\s*<create_file\s+path="([^"]+)">[\s\S]*?<\/create_file>/g)];
      const lastBareClosedFile = [...text.matchAll(/<create_file\s+path="([^"]+)">[\s\S]*?<\/create_file>/g)];
      const lastClosedPath = lastClosedCreateFile.length > 0
        ? lastClosedCreateFile[lastClosedCreateFile.length - 1][1]
        : (lastBareClosedFile.length > 0 ? lastBareClosedFile[lastBareClosedFile.length - 1][1] : undefined);

      const currentStreamingFilePath = streamingPath ?? lastClosedPath;

      // ── Extraction du fichier en cours d'écriture — mis à jour atomiquement ──
      // Priorité : bloc --- + create_file ouvert → bare create_file ouvert → edit_file ouvert
      isStreamingRef.current = true;

      // Calcul des valeurs live (path + content) — partagé entre liveFile state ET persistence
      let _livePath: string | null = null;
      let _liveContent: string | null = null;

      (() => {
        // 1. Chercher le DERNIER bloc --- + create_file qui est encore ouvert
        // On itère à rebours sur tous les blocs --- pour trouver le dernier non fermé
        const allSepMatches = [...text.matchAll(/---\s*\n\s*<create_file\s+path="([^"]+)">/g)];
        for (let i = allSepMatches.length - 1; i >= 0; i--) {
          const m = allSepMatches[i];
          const afterIdx = (m.index ?? 0) + m[0].length;
          const rest = text.slice(afterIdx);
          if (!rest.includes("</create_file>")) {
            _livePath = m[1];
            _liveContent = rest.trimStart();
            setLiveFile({ path: m[1], content: rest.trimStart() });
            return;
          }
        }

        // 2. Bare create_file ouvert (sans ---) — chercher le DERNIER non fermé
        const allCreateTags = [...text.matchAll(/<create_file\s+path="([^"]+)">/g)];
        for (let i = allCreateTags.length - 1; i >= 0; i--) {
          const m = allCreateTags[i];
          const afterIdx = (m.index ?? 0) + m[0].length;
          const rest = text.slice(afterIdx);
          if (!rest.includes("</create_file>")) {
            _livePath = m[1];
            _liveContent = rest.trimStart();
            setLiveFile({ path: m[1], content: rest.trimStart() });
            return;
          }
        }

        // 3. edit_file ouvert — montrer le fichier existant avec indication "en édition"
        const allEditTags = [...text.matchAll(/<edit_file\s+path="([^"]+)"[^>]*>/g)];
        for (let i = allEditTags.length - 1; i >= 0; i--) {
          const m = allEditTags[i];
          const afterIdx = (m.index ?? 0) + m[0].length;
          const rest = text.slice(afterIdx);
          if (!rest.includes("</edit_file>")) {
            _livePath = m[1];
            const existingContent = activeProject?.files.find(
              (f: any) => f.filePath === m[1]
            )?.content ?? "";
            _liveContent = existingContent;
            setLiveFile({ path: m[1], content: existingContent });
            return;
          }
        }

        // 4. Entre deux fichiers — garder le dernier liveFile affiché (pas de reset)
      })();

      // ── Persister le contenu partiel dans currentProject (uniquement pour create_file) ──
      if (_livePath && _liveContent !== null && _liveContent.length > 0) {
        // Ne persister que pour les create_file (pas les edit_file qui utilisent le contenu existant)
        const isEditFile = text.match(new RegExp(`<edit_file\\s+path="${_livePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        if (!isEditFile) {
          setCurrentProject(prev => {
            if (!prev) return prev;
            const exists = prev.files.find(f => f.filePath === _livePath);
            if (exists) {
              const updatedFiles = prev.files.map(f =>
                f.filePath === _livePath ? { ...f, content: _liveContent! } : f
              );
              return { ...prev, files: updatedFiles };
            }
            return { ...prev, files: [...prev.files, { filePath: _livePath!, content: _liveContent! }] };
          });
        }
      }

      // ── Masquage du XML <create_file> — le séparateur "---" marque la frontière ──
      // Tout ce qui suit "---\n<create_file" est masqué de la zone de messages
      // et remplacé par des badges de fichiers en cours d'écriture
      const FILE_SEP_REGEX = /---\s*\n?\s*<create_file[\s\S]*?(?:<\/create_file>|$)/gs;
      const OPEN_FILE_SEP_REGEX = /---\s*\n?\s*<create_file\s+path="([^"]+)">[^]*$/s;

      // Extract file badges from --- blocks (completed)
      const fileBadgesCompleted: string[] = [];
      const completedSepMatches = [...text.matchAll(/---\s*\n?\s*<create_file\s+path="([^"]+)">[\s\S]*?<\/create_file>/g)];
      completedSepMatches.forEach(m => fileBadgesCompleted.push(m[1]));

      // Check for currently-being-written file (last --- block without closing tag)
      const openSepMatch = text.match(OPEN_FILE_SEP_REGEX);
      const currentlyWritingFile = (openSepMatch && !text.endsWith('</create_file>'))
        ? openSepMatch[1] : null;

      // ── Parse [WORKING_ON] — dernier label émis par l'agent ──────────────
      const workingOnMatches = [...text.matchAll(/\[WORKING_ON\]([\s\S]*?)\[\/WORKING_ON\]/g)];
      const agentWorkingOn = workingOnMatches.length > 0
        ? workingOnMatches[workingOnMatches.length - 1][1].trim()
        : undefined;

      let textWithoutArtifacts = text
        .replace(inspirationUrlRegex, '')
        .replace(FILE_SEP_REGEX, '')                                   // --- + create_file (fermé ou fin de texte)
        .replace(/<create_file[\s\S]*?<\/create_file>/gs, '')          // create_file fermé sans ---
        .replace(/<create_file[^>]*>[\s\S]*/s, '')                     // create_file ouvert (stream en cours)
        .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, '')
        .replace(/<edit_file[\s\S]*?<\/edit_file>/gs, '')              // edit_file fermé
        .replace(/<edit_file[^>]*>[\s\S]*/s, '')                       // edit_file ouvert (stream en cours)
        .replace(FETCH_FILE_REGEX, '')
        .replace(/<file_content_snapshot[\s\S]*?<\/file_content_snapshot>/gs, '')
        .replace(/---\s*\n?\s*<create_file[^>]*>[\s\S]*/s, '')         // --- + create_file ouvert (fallback)
        .replace(/^\s*---\s*$/gm, '')                                   // --- seul sur sa ligne (separator orphelin)
        .replace(/\[TOKEN_USAGE\][\s\S]*?\[\/TOKEN_USAGE\]/g, '')
        .replace(/\[QUOTA_EXCEEDED\][\s\S]*?\[\/QUOTA_EXCEEDED\]/gs, '')
        .replace(/\[PAGE_DONE\]/g, '')
        .replace(/\[DESIGN:RESTORED\][^\n]*/g, '')
        .replace(/\[DESIGN:THINKING\][^\n]*/g, '')
        .replace(/\[DESIGN:INTENT\][^\n]*/g, '')
        .replace(/\[DESIGN:READY\][^\n]*/g, '')
        .replace(/\[DESIGN:SKIP\][^\n]*/g, '')
        .replace(/\[STR_REPLACE\][^\n]*/g, '')
        .replace(/\[EDIT_FILE\][^\n]*/g, '')
        .replace(/\[WORKING_ON\][\s\S]*?\[\/WORKING_ON\]/g, '')
        .replace(/^DEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
        .replace(/^DEVDEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
        .replace(/^REMOVE_DEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
        .replace(/\bCHAT_ONLY\b/g, '')
        .replace(/<request_vibes[^/]*\/>/g, '')                          // masquer les requêtes vibes
        .replace(/<chat_name>[\s\S]*?<\/chat_name>/g, '')                // masquer le tag nom de projet
        .replace(/\[PHASE:\d+\/[A-Z_]+\]/g, '')                          // masquer les tags [PHASE:N/NAME]
        .replace(/\[\/PHASE:\d+\]/g, '')                                  // masquer les tags [/PHASE:N]
        .replace(/\[BUILD_ERROR:[^\]]*\][\s\S]*?\[\/BUILD_ERROR\]/g, '') // masquer le stderr brut
        .replace(/<copy_block[\s\S]*?<\/copy_block>/gs, '')              // masquer les copy_blocks (rendus séparément)
        .replace(/<copy_block[^>]*>[\s\S]*/s, '')                        // copy_block ouvert (stream en cours)
        .replace(PLAN_REGEX, '')
        .replace(/^\s*\[?\s*$/gm, '')                                   // lignes avec juste [ ou whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // ── Parse [BUILD_ERROR] — erreur build/install ────────────────────────
      const buildErrMatch = text.match(/\[BUILD_ERROR:([^\]]+)\]([\s\S]*?)\[\/BUILD_ERROR\]/);
      const buildError = buildErrMatch
        ? { action: buildErrMatch[1].trim(), stderr: buildErrMatch[2].trim() }
        : undefined;

      // ── Parse <copy_block> artifacts ──────────────────────────────────────
      const copyBlockMatches = [...text.matchAll(/<copy_block(?:\s+label="([^"]*)")?>([\s\S]*?)<\/copy_block>/g)];
      const copyBlocks = copyBlockMatches.map(m => ({ label: m[1] ?? '', content: m[2].trim() }));

      // Texte visible — puisque PHASE/PRESENTER tags sont déjà strippés de textWithoutArtifacts,
      // on l'utilise directement. Plus besoin de slicer avec un index issu du texte brut
      // (c'était la cause du bug "J" : index décalé entre text et textWithoutArtifacts).
      const visibleText = textWithoutArtifacts
        .replace(/\[\[START\]\]/g, '').replace(/\[\[FINISH\]\]/g, '').trim();

      // Si <request_vibes> détecté dans ce tour (appel non-relancé), on marque
      // requestingVibes=true mais on CONSERVE le contenu visible (première réponse annonceur)
      const pendingVibesRequest = !forceDesignRef && !vibeImages &&
        /<request_vibes\s+category="[^"]+"\s+count="?\d+"?\s*\/>/.test(text);

      setMessages((prev) => prev.map(msg =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              content: visibleText,
              requestingVibes: pendingVibesRequest ? true : msg.requestingVibes,
              phases,
              presenterIntro,
              presenterOutro,
              activePhaseId,
              envVars,
              currentStreamingFilePath,
              fileBadgesCompleted,
              currentlyWritingFile,
              agentWorkingOn,
              thinkDurationMs: Date.now() - streamStartMs,
              buildError,
              copyBlocks: copyBlocks.length > 0 ? copyBlocks : msg.copyBlocks,
              artifactData: newArtifactData || msg.artifactData,
            }
          : msg
      ));
    } // fin while(true) interne
    break; // stream terminé normalement → sortir de streamLoop
    } // fin streamLoop

    // ── Extraction <chat_name> — renommer le projet si l'IA en propose un ────
    const chatNameMatch = text.match(/<chat_name>([\s\S]*?)<\/chat_name>/);
    if (chatNameMatch) {
      const newName = chatNameMatch[1].trim().replace(/[^\w\sÀ-ÿ\-]/g, '').trim().slice(0, 60);
      if (newName.length > 2 && activeProject) {
        setCurrentProject(prev => prev ? { ...prev, name: newName } : prev);
        setProjects(ps => ps.map(p => p.id === activeProject.id ? { ...p, name: newName } : p));
        // Mettre à jour l'URL si possible
        try {
          const slug = `${newName.replace(/\s+/g, '-').toLowerCase()}+${activeProject.id}`;
          window.history.replaceState({}, '', `/chat/${slug}`);
        } catch {}
      }
    }

    // ── Message final ─────────────────────────────────────────────────────────
    let finalCleanText = text
      .replace(inspirationUrlRegex, '')
      .replace(/<create_file[\s\S]*?<\/create_file>/gs, '')
      .replace(/<create_file[^>]*>[\s\S]*/s, '')
      .replace(/<file_changes[\s\S]*?<\/file_changes>/gs, '')
      .replace(/<edit_file[\s\S]*?<\/edit_file>/gs, '')
      .replace(/<edit_file[^>]*>[\s\S]*/s, '')
      .replace(FETCH_FILE_REGEX, '')
      .replace(/<file_content_snapshot[\s\S]*?<\/file_content_snapshot>/gs, '')
      .replace(/---\s*\n?\s*<create_file[^>]*>[\s\S]*/s, '')
      .replace(/^\s*---\s*$/gm, '')
      .replace(/\[TOKEN_USAGE\][\s\S]*?\[\/TOKEN_USAGE\]/g, '')
      .replace(/\[PAGE_DONE\]/g, '')
      .replace(/\[DESIGN:RESTORED\][^\n]*/g, '')
      .replace(/\[DESIGN:THINKING\][^\n]*/g, '')
      .replace(/\[DESIGN:INTENT\][^\n]*/g, '')
      .replace(/\[DESIGN:READY\][^\n]*/g, '')
      .replace(/\[DESIGN:SKIP\][^\n]*/g, '')
      .replace(/\[STR_REPLACE\][^\n]*/g, '')
      .replace(/\[EDIT_FILE\][^\n]*/g, '')
      .replace(/\[WORKING_ON\][\s\S]*?\[\/WORKING_ON\]/g, '')
      .replace(/^DEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
      .replace(/^DEVDEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
      .replace(/^REMOVE_DEPENDENCIES:\s*\[.*?\]\s*$/gm, '')
      .replace(/\bCHAT_ONLY\b/g, '')
      .replace(/<request_vibes[^/]*\/>/g, '')
      .replace(/<chat_name>[\s\S]*?<\/chat_name>/g, '')                  // masquer le tag nom de projet
      .replace(/<copy_block[\s\S]*?<\/copy_block>/gs, '')               // masquer les copy_blocks (rendus séparément)
      .replace(/<copy_block[^>]*>[\s\S]*/s, '')                         // copy_block ouvert résiduel
      .replace(/\[PHASE:\d+\/[A-Z_]+\]/g, '')                           // masquer les tags [PHASE:N/NAME]
      .replace(/\[\/PHASE:\d+\]/g, '')                                   // masquer les tags [/PHASE:N]
      .replace(PLAN_REGEX, '')
      .replace(/^\s*\[?\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const { presenterIntro: fi, phases: fp, presenterOutro: fo, envVars: fev } = extractPhases(text);
    // finalCleanText a déjà les PHASE/PRESENTER tags strippés → on l'utilise directement
    const finalVisibleText = finalCleanText
      .replace(/\[\[START\]\]|\[\[FINISH\]\]/g, '').trim();

    // Parse final copy_blocks and build error
    const finalCopyMatches = [...text.matchAll(/<copy_block(?:\s+label="([^"]*)")?>([\s\S]*?)<\/copy_block>/g)];
    const finalCopyBlocks = finalCopyMatches.map(m => ({ label: m[1] ?? '', content: m[2].trim() }));
    const finalBuildErrMatch = text.match(/\[BUILD_ERROR:([^\]]+)\]([\s\S]*?)\[\/BUILD_ERROR\]/);
    const finalBuildError = finalBuildErrMatch
      ? { action: finalBuildErrMatch[1].trim(), stderr: finalBuildErrMatch[2].trim() }
      : undefined;

    const finalArtifacts = extractFileArtifacts(text);
    finalAssistantMessage = {
      role: "assistant",
      content: finalVisibleText,
      phases: fp,
      presenterIntro: fi,
      presenterOutro: fo,
      activePhaseId: 0,
      envVars: fev,
      thinkDurationMs: Date.now() - streamStartMs,
      copyBlocks: finalCopyBlocks.length > 0 ? finalCopyBlocks : undefined,
      buildError: finalBuildError,
      artifactData: finalArtifacts.length > 0
        ? { type: 'files', parsedList: finalArtifacts.map(a => ({ path: a.filePath, type: a.type })), rawJson: text }
        : (urlArtifact
            ? { type: 'inspirationUrl', rawJson: JSON.stringify(urlArtifact), parsedList: [] }
            : { type: null, rawJson: "", parsedList: [] })
    };

    if (urlArtifact) {
      await runAutomatedAnalysis(urlArtifact.url, userPrompt, false);
      return;
    }

    // ── Fallback post-stream pour <request_vibes> ──────────────────────────────
    // Si la détection in-stream a raté (tag splitté sur plusieurs chunks),
    // on le rattrape ici — UNIQUEMENT si ce n'est pas déjà un appel relancé
    if (!forceDesignRef && !vibeImages) {
      const rvMatches = [...text.matchAll(/<request_vibes\s+category="([^"]+)"\s+count="?(\d+)"?\s*\/>/g)];
      if (rvMatches.length > 0) {
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsgId ? { ...msg, content: "", requestingVibes: true } : msg
        ));
        addLog(`🎨 [Fallback] Agent demande des vibes: ${rvMatches.map(m => `${m[2]}x ${m[1]}`).join(', ')}`);
        try {
          const vibeImgsArr = await fetchVibesWithRotation(rvMatches, _fbApp);
          if (vibeImgsArr.length > 0) {
            addLog(`🎨 ${vibeImgsArr.length} vibes fetched (fallback) — relancement avec design ref`);
            setMessages(prev => prev.filter(m => m.id !== assistantMsgId && m.id !== userMsgId));
            setLoading(false);
            isAiStreamingRef.current = false;
            setIsAiStreaming(false);
            isStreamingRef.current = false;
            await sendChat(userPrompt, activeProject, vibeImgsArr, true);
            return;
          }
        } catch (vibeErr) {
          console.warn("Vibe fetch fallback failed:", vibeErr);
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId ? { ...msg, requestingVibes: false } : msg
          ));
        }
      }
    }

    if (finalArtifacts.length > 0) {
      applyArtifactsToProject(finalArtifacts, activeProject ?? undefined);
      // ── Auto-run: trigger runSequence after AI updates files ────────────
      setPendingAutoRun(true);
    }

  } catch (err: any) {
    const errMsg: string = err?.message ?? String(err);
    // ── Détection quota 429 / RESOURCE_EXHAUSTED ─────────────────────────────
    const isQuota = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') ||
      errMsg.includes('quota') || errMsg.includes('rate limit') ||
      errMsg.includes('Too Many Requests') || errMsg.includes('overloaded') ||
      errMsg.includes('529') || errMsg.toLowerCase().includes('exceeded');
    if (isQuota) {
      setQuotaResetAt(prev => {
        if (prev && prev > Date.now()) return prev;
        const t = Date.now() + 24 * 60 * 60 * 1000;
        try { localStorage.setItem('quota_reset_at', String(t)); } catch {}
        return t;
      });
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsgId
          ? { ...msg, content: '', quotaExceeded: { message: "API quota reached", resetHint: `Try again in 24h or reload your API key.` } }
          : msg
      ));
    } else {
      addLog(`ERROR: ${errMsg}`);
      setMessages((prev) => prev.filter(m => m.id !== assistantMsgId));
    }
  } finally {
    if (finalAssistantMessage) {
      let _capturedMsgs: Message[] = [];
      setMessages((prev) => {
        const updated = prev.map(msg =>
          msg.id === assistantMsgId ? { ...finalAssistantMessage, id: assistantMsgId } : msg
        );
        _capturedMsgs = updated;
        return updated;
      });
      // ── Sauvegarder dans IDB avec les fichiers les plus frais ─────────────
      // On passe par setCurrentProject pour lire l'état React le plus récent
      // (les fichiers peuvent avoir changé pendant le stream via addFilesIfNew)
      if (activeProject && _capturedMsgs.length > 0) {
        setCurrentProject(prev => {
          const freshProject = prev ?? activeProject;
          const proj = { ...freshProject, messages: _capturedMsgs };
          saveProjectToIDB(proj).catch(() => {});
          setProjects(ps => ps.map(p => p.id === proj.id ? proj : p));
          return proj;
        });
      }
    }
    // ── Stream réussi → effacer le quota si l'utilisateur a changé de clé API ──
    if (finalAssistantMessage && !finalAssistantMessage.quotaExceeded) {
      setQuotaResetAt(prev => {
        if (!prev) return null;
        try { localStorage.removeItem('quota_reset_at'); } catch {}
        return null;
      });
    }
    setLoading(false);
    isAiStreamingRef.current = false;
    setIsAiStreaming(false);
    streamReaderRef.current = null;
    isStreamingRef.current = false;
    globalStreamStartRef.current = null; // reset pour le prochain sendChat indépendant
    setLiveFile(null); // reset du fichier en cours de stream
    if (userSelectedFileRef.current !== null) {
      setActiveFile(userSelectedFileRef.current);
      userSelectedFileRef.current = null;
    }
  }
};
    

      

  

    


             

         
         
        
         const runAction = async (
  action: "create" | "install" | "build" | "start" | "addFiles",
  sandboxIdOverride?: string
) => {
  setLoading(true)
  setActionDropdownOpen(false)

  // 🔧 Fonction utilitaire pour nettoyer le stderr (INCHANGÉE MAIS CRITIQUE)
  const cleanBuildOutput = (output: string) => {
    // Supprime les codes couleur ANSI (e.g. \x1B[0m)
    return output
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "") 
      // Supprime les caractères non imprimables
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "") 
      .trim()
  }

  try {
    addLog(`Running action: ${action}...`)
    const effectiveSandboxId = sandboxIdOverride || sandboxId || undefined
    const body: any = { action, sandboxId: effectiveSandboxId }

    if (action === "addFiles") {
      const filesToSend = currentProject?.files || []

      if (!filesToSend.length || filesToSend.some((f) => !f.filePath)) {
        addLog("ERROR: Missing file path for one or more files.")
        setLoading(false)
        return
      }
      body.files = filesToSend
    }

    const res = await fetch("/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json()

    if (data.error) {
      addLog(`API ERROR: ${data.error}`)
      if (data.details) addLog(`Details: ${data.details}`)
      setLoading(false)
      return
    }

    if (data.logs) data.logs.split("\n").forEach((l: string) => addLog(l))
    if (data.sandboxId) setSandboxId(data.sandboxId)
    if (data.url) setPreviewUrl(data.url)

    // 🧠 Traitement des commandes build/install
    if (data.action === "install" || data.action === "build") {
      const result: CommandResult = data.result
      if (result) {
        addLog(`Commande '${data.action}' terminée (Code: ${result.exitCode})`)

        if (result.stdout) {
          addLog("--- STDOUT ---")
          result.stdout.split("\n").forEach((l) => addLog(l))
          addLog("--------------")
        }

        if (result.stderr) {
          addLog("--- STDERR ---")
          result.stderr.split("\n").forEach((l) => addLog(l))
          addLog("--------------")

          const cleanStderr = cleanBuildOutput(result.stderr)

          if (data.action === "build") {
            // BUILD : tout stderr non vide est bloquant → envoyer à l'IA
            if (cleanStderr.length > 0) {
              const prompt = `[BUILD_ERROR:Build]\n${cleanStderr}\n[/BUILD_ERROR]\n\nErreur pendant le build. Corrige-la :\n\`\`\`\n${cleanStderr}\n\`\`\``
              try {
                await sendChat(prompt)
                addLog(`🧠 Erreur Build transmise à l'IA pour correction.`)
              } catch (chatErr: any) {
                addLog(`⚠️ Erreur envoi IA : ${chatErr.message}`)
              }
            }
          } else {
            // INSTALL : distinguer les npm warn/notice inoffensifs des erreurs bloquantes.
            // Erreurs BLOQUANTES :
            //   - npm ERR! (crash total)
            //   - ERESOLVE / ENOTFOUND / EACCES / ETIMEDOUT (résolution/réseau/permission)
            //   - peer dep avec UPPERCASE (ex: "WARN ERESOLVE overriding peer deps")
            //   - "Could not resolve" / "Failed to fetch" / "permission denied"
            //   - node: ... { code: ... } (erreur Node.js native)
            //   - exit code non-zero avec un vrai message d'erreur
            const lines = cleanStderr.split("\n")
            const blockingLines = lines.filter(line => {
              const l = line.toLowerCase()
              // Ignorer explicitement les inoffensifs
              if (
                l.includes("npm warn deprecated") ||
                l.includes("npm notice") ||
                l.includes("npm warn funding") ||
                l.includes("npm warn old lockfile") ||
                (l.includes("npm warn") && !l.match(/npm warn [A-Z]{3,}/)) // warn sans mot majuscule = inoffensif
              ) return false
              // Détecter les bloquants
              return (
                l.includes("npm err") ||
                l.includes("eresolve") ||
                l.includes("enotfound") ||
                l.includes("eacces") ||
                l.includes("etimedout") ||
                l.includes("enoent") ||
                l.includes("could not resolve") ||
                l.includes("failed to fetch") ||
                l.includes("permission denied") ||
                l.includes("peer dep") ||
                /npm warn [a-z0-9]{3,}/.test(l) && /[A-Z]{3,}/.test(line) || // WARN ERESOLVE etc
                /\bcode\b.*[A-Z_]{3,}/.test(line) || // { code: 'MODULE_NOT_FOUND' }
                (l.includes("error") && !l.includes("npm warn"))
              )
            })
            const blockingStderr = blockingLines.join("\n").trim()

            if (blockingStderr.length > 0) {
              const prompt = `[BUILD_ERROR:Install]\n${blockingStderr}\n[/BUILD_ERROR]\n\nErreur bloquante pendant npm install. Corrige-la :\n\`\`\`\n${blockingStderr}\n\`\`\``
              try {
                await sendChat(prompt)
                addLog(`🧠 Erreur Install bloquante transmise à l'IA pour correction.`)
              } catch (chatErr: any) {
                addLog(`⚠️ Erreur envoi IA : ${chatErr.message}`)
              }
            } else {
              addLog("ℹ️ Avertissements npm ignorés (non bloquants).")
            }
          }
        }

        if (result.error) addLog(`E2B Command Error: ${result.error}`)
        if (result.exitCode !== 0)
          addLog(`ERROR: Commande '${data.action}' échouée.`)
        else addLog(`SUCCESS: Commande '${data.action}' réussie.`)
      }
    } else if (data.success && action === "addFiles") {
      addLog(`${currentProject?.files.length || 0} files written successfully.`)
      if (currentProject) saveProject()
    } else if (data.success && action === "create") {
      addLog(`Sandbox créé avec l'ID: ${data.sandboxId}`)
      if (currentProject && currentProject.files.length > 0) {
        addLog("Writing current project files to the new sandbox...")
        await runAction("addFiles", data.sandboxId)
      }
    } else if (data.success && action === "start") {
      addLog(`Serveur démarré. Aperçu: ${data.url}`)
    } else if (!data.success) {
      addLog(`ERROR: Action '${action}' échouée.`)
    }
  } catch (err: any) {
    addLog(`CLIENT-SIDE ERROR: ${err.message}`)
  } finally {
    setLoading(false)
  }
      }   

  // ── runSequence — intelligent: only runs what's needed ───────────────────
  // TTL: E2B sandbox resets 15 min after the LAST API call.
  // We track lastSandboxActivityRef and force re-create if inactive > 13 min.
  // We also handle "sandbox dead" errors during connect by falling back to create.
  const runSequence = async () => {
    if (!currentProject) { addLog("❌ Aucun projet sélectionné."); return; }
    setActionDropdownOpen(false);
    setLoading(true);
    setIsRunning(true);
    setBuildSteps([]);

    // ── Abort token ───────────────────────────────────────────────────────
    const myToken = ++runSeqTokenRef.current;
    const isAborted = () => runSeqTokenRef.current !== myToken;

    const _setStep = (id: string, label: string, status: 'pending' | 'running' | 'done' | 'error') => {
      if (isAborted()) return;
      setBuildSteps(prev => {
        const exists = prev.find(s => s.id === id);
        if (exists) return prev.map(s => s.id === id ? { ...s, label, status } : s);
        return [...prev, { id, label, status }];
      });
    };

    const cleanBuildOutput = (output: string) =>
      output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").trim();

    const doFetch = async (action: string, sid?: string) => {
      const body: any = { action, sandboxId: sid || undefined };
      if (action === "addFiles") {
        const filesToSend = currentProject?.files || [];
        if (!filesToSend.length || filesToSend.some((f: any) => !f.filePath)) {
          addLog("ERROR: Missing file path for one or more files."); return null;
        }
        body.files = filesToSend;
      }
      const res = await fetch("/api/sandbox", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      // Mark sandbox activity for TTL tracking
      lastSandboxActivityRef.current = Date.now();
      return res.json();
    };

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // ── Helper: run the addFiles → install → build → start sequence given a sandboxId ──
    const runBuildSequence = async (sid: string, hasPkg: boolean, stepOffset: number) => {
      _setStep('addfiles', 'Writing files', 'running');
      addLog(`📂 [${stepOffset}/4] Writing files...`);
      const addData = await doFetch("addFiles", sid);
      if (isAborted()) return false;
      if (!addData || addData.error) { addLog(`API ERROR: ${addData?.error}`); _setStep('addfiles', 'Writing files', 'error'); return false; }
      addLog(`✓ ${currentProject.files.length} files written.`);
      if (currentProject) saveProject();
      _setStep('addfiles', 'Writing files', 'done');

      if (hasPkg) {
        _setStep('install', 'Installing packages', 'running');
        addLog(`📥 [${stepOffset + 1}/4] npm install...`);
        const installData = await doFetch("install", sid);
        if (isAborted()) return false;
        if (!installData || installData.error) { addLog(`API ERROR: ${installData?.error}`); _setStep('install', 'Installing packages', 'error'); return false; }
        if (installData.result) {
          const r = installData.result;
          if (r.stderr) {
            const clean = cleanBuildOutput(r.stderr);
            const blockingLines = clean.split("\n").filter((line: string) => {
              const l = line.toLowerCase();
              if (l.includes("npm warn deprecated") || l.includes("npm notice") || l.includes("npm warn funding") || l.includes("npm warn old lockfile") || (l.includes("npm warn") && !l.match(/npm warn [A-Z]{3,}/))) return false;
              return (l.includes("npm err") || l.includes("eresolve") || l.includes("enotfound") || l.includes("eacces") || l.includes("etimedout") || l.includes("enoent") || l.includes("could not resolve") || l.includes("failed to fetch") || l.includes("permission denied") || l.includes("peer dep") || (l.includes("error") && !l.includes("npm warn")));
            });
            const blockingStderr = blockingLines.join("\n").trim();
            if (blockingStderr.length > 0) {
              _setStep('install', 'Installing packages', 'error');
              const prompt = `[BUILD_ERROR:Install]\n${blockingStderr}\n[/BUILD_ERROR]\n\nBlocking error during npm install. Fix it:\n\`\`\`\n${blockingStderr}\n\`\`\``;
              try { await sendChat(prompt); } catch {}
            }
          }
          addLog(r.exitCode === 0 ? "✓ Install successful." : "ERROR: Install failed.");
        }
        if (isAborted()) return false;
        _setStep('install', 'Installing packages', 'done');

        _setStep('build', 'Building project', 'running');
        addLog(`🔨 [${stepOffset + 2}/4] npm run build...`);
        const buildData = await doFetch("build", sid);
        if (isAborted()) return false;
        if (!buildData || buildData.error) { addLog(`API ERROR: ${buildData?.error || "build failed"}`); _setStep('build', 'Building project', 'error'); return false; }
        if (buildData.result) {
          const r = buildData.result;
          if (r.stderr) {
            const clean = cleanBuildOutput(r.stderr);
            if (clean.length > 0) {
              _setStep('build', 'Building project', 'error');
              const prompt = `[BUILD_ERROR:Build]\n${clean}\n[/BUILD_ERROR]\n\nError during build. Fix it:\n\`\`\`\n${clean}\n\`\`\``;
              try { await sendChat(prompt); } catch {}
            }
          }
          addLog(r.exitCode === 0 ? "✓ Build successful." : "ERROR: Build failed.");
        }
        if (isAborted()) return false;
        _setStep('build', 'Building project', 'done');

        _setStep('start', 'Starting server', 'running');
        addLog(`🚀 [${stepOffset + 3}/4] Starting server...`);
        const startData = await doFetch("start", sid);
        if (isAborted()) return false;
        if (!startData || startData.error) { addLog(`API ERROR: ${startData?.error || "start failed"}`); _setStep('start', 'Starting server', 'error'); return false; }
        if (startData.url) {
          setPreviewUrl(startData.url);
          addLog(`✓ Server online: ${startData.url}`);
        }
        if (isAborted()) return false;
        _setStep('start', 'Starting server', 'done');
      }
      return true;
    };

    // ── Smart detection ────────────────────────────────────────────────────
    const currentPkgJson = currentProject.files.find((f: any) => f.filePath === "package.json")?.content ?? "";
    const pkgJsonChanged = currentPkgJson !== runSeqPkgJsonRef.current;
    const serverActive = !!sandboxId && !!previewUrl;

    // Sandbox considered dead if last activity > 13 min ago (E2B TTL = 15 min from last call)
    const sandboxInactive = lastSandboxActivityRef.current !== null &&
      (Date.now() - lastSandboxActivityRef.current > SANDBOX_INACTIVITY_TTL_MS);
    const needsCreate = !sandboxId || sandboxInactive;

    try {
      if (needsCreate) {
        if (sandboxInactive) {
          addLog("⏰ Sandbox inactive (>13 min) → recreating...");
          setSandboxId(null); setPreviewUrl(null);
        }
        addLog("⚡ Full sequence: Create → AddFiles → Install → Build → Start");

        _setStep('create', 'Creating sandbox', 'running');
        addLog("📦 [1/5] Creating sandbox...");
        const createData = await doFetch("create");
        if (isAborted()) { return; }
        if (!createData || createData.error) { addLog(`API ERROR: ${createData?.error || "create failed"}`); _setStep('create', 'Creating sandbox', 'error'); return; }
        const sid: string = createData.sandboxId;
        if (!sid) { addLog("ERROR: No sandboxId returned."); _setStep('create', 'Creating sandbox', 'error'); return; }
        setSandboxId(sid);
        lastSandboxActivityRef.current = Date.now();
        addLog(`✓ Sandbox created: ${sid}`);
        _setStep('create', 'Creating sandbox', 'done');

        addLog("⏳ Initializing (6s)..."); await delay(6000);
        if (isAborted()) { return; }

        const ok = await runBuildSequence(sid, true, 2);
        if (!ok || isAborted()) return;
        runSeqPkgJsonRef.current = currentPkgJson;

      } else if (serverActive && !pkgJsonChanged) {
        // ── Sandbox alive + package.json unchanged → addFiles only ─────────
        addLog("⚡ Server active + package.json unchanged → AddFiles only");

        // Validate sandbox is still alive — if connect fails, fall back to full sequence
        let sandboxAlive = true;
        try {
          const statusData = await doFetch("status", sandboxId!);
          if (!statusData || !statusData.connected) sandboxAlive = false;
        } catch { sandboxAlive = false; }

        if (!sandboxAlive || isAborted()) {
          if (!isAborted()) {
            addLog("⚠️ Sandbox unreachable — recreating...");
            setSandboxId(null); setPreviewUrl(null);
            lastSandboxActivityRef.current = null;
            runSeqTokenRef.current++; // restart with fresh token by calling recursively
            await runSequence();
          }
          return;
        }

        _setStep('addfiles', 'Writing files', 'running');
        addLog("📂 Writing files...");
        const addData = await doFetch("addFiles", sandboxId!);
        if (isAborted()) { return; }
        if (!addData || addData.error) { addLog(`API ERROR: ${addData?.error}`); _setStep('addfiles', 'Writing files', 'error'); return; }
        addLog(`✓ ${currentProject.files.length} files written.`);
        if (currentProject) saveProject();
        _setStep('addfiles', 'Writing files', 'done');

      } else {
        // ── Sandbox exists + package.json changed OR server dead ───────────
        const currentSid = sandboxId!;
        addLog(pkgJsonChanged ? "⚡ package.json changed → AddFiles + Install + Build + Start" : "⚡ Existing sandbox → AddFiles + Install + Build + Start");

        const ok = await runBuildSequence(currentSid, true, 1);
        if (!ok || isAborted()) return;
        runSeqPkgJsonRef.current = currentPkgJson;
      }

      addLog("✅ Sequence complete!");
    } catch (err: any) {
      addLog(`CLIENT-SIDE ERROR: ${err.message}`);
    } finally {
      if (!isAborted()) {
        setLoading(false);
        setIsRunning(false);
        setBuildSteps([]);
      }
    }
  };

  /**
   * Lance la séquence complète : create → addFiles → install → build → start.
   * Si le sandbox existe déjà (sandboxId non null), démarre depuis addFiles.
   * Si package.json a changé, recrée un sandbox propre depuis create.
   */
  // ── runDeployAll — séquence intelligente complète ──────────────────────────
  // Reprend intégralement la logique de runAction (fetch, logs, stderr→sendChat)
  // mais enchaîne les actions avec détection intelligente :
  //   - Si sandbox existe → skip create, juste addFiles
  //   - Si package.json n'a pas changé depuis le dernier déploiement ET serveur actif → juste addFiles
  //   - Sinon → séquence complète create → addFiles(6s) → install → build → start
  const deployAllPkgJsonRef = React.useRef<string>("");

  const runDeployAll = async () => {
    if (!currentProject) { addLog("❌ Aucun projet sélectionné."); return; }

    const cleanBuildOutput = (output: string) =>
      output.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").trim();

    const doFetch = async (action: string, extraBody: any = {}) => {
      const body: any = { action, sandboxId: sandboxId || undefined, ...extraBody };
      if (action === "addFiles") {
        const filesToSend = currentProject?.files || [];
        if (!filesToSend.length || filesToSend.some((f: any) => !f.filePath)) {
          addLog("ERROR: Missing file path for one or more files."); return null;
        }
        body.files = filesToSend;
      }
      const res = await fetch("/api/sandbox", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return await res.json();
    };

    const handleInstallBuildData = async (data: any, action: string) => {
      if (data.logs) data.logs.split("\n").forEach((l: string) => addLog(l));
      if (data.result) {
        const result = data.result;
        addLog(`Commande '${action}' terminée (Code: ${result.exitCode})`);
        if (result.stdout) { addLog("--- STDOUT ---"); result.stdout.split("\n").forEach((l: string) => addLog(l)); addLog("--------------"); }
        if (result.stderr) {
          addLog("--- STDERR ---"); result.stderr.split("\n").forEach((l: string) => addLog(l)); addLog("--------------");
          const cleanStderr = cleanBuildOutput(result.stderr);
          if (action === "build") {
            if (cleanStderr.length > 0) {
              const prompt = `[BUILD_ERROR:Build]\n${cleanStderr}\n[/BUILD_ERROR]\n\nErreur pendant le build. Corrige-la :\n\`\`\`\n${cleanStderr}\n\`\`\``;
              try { await sendChat(prompt); addLog("🧠 Erreur Build transmise à l'IA."); } catch (e: any) { addLog(`⚠️ ${e.message}`); }
            }
          } else {
            const blockingLines = cleanStderr.split("\n").filter(line => {
              const l = line.toLowerCase();
              if (l.includes("npm warn deprecated") || l.includes("npm notice") || l.includes("npm warn funding") || l.includes("npm warn old lockfile") || (l.includes("npm warn") && !l.match(/npm warn [A-Z]{3,}/))) return false;
              return (l.includes("npm err") || l.includes("eresolve") || l.includes("enotfound") || l.includes("eacces") || l.includes("etimedout") || l.includes("enoent") || l.includes("could not resolve") || l.includes("failed to fetch") || l.includes("permission denied") || l.includes("peer dep") || (/npm warn [a-z0-9]{3,}/.test(l) && /[A-Z]{3,}/.test(line)) || /\bcode\b.*[A-Z_]{3,}/.test(line) || (l.includes("error") && !l.includes("npm warn")));
            });
            const blockingStderr = blockingLines.join("\n").trim();
            if (blockingStderr.length > 0) {
              const prompt = `[BUILD_ERROR:Install]\n${blockingStderr}\n[/BUILD_ERROR]\n\nErreur bloquante pendant npm install. Corrige-la :\n\`\`\`\n${blockingStderr}\n\`\`\``;
              try { await sendChat(prompt); addLog("🧠 Erreur Install transmise à l'IA."); } catch (e: any) { addLog(`⚠️ ${e.message}`); }
            } else { addLog("ℹ️ Avertissements npm ignorés (non bloquants)."); }
          }
        }
        if (result.error) addLog(`E2B Command Error: ${result.error}`);
        addLog(result.exitCode === 0 ? `SUCCESS: '${action}' réussie.` : `ERROR: '${action}' échouée.`);
      }
    };

    setLoading(true);
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // ── Détection intelligente — que faut-il faire ? ──────────────────────────
    const currentPkgJson = currentProject.files.find((f: any) => f.filePath === "package.json")?.content ?? "";
    const pkgJsonChanged = currentPkgJson !== deployAllPkgJsonRef.current;
    const serverActive = !!sandboxId && !!previewUrl; // sandbox + URL preview = serveur actif

    try {
      if (!sandboxId) {
        // ── Aucun sandbox : séquence complète ──────────────────────────────
        addLog("⚡ Séquence complète : Create → AddFiles → Install → Build → Start");

        addLog("📦 [1/5] Création du sandbox...");
        const createData = await doFetch("create");
        if (!createData || createData.error) { addLog(`API ERROR: ${createData?.error || "create échoué"}`); setLoading(false); return; }
        if (createData.sandboxId) setSandboxId(createData.sandboxId);
        addLog(`Sandbox créé : ${createData.sandboxId}`);

        addLog("⏳ Initialisation (6s)..."); await delay(6000);

        addLog("📂 [2/5] Écriture des fichiers...");
        const addData = await doFetch("addFiles");
        if (!addData || addData.error) { addLog(`API ERROR: ${addData?.error}`); setLoading(false); return; }
        addLog(`${currentProject.files.length} fichiers écrits.`);
        if (currentProject) saveProject();

        addLog("📥 [3/5] npm install...");
        const installData = await doFetch("install");
        if (!installData || installData.error) { addLog(`API ERROR: ${installData?.error}`); setLoading(false); return; }
        await handleInstallBuildData(installData, "install");

        addLog("🔨 [4/5] npm run build...");
        const buildData = await doFetch("build");
        if (!buildData || buildData.error) { addLog(`API ERROR: ${buildData?.error}`); setLoading(false); return; }
        await handleInstallBuildData(buildData, "build");

        addLog("🚀 [5/5] Démarrage du serveur...");
        const startData = await doFetch("start");
        if (!startData || startData.error) { addLog(`API ERROR: ${startData?.error}`); setLoading(false); return; }
        if (startData.url) setPreviewUrl(startData.url);
        addLog(`Serveur démarré : ${startData.url}`);

        deployAllPkgJsonRef.current = currentPkgJson;

      } else if (serverActive && !pkgJsonChanged) {
        // ── Sandbox actif + package.json inchangé → juste écrire les fichiers ─
        addLog("⚡ Serveur actif + package.json inchangé → AddFiles uniquement");
        addLog("📂 Écriture des fichiers...");
        const addData = await doFetch("addFiles");
        if (!addData || addData.error) { addLog(`API ERROR: ${addData?.error}`); setLoading(false); return; }
        addLog(`${currentProject.files.length} fichiers écrits.`);
        if (currentProject) saveProject();

      } else {
        // ── Sandbox existe mais package.json changé ou serveur mort → addFiles + install + build + start ─
        addLog(pkgJsonChanged ? "⚡ package.json modifié → AddFiles + Install + Build + Start" : "⚡ Sandbox existant → AddFiles + Install + Build + Start");

        addLog("📂 [1/4] Écriture des fichiers...");
        const addData = await doFetch("addFiles");
        if (!addData || addData.error) { addLog(`API ERROR: ${addData?.error}`); setLoading(false); return; }
        addLog(`${currentProject.files.length} fichiers écrits.`);
        if (currentProject) saveProject();

        addLog("📥 [2/4] npm install...");
        const installData = await doFetch("install");
        if (!installData || installData.error) { addLog(`API ERROR: ${installData?.error}`); setLoading(false); return; }
        await handleInstallBuildData(installData, "install");

        addLog("🔨 [3/4] npm run build...");
        const buildData = await doFetch("build");
        if (!buildData || buildData.error) { addLog(`API ERROR: ${buildData?.error}`); setLoading(false); return; }
        await handleInstallBuildData(buildData, "build");

        addLog("🚀 [4/4] Démarrage du serveur...");
        const startData = await doFetch("start");
        if (!startData || startData.error) { addLog(`API ERROR: ${startData?.error}`); setLoading(false); return; }
        if (startData.url) setPreviewUrl(startData.url);
        addLog(`Serveur démarré : ${startData.url}`);

        deployAllPkgJsonRef.current = currentPkgJson;
      }

      addLog("✅ Séquence terminée !");
    } catch (err: any) {
      addLog(`CLIENT-SIDE ERROR: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
 




        
  const copyLogs = () => navigator.clipboard.writeText(logs.join("\n"))


  // Fonction pour copier le contenu du fichier actif
const handleCopyFileContent = () => {
    if (!currentProject || activeFile === null) return;

    const fileContent = currentProject.files[activeFile]?.content || "";

    if (fileContent) {
        navigator.clipboard.writeText(fileContent)
            .then(() => {
                setCopiedFileIndex(activeFile); // Active l'icône Check
                setTimeout(() => setCopiedFileIndex(null), 2000); // Réinitialise après 2s
            })
            .catch(err => {
                console.error("Erreur de copie:", err);
            });
    }
};


  // Fonction pour télécharger le fichier actif
const handleDownloadFile = () => {
    if (!currentProject || activeFile === null) return;

    const file = currentProject.files[activeFile];
    if (!file || !file.filePath) return;

    const fileContent = file.content || "";
    const fileName = file.filePath.split('/').pop() || 'download.txt'; // Utilise le nom de fichier

    try {
        // 1. Crée un Blob à partir du contenu
        const blob = new Blob([fileContent], { type: 'text/plain' });
        
        // 2. Crée un lien de téléchargement temporaire
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName; // Nom du fichier lors du téléchargement

        // 3. Déclenche le téléchargement
        document.body.appendChild(link);
        link.click();
        
        // 4. Nettoyage
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        // Ajoutez un log ou une notification de succès ici si nécessaire
        // addLog(`File downloaded: ${fileName}`); 
        
    } catch (e) {
        console.error("Erreur lors du téléchargement du fichier:", e);
        // addLog("ERROR: Failed to download file.");
    }
};

  const handleNavigate = () => {
    if (iframeRef.current && previewUrl) {
      const targetUrl = new URL(previewUrl)
      const route = iframeRoute.startsWith("/") ? iframeRoute : `/${iframeRoute}`
      targetUrl.pathname = route
      iframeRef.current.src = targetUrl.toString()
      addLog(`Navigating iframe to: ${targetUrl.toString()}`)
    }
  }

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
      setIsReloading(true);
      setTimeout(() => setIsReloading(false), 900);
      addLog("Reloading iframe...");
    }
  }


// --- NOUVELLE FONCTION D'ANALYSE DU CONTENU ---


// Constantes de couleur définies dans le composant ou en dehors
const ROUGE = 'FF0000'; 
const NOIR = '000000'; 
const VERT = '008000'; 
// Thème par défaut pour Monaco. Ici, nous partons du principe 'light' 
const MONACO_BASE_THEME = 'vs'; 
// NOTE : J'ai mis le thème en 'vs' (clair) car votre design a beaucoup de noir.

const handleEditorDidMount: OnMount = (editorInstance, monaco) => {
    // Store editor instance for imperative updates during streaming
    monacoEditorRef.current = editorInstance;
    
    // Désactivation de la vérification TypeScript/JSX (Lignes Rouges)
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      noSemanticValidation: true, 
      noSyntaxValidation: true,   
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
    
    // Définition du Thème Ultra-Personnalisé
    monaco.editor.defineTheme('customTheme', {
        base: MONACO_BASE_THEME,
        inherit: true,
        rules: [
            // ROUGE: Mots-clés (import, const, interface, from, etc.)
            { token: 'keyword', foreground: ROUGE },
            { token: 'keyword.flow', foreground: ROUGE }, 

            // VERT: Chaînes de caractères (Chemin des imports ex: 'react', './utils')
            { token: 'string', foreground: VERT },
            
            // NOIR: Identifiants (React, useState, noms de classes, variables, etc.)
            { token: 'identifier', foreground: NOIR },
            { token: 'type', foreground: NOIR }, // Types (string, number, UserProps)
            
            // NOIR: JSX/HTML (Balises et Attributs)
            { token: 'tag', foreground: NOIR }, // Balises comme <div>
            { token: 'tag.html', foreground: NOIR }, 
            { token: 'attribute.name', foreground: NOIR }, // Attributs comme 'className'
        ],
        colors: {
            // Sidebar (Numéros de Ligne Noirs avec Opacité)
            'editorLineNumber.foreground': '#00000033', // Inactif
            'editorLineNumber.activeForeground': '#000000FF', // Actif
            'editorLineNumber.background': '#FFFAF0',
            // S'assurer que le texte par défaut est noir
            'editor.foreground': NOIR, 
            'editor.background': '#FFFCF6', // Fond blanc pour le thème 'vs'
        },
    });

    // Appliquer le thème
    monaco.editor.setTheme('customTheme');

};
    





         


            // --- INTERFACE ET COMPOSANT RÉCURSIF (À L'INTÉRIEUR DE SandboxPage) ---
interface FileTreeItemProps {
  node: FileTreeNode
  activeFile: number | null
  setActiveFile: (index: number) => void
  liveFilePath?: string | null
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, activeFile, setActiveFile, liveFilePath }) => {
  const [isOpen, setIsOpen] = useState(true)
  const isDirectory = node.type === 'directory'
  const isCurrentlyActive = node.index !== undefined && activeFile === node.index
  // Pendant le stream : surligner le fichier en cours d'écriture par son path
  const isLive = liveFilePath != null && node.path === liveFilePath

  return (
    <li>
      <button
        className={`w-full text-left text-sm py-1 px-2 rounded-[10px] flex items-center gap-2 transition-colors ${
          isLive
            ? "bg-[#FFFAF0] text-[#37322F] font-semibold"
            : isCurrentlyActive
            ? "bg-[#FFFAF0]"
            : "hover:bg-[#FFFAF0] text-[#37322F]/80"
        }`}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen)
          } else if (node.index !== undefined) {
            setActiveFileUser(node.index)
          }
        }}
      >
        {isDirectory && (
          <ChevronRight 
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} 
            style={{ minWidth: '1rem' }}
          />
        )}
        {/* Point animé sur le fichier en cours de stream */}
        {isLive && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isDirectory && isOpen && node.children && (
        <ul className="pl-5 text-sm mt-1 space-y-1">
          {Array.from(node.children.entries())
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
              if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
              if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
              return nameA.localeCompare(nameB);
            })
            .map(([key, childNode]) => (
              <FileTreeItem
                key={key}
                node={childNode}
                activeFile={activeFile}
                setActiveFile={setActiveFileUser}
                liveFilePath={liveFilePath}
              />
            ))}
        </ul>
      )}
    </li>
  )
}
  


  



// Assurez-vous que useMemo est importé depuis 'react'
// REMPLACEZ VOTRE DÉFINITION STATIQUE PAR CE BLOC RÉACTIF

const fileTree = useMemo(() => {
    // Utilise currentProject.files comme source de données (votre 'files' doit pointer vers ceci)
    const files = currentProject?.files || [];

    if (files.length === 0) {
        return new Map();
    }
    
    // Appel à votre fonction buildFileTree
    return buildFileTree(files); 
    
// 🛑 Dépendance essentielle : assure que le calcul se fait après la mise à jour de l'état.
}, [currentProject?.files]); 
  



  // Assurez-vous d'importer useEffect : import { useState, useRef, useEffect, useMemo } from "react" 

// ... (déclarations de useState, useMemo, etc.)
useEffect(() => {
    if (currentProject) {
        if (currentProject.files !== files) {
             setFiles(currentProject.files);
        }
    } else if (files.length > 0) {
        setFiles([]);
    }
}, [currentProject, files, setFiles]);



useEffect(() => {
  if (!currentProject || !currentProject.id) return;

  const timeoutId = setTimeout(() => {
    handleUpdateEmbeddings();
  }, 2000);

  return () => clearTimeout(timeoutId);

  // ⚠️ Ne mets pas currentProject.files dans les deps sinon relance infinie
}, [currentProject?.id, handleUpdateEmbeddings]);




  
 
const handleVercelDeploy = async () => {
  if (!currentProject || !currentProject.files.length) {
    setDeployLogs(prev => [...prev, "❌ Aucun projet chargé ou vide."]);
    return;
  }

  if (!vercelToken) {
    const token = prompt("Entrez votre Vercel Access Token (https://vercel.com/account/tokens)");
    if (!token) return;
    localStorage.setItem("vercel_access_token", token);
    setVercelToken(token);
  }

  const token = vercelToken || localStorage.getItem("vercel_access_token");
  if (!token) return;

  setDeploying(true);
  setDeployLogs(["🚀 Lancement du déploiement sur Vercel..."]);

  try {
    // Prépare les fichiers à envoyer
    const projectFiles = currentProject.files.reduce((acc, f) => {
      acc[f.filePath] = f.content;
      return acc;
    }, {} as Record<string, string>);

    const res = await fetch("/api/deploy/vercel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        projectName: currentProject.name,
        files: projectFiles,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Erreur lors du déploiement");
    }

    setDeployLogs(prev => [...prev, `✅ Déploiement lancé : ${data.url}`]);
    setDeployUrl(data.url);

    pollVercelLogs(data.deploymentId, token, data.url);

                  

    // Suivi automatique des logs
    
  } catch (err: any) {
    setDeployLogs(prev => [...prev, `❌ ${err.message}`]);
  } finally {
    setDeploying(false);
  }
};



const pollVercelLogs = async (deploymentId: string, token: string, url: string) => {
  setDeployLogs(prev => [...prev, "⏳ Suivi du déploiement et lecture des logs..."]);

  try {
    const response = await fetch(
      `https://api.vercel.com/v3/deployments/${deploymentId}/events?follow=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.body) {
      setDeployLogs(prev => [...prev, "❌ Pas de flux disponible depuis l'API Vercel"]);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    // Buffers pour stdout et stderr
    let stdoutBuffer = "";
    let stderrBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });

      const lines = partial.split("\n");
      partial = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          let text = "";

          // ✅ Gestion stdout/stderr avec buffering
          if (event.type === "stdout") {
            text = event.payload?.text || event.payload?.message || "";
            stdoutBuffer += text;
            if (text.includes("\n")) {
              setDeployLogs(prev => [...prev, stdoutBuffer.trim()]);
              stdoutBuffer = "";
            }
            continue; // passe au prochain événement
          }

          if (event.type === "stderr") {
            text = event.payload?.text || event.payload?.message || "";
            stderrBuffer += text;
            if (text.includes("\n")) {
              setDeployLogs(prev => [...prev, `[stderr] ${stderrBuffer.trim()}`]);
              stderrBuffer = "";
            }
            continue;
          }

          // 🔹 Reste de ta logique inchangée
          text =
            event?.payload?.text ||
            event?.payload?.message ||
            event?.payload?.output ||
            event?.payload?.command ||
            event?.type ||
            "";

          if (text) {
            setDeployLogs(prev => [...prev, text]);
          }

          if (event.type === "state") {
            if (event.payload?.state === "READY") {
              setDeployLogs(prev => [...prev, `✅ Déploiement terminé : ${url}`]);
              return;
            }
            if (event.payload?.state === "ERROR") {
              setDeployLogs(prev => [...prev, `❌ Déploiement échoué (ERROR)`]);
              return;
            }
          }
        } catch {
          // ligne incomplète, on continue
        }
      }
    }

    // flush buffers restant à la fin du flux
    if (stdoutBuffer) setDeployLogs(prev => [...prev, stdoutBuffer.trim()]);
    if (stderrBuffer) setDeployLogs(prev => [...prev, `[stderr] ${stderrBuffer.trim()}`]);

  } catch (e: any) {
    setDeployLogs(prev => [...prev, `⚠️ Erreur lecture flux: ${e.message}`]);
  }
};
            
  

    const handleSmartSend = async () => {
  if (!chatInput.trim()) return;

  if (!currentProject) {
    // Nom extrait intelligemment du message : on retire les stopwords courants
    // et on prend les 5 mots les plus signifiants
    const stopwords = new Set([
      'je','tu','il','elle','on','nous','vous','ils','elles',
      'un','une','des','le','la','les','de','du','au','aux',
      'que','qui','quoi','quel','quelle','quels','quelles',
      'avec','sans','pour','par','sur','sous','dans','entre',
      'et','ou','mais','donc','or','ni','car','si','me','te','se',
      'mon','ton','son','ma','ta','sa','mes','tes','ses','nos','vos','leurs',
      'a','an','the','is','are','was','were','be','been','being',
      'i','you','he','she','we','they','it','this','that','these','those',
      'want','need','make','create','build','generate','do','can','would',
      'have','has','had','with','from','into','onto','upon','about',
      'veux','veux','veut','faire','créer','générer','crée','génère',
      'une','application','app','page','site','web','projet','mon','moi',
    ]);
    const generatedName = chatInput
      .replace(/[^\w\sÀ-ÿ]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w.toLowerCase()))
      .slice(0, 5)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
      .trim() || chatInput.trim().split(/\s+/).slice(0, 4).join(' ') || "New Project";

    const newId = crypto.randomUUID();
    const newProject = { 
      id: newId,
      name: generatedName,
      createdAt: new Date().toISOString(),
      files: [],
      messages: [], 
    };

    try {
      await saveProjectToIDB(newProject);
      setProjects(prev => [...prev, newProject]);
      
      setCurrentProject(newProject);
      setFiles([]);
      setMessages([]);
      
      const slug = `${generatedName.replace(/\s+/g, '-').toLowerCase()}+${newId}`;
      window.history.pushState({}, '', `/chat/${slug}`);
      
      // On passe explicitement le nouveau projet à sendChat
      await sendChat(chatInput, newProject);
    } catch (err) {
      console.error("Error creating project:", err);
    }
  } else {
    sendChat();
  }
};
        
  
  
        
  // -------------------
  // LE RETURN DU JSX (ne pas mettre d'accolade fermante avant !)
  // -------------------
  return (
    <div className={`flex h-screen bg-[#fbfbf9] font-sans text-[#37322F] ${!currentProject ? "flex-col-reverse justify-center items-center gap-6" : "flex-row"}`}
        >
      
        

    <div 
  className={`
  flex flex-col bg-[#fbfbf9] border-[rgba(55,50,47,0.12)] transition-all duration-300 overflow-x-hidden
  ${!currentProject 
    ? `h-auto bg-transparent border-none ${showProjectSelect ? "w-full pl-[270px] pr-6" : "w-full max-w-3xl"}`
    : "h-full md:w-[40%] md:flex"
  }
  ${currentProject ? (viewMode === "chat" ? "w-full flex flex-col" : "hidden md:flex md:flex-col") : "flex"}
`}
        
                      
>
        

        {showProjectSelect && (
    <div data-sidebar className="fixed z-50 top-0 left-0 bg-[#fbfbf9]  border border-[rgba(55,50,47,0.08)]   w-[260px] h-full overflow-y-auto flex flex-col p-1">

    
<div className="w-full h-auto flex flex-col gap-2">
    <div className="flex items-center p-2 justify-between w-full">
        
    <div className="flex items-center justify-center p-1">
  <svg 
    width="30" 
    height="30" 
    viewBox="0 0 30 30" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <ellipse
      cx="15"
      cy="15"
      rx="12"
      ry="6"
      fill="#000000"
      transform="rotate(-18 15 15)"
    />
  </svg>
</div>
        
        <div>
            <span>
                
            </span>
        </div>
    </div>

    
                    

    <div className="w-full p-2 pl-2 flex flex-col gap-2 h-auto mb-2 mt-3">
        <div className="w-full bg-[#f6f6f4] h-[32px] p-1 border border-[rgba(55,50,47,0.08)] mb-2 rounded-[8px] p-[2px] pl-2 hidden justify-between items-center">
        <div className="flex items-center gap-1">
                 <p className="font-semibold text-sm">Aymar Ludovic</p>
        </div>
        <ChevronsUpDown className="h-4 w-4 text-[rgba(55,50,47,0.6)] shrink-0" />
    </div>
        {/* Item Home */}
        <div
          onClick={() => { goToDashboard(); setShowProjectSelect(false); }}
          className="w-full h-[32px] bg-[#f6f6f4] rounded-[10px] p-[2px] flex justify-between items-center cursor-pointer hover:bg-[#ebebea] transition-colors"
        >
            <div className="flex items-center gap-1">
                  <svg 
  stroke="#000" 
  width="24" 
  height="24" 
 className="h-[18px] w-[18px]"
  viewBox="0 0 24 24" 
  strokeWidth="1.5" 
  fill="none" 
  xmlns="http://www.w3.org/2000/svg"
>
  <path 
    d="M10 16H14" 
    stroke="#000" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  />
  <path 
    d="M2 8L11.7317 3.13416C11.9006 3.04971 12.0994 3.0497 12.2683 3.13416L22 8" 
    stroke="#000" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  />
  <path 
    d="M20 11V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V11" 
    stroke="#000" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  />
</svg>
                
                <p className="font-semibold text-sm">Home</p>
            </div>
        </div> {/* <--- AJOUTÉ : Fermeture de l'item Home */}

        {/* Item Search */}
        <div
        onClick={() => { setIsSearchOpen(true); setShowProjectSelect(false); }}
        className="w-full h-[32px] rounded-[10px] p-[2px] flex justify-between items-center cursor-pointer hover:bg-[#f6f6f4] transition-colors">
            <div className="flex items-center gap-1">
                <Search className="h-4 w-4 text-black shrink-0" />
                <p className="font-semibold text-sm">Search</p>
            </div>



            <div className="flex flex-col h-full">
    <div className="mb-4 px-2">
        <div 
            onClick={() => setIsSearchOpen(true)}
            className="hidden items-center gap-2 p-2 rounded-md cursor-pointer transition-colors bg-[#f6f3ec] hover:bg-[#ebe8e0] text-gray-600"
        >
            <Search className="h-4 w-4 text-black shrink-0" />
            <p className="font-semibold text-sm text-black">Search</p>
        </div>
    </div>

    <div className="hidden overflow-y-auto px-2 space-y-6">
      {Object.entries(groupedProjects).map(([date, projectList]) => (
        <div key={date}>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 pl-2">
            
          </h3>
          
          <div className="space-y-1">
            {projectList.map((p) => (
              <div
                key={p.id}
                className={`group w-full p-2 text-sm hover:bg-[#F7F5F3] rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                  currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : ""
                }`}
                onClick={() => handleSelectProject(p.id)}
              >
                <div className="flex w-[90%] items-center gap-2 flex-1 overflow-hidden">
                    <div className="w-5 h-5 relative shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[8px] shrink-0">
                      <img src="/horizon-icon.svg" alt="Horizon" className="w-full h-full object-contain" />
                    </div>
                    <span className="truncate">{p.name}</span>
                </div>

                <button
                  onClick={(e) => handleDeleteProject(e, p.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-md transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
</div>
              
        
        </div>
    </div>
</div> 

      <Button
              variant="ghost"
              onClick={goToDashboard}
              className="ml-2 hover:bg-[rgba(55,50,47,0.90)] bg-[#1e52f1] text-[#fff] h-[32px] w-auto rounded-[10px] flex items-center justify-center p-1 px-2"
            >
                        <Plus size={18} />
             New chat
            </Button>
       <div className="w-full h-[40%] p-2  flex flex-col gap-1 mt-4">
        <div className="w-full flex items-center justify-between">

               <p className="font-semibold text-[16px] ">Projects</p>
                       <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsModalOpen(true)}
              className=" gap-[2px] hover:bg-[rgba(55,50,47,0.90)] text-[#888] underline-dashed h-[35px] w-auto rounded-[10px] hidden items-center justify-center p-1"
            >
              <Plus className="h-4 w-4" />
             Add new app
            </Button>
            
        
        </div>
           <div className="w-full h-[90%] overflow-y-auto flex flex-col gap-1">
  {Object.entries(groupedProjects).map(([date, groupProjects]) => (
    <div key={date} className="flex flex-col gap-1 mb-2">
      {/* SÉPARATEUR DE DATE */}
      <h3 className="sticky top-0 z-10  backdrop-blur-sm py-2 px-2 text-sm font-semibold text-[#111] tracking-wider">
        {date}
      </h3>

      {/* LISTE DES PROJETS DE CETTE DATE */}
      {groupProjects.map((p) => (
        <div
          key={p.id}
          className={`group w-full p-1 h-[32px] text-sm hover:bg-[#F7F5F3] rounded-[10px] flex items-center justify-between cursor-pointer transition-colors ${
            currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : ""
          }`}
          // LOGIQUE CLÉ : Click sur le conteneur pour charger
          onClick={async () => {
            if (currentProject) {
              await saveProject(); // On attend la sauvegarde IDB
            }
            loadProject(p.id);
            setShowProjectSelect(false);
          }}
        >
          {/* Partie Gauche : Icone + Nom */}
          <div className="flex w-full h-[32px] pl-1 mb-1 items-center gap-1 justify-start overflow-hidden">
            <div className="w-5 h-5 hidden shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[8px] shrink-0">
              <img
                src="/horizon-icon.svg"
                alt="Horizon"
                className="w-full h-full hidden object-contain"
              />
            </div>
            <span className="text-sm w-[19ch] truncate text-[#212121]">{p.name}</span>
          </div>

          {/* Partie Droite : Bouton Supprimer (Visible au survol uniquement) */}
          <button
            onClick={(e) => handleDeleteProject(e, p.id)}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-md transition-all"
            title="Delete project"
          >
            <Trash2 size={14} color="#000" />
          </button>
        </div>
      ))}
    </div>
  ))}
</div>
    
      </div>
    {projects.length === 0 && (
        <div className="p-3 text-sm text-[rgba(55,50,47,0.6)] text-center">
          No projects yet. Create one!
        </div>
      )}

        {/* ── Sidebar bottom: Token usage bar + API key ── */}
        <div className="mt-auto p-2 border-t border-[rgba(55,50,47,0.07)] flex flex-col gap-2">
          {/* Token usage bar */}
          <div className="px-1">
            <div className="hidden items-center justify-between mb-1">
              <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(55,50,47,0.4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tokens générés</span>
              <span style={{ fontSize: 10, fontFamily: "ui-monospace, monospace", color: "rgba(55,50,47,0.55)", fontVariantNumeric: "tabular-nums" }}>
                {sessionCandidateTokens > 0
                  ? sessionCandidateTokens.toLocaleString("fr-FR")
                  : dailyTokensUsed > 0
                    ? Math.round(dailyTokensUsed * 0.15).toLocaleString("fr-FR")
                    : "—"
                }
              </span>
            </div>
            {/* Progress bar shows daily total usage vs 10M limit */}
            <div className="w-full h-1.5 hidden rounded-full overflow-hidden" style={{ background: "rgba(55,50,47,0.08)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (dailyTokensUsed / DAILY_TOKEN_LIMIT) * 100))}%`,
                  background: dailyTokensUsed / DAILY_TOKEN_LIMIT > 0.8
                    ? "#ef4444"
                    : dailyTokensUsed / DAILY_TOKEN_LIMIT > 0.5
                    ? "#f97316"
                    : "#37322F",
                }}
              />
            </div>
            <div className="hidden items-center justify-between mt-0.5">
              <span style={{ fontSize: 9, color: "rgba(55,50,47,0.3)" }}>total: {dailyTokensUsed > 0 ? dailyTokensUsed.toLocaleString("fr-FR") : "0"}</span>
              <span style={{ fontSize: 9, color: "rgba(55,50,47,0.3)" }}>/ 10M aujourd'hui</span>
            </div>
            {dailyTokensUsed / DAILY_TOKEN_LIMIT > 0.8 && (
              <p className="hidden" style={{ fontSize: 9, color: "#ef4444", marginTop: 2 }}>Usage élevé — reset à minuit</p>
            )}
          </div>

          {/* API Key button */}
          <button
            onClick={() => setPendingApiKeyProvider(selectedModel.provider)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[rgba(55,50,47,0.06)] transition-colors"
            style={{ color: "rgba(55,50,47,0.55)" }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M9 1L13 5L5 13L1 13L1 9L9 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <circle cx="10.5" cy="3.5" r="0.5" fill="currentColor"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Manage API Keys</span>
          </button>
          {showApiKeyPanel && (
            <ApiKeyInlinePanelSidebar onClose={() => setShowApiKeyPanel(false)} />
          )}

          {/* Auth — avatar + sign out (no border-t) */}
          <div className="flex items-center justify-between gap-2 px-1 py-1.5">
            {currentUser ? (
              <>
                {/* Avatar circle */}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#37322F", color: "#fffcf6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, flexShrink: 0, letterSpacing: "0.02em",
                    }}
                  >
                    {(() => {
                      const name = currentUser.displayName || currentUser.email || "?";
                      const parts = name.trim().split(/\s+/);
                      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                      return name.slice(0, 2).toUpperCase();
                    })()}
                  </div>
                  <span style={{ fontSize: 11, color: "rgba(55,50,47,0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {currentUser.displayName || currentUser.email}
                  </span>
                </div>
                {/* Sign out icon */}
                <button
                  onClick={() => signOut(_fbAuth)}
                  title="Sign out"
                  className="p-1.5 rounded-lg hover:bg-[rgba(55,50,47,0.07)] transition-colors flex-shrink-0"
                  style={{ color: "rgba(55,50,47,0.45)" }}
                >
                  <LogOut size={13} />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-[rgba(55,50,47,0.06)] transition-colors"
                style={{ color: "rgba(55,50,47,0.55)" }}
              >
                <div style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px dashed rgba(55,50,47,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9 7H1M9 7L6 4M9 7L6 10M13 1V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ fontSize: 12, fontWeight: 500 }}>Sign in</span>
              </button>
            )}
          </div>
        </div>

       <div className="flex items-center">
            
            
          </div>
    </div>
  )}
        
        <div className={`flex items-center gap-1 justify-between px-6 h-12 flex-shrink-0 border-[rgba(55,50,47,0.12)] ${!currentProject ? "absolute top-0 left-0 w-full z-20" : ""}`}
            >





  

<svg
  width="300"
  height="240"
  viewBox="0 0 1200 240"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
    className="hidden"
>
  <rect width="100%" height="100%" fill="transparent" />

  {/* Text: Studi */}
  <text
    x="120"
    y="150"
    fontSize="100"
    fontFamily="Inter, Helvetica, Arial, sans-serif"
    fontWeight="400"
    fill="#000000"
    letterSpacing="-4"
  >
    
  </text>

  {/* Black tilted ellipse replacing the "o" */}
  <ellipse
    cx="440"
    cy="120"
    rx="58"
    ry="32"
    fill="#000000"
    transform="rotate(-18 430 120)"
  />

  {/* Text: code */}
  <text
    x="500"
    y="150"
    fontSize="100"
    fontFamily="Inter, Helvetica, Arial, sans-serif"
    fontWeight="400"
    fill="#000000"
    letterSpacing="-4"
  >
    Studio.
  </text>
</svg>
      


      <div className="flex items-center gap-1.5">
        {/* Sidebar toggle icon — opens the Home/Search/Groups panel */}
        <button
          onClick={() => setShowProjectSelect(!showProjectSelect)}
          className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-[rgba(55,50,47,0.07)] transition-colors flex-shrink-0"
          title="Open sidebar"
        >
          <Sidebar size={15} className="text-[rgba(55,50,47,0.65)]" />
        </button>

        {/* Logo ellipse */}
        <svg width="22" height="22" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
          <ellipse cx="15" cy="15" rx="12" ry="6" fill="#000000" transform="rotate(-18 15 15)" />
        </svg>

        {/* Project name — shown only when currentProject, non-clickable */}
        {currentProject && (
          <span className="text-sm font-medium text-[#37322F] max-w-[18ch] truncate leading-none">
            {currentProject.name}
          </span>
        )}
      </div>
          <div className="cursor-pointer">
            <svg className="h-[20px] w-[20px] fill-[#000]" width="24" height="24" viewBox="0 0 24 24" fill="#000" xmlns="http://www.w3.org/2000/svg">
<path d="M2 7.25C2 5.45507 3.45507 4 5.25 4H18.75C20.5449 4 22 5.45507 22 7.25V16.75C22 18.5449 20.5449 20 18.75 20H5.25C3.45508 20 2 18.5449 2 16.75V7.25ZM9.5 5.5V18.5H18.75C19.7165 18.5 20.5 17.7165 20.5 16.75V7.25C20.5 6.2835 19.7165 5.5 18.75 5.5H9.5ZM8 5.5H5.25C4.2835 5.5 3.5 6.2835 3.5 7.25V16.75C3.5 17.7165 4.2835 18.5 5.25 18.5H8V5.5Z" fill="#ffffff"/>
</svg>
          </div>
        </div>


  {!currentProject && (
    <div className="flex-1 h-screen overflow-hidden w-full flex flex-col items-center justify-center p-8 text-center">
      <h2 className="text-5xl font-semibold text-[#37322F]">Got an Idea ? Build it.</h2>
    </div>
  )}
          {currentProject && (
        <div className="flex-grow w-full overflow-y-auto relative">
          <ScrollArea className="w-full absolute  overflow-y-auto inset-0 p-6" viewportRef={chatScrollAreaRef}>
            <div className="space-y-6 pb-4">
              
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}




                

          
              
           

          
  {/* ═══════════════════════════════════════════════════════════ */}
{/* MODAL PLEIN ÉCRAN — prévisualisation HTML/CSS              */}
{/* ═══════════════════════════════════════════════════════════ */}
{previewModalHtml && (
  <div
    className="fixed inset-0 z-50 flex flex-col"
    style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
  >
    {/* Barre de contrôle du modal */}
    <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a28] border-b border-white/10 flex-shrink-0">
      <span className="text-xs font-semibold text-white/70 font-mono">
        👁 Prévisualisation HTML/CSS · Design de référence
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigator.clipboard.writeText(previewModalHtml)}
          className="text-xs px-3 py-1 rounded-md border border-white/20 bg-white/10 text-white/70 hover:bg-white/20 transition-all"
        >
          Copier HTML
        </button>
        <button
          onClick={() => setPreviewModalHtml(null)}
          className="text-xs px-3 py-1 rounded-md border border-white/20 bg-white/10 text-white/70 hover:bg-red-500/30 hover:border-red-400/40 transition-all"
        >
          ✕ Fermer
        </button>
      </div>
    </div>
    {/* Iframe plein écran */}
    <iframe
      srcDoc={previewModalHtml}
      className="flex-1 w-full border-none"
      style={{ background: "#fff" }}
      sandbox="allow-scripts allow-same-origin"
    />
  </div>
)}
                 

      
                
{/* Asterisk spinner animation */}
<style>{`
  @keyframes ast-bubble {
    0%, 65%, 100% { opacity: 1; transform: scale(1); }
    32% { opacity: 0; transform: scale(2.4); }
  }
  .ast-b { animation: ast-bubble 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .ast-b-0 { animation-delay: 0s; }
  .ast-b-1 { animation-delay: 0.267s; }
  .ast-b-2 { animation-delay: 0.533s; }
  .ast-b-3 { animation-delay: 0.8s; }
  .ast-b-4 { animation-delay: 1.067s; }
  .ast-b-5 { animation-delay: 1.333s; }
`}</style>

{messages.map((msg, index) => {
  const artifact = msg.artifactData;
  const isExpanded = expandedMessageIndex === index;
  const isLastMsg = index === messages.length - 1;
  // isStreamingThis est lié à isAiStreaming (sendChat uniquement), pas à loading (runAction aussi)
  const isStreamingThis = isAiStreaming && isLastMsg && msg.role === "assistant";

  // ── Détection des anciens messages raw [ERROR] 429 dans msg.content ──────
  const isRaw429 = msg.role === "assistant" && !msg.quotaExceeded && (
    msg.content.includes('"code":429') ||
    msg.content.includes('"code": 429') ||
    msg.content.includes('RESOURCE_EXHAUSTED') ||
    (msg.content.includes('[ERROR]') && msg.content.includes('429'))
  );
  // effectiveContent : masque le contenu brut si c'est un raw 429
  const effectiveContent = isRaw429 ? '' : msg.content;
  // effectiveQuotaExceeded : active la carte quota pour les anciens messages raw
  const effectiveQuota = msg.quotaExceeded ?? (isRaw429 ? { message: "API quota reached", resetHint: "Try again in 24h or reload your API key." } : null);

  const hasPhases = msg.phases && msg.phases.length > 0;
  const hasPresenter = !!(msg.presenterIntro || msg.presenterOutro);

  // Date separator logic — show ONCE per day group, only when date changes from prev message
  const getDateLabel = (ts: number) => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const dateStr = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    if (d.toDateString() === today.toDateString()) return `Today ${dateStr} at ${timeStr}`;
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${dateStr} at ${timeStr}`;
    return dateStr;
  };
  // Find the previous message that has a timestamp (skip system messages)
  const prevMsgWithTs = messages.slice(0, index).reverse().find(m => m.timestamp);
  const showDateSeparator = !!msg.timestamp && (
    !prevMsgWithTs?.timestamp ||
    new Date(msg.timestamp).toDateString() !== new Date(prevMsgWithTs.timestamp).toDateString()
  );
  const dateLabel = showDateSeparator && msg.timestamp ? getDateLabel(msg.timestamp) : null;

  return (
    <React.Fragment key={index}>
      {/* Date separator */}
      {dateLabel && (
        <div className="flex items-center gap-3 py-2 my-1">
          <div className="flex-1 h-px bg-[rgba(55,50,47,0.08)]" />
          <span style={{ fontSize: 11, color: "rgba(55,50,47,0.35)", fontWeight: 500, letterSpacing: "0.03em" }}>{dateLabel}</span>
          <div className="flex-1 h-px bg-[rgba(55,50,47,0.08)]" />
        </div>
      )}

    <div
      className={`flex flex-col gap-3 max-w-full ${msg.role === "user" ? "items-end" : "items-start"}`}
    >
      {/* ── "Thought for Xs / Xm Ys" — timer réel, masqué si < 3s (CHAT_ONLY rapide) ── */}
      {msg.role === "assistant" && msg.thinkDurationMs !== undefined && msg.thinkDurationMs > 3000 && (
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 4v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 12, color: "rgba(55,50,47,0.4)", fontStyle: "italic" }}>
            {(() => {
              const secs = Math.round(msg.thinkDurationMs / 1000);
              const fmt = secs >= 60
                ? `${Math.floor(secs / 60)}m ${secs % 60}s`
                : `${secs}s`;
              // Pendant le stream OU pendant le chargement des vibes → "Thinking for…"
              return (isStreamingThis || msg.requestingVibes)
                ? `Thinking for ${fmt}…`
                : `Thought for ${fmt}`;
            })()}
          </span>
        </div>
      )}

      {/* ── Indicateurs d'état empilés : vibes + building (restent visibles ensemble) ── */}
      {msg.role === "assistant" && (msg.requestingVibes || (isStreamingThis && msg.agentWorkingOn)) && (
        <div className="flex flex-col gap-1 mt-1">
          {/* Selecting design references — visible dès request_vibes, reste tant que requestingVibes */}
          {msg.requestingVibes && (
            <div className="flex items-center gap-2">
              <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" style={{ color: "rgba(55,50,47,0.4)" }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity=".3"/>
                <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 12, color: "rgba(55,50,47,0.45)", fontStyle: "italic" }}>
                Elaborating app design....
              </span>
            </div>
          )}
          {/* Building phase — apparaît pendant le 2e sendChat, en dessous de Selecting */}
          {isStreamingThis && msg.agentWorkingOn && (
            <div className="flex items-center gap-2">
              <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" style={{ color: "rgba(55,50,47,0.35)" }}>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity=".25"/>
                <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 11, color: "rgba(55,50,47,0.38)", fontStyle: "italic" }}>
                {msg.agentWorkingOn}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Retry 503 — loader dédié, n'écrase pas le contenu du message ── */}
      {msg.role === "assistant" && msg.streamRetrying && (
        <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg" style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.15)" }}>
          <svg className="animate-spin w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" style={{ color: "#6366f1" }}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity=".3"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div className="flex flex-col">
            <span style={{ fontSize: 12, color: "#6366f1", fontWeight: 600 }}>
              Model overloaded — retry {msg.streamRetrying.attempt}/{msg.streamRetrying.max}
            </span>
            <span style={{ fontSize: 11, color: "rgba(99,102,241,0.7)" }}>
              New retry in {msg.streamRetrying.delaySecs}s…
            </span>
          </div>
        </div>
      )}

      {/* ── Conteneur du message */}
      <div
        className={`p-2 rounded-xl w-full max-w-full relative overflow-hidden ${
          msg.role === "user"
            ? "bg-[#f6f4ec] text-[#212121] self-end border-[#37322F]"
            : "bg-none text-[#37322F] self-start"
        }`}
      >{(() => {
          // Strip les marqueurs internes qui ne doivent jamais être visibles
          const rawTextContent = effectiveContent
            .replace(/\[PRESENTER:INTRO\][\s\S]*?\[\/PRESENTER:INTRO\]\n?/g, "")
            .replace(/\[PRESENTER:OUTRO\][\s\S]*?\[\/PRESENTER:OUTRO\]\n?/g, "")
            .replace(/\[PRESENTER:INTRO\][\s\S]*/g, "")   // balise non fermée (stream en cours)
            .replace(/\[IMAGE_IS_DESIGN_REF\]\n?/g, "")
            .replace(/\[DESIGN:(?:READY|SKIP|RESTORED|THINKING)[^\]]*\]\n?/g, "")
            .replace(/\[PHASE:0\/DESIGN\]\n?/g, "");
          const isFileArtifact = artifact && (artifact.type === 'files');
          const isUrlArtifact = artifact && (artifact.type === 'url');

          // ── RENDU UTILISATEUR ──────────────────────────────────────────────
          if (msg.role === "user") {
            const MAX_HEIGHT = 150;
            const isLongMessage = msg.content.length > 10000 || rawTextContent.split('\n').length > 20;

            // Détection message d'erreur automatique build/install
            const buildErrMatch = msg.content.match(/\[BUILD_ERROR:([^\]]+)\]\n([\s\S]*?)\n\[\/BUILD_ERROR\]/);
            if (buildErrMatch) {
              const errLabel = buildErrMatch[1]; // "Build" ou "Install"
              const errStderr = buildErrMatch[2].trim();
              // Extraire le message humain après [/BUILD_ERROR]
              const humanMsg = msg.content.replace(/\[BUILD_ERROR:[^\]]+\][\s\S]*?\[\/BUILD_ERROR\]\n*/g, '').trim();
              return (
                <div key="user-build-error" className="w-full rounded-xl overflow-hidden border"
                  style={{ borderColor: 'rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.04)' }}>
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.07)' }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: '#ef4444', flexShrink: 0 }}>
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M8 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
                    </svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', letterSpacing: '0.02em' }}>
                      {errLabel} Error — auto-detected
                    </span>
                  </div>
                  {/* Stderr */}
                  <pre style={{ fontSize: 11, color: 'rgba(239,68,68,0.85)', fontFamily: 'ui-monospace, monospace', padding: '8px 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto', margin: 0 }}>
                    {errStderr.slice(0, 800)}{errStderr.length > 800 ? '…' : ''}
                  </pre>
                  {humanMsg && (
                    <div style={{ fontSize: 12, color: 'rgba(55,50,47,0.6)', padding: '6px 12px', borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                      {humanMsg}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key="user-content-wrapper" className="relative w-full">
                <pre
                  className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed max-w-full overflow-hidden"
                  style={{ maxHeight: isExpanded ? 'none' : `${MAX_HEIGHT}px` }}
                >
                  {msg.content}
                </pre>
                {!isExpanded && isLongMessage && (
                  <div
                    className="absolute inset-x-0 bottom-0 h-[60px] flex flex-col justify-end items-center p-2 rounded-b-xl cursor-pointer z-10"
                    style={{ background: 'linear-gradient(to top, rgba(55,50,47,1) 50%, rgba(55,50,47,0))' }}
                    onClick={() => setExpandedMessageIndex(index)}
                  >
                    <button className="text-white text-xs font-semibold px-2 py-1 rounded-full border border-white/50 bg-[#37322F]/80">
                      <svg className="h-3 w-3 inline-block mr-1 rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 9l-7 7-7-7" /></svg> Expand
                    </button>
                  </div>
                )}
                {isExpanded && isLongMessage && (
                  <div className="flex justify-center mt-2">
                    <button onClick={() => setExpandedMessageIndex(null)} className="text-white text-xs font-semibold px-2 py-1 rounded-full border border-white/50 bg-[#37322F]/80">
                      <svg className="h-3 w-3 inline-block mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 9l-7 7-7-7" /></svg> Collapse
                    </button>
                  </div>
                )}
              </div>
            );
          }

          // ── RENDU ASSISTANT ────────────────────────────────────────────────
          const displayElements: React.ReactNode[] = [];

          // 1. HTML PREVIEW
          if (msg.htmlCode && msg.role === "assistant") {
            displayElements.push(
              <div key="html-preview" className="w-full mt-1 mb-2 rounded-xl overflow-hidden border border-[rgba(55,50,47,0.12)] bg-white">
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#f6f4ec] border-b border-[rgba(55,50,47,0.08)]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                    <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                    <span className="ml-2 text-[10px] font-semibold text-[#37322F]/50 font-mono select-none">
                      Design preview · HTML/CSS référence
                    </span>
                    {isStreamingThis && (
                      <span className="ml-1 text-[9px] font-bold text-[#6366f1] animate-pulse">● building...</span>
                    )}
                  </div>
                  <button
                    onClick={() => setPreviewModalHtml(msg.htmlCode!)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-[#37322F]/60 hover:text-[#37322F] px-2 py-0.5 rounded-md hover:bg-[rgba(55,50,47,0.08)] transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    Plein écran
                  </button>
                </div>
                <iframe
                  srcDoc={msg.htmlCode}
                  className="w-full border-none"
                  style={{ height: "320px", background: "#fff" }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            );
          }

          // 2. TEXTE principal de l'agent
          if (rawTextContent && rawTextContent.trim().length > 0) {
            displayElements.push(
              <pre key="text" className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed mb-1 max-w-full overflow-x-hidden">
                {rawTextContent}
              </pre>
            );
          }

          // ── LISTE PLATE LOVABLE — fichiers en cours / terminés ────────────
          {
            const fileBadges   = msg.fileBadgesCompleted ?? [];
            // writingFile : pendant le stream on utilise liveFile.path (toujours à jour)
            // après le stream : msg.currentlyWritingFile (dernier fichier écrit)
            const writingFile  = isStreamingThis
              ? (liveFile?.path ?? null)
              : (msg.currentlyWritingFile ?? null);
            // Combine create_file + edit_file dans la liste affichée
            const allFiles     = (artifact?.parsedList ?? []) as { path: string; type?: string }[];
            const workingLabel = msg.agentWorkingOn;

            // Extraire les edit_file depuis le rawJson (artifact) et le contenu
            const editedDuringStream: string[] = [];
            if (isStreamingThis) {
              // Chercher dans artifactData.rawJson (texte brut complet avec tous les XML)
              const rawForEdit = artifact?.rawJson ?? "";
              const editRx = /<edit_file\s+path="([^"]+)"/g;
              let em;
              while ((em = editRx.exec(rawForEdit)) !== null) {
                if (!editedDuringStream.includes(em[1])) editedDuringStream.push(em[1]);
              }
              // Chercher aussi dans les fileBadges (create_file complétés)
            }

            // 3. PENDANT LE STREAM — fichier en cours + fichiers terminés (create + edit)
            if (isStreamingThis && (fileBadges.length > 0 || writingFile || editedDuringStream.length > 0)) {
              // Fichiers terminés = fileBadges (create_file fermés) + edit_file qui ne sont PAS le writingFile courant
              const completedEdits = editedDuringStream.filter(fp => fp !== writingFile);
              const allCompleted = [...new Set([...fileBadges, ...completedEdits])];
              displayElements.push(
                <div key="file-list-streaming" className="flex flex-col gap-0 mt-2">
                  {/* Fichiers terminés */}
                  {allCompleted.map((fp, i) => {
                    const fname = fp.split('/').pop() ?? fp;
                    const isCreate = fileBadges.includes(fp);
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5 px-0.5">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ opacity: 0.35, color: "#37322F" }}>
                          <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 12, color: "rgba(55,50,47,0.45)", fontWeight: 500 }}>
                          {isCreate ? "Created" : "Edited"}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: "rgba(55,50,47,0.65)", background: "rgba(55,50,47,0.07)", padding: "1px 7px", borderRadius: 5, fontWeight: 600 }}>{fname}</span>
                      </div>
                    );
                  })}
                  {/* Fichier en cours d'écriture */}
                  {writingFile && (() => {
                    const fname = writingFile.split('/').pop() ?? writingFile;
                    const isEdit = editedDuringStream.includes(writingFile);
                    return (
                      <div className="flex items-center gap-2 py-0.5 px-0.5">
                        <svg className="animate-spin shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.12)" strokeWidth="1.5"/>
                          <path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(55,50,47,0.65)" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                        <span style={{ fontSize: 12, color: "rgba(55,50,47,0.55)", fontWeight: 500 }}>
                          {isEdit ? "Editing" : "Writing"}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: "#37322F", background: "rgba(55,50,47,0.09)", padding: "1px 7px", borderRadius: 5, fontWeight: 700 }}>{fname}</span>
                        {workingLabel && (
                          <span style={{ fontSize: 11, color: "rgba(55,50,47,0.3)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{workingLabel}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            }

            // 4. APRÈS LE STREAM — liste plate tous les fichiers (style Lovable Image 3)
            if (!isStreamingThis && allFiles.length > 0) {
              displayElements.push(
                <div key="file-list-done" className="flex flex-col gap-0 mt-2 mb-1">
                  {allFiles.map((item, i) => {
                    const fname = item.path.split('/').pop() ?? item.path;
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5 px-0.5">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ opacity: 0.35, color: "#37322F" }}>
                          <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 12, color: "rgba(55,50,47,0.45)", fontWeight: 500 }}>Edited</span>
                        <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: "rgba(55,50,47,0.65)", background: "rgba(55,50,47,0.07)", padding: "1px 7px", borderRadius: 5, fontWeight: 600 }}>{fname}</span>
                      </div>
                    );
                  })}
                </div>
              );
            }
          }

          // 6b. ENV VARS PANEL — variables d'environnement requises
          if (msg.envVars && msg.envVars.length > 0) {
            displayElements.push(
              <div key="env-vars-panel" className="mt-3 w-full rounded-xl overflow-hidden" style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.04)' }}>
                <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'rgba(99,102,241,0.12)', background: 'rgba(99,102,241,0.06)' }}>
                  <svg className="w-3.5 h-3.5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <span className="text-xs font-bold text-indigo-600">Variables d'environnement requises</span>
                  <span className="text-[10px] text-indigo-400 ml-auto">À ajouter dans .env.local</span>
                </div>
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  {msg.envVars.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <code className="text-xs font-mono font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{v}</code>
                      <span className="text-[10px] text-[#37322F]/40">=</span>
                      <span className="text-[10px] text-[#37322F]/40 italic">votre_valeur_ici</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          // 7. URL ARTIFACT
          if (isUrlArtifact) {
            const artifactClasses = (rawTextContent && rawTextContent.trim().length > 0) ? "mt-3 pt-3 border-t border-[rgba(55,50,47,0.1)]" : "pt-0";
            displayElements.push(
              <div key="url-artifact" className={`p-3 bg-[#F7F5F3] border border-[rgba(55,50,47,0.1)] rounded-lg w-full ${artifactClasses}`}>
                <p className="text-sm font-semibold mb-1 flex items-center gap-1 text-[#37322F]">Designing process</p>
                <div className="h-[8px] w-full rounded-[8px] bg-[#E3DFDB]"></div>
              </div>
            );
          }

          // 8. COPY BLOCKS — artifacts copiables générés par l'agent
          if (msg.copyBlocks && msg.copyBlocks.length > 0) {
            msg.copyBlocks.forEach((block, bi) => {
              displayElements.push(
                <CopyBlockCard key={`copy-block-${bi}`} label={block.label} content={block.content} />
              );
            });
          }

          // 9. BUILD ERROR — erreur build/install transmise à l'IA, avec dropdown
          if (msg.buildError) {
            displayElements.push(
              <BuildErrorCard key="build-error" action={msg.buildError.action} stderr={msg.buildError.stderr} />
            );
          }

          if (displayElements.length > 0) return displayElements;
          return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed max-w-full">{rawTextContent}</pre>;
        })()}
      </div>

      {/* Fichiers uploadés & Mentions */}
      {msg.role === "user" && msg.images && msg.images.length > 0 && (
        <div className="flex gap-1 mt-1">
          {msg.images.map((base64Src, imgIndex) => (
            <div key={imgIndex} className="w-[45px] h-[45px] rounded-[8px] overflow-hidden" title="Image utilisateur">
              <img src={base64Src} alt="User input" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
      {msg.role === "user" && msg.externalFiles && msg.externalFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {msg.externalFiles.map((file, fileIndex) => (
            <div key={fileIndex} className="flex items-center h-[24px] border border-black rounded-[8px] bg-[#F7F5F3] px-2 text-sm max-w-xs truncate">
              {file.fileName}
            </div>
          ))}
        </div>
      )}
      {msg.role === "user" && msg.mentionedFiles && msg.mentionedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {msg.mentionedFiles.map((filePath, mentionIndex) => (
            <div key={mentionIndex} className="flex items-center h-[24px] border border-black rounded-[8px] bg-[#E3F5E3] px-2 text-sm max-w-xs truncate">
              @{filePath}
            </div>
          ))}
        </div>
      )}

      {/* Quota exceeded — affiché aussi pour les anciens messages raw [ERROR] 429 */}
      {effectiveQuota && (() => {
        const resetAt = quotaResetAt ?? (Date.now() + 24 * 60 * 60 * 1000);
        const totalMs = 24 * 60 * 60 * 1000;
        const elapsed = Date.now() - (resetAt - totalMs);
        const pct = Math.min(100, Math.max(0, (elapsed / totalMs) * 100));
        const remaining = Math.max(0, resetAt - Date.now());
        const hh = Math.floor(remaining / 3600000);
        const mm = Math.floor((remaining % 3600000) / 60000);
        const isAnthropicModel = selectedModel.provider === 'anthropic';
        return (
          <div className="w-full mt-2 rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(55,50,47,0.10)", background: "rgba(55,50,47,0.07)" }}>
            <div className="flex items-start gap-3 px-4 py-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-0.5" style={{ color: "#37322F", opacity: 0.5 }}>
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M8 4.5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <span style={{ fontSize: 13, fontWeight: 600, color: "#37322F" }}>
                  {isAnthropicModel ? "Anthropic API quota reached" : "Gemini API quota reached"}
                </span>
                <span style={{ fontSize: 12, color: "rgba(55,50,47,0.55)" }}>
                  You've used all available tokens. Try again in {hh}h {mm}m or reload your API key.{" "}
                  <button
                    onClick={() => {
                      setQuotaResetAt(null);
                      try { localStorage.removeItem('quota_reset_at'); } catch {}
                    }}
                    style={{ color: "rgba(55,50,47,0.55)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                  >
                    retry now
                  </button>
                </span>
                {/* Progress bar 24h */}
                <div className="mt-1.5 w-full h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(55,50,47,0.10)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: "rgba(55,50,47,0.35)" }}
                  />
                </div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 10, color: "rgba(55,50,47,0.35)" }}>Now</span>
                  <span style={{ fontSize: 10, color: "rgba(55,50,47,0.35)" }}>Reset in {hh}h {mm}m</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
    </React.Fragment>
  );
})}
            
          
                
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}                
                            
            </div>
          </ScrollArea>
        </div>



)}



<div className={`p-1 h-[120px] md:h-[150px] border-[#f6f3ec] flex-shrink-0 ${!currentProject ? "" : ""}`}
    >
  {analysisStatus && <p className="text-sm text-[rgba(55,50,47,0.60)] mb-3 animate-pulse">{analysisStatus}</p>}
  <div className="relative p-2 flex flex-col h-[150px] md:h-[150px]">
    
    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}
    <div className="flex flex-col h-[20%] rounded-t-[25px] bg-[#f7f4ed] w-full">
        
     <div className="w-full h-full flex items-center justify-center">
         {(uploadedImages.length > 0 || uploadedFiles.length > 0 || mentionedFiles.length > 0) && (
    <div className="flex flex-wrap gap-1.5 p-1 border-t border-gray-200 mt-1">
        {/* Images uploadées avec X toujours visible */}
        {uploadedImages.map((src, index) => (
            <div key={`img-${index}`} className="relative flex-shrink-0" style={{ width: 44, height: 44 }}>
                <img 
                    src={src} 
                    alt="Image uploadée" 
                    className="w-full h-full object-cover rounded-[10px]"
                />
                <button
                    onClick={() => setUploadedImages(prev => prev.filter((_, i) => i !== index))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#37322F] rounded-full flex items-center justify-center shadow-sm hover:bg-red-500 transition-colors"
                    title="Supprimer"
                >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1L7 7M7 1L1 7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
            </div>
        ))}
        {/* Fichiers Externes */}
        {uploadedFiles.map((file, index) => (
            <div key={`file-${index}`} className="flex items-center gap-1.5 h-[26px] border border-[rgba(55,50,47,0.15)] rounded-[8px] bg-[rgba(55,50,47,0.06)] px-2 text-xs font-medium max-w-[160px] truncate" style={{ color: "#37322F" }}>
                <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><rect x="0.5" y="0.5" width="7" height="11" rx="1.5" stroke="rgba(55,50,47,0.4)"/><path d="M2 4h4M2 6.5h3" stroke="rgba(55,50,47,0.4)" strokeLinecap="round"/></svg>
                <span className="truncate">{file.fileName}</span>
                <button 
                    onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== index))}
                    className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-[rgba(55,50,47,0.12)] hover:bg-red-100 flex-shrink-0 transition-colors"
                >
                    <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1L6 6M6 1L1 6" stroke="rgba(55,50,47,0.7)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                </button>
            </div>
        ))}
        {uploadedImages.length > 0 && (
    <div className="flex flex-wrap gap-2 p-1 mt-1">
        
    </div>
)}
        {/* Fichiers Mentionnés (Nouveau) */}
        {mentionedFiles.map((filePath, index) => (
            <div key={`mention-${index}`} className="flex items-center gap-1.5 h-[24px] border border-black rounded-[8px] bg-[#E3F5E3] px-2 text-sm max-w-xs truncate">
                @{filePath}
                <button 
                    onClick={() => handleRemoveMention(filePath)}
                    className="text-xs text-red-600 font-bold"
                >
                    ×
                </button>
            </div>
        ))}
    </div>
)}
           
        <div className="w-full p-2 pl-1 rounded-t-[25px]  h-full p-[2px] flex items-center border-t-[1.5px] border-l-[1.5px] border-r-[1.5px] border-[#f3f3f1] gap-1">
        
        {/* BOUTON/INPUT CLONE WEBSITE */}
        {!isCloning ? (
            
            <button 
                onClick={() => setIsCloning(true)}
                className="w-auto p-1 h-[25px] border border-black rounded-[10px] hidden items-center gap-1 justify-center hover:bg-white transition-colors duration-150"
                disabled={loading}
            >
              <svg className="h-[16px] w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
              <p className="text-sm">Clone website</p>
            </button>
        ) : (
            // 2. Affichage de l'input full-width pour l'URL (état de clonage actif)
            <div className="flex items-center h-full w-full">
                {/* Icône SVG (conservée) */}
                <svg className="h-[16px] w-[16px] flex-shrink-0 mx-1" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
                

                

<input
    type="url"
    placeholder="Enter website URL to clone (e.g., example.com) and press Enter"
    
    className="h-full w-full border-none outline-none bg-transparent text-sm"
    
    
    value={cloneUrl}
    onChange={(e) => setCloneUrl(e.target.value)}
    
    
    onKeyDown={(e) => {
        
        if (e.key === "Enter" && cloneUrl) {
            e.preventDefault() 
            
            
            runAutomatedAnalysis(
                cloneUrl, 
                `User wants to clone website: ${cloneUrl}`, 
                true 
            ) 
        } else if (e.key === "Escape") {
            
            setIsCloning(false) 
            setCloneUrl("")
        }
    }}
    
    
    disabled={loading} 
    autoFocus
/>
                  


              

  
            </div>
        )}
        
        {/* BOUTON CONNECT DATABASE (Masqué si isCloning est vrai) */}
        

        
{/* BOUTON CONNECT DATABASE (Masqué si isCloning est vrai) */}
{!isCloning && (
    <div className="hidden">
    <DatabaseConnector
        dbConfig={dbConfig}
        setDbConfig={setDbConfig}
        sendChat={sendChat}
    />
    </div>
)}
          
        
      </div>
     </div>
    </div>
    
    {/* ZONE DE SAISIE DE CHAT */}
    <div className="w-full bg-[#f7f4ed] min-h-[80px] flex-1 border-b-none border-l-[1.5px] border-r-[1.5px] border-[#f3f3f1] relative">

  {/* Hint quota — s'affiche par-dessus le textarea si quota actif */}
  {quotaResetAt && quotaResetAt > Date.now() && (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl pointer-events-none">
      <span style={{ fontSize: 11, color: "rgba(55,50,47,0.45)", fontStyle: "italic", background: "#f7f4ed", padding: "2px 8px", borderRadius: 8, border: "1px solid rgba(55,50,47,0.10)", display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}>
        <span>Retry in {Math.ceil((quotaResetAt - Date.now()) / 3600000)}h or reload your API key</span>
        <button
          onClick={() => {
            setQuotaResetAt(null);
            try { localStorage.removeItem('quota_reset_at'); } catch {}
          }}
          style={{ color: "rgba(55,50,47,0.55)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 11, padding: 0 }}
        >
          retry now
        </button>
      </span>
    </div>
  )}

  <textarea
  placeholder={currentProject ? "Describe what to build..." : "Ask to Studio something..."}
  className="h-full w-full pl-3 text-[18px] font-semibold border-none outline-none resize-none bg-none"
  style={{ opacity: quotaResetAt && quotaResetAt > Date.now() ? 0.3 : 1 }}
  value={chatInput}
  onChange={async (e) => {
  setChatInput(e.target.value);
  if (e.target.value.length === 1 && chatInput.length === 0) {
    const key = await getApiKeyFromIDB(selectedModel.provider);
    if (!key) setPendingApiKeyProvider(selectedModel.provider);
  }
}}
  onKeyDown={(e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSmartSend()
    }
  }}
  disabled={isAiStreaming || isCloning || (!!quotaResetAt && quotaResetAt > Date.now())}
  onFocus={() => { if (!currentUser) setShowAuthModal(true); }}
/>
        

    </div>
    
    {/* PIED DE PAGE DE CHAT */}
    <div className="w-full p-4 bg-[#f7f4ed] rounded-b-[25px] h-[20%] border-b-[1.5px] border-l-[1.5px] border-r-[1.5px] border-t-none border-[#f3f3f1] p-[2px] flex items-center justify-between gap-1">
        

{/* 1. BOUTON PLUS (UPLOAD FICHIERS ET SCREENSHOT) */}
<div className="mb-1 pl-1 p-2 flex items-center gap-2">
    <div 
        className="w-[22px] cursor-pointer left-[3px] relative bottom-[4px] p-1 h-[22px] border border-black rounded-[8px] hidden items-center justify-center cursor-pointer hover:bg-gray-100"
        onClick={() => setIsPlusDropdownOpen(!isPlusDropdownOpen)}
    >
        <Plus size={16} />
    </div>


  
  <label className="w-[30px] relative p-1 h-[30px] border border-[rgba(55,50,47,0.12)] rounded-full hidden items-center justify-center cursor-pointer hover:bg-gray-100">
                <Plus size={16} />
                <input 
                    type="file" 
                    accept="*/*"
                    multiple 
                    onChange={handleFileUpload} 
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                />
            </label>
  <label className="flex pr-1 items-center gap-1  cursor-pointer">
    <div className="h-[30px] left-[3px] relative bottom-[4px] bg-white border-[1.5px] border-[#f3f3f1] w-[30px] rounded-full justify-center  flex text-[17px] items-center gap-[3px]">
        {/* L'icône du bouton d'upload (utiliser un simple SVG ou une icône) */}
        <ImagePlus size={18} />
      
    </div>
    <input 
        type="file" 
        accept="image/*" 
        multiple 
        onChange={handleImageUpload} 
        className="hidden" // Cache l'input par défaut
    />
</label>

    {isPlusDropdownOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 border rounded shadow-lg bg-white w-48">
            {/* Bouton Upload File */}
            <label className="w-full text-left py-1.5 px-2 hover:bg-gray-100 flex items-center gap-2 rounded cursor-pointer text-sm">
                Upload File
                <input 
                    type="file" 
                    accept="*/*" // Tout type sauf ceux filtrés dans handleFileUpload
                    multiple 
                    onChange={handleFileUpload} 
                    className="hidden" 
                />
            </label>
            {/* Bouton Screenshot */}
            <button 
                className="w-full text-left py-1.5 px-2 hover:bg-gray-100 flex items-center gap-2 rounded text-sm mt-1"
                onClick={handleScreenshot}
            >
                Screenshot Tab
            </button>
        </div>
    )}
</div>

{/* 2. BOUTON MENTION */}
<div className="relative p-2">

    {isMentionDropdownOpen && (
        <div className="absolute bottom-full mb-2 left-0 z-50 p-2 border rounded shadow-lg bg-white w-60 max-h-60 overflow-y-auto">
            <p className="text-xs font-semibold mb-1 border-b pb-1">Fichiers du Projet ({currentProject?.files.length || 0})</p>
            {(currentProject?.files || []).map((file) => (
                <button
                    key={file.filePath}
                    className={`w-full text-left py-1 px-2 flex items-center gap-2 rounded text-xs transition-all ${
                        mentionedFiles.includes(file.filePath) ? 'bg-[rgba(55,50,47,0.12)] text-black font-medium' : 'hover:bg-gray-100'
                    }`}
                    onClick={() => handleMentionFile(file.filePath)}
                >
                    {mentionedFiles.includes(file.filePath) ? '✅' : '☐'} {file.filePath}
                </button>
            ))}
            {(currentProject?.files.length === 0 || !currentProject) && (
                <p className="text-xs text-gray-500 italic">Aucun fichier dans le projet.</p>
            )}
        </div>
    )}
</div>


{/* 🛑 NOUVEAU BLOC : Affichage des Fichiers Uploadés et Mentionnés */}


      
      
    
      <div className="flex pr-1 p-2 items-center gap-1 mb-1">
              


{/* ZONE D'AFFICHAGE DES IMAGES UPLOADEES */}


<button className="h-[24px] w-auto bg-transparent px-3 hidden items-center gap-[2px] text-[17px] text-black">
         <svg className="h-[20px] w-[20px]" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#37322F"><path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z"/></svg>
         <p>Plan</p>
</button>


{/* À placer juste au-dessus de ton <textarea> ou de ton input de chat */}
<div className="flex items-center justify-between mb-2 px-1">
  <div className="flex items-center gap-2">
    <ModelSelector selected={selectedModel} onChange={(m) => { setSelectedModel(m); selectedModelRef.current = m; }} />
    <button
      onClick={() => {
        if (!isSaaSMode) {
          // Si on l'active, on prévient l'utilisateur
          addLog("🛠 Mode Architecte SaaS activé.");
          startBuildSaasMode(chatInput);
        } else {
          setIsSaaSMode(false);
          addLog("⏹ Mode SaaS interrompu.");
        }
      }}
      disabled={loading}
      className={`
        hidden items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200
        ${isSaaSMode 
          ? 'bg-[#37322F] text-[#f6f4ec] border-[#37322F] shadow-md' 
          : 'bg-white/50 text-[#37322F]/60 border-[rgba(55,50,47,0.1)] hover:border-[#37322F]/40'}
      `}
    >
      {/* Petit indicateur d'état */}
      <span className="relative flex h-2 w-2">
        {isSaaSMode && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${isSaaSMode ? 'bg-orange-500' : 'bg-gray-300'}`}></span>
      </span>
      
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {isSaaSMode ? 'SaaS Build en cours...' : 'Activer Mode SaaS'}
      </span>
    </button>
  </div>

  {/* Affichage discret du nombre de fichiers si un projet est chargé */}
  {currentProject && (
    <span className="text-[10px] hidden text-[#37322F]/40 font-medium">
      Project: {currentProject.name} ({currentProject.files.length} files)
    </span>
  )}
</div>
                                                                                                                                                                                                                                                                                                                                                                                                                                                                      
        <Button
      className=" bg-[#37322F] relative bottom-[4px] right-[3px] hover:bg-[rgba(55,50,47,0.90)] text-white h-[30px] w-[30px] rounded-full flex items-center justify-center p-1"
      onClick={() => {
        if (isAiStreaming) {
          // Cancel AI stream only — does NOT touch runSequence (loading)
          const reader = streamReaderRef.current;
          streamReaderRef.current = null;
          if (reader) { try { reader.cancel(); } catch {} }
          isAiStreamingRef.current = false;
          setIsAiStreaming(false);
          isStreamingRef.current = false;
          // setLoading stays untouched so runSequence can finish if active
        } else {
          handleSmartSend();
        }
      }}
      disabled={!isAiStreaming && !chatInput && uploadedImages.length === 0 && uploadedFiles.length === 0}
    >
      {isAiStreaming ? (
        /* Stop square icon */
        <div style={{ width: 10, height: 10, background: "white", borderRadius: 2 }} />
      ) : (
        <ArrowUp size={18} />
      )}
</Button>

{/* ── Audio recording button ── */}
<button
  title={isRecording ? "Stop recording" : "Record voice"}
  onClick={async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Prefer Whisper-compatible codec
        const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
          .find(t => MediaRecorder.isTypeSupported(t)) ?? '';
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        audioChunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          // Use Web Speech API for transcription (browser-native, no API key needed)
          const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.lang = 'fr-FR,en-US';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            recognition.onresult = (event: any) => {
              const transcript = event.results[0][0].transcript;
              setChatInput(prev => prev ? prev + ' ' + transcript : transcript);
            };
            recognition.onerror = () => {};
            recognition.start();
            // Feed the audio blob as a source (fallback: just trigger recognition on next word)
          } else {
            // If no SpeechRecognition, notify user
            addLog("⚠️ Speech recognition not supported in this browser.");
          }
        };
        mr.start();
        mediaRecorderRef.current = mr;
        setIsRecording(true);

        // Also run SpeechRecognition in parallel for real-time transcription
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = navigator.language || 'en-US';
          recognition.onresult = (event: any) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
            }
            if (finalTranscript) setChatInput(prev => prev ? prev + ' ' + finalTranscript : finalTranscript);
          };
          recognition.onerror = () => { setIsRecording(false); mr.stop(); };
          recognition.onend = () => { if (isRecording) recognition.start(); };
          (mediaRecorderRef.current as any)._recognition = recognition;
          recognition.start();
        }
      } catch {
        addLog("⚠️ Microphone access denied.");
      }
    }
  }}
  className="flex-shrink-0"
  style={{
    position: 'relative', bottom: 4, right: 3,
    width: 30, height: 30, borderRadius: '50%',
    background: isRecording ? '#ef4444' : 'transparent',
    border: isRecording ? 'none' : '1.5px solid rgba(55,50,47,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'all 0.2s',
    color: isRecording ? 'white' : 'rgba(55,50,47,0.55)',
  }}
>
  {isRecording ? (
    <span style={{ width: 10, height: 10, borderRadius: 2, background: 'white', display: 'block' }} />
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="12" rx="3"/>
      <path d="M5 10a7 7 0 0 0 14 0"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
    </svg>
  )}
  {isRecording && (
    <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: '2px solid #ef4444', opacity: 0.5, animation: 'sc-mic-pulse 1s ease-in-out infinite' }} />
  )}
</button>
<style>{`@keyframes sc-mic-pulse { 0%,100%{transform:scale(1);opacity:0.5} 50%{transform:scale(1.2);opacity:0.2} }`}</style>
          
      </div>
    </div>
  </div>

{/* ── Showcase slider — shown below textarea when no project ── */}
{!currentProject && showcaseSlides.length > 0 && (
  <ShowcaseSlider slides={showcaseSlides} />
)}
{currentProject && (
  <div className="flex md:hidden justify-center items-center border border-[rgba(55,50,47,0.12)] w-full rounded-[12px] mb-3 bg-[#fffcf6] flex-shrink-0">
     
      <button
        onClick={() => toggleViewMode("chat")}
        className={`px-1 w-1/2 py-2 rounded-l-[12px] text-sm font-medium transition-colors duration-200 ${
            viewMode === "chat" 
                ? "bg-[#37322F] text-white font-semibold" 
                : "bg-transparent text-gray-700"
        }`}
    >
        Chat
    </button>
    <button
        onClick={() => toggleViewMode("preview")}
        className={`px-1 w-1/2 py-2 rounded-r-lg text-sm font-medium transition-colors duration-200 ${
            viewMode === "preview" 
                ? "bg-[#37322F] text-white font-semibold" 
                : " text-gray-700"
        }`}
    >
        Preview
    </button>
    
</div>
  )}
</div>













        
       </div> 
      
    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}

  


      
      
    
      

    {/* ZONE DES BOUTONS DE COMMANDE / INPUT DE CLONAGE */}
        
          

    <div 
  className={`
    h-full flex flex-col bg-[#fbfbf9] 
    md:w-[60%] 
    ${!currentProject ? "hidden" : (viewMode === "preview" ? "flex w-full" : "hidden md:flex")}
  `}
>
        <div className="flex items-center gap-1 justify-between p-4 flex-shrink-0 h-12  border-[rgba(55,50,47,0.12)]">
          <div className="bg-transparent rounded-[12px] h-8 flex items-center p-1 border border-[rgba(55,50,47,0.12)]">
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "preview" ? "bg-[#ffffff]" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("preview")}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "code" ? "bg-[#ffffff]" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("code")}
            >
              <Code className="h-4 w-4" />
            </Button>
          </div>

<div 
  // La div est masquée si activeTab n'est PAS "preview"
  className={`
    items-center gap-2 w-[80%] bg-transparent
    ${activeTab === "preview" ? "flex" : "hidden"}
  `}
>
    <div className="w-[60%] h-[60%] rounded-[12px] flex items-center gap-1 bg-transparent gap-2 border border-[rgba(55,50,47,0.12)] p-1">
        
            <input
      type="text"
      value={iframeRoute}
      onChange={(e) => setIframeRoute(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleNavigate()
      }}
      className="flex-grow bg-transparent w-full h-full outline-none px-3 text-sm text-[#37322F] placeholder:select-none placeholder:text-[rgba(55,50,47,0.60)]"
      
    />

        <Button
      variant="ghost"
      size="icon"
      className="h-7 w-auto flex-shrink-0 text-[#212121] hover:text-[#37322F]"
      onClick={handleNavigate}
    >
      <ArrowRight  className="h-4 w-6" />
    </Button>
    </div>
   

    <div className="w-auto flex items-center gap-[2px]">
      
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 flex-shrink-0 text-[#212121] hover:text-[#37322F]"
      onClick={handleReload}
    >
      <RotateCw size={23} className={`h-4 w-4 transition-transform ${isReloading ? "animate-spin" : ""}`} />
    </Button>
    <button
      variant="ghost"
      size="icon"
      className="h-7 w-7 flex-shrink-0 text-[#212121] "
      disabled={!previewUrl}
      onClick={() => window.open(previewUrl, "_blank")}
    >
        <ArrowUpRight size={23}  />
    </button>
    </div>
</div>

       
        
               
          

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                  onClick={() => {
    if (!currentProject) return alert("Select a project first");
    setIsGitHubOpen(true);
  }}
                className="flex items-center justify-center rounded-[12px] border border-[rgba(55,50,47,0.12)] bg-[#ffffff] p-2  transition-colors h-9 w-9"
                aria-label="GitHub"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#37322F" className="h-[18px] w-[18px]" viewBox="0 0 16 16">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/>
</svg>
                
              </button>

                <GitHubDeployModal 
  isOpen={isGitHubOpen} 
  onClose={() => setIsGitHubOpen(false)} 
  currentProject={currentProject} 
/>

{/* ⚠️ Assurez-vous d'importer l'icône Zap et Loader de Lucide React */}


              {/* Rendu de la Modal Vercel (Doit être affiché par-dessus le reste) */}
{/* ---------------------------------------------------- */}
{/* Affichage du Composant Modal */}
{/* ---------------------------------------------------- */}

<Button
    onClick={() => {
    if (!currentProject) {
      alert("Veuillez d'abord créer ou sélectionner un projet.");
      return;
    }
    setIsDeployOpen(true); 
  }}
    disabled={deploying}
    className="bg-[#1e52f1] text-white px-1 py-1 rounded-[12px]  transition flex items-center "
  >
    
              <svg className="h-[16px] fill-white flex w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#fff"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
         <span className="hidden">
           {deploying ? "Deploying..." : "Deploy site"}
         </span>     
    
  </Button>

                <VercelDeployModal 
    isOpen={isDeployOpen} 
    onClose={() => setIsDeployOpen(false)} 
    currentProject={currentProject}
    onDeployError={(stderr: string) => {
      const prompt = `[BUILD_ERROR:Vercel Deploy]\n${stderr}\n[/BUILD_ERROR]\n\nErreur lors du déploiement Vercel. Analyse et corrige :\n\`\`\`\n${stderr}\n\`\`\``;
      sendChat(prompt);
    }}
/>
              
{showDeploymentStatus && deploymentDetails.status !== 'idle' && (
    <div 
        className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-2xl z-50 max-w-sm w-full 
            ${deploymentDetails.status === 'success' ? 'bg-green-50 border border-green-300' : 
              deploymentDetails.status === 'error' ? 'bg-red-50 border border-red-300' : 
              'bg-blue-50 border border-blue-300'}`
        }
    >
        <div className="flex justify-between items-start">
            <div className="flex items-center space-x-3">
                {deploymentDetails.status === 'deploying' && <Loader className="h-5 w-5 text-blue-600 animate-spin" />}
                {deploymentDetails.status === 'success' && <Check className="h-5 w-5 text-green-600" />}
                {deploymentDetails.status === 'error' && <X className="h-5 w-5 text-red-600" />}
                
                <h4 className={`text-sm font-semibold ${
                    deploymentDetails.status === 'success' ? 'text-green-800' : 
                    deploymentDetails.status === 'error' ? 'text-red-800' : 
                    'text-blue-800'}`
                }>
                    {deploymentDetails.status === 'deploying' ? 'Déploiement en cours' : 
                     deploymentDetails.status === 'success' ? 'Déploiement Terminé' : 
                     'Échec du Déploiement'}
                </h4>
            </div>
            <button onClick={() => setShowDeploymentStatus(false)} className="text-gray-400 hover:text-gray-600">
                <CloseIcon className="h-4 w-4" />
            </button>
        </div>

        <p className="text-sm mt-2 text-gray-700">{deploymentDetails.message}</p>

        {deploymentDetails.url && (
            <a href={deploymentDetails.url} target="_blank" rel="noopener noreferrer">
                <Button variant="link" className="h-8 p-0 mt-1 text-sm text-blue-600">
                    {deploymentDetails.status === 'success' ? 'Voir le Déploiement' : 'Suivre le Statut'}
                    <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
            </a>
        )}

        {deploymentDetails.error && deploymentDetails.status === 'error' && (
            <div className="mt-2 p-2 bg-red-100 rounded text-xs text-red-700">
                **Erreur :** <span className="font-mono">{deploymentDetails.error.substring(0, 100)}...</span>
            </div>
        )}
    </div>
)}

            </div>
          </div>
        </div>

        <div className="w-full h-[calc(100%-64px)] bg-[#f7f4ed] flex flex-col">

        
          {activeTab === "preview" ? (
            <div className="flex-grow flex flex-col overflow-hidden w-full h-full">
              {/* SECTION PRÉVISUALISATION (IFRAME) */}
              <div className="flex-grow bg-[#f7f4ed] w-full rounded-[14px] p-1 border-[rgba(55,50,47,0.12)] m-1 h-full overflow-hidden relative">

                {/* ── Topbar progress loader (shows during any runSequence) ── */}
                {isRunning && buildSteps.length > 0 && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 20, borderRadius: '14px 14px 0 0', overflow: 'hidden', background: 'rgba(55,50,47,0.07)' }}>
                    <div style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, transparent 0%, #37322F 40%, rgba(55,50,47,0.7) 60%, transparent 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'sc-topbar-slide 1.6s ease-in-out infinite',
                      borderRadius: 'inherit',
                    }} />
                    <style>{`@keyframes sc-topbar-slide { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
                  </div>
                )}

                {/* ── Determine display mode ── */}
                {(() => {
                  // addFiles-only pill mode: iframe already showing, just writing files
                  const isAddFilesOnly = isRunning && buildSteps.length > 0 &&
                    buildSteps.every(s => s.id === 'addfiles') &&
                    !!previewUrl && !!sandboxId;

                  // Full build steps mode: no iframe yet (or multi-step build)
                  const isFullBuild = isRunning && buildSteps.length > 0 && !isAddFilesOnly;

                  // Idle: show iframe or logo
                  const showIframe = !!previewUrl && !!sandboxId && !isFullBuild;
                  const showLogo = !showIframe && !isFullBuild;

                  // Current running step (for single-step display)
                  const runningStep = buildSteps.find(s => s.status === 'running');
                  const lastDoneStep = [...buildSteps].reverse().find(s => s.status === 'done');
                  const displayStep = runningStep ?? lastDoneStep;

                  return (
                    <>
                      {/* Iframe — shown when we have a preview and not in full-build */}
                      {showIframe && (
                        <iframe ref={iframeRef} src={previewUrl!} className="w-full h-full border-0" title="Sandbox Preview" />
                      )}

                      {/* Full build: centered single step — logo hidden */}
                      {isFullBuild && displayStep && (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                          <style>{`
                            @keyframes sc-step-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
                          `}</style>
                          <div key={displayStep.id} style={{ animation: 'sc-step-in 0.25s ease-out', display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* Icon */}
                            {displayStep.status === 'running' && (
                              <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.12)" strokeWidth="1.5"/>
                                <path d="M8 2a6 6 0 0 1 6 6" stroke="#37322F" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            )}
                            {displayStep.status === 'done' && (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="rgba(55,50,47,0.22)" strokeWidth="1.5"/>
                                <path d="M5 8l2.5 2.5L11 5.5" stroke="rgba(55,50,47,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            {displayStep.status === 'error' && (
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.5"/>
                                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            )}
                            <span style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: displayStep.status === 'error' ? '#ef4444' : '#37322F',
                              letterSpacing: '-0.01em',
                            }}>
                              {displayStep.label}
                            </span>
                          </div>
                          {/* Step dots progress */}
                          <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                            {buildSteps.map(s => (
                              <div key={s.id} style={{
                                width: s.id === displayStep.id ? 16 : 5,
                                height: 5,
                                borderRadius: 999,
                                background: s.status === 'error' ? '#ef4444' : s.status === 'done' ? 'rgba(55,50,47,0.35)' : s.id === displayStep.id ? '#37322F' : 'rgba(55,50,47,0.12)',
                                transition: 'all 0.3s ease',
                              }} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Studio logo — idle, no project, no build */}
                      {showLogo && (
                        <div className="flex items-center justify-center h-full text-[#212121]">
                          <svg width="300" height="240" viewBox="0 0 1200 240" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="100%" height="100%" fill="transparent" />
                            <text x="120" y="150" fontSize="100" fontFamily="Inter, Helvetica, Arial, sans-serif" fontWeight="400" fill="#000000" letterSpacing="-4"></text>
                            <ellipse cx="420" cy="120" rx="58" ry="32" fill="#000000" transform="rotate(-18 430 120)" />
                            <text x="500" y="150" fontSize="100" fontFamily="Inter, Helvetica, Arial, sans-serif" fontWeight="400" fill="#000000" letterSpacing="-4">Studio.</text>
                          </svg>
                        </div>
                      )}

                      {/* AddFiles pill — floats over the iframe when only writing files */}
                      {isAddFilesOnly && (
                        <div style={{
                          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                          zIndex: 10, pointerEvents: 'none',
                          animation: 'sc-step-in 0.2s ease-out',
                        }}>
                          <style>{`@keyframes sc-step-in { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }`}</style>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            background: 'rgba(30,28,26,0.82)', backdropFilter: 'blur(8px)',
                            borderRadius: 999, padding: '6px 14px 6px 10px',
                            boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
                          }}>
                            <svg className="animate-spin" width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                              <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5"/>
                              <path d="M8 2a6 6 0 0 1 6 6" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.01em' }}>
                              Syncing files…
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* BARRE D'ACTIONS — auto-run actif, bouton Run masqué */}
              <div className="flex-shrink-0 hidden items-center gap-2 px-3 py-1.5 bg-[#fffcf6] border-t border-[rgba(55,50,47,0.06)]">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-[rgba(55,50,47,0.55)] hover:text-[#37322F]"
                  onClick={copyLogs}
                  title="Copy logs"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* SECTION LOGS — masquée */}
              <div className="hidden">
                <ScrollArea className="w-full">
                  <p className="text-xs whitespace-pre-wrap p-4">{logs.join("\n")}</p>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex-grow border border-[rgba(55,50,47,0.12)] rounded-[12px]   flex flex-row overflow-hidden w-full h-full">
              <div className="w-1/3 h-full border-r border-[rgba(55,50,47,0.12)] ">
                <div className="p-1 border-[rgba(55,50,47,0.12)] flex justify-between items-center h-8">
                  <h3 className="text-sm font-medium px-2 text-[#37322F]">Files</h3>
                </div>
                
<ScrollArea className="h-[calc(100%-57px)] bg-[#fffcf6] p-1">
    <ul className="space-y-1 font-semibold text-[20px]">
        {/* Démarre le rendu récursif à partir de la racine de l'arbre */}
        {Array.from(fileTree.entries()) 
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
                // Trie les dossiers en premier à la racine
                if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
                if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
                return nameA.localeCompare(nameB);
            })
            .map(([key, node]) => (
                <FileTreeItem
                    key={key}
                    node={node}
                    activeFile={activeFile}
                    setActiveFile={setActiveFileUser}
                    liveFilePath={liveFile?.path ?? null}
                />
            ))}
    </ul>
    
</ScrollArea>
              
              </div>


              
              <div className="w-2/3 h-full bg-white flex flex-col">
                
                {/* 🆕 1. LE BREADCRUMB HEADER (Header de l'éditeur) */}
                <div className="h-10 flex items-center px-4 border-b border-[rgba(55,50,47,0.12)] bg-[#FFFAF0] flex-shrink-0">
                  {/* Affiche le chemin complet du fichier actif */}
                  

<div className="flex items-center w-full h-full justify-between p-2 border-b border-[rgba(55,50,47,0.1)] h-10">
    <div className="flex items-center gap-2"> {/* Conteneur pour le Breadcrumb */}
        {currentProject && files.length > 0 && activeFile !== null && (
            <FileBreadcrumb 
                filePath={liveFile?.path ?? files[activeFile]?.filePath ?? ""} 
            />
        )}
    </div>

    {/* NOUVEAU: Conteneur des Boutons d'Action (uniquement si un fichier est ouvert) */}
    {currentProject && activeFile !== null && (
        <div className="flex items-center gap-2">
            {/* Bouton Copier */}
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleCopyFileContent}
                className={`h-8 w-8 ${copiedFileIndex === activeFile ? "text-black" : "text-black"}`}
                title="Copier le contenu du fichier"
            >
                {copiedFileIndex === activeFile ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>

            {/* Bouton Télécharger */}
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleDownloadFile}
                className="h-8 w-8 p-1  text-black"
                title="Télécharger le fichier"
            >
                <Download />
            </Button>
        </div>
    )}
</div>
                </div>

                {/* 2. L'ÉDITEUR MONACO — lecture seule, contenu piloté par le stream */}
                <div className="flex-grow relative"> 
                  {/* Wrapper pointer-events:none → bloque toute interaction utilisateur */}
                  <div style={{ height: '100%', pointerEvents: 'none' }}>
                    <Editor
                      key={`editor-${currentProject?.id ?? "no-project"}`}
                      
                      value={
                        // liveFile est mis à jour atomiquement (path + content ensemble)
                        // → zéro désynchronisation entre le fichier affiché et son contenu
                        liveFile
                          ? liveFile.content
                          : (currentProject?.files[activeFile]?.content ?? "")
                      }
                      
                      height="100%" 
                      defaultLanguage="typescript" 
                      theme="customTheme" 
                      onMount={handleEditorDidMount} 
                      onChange={(value) => { if (!isStreamingRef.current) updateFile(value || ""); }} 
                      options={{
                          minimap: { enabled: true },
                          lineNumbers: 'on',
                          scrollBeyondLastLine: false,
                          lineNumbersMinChars: 3, 
                          fontFamily: "Mozilla Headline", 
                          fontSize: 14, 
                          backgroundColor: "#fffcf6",
                          readOnly: true,
                          domReadOnly: true,
                      }}
                    />
                  </div>
                  {/* Badge "Read only for now" — centré en bas */}
                  <div style={{
                    position: 'absolute',
                    bottom: 18,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none',
                    background: 'rgba(255,252,246,0.96)',
                    border: '1px solid rgba(55,50,47,0.13)',
                    borderRadius: 20,
                    padding: '5px 16px',
                    fontSize: 11.5,
                    color: 'rgba(55,50,47,0.55)',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
                    userSelect: 'none',
                    zIndex: 10,
                    whiteSpace: 'nowrap',
                  }}>
                    🔒 Read only for now
                  </div>
                </div>
              </div>
              
              
            </div>
          )}
        </div>

            {currentProject && (
  <div className="flex md:hidden justify-center items-center border border-[rgba(55,50,47,0.12)]  w-full rounded-[12px] mb-3 bg-[#fffcf6] ">
    
      <button
        onClick={() => toggleViewMode("chat")}
        className={`px-1 w-1/2 py-1  rounded-l-[12px] transition-colors duration-200 ${
            viewMode === "chat" 
                ? "bg-[#37322F] text-white font-semibold" 
                : "bg-transparent text-gray-700"
        }`}
    >
        Chat
    </button>
    <button
        onClick={() => toggleViewMode("preview")}
        className={`px-1 w-1/2 py-1 rounded-r-lg transition-colors duration-200 ${
            viewMode === "preview" 
                ? "bg-[#37322F] text-white font-semibold" 
                : " text-gray-700"
        }`}
    >
        Preview
    </button>
        
</div>
        )}
      </div>
      {/* ---------- SIDEBAR OVERLAY ---------- */}
<div className={`fixed inset-0 z-40 pointer-events-none`}>
  {/* backdrop */}
  <div
    onClick={() => setShowSidebar(false)}
    className={`absolute inset-0 bg-black/40 transition-opacity ${showSidebar ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
  />
  {/* panel */}
  <aside
    className={`absolute left-0 top-0 h-full w-72 bg-white border-r border-[rgba(55,50,47,0.12)] transform transition-transform duration-200 shadow-lg
      ${showSidebar ? "translate-x-0" : "-translate-x-full"}
    `}
    aria-hidden={!showSidebar}
  >
    <div className="p-4 flex items-center justify-between border-b border-[rgba(55,50,47,0.08)]">
      <h3 className="text-sm font-medium">Projects</h3>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={createNewProject} className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setShowSidebar(false)} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div className="p-3 overflow-auto h-[calc(100%-56px)]">
      {projects.length === 0 ? (
        <p className="text-sm text-[rgba(55,50,47,0.6)]">No projects yet.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
  onClick={() => {
    if (currentProject) {
      saveProject() 
    }
    loadProject(p.id) 
    setShowSidebar(false)
  }}
  className={`w-full text-left p-3 rounded-md flex flex-col ${
    currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : "hover:bg-[#F7F5F3]"
  }`}
>
  <div className="text-sm">{p.name}</div>
  <div className="text-xs text-[rgba(55,50,47,0.6)]">{new Date(p.createdAt).toLocaleString()}</div>
</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </aside>
</div>

            
                    {isSearchOpen && (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm transition-all"
            onClick={() => setIsSearchOpen(false)}
    >
        <div 
            // MODIFICATION ICI: Largeur w-[80%] mobile et md:w-[65%] desktop
            className="w-[80%] md:w-[75%] bg-[#fbfbf9] rounded-[16px] overflow-hidden border border-[rgba(55,50,47,0.12)] flex flex-col max-h-[60vh]"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex items-center border-b border-[rgba(55,50,47,0.12)] p-4 gap-3">
                <Search className="w-5 h-5 text-[rgba(55,50,47,0.5)] shrink-0" />
                <input 
                    autoFocus
                    type="text"
                    placeholder="Search a project..."
                    className="flex-1 outline-none text-lg text-[#212121] placeholder:text-[#888] font-semibold bg-transparent"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-[rgba(55,50,47,0.3)] hover:text-[rgba(55,50,47,0.7)]">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                )}
            </div>
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[rgba(55,50,47,0.06)]">
              {([
                { key: "all", label: "All" },
                { key: "today", label: "Today" },
                { key: "recent", label: "Last 3 days" },
                { key: "week", label: "This week" },
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => setSearchFilter(f.key)}
                  className="px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
                  style={{
                    background: searchFilter === f.key ? "#37322F" : "rgba(55,50,47,0.07)",
                    color: searchFilter === f.key ? "#fff" : "rgba(55,50,47,0.6)",
                  }}
                >
                  {f.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-[rgba(55,50,47,0.3)]">{filteredProjects.length} result{filteredProjects.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="overflow-y-auto p-2">
                {filteredProjects.map((p, index) => (
                    <div
                        key={p.id}
                        onClick={() => handleSelectProject(p.id)}
                        className="flex items-center justify-between p-3 hover:bg-[#F7F5F3] rounded-lg cursor-pointer group transition-colors"
                    >
                        <div className="flex items-center gap-4">
                            {/* REMPLACEMENT DE L'IMAGE PAR LE CERCLE */}
                            {/* Le container est plus grand (w-12 h-12) */}
                            <div className="w-12 h-12 bg-white border border-[rgba(55,50,47,0.12)] rounded-xl shadow-sm flex items-center justify-center shrink-0">
                                {/* LOGIQUE DE VARIANTES : Si index pair = Noir, sinon = Blanc avec bordure */}
                                <div className={`rounded-full transition-all ${
                                    index % 2 === 0 
                                    ? 'w-4 h-4 bg-[#212121]' 
                                    : 'w-4 h-4 bg-white border-[3px] border-[#212121]'
                                }`}></div>
                            </div>

                            <div className="flex flex-col">
                                {/* COULEUR TEXTE #212121 et font plus grand */}
                                <span className="text-lg font-semibold text-[#212121]">{p.name}</span>
                                <span className="text-sm text-gray-400">
                                    {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(p.createdAt))}
                                </span>
                            </div>
                        </div>

                        {/* RAJOUT VISUEL DES RACCOURCIS (Apparait au hover comme demandé) */}
                        <div className="hidden group-hover:flex items-center gap-2 pr-2">
                            <span className="text-xs text-gray-400">Open</span>
                            <kbd className="hidden sm:inline-block px-2 py-0.5 bg-white border border-gray-200 rounded-md text-xs text-gray-500 shadow-[0px_1px_0px_rgba(0,0,0,0.05)]">↵</kbd>
                        </div>
                    </div>
                ))}
            </div>

            {/* RAJOUT DU FOOTER (Style Raycast/Inspiration) */}
            <div className="border-t border-gray-100 bg-gray-50/50 p-2 px-4 flex justify-between items-center text-xs text-gray-400">
                <div className="flex gap-4">
                    <span className="flex items-center gap-1"><kbd className="bg-gray-200 px-1 rounded text-[10px] text-gray-600">TAB</kbd> Suggestions</span>
                </div>
                <div className="flex gap-4">
                    <span className="flex items-center gap-1">Open <kbd className="bg-gray-200 px-1 rounded text-[10px] text-gray-600">↵</kbd></span>
                    <span className="flex items-center gap-1">Actions <kbd className="bg-gray-200 px-1 rounded text-[10px] text-gray-600">⌘ K</kbd></span>
                </div>
            </div>
        </div>
    </div>
)}


      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
          <div className="w-[400px] bg-[#191919] border border-[#333] rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Create New Project</h3>
            <input 
              autoFocus
              type="text" 
              placeholder="Project Name" 
              className="w-full bg-[#252525] border border-[#333] rounded-lg p-3 text-white outline-none focus:border-[#555] mb-6"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmCreateProject()}
            />
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-[#888] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmCreateProject}
                disabled={!newProjectName.trim()}
                className="px-4 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
                    

      {/* Auth modal */}
      {showAuthModal && (
        <AuthModal onClose={currentUser ? () => setShowAuthModal(false) : undefined} />
      )}

      {/* API key required modal */}
      {pendingApiKeyProvider && (
        <ApiKeyModal
          provider={pendingApiKeyProvider}
          onKeySaved={() => setPendingApiKeyProvider(null)}
        />
      )}

            
    </div>
  )
}
