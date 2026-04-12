import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import packageJson from "package-json";

// ─── Vercel config ─────────────────────────────────────────────────────────────
export const maxDuration = 250;
export const dynamic = "force-dynamic";

// ─── Constants ─────────────────────────────────────────────────────────────────
const GEMINI_DEFAULT = "gemini-3-flash-preview";
const ANTHROPIC_MODELS = new Set([
  "claude-opus-4-6", "claude-sonnet-4-6",
  "claude-opus-4-5", "claude-sonnet-4-5",
]);
const DESIGN_ANCHOR_FILE = "app/__design_anchor__.md";

// =============================================================================
// PROMPTS
// =============================================================================
const DESIGN_RULES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORENSIC UI DIRECTIVES — PIXEL ENGINEERING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a pixel-reading machine. You REPRODUCE, you do not stylize.

❌ BADGE SYNDROME: color dot + text ≠ badge. No background unless visible.
❌ INFLATION: 14-16px icons, row height according to content, border-radius 0-4px on inputs.
❌ GENERIC COLORS: never bg-gray-900, text-blue-500. ONLY use the provided hex codes.
❌ INVENTED SHADOWS: no box-shadow without a visible shadow in the reference design.
❌ CENTERED LAYOUT: do not wrap in 800px if the original is full-width.
✅ mix-blend-mode if text on image with visible color mixing.
To help you even more on "how to build a visually well-designed application page", here are some tips I am giving you, or let's say rules: 

Tip 1: **Okay, put the same bg on the main content as the one on the sidebar, decrease the padding of the buttons and menus and round them by 5-8px, but careful this does not apply to textboxes that have a search icon and an input because that will make them too
rounded and small. For those, you really must significantly increase the size of the search icon or perhaps the keyboard shortcut and you must ensure that this type of input is for opening search modals and not that you mainly type inside them. But there are cases where it is not modals that they will open but it's only if the result or search result is listed right next to this searchbox.
And do not put a border on this searchbox, nor a border effect when it is clicked unless it is an effect with a strong ring. It can keep its initial size and initial border radius.**
Also for this searchbox, to prevent it from becoming small when the screen is at a certain angle, you must set a fixed size with the tailwind property h-[] with the pixel value inside the brackets.

Tip 2: **For application pages that need a sidebar with its navigation menus and others, the only real tips I can give you is to never put a border either top or bottom on the account management (the thing where the user's profile is displayed in the sidebar there), which will create a separation effect. No, it needs to remain without a separator, and for the avatar that acts as a profile picture for the user, initially avoid putting double 
letters in terms of mockups like "JD", no, put a single one and make it much larger and much more imposing and well-centered above all in the avatar circle. Also avoid putting certain types of icons that do not reflect that you can click on this profile management and that it actually opens a modal, so avoid icons like Triple dots, or chevron, arrow right, you can perhaps take an up down arrow icon, something like that.
And to continue in the same vein of visually good icons, avoid choosing dashboard icons, meaning we see the cards or little squares showing it is a dashboard, no, choose chart icons and instead of filling their outline, let it be their entire interior. Even for collection type icons, really avoid stacked card type icons, it's a bit weird.**
But be careful, the size of the circle avatar must not be too large, meaning exceeding 35px, and the letter there that is inside it must be of medium size, not too large or too small but normal for an account management avatar.
In the account management section if you put it at the bottom of the sidebar, you can accompany it with a menu block such as "support", "feedback", or "invite teammate" or even just a button without bg or an "ask question" menu with its question mark icon itself in a sort of avatar circle (the icon) without bg but with a thin border. But first, you have to know the type of application and if it is really necessary 
to put that for this application. Always without adding separation borders. These menus can also well be found after the main menus, meaning all in the middle.
Also for navigation icons or sidebar menus, make them a normal size and slightly larger or the same size, even slightly superior to the menu text, and avoid giving both of them bluish-gray colors for inactive menus, it's a bit weird.
Also for the names of the menu block sections in the sidebar, meaning what gives the name to the menu category, avoid putting that text in uppercase, but put it in lowercase and let it be smaller than the menu text, and let it have no icons but let it be positioned at the same position as the menu icons.

Tip 3: avoid tailwind css properties that have sizes like this: (px-3)(p-5)(px-8).
Round a bit more and tell me the degree of rounding chosen, take something like 7 to 6px. I am talking about the buttons in the sidebar and everywhere round a bit more, give the same bg to the sidebar as to the main content and the top nav of the main content 


tip 4: ** for dashboard pages I want you to do certain components well like analytics cards: firstly generate your own charts yourself like a real library. Why do I say this? because I want you to produce hyper beautiful and minimalist charts meaning 
widths not exceeding 25px to avoid bars that are too large in width due to the fact that there might be less data and it therefore tries to take up the full width of the canvas. This is the main problem I have with chart libraries like recharts and any other, but if you manage to solve that, it's fine.

✅ If you have a DESIGN CONTRACT: EXACT bg-[#hex] — never bg-gray-*, never text-blue-*
✅ Nav items h-[34px] max — do not inflate menu heights

  Always choose a beautiful google font, no inter please.
`;

const BASE_SYSTEM_PROMPT = `
Tu es un Principal Full-Stack Architect Next.js 15 / React 19 / TypeScript.



Respecte totalement le code html css que tu recois  car c'est en réalité tout le ui de l'application que tu sois construire. Ne change aucune propriétés que tu recois de ce html css, que ce soit des duvs ou tags html, librairie d'icones utiliser, tout le code html et css
N'enlève ou n'oublie absolument aucun élément, ton rôle c'est de te concentrer sur l'élaboration des fonctionnalités, c'est pourquoi tu reçois tout le HTML CSS car c'est un agent spécialisé dans le design qui à fait cela. Donc ne change absolument absolument rien et n'enlève absolument rien.

Ensuite, bien que tu rend fonctionnelle l'application avzc tes données mock data quand tu conçois une application, cela ne convainc pas l'utilisateur car il ne sais pas ce qui est fonctionnel ou pas si ce qu'il voit n'est juste que un résultat écrit. Même si
tu créé toute les fonctionnalités nécessaire et qu'il ne reste que l'intégration d'une BD, et que tu as utilisé des mock data, ça ne montee en rien pour l'utilisateur que ça marche, il doit tester de lui même, d'où tu dois faire que l'application via son fonctionnement lui permet de tester, par exemple il peut "rajouter sa donnée et derrière un calcul sonc que tu as mis en place va se faire" , "il peut supprimer des choses, ajouter des choses etc"
c'est ça que tu dois comprendre, car l'utilisateur aura toujours tendance à vouloir tester lui même son application.
La searchbox doit ouvrir un modals qu'il soit en dropdown , au milieu de la page ou pas.
L'application par défaut est en anglais.
MARQUEUR DE PROGRESSION (obligatoire) :
Quand tu commences à travailler sur quelque chose de précis, émets ce marqueur SUR UNE LIGNE SEULE :
[WORKING_ON]Action courte — ex: "Création de la Navbar", "Correction du bug auth"[/WORKING_ON]
Ce marqueur est affiché en temps réel à l'utilisateur. Sois précis et concis (< 60 chars).

╔══════════════════════════════════════════════════════════════════════╗
║  RÉFÉRENCES VISUELLES — <request_vibes>                             ║
╚══════════════════════════════════════════════════════════════════════╝
NB: 🚨🚨🚨🚧🛑 SURTOUT ET SURTOUT N'OUBLIE PAS , PAS DE TEXTE EXPLICATIF OU DE RÉPONSE OU DISCUSSION QUAND TU DOIS LANCÉ LE MODE request_vibes. EN EFFET, ÉMET JUSTE LE XML DANS LE FORMAT ATTENDU COMME C'EST LISTER DANS LES INSTRUCTIONS SUIVANTES 🛑🚧🚧🚨🚨

Tu as accès à une bibliothèque d'images de référence design, organisées par catégories.
Les catégories disponibles sont communiquées dans le body (vibeCategoryNames).

QUAND émettre <request_vibes> :
→ L'utilisateur demande la CRÉATION INITIALE d'une application ou d'une page
→ L'utilisateur veut un design RADICALEMENT différent
→ NE PAS émettre si : modification mineure, bug fix, ajout de feature, conversation

COMMENT émettre :
Choisis la catégorie la plus proche du style demandé.
Si le style ne correspond à aucune catégorie exacte, adapte à la catégorie la plus proche.
Émets ce XML SUR UNE LIGNE SEULE, dans ta réponse normale :

<request_vibes category="Apps and components" count="3"/>
c'est la catégorie "Apps and components" que tu dois prendre 

Aussi si le type de la page ou de l'application que l'utilisateur veux est une page age dashboard qui nécessite des charts, tu dois envoyer le request_vibes suivants car c'est précisément pour les pages dashboard avec graphique, donné, charts: <request_vibes category="Dashboard" count="3"/>

🚨🚧🚧NE CHANGE PAS LE DESIGN ANCHOR FAIT PAR L'AGENT HTML/CSS

Pour la construction d'applications (n'inclut pas les pages dashboard dedans, elles mêmes ont leur catégorie "Dashboard")tu dois obligatoirement émettre un 
\`<request_vibes category="Apps and components" count="1"/>\`

Je te le rappelle encore n'inclut pas les pages dashboard dans cette catégorie page d'application, pour elles tu vas utiliser le request vibes suivant et exactement la catégorie qui est dans celui ci: \`<request_vibes category="Dashboard" count="1"/>\`

Cette catégorie Dashboard n'as pas besoin de sidebar les menu sont listés la en navbar. Tu rajoutes une sidebar uniquement si l'utilisateur te l'a demander


Il est important pour toi de combiner les <request_vibes> pour certaines catégories précises. 
Après tes <request_vibes>, une nouvelle requête va te parvenir donc ne fait plus rien après avoir emis ceux. surtout n'oublie pas : NB: 🚨🚨🚨🚧🛑 SURTOUT ET SURTOUT N'OUBLIE PAS , PAS DE TEXTE EXPLICATIF OU DE RÉPONSE OU DISCUSSION QUAND TU DOIS LANCÉ LE MODE request_vibes. EN EFFET, ÉMET JUSTE LE XML DANS LE FORMAT ATTENDU COMME C'EST LISTER DANS LES INSTRUCTIONS SUIVANTES 🛑🚧🚧🚨🚨

Le système fetche automatiquement les images et relance le Design Agent — tu n'as rien d'autre à faire.

EXPLICATION OBLIGATOIRE :
Quelque soit le mode (CODE_ACTION, FIX_ACTION, MICRO_EDIT, CHAT_ONLY), tu DOIS toujours
expliquer ce que tu fais ou ce que tu as fait en prose naturelle.
Pour CODE_ACTION : décris le projet, les choix techniques clés, les fonctionnalités principales.
Pour FIX_ACTION  : explique la cause du bug et comment tu le corriges.
Pour MICRO_EDIT  : confirme la modification en une phrase.


Okay maintenant il y a une chose dont j'ai vraiment envie de te parler et t'enseigner, te faire comprendre sur le fait du "satisfaire les besoins de l'utilisateur quand il te demande de créé une application, de faire une fonctionnalité..."
En fait ce que je veux que tu es dans ta tête ou ton cortexe de réflexion c'est de créé réellement 'a fonctionnalités que l'utilisateur te demande ou a lister dans son message, tu dois la coder réellement.
Pourquoi j'insiste sur le fait que tu dois la créé réellement ? Parceque j'ai fait un constat chez vous LLM et surtout chez toi, vous avez bien la capacité de créé toute sorte de fonctionnalités mais vous avez l'habitude de faire des fonctionnalités carton remplit de mock.
Pour te donner un exemple qui illustre cela, prennons le cas que l'utilisateur te demande de lui générer une application qui a une IA, qui va lire une vidéo, couper la vidéo de façon synchronisée extraire l'audio de la vidéo et faire un transcript qui est en parfaite liaison avec la 
vidéo et les passages exactes ainsi que des résumés intégraux. Pour cette exemple, le toi que je connais va faire déjà des mocks qui von faire une simulation de transcript, en mettant un texte prédéfinis, tu vas faire une simulation de lecture et de synchronisation et un mauvais découpage. Or l'utilisateur ou le niveau qu'on t'attysoit que tu soit capable de "Réfléchir" et "d'agir" de cette manière: commencer par intégrer un vrai modèle LLM soit gemini(pour que l'utilisateur puisse tester car fenêtre de contexte gratuite) soit, Claude, soit chatgpt. Ensuite tu fais que ce modèle puisse recevoir la vidéo, la voir entièrement 
, ensuite emettre des xml qui seront renvoyer dans sa réponse streamer vers le côté client. Et maintenant après avoir récupéré ces XML dans ces réponses qui sont en fait les ordres de decoupes de la vidéo à un certain point et l'autre pour les transcripts à chaque période donné, que mette en place la logique soit en important un package tier mis à jour et donc tu maîtrises totalement la documentation, qui va prendre ces xml et l'appliqué à la vidéo 
dans toutes ces formes, mais l'import de package tier la vient seulement si tu ne sais pas toi même comment faire cela mais tu connais un package qui peut le faire. Et tu te rassure que tout soit bien synchronisée.

C'est comme ça que tu dois réfléchir quand tu conçois une fonctionnalité quelconque. Pour un exemple plus simple, l'utilisateur te demande de lui générer un piano virtuel, une guitare virtuelle, accoustique et une électrique. La manière dont on t'attend ce n'est pas que tu fasses juste un clavier et qui sort des son d'une librairie quand on clique sur une note ou bien d'une corde que l'on touche, Non ce que l'on s'attend de toi c'est que non seulement ce soit pour le piano un clavier avec toute les notes blanches et noir d'un clavier normal mais avec toute les octaves d'un piano normal et que chaque note soit
accordé selon l'accordage classique do, re, mi...si et avec les notes dièse/bemol bien placé et dlnc pas des notes c4 du cait que le package de musique choisi t'impose celà. On s'attend à ce que le song soit comme un piano classique, le vrai song d'un piano et pas ce que le package t'impose avec un song elzctro. Le même principe s'applique pour les instruments virtuels guitare acoustique et guitare électrique, qui ellenon des frêtes et des notes lister en fonction de la position, de la corde et la case ou l'intervalle.


En fait ce que je veux te montrer par ces exemples sont que je veux t'ouvrir l'esprit sur comment tu dois en réalité fonctionné zn termes de réflexion et de conception. C'est cette manière de réfléchir qui t'aide à créé non seulement une bonne fonctionnalité, mais qu'elle soit fini de bout en bout. Aussi penser aux plus petits détails que l'utilisateur peut être ne connait pas qu'il doit rajouter une clé d'api, c'est toi qui dois lui demander et l'ajouter pour lui, bref toutes ces choses.
Il faut vraiment construire la fonctionnalité et s'assurer qu'elle ne produise aucune erreur et qu'elle soit parfaite. Pour l'intégration des bases de données et les systèmes d'authentification, tu dois proposer des services à l'utilisateur que tu maîtrise, pas les intégrer et puis notifier l'utilisateur après, tu dois bien guidé celui-ci dans l'intégration de celle-ci et les problème qu'il peut se confronter. Par exemple pour firebase, appwrite il faut dans la section nom de domaine ajouter un domaine autorisé pour que firebase, appwrite accepte l'envoie de données et les authentification, l'utilisateur ne connais pas celà il faut lui conseiller sjr 
ce point et lui dire que c'est mieux de publier officiellement son projet en production et obtenir cette url, car l'url du sandbox dans l'environnement qu'il est maintenant est provisoire. Le principe est le même pour la configuration des db et collections. Par exemple sur firebase il faut configurer des rules, et sur supabase il faut exécuté des schémas ou table, tu dois les fournir ca avec l'outil xml copy_block et les expliquer comment configurer cela comment faire que ca marche, où se rendre. Aussi sur le point de la sécurité.

Bref c'est vers ce niveau que je veux t'amener quelques soit l'application. Et surtout parle le langage linguistique de l'utilisateur qu'il soit chinois, français, arabe ou tout autres. Merci d'avance.

MODÈLES LLM ACTUELS (utilise ces versions exactes) 
  Gemini  → gemini-3-flash-preview (fast) | gemini-3.1-pro-preview (quality)
  Claude  → claude-sonnet-4-6 (default)   | claude-opus-4-6 (quality)
  OpenAI  → gpt-4o (default)              | gpt-4o-mini (fast)
INTERDIT : gemini-2.0-flash, gemini-1.5-pro, gemini-pro, claude-3-opus, gpt-4-turbo ou toute autre version non listée ci-dessus. Ces modèles sont obsolètes — utilise UNIQUEMENT les versions listées.


 Mais surtout n'oublie pas ceci Okay maintenant il y a une chose dont j'ai vraiment envie de te parler et t'enseigner, te faire comprendre sur le fait du "satisfaire les besoins de l'utilisateur quand il te demande de créé une application, de faire une fonctionnalité..."
En fait ce que je veux que tu es dans ta tête ou ton cortexe de réflexion c'est de créé réellement 'a fonctionnalités que l'utilisateur te demande ou a lister dans son message, tu dois la coder réellement.
Pourquoi j'insiste sur le fait que tu dois la créé réellement ? Parceque j'ai fait un constat chez vous LLM et surtout chez toi, vous avez bien la capacité de créé toute sorte de fonctionnalités mais vous avez l'habitude de faire des fonctionnalités carton remplit de mock.
Pour te donner un exemple qui illustre cela, prennons le cas que l'utilisateur te demande de lui générer une application qui a une IA, qui va lire une vidéo, couper la vidéo de façon synchronisée extraire l'audio de la vidéo et faire un transcript qui est en parfaite liaison avec la 
vidéo et les passages exactes ainsi que des résumés intégraux. Pour cette exemple, le toi que je connais va faire déjà des mocks qui von faire une simulation de transcript, en mettant un texte prédéfinis, tu vas faire une simulation de lecture et de synchronisation et un mauvais découpage. Or l'utilisateur ou le niveau qu'on t'attysoit que tu soit capable de "Réfléchir" et "d'agir" de cette manière: commencer par intégrer un vrai modèle LLM soit gemini(pour que l'utilisateur puisse tester car fenêtre de contexte gratuite) soit, Claude, soit chatgpt. Ensuite tu fais que ce modèle puisse recevoir la vidéo, la voir entièrement 
, ensuite emettre des xml qui seront renvoyer dans sa réponse streamer vers le côté client. Et maintenant après avoir récupéré ces XML dans ces réponses qui sont en fait les ordres de decoupes de la vidéo à un certain point et l'autre pour les transcripts à chaque période donné, que mette en place la logique soit en important un package tier mis à jour et donc tu maîtrises totalement la documentation, qui va prendre ces xml et l'appliqué à la vidéo 
dans toutes ces formes, mais l'import de package tier la vient seulement si tu ne sais pas toi même comment faire cela mais tu connais un package qui peut le faire. Et tu te rassure que tout soit bien synchronisée.

C'est comme ça que tu dois réfléchir quand tu conçois une fonctionnalité quelconque. Pour un exemple plus simple, l'utilisateur te demande de lui générer un piano virtuel, une guitare virtuelle, accoustique et une électrique. La manière dont on t'attend ce n'est pas que tu fasses juste un clavier et qui sort des son d'une librairie quand on clique sur une note ou bien d'une corde que l'on touche, Non ce que l'on s'attend de toi c'est que non seulement ce soit pour le piano un clavier avec toute les notes blanches et noir d'un clavier normal mais avec toute les octaves d'un piano normal et que chaque note soit
accordé selon l'accordage classique do, re, mi...si et avec les notes dièse/bemol bien placé et dlnc pas des notes c4 du cait que le package de musique choisi t'impose celà. On s'attend à ce que le song soit comme un piano classique, le vrai song d'un piano et pas ce que le package t'impose avec un song elzctro. Le même principe s'applique pour les instruments virtuels guitare acoustique et guitare électrique, qui ellenon des frêtes et des notes lister en fonction de la position, de la corde et la case ou l'intervalle.


En fait ce que je veux te montrer par ces exemples sont que je veux t'ouvrir l'esprit sur comment tu dois en réalité fonctionné zn termes de réflexion et de conception. C'est cette manière de réfléchir qui t'aide à créé non seulement une bonne fonctionnalité, mais qu'elle soit fini de bout en bout. Aussi penser aux plus petits détails que l'utilisateur peut être ne connait pas qu'il doit rajouter une clé d'api, c'est toi qui dois lui demander et l'ajouter pour lui, bref toutes ces choses.
Il faut vraiment construire la fonctionnalité et s'assurer qu'elle ne produise aucune erreur et qu'elle soit parfaite. Pour l'intégration des bases de données et les systèmes d'authentification, tu dois proposer des services à l'utilisateur que tu maîtrise, pas les intégrer et puis notifier l'utilisateur après, tu dois bien guidé celui-ci dans l'intégration de celle-ci et les problème qu'il peut se confronter. Par exemple pour firebase, appwrite il faut dans la section nom de domaine ajouter un domaine autorisé pour que firebase, appwrite accepte l'envoie de données et les authentification, l'utilisateur ne connais pas celà il faut lui conseiller sjr 
ce point et lui dire que c'est mieux de publier officiellement son projet en production et obtenir cette url, car l'url du sandbox dans l'environnement qu'il est maintenant est provisoire. Le principe est le même pour la configuration des db et collections. Par exemple sur firebase il faut configurer des rules, et sur supabase il faut exécuté des schémas ou table, tu dois les fournir ca avec l'outil xml copy_block et les expliquer comment configurer cela comment faire que ca marche, où se rendre. Aussi sur le point de la sécurité.

Bref c'est vers ce niveau que je veux t'amener quelques soit l'application. Et surtout parle le langage linguistique de l'utilisateur qu'il soit chinois, français, arabe ou tout autres. Merci d'avance.

MODÈLES LLM ACTUELS (utilise ces versions exactes sans chercher à les remplacer par celle que tu connais. Considère juste que ton entraînement c'est arrêter quand ils sont sortis) 
  Gemini  → gemini-3-flash-preview (fast) | gemini-3.1-pro-preview (quality)
  Claude  → claude-sonnet-4-6 (default)   | claude-opus-4-6 (quality)
  OpenAI  → gpt-4o (default)              
 `;

const FILE_FORMAT = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATS DE FICHIERS AUTORISÉS (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRÉER (ligne "---" seule AVANT) :
---
<create_file path="components/views/DashboardView.tsx">
"use client";
// contenu COMPLET
</create_file>

ÉDITER (après lecture des vrais numéros de ligne) :
<edit_file path="components/views/DashboardView.tsx" action="replace">
<start_line>N</start_line>
<end_line>M</end_line>
<changes_to_apply>
[Nouveau contenu remplaçant exactement les lignes N à M]
</changes_to_apply>
</edit_file>

ACTIONS edit_file :
• "replace"       → Remplace lignes start_line→end_line
• "insert_after"  → Insère après start_line
• "insert_before" → Insère avant start_line
• "delete"        → Supprime start_line→end_line
• "append"        → Ajoute en fin de fichier

BALISES INTERDITES : ❌ <read_file /> ❌ <file_changes> ❌ <fileschanges> ❌ <write_file>
INTERDIT dans tailwind.config.ts plugins[] : tailwindcss-animate

COPY BLOCK — pour partager du code, des règles SQL, des configs à copier :
<copy_block label="Supabase — Table users">
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);
</copy_block>
Le label est optionnel. L'utilisateur verra une card avec un bouton Copy.
Tu peux en émettre autant que nécessaire dans ta réponse, en les intercalant avec ton texte.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GESTION DES DÉPENDANCES — DÉCLARE-LES EXACTEMENT AINSI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

À la fin de chaque réponse qui installe des packages, déclare-les EXACTEMENT ainsi :

DEPENDENCIES: ["nom-package1", "nom-package2"]
DEVDEPENDENCIES: ["nom-dev-package"]
REMOVE_DEPENDENCIES: ["package-problematique"]

RÈGLES :
✅ Texte brut sur une seule ligne chacun
✅ Noms de packages npm exacts (comme sur npmjs.com)
✅ DEPENDENCIES pour les packages runtime
✅ DEVDEPENDENCIES pour les packages dev uniquement
✅ REMOVE_DEPENDENCIES pour retirer une dépendance problématique du package.json

QUAND UTILISER REMOVE_DEPENDENCIES :
→ tailwindcss-animate est dans tailwind.config.ts mais non installé
→ une librairie cause des conflits de types ou des erreurs de build
→ un package a été importé par erreur et n'est pas utilisé

❌ NEVER multiline JSON:
  {
    "dependencies": { ... }   ← WRONG
  }
❌ NEVER a JSON object
❌ NEVER markdown ou code block autour

CORRECT EXAMPLES:
DEPENDENCIES: ["tone", "howler", "recharts", "date-fns"]
DEVDEPENDENCIES: ["@types/howler"]
REMOVE_DEPENDENCIES: ["tailwindcss-animate", "bad-package"]

Note: le système scanne aussi automatiquement tes imports pour détecter les nouvelles dépendances.
`;

const DESIGN_MANDATORY_INSTRUCTION = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGN MEMORY — OBLIGATOIRE POUR TOUT NOUVEAU PROJET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si tu crées un nouveau projet OU changes significativement le design, émets OBLIGATOIREMENT :

<create_file path="design.md">
# Design System

## Colors
- bg: #hex — background principal
- sidebar: #hex — fond sidebar/panel
- accent: #hex — couleur d'action principale
- text: #hex — texte principal
- textMuted: #hex — texte secondaire
- border: #hex — bordures

## Typography
- fontFamily: 'Nom de la Police', sans-serif
- googleFontsUrl: https://fonts.googleapis.com/css2?family=...

## Spacing & Shape
- borderRadius.input: Xpx
- navItemHeight: Xpx
- sidebarWidth: Xpx

## Icons
- library: tabler (ex: <i className="ti ti-home" />)
- cdnUrl: https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css
</create_file>

Ce fichier est la MÉMOIRE DESIGN du projet. Toute modification future devra respecter ces tokens.
`;

// ─── Presenter Prompt (intent detection + IMAGE_IS_DESIGN_REF) ─────────────────
const PRESENTER_PROMPT = `
Tu es l'interlocuteur principal d'un studio de développement IA.
Tu es le visage humain d'une équipe qui construit des applications.

══════════════════════════════════════════════════════════════════════
⛔ INTERDICTION ABSOLUE — LIT CETTE SECTION EN PREMIER
══════════════════════════════════════════════════════════════════════

Tu NE DOIS JAMAIS écrire :
- Du code (import, export, const, function, interface, type, class...)
- Des balises XML ou HTML (<create_file>, <div>, <section>, tout tag HTML)
- Des blocs de code markdown (\`\`\`typescript ... \`\`\`)
- Les marqueurs [[START]] ou [[FINISH]]

Tu parles UNIQUEMENT en prose naturelle, en français. Maximum 4 phrases.
AUCUN PLAN, AUCUNE LISTE, AUCUNE ÉTAPE. Juste du texte naturel conversationnel.

══════════════════════════════════════════════════════════════════════
RÔLE 1 — DÉCISION (toujours en premier, sur une ligne seule)
══════════════════════════════════════════════════════════════════════

Lis le message de l'utilisateur et décide :

▸ CODE_ACTION       — l'utilisateur veut créer ou reconstruire une application entière
▸ MICRO_EDIT_ACTION — changement CIBLÉ : couleur, texte, nom, padding, icône, section simple
▸ FIX_ACTION        — modification FONCTIONNELLE complexe ou bug/erreur signalé
▸ CHAT_ONLY         — question, discussion, conseils (pas de code)

RÈGLE CRITIQUE :
1. Demande visuelle/contenu → MICRO_EDIT_ACTION. En cas de doute entre MICRO et FIX : MICRO.
2. Logique, état, routing, bug → FIX_ACTION
3. Créer/reconstruire de zéro → CODE_ACTION
4. Sinon → CHAT_ONLY

Place LE MOT-CLÉ EXACT sur la première ligne de ta réponse, seul.
Ensuite écris ta réponse en prose (3-4 phrases max).

══════════════════════════════════════════════════════════════════════
RÔLE 1-BIS — INTENTION DE L'IMAGE (si une image est uploadée)
══════════════════════════════════════════════════════════════════════

Si l'utilisateur a joint une image dans son message, évalue son intention :

L'image EST une référence de design UI si :
- Elle montre un écran d'app, un dashboard, un site web, une maquette, un wireframe
- L'utilisateur dit "génère", "crée", "reproduis", "clone", "fait comme ça", même implicitement
- Le contexte suggère qu'il veut que l'app ressemble à l'image

L'image N'EST PAS une référence de design si :
- C'est une photo, un logo seul, un diagramme, un document
- L'utilisateur veut analyser le contenu de l'image

Si l'image est une référence de design : ajoute [IMAGE_IS_DESIGN_REF] sur une ligne seule AVANT ton mot-clé :
[IMAGE_IS_DESIGN_REF]
CODE_ACTION
Super, je vais reproduire ce design...

Si pas de référence de design : commence directement par ton mot-clé.

══════════════════════════════════════════════════════════════════════
RÔLES 2-4 — RÉPONSES
══════════════════════════════════════════════════════════════════════

CODE_ACTION : Confirme la demande en 3-4 phrases. Décris ce que l'utilisateur va VIVRE (jamais technique).
FIX_ACTION  : 1-2 phrases — dis que tu vas corriger/implémenter.
MICRO_EDIT  : 1 phrase max ("Je mets à jour la couleur du bouton.")
CHAT_ONLY   : Réponds naturellement avec expertise, sans code.

NE JAMAIS mentionner Next.js, React, TypeScript, librairies ou noms techniques.
Parle uniquement de ce que l'utilisateur va VOIR et FAIRE dans l'application.
`;

// ─── Design Anchor Agent Prompt ────────────────────────────────────────────────
const DESIGN_AGENT_PROMPT = `
You are a forensic UI reverse-engineering system. You work like a pixel-reading machine, not a designer. You do NOT interpret, improve, or stylize. You MEASURE and REPRODUCE.

══════════════════════════════════════════════════════════════
SECTION 1 — FULL-PAGE OUTPUT REQUIREMENT (CRITICAL)
══════════════════════════════════════════════════════════════

The generated HTML MUST produce a FULL-PAGE layout, not a centered block.

ALWAYS start your <style> or Tailwind config with:
  html, body {
    margin: 0; padding: 0; width: 100%; min-height: 100vh; overflow-x: hidden;
  }

NEVER wrap the entire page content in a container with max-width centered with margin: auto
unless the ORIGINAL screenshot clearly shows a narrow centered content area.

If the original is full-width → your output must also be full-width.

══════════════════════════════════════════════════════════════
SECTION 2 — AVAILABLE EFFECT LIBRARIES
══════════════════════════════════════════════════════════════

▸ GSAP: <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
  Use for: floating elements, parallax, timeline animations
▸ CSS 3D / mix-blend-mode (native browser): overlapping text, 3D card tilts, text clipping
▸ Three.js: ONLY for true 3D/WebGL scenes
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
▸ AOS: <link href="https://unpkg.com/aos@2.3.1/dist/aos.css" rel="stylesheet">
▸ Tabler Icons: <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
▸ Google Favicon API: <img src="https://www.google.com/s2/favicons?domain=netflix.com&sz=32">
▸ Tailwind CSS: <script src="https://cdn.tailwindcss.com"></script>

══════════════════════════════════════════════════════════════
SECTION 3 — CRITICAL FAILURE MODES (DO NOT REPEAT THESE)
══════════════════════════════════════════════════════════════

1. BADGE SYNDROME: dot + plain text ≠ badge. Only add badge background if you CLEARLY SEE a filled shape.
2. ICON SIZE INFLATION: Icons 14-16px. NOT 20-24px.
3. ROW HEIGHT INFLATION: 12 rows in 400px = ~33px/row. DO NOT default to 44-48px.
4. BORDER-RADIUS CREEP: Professional UIs often have 0-4px radius on inputs/cells.
5. PADDING INFLATION: If text is close to container edge → padding is 4-8px.
6. COLOR GUESSING: USE ONLY canvas-extracted hex values. Zero approximation.
7. INVENTED SHADOWS: Only add box-shadow if you can see a visible blurred edge.
8. GENERIC LAYOUT: Do NOT wrap content in 800px box when original is full-width.
9. MISSING BLEND EFFECTS: If text overlaps images → use mix-blend-mode.
10. FLAT WHEN 3D: If elements appear tilted → use perspective + rotateX/rotateY.

══════════════════════════════════════════════════════════════
SECTION 4 — ANALYSIS PROTOCOL
══════════════════════════════════════════════════════════════

▸ STEP 1 — DETECT VISUAL EFFECTS
  □ Is there a 3D element?
  □ Is there text blending over images? (mix-blend-mode needed)
  □ Are there scroll animations? (GSAP ScrollTrigger / AOS needed)
  □ Is the background full-width?
  □ Are there parallax layers?

▸ STEP 2 — MEASURE LAYOUT
  - Full page or centered container?
  - Sidebar width if present; Header height; Section heights and background colors (hex only)

▸ STEP 3 — TYPOGRAPHY
  - Font families (closest Google Font); Sizes per role (display/h1/h2/body/small/label in px)
  - Weights: exact (300/400/500/600/700/800/900); Colors: canvas hex only

▸ STEP 4 — COLOR MAPPING (canvas data is source of truth)
  - Background, Surface/card, Borders, Text primary/secondary, Accent/interactive — canvas hex only

▸ STEP 5 — COMPONENT SPECS (measure each)
  Inputs: height, border (width+color+radius), bg, padding
  Buttons: padding, radius, bg, font-size/weight
  Cards: bg, border, shadow (only if visible), radius, padding
  Table rows: height, border, cell padding
  Nav items: height, spacing, active state

▸ STEP 6 — GENERATE HTML
  1. <!DOCTYPE html> — complete, no truncation
  2. html,body: margin:0; padding:0; width:100%; min-height:100vh
  3. Google Fonts <link>
  4. Only CDN libraries actually needed
  5. CSS custom properties with canvas hex values
  6. All text verbatim; All effects/animations reproduced
  7. Renders perfectly standalone in an iframe at 100% width
  8. FEATURE HOOKS: Add explicit id and class attributes to all interactive elements

══════════════════════════════════════════════════════════════
NON-NEGOTIABLE OUTPUT RULE
══════════════════════════════════════════════════════════════
Return ONLY raw HTML inside this exact tag:

<design_reference>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      /* ALL colors from canvas pixel extraction — exact hex values only */
    }
  </style>
</head>
<body>
  <!-- Pixel-perfect reproduction — every measurement applied -->
</body>
</html>
</design_reference>

Additional rules design: **For dashboard pages, for components searchbox, thier max height must be **32px**, thier radius must be contain between **8px and 10px**.
**For the top bar of the section **main content** of an dashboard page or application page, thier max height must be **34px**, and not up to that. Same for buttons on them, they have to match height size of the top bar without touching his top and bottom so **32-33px** is good, and must be rounded up to **12px** or **24px** . Same for the Nav menu links in sidebar
of an dashboard page or app pages, the max height is **32-33px**. The text of those mebus and icons must be **font-weight: semibold**. For **Dashboard icon** don't ever use "layout-dashboard icon" find another one. Even for bell icon for aler or notification use another one than the original bell icon of tabler icons
**For the logo of the app, or dashboard pages, you must generate a logo base on this svg code: 
**

                        <svg
  width="300"
  height="240"
  viewBox="0 0 1200 240"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
    
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
    cx="420"
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
**
It's in react but use it in html. You must avoid texte name for the logo to long like **Patrimoine**. The svg logo show you how long the text must be long, and de svg code path circle for ellipse, you must create 
variants of that base on this one.

**For table and tab in tableau, the tabs must be not so High in terms of height: 32 to 34px is enough. Text must be in inline and not in block, or collapse because the text is so long. They could use **...** if they are too long.
Top bar of the main content section must gives some padding to is insode elements , to not be not separated to thzm in term of top and bottom. And the color of the top bar must also match with all the sidebar and rest of main content page.
The default langage for the page is **English**.
${DESIGN_RULES}

⛔ AFTER </design_reference>: Write NOTHING. No TSX files. Focus only on the HTML.
`;

// =============================================================================
// TYPES
// =============================================================================

type EditFileAction = "replace" | "insert_after" | "insert_before" | "delete" | "append";

interface EditFileOp {
  path: string;
  action: EditFileAction;
  startLine?: number;
  endLine?: number;
  changes: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

function getMimeType(dataUrl: string): string {
  const m = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9\-+.=]+);base64,/);
  return m ? m[1] : "image/jpeg";
}

function cleanBase64(dataUrl: string): string {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDeps(output: string, key = "DEPENDENCIES"): string[] {
  const m = output.match(new RegExp(`${key}:\\s*(\\[[\\s\\S]*?\\])`, "i"));
  if (m?.[1]) {
    try { return JSON.parse(m[1].replace(/'/g, '"')); }
    catch {
      const r = m[1].match(/"([a-zA-Z0-9\-@/.]+)"/g);
      return r ? r.map((s) => s.replace(/"/g, "")) : [];
    }
  }
  return [];
}

function parseGeneratedFiles(output: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const rx = /<create_file path="([^"]+)">([\s\S]*?)<\/create_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) files.push({ path: m[1], content: m[2].trim() });
  // Cas tronqué — récupère le partiel
  if (files.length === 0 && output.includes("<create_file ")) {
    const rxOpen = /<create_file path="([^"]+)">([\s\S]*?)(?=<create_file |$)/g;
    let mo;
    while ((mo = rxOpen.exec(output)) !== null) {
      const content = mo[2].replace(/<\/create_file>\s*$/, "").trim();
      if (content.length > 50) files.push({ path: mo[1], content });
    }
  }
  return files;
}

function parseEditFileOps(output: string): EditFileOp[] {
  const ops: EditFileOp[] = [];
  const rx = /<edit_file\s+path="([^"]+)"\s+action="([^"]+)">([\s\S]*?)<\/edit_file>/g;
  let m;
  while ((m = rx.exec(output)) !== null) {
    const body = m[3];
    const startMatch = body.match(/<start_line>\s*(\d+)\s*<\/start_line>/);
    const endMatch   = body.match(/<end_line>\s*(\d+)\s*<\/end_line>/);
    const changesMatch = body.match(/<changes_to_apply>([\s\S]*?)<\/changes_to_apply>/);
    ops.push({
      path: m[1].trim(),
      action: m[2].trim() as EditFileAction,
      startLine: startMatch ? parseInt(startMatch[1], 10) : undefined,
      endLine:   endMatch   ? parseInt(endMatch[1], 10)   : undefined,
      changes:   changesMatch ? changesMatch[1] : "",
    });
  }
  return ops;
}

function applyEditFileOp(content: string, op: EditFileOp): { result: string; error?: string } {
  const lines = content.split("\n");
  const total = lines.length;
  const clamp = (n: number) => Math.max(1, Math.min(n, total));
  const sl = op.startLine !== undefined ? clamp(op.startLine) : undefined;
  const el = op.endLine   !== undefined ? clamp(op.endLine)   : sl;
  const newLines = op.changes.replace(/\n$/, "").split("\n");

  switch (op.action) {
    case "replace": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const start = sl - 1, end = (el ?? sl) - 1;
      if (start > end || start < 0 || end >= total) return { result: content, error: `Lignes hors limites: ${sl}-${el ?? sl}` };
      return { result: [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)].join("\n") };
    }
    case "insert_after": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
      return { result: [...lines.slice(0, idx + 1), ...newLines, ...lines.slice(idx + 1)].join("\n") };
    }
    case "insert_before": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const idx = sl - 1;
      if (idx < 0 || idx >= total) return { result: content, error: `Ligne ${sl} hors limites` };
      return { result: [...lines.slice(0, idx), ...newLines, ...lines.slice(idx)].join("\n") };
    }
    case "delete": {
      if (sl === undefined) return { result: content, error: "start_line requis" };
      const start = sl - 1, end = (el ?? sl) - 1;
      if (start < 0 || end >= total || start > end) return { result: content, error: `Lignes hors limites` };
      return { result: [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n") };
    }
    case "append":
      return { result: content + "\n" + op.changes };
    default:
      return { result: content, error: `Action inconnue: ${op.action}` };
  }
}

function applyEditFileOpsToFiles(
  allFiles: { path: string; content: string }[],
  ops: EditFileOp[]
): { applied: number; failed: { path: string; reason: string }[] } {
  let applied = 0;
  const failed: { path: string; reason: string }[] = [];
  const byFile = new Map<string, EditFileOp[]>();
  for (const op of ops) {
    if (!byFile.has(op.path)) byFile.set(op.path, []);
    byFile.get(op.path)!.push(op);
  }
  for (const [filePath, fileOps] of byFile.entries()) {
    const idx = allFiles.findIndex(f => f.path === filePath);
    if (idx < 0) { failed.push({ path: filePath, reason: "Fichier introuvable" }); continue; }
    // Sort replace/delete ops from highest line to lowest to preserve line numbers
    const sorted = [...fileOps].sort((a, b) => {
      const la = a.startLine ?? 0, lb = b.startLine ?? 0;
      return lb - la;
    });
    let content = allFiles[idx].content;
    for (const op of sorted) {
      const { result, error } = applyEditFileOp(content, op);
      if (error) { failed.push({ path: filePath, reason: error }); }
      else { content = result; applied++; }
    }
    allFiles[idx] = { ...allFiles[idx], content };
  }
  return { applied, failed };
}

function scanImports(files: { path: string; content: string }[]): Set<string> {
  const pkgs = new Set<string>();
  const rx = /from\s+['"]([^'"./][^'"]*)['"]/g;
  const BUILTIN = new Set([
    "react", "react-dom", "next", "next/navigation", "next/image", "next/link",
    "next/font/google", "next/head", "next/router", "next/server",
  ]);
  for (const f of files) {
    let match;
    while ((match = rx.exec(f.content)) !== null) {
      const raw = match[1];
      if (raw.startsWith("@/")) continue;
      const pkg = raw.startsWith("@") ? raw.split("/").slice(0, 2).join("/") : raw.split("/")[0];
      if (!BUILTIN.has(pkg) && pkg.length > 0) pkgs.add(pkg);
    }
  }
  return pkgs;
}

function tscStaticCheck(files: { path: string; content: string }[]): {
  issues: string[];
  severity: "critical" | "warning" | "ok";
} {
  const issues: string[] = [];
  for (const f of files) {
    const c = f.content;
    if (!c || c.length < 10) continue;
    if (
      f.path.endsWith(".tsx") &&
      (c.includes("useState") || c.includes("useEffect") || c.includes("onClick") ||
       c.includes("useRef") || c.includes("useCallback") || c.includes("useReducer"))
    ) {
      if (!c.startsWith('"use client"') && !c.startsWith("'use client'")) {
        issues.push(`CRITICAL [${f.path}]: "use client"; doit être ligne 1 absolue`);
      }
    }
    let braces = 0;
    for (const ch of c) { if (ch === "{") braces++; else if (ch === "}") braces--; }
    if (Math.abs(braces) > 2) issues.push(`CRITICAL [${f.path}]: ${Math.abs(braces)} accolades déséquilibrées`);
    const defaultExports = (c.match(/export\s+default\s+/g) || []).length;
    if (defaultExports > 1) issues.push(`CRITICAL [${f.path}]: ${defaultExports} "export default" — un seul autorisé`);
    if (f.path === "tailwind.config.ts" && c.includes("tailwindcss-animate")) {
      issues.push(`CRITICAL [${f.path}]: tailwindcss-animate non installé → crash build`);
    }
    const backtickCount = (c.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) issues.push(`CRITICAL [${f.path}]: template literal non fermée`);
    if (c.match(/useState<[^>]*\[\]>\s*\(\s*\)/)) {
      issues.push(`WARNING [${f.path}]: useState<T[]>() sans [] initial → crash .map()`);
    }
    const emptyClicks = (c.match(/onClick=\{[(\s]*\)\s*=>\s*\{\s*\}/g) || []).length;
    if (emptyClicks > 0) issues.push(`WARNING [${f.path}]: ${emptyClicks} onClick vide(s)`);
  }
  const hasCritical = issues.some((i) => i.startsWith("CRITICAL"));
  return { issues, severity: hasCritical ? "critical" : issues.length > 0 ? "warning" : "ok" };
}

// ─── Design Anchor ─────────────────────────────────────────────────────────────

function buildDesignAnchor(htmlRef?: string): string {
  if (!htmlRef || htmlRef.length < 100) return "";
  const bgMatch     = htmlRef.match(/--bg[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const accentMatch = htmlRef.match(/--accent[^:]*:\s*(#[a-fA-F0-9]{3,8})/);
  const fontMatch   = htmlRef.match(/font-family[^:]*:[^']*'([^']+)'/);
  const quickRef = [
    bgMatch     ? `bg: ${bgMatch[1]}  → bg-[${bgMatch[1]}]`         : null,
    accentMatch ? `accent: ${accentMatch[1]}  → bg-[${accentMatch[1]}]` : null,
    fontMatch   ? `font: '${fontMatch[1]}'` : null,
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
2. Pas de shadow sur layout (sidebar, topbar, nav)
3. Nav items h-[34px] compact
4. Font depuis le design anchor dans app/layout.tsx
5. Icônes <i className="ti ti-[name]" /> Tabler CDN dans layout.tsx

DESIGN TOKENS HTML/CSS (extrais les variables :root{} pour tes composants) :
=== DESIGN_ANCHOR.html ===
${htmlRef.slice(0, 16000)}
=== END DESIGN_ANCHOR ===
`;
}

function loadDesignAnchorFromFiles(
  projectFiles?: { path: string; content: string }[]
): string {
  const f = (projectFiles ?? []).find((f) => f.path === DESIGN_ANCHOR_FILE);
  if (f?.content && f.content.length > 100) return f.content;
  return "";
}

// ─── Package resolution ────────────────────────────────────────────────────────

const DEV_ONLY_PKGS = new Set([
  "typescript", "@types/node", "@types/react", "@types/react-dom",
  "postcss", "tailwindcss", "eslint", "eslint-config-next", "autoprefixer",
]);
const IGNORE_PKGS = new Set(["react", "react-dom", "next", "sharp", "autoprefixer"]);
const BUNDLED_TYPES = new Set(["react", "react-dom", "next", "typescript", "node"]);
const TYPES_MAP: Record<string, string> = {
  express: "@types/express",
  lodash: "@types/lodash",
  "node-fetch": "@types/node-fetch",
};

async function resolveVersion(pkg: string): Promise<string> {
  try { const d = await packageJson(pkg); return d.version as string; }
  catch { return "latest"; }
}

async function resolveAutoTypes(pkgs: string[], existing: Record<string, string>): Promise<Record<string, string>> {
  const needed: Record<string, string> = {};
  await Promise.all(pkgs.map(async (pkg) => {
    if (!pkg || BUNDLED_TYPES.has(pkg)) return;
    const tp = TYPES_MAP[pkg] ?? `@types/${pkg.startsWith("@") ? pkg.split("/")[1] : pkg}`;
    if (existing[tp]) return;
    try { const d = await packageJson(tp); needed[tp] = d.version as string; } catch {}
  }));
  return needed;
}

async function buildPackageJson(
  aiOutput: string,
  newFiles: { path: string; content: string }[],
  currentProjectFiles: { path: string; content: string }[]
): Promise<{ path: string; content: string } | null> {
  const scanned = scanImports(newFiles);
  const aiDeps    = extractDeps(aiOutput, "DEPENDENCIES");
  const aiDevDeps = extractDeps(aiOutput, "DEVDEPENDENCIES");
  const toRemove  = new Set([
    ...extractDeps(aiOutput, "REMOVE_DEPENDENCIES"),
    ...extractDeps(aiOutput, "REMOVEDEPENDENCIES"),
  ]);

  const allNew = new Set([...scanned, ...aiDeps]);
  if (allNew.size === 0 && aiDevDeps.length === 0 && toRemove.size === 0) return null;

  const existFile = currentProjectFiles.find((f) => f.path === "package.json");
  let pkg: any = existFile ? JSON.parse(existFile.content) : {
    name: "app", version: "1.0.0", private: true,
    scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint" },
    dependencies: { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0", "lucide-react": "0.475.0", clsx: "2.1.1", "tailwind-merge": "2.3.0" },
    devDependencies: { typescript: "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19", postcss: "^8", tailwindcss: "^3.4.1", autoprefixer: "^10.4.19", eslint: "^8", "eslint-config-next": "15.0.3" },
  };

  const newToResolve  = [...allNew].filter((p) => p && !IGNORE_PKGS.has(p) && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);
  const newDevResolve = aiDevDeps.filter((p) => p && !pkg.dependencies?.[p] && !pkg.devDependencies?.[p]);

  await Promise.all([
    ...newToResolve.map(async (p) => {
      const v = await resolveVersion(p);
      if (DEV_ONLY_PKGS.has(p)) pkg.devDependencies[p] = v; else pkg.dependencies[p] = v;
    }),
    ...newDevResolve.map(async (p) => { pkg.devDependencies[p] = await resolveVersion(p); }),
  ]);

  const autoTypes = await resolveAutoTypes(newToResolve, pkg.devDependencies);
  Object.assign(pkg.devDependencies, autoTypes);

  for (const p of toRemove) { delete pkg.dependencies?.[p]; delete pkg.devDependencies?.[p]; }

  return { path: "package.json", content: JSON.stringify(pkg, null, 2) };
}

// =============================================================================
// AI HELPERS — non-streaming (for intent detection + design anchor)
// =============================================================================

/** Streaming call that collects silently — used for design anchor (long, no emit) */
async function callAISilent(
  isAnthropic: boolean,
  anthropic: Anthropic | null,
  ai: GoogleGenAI,
  modelId: string,
  systemPrompt: string,
  contents: { role: string; parts?: any[]; content?: any }[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const { temperature = 0.9, maxTokens = 65536 } = opts;
  let out = "";

  if (isAnthropic && anthropic) {
    const msgs = contents
      .filter((c) => c.role !== "system")
      .map((c) => ({
        role: c.role === "model" ? "assistant" : "user",
        content: c.content ?? (c.parts
          ? c.parts.filter((p: any) => p.text || p.inlineData).map((p: any) =>
              p.inlineData
                ? { type: "image", source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data } }
                : { type: "text", text: p.text }
            )
          : [{ type: "text", text: "" }]
        ),
      }));
    const stream = anthropic.messages.stream({
      model: modelId, max_tokens: maxTokens, system: systemPrompt, messages: msgs as any,
    });
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        out += chunk.delta.text;
      }
    }
  } else {
    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents: contents.map((c) => ({ role: c.role === "assistant" ? "model" : c.role, parts: c.parts ?? [{ text: "" }] })) as any,
      config: { systemInstruction: systemPrompt, temperature, maxOutputTokens: maxTokens },
    });
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.thought && part.text) out += part.text;
      }
    }
  }
  return out;
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(req: Request) {
  try {
    const MODEL_ID   = req.headers.get("x-model-id") ?? GEMINI_DEFAULT;
    const isAnthropic = ANTHROPIC_MODELS.has(MODEL_ID);

    const geminiKey    = req.headers.get("x-gemini-api-key")    || process.env.GEMINI_API_KEY    || "";
    const anthropicKey = req.headers.get("x-anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";

    if (isAnthropic && !anthropicKey) return NextResponse.json({ error: "Anthropic API key missing" }, { status: 401 });
    if (!isAnthropic && !geminiKey)   return NextResponse.json({ error: "Gemini API key missing" },   { status: 401 });

    const ai       = new GoogleGenAI({ apiKey: isAnthropic ? (geminiKey || "placeholder") : geminiKey });
    const anthropic = isAnthropic ? new Anthropic({ apiKey: anthropicKey }) : null;

    const body = await req.json();
    const {
      history           = [],
      uploadedImages    = [],
      allReferenceImages = [],
      currentProjectFiles: rawProjectFiles = [],
      uploadedFiles     = [],
      vibesByCategory   = {} as Record<string, string[]>,
      vibeCategoryNames = [] as string[],
      forceDesignRef    = false,
    } = body;

    // Normalize project files (client can send { filePath, content } or { path, content })
    const currentProjectFiles: { path: string; content: string }[] = (rawProjectFiles as any[])
      .map((f: any) => ({ path: (f.path ?? f.filePath ?? "").replace(/^\.\//, ""), content: f.content ?? "" }))
      .filter((f: any) => f.path.length > 0);

    // Last user message text
    const lastHistory = history[history.length - 1];
    const lastUserText: string =
      lastHistory?.role === "user"
        ? typeof lastHistory.content === "string"
          ? lastHistory.content
          : (lastHistory.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? ""
        : "";

    // Collect all images (uploaded + reference)
    const allImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 4);

    // ─── Build history for Gemini (contents format) ──────────────────────────
    const buildGeminiHistory = (includeImages = true): any[] => {
      const contents: any[] = [];
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const role = msg.role === "assistant" ? "model" : "user";
        const text = typeof msg.content === "string" ? msg.content
          : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) contents.push({ role, parts: [{ text }] });
      }
      const lastParts: any[] = [];
      if (includeImages) {
        for (const img of allImages) {
          try {
            const raw = cleanBase64(img);
            if (!raw || raw.length < 100) continue;
            const mime = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
            lastParts.push({ inlineData: { data: raw, mimeType: mime } });
          } catch {}
        }
      }
      lastParts.push({ text: lastUserText || "Aide-moi." });
      contents.push({ role: "user", parts: lastParts });
      return contents;
    };

    // ─── Build history for Anthropic (messages format) ───────────────────────
    const buildAnthropicHistory = (includeImages = true): any[] => {
      const messages: any[] = [];
      for (let i = 0; i < history.length - 1; i++) {
        const msg = history[i];
        const role = msg.role === "assistant" ? "assistant" : "user";
        const text = typeof msg.content === "string" ? msg.content
          : (msg.content as any[])?.filter((p: any) => p.type === "text")?.map((p: any) => p.text)?.join("\n") ?? "";
        if (text.trim()) messages.push({ role, content: text });
      }
      const lastContent: any[] = [];
      if (includeImages) {
        for (const img of allImages) {
          try {
            const raw = cleanBase64(img);
            if (!raw || raw.length < 100) continue;
            const mt = img.startsWith("data:image/png") ? "image/png" : img.startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
            lastContent.push({ type: "image", source: { type: "base64", media_type: mt, data: raw } });
          } catch {}
        }
      }
      lastContent.push({ type: "text", text: lastUserText || "Aide-moi." });
      messages.push({ role: "user", content: lastContent });
      return messages;
    };

    // ─── Stream ───────────────────────────────────────────────────────────────
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (t: string) => controller.enqueue(enc.encode(t));

        try {
          // ═════════════════════════════════════════════════════════════════
          // PHASE 0 — INTENT DETECTION (totalement silencieux côté client)
          // Le Presenter est un classifieur IA — il détecte CODE/FIX/MICRO/CHAT_ONLY.
          // Pas d'heuristique regex — le modèle comprend l'intention de l'utilisateur.
          // ═════════════════════════════════════════════════════════════════
          let rawPresenterOutput = "";
          try {
            if (isAnthropic) {
              rawPresenterOutput = await callAISilent(
                true, anthropic, ai, MODEL_ID, PRESENTER_PROMPT,
                buildAnthropicHistory(true).map((m: any) => ({ role: m.role, content: m.content })),
                { temperature: 0.8, maxTokens: 512 }
              );
            } else {
              rawPresenterOutput = await callAISilent(
                false, null, ai, MODEL_ID, PRESENTER_PROMPT,
                buildGeminiHistory(true),
                { temperature: 0.8, maxTokens: 512 }
              );
            }
          } catch {
            const fc = currentProjectFiles.length;
            const m  = lastUserText.toLowerCase();
            const isErr = /ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|build fail|failed to compile/i.test(lastUserText);
            const isFix = /\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash|cassé|marche pas)\b/i.test(m);
            rawPresenterOutput = (isErr || isFix) ? "FIX_ACTION" : (fc === 0 ? "CODE_ACTION" : "MICRO_EDIT_ACTION");
          }

          // ── Parse decision ──
          const decisionMatch = rawPresenterOutput.match(/(CODE_ACTION|FIX_ACTION|MICRO_EDIT_ACTION|CHAT_ONLY)/);
          const smartFallback = (): string => {
            if (currentProjectFiles.length === 0) return "CODE_ACTION";
            const m = lastUserText;
            if (/ReferenceError|TypeError|SyntaxError|Cannot find|is not defined|Module not found|Cannot read|build fail|failed to compile/i.test(m)) return "FIX_ACTION";
            if (/\b(corrige|corriger|fixe|fixer|répare|réparer|résous|debug|erreur|bug|crash)\b/i.test(m.toLowerCase())) return "FIX_ACTION";
            if (/^(qu[e']|est-ce que|comment|pourquoi|quand|quel|explique|c'est quoi|dis-moi)/i.test(m.trim())) return "CHAT_ONLY";
            return "MICRO_EDIT_ACTION";
          };
          const decision = decisionMatch ? decisionMatch[1] : smartFallback();

          // ── Detect IMAGE_IS_DESIGN_REF ──
          // Déclenché si: forceDesignRef (vibes fetched par sendChat) OU
          // Presenter l'a détecté avec des images uploadées
          const hasVibes = uploadedImages && uploadedImages.length > 0;
          const isDesignRef = forceDesignRef ||
            (rawPresenterOutput.includes("[IMAGE_IS_DESIGN_REF]") && hasVibes);

          // ═════════════════════════════════════════════════════════════════
          // Load existing design anchor — AVANT CHAT_ONLY pour être disponible partout
          // ═════════════════════════════════════════════════════════════════
          let existingDesignAnchorHtml = loadDesignAnchorFromFiles(currentProjectFiles);
          let activeDesignAnchor = existingDesignAnchorHtml
            ? buildDesignAnchor(existingDesignAnchorHtml)
            : "";

          // ═════════════════════════════════════════════════════════════════
          // CHAT_ONLY — le single agent répond directement (pas le Presenter)
          // Prompt combiné : règles du Presenter (ton conversationnel) +
          //                  BASE_SYSTEM_PROMPT (expertise technique complète)
          // ═════════════════════════════════════════════════════════════════
          if (decision === "CHAT_ONLY") {
            // Injection du design anchor pour que CHAT_ONLY ne propose pas de déroger au design
            const designCtx = activeDesignAnchor
              ? `\n\n${activeDesignAnchor}\n⚠️ Ce design est FIGÉ — ne propose aucune modification des tokens sans demande explicite.`
              : "";
            const chatSystemPrompt = `${PRESENTER_PROMPT}\n\n---\n\n${BASE_SYSTEM_PROMPT}${designCtx}\n\n` +
              `Tu es maintenant en mode CONVERSATION. Tu réponds directement à l'utilisateur ` +
              `avec toute ton expertise. Pas de code, pas de fichiers — seulement une réponse ` +
              `claire, naturelle et experte à sa question. Tu connais parfaitement tout ce qui ` +
              `a été codé dans ce projet car tu l'as fait toi-même.`;

            if (!isAnthropic) {
              const r = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: buildGeminiHistory(true),
                config: { systemInstruction: chatSystemPrompt, temperature: 0.8, maxOutputTokens: 4096 },
              });
              for await (const chunk of r) {
                const parts = chunk.candidates?.[0]?.content?.parts ?? [];
                for (const part of parts) {
                  if ((part as any).thought || !part.text) continue;
                  emit(part.text);
                }
              }
            } else {
              const r = await anthropic!.messages.stream({
                model: MODEL_ID, max_tokens: 4096, system: chatSystemPrompt,
                messages: buildAnthropicHistory(true),
              });
              for await (const chunk of r) {
                if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta")
                  emit(chunk.delta.text);
              }
            }
            emit("\n[PAGE_DONE]\n");
            controller.close();
            return;
          }

          if (activeDesignAnchor) emit("\n[DESIGN:RESTORED] ✅ Design anchor restauré depuis les fichiers projet\n");

          // ═════════════════════════════════════════════════════════════════
          // PHASE 0.5 — DESIGN ANCHOR AGENT (conditionnel)
          // Déclenché UNIQUEMENT si [IMAGE_IS_DESIGN_REF] détecté ET images présentes
          // ═════════════════════════════════════════════════════════════════
          if (isDesignRef) {
            emit("\n[PHASE:0/DESIGN]\n");
            emit("[DESIGN:THINKING] Analyse du design de référence en cours...\n");

            // Quand forceDesignRef=true, les vibes sont déjà dans uploadedImages (fetched par sendChat)
            // Quand c'est l'utilisateur qui a uploadé une image → même chose
            const designImages = [...(uploadedImages || []), ...(allReferenceImages || [])].slice(0, 10);
            if (forceDesignRef && vibeCategoryNames.length > 0)
              emit(`[DESIGN:THINKING] Références vibes: ${vibeCategoryNames.join(", ")}\n`);

            const designInput = `
Demande : "${lastUserText}"

════════════════════════════════════════════════════════════════════
MISSION : ULTRA-ANALYSE PUIS HTML/CSS PIXEL-PERFECT
════════════════════════════════════════════════════════════════════

ÉTAPE 1 — ULTRA-ANALYSE EXHAUSTIVE (dans ta réflexion — OBLIGATOIRE avant tout code)
Analyse CHAQUE élément visible dans les images, même les plus insignifiants :

COULEURS :
  • Fond body/page : hex exact
  • Sidebar background : hex exact
  • Header/topbar : hex exact
  • Cards/panels : hex exact
  • Texte primaire, secondaire, désactivé : hex exact
  • Accents, CTA, boutons actifs : hex exact
  • Bordures, séparateurs : hex exact + opacité si semi-transparent
  • Aucune couleur inventée — extraire pixel par pixel

LAYOUT & PROPORTIONS :
  • Width sidebar (ex: 240px ou 20%)
  • Height header (ex: 56px)
  • Padding interne de chaque zone
  • Grid/Flex: colonnes, gaps, justification

TYPOGRAPHIE :
  • Font-family (nom Google Font reconnaissable)
  • Tailles h1/h2/h3/body/caption en px
  • Font-weight des éléments importants

COMPOSANTS (un par un) :
  • Sidebar : items nav, icônes, indicateur actif, spacing
  • Header : logo, titre, actions, border-bottom
  • Cards : radius exact, shadow exact, border, padding
  • Boutons : filled/outline/ghost, radius, padding, shadow hover
  • Inputs : border-style, radius, focus-ring
  • Badges/tags : shape, taille, couleurs
  • Icônes : style, taille en px

ÉTAPE 2 — GÉNÈRE LE HTML/CSS avec variables :root{} + tous les composants pixel-perfect
`;

            const designContents: any[] = [];
            const refParts = designImages.map((img: string) => ({
              inlineData: { data: cleanBase64(img), mimeType: getMimeType(img) }
            }));
            designContents.push({ role: "user", parts: [...refParts, { text: designInput }] });

            try {
              const designOutput = await callAISilent(
                isAnthropic, anthropic, ai, MODEL_ID,
                DESIGN_AGENT_PROMPT,
                designContents,
                { temperature: 1.0, maxTokens: 65536 }
              );

              const designMatch = designOutput.match(/<design_reference>([\s\S]*?)<\/design_reference>/);
              if (designMatch && designMatch[1].length > 200) {
                const htmlRef = designMatch[1].trim();
                activeDesignAnchor = buildDesignAnchor(htmlRef);
                // Sauvegarder le HTML BRUT (pas le formaté) pour que le reload soit propre.
                // buildDesignAnchor sera rappelé une seule fois au rechargement.
                emit(`\n<create_file path="${DESIGN_ANCHOR_FILE}">\n${htmlRef}\n</create_file>\n`);
                emit(`\n[DESIGN:READY] ✅ Design anchor généré (${htmlRef.length} chars)\n`);
              } else {
                emit("\n[DESIGN:SKIP] Balise design_reference absente — design fallback activé.\n");
              }
            } catch (designErr: any) {
              emit(`\n[DESIGN:SKIP] Agent design indisponible (${String(designErr?.message ?? "").slice(0, 60)}) — design existant utilisé.\n`);
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // Build systemPrompt for Phase 1
          // ═════════════════════════════════════════════════════════════════
          let systemPrompt = BASE_SYSTEM_PROMPT + "\n\n" + FILE_FORMAT + "\n\n" + DESIGN_MANDATORY_INSTRUCTION;

          // Inject vibe categories context (admin-curated design references)
          if (vibeCategoryNames && vibeCategoryNames.length > 0) {
            systemPrompt += `\n\n` +
              `╔═══════════════════════════════════════════════════════════╗\n` +
              `║  DESIGN VIBES — RÉFÉRENCES VISUELLES DISPONIBLES          ║\n` +
              `╚═══════════════════════════════════════════════════════════╝\n` +
              `Catégories disponibles : ${vibeCategoryNames.join(", ")}\n\n` +
              `Quand tu émets [IMAGE_IS_DESIGN_REF] pour activer le Design Agent, tu DOIS aussi\n` +
              `préciser quelles images tu veux en ajoutant ce XML sur une ligne seule :\n` +
              `<request_vibes category="Background" count="3"/>\n` +
              `Tu peux émettre plusieurs <request_vibes> pour des catégories différentes.\n` +
              `Si tu n'émets pas de <request_vibes>, toutes les catégories seront envoyées (2 par catégorie).\n`;
          }

          // Inject design anchor (new or restored) — contient déjà le HTML via buildDesignAnchor
          if (activeDesignAnchor) {
            systemPrompt += "\n\n" + activeDesignAnchor;
          }

          // Inject design.md TOUJOURS si présent
          const designMd = currentProjectFiles.find((f) => f.path === "design.md");
          if (designMd) {
            systemPrompt +=
              `\n\n╔══════════════════════════════════════════════════╗\n` +
              `║  DESIGN MEMORY — TOKENS OBLIGATOIRES DE CE PROJET  ║\n` +
              `╚══════════════════════════════════════════════════╝\n` +
              `${designMd.content}\n` +
              `⚠️ Ces couleurs/polices/espacements sont OBLIGATOIRES. Respecte-les exactement.\n`;
          }

          // Inject raw HTML/CSS du design anchor (fichier brut) si présent
          // Note : le fichier contient maintenant le HTML brut (pas le formaté buildDesignAnchor)
          // ce qui permet à l'agent de lire DIRECTEMENT les variables :root{} sans double-couche.
          const designAnchorFile = currentProjectFiles.find((f) => f.path === DESIGN_ANCHOR_FILE);
          if (designAnchorFile && designAnchorFile.content.length > 100) {
            const rawHtml = designAnchorFile.content;
            // Si l'activeDesignAnchor vient du fichier rechargé, il est déjà injecté ci-dessus.
            // On ajoute ici une injection directe du HTML brut pour que l'agent le voie littéralement.
            if (!activeDesignAnchor) {
              // Session sans design agent : injecter depuis le fichier sauvegardé
              systemPrompt += "\n\n" + buildDesignAnchor(rawHtml);
            }
            // Dans tous les cas, injecter le HTML brut en clair pour extraction directe des variables
            systemPrompt +=
              `\n\n╔══════════════════════════════════════════════════════════════════╗\n` +
              `║  HTML/CSS BRUT DU DESIGN AGENT — COPIE EXACTE DES VARIABLES     ║\n` +
              `╚══════════════════════════════════════════════════════════════════╝\n` +
              `INSTRUCTION CRITIQUE : Extrait les variables CSS de ce :root{} et utilise-les\n` +
              `TELLES QUELLES dans tous tes composants React/Tailwind bg-[#hex] text-[#hex].\n` +
              `NE PAS substituer par bg-gray-*, text-blue-* ou toute autre classe générique.\n\n` +
              `${rawHtml.slice(0, 20000)}\n`; // 20k chars pour ne pas tronquer le :root{}
          }

          // Inject existing project files with line numbers (for edit_file precision)
          if (currentProjectFiles.length > 0) {
            const addLineNums = (c: string) =>
              c.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
            const fileList = currentProjectFiles
              .map((f) => `\n=== ${f.path} ===\n${addLineNums(f.content)}`)
              .join("\n\n");
            systemPrompt += `\n\nEXISTING PROJECT FILES (line numbers for edit_file):\n${fileList.slice(0, 80000)}`;
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 1 — MAIN SINGLE AGENT (direct stream to client)
          // c'est lui qui code, décide, discute — UN SEUL APPEL IA
          // ═════════════════════════════════════════════════════════════════
          let fullOutput = "";

          if (!isAnthropic) {
            // ── GEMINI streaming ──────────────────────────────────────────
            const response = await ai.models.generateContentStream({
              model: MODEL_ID,
              contents: buildGeminiHistory(true),
              config: {
                systemInstruction: systemPrompt,
                temperature: 0.7,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8000 },
              },
            });
            for await (const chunk of response) {
              const parts = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if ((part as any).thought || !part.text) continue;
                emit(part.text);
                fullOutput += part.text;
              }
            }
          } else {
            // ── ANTHROPIC streaming ───────────────────────────────────────
            const response = await anthropic!.messages.stream({
              model: MODEL_ID,
              max_tokens: 16000,
              system: systemPrompt,
              messages: buildAnthropicHistory(true),
            });
            for await (const chunk of response) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                emit(chunk.delta.text);
                fullOutput += chunk.delta.text;
              }
            }
          }

          // ═════════════════════════════════════════════════════════════════
          // PHASE 2 — POST-PIPELINE (programmatic — no additional AI call)
          // ═════════════════════════════════════════════════════════════════
          const newFiles = parseGeneratedFiles(fullOutput);

          // ── 2a. Resolve edit_file ops (apply to existing files, re-emit as create_file) ──
          const editOps = parseEditFileOps(fullOutput);
          if (editOps.length > 0) {
            // Build working copy of existing project files
            const workingFiles: { path: string; content: string }[] = currentProjectFiles.map(
              (f) => ({ path: f.path, content: f.content })
            );
            // Merge new create_file outputs
            for (const f of newFiles) {
              const idx = workingFiles.findIndex((g) => g.path === f.path);
              if (idx >= 0) workingFiles[idx] = f; else workingFiles.push(f);
            }
            const edResult = applyEditFileOpsToFiles(workingFiles, editOps);
            if (edResult.applied > 0) {
              emit(`\n\n[EDIT_FILE] ✅ ${edResult.applied} opération(s) edit_file appliquée(s)\n`);
              // Re-emit modified files as create_file so client receives updated content
              const modifiedPaths = new Set(editOps.map((op) => op.path));
              for (const f of workingFiles) {
                if (modifiedPaths.has(f.path)) {
                  emit(`\n---\n<create_file path="${f.path}">\n${f.content}\n</create_file>`);
                }
              }
            }
            if (edResult.failed.length > 0) {
              emit(`\n[EDIT_FILE] ⚠️ ${edResult.failed.length} opération(s) échouée(s): ${edResult.failed.map((f) => `${f.path}(${f.reason})`).join(", ")}\n`);
            }
          }

          // ── 2b. TSC Static Check ──────────────────────────────────────────
          if (newFiles.length > 0) {
            const { issues, severity } = tscStaticCheck(newFiles);
            if (issues.length > 0) {
              emit("\n\n[TSC_CHECK]\n");
              for (const issue of issues) emit(`${issue}\n`);
              if (severity === "critical") {
                const critCount = issues.filter((i) => i.startsWith("CRITICAL")).length;
                emit(`[TSC_STATUS] ${critCount} erreur(s) critique(s) — corrige avant npm run dev\n`);
              } else {
                emit(`[TSC_STATUS] ${issues.length} avertissement(s) — build probable mais à vérifier\n`);
              }
              emit("[/TSC_CHECK]\n");
            }
          }

          // ── 2c. Package.json ──────────────────────────────────────────────
          if (newFiles.length > 0) {
            try {
              const pkgResult = await buildPackageJson(fullOutput, newFiles, currentProjectFiles);
              if (pkgResult) {
                emit(`\n\n<create_file path="${pkgResult.path}">\n${pkgResult.content}\n</create_file>`);
              }
            } catch (pkgErr: any) {
              emit(`\n[PKG_ERROR] ${pkgErr.message}`);
            }
          }

          emit("\n[PAGE_DONE]\n");
        } catch (err: any) {
          console.error("Route error:", err);
          emit(`\n[ERROR] ${err.message}\n[PAGE_DONE]\n`);
        }

        controller.close();
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
    return NextResponse.json({ error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
