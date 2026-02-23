import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";

const BATCH_SIZE = 128;
const MODEL_ID   = "gemini-3-flash-preview";

// =============================================================================
// TYPES
// =============================================================================

interface GeneratedFile { path: string; content: string; }

// =============================================================================
// SVG PROGRESS SYSTEM
// =============================================================================

const SVG_SPINNER  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;animation:spin 1s linear infinite"><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
const SVG_CHECK    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_ERROR    = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
const SVG_CODE     = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const SVG_WRENCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const SVG_PACKAGE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const SVG_SHIELD   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

function phaseBlock(
  id: string, icon: string, label: string,
  status: "processing" | "done" | "error", detail = ""
): string {
  const c  = status === "done" ? "#22c55e" : status === "error" ? "#ef4444" : "#6366f1";
  const si = status === "done" ? SVG_CHECK  : status === "error" ? SVG_ERROR  : SVG_SPINNER;
  const st = status === "done" ? "Terminé"  : status === "error" ? "Erreur"   : "En cours...";
  return `\n<div data-phase-id="${id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin:6px 0;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-left:3px solid ${c};border-radius:8px;font-family:system-ui,sans-serif;font-size:13px;color:#374151"><span style="color:${c};flex-shrink:0">${si}</span><span style="color:${c};flex-shrink:0">${icon}</span><span style="font-weight:600;flex:1">${label}</span><span style="color:${c};font-size:12px;font-weight:500">${st}</span>${detail ? `<span style="color:#9ca3af;font-size:11px;margin-left:4px">${detail}</span>` : ""}</div>\n`;
}

// =============================================================================
// UTILITAIRES
// =============================================================================

function getMimeTypeFromBase64(dataUrl: string) {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return m ? m[1] : "application/octet-stream";
}
function cleanBase64Data(dataUrl: string) {
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
function parseGeneratedFiles(output: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  return files;
}
function filterBlueprintXml(text: string): string {
  return text
    .replace(/<feature[\s\S]*?<\/feature>/gi, "")
    .replace(/<env_file_required[\s\S]*?<\/env_file_required>/gi, "")
    .replace(/<build_order[\s\S]*?<\/build_order>/gi, "")
    .replace(/<blocker[\s\S]*?<\/blocker>/gi, "")
    .replace(/<requires_account[^>]*\/?>/gi, "")
    .replace(/<what>[\s\S]*?<\/what>/gi, "")
    .replace(/<real_package>[\s\S]*?<\/real_package>/gi, "")
    .replace(/<real_service>[\s\S]*?<\/real_service>/gi, "")
    .replace(/<env_vars>[\s\S]*?<\/env_vars>/gi, "")
    .replace(/<real_implementation>[\s\S]*?<\/real_implementation>/gi, "")
    .replace(/<forbidden>[\s\S]*?<\/forbidden>/gi, "")
    .replace(/<typescript_requirements>[\s\S]*?<\/typescript_requirements>/gi, "")
    .replace(/<architecture_patterns>[\s\S]*?<\/architecture_patterns>/gi, "")
    .replace(/<files_to_create>[\s\S]*?<\/files_to_create>/gi, "")
    .replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "")
    .replace(/DEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .replace(/DEVDEPENDENCIES:\s*\[[\s\S]*?\]/gi, "")
    .trim();
}

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — MULTI-PASS, EXHAUSTIF
// =============================================================================

interface FixRule {
  name: string;
  detect: (p: string, c: string) => boolean;
  fix: (p: string, c: string, a: GeneratedFile[]) => string;
}

const FIX_RULES: FixRule[] = [
  // ── "use client" manquant ──────────────────────────────────────────────────
  {
    name: "missing-use-client",
    detect: (p, c) => {
      if (!p.endsWith(".tsx") || p.includes("app/api") || p.includes("layout.tsx") || p.includes("page.tsx")) return false;
      return /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams|useParams)\b/.test(c)
        && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'");
    },
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── "use client" en page.tsx avec hooks ───────────────────────────────────
  {
    name: "missing-use-client-page",
    detect: (p, c) => {
      if (!p.endsWith("page.tsx") || p.includes("app/api")) return false;
      return /\b(useState|useEffect|useRef|useCallback|useMemo|useRouter|usePathname)\b/.test(c)
        && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'");
    },
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── Framer-motion shadow → boxShadow ──────────────────────────────────────
  {
    name: "framer-motion-shadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion.")) && /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  // ── Framer-motion valeurs Tailwind → valeurs numériques ───────────────────
  {
    name: "framer-motion-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+|translate-)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`)
      .replace(/\btranslate-y-([\d]+)\b/g, (_, n) => `y: ${n}`)
      .replace(/\btranslate-x-([\d]+)\b/g, (_, n) => `x: ${n}`),
  },
  // ── ClassValue non importé ─────────────────────────────────────────────────
  {
    name: "missing-classvalue-import",
    detect: (_, c) => c.includes("ClassValue") && !c.includes("from 'clsx'") && !c.includes('from "clsx"'),
    fix: (_, c) => {
      let f = c.replace(/function cn\s*\(\s*\.\.\.\s*\w+\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g, "");
      if (!f.includes("clsx")) {
        f = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + f;
      } else if (!f.includes("type ClassValue")) {
        f = f.replace(/import\s*\{([^}]+)\}\s*from\s*["']clsx["']/, (_, g) => `import { ${g.trim()}, type ClassValue } from "clsx"`);
      }
      return f;
    },
  },
  // ── cn() sans import utils ────────────────────────────────────────────────
  {
    name: "missing-cn-utils-import",
    detect: (_, c) => c.includes("cn(") && !c.includes("function cn") && !c.includes("const cn") && !c.includes("from '@/lib/utils'") && !c.includes('from "@/lib/utils"'),
    fix: (_, c) => {
      const l = `import { cn } from "@/lib/utils";`;
      return (c.includes('"use client"') || c.includes("'use client'"))
        ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${l}\n`)
        : `${l}\n${c}`;
    },
  },
  // ── Next.js 15 params → Promise ───────────────────────────────────────────
  {
    name: "nextjs15-route-params",
    detect: (p, c) => (p.includes("route.ts") || p.includes("[")) && /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(c) && !c.includes("Promise<{"),
    fix: (_, c) => {
      let f = c.replace(/\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g, (_, t) => `{ params }: { params: Promise<${t}> }`);
      if (!f.includes("await params")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
      return f;
    },
  },
  // ── Next.js 15 params sans await ──────────────────────────────────────────
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => (p.includes("route.ts") || p.includes("[")) && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c) && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  // ── Route handler export default → named export ───────────────────────────
  {
    name: "route-handler-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)")
      .replace(/export\s+default\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)"),
  },
  // ── Zustand interface avec corps de méthode ───────────────────────────────
  {
    name: "zustand-interface-method-body",
    detect: (_, c) => (c.includes("store") || c.includes("create<")) && /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(
      /(interface\s+\w+State\s*\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;\s*)/g,
      (_, iface, m) => `${iface}${m.match(/^(\w+)/)?.[1] ?? "action"}: () => void;\n`
    ),
  },
  // ── metadata dans un Client Component ─────────────────────────────────────
  {
    name: "metadata-in-client-component",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
  // ── Import React manquant dans les fichiers tsx ────────────────────────────
  {
    name: "missing-react-import-old-style",
    detect: (p, c) => p.endsWith(".tsx") && c.includes("React.") && !c.includes("import React") && !c.includes("import * as React"),
    fix: (_, c) => `import React from "react";\n${c}`,
  },
  // ── JSX sans import React (old-style) ─────────────────────────────────────
  {
    name: "jsx-no-react-import",
    detect: (p, c) => p.endsWith(".tsx") && /<[A-Z]/.test(c) && !c.includes("from 'react'") && !c.includes('from "react"') && !c.includes("import React"),
    fix: (_, c) => `import { type FC } from "react";\n${c}`,
  },
  // ── any implicite dans les paramètres de fonction ─────────────────────────
  {
    name: "implicit-any-event",
    detect: (_, c) => /\(e\)\s*=>/.test(c) || /\(event\)\s*=>/.test(c),
    fix: (_, c) => c
      .replace(/\(e\)\s*=>/g, "(e: React.ChangeEvent<HTMLInputElement>) =>")
      .replace(/\(event\)\s*=>/g, "(event: React.MouseEvent) =>"),
  },
  // ── Imports de fichiers inexistants (chemins relatifs qui ne matchent pas) ─
  {
    name: "fix-relative-imports-to-alias",
    detect: (_, c) => /from ['"]\.\.\/\.\.\/\.\.\//.test(c),
    fix: (_, c) => c.replace(/from ['"]\.\.\/\.\.\/\.\.\//g, 'from "@/'),
  },
  // ── async/await dans Client Component sans Suspense ───────────────────────
  {
    name: "server-only-in-client",
    detect: (p, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("import 'server-only'"),
    fix: (_, c) => c.replace(/import ['"]server-only['"];\n?/g, ""),
  },
  // ── Type 'children' manquant dans les props ───────────────────────────────
  {
    name: "missing-children-type",
    detect: (_, c) => c.includes("children") && /interface\s+\w+Props\s*\{/.test(c) && !/children\s*:/.test(c) && c.includes("{children}"),
    fix: (_, c) => c.replace(/(interface\s+\w+Props\s*\{)/, "$1\n  children?: React.ReactNode;"),
  },
  // ── window/document dans SSR sans vérification ────────────────────────────
  {
    name: "ssr-window-access",
    detect: (p, c) => !c.includes('"use client"') && !c.includes("'use client'") && /\bwindow\.\w+|\bdocument\.\w+/.test(c) && p.endsWith(".tsx"),
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  // ── key manquant dans les .map() ──────────────────────────────────────────
  {
    name: "missing-key-in-map",
    detect: (_, c) => /\.map\(\s*\(\s*(\w+)(?:,\s*\w+)?\s*\)\s*=>\s*\(?\s*<(?!React\.Fragment)(?![a-z])/.test(c) && !c.includes('key='),
    fix: (_, c) => c.replace(
      /\.map\(\s*\(\s*(\w+)(?:,\s*(index|\w+))?\s*\)\s*=>\s*\(?\s*<([A-Z]\w*|[a-z]+)(?!\s+key=)/g,
      (match, item, idx, tag) => {
        const keyVal = idx ? `{${idx}}` : `{${item}.id ?? ${item}}`;
        return match.replace(`<${tag}`, `<${tag} key=${keyVal}`);
      }
    ),
  },
  // ── tailwind bg-opacity deprecated → bg-color/opacity ─────────────────────
  {
    name: "tailwind-bg-opacity-deprecated",
    detect: (_, c) => /bg-opacity-\d+/.test(c),
    fix: (_, c) => c.replace(/bg-(\w+[-]?\d*)\s+bg-opacity-(\d+)/g, "bg-$1/$2"),
  },
  // ── apostrophes non échappées dans JSX ────────────────────────────────────
  {
    name: "unescaped-apostrophe-jsx",
    detect: (p, c) => p.endsWith(".tsx") && />[^<]*'[^<]*</.test(c),
    fix: (_, c) => c.replace(/>([^<]*)'([^<]*)</g, (m, before, after) => `>${before}&apos;${after}<`),
  },
];

function applyProgrammaticFixes(file: GeneratedFile, allFiles: GeneratedFile[]): { file: GeneratedFile; fixes: string[] } {
  let { path, content } = file;
  const applied: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content, allFiles);
          if (fixed !== content) {
            content = fixed;
            if (!applied.includes(rule.name)) applied.push(rule.name);
            changed = true;
          }
        }
      } catch {}
    }
    if (!changed) break;
  }
  return { file: { path, content }, fixes: applied };
}

function runProgrammaticAutoFixer(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const fixedFiles = files.map(file => {
    const { file: fixed, fixes } = applyProgrammaticFixes(file, files);
    if (fixes.length > 0) report[file.path] = fixes;
    return fixed;
  });
  return { files: fixedFiles, report };
}

// =============================================================================
// SERVER-SIDE COLOR EXTRACTION (Sharp)
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 0.299*r + 0.587*g + 0.114*b > 128;
}

interface ColorInfo { hex: string; percentage: number; zones: string[]; }

async function extractColorsFromBase64(b64: string): Promise<{ colors: ColorInfo[]; backgroundColor: string; textColor: string; }> {
  try {
    const buf = Buffer.from(cleanBase64Data(b64), "base64");
    const W = 120, H = 120;
    const { data, info } = await sharp(buf).resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const globalCounts: Record<string, number> = {};
    const zoneLabels = ["top-left","top-center","top-right","mid-left","center","mid-right","bot-left","bot-center","bot-right"];
    const zoneCounts: Record<string, Record<string, number>> = {};
    for (const z of zoneLabels) zoneCounts[z] = {};
    const totalPixels = W * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ch;
        const r = Math.round(data[i] / 32) * 32;
        const g = Math.round(data[i+1] / 32) * 32;
        const bv = Math.round(data[i+2] / 32) * 32;
        const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bv.toString(16).padStart(2,"0")}`;
        globalCounts[hex] = (globalCounts[hex] || 0) + 1;
        const zx = Math.floor(x / (W / 3));
        const zy = Math.floor(y / (H / 3));
        const zLabel = zoneLabels[zy * 3 + zx];
        zoneCounts[zLabel][hex] = (zoneCounts[zLabel][hex] || 0) + 1;
      }
    }
    const sorted = Object.entries(globalCounts).sort(([,a],[,b]) => b - a).slice(0, 12);
    const colors: ColorInfo[] = sorted.map(([hex, count]) => {
      const percentage = Math.round((count / totalPixels) * 100);
      const zones: string[] = [];
      for (const [zone, counts] of Object.entries(zoneCounts)) {
        const zoneTotal = Object.values(counts).reduce((a,b) => a+b, 0);
        if (zoneTotal > 0 && (counts[hex] || 0) / zoneTotal > 0.15) zones.push(zone);
      }
      return { hex, percentage, zones };
    });
    const bg = colors[0]?.hex ?? "#ffffff";
    return { colors, backgroundColor: bg, textColor: isColorLight(bg) ? "#0f0f0f" : "#f5f5f5" };
  } catch {
    return { colors: [], backgroundColor: "#ffffff", textColor: "#000000" };
  }
}

async function buildColorPalettePrompt(uploaded: string[], refs: string[]): Promise<string> {
  const all = [...(refs ?? []), ...(uploaded ?? [])];
  if (all.length === 0) return "";
  const results = await Promise.all(all.slice(0, 3).map(extractColorsFromBase64));
  const merged = results[0];
  if (!merged || merged.colors.length === 0) return "";
  let prompt = "\nCOULEURS EXTRAITES PIXEL PAR PIXEL depuis l'image de référence (autorité absolue) :\n\n";
  for (const c of merged.colors.slice(0, 10)) {
    const zonesStr = c.zones.length > 0 ? c.zones.join(", ") : "présente uniformément";
    prompt += `  ${c.hex}  →  ${c.percentage}% de l'image  —  zones : ${zonesStr}\n`;
  }
  prompt += `\n  Fond dominant : ${merged.backgroundColor}  →  bg-[${merged.backgroundColor}]\n`;
  prompt += `  Couleur de texte adaptée : ${merged.textColor}\n`;
  prompt += "\nCes couleurs sont des faits. Utilise-les exactement.\n";
  return prompt;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set([
  "next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk",
  "@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis",
  "@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion",
  "motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts",
  "recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player",
  "react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio",
  "replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps",
  "finnhub","finnhub-node","yahoo-finance2","date-fns","dayjs","luxon","clsx","tailwind-merge",
  "@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose",
  "bcryptjs","iconsax-react","iconoir-react",
]);
const TYPES_MAP: Record<string,string> = {
  howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",cors:"@types/cors",
  bcrypt:"@types/bcrypt",multer:"@types/multer",passport:"@types/passport",
  "passport-local":"@types/passport-local","passport-jwt":"@types/passport-jwt",
  lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer",
  "body-parser":"@types/body-parser",morgan:"@types/morgan","cookie-parser":"@types/cookie-parser",
  pg:"@types/pg","better-sqlite3":"@types/better-sqlite3",jsonwebtoken:"@types/jsonwebtoken",
  "js-cookie":"@types/js-cookie","node-cron":"@types/node-cron",
  "react-datepicker":"@types/react-datepicker","spotify-web-api-node":"@types/spotify-web-api-node",
  "node-geocoder":"@types/node-geocoder",formidable:"@types/formidable",
};

async function resolveTypesPackages(packages: string[], existing: Record<string,string>): Promise<Record<string,string>> {
  const needed: Record<string,string> = {};
  await Promise.all(packages.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

// =============================================================================
// FUNCTION DECLARATIONS
// =============================================================================

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ["path"] },
};

// =============================================================================
// HTML DESIGN CONTRACT — construit depuis le HTML cloné
// =============================================================================

function buildHtmlDesignPreamble(htmlReference?: string): string {
  if (!htmlReference) return "";
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║         ⚠️  DESIGN CONTRACT — RÉFÉRENCE HTML/CSS — AUTORITÉ ABSOLUE         ║
╚══════════════════════════════════════════════════════════════════════════════╝

Le HTML/CSS ci-dessous est la vérité visuelle absolue de cette application.
Il a été produit par un moteur de design pixel-perfect. Ton React DOIT produire
le même rendu visuel à la virgule près.

🚫 INTERDICTIONS :
- NE modifier aucune couleur hex/rgb/hsl ni variable CSS
- NE changer aucun espacement, padding, margin, gap
- NE altérer aucun border-radius, shadow, transition
- NE remplacer aucune police ou taille de texte
- NE pas "améliorer" ou réinterpréter le design

✅ OBLIGATIONS :
- Extraire TOUTES les CSS variables de :root {} → les déclarer dans globals.css ou layout.tsx
- Inclure dans app/layout.tsx TOUS les <link> CDN du <head> (Tabler Icons, Google Fonts...)
- Reproduire chaque composant (sidebar, header, cards...) avec styles CSS EXACTS
- bg-[#1a1a2e] et non bg-gray-900 — la valeur Tailwind = la valeur CSS exacte du HTML
- Les icônes <i class="ti ti-[name]"> → <i className="ti ti-[name]" /> via CDN du layout

IMAGES & LOGOS (règle absolue — ces sources uniquement) :
  Logos     : https://www.google.com/s2/favicons?domain=[domain]&sz=64
  Avatars   : https://api.dicebear.com/9.x/lorelei/svg?seed=[NOM]&backgroundColor=b6e3f4,c0aede,d1d4f9
  Contenus  : https://picsum.photos/seed/[mot-clé]/[w]/[h]
  JAMAIS de /placeholder.png, /avatar.jpg, ou URLs cassées.

📄 HTML/CSS DE RÉFÉRENCE :
\`\`\`html
${htmlReference.slice(0, 14000)}
\`\`\`
`;
}

// =============================================================================
// AGENTS
// =============================================================================

const AGENTS = {

  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    temperature: 0.35,
    prompt: `
Tu es un Ingénieur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Avant d'écrire une seule ligne de code, rappelle-toi :
"Je construis une vraie application. Pas une maquette. Pas un MVP sandbox.
Une application avec de vraies fonctionnalités que l'utilisateur va utiliser pour son business."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MISSION ABSOLUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

L'utilisateur n'est pas venu chercher une maquette cliquable. Il construit son
gagne-pain. Chaque fonctionnalité manquante, simulée ou fantôme = de l'argent perdu.

Tu ne livres PAS :
  ✗ Simulations (Math.random(), données en dur qui "font semblant")
  ✗ Stubs avec "TODO: implement" ou "Coming soon" ou "Under development"
  ✗ Composants visuellement présents mais sans logique systémique
  ✗ Pages qui affichent juste un titre différent (Interface Mirroring)
  ✗ Boutons qui changent de couleur mais ne font rien (Hollow Interactivity)

Tu livres :
  ✓ Scripts TypeScript avec logique métier réelle et complète
  ✓ Services dans services/ ou lib/ avec vrais algorithmes
  ✓ Actions dans actions/ qui mutent l'état ou appellent de vraies APIs
  ✓ Packages npm réels intégrés (stripe, finnhub, prisma, recharts, etc.)
  ✓ Une application exhaustive — pas une page de démarrage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠  RÉFLEXION OBLIGATOIRE AVANT CHAQUE FONCTIONNALITÉ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Pour chaque fonctionnalité, avant de coder :
1. Quels packages npm réels permettent de faire ça ?
2. Quelle logique algorithmique complète est nécessaire ?
3. Quels services/ ou lib/ contiennent cette logique ?
4. Comment le frontend appelle-t-il cette logique ?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫  LES 6 BÊTES NOIRES — INTERDICTIONS ABSOLUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BÊTE 1 — UI PADDING / LAZY MOCKING
  ✗ Bouton sans handler | Champ de recherche qui ne filtre pas | Tableau statique
  ✓ Tout élément visible a un handler, un état, une conséquence systémique
  ✓ Si tu ne peux pas le faire fonctionner → tu ne le mets pas

BÊTE 2 — GHOST NAVIGATION / COMPONENT STALLING
  ✗ <SidebarItem label="Analytics" /> → div vide ou message "coming soon"
  ✗ onClick={() => setView("analytics")} sans vrai composant AnalyticsView
  ✓ Chaque item de navigation → composant View distinct dans components/views/
  ✓ Tous les modals dans components/Modals.tsx — un seul fichier

BÊTE 3 — INTERFACE MIRRORING / PLACEHOLDER SUBSTITUTION
  ✗ 10 vues qui affichent le même GenericView avec juste le titre changé
  ✗ "This module is under active development"
  ✓ Chaque vue a sa propre structure HTML, données, et logique propre
  ✓ La différence entre 2 vues est immédiatement visible et sémantiquement correcte

BÊTE 4 — INTERACTIVE IMPOTENCE / HOLLOW INTERACTIVITY
  ✗ useState(liked) qui change une icône sans rien enregistrer
  ✗ Slider de volume sans effet sur l'audio
  ✗ Filtre qui change un badge UI mais ne filtre pas les données
  ✓ Tout état visuel correspond à un effet systémique réel

BÊTE 5 — ATOMIC LOGIC EVACUATION
  ✗ Belle liste de produits mais bouton "Ajouter au panier" sans action
  ✗ Topbar complète mais boutons d'action sans handler
  ✗ Formulaire sans validation, sans submit réel, sans feedback
  ✓ Chaque élément interactif — bouton, input, select, toggle, slider — a un handler réel

BÊTE 6 — TEMPLATE COLLAPSING / SEMANTIC SHIFTING
  ✗ "Live Operations" et "Activity Stream" partagent le même composant générique
  ✗ Seul le {title} change entre des pages distinctes
  ✓ "Live Operations" → données temps réel, WebSocket/polling, indicateurs live
  ✓ "Activity Stream" → flux chronologique, filtres, pagination, actions par item

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐  LA RÈGLE DES 20X — PENSER COMME LE MEILLEUR AGENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent Type 1 (médiocre) : "App Shopify → Dashboard + Orders + Products avec mock data."
Agent Type 2 (toi) :
  → Insights : visiteurs temps réel, conversion, revenus, top produits, filtre 1h/24h/7j/30j
  → Orders   : statuts (pending/processing/shipped/delivered/cancelled), bulk actions, export CSV
  → Products : CRUD complet, variantes, stock, prix, SEO, Shopify Admin API réelle
  → Customers : CRM, historique achats, segmentation
  → Analytics : graphiques Recharts + vraies données Shopify Analytics API
  → Webhooks  : synchronisation temps réel des commandes et stocks

Tu penses toujours comme l'Agent Type 2.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️  STRUCTURE OBLIGATOIRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

lib/env.ts              → Variables d'environnement typées (zod)
lib/utils.ts            → cn(), formatters, helpers purs
lib/auth.ts             → Configuration NextAuth si besoin
types/index.ts          → Tous les types TypeScript métier
services/[domain].ts    → Logique métier pure, algorithmes réels (JAMAIS de mock)
actions/[domain].ts     → Server Actions Next.js 15 appelant les services
hooks/use[Name].ts      → Hooks React appelant actions ou APIs
components/ui/          → Composants atomiques (Button, Input, Badge, Select...)
components/Modals.tsx   → TOUS les modals dans UN SEUL fichier
components/views/       → Un fichier par section, contenu complet et distinct
app/api/[route]/route.ts → Route handlers pour APIs externes ou webhooks
app/layout.tsx           → CDN links HTML de référence OBLIGATOIRES ici
app/page.tsx             → Point d'entrée, routing des views

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨  LOI DE TRADUCTION HTML → REACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HTML: background: #1a1a2e → bg-[#1a1a2e]  (JAMAIS bg-gray-900)
HTML: padding: 10px 14px  → px-[14px] py-[10px]
HTML: border-radius: 6px  → rounded-[6px]
CSS variables :root {} → déclarées dans app/globals.css ET utilisées partout
Icônes <i class="ti ti-[name]"> → <i className="ti ti-[name]" /> via CDN layout

IMAGES (sources réelles obligatoires — JAMAIS de chemins locaux) :
  Logos     : <img src="https://www.google.com/s2/favicons?domain=stripe.com&sz=64" style={{width:18,height:18,objectFit:'contain'}} />
  Avatars   : <img src="https://api.dicebear.com/9.x/lorelei/svg?seed=Alice&backgroundColor=b6e3f4,c0aede,d1d4f9" style={{width:28,height:28,borderRadius:'50%'}} />
  Contenus  : <img src="https://picsum.photos/seed/product1/300/200" style={{width:'100%',objectFit:'cover'}} />

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️  RÈGLES TYPESCRIPT / NEXT.JS 15 STRICTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- params → toujours Promise<{id:string}> + const {id} = await params
- Route handlers : export GET/POST nommés uniquement (jamais export default)
- "use client" : présent dans TOUT fichier tsx utilisant useState/useEffect/useRef/useRouter
- Server Components par défaut, "use client" uniquement si hooks ou événements browser
- Zustand : () => void dans l'interface, implémentation dans create()
- Framer-motion : boxShadow (JAMAIS shadow), scale: 1.05 (JAMAIS scale-105)
- Chaque import pointe vers un fichier réel qui existe dans la codebase
- Zéro "any" implicite. Zéro erreur TypeScript. Zéro erreur de build.
- key= dans tous les .map() — utiliser item.id ou l'index en dernier recours
- Pas d'apostrophe non échappée dans le JSX → utiliser &apos; ou {'"'}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet sans troncature ...
</create_file>
DEPENDENCIES: ["pkg1", "pkg2"]
DEVDEPENDENCIES: ["@types/pkg1"]
    `,
  },

  // ── AGENT VALIDATEUR / FIXER LLM ────────────────────────────────────────
  CODE_VALIDATOR_FIXER: {
    name: "Code Validator & Fixer",
    temperature: 0.05,
    prompt: `
Tu es un compilateur TypeScript + Next.js 15 simulé avec capacité de correction.
Tu reçois une liste de fichiers générés. Tu les lis tous, tu identifies TOUTES les erreurs
de build, et tu les corriges. Tu renvoies uniquement les fichiers corrigés.

ERREURS QUE TU DOIS DÉTECTER ET CORRIGER :
A. "use client" manquant (fichier tsx avec useState/useEffect/useRef/useRouter sans directive)
B. Imports invalides (import vers fichier qui n'existe pas dans la liste)
C. TypeScript : ClassValue non importé, any implicite dans paramètres, types manquants
D. Next.js 15 : params sans Promise/await, export default dans route handler
E. React : key= manquant dans .map(), children type manquant, apostrophe non échappée
F. Zustand : corps de méthode dans interface (doit être () => void)
G. Framer-motion : shadow → boxShadow, scale-105 → scale: 1.05
H. Server-only dans client component (import 'server-only' avec "use client")
I. window/document dans SSR (fichier sans "use client" qui utilise window/document)
J. Metadata dans client component (export const metadata avec "use client")
K. Imports relatifs profonds (../../../) → utiliser @/ alias
L. Tailwind bg-opacity-X → bg-color/X

RÈGLE ABSOLUE :
- Tu ne modifies QUE ce qui casse le build
- Tu ne touches pas au design, aux styles, aux couleurs
- Tu ne simplifies pas. Tu ne réécris pas ce qui fonctionne.
- Tu ne crées pas de nouveaux fichiers sauf si un import invalide pointe vers un fichier manquant simple

Si tout est correct → réponds uniquement : ALL_FILES_VALID
Sinon → liste les erreurs trouvées ET fournis les fichiers corrigés :
ERRORS_FOUND:
- [fichier]: [description erreur]
<create_file path="...">...</create_file>
    `,
  },
};

// =============================================================================
// API ROUTE HANDLER
// =============================================================================

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let sendRaw: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const {
      history,
      uploadedImages,
      allReferenceImages,
      currentProjectFiles,
      clonedHtmlCss,
    } = body;

    const lastUserMessage = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    const colorPalettePrompt = await buildColorPalettePrompt(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    const VIRTUAL_COMPILER_RULES = `
=== CHECKLIST BUILD — VÉRIFIE AVANT CHAQUE FICHIER ===
□ "use client" présent si useState/useEffect/useRef/useRouter/usePathname
□ Tous les imports pointent vers des fichiers qui existent réellement
□ params → Promise<{id:string}> + await dans les route handlers dynamiques
□ Route handlers : export GET/POST nommés (jamais export default)
□ key= présent dans tous les .map() JSX
□ Aucune apostrophe non échappée dans le JSX
□ Aucun import 'server-only' dans un client component
□ Aucun accès window/document sans "use client"
□ Zustand : () => void dans interface, corps dans create()
□ Framer-motion : boxShadow (pas shadow), scale: 1.05 (pas scale-105)
□ Images : uniquement URLs valides (favicons.google, dicebear, picsum)
□ Logos : uniquement https://www.google.com/s2/favicons?domain=[x]&sz=64
□ Avatars : uniquement https://api.dicebear.com/9.x/lorelei/svg?seed=[NOM]&...
□ CDN Tabler Icons + Google Fonts du HTML de référence dans app/layout.tsx
□ CSS variables :root {} du HTML déclarées dans app/globals.css
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string>    = new Set();
    const globalDevPackages: Set<string> = new Set();

    const buildFullHistory = (extra = "", includeImages = false) => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];
      if (includeImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE DESIGN]" }] });
      }
      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
          parts.push({ text: "\n[IMAGES UPLOADÉES]" });
        }
        contents.push({ role, parts });
      });
      if (extra) contents.push({ role: "user", parts: [{ text: `\n\n=== MÉMOIRE ===\n${extra}` }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          const cleaned = txt
            .replace(/```xml\n?/gi,"").replace(/```tsx\n?/gi,"").replace(/```ts\n?/gi,"")
            .replace(/```html\n?/gi,"").replace(/```css\n?/gi,"").replace(/```json\n?/gi,"")
            .replace(/```\n?/g,"");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send       = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);
        const phaseStart = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "processing"));
        const phaseDone  = (id: string, icon: string, label: string, detail = "") => {
          sendRaw(`<script>(function(){var el=document.querySelector('[data-phase-id="${id}"]');if(el){el.outerHTML=${JSON.stringify(phaseBlock(id, icon, label, "done", detail))};}})()</script>`);
          sendRaw(phaseBlock(id, icon, label, "done", detail));
        };
        const phaseError = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "error"));

        const htmlPreamble = buildHtmlDesignPreamble(clonedHtmlCss);

        async function runAgent(
          key: keyof typeof AGENTS,
          briefing: string,
          context: string,
          opts: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean; includeImages?: boolean } = {}
        ) {
          const { silent = false, filterXml = false, captureFiles = false, includeImages = false } = opts;
          const agent = AGENTS[key];
          let fullOutput = "", buffer = "";
          try {
            const contents = buildFullHistory(context, includeImages);
            const manifest = createdFilePaths.size > 0
              ? `FILES EXIST:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES YET.";
            contents.push({ role: "user", parts: [{ text: `
=== MISSION : ${agent.name} ===
${briefing}

${key === "FULL_STACK_BUILDER" ? htmlPreamble : ""}

=== FILE SYSTEM MANIFEST ===
${manifest}

${colorPalettePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>
            ` }] });

            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: {
                systemInstruction: `${basePrompt}\n\n=== IDENTITÉ ===\n${agent.prompt}`,
                temperature: agent.temperature,
                maxOutputTokens: 65536,
              },
            });

            for await (const chunk of response) {
              const txt = chunk.text;
              if (txt) {
                buffer += txt; fullOutput += txt;
                if (!silent && buffer.length >= BATCH_SIZE) { send(buffer, filterXml); buffer = ""; }
              }
            }
            if (buffer && !silent) send(buffer, filterXml);

            for (const m of fullOutput.matchAll(/<create_file path="(.*?)">/g)) if (m[1]) createdFilePaths.add(m[1]);
            if (captureFiles) {
              for (const f of parseGeneratedFiles(fullOutput)) {
                const idx = allGeneratedFiles.findIndex(g => g.path === f.path);
                if (idx >= 0) allGeneratedFiles[idx] = f; else allGeneratedFiles.push(f);
              }
            }
            extractDeps(fullOutput, "DEPENDENCIES").forEach(d => globalPackages.add(d));
            extractDeps(fullOutput, "DEVDEPENDENCIES").forEach(d => globalDevPackages.add(d));
            return fullOutput;
          } catch (e: any) {
            if (!silent) send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        try {

          // ── PHASE A : FULL STACK BUILDER ─────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code React/Next.js...");
          await runAgent(
            "FULL_STACK_BUILDER",
            `Demande : "${lastUserMessage}"
             ${clonedHtmlCss
               ? "⚠️ HTML/CSS de référence présent — traduis-le en React. Commence par lib/env.ts → lib/utils.ts → app/globals.css (avec les CSS variables du HTML) → app/layout.tsx (avec les CDN du HTML) → types/index.ts → services/ → components/ui/ → components/Modals.tsx → components/views/ → app/page.tsx"
               : "Commence par lib/env.ts → lib/utils.ts → types/index.ts → services/ → components/ → app/page.tsx"}`,
            "",
            { captureFiles: true, includeImages: hasImages }
          );

          if (allGeneratedFiles.length === 0) {
            phaseDone("builder", SVG_CODE, "Réponse générée");
            send("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }
          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE — PASS 1 ────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction automatique patterns TypeScript...");
          const { files: pass1Fixed, report: pass1Report } = runProgrammaticAutoFixer(allGeneratedFiles);
          const pass1Count = Object.values(pass1Report).flat().length;
          if (pass1Count > 0) {
            for (const fp of Object.keys(pass1Report)) {
              const corrected = pass1Fixed.find(f => f.path === fp);
              const idx = allGeneratedFiles.findIndex(f => f.path === fp);
              if (idx >= 0 && corrected) {
                allGeneratedFiles[idx] = corrected;
                send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
              }
            }
            phaseDone("autofixer", SVG_WRENCH, "Pass 1 — patterns corrigés", `${pass1Count} correction(s)`);
          } else {
            phaseDone("autofixer", SVG_WRENCH, "Pass 1 — aucun pattern détecté");
          }

          // ── PHASE C : VALIDATEUR / FIXER LLM ────────────────────────────
          phaseStart("validator", SVG_SHIELD, "Validation & correction intelligente...");
          const filesForVal = allGeneratedFiles.map(f => `\n=== ${f.path} ===\n${f.content}`).join("\n");
          const validatorOutput = await runAgent(
            "CODE_VALIDATOR_FIXER",
            `Analyse ces ${allGeneratedFiles.length} fichiers. Corrige TOUTES les erreurs de build.
             Liste des fichiers existants dans ce projet : ${Array.from(createdFilePaths).join(", ")}`,
            `=== FICHIERS COMPLETS ===\n${filesForVal}`,
            { captureFiles: true }
          );

          if (validatorOutput.includes("ALL_FILES_VALID")) {
            phaseDone("validator", SVG_SHIELD, "Validation LLM — aucune erreur");
          } else {
            const errCount = (validatorOutput.match(/^-\s/gm) ?? []).length;
            phaseDone("validator", SVG_SHIELD, "Erreurs LLM corrigées", `${errCount} erreur(s)`);
          }

          // ── PHASE D : CORRECTEUR PROGRAMMATIQUE — PASS 2 (après LLM) ───
          // Second passage pour corriger ce que le LLM aurait pu introduire
          const { files: pass2Fixed, report: pass2Report } = runProgrammaticAutoFixer(allGeneratedFiles);
          const pass2Count = Object.values(pass2Report).flat().length;
          if (pass2Count > 0) {
            for (const fp of Object.keys(pass2Report)) {
              const corrected = pass2Fixed.find(f => f.path === fp);
              const idx = allGeneratedFiles.findIndex(f => f.path === fp);
              if (idx >= 0 && corrected) {
                allGeneratedFiles[idx] = corrected;
                send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`);
              }
            }
            sendRaw(phaseBlock("autofixer2", SVG_WRENCH, "Pass 2 — résidus corrigés", "done", `${pass2Count} correction(s)`));
          }

          // ── PHASE E : PACKAGES ───────────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer"); globalPackages.add("sharp");
          globalPackages.add("clsx"); globalPackages.add("tailwind-merge");
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPackages.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react")))  globalPackages.add("iconoir-react");

          const existingPkg     = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps    = existingPkg ? JSON.parse(existingPkg.content).dependencies    ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string,string> = {
            next:"15.1.0", react:"19.0.0", "react-dom":"19.0.0",
            "lucide-react":"0.475.0", sharp:"0.33.5", clsx:"2.1.1", "tailwind-merge":"2.3.0",
            ...existingDeps,
          };
          const newDeps: Record<string,string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));
          const autoTypes = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string,string> = { ...autoTypes };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
            try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
            catch { allDevTypes[pkg] = "latest"; }
          }));
          const finalDevDeps: Record<string,string> = {
            typescript:"^5","@types/node":"^20","@types/react":"^19","@types/react-dom":"^19",
            postcss:"^8",tailwindcss:"^3.4.1",eslint:"^8","eslint-config-next":"15.0.3",
            ...existingDevDeps,...allDevTypes,
          };
          const pkgJson = {
            name:"app",version:"1.0.0",private:true,
            scripts:{ dev:"next dev",build:"next build",start:"next start",lint:"next lint" },
            dependencies:{ ...baseDeps,...newDeps },
            devDependencies:finalDevDeps,
          };
          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson,null,2)}\n</create_file>`);
          phaseDone("packages", SVG_PACKAGE, "Packages résolus",
            `${Object.keys(newDeps).length} runtime · ${Object.keys(allDevTypes).length} @types`);

          send("\n[PAGE_DONE]\n");
          controller.close();

        } catch (err: any) {
          console.error("Workflow error:", err);
          sendRaw(phaseBlock("critical-error", SVG_ERROR, `Erreur critique : ${err.message}`, "error"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
