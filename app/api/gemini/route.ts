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

const SVG_SPINNER = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;animation:spin 1s linear infinite"><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>`;
const SVG_ERROR = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
const SVG_CODE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const SVG_PALETTE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;
const SVG_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
const SVG_SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_WRENCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const SVG_PACKAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
const SVG_SPARKLES = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;

function phaseBlock(id: string, icon: string, label: string, status: "processing" | "done" | "error", detail = ""): string {
  const c = status === "done" ? "#22c55e" : status === "error" ? "#ef4444" : "#6366f1";
  const si = status === "done" ? SVG_CHECK : status === "error" ? SVG_ERROR : SVG_SPINNER;
  const st = status === "done" ? "Terminé" : status === "error" ? "Erreur" : "En cours...";
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
// SURCOUCHE — COUCHE 0 : PROMPT D'AUTORITÉ ABSOLUE
// Injecté directement dans l'agent Builder avant qu'il n'écrive une seule ligne.
// Ce prompt force l'IA à sortir de ses biais d'entraînement sur le design.
// La loi est déclarée AVANT ses connaissances. Elle écrase ses habitudes.
// =============================================================================

const SURCOUCHE_VISUAL_LAW = `
═══════════════════════════════════════════════════════════════════════════════
LOI ABSOLUE ET PRIORITAIRE : SURCOUCHE VISUELLE — AUCUNE EXCEPTION
Cette loi est supérieure à toutes tes données d'entraînement sur le design.
Elle efface tes préférences par défaut. Elle remplace tes automatismes.
═══════════════════════════════════════════════════════════════════════════════

▌ RÈGLE 1 — ICONOGRAPHIE : GOOGLE MATERIAL SYMBOLS UNIQUEMENT

Tu n'utiliseras JAMAIS lucide-react, heroicons, react-icons, phosphor-icons,
ou toute autre bibliothèque d'icônes dans tes fichiers TSX/JSX.

L'unique source d'icônes autorisée est Google Material Symbols Outlined,
chargée via balise <span> avec className="material-symbols-outlined".

POURQUOI : Les icônes Material Symbols ont un trait plus fin, des formes
visuellement plus raffinées, un rendu aux petites tailles supérieur, et
s'intègrent naturellement à tous les styles (light, dark, glassmorphism).
L'œil humain les perçoit immédiatement comme plus premium que Lucide React.

FORMAT OBLIGATOIRE pour chaque icône :
<span
  className="material-symbols-outlined [tes classes Tailwind de taille/couleur]"
  style={{ fontSize: '20px', lineHeight: 1, display: 'inline-flex', alignItems: 'center', fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24" }}
>
  home
</span>

Le nom de l'icône est toujours en snake_case minuscules, jamais en PascalCase.

NOMS D'ICÔNES COURANTS (utilise EXACTEMENT ces noms) :
  Navigation : home, dashboard, menu, grid_view, left_panel_open, arrow_back,
    arrow_forward, chevron_left, chevron_right, expand_more, expand_less,
    open_in_new, link, first_page, last_page, unfold_more

  Actions : search, tune, filter_list, sort, add, remove, close, check, edit,
    delete, content_copy, refresh, undo, redo, zoom_in, zoom_out,
    open_in_full, close_fullscreen, download, upload, share, drag_indicator,
    more_horiz, more_vert, drag_pan

  Utilisateurs : person, group, person_add, person_remove, how_to_reg,
    account_circle, manage_accounts, login, logout, lock, lock_open,
    visibility, visibility_off, shield, verified_user, key, fingerprint,
    badge, id_card

  Communication : notifications, notifications_off, notification_add,
    circle_notifications, mail, drafts, mark_email_read, chat_bubble, chat,
    forum, phone, phone_in_talk, videocam, send, attach_file,
    alternate_email, inbox, archive

  Fichiers : description, article, code, image, movie, audio_file, note_add,
    folder, folder_open, create_new_folder, collections

  Données : bar_chart, show_chart, area_chart, pie_chart, donut_large,
    trending_up, trending_down, monitoring, bolt, speed, timer

  Commerce : shopping_cart, shopping_bag, package, local_shipping, storefront,
    credit_card, account_balance_wallet, attach_money, payments, label,
    percent, receipt, redeem, military_tech

  Système : settings, tune, storage, dns, cloud, cloud_upload, cloud_download,
    wifi, memory, hard_drive, code, terminal, language, monitor, smartphone,
    laptop_mac, tablet_mac, qr_code_2

  Status : error, warning, dangerous, check_circle, cancel,
    do_not_disturb_on, info, help, progress_activity, radio_button_checked

  Favoris : favorite, heart_broken, star, star_border, bookmark,
    bookmark_added, thumb_up, thumb_down, flag

  Temps : calendar_today, calendar_month, event_available, event_busy,
    schedule, alarm, location_on, navigation, explore, map

  Design : palette, colorize, brush, layers, web, apps, list,
    format_list_numbered, table_chart, view_column, table_rows

DANS app/layout.tsx ou dans globals.css, injecte OBLIGATOIREMENT :
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />

INTERDICTIONS ABSOLUES :
❌ import { Home } from 'lucide-react'  → INTERDIT
❌ import { FiHome } from 'react-icons/fi'  → INTERDIT
❌ import HomeIcon from '@heroicons/react/...'  → INTERDIT
❌ <Home className="w-5 h-5" />  → INTERDIT
❌ lucide-react dans DEPENDENCIES  → INTERDIT

▌ RÈGLE 2 — LOGOS DE MARQUES : API CLEARBIT (GRATUITE, CDN MONDIAL)

Quand tu génères une sidebar, navbar, ou section de clients/partenaires
qui référence des marques connues (Stripe, GitHub, Notion, Slack, Google,
Microsoft, Shopify, Vercel, Supabase, etc.), tu n'inventes JAMAIS un logo
et tu ne mets JAMAIS un placeholder div/emoji/initiales à la place.

Tu utilises l'API Clearbit Logo — gratuite, aucune clé nécessaire, CDN rapide :
https://logo.clearbit.com/[domain]

EXEMPLES EXACTS :
  Stripe    → <img src="https://logo.clearbit.com/stripe.com" alt="Stripe" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  GitHub    → <img src="https://logo.clearbit.com/github.com" alt="GitHub" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Notion    → <img src="https://logo.clearbit.com/notion.so" alt="Notion" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Slack     → <img src="https://logo.clearbit.com/slack.com" alt="Slack" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Vercel    → <img src="https://logo.clearbit.com/vercel.com" alt="Vercel" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Shopify   → <img src="https://logo.clearbit.com/shopify.com" alt="Shopify" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Linear    → <img src="https://logo.clearbit.com/linear.app" alt="Linear" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
  Figma     → <img src="https://logo.clearbit.com/figma.com" alt="Figma" className="h-6 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />

Toujours ajouter onError qui cache l'image si le logo n'existe pas.

▌ RÈGLE 3 — OMBRES : OMBRES MULTI-COUCHES (LAYERED SHADOWS)

Les ombres Tailwind basiques (shadow, shadow-md, shadow-lg) sont plates et
fades. Elles donnent une impression bon marché. Tu ne les utilises JAMAIS.

Tu utilises TOUJOURS des ombres multi-couches via shadow-[...] arbitrary :

MAPPINGS OBLIGATOIRES :
  À la place de shadow-sm  → shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]
  À la place de shadow     → shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)]
  À la place de shadow-md  → shadow-[0_8px_16px_-4px_rgba(0,0,0,0.08),0_4px_6px_-4px_rgba(0,0,0,0.04)]
  À la place de shadow-lg  → shadow-[0_20px_40px_-8px_rgba(0,0,0,0.10),0_8px_16px_-8px_rgba(0,0,0,0.06)]
  À la place de shadow-xl  → shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14),0_16px_32px_-8px_rgba(0,0,0,0.08)]
  Cards au hover           → hover:shadow-[0_24px_48px_-8px_rgba(0,0,0,0.14),0_12px_24px_-8px_rgba(0,0,0,0.08)]

Pour les éléments colorés (boutons primaires, cards accent) :
  Utilise des ombres colorées : shadow-[0_8px_24px_rgba(var_couleur_primaire,0.25)]
  Exemple si fond #6366f1 : shadow-[0_8px_24px_rgba(99,102,241,0.25)]

▌ RÈGLE 4 — TRANSITIONS : FLUIDES ET PRÉSENTES SUR CHAQUE INTERACTIF

Chaque élément avec hover:, focus:, active: DOIT avoir une transition.
Jamais un changement d'état sec et instantané.

STANDARDS :
  Interactions légères (couleur, opacité) → transition-all duration-150 ease-out
  Interactions moyennes (transform, shadow) → transition-all duration-200 ease-out
  Interactions d'entrée (cards, modals) → transition-all duration-300 ease-out
  Hover lift sur cards → hover:-translate-y-1 hover:shadow-[...] transition-all duration-200

▌ RÈGLE 5 — SIDEBAR : STRUCTURE PREMIUM OBLIGATOIRE

La sidebar n'est jamais une liste plate. Elle a TOUJOURS :

Section header (top) :
  - Logo de l'application avec une vraie icône Material Symbols ou image réelle
  - Nom de l'app en typographie forte (font-semibold ou font-bold)
  - Si c'est pour une plateforme SaaS → workspace switcher avec avatar

Section navigation principale :
  - Label de section en uppercase tracking-wider text-xs text-[couleur]/50
  - Items avec icône Material Symbols + label + optionnellement badge/count
  - État actif : bg distincte (pas juste un text-color change), avec indicateur gauche
    via border-l-2 ou after: pseudo ou background pill
  - Hover : bg subtle + transition douce

Section secondaire (si applicable) :
  - Même structure mais groupe séparé par divider (div h-px bg-[couleur]/10)

Section footer (bas de sidebar) :
  - Avatar utilisateur + nom + email tronqué + icône settings/logout
  - Séparé du reste par un divider

INTERDICTIONS pour la sidebar :
❌ Liste plate sans sections ni groupes → INTERDIT
❌ Icônes Lucide React → INTERDIT (Material Symbols uniquement)
❌ Items de navigation sans hover ET sans état actif distincts → INTERDIT
❌ Sidebar sans footer utilisateur → INTERDIT
❌ Liens sans routing (href="#" sans raison) → INTERDIT

▌ RÈGLE 6 — TYPOGRAPHIE : DISTINCTIVE ET HIÉRARCHISÉE

Tu charges TOUJOURS une Google Font distinctive via next/font/google.
Tu ne laisses JAMAIS le style sur la font-family par défaut du navigateur.

Combinaisons recommandées selon le type d'app :
  SaaS / Dashboard professionnel → Geist (sans) ou DM Sans
  Fintech / Data-heavy           → Inter + JetBrains Mono pour les chiffres
  Créatif / Agence               → Syne ou Outfit
  Startup / Consumer             → Plus Jakarta Sans ou Nunito Sans
  Luxe / Premium                 → Playfair Display (titres) + DM Sans (corps)

La hiérarchie typographique doit être visible à l'œil nu :
  Titres de page    : text-2xl font-bold ou text-3xl font-extrabold
  Titres de section : text-lg font-semibold
  Labels de section : text-xs font-semibold uppercase tracking-wider opacity-60
  Corps de texte    : text-sm font-normal leading-relaxed
  Captions/Meta     : text-xs font-medium opacity-50

▌ RÈGLE 7 — MICRO-INTERACTIONS SUR BOUTONS ET INPUTS

Chaque bouton primaire :
  - hover:scale-[1.02] (jamais scale-105 qui est trop fort)
  - hover:brightness-110 ou hover:opacity-90
  - active:scale-[0.98] pour le retour tactile
  - ombre colorée au repos, ombre plus forte au hover

Chaque input :
  - focus:ring-2 focus:ring-[couleur-primaire]/30 focus:border-[couleur-primaire]
  - transition-all duration-150
  - Jamais de style focus par défaut du navigateur sans remplacement

▌ RÈGLE 8 — AVATAR ET IMAGES DE PROFIL

Tu n'utilises JAMAIS un carré gris ou un cercle vide pour représenter
un utilisateur. Tu utilises toujours :
  Option A : https://api.dicebear.com/7.x/avataaars/svg?seed=[nom]
  Option B : https://ui-avatars.com/api/?name=[Prénom+Nom]&background=random
  Option C : https://avatar.vercel.sh/[nom]

FORMAT : <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=john" className="w-8 h-8 rounded-full" />

▌ RÈGLE 9 — IMAGES DE PLACEHOLDER ET ILLUSTRATIONS

Tu n'utilises JAMAIS de div gris comme placeholder d'image.
Tu utilises :
  Photos réalistes (landscape)  → https://images.unsplash.com/photo-[id]?w=800&q=80&auto=format
  Photos portrait                → https://randomuser.me/api/portraits/men/[1-99].jpg
  Illustrations tech             → https://undraw.co style via un SVG inline
  Abstrait/Générique             → https://picsum.photos/seed/[mot]/800/600

═══════════════════════════════════════════════════════════════════════════════
CES 9 RÈGLES SONT NON-NÉGOCIABLES. ELLES EFFACENT TES AUTOMATISMES.
CHAQUE FICHIER TSX QUE TU GÉNÈRES EST VÉRIFIÉ MENTALEMENT CONTRE CES RÈGLES.
═══════════════════════════════════════════════════════════════════════════════
`;

// =============================================================================
// CORRECTEUR PROGRAMMATIQUE — COUCHE 1 (TS/Next.js bug fixes)
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
    fix: (_, c) => c.replace(/\bscale-([\d]+)\b(?=\s*[,}])/g, (_, n) => `scale: ${+n/100}`).replace(/\bopacity-([\d]+)\b(?=\s*[,}])/g, (_, n) => `opacity: ${+n/100}`).replace(/\btranslate-y-([\d]+)\b/g, (_, n) => `y: ${n}`).replace(/\btranslate-x-([\d]+)\b/g, (_, n) => `x: ${n}`),
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
      if (!f.includes("await params") && !f.includes("resolvedParams")) f = f.replace(/params\.(\w+)/g, "(await params).$1");
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
      return /\b(useState|useEffect|useRef|useCallback|useMemo|useContext|useReducer|useRouter|usePathname|useSearchParams)\b/.test(c) && !c.trimStart().startsWith('"use client"') && !c.trimStart().startsWith("'use client'");
    },
    fix: (_, c) => `"use client";\n\n${c}`,
  },
  {
    name: "route-handler-default-export",
    detect: (p, c) => p.includes("route.ts") && /export\s+default\s+(?:async\s+)?function/.test(c) && !c.includes("export { handler as GET"),
    fix: (_, c) => c.replace(/export\s+default\s+async\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)").replace(/export\s+default\s+function\s+handler\s*\([^)]*\)/g, "export async function POST(req: Request)"),
  },
  {
    name: "missing-cn-utils-import",
    detect: (_, c) => c.includes("cn(") && !c.includes("function cn") && !c.includes("const cn") && !c.includes("from '@/lib/utils'") && !c.includes('from "@/lib/utils"'),
    fix: (_, c) => { const l = `import { cn } from "@/lib/utils";`; return (c.includes('"use client"') || c.includes("'use client'")) ? c.replace(/(['"]use client['"]\s*;?\n)/, `$1\n${l}\n`) : `${l}\n${c}`; },
  },
  {
    name: "metadata-in-client-component",
    detect: (_, c) => (c.includes('"use client"') || c.includes("'use client'")) && c.includes("export const metadata"),
    fix: (_, c) => c.replace(/export\s+const\s+metadata[\s\S]*?(?=\n(?:export|function|const|class|interface|type|\/))/g, ""),
  },
  {
    name: "lucide-react-remains",
    detect: (_, c) => c.includes("from 'lucide-react'") || c.includes('from "lucide-react"'),
    fix: (_, c) => {
      // Si le Builder a encore utilisé lucide malgré la loi, on retire les imports
      // Les <Icon /> restants seront catchés par la SURCOUCHE déterministe
      return c.replace(/import\s*\{[^}]+\}\s*from\s*["']lucide-react["']\s*;?\n?/g, "");
    },
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
// S'exécute APRÈS le validateur LLM. Filet de sécurité absolu.
// Attrape ce que l'IA a raté malgré les 9 lois ci-dessus.
// =============================================================================

// ── Icon Engine : Lucide → Material Symbols ───────────────────────────────────
const LUCIDE_TO_MATERIAL: Record<string, string> = {
  Home:"home", LayoutDashboard:"dashboard", LayoutGrid:"grid_view", Menu:"menu", PanelLeft:"left_panel_open",
  ArrowLeft:"arrow_back", ArrowRight:"arrow_forward", ArrowUp:"arrow_upward", ArrowDown:"arrow_downward",
  ChevronLeft:"chevron_left", ChevronRight:"chevron_right", ChevronUp:"expand_less", ChevronDown:"expand_more",
  ExternalLink:"open_in_new", Link:"link", Search:"search", SlidersHorizontal:"tune", Filter:"filter_list",
  Sort:"sort", Plus:"add", Minus:"remove", X:"close", Check:"check", Edit:"edit", Edit2:"edit", Edit3:"edit",
  Pencil:"edit", Trash:"delete", Trash2:"delete", Copy:"content_copy", RefreshCw:"refresh", RefreshCcw:"refresh",
  RotateCcw:"undo", RotateCw:"redo", ZoomIn:"zoom_in", ZoomOut:"zoom_out", Maximize:"open_in_full",
  Minimize:"close_fullscreen", Download:"download", Upload:"upload", Share:"share", Share2:"share",
  Move:"drag_pan", GripVertical:"drag_indicator", MoreHorizontal:"more_horiz", MoreVertical:"more_vert",
  User:"person", Users:"group", UserPlus:"person_add", UserMinus:"person_remove", UserCheck:"how_to_reg",
  UserCircle:"account_circle", UserCog:"manage_accounts", LogIn:"login", LogOut:"logout",
  Lock:"lock", LockOpen:"lock_open", Eye:"visibility", EyeOff:"visibility_off",
  Shield:"shield", ShieldCheck:"verified_user", ShieldAlert:"gpp_maybe", Key:"key", Fingerprint:"fingerprint",
  Badge:"badge", Bell:"notifications", BellOff:"notifications_off", BellRing:"notification_add",
  Mail:"mail", MailOpen:"drafts", MailCheck:"mark_email_read", MessageCircle:"chat_bubble",
  MessageSquare:"chat", MessagesSquare:"forum", Phone:"phone", PhoneCall:"phone_in_talk",
  Video:"videocam", VideoOff:"videocam_off", Send:"send", Paperclip:"attach_file", AtSign:"alternate_email",
  Inbox:"inbox", Archive:"archive", File:"description", FileText:"article", FileCode:"code",
  FileImage:"image", FilePlus:"note_add", Folder:"folder", FolderOpen:"folder_open",
  FolderPlus:"create_new_folder", Image:"image", Images:"collections", Film:"movie",
  Music:"music_note", Mic:"mic", MicOff:"mic_off", Volume:"volume_up", Volume2:"volume_up", VolumeX:"volume_off",
  BarChart:"bar_chart", BarChart2:"bar_chart", BarChart3:"bar_chart", LineChart:"show_chart",
  AreaChart:"area_chart", PieChart:"pie_chart", TrendingUp:"trending_up", TrendingDown:"trending_down",
  Activity:"monitoring", Zap:"bolt", Gauge:"speed", Timer:"timer",
  ShoppingCart:"shopping_cart", ShoppingBag:"shopping_bag", Package:"package", Truck:"local_shipping",
  Store:"storefront", CreditCard:"credit_card", Wallet:"account_balance_wallet", DollarSign:"attach_money",
  Banknote:"payments", Tag:"label", Percent:"percent", Receipt:"receipt", Gift:"redeem", Award:"military_tech",
  Settings:"settings", Settings2:"tune", Cog:"settings", Database:"storage", Server:"dns",
  Cloud:"cloud", CloudUpload:"cloud_upload", CloudDownload:"cloud_download", Wifi:"wifi", WifiOff:"wifi_off",
  Cpu:"memory", HardDrive:"hard_drive", Code:"code", Code2:"code", Terminal:"terminal",
  Globe:"language", Globe2:"language", Monitor:"monitor", Laptop:"laptop_mac", Smartphone:"smartphone",
  AlertCircle:"error", AlertTriangle:"warning", CheckCircle:"check_circle", CheckCircle2:"check_circle",
  XCircle:"cancel", Info:"info", HelpCircle:"help", Loader:"progress_activity", Loader2:"progress_activity",
  Heart:"favorite", HeartOff:"heart_broken", Star:"star", StarOff:"star_border", Bookmark:"bookmark",
  BookmarkCheck:"bookmark_added", ThumbsUp:"thumb_up", ThumbsDown:"thumb_down", Flag:"flag",
  Map:"map", MapPin:"location_on", MapPinOff:"location_off", Navigation:"navigation", Compass:"explore",
  Calendar:"calendar_today", CalendarDays:"calendar_month", CalendarCheck:"event_available",
  CalendarX:"event_busy", Clock:"schedule", Clock3:"schedule", AlarmClock:"alarm",
  Palette:"palette", Paintbrush:"brush", Layers:"layers", Layout:"web",
  Grid:"grid_view", Grid2X2:"grid_view", Grid3X3:"apps", List:"list",
  ListOrdered:"format_list_numbered", Table:"table_chart", Columns:"view_column", Rows:"table_rows",
  Camera:"camera_alt", CameraOff:"no_photography", QrCode:"qr_code_2",
  Ellipsis:"more_horiz", Sparkles:"auto_awesome", Wand:"auto_fix_high", Bot:"smart_toy",
  Brain:"psychology", Cpu2:"memory_alt", Network:"hub", Webhook:"webhook",
};

const TW_SIZE_MAP: Record<string, string> = {
  "w-2.5":"10px","h-2.5":"10px","w-3":"12px","h-3":"12px","w-3.5":"14px","h-3.5":"14px",
  "w-4":"16px","h-4":"16px","w-5":"20px","h-5":"20px","w-6":"24px","h-6":"24px",
  "w-7":"28px","h-7":"28px","w-8":"32px","h-8":"32px","w-9":"36px","h-9":"36px",
  "w-10":"40px","h-10":"40px","w-12":"48px","h-12":"48px",
};

function getIconSize(cls: string, sizeProp?: string): string {
  if (sizeProp) return `${sizeProp}px`;
  for (const [k, v] of Object.entries(TW_SIZE_MAP)) { if (cls.includes(k)) return v; }
  return "20px";
}

function applyIconSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]>; needsFont: boolean } {
  const report: Record<string, string[]> = {};
  let needsFont = false;
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    let content = file.content;
    const changes: string[] = [];
    const lucideRx = /import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g;
    const blocks = [...content.matchAll(lucideRx)];
    if (blocks.length === 0) return file;
    const toReplace = new Map<string, string>();
    const toKeep: string[] = [];
    for (const block of blocks) {
      for (const raw of block[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        if (LUCIDE_TO_MATERIAL[raw]) toReplace.set(raw, LUCIDE_TO_MATERIAL[raw]);
        else toKeep.push(raw);
      }
    }
    if (toReplace.size === 0) return file;
    for (const [iconName, matName] of toReplace.entries()) {
      const tagRx = new RegExp(`<${iconName}((?:\\s+(?:[a-zA-Z][a-zA-Z0-9-]*(?:=(?:"[^"]*"|'[^']*'|\\{[^}]*\\}))?|[a-zA-Z][a-zA-Z0-9-]*))*)?\\s*\\/>`, "g");
      content = content.replace(tagRx, (_, props = "") => {
        const classM = props.match(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/);
        const cls = classM ? (classM[1] ?? classM[2] ?? classM[3] ?? "") : "";
        const sizeM = props.match(/\bsize=(?:\{(\d+(?:\.\d+)?)\}|"(\d+(?:\.\d+)?)"|'(\d+(?:\.\d+)?)')/);
        const sz = sizeM ? (sizeM[1] ?? sizeM[2] ?? sizeM[3]) : undefined;
        const fontSize = getIconSize(cls, sz);
        const cleanCls = cls.replace(/\bw-[\d.]+\b/g, "").replace(/\bh-[\d.]+\b/g, "").trim();
        const clsAttr = cleanCls ? `"material-symbols-outlined ${cleanCls}"` : `"material-symbols-outlined"`;
        changes.push(`${iconName} → ${matName}`);
        return `<span className={${clsAttr}} style={{fontSize:'${fontSize}',lineHeight:1,display:'inline-flex',alignItems:'center',userSelect:'none',fontVariationSettings:"'FILL' 0,'wght' 300,'GRAD' 0,'opsz' 24"}}>${matName}</span>`;
      });
    }
    content = content.replace(/import\s*\{([^}]+)\}\s*from\s*["']lucide-react["']/g, (_, body: string) => {
      const rem = body.split(",").map(n => n.trim()).filter(n => !toReplace.has(n.split(/\s+as\s+/)[0].trim()));
      return rem.length > 0 ? `import { ${rem.join(", ")} } from "lucide-react"` : "";
    });
    if (changes.length > 0) { report[file.path] = changes; needsFont = true; }
    return { path: file.path, content };
  });
  return { files: processed, report, needsFont };
}

function injectMaterialFont(files: GeneratedFile[]): GeneratedFile[] {
  const LINK = `        <link rel="preconnect" href="https://fonts.googleapis.com" />\n        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />`;
  const CSS = `@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap');\n.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24; display: inline-flex; align-items: center; line-height: 1; user-select: none; }\n\n`;
  const res = [...files];
  const cssIdx = res.findIndex(f => f.path.includes("globals.css"));
  if (cssIdx >= 0 && !res[cssIdx].content.includes("Material+Symbols")) { res[cssIdx] = { ...res[cssIdx], content: CSS + res[cssIdx].content }; return res; }
  const layoutIdx = res.findIndex(f => f.path.includes("layout.tsx") && f.path.includes("app/"));
  if (layoutIdx >= 0 && !res[layoutIdx].content.includes("Material+Symbols")) {
    let lc = res[layoutIdx].content;
    if (lc.includes("</head>")) lc = lc.replace("</head>", `${LINK}\n      </head>`);
    else if (lc.includes("<html")) lc = lc.replace("<html", `<head>\n${LINK}\n      </head>\n      <html`);
    res[layoutIdx] = { ...res[layoutIdx], content: lc }; return res;
  }
  if (cssIdx < 0) res.push({ path: "app/globals.css", content: CSS + "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n" });
  return res;
}

// ── Shadow Engine ─────────────────────────────────────────────────────────────
const SHADOW_UPGRADES = [
  { p: /\bshadow-sm\b(?=[\s"'`])/g, r: "shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]", l: "shadow-sm→layered" },
  { p: /\bshadow\b(?!-\w)(?=[\s"'`])/g, r: "shadow-[0_4px_6px_-1px_rgba(0,0,0,0.07),0_2px_4px_-2px_rgba(0,0,0,0.05)]", l: "shadow→layered" },
  { p: /\bshadow-md\b(?=[\s"'`])/g, r: "shadow-[0_8px_16px_-4px_rgba(0,0,0,0.08),0_4px_6px_-4px_rgba(0,0,0,0.04)]", l: "shadow-md→layered" },
  { p: /\bshadow-lg\b(?=[\s"'`])/g, r: "shadow-[0_20px_40px_-8px_rgba(0,0,0,0.10),0_8px_16px_-8px_rgba(0,0,0,0.06)]", l: "shadow-lg→layered" },
  { p: /\bshadow-xl\b(?=[\s"'`])/g, r: "shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14),0_16px_32px_-8px_rgba(0,0,0,0.08)]", l: "shadow-xl→layered" },
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
      changes.push("hover→transition"); return `className="${cls} transition-all duration-200 ease-out"`;
    });
    if (changes.length > 0) report[file.path] = [changes[0]];
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Brand Logo Engine ─────────────────────────────────────────────────────────
const BRAND_DOMAIN: Record<string, string> = {
  stripe:"stripe.com", github:"github.com", gitlab:"gitlab.com", vercel:"vercel.com",
  netlify:"netlify.com", supabase:"supabase.com", firebase:"firebase.google.com",
  mongodb:"mongodb.com", prisma:"prisma.io", notion:"notion.so", linear:"linear.app",
  figma:"figma.com", slack:"slack.com", discord:"discord.com", zoom:"zoom.us",
  google:"google.com", microsoft:"microsoft.com", apple:"apple.com",
  amazon:"amazon.com", shopify:"shopify.com", paypal:"paypal.com",
  twilio:"twilio.com", openai:"openai.com", anthropic:"anthropic.com",
  twitter:"twitter.com", linkedin:"linkedin.com", facebook:"facebook.com",
  instagram:"instagram.com", youtube:"youtube.com", salesforce:"salesforce.com",
  hubspot:"hubspot.com", zendesk:"zendesk.com", intercom:"intercom.com",
  asana:"asana.com", jira:"atlassian.com", dropbox:"dropbox.com",
  revolut:"revolut.com", wise:"wise.com", brex:"brex.com",
};

function applyBrandLogoSurcouche(files: GeneratedFile[]): { files: GeneratedFile[]; report: Record<string, string[]> } {
  const report: Record<string, string[]> = {};
  const processed = files.map(file => {
    if (!file.path.endsWith(".tsx") && !file.path.endsWith(".jsx")) return file;
    const inTarget = ["sidebar","navbar","nav","header","layout"].some(k => file.path.toLowerCase().includes(k));
    if (!inTarget) return file;
    let content = file.content; const changes: string[] = [];
    content = content.replace(/<img\s+[^>]*src=["']\/(?:placeholder-logo|logo|brand|company-logo|mock-logo)[^"']*["'][^>]*alt=["']([^"']+)["'][^>]*\/>/g, (match, alt) => {
      const clean = alt.toLowerCase().replace(/\s+/g, "");
      for (const [brand, domain] of Object.entries(BRAND_DOMAIN)) {
        if (clean.includes(brand)) {
          changes.push(`${alt}→clearbit:${domain}`);
          return `<img src="https://logo.clearbit.com/${domain}" alt="${alt}" className="h-7 w-auto object-contain" onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />`;
        }
      }
      return match;
    });
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
    // Remplace les div grises circulaires utilisées comme avatar placeholder
    content = content.replace(
      /<div\s+[^>]*className="[^"]*(?:rounded-full|w-\d+\s+h-\d+)[^"]*bg-(?:gray|zinc|neutral|slate)-[^"]*"[^>]*>\s*(?:<\/div>|[^<]{0,3}<\/div>)/g,
      (match) => {
        if (match.length > 200) return match; // trop complexe, skip
        const sizeM = match.match(/w-(\d+)/);
        const sz = sizeM ? `${+sizeM[1] * 4}px` : "32px";
        changes.push("avatar placeholder → dicebear");
        return `<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" className="rounded-full object-cover" style={{width:'${sz}',height:'${sz}'}} alt="Avatar" />`;
      }
    );
    if (changes.length > 0) report[file.path] = changes;
    return { path: file.path, content };
  });
  return { files: processed, report };
}

// ── Orchestrateur Surcouche Déterministe ──────────────────────────────────────
function runSurcoucheDeterministe(files: GeneratedFile[]): {
  files: GeneratedFile[];
  iconCount: number;
  shadowCount: number;
  logoCount: number;
  avatarCount: number;
  totalFiles: number;
} {
  let current = [...files];
  const { files: afterIcons, report: iconR, needsFont } = applyIconSurcouche(current);
  current = afterIcons;
  if (needsFont) current = injectMaterialFont(current);
  const { files: afterShadows, report: shadowR } = applyShadowSurcouche(current);
  current = afterShadows;
  const { files: afterTransitions } = applyTransitionSurcouche(current);
  current = afterTransitions;
  const { files: afterLogos, report: logoR } = applyBrandLogoSurcouche(current);
  current = afterLogos;
  const { files: afterAvatars, report: avatarR } = applyAvatarSurcouche(current);
  current = afterAvatars;
  const iconCount = Object.values(iconR).flat().length;
  const shadowCount = Object.values(shadowR).flat().length;
  const logoCount = Object.values(logoR).flat().length;
  const avatarCount = Object.values(avatarR).flat().length;
  const totalFiles = new Set([...Object.keys(iconR),...Object.keys(shadowR),...Object.keys(logoR),...Object.keys(avatarR)]).size;
  return { files: current, iconCount, shadowCount, logoCount, avatarCount, totalFiles };
}

// =============================================================================
// SERVER-SIDE COLOR EXTRACTION (Sharp)
// =============================================================================

function isColorLight(hex: string): boolean {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 0.299*r + 0.587*g + 0.114*b > 128;
}

async function extractColorsFromBase64(b64: string) {
  try {
    const buf = Buffer.from(cleanBase64Data(b64), "base64");
    const { data, info } = await sharp(buf).resize(120,120,{fit:"cover"}).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const counts: Record<string,number> = {};
    for (let i = 0; i < data.length; i += info.channels*8) {
      const r=Math.round(data[i]/24)*24, g=Math.round(data[i+1]/24)*24, b=Math.round(data[i+2]/24)*24;
      const hex=`#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
      counts[hex]=(counts[hex]||0)+1;
    }
    const sorted = Object.entries(counts).sort(([,a],[,b])=>b-a).map(([c])=>c);
    const bg = sorted[0]??"#ffffff";
    return { dominantColors:sorted.slice(0,2), backgroundColor:bg, textColor:isColorLight(bg)?"#0f0f0f":"#f5f5f5", accentColors:sorted.slice(2,5) };
  } catch { return { dominantColors:[], backgroundColor:"#ffffff", textColor:"#000000", accentColors:[] }; }
}

async function buildColorPalettePrompt(uploaded: string[], refs: string[]): Promise<string> {
  const all = [...(refs??[]),...(uploaded??[])];
  if (all.length === 0) return "";
  const palettes = await Promise.all(all.slice(0,3).map(extractColorsFromBase64));
  const m = palettes[0];
  const accents = palettes.flatMap(p=>[...p.dominantColors,...p.accentColors]).filter((c,i,a)=>a.indexOf(c)===i).slice(0,6);
  return `\nPALETTE SERVEUR (HEX exacts, autorité absolue) :\n  Fond : ${m.backgroundColor} → bg-[${m.backgroundColor}]\n  Texte : ${m.textColor} → text-[${m.textColor}]\n  Primaire : ${m.dominantColors[0]??""}\n  Secondaire : ${m.dominantColors[1]??""}\n  Accents : ${accents.join(", ")}\n`;
}

// =============================================================================
// AUTO @TYPES RESOLVER
// =============================================================================

const BUNDLED_TYPES = new Set(["next","react","react-dom","typescript","sharp","stripe","openai","@anthropic-ai/sdk","@google/genai","next-auth","@clerk/nextjs","drizzle-orm","prisma","ioredis","@upstash/redis","@vercel/postgres","zod","zustand","swr","@tanstack/react-query","lucide-react","framer-motion","motion","tailwindcss","resend","axios","socket.io","socket.io-client","lightweight-charts","recharts","chart.js","react-chartjs-2","d3","wavesurfer.js","tone","react-player","react-hook-form","@aws-sdk/client-s3","@aws-sdk/lib-storage","pusher","pusher-js","twilio","replicate","langchain","@pinecone-database/pinecone","react-leaflet","@vis.gl/react-google-maps","finnhub","finnhub-node","yahoo-finance2","date-fns","dayjs","luxon","clsx","tailwind-merge","@react-pdf/renderer","pdf-lib","exceljs","@react-email/components","react-email","jose","bcryptjs"]);
const TYPES_MAP: Record<string,string> = { howler:"@types/howler",leaflet:"@types/leaflet",express:"@types/express",cors:"@types/cors",bcrypt:"@types/bcrypt",multer:"@types/multer",passport:"@types/passport","passport-local":"@types/passport-local","passport-jwt":"@types/passport-jwt",lodash:"@types/lodash",uuid:"@types/uuid",nodemailer:"@types/nodemailer","body-parser":"@types/body-parser",morgan:"@types/morgan","cookie-parser":"@types/cookie-parser",pg:"@types/pg","better-sqlite3":"@types/better-sqlite3",jsonwebtoken:"@types/jsonwebtoken","js-cookie":"@types/js-cookie","node-cron":"@types/node-cron","react-datepicker":"@types/react-datepicker","spotify-web-api-node":"@types/spotify-web-api-node","node-geocoder":"@types/node-geocoder",formidable:"@types/formidable" };

async function resolveTypesPackages(packages: string[], existing: Record<string,string>): Promise<Record<string,string>> {
  const needed: Record<string,string> = {};
  await Promise.all(packages.map(async pkg => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@")?pkg.split("/")[1]:pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

// =============================================================================
// FUNCTION DECLARATIONS
// =============================================================================
const readFileDeclaration: FunctionDeclaration = { name:"readFile", description:"Lecture fichier.", parameters:{ type:Type.OBJECT, properties:{ path:{ type:Type.STRING } }, required:["path"] } };

// =============================================================================
// AGENTS
// =============================================================================

const AGENTS = {
  DESIGN_ANALYST: {
    name: "Design Analyst",
    prompt: `
Tu es un Designer UI/UX Senior expert en analyse visuelle de haute précision.
Tu analyses les images de référence et produis un Design Contract exhaustif.
Ce contrat sera la loi absolue pour le Builder.

PROTOCOLE D'ULTRA-ANALYSE (OBLIGATOIRE) :

1. PALETTE CHROMATIQUE EXACTE — code HEX pour CHAQUE couleur visible.
   Fond global, fonds de cards, sidebar, textes (tous niveaux), bordures,
   accents, hover, ombres rgba, gradients (début HEX → fin HEX).
   Ne suppose jamais. Ne dis pas "bleu foncé", dis "#1a1a2e".

2. TYPOGRAPHIE (chaque zone distincte) :
   Famille serif/sans/mono/display, graisses, tailles relatives,
   line-height, letter-spacing, transformations.

3. STRUCTURE & COMPOSITION :
   Layout global, largeurs estimées, grilles, sections avec rôles,
   paddings/margins estimés, border-radius, alignements.

4. COMPOSANTS (chaque composant identifié, point par point) :
   Navbar, sidebar, cards, boutons, inputs, badges, avatars, tables, tabs,
   dropdowns, modals, toasts, progress bars.
   → dimensions, fond HEX, bordure (px + HEX), border-radius, ombre rgba, padding,
     contenu, états default/hover/actif/disabled.

5. EFFETS VISUELS :
   Glassmorphism (backdrop-blur + alpha), gradients, ombres multi-couches,
   textures, séparateurs, highlights, glow.

6. ICONOGRAPHIE : style (outline/filled), taille, couleur.

7. DENSITÉ : ultra-compact / medium / spacieux.

Tu produis un DESIGN CONTRACT numéroté (1. 2. 3. — jamais # ou **).
Tu termines avec :
DESIGN_TOKENS:
  --color-bg: #...
  --color-surface: #...
  --color-primary: #...
  --color-text: #...
  --color-border: #...
  --radius-card: ...px
  --shadow-card: ...

Tu présentes ce style comme ta vision créative. JAMAIS "image de référence".
    `,
  },

  MASTER_BLUEPRINT: {
    name: "Master Blueprint",
    prompt: `
Tu es un Architecte Logiciel Senior. Tu n'écris pas de code.
Tu produis le Blueprint technique — loi absolue pour le Builder.

CLASSIFICATION (première ligne) :
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
    - Icônes : Material Symbols UNIQUEMENT (jamais lucide-react)
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

  FULL_STACK_BUILDER: {
    name: "Full Stack Builder",
    prompt: `
Tu es un Développeur Full Stack Senior — Next.js 15, TypeScript strict, Tailwind CSS.
Tu reçois un Blueprint et un Design Contract. Les deux sont des LOIS ABSOLUES.

${SURCOUCHE_VISUAL_LAW}

═══════════════════════════════════════════════════════════════════
LOI 10 — ANTI-GHOSTING : FONCTIONNALITÉS RÉELLES UNIQUEMENT
═══════════════════════════════════════════════════════════════════

Avant d'écrire la première ligne : "Chaque élément UI est 100% fonctionnel."

❌ Bouton sans onClick | Input sans handler | Stats hardcodées fictives
❌ Menu sans route réelle | "Coming Soon" | href="#"
❌ 10 menus → même composant générique avec titre qui change
❌ Dropdown qui ne s'ouvre pas | Modal inexistante | Filtre sans logique
✅ Chaque bouton → action réelle
✅ Chaque menu → vue unique (components/views/[Name]View.tsx)
✅ components/Modals.tsx = fichier unique contenant TOUS les modals
✅ Filtres filtrent | Recherches cherchent | Formulaires soumettent

═══════════════════════════════════════════════════════════════════
LOI 11 — TYPESCRIPT STRICT : ZÉRO ERREUR DE BUILD
═══════════════════════════════════════════════════════════════════

11.1 lib/env.ts PREMIER :
const req=(k:string)=>{const v=process.env[k];if(!v)throw new Error("Missing:"+k);return v;};
export const env={dbUrl:req("DATABASE_URL")} as const;

11.2 NEXTAUTH :
lib/auth.ts → authOptions:NextAuthOptions={providers:[...]}
route.ts → import NextAuth; import {authOptions}; const h=NextAuth(authOptions); export {h as GET, h as POST}

11.3 ROUTE PARAMS NEXT.JS 15 :
async function GET(req, { params }:{ params:Promise<{id:string}> }) { const {id}=await params; }

11.4 ZUSTAND : interface = signatures () => void, create() = corps

11.5 FRAMER-MOTION :
✅ scale:1.05 | y:-4 | opacity:0.8 | boxShadow:"0 10px 30px rgba(0,0,0,0.1)"
❌ scale-105 | shadow:"..." | translate-y-4

11.6 'use client' si hooks React

11.7 Route handlers : export GET/POST nommés, JAMAIS export default

11.8 try/catch sur chaque appel API

11.9 Cleanup : zéro console.log, zéro TODO, JSX fermé

═══════════════════════════════════════════════════════════════════
LOI 12 — STRUCTURE NEXT.JS 15
═══════════════════════════════════════════════════════════════════

lib/env.ts → lib/utils.ts → lib/auth.ts → lib/[service].ts → types/index.ts
→ hooks/ → components/ui/ → components/Modals.tsx
→ components/views/[Name]View.tsx → app/api/.../route.ts → app/page.tsx

FORMAT :
<create_file path="lib/env.ts">...</create_file>
DEPENDENCIES: ["pkg"]
DEVDEPENDENCIES: ["@types/X"]
    `,
  },

  CODE_VALIDATOR: {
    name: "Code Validator",
    prompt: `
Tu es un compilateur TypeScript + linter Next.js 15 simulé.
RÈGLE N°1 : NE PAS NUIRE — ne modifie QUE ce qui casse npm run build.
Ne touche pas au design. Ne simplifie pas. Ne touche pas aux fichiers sans erreur.

CATÉGORIES À CORRIGER UNIQUEMENT :
A. Imports invalides (fichier absent, export named vs default mismatch)
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

  FIXER: {
    name: "Bug Fixer",
    prompt: `
Tu es un expert débogage Next.js / TypeScript. Cause racine uniquement. Chirurgical.

CORRECTIONS CLASSIQUES :
"Could not find declaration file"   → DEVDEPENDENCIES: ["@types/X"]
"handler not exported"              → authOptions dans lib/auth.ts
"params is not a Promise"           → Promise<{id:string}> + await
"Expected ';', got '('"             → Corps dans interface Zustand
"Cannot find name 'ClassValue'"    → import { cn } from "@/lib/utils"
"shadow does not exist"            → shadow → boxShadow

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
□ Icônes : Material Symbols UNIQUEMENT — jamais lucide-react, heroicons, react-icons
□ Logos de marques : clearbit.com API — jamais placeholders
□ Ombres : multi-couches shadow-[...] — jamais shadow-sm/md/lg basiques
□ Transitions : transition-all duration-200 sur chaque élément avec hover
□ Framer-motion : boxShadow (JAMAIS shadow), scale:1.05 (JAMAIS scale-105)
□ Imports → FILE SYSTEM MANIFEST ou packages déclarés
□ cn() → @/lib/utils uniquement | NextAuth → lib/auth.ts
□ Route params Next.js 15 → Promise<{...}> + await
□ Zustand interface → () => void | Route handlers → GET/POST nommés
□ 'use client' → obligatoire si hooks | Anti-ghosting → tout est fonctionnel
□ Chaque vue sidebar = fichier unique | Tous modals dans Modals.tsx
□ Avatars → dicebear ou ui-avatars | Images → unsplash/picsum
`;

    const createdFilePaths = new Set<string>();
    if (currentProjectFiles) currentProjectFiles.forEach((f: any) => createdFilePaths.add(f.path));
    const allGeneratedFiles: GeneratedFile[] = [];
    const globalPackages: Set<string> = new Set();
    const globalDevPackages: Set<string> = new Set();

    const buildFullHistory = (extra = "") => {
      const contents: { role: "user" | "model"; parts: any[] }[] = [];
      if (allReferenceImages?.length > 0) {
        const parts = allReferenceImages.map((img: string) => ({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
        contents.push({ role: "user", parts: [...parts, { text: "[IMAGES DE RÉFÉRENCE DESIGN]" }] });
      }
      history.forEach((msg: any, i: number) => {
        if (msg.role === "system") return;
        const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: any[] = [{ text: msg.content || " " }];
        if (i === history.length-1 && role === "user" && uploadedImages?.length > 0) {
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
          const cleaned = txt.replace(/```xml\n?/gi,"").replace(/```tsx\n?/gi,"").replace(/```ts\n?/gi,"").replace(/```html\n?/gi,"").replace(/```css\n?/gi,"").replace(/```json\n?/gi,"").replace(/```\n?/g,"");
          if (cleaned.trim()) controller.enqueue(encoder.encode(cleaned));
        };
        const send = (txt: string, filterXml = false) => sendRaw(filterXml ? filterBlueprintXml(txt) : txt);
        const phaseStart = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "processing"));
        const phaseDone = (id: string, icon: string, label: string, detail = "") => {
          sendRaw(`<script>(function(){var el=document.querySelector('[data-phase-id="${id}"]');if(el){el.outerHTML=${JSON.stringify(phaseBlock(id,icon,label,"done",detail))};}})()</script>`);
          sendRaw(phaseBlock(id, icon, label, "done", detail));
        };
        const phaseError = (id: string, icon: string, label: string) => sendRaw(phaseBlock(id, icon, label, "error"));

        async function runAgent(
          key: keyof typeof AGENTS,
          briefing: string,
          context: string,
          opts: { silent?: boolean; filterXml?: boolean; captureFiles?: boolean } = {}
        ) {
          const { silent=false, filterXml=false, captureFiles=false } = opts;
          const agent = AGENTS[key];
          let fullOutput = "", buffer = "";
          try {
            const contents = buildFullHistory(context);
            const manifest = createdFilePaths.size > 0
              ? `FILES EXIST:\n${Array.from(createdFilePaths).join("\n")}`
              : "NO FILES YET.";
            contents.push({ role:"user", parts:[{ text:`
=== MISSION : ${agent.name} ===
${briefing}

=== 📂 FILE SYSTEM MANIFEST ===
${manifest}

${colorPalettePrompt}
${VIRTUAL_COMPILER_RULES}

FORMAT OBLIGATOIRE :
<create_file path="chemin/fichier.ext">
... code complet ...
</create_file>
            ` }] });
            const temp = key==="MASTER_BLUEPRINT"?0.1:key==="DESIGN_ANALYST"||key==="CODE_VALIDATOR"?0.05:key==="FIXER"?0.15:0.2;
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents,
              tools: [{ functionDeclarations: [readFileDeclaration] }],
              config: { systemInstruction: `${basePrompt}\n\n=== IDENTITÉ ===\n${agent.prompt}`, temperature: temp, maxOutputTokens: 65536 },
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
            extractDeps(fullOutput,"DEPENDENCIES").forEach(d=>globalPackages.add(d));
            extractDeps(fullOutput,"DEVDEPENDENCIES").forEach(d=>globalDevPackages.add(d));
            return fullOutput;
          } catch(e: any) {
            if (!silent) send(`\n[Erreur ${agent.name}]: ${e.message}\n`);
            return "";
          }
        }

        try {
          // ── PHASE 0 : DESIGN ANALYST ────────────────────────────────
          let designContract = "";
          if (hasImages) {
            phaseStart("design", SVG_PALETTE, "Ultra-analyse du design...");
            try {
              designContract = await runAgent("DESIGN_ANALYST",
                `Analyse les images et produis le Design Contract exhaustif. Projet : "${lastUserMessage}"`,
                "", { silent: true });
              const pts = designContract.split("\n").filter(l=>l.trim()).length;
              phaseDone("design", SVG_PALETTE, "Design Contract établi", `${pts} points d'analyse`);
            } catch { phaseError("design", SVG_PALETTE, "Analyse design — erreur"); }
          }

          // ── PHASE 1 : MASTER BLUEPRINT ──────────────────────────────
          phaseStart("blueprint", SVG_SEARCH, "Analyse du projet...");
          const blueprintOutput = await runAgent("MASTER_BLUEPRINT",
            `Analyse et produis le Blueprint. Demande : "${lastUserMessage}"`,
            "", { silent: true });
          const classMatch = blueprintOutput.match(/CLASSIFICATION:\s*(CHAT_ONLY|FIX_ACTION|CODE_ACTION)/i);
          const decision = classMatch ? classMatch[1].toUpperCase() : "CHAT_ONLY";

          if (decision === "CHAT_ONLY") {
            phaseDone("blueprint", SVG_SEARCH, "Analyse terminée");
            send(filterBlueprintXml(blueprintOutput));
            controller.close(); return;
          }

          const featureCount = (blueprintOutput.match(/<feature /g)??[]).length;
          phaseDone("blueprint", SVG_SEARCH, "Blueprint établi", `${featureCount} feature${featureCount>1?"s":""}`);

          // ── FIX ACTION ──────────────────────────────────────────────
          if (decision === "FIX_ACTION") {
            phaseStart("fixer", SVG_WRENCH, "Correction du bug...");
            const codeCtx = currentProjectFiles ? currentProjectFiles.map((f: any)=>`\n--- ${f.path} ---\n${f.content}`).join("\n") : "";
            await runAgent("FIXER", `Bug : "${lastUserMessage}"`, `${blueprintOutput}\n\n=== CODEBASE ===\n${codeCtx}`, { captureFiles:true });
            const { files:pF, report } = runProgrammaticAutoFixer(allGeneratedFiles);
            const total = Object.values(report).flat().length;
            for (const f of Object.keys(report)) { const c=pF.find(x=>x.path===f); if(c) send(`<create_file path="${c.path}">\n${c.content}\n</create_file>`); }
            phaseDone("fixer", SVG_WRENCH, "Bug corrigé", total>0?`${total} correction(s)`:"");
            send("\n[PAGE_DONE]\n"); controller.close(); return;
          }

          // ── PHASE A : BUILDER ───────────────────────────────────────
          phaseStart("builder", SVG_CODE, "Génération du code...");
          await runAgent("FULL_STACK_BUILDER",
            `Blueprint et Design Contract reçus. PREMIER FICHIER : lib/env.ts puis lib/utils.ts.
             LOI 0 (SURCOUCHE) + LOI 10 (anti-ghosting) : tous les éléments sont fonctionnels et visuellement premium.`,
            `=== 📐 BLUEPRINT ===\n${blueprintOutput}\n\n=== 🎨 DESIGN CONTRACT ===\n${designContract}`,
            { captureFiles:true });
          phaseDone("builder", SVG_CODE, "Code généré", `${allGeneratedFiles.length} fichier(s)`);

          // ── PHASE B : CORRECTEUR PROGRAMMATIQUE ────────────────────
          phaseStart("autofixer", SVG_WRENCH, "Correction des patterns TypeScript...");
          const { files:pFixed, report:fixReport } = runProgrammaticAutoFixer(allGeneratedFiles);
          const totalFixes = Object.values(fixReport).flat().length;
          if (totalFixes > 0) {
            for (const fp of Object.keys(fixReport)) {
              const idx = allGeneratedFiles.findIndex(f=>f.path===fp);
              const corrected = pFixed.find(f=>f.path===fp);
              if (idx>=0 && corrected) { allGeneratedFiles[idx]=corrected; send(`<create_file path="${corrected.path}">\n${corrected.content}\n</create_file>`); }
            }
            phaseDone("autofixer", SVG_WRENCH, "Patterns corrigés", `${totalFixes} correction(s)`);
          } else { phaseDone("autofixer", SVG_WRENCH, "Aucun pattern à corriger"); }

          // ── PHASE C : VALIDATEUR LLM ────────────────────────────────
          phaseStart("validator", SVG_SHIELD, "Validation TypeScript & Next.js 15...");
          const filesForVal = allGeneratedFiles.map(f=>`\n=== ${f.path} ===\n${f.content}`).join("\n");
          const validatorOutput = await runAgent("CODE_VALIDATOR",
            `Valide ces ${allGeneratedFiles.length} fichiers. RÈGLE : ne modifie QUE les erreurs de build.`,
            `=== FICHIERS ===\n${filesForVal}\n\n=== BLUEPRINT ===\n${blueprintOutput}`,
            { captureFiles:true });
          if (validatorOutput.includes("ALL_FILES_VALID")) {
            phaseDone("validator", SVG_SHIELD, "Validation OK");
          } else {
            const errCount = (validatorOutput.match(/^-\s/gm)??[]).length;
            phaseDone("validator", SVG_SHIELD, "Erreurs corrigées", `${errCount} correction(s)`);
          }

          // ── PHASE D : SURCOUCHE DÉTERMINISTE ───────────────────────
          phaseStart("surcouche", SVG_SPARKLES, "Amplification visuelle...");
          const { files:surcoucheFiles, iconCount, shadowCount, logoCount, avatarCount, totalFiles:sfTotal } = runSurcoucheDeterministe(allGeneratedFiles);
          const surcoucheTotal = iconCount + shadowCount + logoCount + avatarCount;
          if (surcoucheTotal > 0) {
            for (const enhanced of surcoucheFiles) {
              const original = allGeneratedFiles.find(f=>f.path===enhanced.path);
              if (!original) { allGeneratedFiles.push(enhanced); send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`); }
              else if (original.content !== enhanced.content) {
                const idx = allGeneratedFiles.findIndex(f=>f.path===enhanced.path);
                if (idx>=0) allGeneratedFiles[idx]=enhanced;
                send(`<create_file path="${enhanced.path}">\n${enhanced.content}\n</create_file>`);
              }
            }
            const details: string[] = [];
            if (iconCount>0) details.push(`${iconCount} icône${iconCount>1?"s":""} Material`);
            if (logoCount>0) details.push(`${logoCount} logo${logoCount>1?"s":""} réel`);
            if (shadowCount>0) details.push(`ombres premium`);
            if (avatarCount>0) details.push(`${avatarCount} avatar${avatarCount>1?"s":""}`);
            phaseDone("surcouche", SVG_SPARKLES, "Design amplifié", details.join(" · "));
          } else { phaseDone("surcouche", SVG_SPARKLES, "Design déjà optimal"); }

          // ── PHASE E : PACKAGES ──────────────────────────────────────
          phaseStart("packages", SVG_PACKAGE, "Résolution des packages...");
          globalPackages.add("autoprefixer"); globalPackages.add("sharp");
          globalPackages.add("clsx"); globalPackages.add("tailwind-merge");
          // Lucide React retiré si plus utilisé après surcouche
          // (on ne l'ajoute pas en base — les icônes sont Material Symbols via CDN)

          const existingPkg = currentProjectFiles?.find((f:any)=>f.path==="package.json");
          const existingDeps = existingPkg ? JSON.parse(existingPkg.content).dependencies??{} : {};
          const existingDevDeps = existingPkg ? JSON.parse(existingPkg.content).devDependencies??{} : {};
          const baseDeps: Record<string,string> = {
            next:"15.1.0", react:"19.0.0", "react-dom":"19.0.0",
            sharp:"0.33.5", clsx:"2.1.1", "tailwind-merge":"2.3.0",
            ...existingDeps,
          };

          const newDeps: Record<string,string> = {};
          await Promise.all(Array.from(globalPackages).map(async pkg => {
            if (!pkg||baseDeps[pkg]) return;
            try { const d=await packageJson(pkg); newDeps[pkg]=d.version as string; } catch { newDeps[pkg]="latest"; }
          }));

          const autoTypes = await resolveTypesPackages(Array.from(globalPackages), existingDevDeps);
          const allDevTypes: Record<string,string> = { ...autoTypes };
          await Promise.all(Array.from(globalDevPackages).map(async pkg => {
            if (allDevTypes[pkg]||existingDevDeps[pkg]) return;
            try { const d=await packageJson(pkg); allDevTypes[pkg]=d.version as string; } catch { allDevTypes[pkg]="latest"; }
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
          phaseDone("packages", SVG_PACKAGE, "Packages résolus", `${Object.keys(newDeps).length} runtime · ${Object.keys(allDevTypes).length} @types`);

          send("\n[PAGE_DONE]\n");
          controller.close();

        } catch(err: any) {
          console.error("Workflow error:", err);
          sendRaw(phaseBlock("critical-error", SVG_ERROR, `Erreur critique : ${err.message}`, "error"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  } catch(err: any) {
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
