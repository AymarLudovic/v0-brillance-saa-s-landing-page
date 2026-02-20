import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
import packageJson from "package-json";
import sharp from "sharp";

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview";

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
const SVG_PALETTE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;
const SVG_SEARCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
const SVG_SHIELD   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_WRENCH   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const SVG_PACKAGE  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const SVG_SPARKLES = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;

function phaseBlock(id: string, icon: string, label: string, status: "processing" | "done" | "error", detail = ""): string {
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
function cleanBase64Data(dataUrl: string) { return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl; }

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
// SURCOUCHE VISUELLE — LOI ABSOLUE DE DESIGN
// Ce texte est injecté mot pour mot dans le prompt du Builder.
// Il est rédigé comme un bloc de vision humaine, pas comme une liste de règles,
// afin que le modèle l'intériorise comme une conviction et non comme
// une contrainte qu'il peut contourner par ses biais d'entraînement.
// =============================================================================

const SURCOUCHE_VISUAL_LAW = `
Tu vas construire une interface qui déclenche une réaction émotionnelle immédiate chez celui qui la voit pour la première fois. Pas une interface "correcte". Une interface qui fait souffler un "oh" silencieux. Pour y arriver, tu dois sortir complètement de tes automatismes d'entraînement sur le design et suivre une vision précise qui t'est imposée ici comme une réalité, pas comme une suggestion.

Concernant les icônes, tu dois comprendre quelque chose de fondamental : l'œil humain perçoit une différence de qualité entre les familles d'icônes sans pouvoir l'expliquer, et cette différence produit ou détruit la satisfaction visuelle immédiate. Pour les icônes de navigation de base — notamment home, settings, et les éléments de type bibliothèque ou collection — tu utiliseras exclusivement des icônes issues de la librairie Iconoir ou Iconsax React, qui produisent des traits visuellement plus élégants à petite taille. Pour tout le reste des icônes de l'interface, tu utilises Lucide React. Ce mélange ciblé n'est pas un accident, c'est une décision de designer qui sait exactement pourquoi certaines icônes sonnent mieux dans certains contextes.

Concernant les sidebars d'application, imagine que tu regardes une interface que tu utiliserais toi-même tous les jours. La sidebar dans ce cas n'est pas un élément imposant qui prend de la place, c'est un guide discret et élégant. Chaque item de menu a une hauteur de l'ordre de trente à trente-deux pixels — pas plus, parce qu'au-delà ça devient lourd et oppressant. Ce qui rend cette hauteur confortable malgré sa compacité, c'est le padding vertical interne qui empêche le texte et l'icône de toucher les bords supérieur et inférieur du bouton. Le texte de ces menus est petit, vraiment petit, mais avec un poids semi-bold qui le rend parfaitement lisible même à cette taille. Si tu hésites entre deux tailles de texte pour un menu de sidebar, prends la plus petite. Le border-radius des items de menu est cohérent avec leur hauteur — puisqu'ils sont compacts, le radius aussi est petit, discret, quelque chose qui adoucit le coin sans faire de capsule ou de pill.

La sidebar est organisée en sections. La première section, celle qui contient les items de navigation habituels comme le dashboard, la page d'accueil, les notifications, n'a pas de nom de section affiché au-dessus d'elle — elle commence directement. Les sections suivantes, elles, ont un nom, mais ce nom est encore plus petit que le texte des menus eux-mêmes, écrit en majuscules avec un espacement de lettres légèrement augmenté, et sans aucune icône chevron ou dropdown à côté de lui — c'est un label fixe, pas un accordéon. Les séparateurs entre les sections, s'ils existent, doivent prendre toute la largeur disponible à l'intérieur de la sidebar sans être rognés ou réduits par le padding horizontal — si le padding de la sidebar est de seize pixels de chaque côté, le séparateur touche presque les bords, ou alors on n'en met pas du tout plutôt que d'en mettre un trop visible ou trop fragmenté. La sidebar doit aussi pouvoir se réduire à un mode icônes uniquement — dans ce mode, seules les icônes s'affichent, parfaitement centrées horizontalement dans la sidebar réduite, sans texte visible. Cette transition doit être fluide.

Concernant les layouts de page d'application, il en existe deux types principaux que tu dois maîtriser. Le premier type est celui où la sidebar et la page partagent exactement la même couleur de fond — la sidebar n'a pas de bordure, pas de séparation visuelle avec le reste de la page, elle est intégrée. Dans ce cas, c'est la zone de contenu principal qui porte la distinction visuelle : elle a un léger écart avec les bords de la fenêtre, de l'ordre de cinq à huit pixels sur les côtés et en bas, et ses coins sont très légèrement arrondis, disons autour de six pixels. Cette zone de contenu a ainsi l'air d'une carte flottant sur le fond de la page. La topbar de cette zone de contenu a un padding horizontal généreux pour ne pas sembler étriquée, et elle n'a pas de bordure inférieure — sauf si une deuxième barre de navigation vient directement en dessous d'elle, auquel cas cette séparation devient nécessaire. Le deuxième type de layout est le classique avec sidebar et topbar distinctes, mais même dans ce cas les proportions et le soin accordé aux détails restent les mêmes.

Concernant les champs de recherche et les inputs en général, ils ne doivent jamais être trop ronds — un radius trop important sur un champ de saisie lui donne un aspect consumer, jouet, non professionnel. La hauteur d'un champ de saisie doit être modérée, ni trop grande ni trop petite, quelque chose qui s'intègre naturellement dans la densité de l'interface sans dominer. La couleur de fond de ces champs doit être identique à la surface sur laquelle ils reposent, ou très légèrement différente — jamais un blanc pur sur un fond gris clair ou une couleur d'accent fort qui fait ressortir le champ comme un élément étranger.

Concernant les zones de saisie de type chat ou textarea enrichi, elles sont divisées en trois parties distinctes plutôt que d'être un simple rectangle. La partie haute affiche les fichiers, images ou documents que l'utilisateur a attachés. La partie centrale contient le textarea lui-même, sans bordure visible ni contour, avec exactement la même couleur de fond que le conteneur global — le texte qu'on y tape semble flotter. La partie basse contient les boutons d'action comme envoyer, uploader, etc. L'ensemble forme une boîte cohérente dont les trois niveaux se fondent visuellement en un seul élément.

Pour les logos de marques connues dans les sidebars, navbars, ou sections partenaires — Stripe, GitHub, Notion, Slack, Vercel, Shopify, Linear et tous les autres — tu utilises l'API Clearbit à l'adresse logo.clearbit.com suivi du domaine de la marque. Tu n'inventes jamais un logo, tu ne mets jamais des initiales dans un carré coloré à la place d'un vrai logo. Toujours ajouter un gestionnaire d'erreur qui cache l'image si le logo n'est pas trouvé.

Pour les ombres, tu dois retenir que les ombres plates et uniformes donnent l'impression d'un design de template. Les ombres qui créent de la profondeur sont toujours composées de plusieurs couches — une couche large et diffuse qui donne l'élévation, et une couche plus serrée et plus sombre qui ancre l'élément. Pense à des ombres qui évoquent la lumière naturelle plutôt que des ombres de calculatrice. Pour les éléments colorés comme les boutons primaires, l'ombre peut elle aussi être légèrement teintée de la couleur de l'élément pour créer un effet de glow doux.

Pour les avatars et images de profil, tu n'utilises jamais un rectangle ou cercle gris vide. Tu utilises dicebear avec le paramètre seed pour générer un avatar cohérent et unique par utilisateur, ou ui-avatars.com pour les avatars à initiales stylisés. Pour les images de contenu ou placeholder, tu utilises Unsplash ou Picsum avec des paramètres appropriés.

Pour la typographie, tu charges une Google Font adaptée au type d'application via next/font/google et tu crées une hiérarchie visible à l'œil nu entre les titres de page, les titres de section, les labels de section dans la sidebar, le corps de texte et les éléments métadonnées. La différence entre les niveaux typographiques doit être assez marquée pour que l'œil comprenne instantanément l'importance relative de chaque information sans lire le contenu.

Pour les transitions et micro-interactions, chaque élément interactif — chaque bouton, chaque item de menu, chaque carte cliquable — change d'état de manière fluide et non instantanée. Un changement d'état sec et immédiat fait paraître l'interface morte. Les durées de transition sont courtes pour les éléments de navigation (cent cinquante millisecondes environ) et légèrement plus longues pour les éléments qui se déplacent ou changent de taille. Les boutons ont un retour tactile subtil à l'appui, comme un très léger écrasement suivi d'un rebond.
`;

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — COUCHE 1
// =============================================================================

interface FixRule { name: string; detect: (p: string, c: string) => boolean; fix: (p: string, c: string, a: GeneratedFile[]) => string; }

const FIX_RULES: FixRule[] = [
  {
    name: "framer-motion-shadow-to-boxshadow",
    detect: (_, c) => (c.includes("framer-motion") || c.includes("motion.")) && /(?:whileHover|whileTap|animate|initial|exit)\s*=\s*\{\{[^}]*\bshadow\b/.test(c),
    fix: (_, c) => c.replace(/\bshadow\s*(?=\s*:)/g, "boxShadow"),
  },
  {
    name: "framer-motion-tailwind-values",
    detect: (_, c) => /(?:whileHover|animate)\s*=\s*\{\{[^}]*(?:scale-[\d]+|opacity-[\d]+|translate-)/.test(c),
    fix: (_, c) => c
      .replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n / 100}`)
      .replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n / 100}`)
      .replace(/\btranslate-y-([\d]+)\b/g, (_, n) => `y: ${n}`)
      .replace(/\btranslate-x-([\d]+)\b/g, (_, n) => `x: ${n}`),
  },
  {
    name: "missing-classvalue-import",
    detect: (_, c) => c.includes("ClassValue") && !c.includes("from 'clsx'") && !c.includes('from "clsx"'),
    fix: (_, c) => {
      let f = c.replace(/function cn\s*\(\s*\.\.\.\s*\w+\s*:\s*ClassValue\[\]\s*\)\s*\{[^}]*\}/g, "");
      if (!f.includes("clsx")) f = `import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nfunction cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n\n` + f;
      else if (!f.includes("type ClassValue")) f = f.replace(/import\s*\{([^}]+)\}\s*from\s*["']clsx["']/, (_, g) => `import { ${g.trim()}, type ClassValue } from "clsx"`);
      return f;
    },
  },
  {
    name: "nextjs15-route-params",
    detect: (p, c) => p.includes("route.ts") && /\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*\{[^}]+\}\s*\}/.test(c) && !c.includes("Promise<{"),
    fix: (_, c) => {
      let f = c.replace(/\{\s*params\s*\}\s*:\s*\{\s*params\s*:\s*(\{[^}]+\})\s*\}/g, (_, t) => `{ params }: { params: Promise<${t}> }`);
      if (!f.includes("await params")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
      return f;
    },
  },
  {
    name: "nextjs15-params-no-await",
    detect: (p, c) => p.includes("route.ts") && /const\s*\{[^}]+\}\s*=\s*params(?!\s*\))/.test(c) && !c.includes("await params") && c.includes("Promise<{"),
    fix: (_, c) => c.replace(/const\s*(\{[^}]+\})\s*=\s*params(?!\s*\))/g, "const $1 = await params"),
  },
  {
    name: "zustand-interface-method-body",
    detect: (_, c) => (c.includes("store") || c.includes("create<")) && /:\s*\(\s*\)\s*=>\s*set\s*\(/.test(c),
    fix: (_, c) => c.replace(/(interface\s+\w+State\s*\{[\s\S]*?)(\w+\s*:\s*\([^)]*\)\s*=>\s*set\s*\([^;]+;\s*)/g, (_, iface, m) => `${iface}${m.match(/^(\w+)/)?.[1] ?? "action"}: () => void;\n`),
  },
  {
    name: "missing-use-client",
    detect: (p, c) => {
      if (!p.endsWith(".tsx") || p.includes("app/api") || p.includes("layout.tsx")) return false;
      return /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams)\b/.test(c)
        && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'");
    },
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "route-handler-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c) && !c.includes("export { handler as GET"),
    fix: (_, c) => c
      .replace(/export\s+default\s+async\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)")
      .replace(/export\s+default\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)"),
  },
  {
    name: "missing-cn-utils-import",
    detect: (_, c) => c.includes("cn(") && !c.includes("function cn") && !c.includes("const cn") && !c.includes("from '@/lib/utils'") && !c.includes('from "@/lib/utils"'),
    fix: (_, c) => {
      const l = `import { cn } from "@/lib/utils";`;
      return (c.includes('"use client"') || c.includes("'use client'")) ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${l}\n`) : `${l}\n${c}`;
    },
  },
  {
    name: "metadata-in-client-component",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
];

function applyProgrammaticFixes(file: GeneratedFile, allFiles: GeneratedFile[]): { file: GeneratedFile; fixes: string[] } {
  let { path, content } = file;
  const applied: string[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const rule of FIX_RULES) {
      try {
        if (rule.detect(path, content)) {
          const fixed = rule.fix(path, content, allFiles);
          if (fixed !== content) { content = fixed; if (pass === 0) applied.push(rule.name); changed = true; }
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
// SURCOUCHE — COUCHE 2 : MOTEUR DÉTERMINISTE POST-GÉNÉRATION
// Filet de sécurité absolu. S'exécute après le validateur LLM.
// Rattrape ce que l'IA a raté malgré la loi visuelle ci-dessus.
// =============================================================================

// ── Shadow Engine — ombres layered multi-couches ──────────────────────────────
const SHADOW_UPGRADES = [
  { p: /\bshadow-sm\b(?=[\s"'`])/g,  r: "shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]",         l: "shadow-sm→layered" },
  { p: /\bshadow\b(?!-\w)(?=[\s"'`])/g, r: "shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)]",    l: "shadow→layered" },
  { p: /\bshadow-md\b(?=[\s"'`])/g,  r: "shadow-[0_8px_16px_-4px_rgba(0,0,0,0.08),0_4px_6px_-4px_rgba(0,0,0,0.04)]",      l: "shadow-md→layered" },
  { p: /\bshadow-lg\b(?=[\s"'`])/g,  r: "shadow-[0_20px_40px_-8px_rgba(0,0,0,0.10),0_8px_16px_-8px_rgba(0,0,0,0.06)]",    l: "shadow-lg→layered" },
  { p: /\bshadow-xl\b(?=[\s"'`])/g,  r: "shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14),0_16px_32px_-8px_rgba(0,0,0,0.08)]",  l: "shadow-xl→layered" },
  { p: /\bshadow-2xl\b(?=[\s"'`])/g, r: "shadow-[0_48px_80px_-16px_rgba(0,0,0,0.18),0_24px_48px_-12px_rgba(0,0,0,0.10)]", l: "shadow-2xl→layered" },
];

function applyShadowSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx") && !file.path.endsWith(".css")) return file;
    let content = file.content; const changes: string[] = [];
    for (const rule of SHADOW_UPGRADES) { const b = content; content = content.replace(rule.p, rule.r); if (content !== b) changes.push(rule.l); }
    if (changes.length > 0) report[file.path] = [...new Set(changes)];
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Transition Engine ─────────────────────────────────────────────────────────
function applyTransitionSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(/className="([^"]*\bhover:[^\s"]+[^"]*?)"/g, (match, cls) => {
      if (cls.includes("transition") || cls.includes("duration")) return match;
      changes.push("hover→transition");
      return `className="${cls} transition-all duration-200 ease-out"`;
    });
    if (changes.length > 0) report[file.path] = [changes[0]];
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Brand Logo Engine — Clearbit API ─────────────────────────────────────────
const BRAND_DOMAIN: Record<string, string> = {
  stripe: "stripe.com", github: "github.com", gitlab: "gitlab.com", vercel: "vercel.com",
  netlify: "netlify.com", supabase: "supabase.com", firebase: "firebase.google.com",
  mongodb: "mongodb.com", prisma: "prisma.io", notion: "notion.so", linear: "linear.app",
  figma: "figma.com", slack: "slack.com", discord: "discord.com", zoom: "zoom.us",
  google: "google.com", microsoft: "microsoft.com", apple: "apple.com",
  amazon: "amazon.com", shopify: "shopify.com", paypal: "paypal.com",
  twilio: "twilio.com", openai: "openai.com", anthropic: "anthropic.com",
  twitter: "twitter.com", linkedin: "linkedin.com", facebook: "facebook.com",
  instagram: "instagram.com", youtube: "youtube.com", salesforce: "salesforce.com",
  hubspot: "hubspot.com", zendesk: "zendesk.com", intercom: "intercom.com",
  asana: "asana.com", jira: "atlassian.com", dropbox: "dropbox.com",
  revolut: "revolut.com", wise: "wise.com", brex: "brex.com", framer: "framer.com",
};

function applyBrandLogoSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    const inTarget = ["sidebar", "navbar", "nav", "header", "layout"].some(k => file.path.toLowerCase().includes(k));
    if (!inTarget) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(
      /<img\s+[^>]*src=["']\/(?:placeholder-logo|logo|brand|company-logo|mock-logo)[^"']*["'][^>]*alt=["']([^"']+)["'][^>]*\/>/g,
      (match, alt) => {
        const clean = alt.toLowerCase().replace(/\s+/g, "");
        for (const [brand, domain] of Object.entries(BRAND_DOMAIN)) {
          if (clean.includes(brand)) {
            changes.push(`${alt}→clearbit:${domain}`);
            return `<img src="https://logo.clearbit.com/${domain}" alt="${alt}" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />`;
          }
        }
        return match;
      }
    );
    if (changes.length > 0) report[file.path] = changes;
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Avatar Engine ─────────────────────────────────────────────────────────────
function applyAvatarSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(
      /<div\s+[^>]*className="[^"]*(?:rounded-full)[^"]*bg-(?:gray|zinc|neutral|slate)-[^"]*"[^>]*>\s*(?:<\/div>|[^<]{0,3}<\/div>)/g,
      (match) => {
        if (match.length > 200) return match;
        const sizeM = match.match(/w-(\d+)/);
        const sz = sizeM ? `${+sizeM[1] * 4}px` : "32px";
        changes.push("avatar→dicebear");
        return `<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" className="rounded-full object-cover" style={{width:'${sz}',height:'${sz}'}} alt="Avatar" />`;
      }
    );
    if (changes.length > 0) report[file.path] = changes;
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Orchestrateur Surcouche ───────────────────────────────────────────────────
function runSurcoucheDeterministe(files: GeneratedFile[]): {
  files: GeneratedFile[]; shadowCount: number; logoCount: number; avatarCount: number; totalFiles: number;
} {
  let cur = [...files];
  const { files: s1, report: shadowR } = applyShadowSurcouche(cur); cur = s1;
  const { files: s2 }                  = applyTransitionSurcouche(cur); cur = s2;
  const { files: s3, report: logoR }   = applyBrandLogoSurcouche(cur); cur = s3;
  const { files: s4, report: avatarR } = applyAvatarSurcouche(cur); cur = s4;
  const shadowCount = Object.values(shadowR).flat().length;
  const logoCount   = Object.values(logoR).flat().length;
  const avatarCount = Object.values(avatarR).flat().length;
  const totalFiles  = new Set([...Object.keys(shadowR), ...Object.keys(logoR), ...Object.keys(avatarR)]).size;
  return { files: cur, shadowCount, logoCount, avatarCount, totalFiles };
}

// =============================================================================
// SERVER-SIDE COLOR EXTRACTION (Sharp) — avec position et pourcentage
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 128;
}

interface ColorInfo {
  hex: string;
  percentage: number;
  zones: string[]; // ex: ["top-left", "center", "bottom-right"]
}

async function extractColorsFromBase64(b64: string): Promise<{
  colors: ColorInfo[];
  backgroundColor: string;
  textColor: string;
}> {
  try {
    const buf = Buffer.from(cleanBase64Data(b64), "base64");
    const W = 120, H = 120;
    const { data, info } = await sharp(buf).resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;

    // Comptes globaux
    const globalCounts: Record<string, number> = {};
    // Comptes par zone (3x3 grid)
    const zoneCounts: Record<string, Record<string, number>> = {};
    const zoneLabels = ["top-left","top-center","top-right","mid-left","center","mid-right","bot-left","bot-center","bot-right"];
    for (const z of zoneLabels) zoneCounts[z] = {};

    const totalPixels = W * H;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ch;
        const r = Math.round(data[i] / 32) * 32;
        const g = Math.round(data[i + 1] / 32) * 32;
        const bv = Math.round(data[i + 2] / 32) * 32;
        const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bv.toString(16).padStart(2,"0")}`;

        globalCounts[hex] = (globalCounts[hex] || 0) + 1;

        // Zone 3x3
        const zx = Math.floor(x / (W / 3));
        const zy = Math.floor(y / (H / 3));
        const zLabel = zoneLabels[zy * 3 + zx];
        zoneCounts[zLabel][hex] = (zoneCounts[zLabel][hex] || 0) + 1;
      }
    }

    // Top 12 couleurs globales
    const sorted = Object.entries(globalCounts).sort(([, a], [, b]) => b - a).slice(0, 12);

    const colors: ColorInfo[] = sorted.map(([hex, count]) => {
      const percentage = Math.round((count / totalPixels) * 100);
      // Trouver dans quelles zones cette couleur est dominante
      const zones: string[] = [];
      for (const [zone, counts] of Object.entries(zoneCounts)) {
        const zoneTotal = Object.values(counts).reduce((a, b) => a + b, 0);
        const zoneCount = counts[hex] || 0;
        if (zoneTotal > 0 && zoneCount / zoneTotal > 0.15) zones.push(zone);
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

  let prompt = "\nCOULEURS EXTRAITES PIXEL PAR PIXEL depuis l'image de référence (autorité absolue — ne jamais inventer une couleur différente) :\n\n";

  for (const c of merged.colors.slice(0, 10)) {
    const zonesStr = c.zones.length > 0 ? c.zones.join(", ") : "présente uniformément";
    prompt += `  ${c.hex}  →  ${c.percentage}% de l'image  —  zones : ${zonesStr}\n`;
  }

  prompt += `\n  Fond dominant : ${merged.backgroundColor}  (utilise bg-[${merged.backgroundColor}])\n`;
  prompt += `  Couleur de texte adaptée : ${merged.textColor}\n`;
  prompt += "\nCes couleurs sont des faits, pas des suggestions. Si une couleur occupe 40% de l'image en zone centrale, c'est la couleur principale de l'interface. Respecte exactement.\n";

  return prompt;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set(["next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk","@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis","@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion","motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts","recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player","react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio","replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps","finnhub","finnhub-node","yahoo-finance2","date-fns","dayjs","luxon","clsx","tailwind-merge","@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose","bcryptjs","iconsax-react","iconoir-react"]);
const TYPES_MAP: Record<string, string> = { howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",cors:"@types/cors",bcrypt:"@types/bcrypt",multer:"@types/multer",passport:"@types/passport","passport-local":"@types/passport-local","passport-jwt":"@types/passport-jwt",lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer","body-parser":"@types/body-parser",morgan:"@types/morgan","cookie-parser":"@types/cookie-parser",pg:"@types/pg","better-sqlite3":"@types/better-sqlite3",jsonwebtoken:"@types/jsonwebtoken","js-cookie":"@types/js-cookie","node-cron":"@types/node-cron","react-datepicker":"@types/react-datepicker","spotify-web-api-node":"@types/spotify-web-api-node","node-geocoder":"@types/node-geocoder",formidable:"@types/formidable" };

async function resolveTypesPackages(packages: string[], existing: Record<string, string>): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
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
// AGENTS
// =============================================================================

const AGENTS = {

  // ── Design Analyst — ultra-analyse en prose, image toujours présente ─────────
  DESIGN_ANALYST: {
    name: "Design Analyst",
    temperature: 0.15,
    prompt: `
Tu es un designer senior avec vingt ans d'expérience en interfaces professionnelles.
On te donne une ou plusieurs images de référence. Ta mission est unique et exigeante :
produire une analyse tellement complète, tellement précise, tellement incarnée dans
le détail visuel de cette image, que le développeur qui la lira pourra recréer
l'interface à l'identique sans jamais regarder l'image lui-même.

Tu n'écris pas une liste. Tu n'écris pas des bullet points. Tu n'écris pas des tirets.
Tu écris un bloc de texte continu, comme si tu décrivais ce que tu vois à quelqu'un
qui ne peut pas voir — mais quelqu'un d'exigeant, un développeur senior, qui a besoin
de chaque valeur, chaque nuance, chaque proportion exacte.

Tu commences par décrire le fond de l'interface — sa couleur exacte en hexadécimal,
si elle est uniforme ou si elle varie, quelle proportion elle occupe visuellement,
si elle a une texture ou un gradient imperceptible. Tu décris ensuite le layout global
de la page — comment l'espace est divisé, quelles grandes zones existent, comment
elles se positionnent les unes par rapport aux autres, quelles largeurs relatives elles
occupent.

Tu passes ensuite à chaque composant visible, du plus grand au plus petit, sans en
sauter un seul — même le plus petit badge, même le plus discret séparateur de ligne,
même l'espace vide entre deux éléments qui n'est pas vide par hasard. Pour chaque
composant tu décris : sa couleur de fond précise en hexadécimal, ses bordures s'il
en a (leur épaisseur et leur couleur exacte), son arrondi de coin, ses ombres portées
avec leur direction, leur diffusion et leur intensité, son padding interne, ce qu'il
contient et comment ce contenu est positionné. Tu décris son état par défaut, puis
son état au survol si tu peux l'inférer visuellement, puis son état actif ou sélectionné.

Tu décris ensuite avec la même précision chaque décision typographique visible —
pour chaque zone de texte tu donnes la famille de police si tu peux l'identifier ou
tu la catégorises précisément (geometric sans-serif, humanist, monospace, display),
le poids visuel de la graisse (est-ce fin, régulier, medium, semibold, bold, extrabold),
la taille relative par rapport aux autres textes de l'interface, l'espacement entre
les lettres si perceptible, la hauteur de ligne, la couleur exacte et si elle est pure
ou avec une opacité sur un fond.

Tu décris les effets visuels — tout glassmorphisme avec son niveau de flou et
son opacité, tout gradient avec ses deux couleurs de départ et d'arrivée et son angle,
tout effet de profondeur, tout highlight ou glow autour d'un élément, toute texture
subtile. Tu décris la densité générale de l'interface — est-ce qu'il y a beaucoup
d'espace blanc ou est-ce compact, est-ce que les éléments respirent ou sont serrés.
Tu décris le rythme visuel — est-ce que les sections ont la même taille ou varient-elles.

Tu termines par un bloc structuré de tokens de design, sous la forme de variables
CSS commentées, avec les valeurs exactes que tu as observées ou déduites de l'image.
Ces tokens sont la synthèse exploitable de tout ce que tu viens de décrire.

Tu présentes tout cela comme ta vision créative pour le projet — jamais comme
une description d'image de référence. C'est ta proposition de design, et elle est
intégrale, sans lacune, sans approximation.
    `,
  },

  // ── Master Blueprint ──────────────────────────────────────────────────────────
  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    temperature: 0.1,
    prompt: `
Tu es un Architecte Logiciel Senior. Tu n'écris pas de code.
Tu produis le Blueprint technique — loi absolue pour le Builder.

CLASSIFICATION (première ligne obligatoire) :
  CLASSIFICATION: CHAT_ONLY | FIX_ACTION | CODE_ACTION

FEATURE BLUEPRINT (si CODE_ACTION ou FIX_ACTION) :
<feature id="F01" name="[nom]" priority="CORE|HIGH|MEDIUM">
  <what>Ce que l'utilisateur obtient</what>
  <real_package>package npm exact</real_package>
  <real_service>Service tiers si applicable</real_service>
  <env_vars>VAR_1, VAR_2</env_vars>
  <real_implementation>SDK exact, endpoint, pattern</real_implementation>
  <forbidden>Ce que le Builder NE DOIT PAS faire</forbidden>
  <typescript_requirements>@types requis</typescript_requirements>
  <architecture_patterns>
    - NextAuth : authOptions dans lib/auth.ts UNIQUEMENT
    - Next.js 15 : params → Promise<{id:string}> + await
    - Route handlers : export GET/POST nommés uniquement
    - Zustand : () => void dans interface, corps dans create()
    - Framer-motion : boxShadow (jamais shadow), scale: 1.05 (jamais scale-105)
    - Icônes : Iconoir/Iconsax pour home+settings+library, Lucide pour le reste
  </architecture_patterns>
  <files_to_create>liste</files_to_create>
</feature>

MAPPINGS : charts→lightweight-charts | prix live→finnhub-node | audio→howler
  maps→react-leaflet+leaflet | auth→next-auth | paiements→stripe
  chat IA→openai | emails→resend | DB→drizzle-orm

<build_order>F01, F02...</build_order>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ── Full Stack Builder ────────────────────────────────────────────────────────
  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    temperature: 0.4,
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint et un Design Contract. Les deux sont tes lois absolues.
Tu as aussi accès aux images de référence directement dans le contexte — garde-les
constamment en mémoire pendant que tu codes. Chaque composant que tu génères,
retourne mentalement à l'image et vérifie que ce que tu produis correspond exactement
à ce que tu vois. Ne perds jamais le fil visuel de l'image.

${SURCOUCHE_VISUAL_LAW}

LOI ANTI-GHOSTING — FONCTIONNALITÉS RÉELLES UNIQUEMENT

Avant d'écrire la première ligne, rappelle-toi : chaque élément UI est cent pourcent
fonctionnel. Aucun bouton vide. Aucun lien mort. Aucune vue générique dupliquée.
Chaque menu a sa propre vue dans components/views/[Name]View.tsx. Tous les modals
sont dans components/Modals.tsx. Les filtres filtrent vraiment. Les recherches cherchent
vraiment. Les formulaires soumettent vraiment vers des endpoints réels.

LOI TYPESCRIPT STRICT — ZÉRO ERREUR DE BUILD

lib/env.ts est toujours le premier fichier. Route params Next.js 15 sont toujours des
Promise<{id:string}> qu'on await. Les interfaces Zustand contiennent uniquement des
signatures () => void, les corps vont dans create(). Le 'use client' est présent sur
chaque composant qui utilise des hooks React. Les route handlers exportent GET/POST
nommés uniquement. Chaque appel API externe est dans un try/catch.

STRUCTURE D'ORDRE :
lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/index.ts
→ hooks/ → components/ui/ → components/Modals.tsx
→ components/views/[Name]View.tsx → app/api/.../route.ts → app/page.tsx

FORMAT :
<create_file path="lib/env.ts">...</create_file>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ── Code Validator ────────────────────────────────────────────────────────────
  CODE_VALIDATOR: {
    name: "Code Validator",
    temperature: 0.05,
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
Règle première et absolue : ne pas nuire. Tu ne modifies que ce qui casse npm run build.
Tu ne touches pas au design. Tu ne simplifies pas. Tu ne touches pas aux fichiers sans erreur.

Catégories autorisées :
A. Imports invalides (fichier absent, named vs default mismatch)
B. TypeScript : ClassValue non importé, corps dans interface Zustand, any implicite
C. Next.js 15 : params sans Promise/await, export default dans handler, use client manquant
D. Framer-motion : shadow → boxShadow, scale-105 → scale: 1.05
E. Syntaxe : JSX non fermé, accolades manquantes

Si tout correct → ALL_FILES_VALID

Sinon :
ERRORS_FOUND:
- [fichier]: [erreur]
<create_file path="...">...</create_file>
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  // ── Bug Fixer ─────────────────────────────────────────────────────────────────
  FIXER: {
    name: "Bug Fixer",
    temperature: 0.15,
    prompt: `
Tu es un expert en débogage Next.js / TypeScript. Cause racine uniquement. Chirurgical.

Corrections classiques :
"Could not find declaration file"  → DEVDEPENDENCIES: ["@types/X"]
"handler not exported"             → authOptions dans lib/auth.ts
"params is not a Promise"          → Promise<{id:string}> + await
"Expected ';', got '('"            → Corps dans interface Zustand
"Cannot find name 'ClassValue'"   → import { cn } from "@/lib/utils"
"shadow does not exist"           → shadow → boxShadow

FORMAT : <create_file path="...">...</create_file>
DEPENDENCIES: []
DEVDEPENDENCIES: []
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
    const { history, uploadedImages, allReferenceImages, currentProjectFiles } = body;
    const lastUserMessage = history.filter((m: any) => m.role === "user").pop()?.content || "";
    const ai = new GoogleGenAI({ apiKey });

    const colorPalettePrompt = await buildColorPalettePrompt(uploadedImages ?? [], allReferenceImages ?? []);
    const hasImages = (uploadedImages?.length ?? 0) + (allReferenceImages?.length ?? 0) > 0;

    const VIRTUAL_COMPILER_RULES = `
=== AUTO-VÉRIFICATION AVANT CHAQUE FICHIER ===
□ Icônes home/settings/library → Iconoir ou Iconsax React
□ Toutes autres icônes → Lucide React
□ Logos de marques dans sidebar/navbar → logo.clearbit.com/[domain]
□ Ombres → multi-couches (jamais shadow-sm/md/lg basiques)
□ Transitions → présentes sur chaque élément interactif avec hover
□ Sidebar items → hauteur 30-32px, texte small semibold, radius petit
□ Sidebar sections → label uppercase sans chevron, pas de nom sur la première section
□ Layout type 1 → sidebar même fond que page, main content avec border subtile et arrondi 6px
□ Inputs / searchbox → radius modéré, height réduite, fond identique au conteneur
□ Textarea chat → 3 zones (uploads, textarea sans border, boutons)
□ Avatars → dicebear ou ui-avatars (jamais cercle gris vide)
□ Framer-motion → boxShadow (JAMAIS shadow), scale:1.05 (JAMAIS scale-105)
□ Next.js 15 → params Promise + await, route handlers GET/POST nommés
□ Zustand → interface signatures () => void uniquement
□ 'use client' → obligatoire si hooks React
□ Chaque vue sidebar = fichier unique | Tous modals dans Modals.tsx
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string>    = new Set();
    const globalDevPackages: Set<string> = new Set();

    // Les images de référence sont injectées dans chaque appel agent qui en a besoin
    const buildFullHistory = (extra = "", includeImages = false) => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];

      // Images de référence au début du contexte (si demandé)
      if (includeImages && allReferenceImages?.length > 0) {
        const imgParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...imgParts, { text: "[IMAGES DE RÉFÉRENCE DESIGN — garde-les en mémoire pour chaque composant que tu génères]" }] });
      }

      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length - 1 && role === "user" && uploadedImages?.length > 0) {
          uploadedImages.forEach((img: string) => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
          parts.push({ text: "\n[IMAGES UPLOADÉES PAR L'UTILISATEUR]" });
        }
        contents.push({ role, parts });
      });

      if (extra) contents.push({ role: "user", parts: [{ text: `\n\n=== MÉMOIRE DU WORKFLOW ===\n${extra}` }] });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        sendRaw = (txt: string) => {
          const cleaned = txt
            .replace(/```xml\n?/gi, "").replace(/```tsx\n?/gi, "").replace(/```ts\n?/gi, "")
            .replace(/```html\n?/gi, "").replace(/```css\n?/gi, "").replace(/```json\n?/gi, "")
            .replace(/```\n?/g, "");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };

        const send = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);

        const phaseStart = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "processing"));
        const phaseDone  = (id: string, icon: string, label: string, detail = "") => {
          sendRaw(`<script>(function(){var el=document.querySelector('[data-phase-id="${id}"]');if(el){el.outerHTML=${JSON.stringify(phaseBlock(id, icon, label, "done", detail))};}})()</script>`);
          sendRaw(phaseBlock(id, icon, label, "done", detail));
        };
        const phaseError = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "error"));

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
                if (buffer.length >= BATCH_SIZE) { if (!silent) send(buffer, filterXml); buffer = ""; }
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

        // ════════════════════════════════════════════════════════════════════
        // ORCHESTRATION
        // ════════════════════════════════════════════════════════════════════
        try {

          // ── PHASE 0 : DESIGN ANALYST ────────────────────────────────────
          let designContract = "";
          if (hasImages) {
            phaseStart("design", SVG_PALETTE, "Ultra-analyse du design...");
            try {
              designContract = await runAgent(
                "DESIGN_ANALYST",
                `Analyse avec une précision absolue toutes les images présentes dans ce contexte.
                 Produis le bloc de texte d'ultra-analyse complet — aucun élément visuel ne doit
                 manquer, du plus grand au plus petit. Projet cible : "${lastUserMessage}"`,
                "",
                { silent: true, includeImages: true }
              );
              const words = designContract.split(/\s+/).filter(Boolean).length;
              phaseDone("design", SVG_PALETTE, "Design Contract établi", `${words} mots d'analyse`);
            } catch {
              phaseError("design", SVG_PALETTE, "Analyse design — erreur");
            }
          }

          // ── PHASE 1 : MASTER BLUEPRINT ──────────────────────────────────
          phaseStart("blueprint", SVG_SEARCH, "Analyse du projet...");
          const blueprintOutput = await runAgent(
            "MASTER_BLUEPRINT",
            `Analyse cette demande et produis le Blueprint. Demande : "${lastUserMessage}"`,
            "",
            { silent: true }
          );
          const classMatch = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision   = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            phaseDone("blueprint", SVG_SEARCH, "Analyse terminée");
            send(filterBlueprintXml(blueprintOutput));
            controller.close(); return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g) ?? []).length;
          phaseDone("blueprint", SVG_SEARCH, "Blueprint établi", `${featureCount} feature${featureCount > 1 ? "s" : ""}`);

          // ── FIX ACTION ──────────────────────────────────────────────────
          if (decision === "FIX_ACTION") {
            phaseStart("fixer", SVG_WRENCH, "Correction du bug...");
            const codeCtx = currentProjectFiles
              ? currentProjectFiles.map((f: any) => `\n--- ${f.path} ---\n${f.content}`).join("\n")
              : "";
            await runAgent("FIXER", `Bug : "${lastUserMessage}"`,
              `${blueprintOutput}\n\n=== CODEBASE ===\n${codeCtx}`,
              { captureFiles: true }
            );
            const { files: pF, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const total = Object.values(report).flat().length;
            for (const fp of Object.keys(report)) { const c = pF.find(x => x.path === fp); if (c) send(`<create_file path="${c.path}">\n${c.content}\n</create_file>`); }
            phaseDone("fixer", SVG_WRENCH, "Bug corrigé", total > 0 ? `${total} correction(s)` : "");
            send("\n[PAGE_DONE]\n"); controller.close(); return;
          }

          // ── PHASE A : BUILDER ───────────────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code...");
          await runAgent(
            "FULL_STACK_BUILDER",
            `Blueprint et Design Contract reçus. Tu as aussi les images de référence dans ce
             contexte — reviens mentalement à ces images à chaque composant que tu génères.
             Premier fichier obligatoire : lib/env.ts, puis lib/utils.ts.
             Applique la vision design du SURCOUCHE et respecte le Design Contract à la lettre.`,
            `=== BLUEPRINT ===\n${blueprintOutput}\n\n=== DESIGN CONTRACT ===\n${designContract}`,
            { captureFiles: true, includeImages: true }
          );
          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE ────────────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction des patterns TypeScript...");
          const { files: pFixed, report: fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;
          if (totalFixes > 0) {
            for (const fp of Object.keys(fixReport)) {
              const idx = allGeneratedFiles.findIndex(f => f.path === fp);
              const corrected = pFixed.find(f => f.path === fp);
              if (idx >= 0 && corrected) { allGeneratedFiles[idx] = corrected; send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`); }
            }
            phaseDone("autofixer", SVG_WRENCH, "Patterns corrigés", `${totalFixes} correction(s)`);
          } else { phaseDone("autofixer", SVG_WRENCH, "Aucun pattern à corriger"); }

          // ── PHASE C : VALIDATEUR LLM ────────────────────────────────────
          phaseStart("validator", SVG_SHIELD, "Validation TypeScript & Next.js 15...");
          const filesForVal = allGeneratedFiles.map(f => `\n=== ${f.path} ===\n${f.content}`).join("\n");
          const validatorOutput = await runAgent(
            "CODE_VALIDATOR",
            `Valide ces ${allGeneratedFiles.length} fichiers. Ne modifie QUE les erreurs de build.`,
            `=== FICHIERS ===\n${filesForVal}\n\n=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles: true }
          );
          if (validatorOutput.includes("ALL_FILES_VALID")) {
            phaseDone("validator", SVG_SHIELD, "Validation OK");
          } else {
            const errCount = (validatorOutput.match(/^-\s/gm) ?? []).length;
            phaseDone("validator", SVG_SHIELD, "Erreurs corrigées", `${errCount} correction(s)`);
          }

          // ── PHASE D : SURCOUCHE DÉTERMINISTE ───────────────────────────
          phaseStart("surcouche", SVG_SPARKLES, "Amplification visuelle...");
          const { files: sFiles, shadowCount, logoCount, avatarCount, totalFiles: sfTotal } = runSurcoucheDeterministe(allGeneratedFiles);
          const surcoucheTotal = shadowCount + logoCount + avatarCount;
          if (surcoucheTotal > 0) {
            for (const enhanced of sFiles) {
              const original = allGeneratedFiles.find(f => f.path === enhanced.path);
              if (!original) {
                allGeneratedFiles.push(enhanced);
                send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
              } else if (original.content !== enhanced.content) {
                const idx = allGeneratedFiles.findIndex(f => f.path === enhanced.path);
                if (idx >= 0) allGeneratedFiles[idx] = enhanced;
                send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
              }
            }
            const details: string[] = [];
            if (logoCount > 0)   details.push(`${logoCount} logo${logoCount > 1 ? "s" : ""} réel`);
            if (shadowCount > 0) details.push(`ombres premium`);
            if (avatarCount > 0) details.push(`${avatarCount} avatar${avatarCount > 1 ? "s" : ""}`);
            phaseDone("surcouche", SVG_SPARKLES, "Design amplifié", details.join(" · "));
          } else { phaseDone("surcouche", SVG_SPARKLES, "Design déjà optimal"); }

          // ── PHASE E : PACKAGES ──────────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer");
          globalPackages.add("sharp");
          globalPackages.add("clsx");
          globalPackages.add("tailwind-merge");
          // iconsax-react et iconoir-react ajoutés si utilisés
          if (allGeneratedFiles.some(f => f.content.includes("iconsax-react"))) globalPackages.add("iconsax-react");
          if (allGeneratedFiles.some(f => f.content.includes("iconoir-react"))) globalPackages.add("iconoir-react");

          const existingPkg    = currentProjectFiles?.find((f: any) => f.path === "package.json");
          const existingDeps   = existingPkg ? JSON.parse(existingPkg.content).dependencies    ?? {} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies ?? {} : {};

          const baseDeps: Record<string, string> = {
            next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0",
            "lucide-react": "0.475.0", sharp: "0.33.5", clsx: "2.1.1", "tailwind-merge": "2.3.0",
            ...existingDeps,
          };

          const newDeps: Record<string, string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg || baseDeps[pkg]) return;
            try { const d = await packageJson(pkg); newDeps[pkg] = d.version as string; }
            catch { newDeps[pkg] = "latest"; }
          }));

          const autoTypes = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string, string> = { ...autoTypes };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg] || existingDevDeps[pkg]) return;
            try { const d = await packageJson(pkg); allDevTypes[pkg] = d.version as string; }
            catch { allDevTypes[pkg] = "latest"; }
          }));

          const finalDevDeps: Record<string, string> = {
            typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19",
            postcss: "^8", tailwindcss: "^3.4.1", eslint: "^8", "eslint-config-next": "15.0.3",
            ...existingDevDeps, ...allDevTypes,
          };

          const pkgJson = {
            name: "app", version: "1.0.0", private: true,
            scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
            dependencies: { ...baseDeps, ...newDeps },
            devDependencies: finalDevDeps,
          };
          send(`<create_file path="package.json">\n${JSON.stringify(pkgJson, null, 2)}\n</create_file>`);
          phaseDone("packages", SVG_PACKAGE, "Packages résolus", `${Object.keys(newDeps).length} runtime · ${Object.keys(allDevTypes).length} @types`);

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
