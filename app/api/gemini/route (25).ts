import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
// basePrompt remplacé par BASE_SYSTEM_PROMPT — stack universelle
// (plus d'import @/lib/prompt qui était Next.js-only)
import packageJson from "package-json";
import sharp from "sharp";
import { Sandbox } from "@e2b/code-interpreter";

// ─── Vercel streaming config ──────────────────────────────────────────────
// maxDuration: prevent Next.js / Vercel from cutting the stream during TSC
export const maxDuration = 800;  // seconds — Vercel Pro/Enterprise supports up to 800s
export const dynamic = "force-dynamic";


// ═══════════════════════════════════════════════════════════════════════════
// BASE_SYSTEM_PROMPT — Connaissance universelle de la stack
// Remplace l'ancien basePrompt Next.js-only
// Injecté dans chaque agent à la place de basePrompt
// ═══════════════════════════════════════════════════════════════════════════
// =============================================================================
// DESIGN_RULES — Règles de design universelles injectées dans TOUS les agents
// Reprises mot pour mot depuis les instructions du product owner
// Enrichies avec les principes Framer + Mobbin pour un résultat encore plus beau
// =============================================================================

const DESIGN_RULES = `
══════════════════════════════════════════════════════════════════════
SUPPRESSION DE L'ESPRIT DESIGN STYLE LLM — RÈGLES ABSOLUES DE DESIGN
S'appliquent à chaque ligne de code UI — aucune exception
Inspirées des meilleurs sites Framer et des patterns Mobbin (top apps mondiales)
══════════════════════════════════════════════════════════════════════

I — LES LAYOUTS, COMPONENTS, COMPOSANTS DE NAVIGATION

Cette section concerne absolument tous les types de layouts, components et composants de navigation.
Ces règles aident chaque agent à produire de belles versions de ces éléments.
Ce qui rend les sites Framer et les apps Mobbin si beaux : hiérarchie visuelle forte,
espacement calculé et cohérent, typographie précise avec des tailles différenciées,
transitions fluides sur chaque interaction, couleurs issues d'un système rigoureux, jamais au hasard.

─────────────────────────────────────────────────────────
1) LES NAVBARS — règle générale (s'applique à TOUTES les navbars)
─────────────────────────────────────────────────────────

Ne pas utiliser des effets shadow ou d'ombre quelconques, même infimes, sur les navbars.
Les effets shadow sont uniquement utilisés si la navbar est en forme de pilule, c'est-à-dire avec des bordures suffisamment arrondies.
Mais plutôt favoriser de légers effets blur/liquid glass au lieu des effets shadow.
Les meilleurs sites Framer utilisent des navbars fines, quasi transparentes avec un léger backdrop-blur,
pas de shadow agressive — juste une subtilité visuelle qui donne de la profondeur sans alourdir.

a-1) NAVBARS DE LANDING PAGES — règles :

• Les menus de navigation, le texte de ceux-ci et même les boutons ne doivent jamais être en bloc quand la largeur n'est pas la bonne. Ils doivent toujours être en no-white-space et la largeur du menu doit avoir une bonne largeur adaptative au texte. La navbar doit s'adapter à celle-ci sans qu'aucun élément ne soit en bloc.

• Le texte des menus doit toujours avoir un bon font bold, généralement font-semibold, et une taille moyenne, c'est-à-dire ni trop grand ni trop petit. Sur Framer et Mobbin, les navbars utilisent typiquement text-sm (14px) à text-base (15-16px) en font-medium ou font-semibold — jamais text-lg qui est trop imposant.

• Les éléments dans ce type de navbar doivent toujours être bien alignés et bien agencés afin qu'aucun élément ne soit décalé par rapport à l'autre. Le logo est toujours parfaitement centré verticalement, les items de navigation ont le même line-height, les CTA buttons sont alignés au centre de la barre.

• La hauteur de la navbar ne doit jamais être trop grande. 50px est le maximum. Les meilleurs sites Framer utilisent des navbars entre 44px et 48px — compactes, élégantes, qui ne prennent pas l'espace de la page.

• Les items de navigation doivent avoir un hover state clair : soit un léger changement de couleur (opacity de 0.6 → 1.0), soit un background pill arrondi subtil. Le transition doit être rapide : duration-150 maximum.

• Les navbars de landing pages doivent utiliser des effets de flou si elles sont sticky : backdrop-blur-md avec un bg semi-transparent (bg-white/80 ou bg-black/80) — jamais un bg totalement opaque qui écrase visuellement la page.

a-2) NAVBARS DE PAGES D'APPLICATIONS :

Ce type de navbar est divisé en deux catégories :
- Quand la page possède un layout sidebar + layout main content : la navbar se place dans le main content et s'appelle la top navbar.
- Quand il n'y a pas de layout sidebar : la navbar prend toute la largeur de la page.

Dans les deux cas, toutes les règles de la section a-1) s'appliquent exactement.
La top navbar dans un layout sidebar+content doit avoir une hauteur identique au header de la sidebar pour un alignement parfait.
Sur Mobbin, les top navbars d'applications sont toujours très épurées : titre de page à gauche, actions à droite, hauteur 48-56px max.

─────────────────────────────────────────────────────────
2) RÈGLES GÉNÉRALES POUR TOUS LES COMPOSANTS
─────────────────────────────────────────────────────────

MENUS & SIDEBAR :
Le padding des menus ne doit pas être grand — la taille maximum est 32px. Il doit y avoir un certain padding pour que l'icône ou le texte ne touche pas la hauteur du menu. Cette règle s'applique à tous les menus qu'ils soient actifs ou pas dans la sidebar. Les bordures devront être un peu plus arrondies que la normale, soit +2px ou +4px de plus. Le font bold de l'icône et le texte du menu devront être bons, au moins font-semibold. Pas de texte gris-bleuté terne quand le menu n'est pas actif — que ce soit pour les icônes et le texte. Cela s'applique principalement aux sidebars mais peut aussi être valable pour les autres composants.

Sur Mobbin et les meilleures apps (Notion, Linear, Vercel), les sidebars sont ainsi :
• Items nav : 32-36px de hauteur, padding horizontal 10-12px, gap icône-texte 8px, icon 16px
• Texte inactif : pas de gris trop terne — utiliser une opacité (text-opacity-60) sur la couleur principale, pas une couleur grise inventée
• Texte actif : color full, font-medium minimum, l'indicateur actif (barre 2-3px ou bg léger) doit être de la couleur accent du design
• La sidebar entière doit donner une impression de légèreté et de précision — chaque item bien respire sans être trop espacé
• Groupes de nav avec titles (labels de section) : text-xs uppercase tracking-widest opacity-40 — discrets mais structurants

Les bordures de séparation dans les sidebars uniquement en fin de sidebar sont interdites car c'est moche. Soit il y a des séparateurs partout, soit il n'y en a pas du tout.
Les séparateurs s'ils sont utilisés : 1px, couleur très subtile (border-opacity-8 ou border-opacity-10), jamais 2px qui est trop lourd.

BOUTONS :
Les boutons dans la sidebar ou tout autre composant, s'ils sont petits (≤ 32px), les bordures doivent être légèrement arrondies, entre 8-10px. Si le bouton a une forte taille, les bordures doivent être complètement arrondies à 25px et le texte à l'intérieur ne doit être ni trop grand ni trop petit, mais avec un bon font-semibold. Surtout éviter — ne pas même faire — des boutons qui ont une taille supérieure à 40px.

Les boutons sur les meilleurs sites Framer et apps Mobbin suivent ces standards supplémentaires :
• Bouton primaire : toujours une couleur accent forte avec un texte blanc ou très contrasté, border-radius adapté à la taille, padding horizontal généreux (au moins 2× le padding vertical)
• Bouton secondaire/outline : border fine (1px) de la couleur accent, background transparent, texte de la couleur accent — hover avec un léger fill de l'accent à 10% d'opacité
• Bouton ghost : sans border ni background — juste le texte, hover avec un bg très subtle
• États disabled : opacity-40, cursor-not-allowed — jamais supprimer visuellement le bouton
• Micro-interactions : hover avec scale-[1.02] ou brightness-110, active avec scale-[0.98] — cela donne cette sensation premium que l'on ressent sur les sites Framer

INPUTS — SEARCHBOX — FORMULAIRES :
Pour les inputs de type searchbox et les inputs de formulaire, favoriser que leur background soit différent de celui du layout parent, de quelque manière que ce soit.
- Sauf si le background du layout est totalement blanc : mettre une variante de blanc cassé.
- Si le background est complètement noir : mettre une variante de noir cassé.
Les bordures sont totalement arrondies à 25px si la taille de la searchbox ou de l'input est supérieure à 38px. Si la taille est inférieure à ce seuil, les bordures doivent être arrondies à 12px ou 10px. L'icône search et l'input doivent être bien intégrés dans la structure de la searchbox. Pour les inputs de formulaire, la même règle s'applique.
Pour les input range : ils doivent être vraiment petits, voire remplacés par des divs connectées à eux qui les remplacent et qui sont plus petites et mieux designées — c'est la meilleure solution.
Les inputs de type checkbox doivent toujours être petits et bien arrondis avec une bonne police. Vraiment bien arrondis. Leur taille max si elles doivent être un peu plus grandes est de 20px, minimum 15px. Elles suivent de belles couleurs et non des couleurs trop vives comme le bleu, le vert ou le rouge. Elles peuvent aussi, comme les input range, être remplacées par des divs connectées à elles car les divs sont mieux designables.

Standards supplémentaires inspirés de Mobbin (Linear, Vercel, Notion, Figma) :
• Focus ring : outline-none + ring-2 ring-accent/40 — subtil mais visible, jamais la ring bleue par défaut du navigateur
• Placeholder text : opacity-40 de la couleur du texte principal — jamais gris plat
• Label : text-xs font-medium uppercase tracking-wide opacity-60 — au-dessus de l'input, pas à l'intérieur
• Input de recherche : icon à gauche avec padding-left compensé (pl-9), icon en opacity-40, fond légèrement différent avec border subtile
• État d'erreur : border-red (couleur du design), message d'erreur text-xs en rouge sous l'input, jamais de popup ou alerte

SIDEBAR + MAIN CONTENT :
L'agencement sidebar + main content doit être tel que la sidebar n'a pas de bordures arrondies — c'est moche. Aucun des deux ne doit avoir d'effet shadow. Ils doivent être bien connectés et collés ensemble. Le main content ne doit jamais être plus sombre (sharp) que la sidebar — jamais, c'est très moche. Il doit toujours être plus clair (light).

La règle de la hiérarchie claire entre sidebar et main content (inspirée des meilleures apps sur Mobbin) :
• Sidebar : la plus sombre ou la plus colorée (c'est elle qui donne l'identité visuelle)
• Main content : toujours un cran plus clair, plus aéré, avec plus de breathing room
• Séparation : uniquement par une border-right de 1px semi-transparente, jamais par une shadow
• Les deux zones doivent être visuellement liées mais hiérarchiquement distinctes — le regard va naturellement vers le main content

CHARTS & GRAPHIQUES :
Les diagrammes de type chart en bâtons doivent avoir des bâtons de tailles vraiment petites en terme de largeur — 20px c'est déjà trop. Ils doivent avoir un style de chart tel que si les bordures sont totalement arrondies, ce soit comme si la chart était dans une div de même largeur — comme une bouteille que l'on remplit — elle aussi arrondie, le contenu rempli étant cette chart. L'axe X ou les traits qui sortent de l'axe Y ne doivent jamais être trop espacés — ils doivent être en petits pointillés, c'est mieux. Pour les charts en courbe sinusoïdale, favoriser les charts en diagrammes par bâtons selon la règle ci-dessus, ou des charts en diagrammes en pic — c'est-à-dire qu'au lieu d'arrondir le bout, on le rend en pic. Le texte doit être small mais avec un bon font-semibold et éviter les couleurs trop vives comme le rouge ou le vert trop clair.

Les meilleures dashboards sur Mobbin (Stripe, Vercel, Linear) ont ces caractéristiques supplémentaires :
• Les bars charts ont des bars de 8-12px de largeur maximum, très fines, avec un gap d'au moins 6-8px entre elles
• Les couleurs des charts : 1 couleur principale de l'accent, 1 couleur secondaire plus douce (40-60% d'opacité de l'accent), jamais 5-6 couleurs rainbow
• Les axes : strokeDasharray="3 3" (pointillés de 3px) avec une stroke opacity de 0.15 — quasi invisibles mais présents
• Le tooltip : card avec bg du design, border subtile, text-xs, radius 8px — pas de tooltip gris plat par défaut
• Les area charts (remplissage sous la courbe) : gradient vertical de l'accent (100% opacity en haut → 0% en bas) — cela donne beaucoup de profondeur

CARDS & CARTES :
Les cards doivent éviter d'avoir des icônes de librairie ou des emojis qui font office d'icônes. Soit on prend une belle image, soit on ne prend rien — tout doit être hyper bien agencé. Le padding des éléments et leur taille dans une card, si c'est une table, doit être extrêmement petit. Même pour une table, la même règle s'applique : la taille max d'une row est 34px.

Ce qui fait la beauté des cards sur Mobbin et Framer :
• Hiérarchie typographique dans la card : titre en font-semibold text-base, sous-titre en text-sm opacity-60, valeur principale en text-2xl font-bold
• Icône dans une card si nécessaire : dans un conteneur carré arrondi (p-2 rounded-lg) de la couleur accent à 10-15% d'opacité, icône de la couleur accent — jamais une icône flottante seule
• Hover sur les cards interactives : translateY(-2px) ou brightness légèrement augmenté, shadow légèrement plus prononcée — donne l'impression de soulèvement
• Card avec border subtile (1px, opacity 8-10%) + background légèrement différent du main content — cette combinaison est la signature des meilleures UI
• Cards stats/KPI : nombre en très grande taille (text-3xl ou text-4xl), unité en text-sm, variation (%) avec couleur verte/rouge mais pastel (jamais vert fluo), tendance avec une mini sparkline

ESPACES & CONTENU :
Dans l'ensemble des pages, éviter la reproduction générique des mêmes contenus pour saturer la page. Éviter de laisser trop d'espaces vides et blancs entre les éléments. Il faut être créatif — mais créatif en ne reproduisant pas toujours exactement le même contenu. Faire quelque chose de nouveau, créatif, et surtout utile à la page.

La gestion des espaces selon Framer et Mobbin :
• Espacement vertical entre sections : cohérent et proportionnel — si une section a 24px de padding top, toutes les sections du même niveau en ont autant
• Grid system : préférer des grids 12 colonnes avec gap-4 à gap-6 — les éléments s'alignent naturellement
• Breathing room autour des éléments importants : un KPI important mérite plus d'espace blanc autour de lui qu'un label secondaire
• Hiérarchie spatiale : les éléments de même importance ont le même espacement entre eux — la cohérence spatiale est ce qui donne l'impression de "professionnel"
• White space intentionnel : l'espace vide n'est pas un manque de contenu — c'est un outil de design. Les meilleurs sites Framer savent quand laisser respirer un élément important

CLASSES TAILWIND GÉNÉRIQUES INTERDITES :
Les classes génériques de Tailwind CSS sont à absolument éviter : bg-zinc-500, text-green-400, ou toutes autres de ce style. C'est à bannir complètement. Utiliser uniquement ce qui a été fourni par le design mandatory.
bg-[#hex], text-[#hex], border-[#hex] avec les valeurs exactes du design contract — jamais de raccourcis génériques.

TRANSITIONS & MICRO-INTERACTIONS :
Ce qui donne cette sensation de qualité premium sur Framer et les apps Mobbin — les transitions :
• Tous les éléments interactifs : transition-all duration-150 ease-in-out (ou transition-colors duration-150)
• Hover sur nav items : changement de couleur ou background en 150ms
• Apparition de dropdowns/modals : fade-in + scale de 0.95 → 1.0 en 150-200ms
• Feedback au clic : scale-[0.98] pendant 100ms (active state) — donne la sensation de click physique
• Loading states : skeleton loaders avec animate-pulse — jamais de spinner seul au centre

SWITCHES :
Les couleurs trop vives sur des éléments comme les Switch ne doivent pas toujours être utilisées.
Un switch inactif : background opacity-20 de la couleur primaire — visible mais discret
Un switch actif : couleur accent principale — mais pas de vert fluo ou rouge agressif si ce n'est pas dans le design contract

HIÉRARCHIE TYPOGRAPHIQUE (inspirée de Framer et Mobbin) :
• Titre de page (h1) : text-xl à text-2xl, font-semibold à font-bold — jamais text-4xl dans un layout d'app
• Titre de section : text-base à text-lg, font-semibold — toujours clair et lisible
• Labels : text-xs à text-sm, font-medium, opacity légèrement réduite (60-70%) — pour ne pas concurrencer le contenu
• Valeurs/données : text-sm à text-base, font-normal pour les données, font-medium pour les valeurs importantes
• Ne jamais utiliser plus de 3 tailles de texte différentes dans un même composant — la hiérarchie se fait avec le font-weight et l'opacité, pas uniquement la taille

TYPESCRIPT :
Surveiller absolument toutes les erreurs TypeScript dans le code pour que la commande tsc --noEmit ne trouve aucune erreur.
Types précis partout, props typées, zéro any sauf si absolument justifié.

─────────────────────────────────────────────────────────
IX — ICÔNES : LIBRAIRIES ET USAGE CORRECT
─────────────────────────────────────────────────────────

Deux librairies d'icônes disponibles — choisir selon le contexte :

1. TABLER ICONS (outline, stroke style) — via CDN dans app/layout.tsx :
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
   Usage : <i className="ti ti-home" />
   Convient pour : navigation, interface générale, UI chrome

2. ICONSAX (filled, coloré, moderne) — via CDN dans app/layout.tsx :
   <script src="https://unpkg.com/iconsax-react@0.0.8/dist/iconsax-react.umd.js"></script>
   Usage en JSX : importer depuis 'iconsax-react' → import { Home, Setting, User } from 'iconsax-react'
   Convient pour : cards avec icônes colorées, dashboards, éléments visuels forts

RÈGLE DE CHOIX :
• Icônes dans des cards colorées (bg accent) → Iconsax (filled, visuel fort)
• Icônes dans navigation/sidebar/topbar → Tabler (outline, discret)
• Jamais d'emojis pour représenter des icônes fonctionnelles

─────────────────────────────────────────────────────────
X — AVATARS : JAMAIS D'ICÔNES NI D'EMOJIS
─────────────────────────────────────────────────────────

Les avatars doivent TOUJOURS utiliser de vraies images ou des initiales stylisées.
JAMAIS d'icône générique (👤, user-icon, person-icon) pour représenter un avatar.

OPTIONS CORRECTES pour les avatars :
• Image réelle : <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=[nom]" className="w-8 h-8 rounded-full" />
• Image photo : <img src="https://i.pravatar.cc/32?u=[nom]" className="w-8 h-8 rounded-full" />
• Initiales stylisées : div avec les 2 premières lettres du nom, bg couleur basée sur le nom, text blanc, rounded-full
• Favicon pour logos d'apps : <img src="https://www.google.com/s2/favicons?domain=DOMAIN&sz=32" />

Groupe d'avatars (avatar stack) : utiliser de vrais avatars avec ring-2 ring-white et margin-left négatif.

─────────────────────────────────────────────────────────
XI — DIMENSIONS STRICTES DES COMPOSANTS
─────────────────────────────────────────────────────────

TOPBAR / HEADER d'application :
• Hauteur MAXIMUM : 40px — jamais plus. Préférer 36px.
• Un header de 48px ou 56px c'est trop imposant — réduire à 36-40px
• Contenu bien centré verticalement dans cette hauteur

BOUTONS :
• Height maximum : 36px pour les boutons normaux — pas 40-48px
• Bouton primaire CTA (landing page) : max 44px
• Border-radius : calculé selon la taille — si h=32-36px → radius 8-10px max, pas 9999px sauf pill explicite
• Font size : 13-14px, jamais 16px+ sur un bouton d'app

SEARCHBOX & INPUTS :
• Height maximum : 36px — pas 40px+
• Border-radius pour searchbox standard : 8px, pas 9999px systématiquement
• Pill radius (9999px) : uniquement si l'image de référence le montre clairement

MENUS NAVIGATION :
• Height des nav items sidebar : 32-34px maximum — compact et précis
• Padding horizontal : 10-12px, pas 16px+

─────────────────────────────────────────────────────────
XII — LAYOUT PLEINE PAGE — JAMAIS DE CONTAINER CENTRÉ
─────────────────────────────────────────────────────────

L'application doit TOUJOURS prendre toute la largeur et hauteur de la page :
• body et html : width: 100%, height: 100%, margin: 0, padding: 0, overflow: hidden
• Layout principal : className="flex h-screen w-screen overflow-hidden" — jamais max-w-7xl ou container
• Le contenu principal (main) : flex-1, overflow-y-auto

EXCEPTION — Container centré autorisé uniquement si :
• C'est une landing page avec un contenu textuel centré (section hero, pricing, etc.)
• L'image de référence montre clairement un contenu dans un container centré
• Dans ce cas : max-w-6xl mx-auto px-6 — jamais max-w-3xl qui est trop étroit
`;


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

${DESIGN_RULES}

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
/** Packages to REMOVE — agent emits: REMOVE_DEPENDENCIES: ["pkg1", "pkg2"] */
function extractRemoveDeps(output: string): string[] {
  return extractDeps(output, "REMOVE_DEPENDENCIES");
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

function buildDesignAnchor(htmlRef?: string, analysisBlocks?: string): string {
  if (!htmlRef) return "";

  // New format: React/Tailwind tokens — extract key color hints for quick reference
  const bgMatch = htmlRef.match(/bg:\s*"\[bg-\[(#[a-fA-F0-9]+)\]\]"/);
  const sidebarBgMatch = htmlRef.match(/sidebarBg:\s*"\[bg-\[(#[a-fA-F0-9]+)\]\]"/);
  const accentMatch = htmlRef.match(/accent:\s*"\[bg-\[(#[a-fA-F0-9]+)\]\]"/);
  const fontMatch = htmlRef.match(/fontFamily:\s*"'([^']+)'/);
  const fontName = fontMatch ? fontMatch[1] : "system-ui";

  const quickRef = [
    bgMatch     ? `bg: ${bgMatch[1]}  → bg-[${bgMatch[1]}]`          : null,
    sidebarBgMatch ? `sidebar: ${sidebarBgMatch[1]}  → bg-[${sidebarBgMatch[1]}]` : null,
    accentMatch ? `accent: ${accentMatch[1]}  → bg-[${accentMatch[1]}]` : null,
    `font: '${fontName}'`,
  ].filter(Boolean).join("  |  ");

  return `
╔═══════════════════════════════════════════════════════════╗
║  DESIGN CONTRACT — AUTORITÉ ABSOLUE — NE PAS DÉROGER     ║
╚═══════════════════════════════════════════════════════════╝
⛔ COULEURS GÉNÉRIQUES INTERDITES (bg-gray-900, text-blue-500, etc.)
⛔ ZÉRO shadow sur sidebar, topbar, navbar, main wrapper
✅ Utilise bg-[#hex] text-[#hex] border-[#hex] avec les hex des TOKENS ci-dessous
✅ Nav items h-[34px] max — ne pas gonfler les heights des menus

RÉFÉRENCES : ${quickRef}

LOIS :
1. bg-[#hex] EXACT — jamais bg-gray-*, jamais text-blue-*
2. Pas de shadow sur layout (sidebar, topbar, nav) — shadow uniquement cards/modals/dropdowns
3. Nav items h-[34px] compact — jamais h-[48px] ou plus
4. Font '${fontName}' dans app/layout.tsx (Google Fonts)
5. Icônes <i className="ti ti-[name]" /> Tabler CDN dans layout.tsx

DESIGN TOKENS REACT/TAILWIND (copie ces className dans tes composants) :
=== TOKENS.tsx ===
${htmlRef.slice(0, 14000)}
=== END TOKENS ===
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
// =============================================================================
// CLAUDE_CODER — Agent unique style Claude Code
// Remplace tous les anciens agents (Presenter, Foundation, Checker, Views, Integrator)
// Un seul agent qui fait TOUT : comprend, planifie, code, design, vérifie
// =============================================================================

const CLAUDE_CODER_PROMPT = `
Tu es un agent de développement full-stack autonome, style Claude Code.
Tu reçois une demande et tu l'implémentes ENTIÈREMENT en une seule passe.
Tu penses, tu planifies, tu codes, tu vérifies — tout seul, sans déléguer.

${ERROR_PREVENTION_BIBLE}

${DESIGN_RULES}

══════════════════════════════════════════════════════════════════════
COMMENT TU TRAVAILLES — BOUCLE CLAUDE CODE
══════════════════════════════════════════════════════════════════════

1. COMPRENDRE : Lis la demande et les fichiers existants (readFile si nécessaire)
2. PLANIFIER (dans ta réflexion) : liste les fichiers à créer/modifier, les features à implémenter
3. CODER : génère TOUS les fichiers nécessaires, complets, fonctionnels
4. VÉRIFIER : relis ton output — handlers vides ? imports manquants ? "use client" oublié ?
5. CORRIGER : corrige immédiatement ce que tu détectes

══════════════════════════════════════════════════════════════════════
SI PROJET VIDE (nouvelle application)
══════════════════════════════════════════════════════════════════════

Génère TOUS ces fichiers d'emblée :
- app/page.tsx — routeur principal : const [activeView, setActiveView] = useState("home")
- app/globals.css — variables CSS du design anchor + body/html 100vh/vw overflow:hidden
- app/layout.tsx — Google Fonts + Tabler Icons CDN + Iconsax CDN + metadata
- tailwind.config.ts — plugins: [] VIDE uniquement
- components/views/[NomView].tsx — UNE view par section, logique COMPLÈTE dedans
- types/index.ts — interfaces partagées

POUR CHAQUE VIEW (jamais de mock handler, jamais de console.log) :
\`\`\`
"use client";
import { useState, useEffect } from "react";
// imports des librairies npm nécessaires

// Interfaces
interface Item { id: string; name: string; /* tous les champs */ }

// Mock data — 12+ entrées réalistes
const MOCK_ITEMS: Item[] = [
  { id: "1", name: "Exemple réel", /* ... */ },
  // ... 11 autres entrées variées
];

export function NomView() {
  const [items, setItems] = useState<Item[]>(MOCK_ITEMS);
  const [search, setSearch] = useState("");
  // tous les états nécessaires

  // handlers RÉELS — jamais vides
  const filteredItems = items.filter(i => 
    i.name.toLowerCase().includes(search.toLowerCase())
  );
  
  function handleDelete(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
  }
  
  function handleSubmit(data: Partial<Item>) {
    setItems(prev => [...prev, { ...data, id: Date.now().toString() } as Item]);
  }

  return (
    // JSX complet avec tous les états visuels
  );
}
\`\`\`

══════════════════════════════════════════════════════════════════════
SI PROJET EXISTANT (modification / fix)
══════════════════════════════════════════════════════════════════════

1. readFile() sur les fichiers concernés EN PREMIER
2. Analyse ce qui doit changer
3. edit_file avec les numéros de ligne EXACTS issus du readFile
4. Si > 40% du fichier change → create_file complet

══════════════════════════════════════════════════════════════════════
RÈGLES ABSOLUES DE QUALITÉ
══════════════════════════════════════════════════════════════════════

FONCTIONNEL :
⛔ Aucun handler vide : onClick={() => {}} — JAMAIS
⛔ Aucun TODO dans le code
⛔ Aucune feature simulée (console.log au lieu de vraie logique)
⛔ Données mock < 12 entrées — inacceptable
✅ Chaque bouton déclenche une vraie action
✅ Chaque formulaire a validation + feedback + reset
✅ Chaque liste est filtrée/triée dynamiquement avec useState
✅ Les modals s'ouvrent/ferment avec useState
✅ Recharts pour les graphiques — jamais de divs qui simulent

DESIGN (si DESIGN CONTRACT fourni) :
✅ bg-[#hex] avec les hex EXACTS du design anchor
✅ Sidebar : rectangulaire, sans shadow, sans border-radius
✅ Main content : toujours plus clair que la sidebar
✅ Topbar : max 40px de hauteur, préférer 36px
✅ Boutons : max 36px, font-semibold, radius selon taille
✅ Nav items : 32-34px, compact, police correcte
✅ Cards : shadow UNIQUEMENT sur les cards, pas sur le layout
✅ Avatars : DiceBear ou Pravatar — jamais d'icône générique

LAYOUT :
✅ body { display: flex; height: 100vh; width: 100vw; overflow: hidden; }
✅ Pleine page : className="flex h-screen w-screen overflow-hidden"
✅ Jamais de max-w-7xl ou container sur une app (seulement landing pages)

TYPESCRIPT :
✅ "use client" ligne 1 sur tout composant avec hooks
✅ key={item.id} sur tous les .map()
✅ Export nommé : export function NomView()
✅ Zéro erreur tsc --noEmit

${EDIT_FILE_FORMAT_RULES}
`;


const FIXER_PROMPT = `
Tu corriges et implémentes dans le fichier concerné.
Toute logique va directement dans le fichier .tsx qui l'utilise — jamais dans un fichier service séparé.

${ERROR_PREVENTION_BIBLE}

[WORKING_ON]Correction — [description précise][/WORKING_ON]

${DESIGN_RULES}

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
      temperature: 1.2,  // Gemini thinking perf optimal à ≥ 1.0
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
          { temperature: 1.2, maxTokens: 65536, agentName: "TSC_FIXER2" }
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
          // effectiveReferenceImages — images de référence design
          const effectiveReferenceImages = [
            ...(uploadedImages ?? []).filter((img: string) => {
              const clean = img.includes(",") ? img.split(",")[1] : img;
              return clean && clean.length > 100;
            }),
            ...(allReferenceImages ?? []).filter((img: string) => {
              const clean = img.includes(",") ? img.split(",")[1] : img;
              return clean && clean.length > 100;
            }),
          ].slice(0, 4);

          const hasFiles = (currentProjectFiles ?? []).length > 0;
          emit("\n[PRESENTER:INTRO]\n");
          emit(hasFiles ? "Je m'occupe de ça maintenant." : "Je construis l'application maintenant.");
          emit("\n[/PRESENTER:INTRO]\n");

          // ═══════════════════════════════════════════════════════════════
          // CLAUDE CODER — agent unique style Claude Code
          // ═══════════════════════════════════════════════════════════════

          const globalPkgs = new Set<string>(["clsx", "tailwind-merge", "zustand", "autoprefixer", "sharp"]);
          const globalDevPkgs = new Set<string>();
          const globalRemovePkgs = new Set<string>(); // packages to REMOVE from package.json
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
            extractRemoveDeps(agentOutput).forEach((d) => globalRemovePkgs.add(d));
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
                // Also extract the visible analysis blocks if present
                const analyseMatch = designOutput.match(/\[ANALYSE\]([\s\S]*?)\[\/ANALYSE\]/);
                const detailsMatch = designOutput.match(/\[DETAILS\]([\s\S]*?)\[\/DETAILS\]/);
                const analyseSummary = analyseMatch
                  ? `\n[ANALYSE — cartographie structurelle]\n${analyseMatch[1].trim()}\n[/ANALYSE]\n`
                  : "";
                const detailsSummary = detailsMatch
                  ? `\n[DETAILS — observations visuelles]\n${detailsMatch[1].trim()}\n[/DETAILS]\n`
                  : "";

                activeDesignAnchor = buildDesignAnchor(designMatch[1], analyseSummary + detailsSummary);
                (globalThis as any).__persistedDesignAnchor = activeDesignAnchor;
                const analysisSize = analyseSummary.length + detailsSummary.length;
                emit(`\n[DESIGN:READY] ✅ Design généré (HTML/CSS: ${designMatch[1].length} chars${analysisSize > 0 ? `, analyse: ${analysisSize} chars` : ""})\n`);
              } else {
                // Model may have output code accidentally — log but don't crash
                emit(`\n[DESIGN:SKIP] Balise design_reference absente — design fallback activé.\n`);
              }
            } catch (err: any) {
              emit(`\n[DESIGN:SKIP] Agent design indisponible (${err.message?.slice(0,60)}) — utilise le design existant.\n`);
            }
          }

          // ─────────────────────────────────────────────────────────────
          // PHASE 1 — CLAUDE CODER (agent unique — fait tout)
          // ─────────────────────────────────────────────────────────────
          emit("\n[PHASE:1/CLAUDE_CODER]\n");
          await sleep(500);

          const _deepCtx = buildDeepContext(allGeneratedFiles, lastUserMsg);
          const _todoCtx = buildTodoContext(lastUserMsg);

          const coderInput = `
DEMANDE : "${lastUserMsg}"

${activeDesignAnchor}
${activeDesignAnchor ? "⚡ DESIGN CONTRACT actif — utilise les hex EXACTS, pas de classe Tailwind générique" : ""}

${_deepCtx}

${_todoCtx}

${projectContext}

${hasFiles ? `FICHIERS EXISTANTS AVEC NUMÉROS DE LIGNE :
${buildAllFilesSnapshot(60000)}

Ces fichiers existent déjà. readFile() si tu as besoin de lire un fichier complet.
edit_file avec les numéros de ligne exacts pour les modifications ciblées.
create_file si > 40% du fichier change.` : "Nouveau projet — crée tous les fichiers nécessaires."}
`;

          const coderOutput = await runAgent(CLAUDE_CODER_PROMPT, coderInput, {
            temperature: 1.2,
            maxTokens: 65536,
            agentName: "CLAUDE_CODER",
            referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages.slice(0, 3) : undefined,
            noTools: false,
          });
          flushBuffer();

          mergeGeneratedFiles(parseGeneratedFiles(coderOutput));
          parseEditFileOps(coderOutput).forEach(op => applyEditFileOp(op, allGeneratedFiles));
          extractDeps(coderOutput, "DEPENDENCIES").forEach((d) => globalPkgs.add(d));
          extractDeps(coderOutput, "DEVDEPENDENCIES").forEach((d) => globalDevPkgs.add(d));
          extractRemoveDeps(coderOutput).forEach((d) => globalRemovePkgs.add(d));
          parseGeneratedFiles(coderOutput).forEach((f) => {
            for (const m of f.content.matchAll(/from\s+['"]([^@./][^'"]*)['"]/g)) {
              const pkg = m[1].split("/")[0];
              if (pkg && !pkg.startsWith(".")) globalPkgs.add(pkg);
            }
          });

          const _vCoder = verifyAgentOutput(allGeneratedFiles, "CLAUDE_CODER");
          emit(`\n[VERIFY:CODER] ${_vCoder.severity === "ok" ? "✅ OK" : _vCoder.issues.join(" | ")}\n`);

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
                  temperature: 1.2, maxTokens: 65536, agentName: "SYNTAX_FIXER", noTools: true
                });
                flushBuffer();
                mergeGeneratedFiles(parseGeneratedFiles(localFixOut));
              } catch {}
            }
          }

          if (e2bApiKey) {
            const MAX_TSC_FIX_ROUNDS = 5; // max 5 rounds de correction — sécurité anti-boucle infinie

            // Délai avant le premier check TSC — les agents précédents ont chauffé le LLM
            emit("[TSC:WAIT] Délai 15s avant vérification TypeScript...\n");
            await sleep(15000);

            // Premier check TSC
            let tscResult = await runTscCheck(buildTscFiles(allGeneratedFiles, currentProjectFiles), e2bApiKey, emit);
            let round = 0;

            // Boucle : on continue tant qu'il y a des erreurs ET qu'on n'a pas atteint la limite
            while (tscResult.hasErrors && round < MAX_TSC_FIX_ROUNDS) {
              // ── Délai avant le fixer — Gemini a déjà enchaîné 3+ agents ──────────────
              // Sans délai, on risque un 429 / RESOURCE_EXHAUSTED
              const fixerDelay = round === 0 ? 15000 : 12000;
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

${activeDesignAnchor ? `DESIGN DE RÉFÉRENCE (vérifie que les couleurs du code correspondent) :
Si tu vois des couleurs hardcodées qui ne correspondent pas au design → corrige-les.
${activeDesignAnchor.substring(0, 1500)}` : ""}

INSTRUCTIONS DE CORRECTION :
1. Lis le numéro de ligne dans l'erreur tsc (ex: L45)
2. Repère la ligne 45 dans le fichier (marquée "  45 | ...")
3. Corrige UNIQUEMENT ce qui est cassé — ne change RIEN d'autre
4. Émets le fichier COMPLET corrigé (sans les numéros de ligne — code propre)
5. Si des couleurs du design ne correspondent pas → corrige aussi ça

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
                temperature: 1.2,
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
              extractRemoveDeps(tscFixOutput).forEach((d) => globalRemovePkgs.add(d));
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

          // 7b. Retire les packages explicitement marqués REMOVE_DEPENDENCIES par les agents
          if (globalRemovePkgs.size > 0) {
            for (const pkg of Array.from(globalRemovePkgs)) {
              delete finalDeps[pkg];
              delete finalDevDeps[pkg];
              emit(`\n[PKG:REMOVE] 🗑 ${pkg} retiré du package.json (demandé par un agent)\n`);
            }
          }

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
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Error: " + err.message }, { status: 500 });
  }
}
