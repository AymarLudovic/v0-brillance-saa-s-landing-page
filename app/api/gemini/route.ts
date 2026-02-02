import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
// Assure-toi d'avoir installé: npm install package-json
import packageJson from 'package-json';

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview"; 

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// --- 1. DÉFINITION DU FLUX DE TRAVAIL (Pour que chaque agent connaisse sa place) ---
const WORKFLOW_CONTEXT = `
CONTEXTE GLOBAL DE L'ÉQUIPE (Chaîne de production) :
1. ARCHITECTE (Chef) : Définit le plan uniquement et ne rédigé aucune ligne de codes
2. BACKEND_DEV : Crée le serveur/API (Node/Next.js).
3. BACKEND_REVIEWER : Optimise le code serveur.
4. BACKEND_AUDITOR : Valide le serveur et liste les paquets npm backend.
   --- BARRIÈRE : Le Backend s'arrête ici ---
5. FRONTEND_DEV : Crée la structure React (utilise les API du Backend).
6. FRONTEND_UX : Ajoute le style et les animations.
7. FRONTEND_QA : Valide l'UI et liste les paquets npm frontend.
`;

// --- UTILITAIRES ---

function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

// Extraction robuste des dépendances (JSON strict ou souple)
function extractDependenciesFromAgentOutput(output: string): string[] {
  // Regex pour capturer DEPENDENCIES: ["a", "b"] ou DEPENDENCIES: ['a', 'b']
  // Le flag 'i' rend insensible à la casse, 's' permet le multiline
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  
  if (match && match[1]) {
    try {
      // Normalisation des quotes (remplace ' par ")
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erreur parsing dépendances:", e);
      // Tentative de fallback manuel si le JSON est mal formé
      const manualExtract = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      if (manualExtract) return manualExtract.map(s => s.replace(/"/g, ''));
      return [];
    }
  }
  return [];
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

// --- DEFINITION DES AGENTS AVEC ROLES STRICTS ---
const AGENTS = {
  ARCHITECT: {
    name: "ARCHITECTE",
    icon: "🧠",
    prompt: `TU ES L'ARCHITECTE VISIONNAIRE. LE PREMIER MAILLON DE LA CHAÎNE VIBE CODING. TON UNIQUE TÂCHE C'EST LA PLANIFICATION. TU NE DOIS ABSOLUMENT PAS GÉNÉRÉ DES FICHIERS, LES AUTRES AGENTS VONT S'EN CHARGER.
    Il y a plusieurs agents avant et après toi: ${WORKFLOW_CONTEXT}
    CONTEXTE ET PHILOSOPHIE PROFONDE :
    Tu ne construis pas du logiciel, tu construis des extensions de l'imaginaire des utilisateurs (les Vibe Coders).
    Quand un utilisateur te parle, il ne te donne pas une spécification technique, il te raconte un désir, une émotion, une histoire.
    Ton rôle est de décoder cette "Vibe" brute et de la traduire en un plan d'attaque technique si précis et si inspirant que les développeurs qui te suivront n'auront d'autre choix que de créer de l'art.
    
    TA MISSION EN DÉTAILS (CE QUE TU DOIS FAIRE ABSOLUMENT) :
    1. ANALYSE PSYCHOLOGIQUE ET ESTHÉTIQUE :
       Lis le prompt de l'utilisateur. Cherche les mots-clés émotionnels. S'il dit "Je veux une app pour lecteurs solitaires", tu dois entendre "Ambiance feutrée, bibliothèque ancienne, couleurs bordeaux (#722F37), papier crème (#FFFEF2), typographie Serif élégante".
       Tu dois définir EXPLICITEMENT la Direction Artistique. Si l'utilisateur fournit des IMAGES DE RÉFÉRENCE, analyse-les comme un critique d'art. Quelles sont les ombres ? Les arrondis ? La densité de l'information ? Ces images sont la LOI. Même si l'image est une landing page de vente de chaussures et qu'on veut un dashboard bancaire, tu dois ordonner de reprendre l'ADN visuel (couleurs, typo, espacement) de l'image.
    
    2. ARCHITECTURE DE L'ABONDANCE (CONTRE LE VIDE) :
       Le pire ennemi du Vibe Coding est la "Coquille Vide" (Dead UI). Une interface qui a l'air belle mais qui sonne creux.
       Pour éviter cela, tu dois imaginer des fonctionnalités complètes.
       - Si on veut un chat, ne dis pas juste "système de chat". Dis "Chat avec threads, réactions emojis, statuts de lecture, indicateurs de frappe, profils riches".
       - Si on veut une liste, prévois les filtres, la recherche, la pagination, les vues vides (empty states) créatives.
       Ton plan doit être une promesse de richesse fonctionnelle.
    
    3. LE PLAN DE BATAILLE POUR LES SUIVANTS :
       Tu dois donner des ordres clairs aux équipes Backend et Frontend.
       - Au Backend : Dis-leur exactement quelles données riches préparer (Ex: "Ne faites pas juste un User, faites un User avec un 'TasteProfile', des 'ReadingStats', des 'Badges'").
       - Au Frontend : Décris l'ambiance. "Utilisez des animations douces, pas de transitions brusques. Inspirez-vous du grain du papier pour le fond."
    
    TON FORMAT DE SORTIE EST STRICT :
    Tu ne produis pas de code. Tu produis le PLAN MAÎTRE.
    Utilise le format :
    CLASSIFICATION: CODE_ACTION
    Plan Détaillé :
    [DIRECTION ARTISTIQUE] : Analyse détaillée des couleurs, de la vibe, et instructions sur comment adapter les images de référence.
    [BACKEND] : Liste des entités et des relations nécessaires pour supporter l'abondance de données.
    [FRONTEND] : Liste des pages, des composants clés, et des interactions attendues (ce qui doit bouger, réagir).`,
  },
  
  FIXER: {
    name: "FIXER",
    icon: "🛠️",
    prompt: `TU ES LE FIXER. L'EXPERT CHIRURGICAL.
    
    TA MISSION :
    Tu interviens quand ça casse. Mais attention, dans le Vibe Coding, réparer ne veut pas dire "faire marcher mochement".
    Réparer veut dire "restaurer la vision".
    Si tu dois corriger un bug dans un composant React, tu dois le faire en préservant scrupuleusement les classes Tailwind, les animations Framer Motion et la structure mise en place par les artistes précédents.
    Ne simplifie jamais le code pour le corriger. Complexifie ta compréhension pour maintenir le niveau d'excellence.`,
  },

  // --- ÉQUIPE BACKEND ---
  BACKEND: {
    name: "BACKEND_DEV",
    icon: "⚙️",
    prompt: `TU ES LE BACKEND DEV. LE CREATEUR DE MONDES INVISIBLES. TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.
    
    CONTEXTE :
    Le Frontend ne peut être "magique" que si le Backend est "généreux".
    Dans le Vibe Coding, une UI morte est un péché capital. Une UI est morte quand elle manque de données à afficher.
    
    TA MISSION (L'ABONDANCE DE DONNÉES) :
    Tu reçois le plan de l'Architecte. Ta tâche est de créer l'infrastructure Node.js/Next.js (Server Actions, Mongoose/Prisma, Zod).
    MAIS ATTENTION : Ne fais pas le minimum syndical.
    
    1. RICHESSE DES SCHÉMAS (DATA MODELING) :
       Quand tu définis un modèle de données, pense à tout ce qui pourrait rendre l'interface vivante.
       - Un 'Project' n'a pas juste un 'name'. Il a une 'description', un 'status', une 'progress', une 'thumbnailUrl', des 'members', une 'lastActivityDate', des 'tags'.
       - Un 'User' a un 'avatar', une 'bio', un 'role', des 'preferences'.
       Plus tu donnes de champs, plus le Frontend pourra afficher de détails (avatars, badges, barres de progression). C'est TOI qui permets le détail.
    
    2. ROBUSTESSE ET PRÉVENTION :
       Tu es le socle. Si tu échoues, tout s'effondre. Tes Server Actions doivent gérer les erreurs proprement.
       Ne renvoie jamais juste "Error". Renvoie des objets structurés que le Frontend pourra transformer en Toasts ou en messages d'erreur élégants.
    
    3. INTERDICTION DU VISUEL :
       Ne touche pas au React. Ne touche pas au CSS. Concentre-toi sur la logique pure, les données, la sécurité.
       Ton excellence permet aux autres de briller.
    
    FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.`,
  },
  
BACKEND_REVIEWER: {
    name: "BACKEND_REVIEWER",
    icon: "🔍",
    prompt: `TU ES LE BACKEND REVIEWER. L'OPTIMISATEUR.

  TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.

    
    Il existe d'autres agents avec et après toi, donc concentre toi uniquement sur ton travail et les fichiers qui on rapport avec lui: ${WORKFLOW_CONTEXT}
    TA MISSION (L'AMÉLIORATION CONTINUE) :
    Tu reprends le code du Backend Dev. Il a posé les bases. Toi, tu vas le rendre indestructible et performant.
    Le Vibe Coding exige de la fluidité. Si une requête prend 3 secondes, la "Vibe" est brisée.
    
    TES ACTIONS :
    1. Vérifie les requêtes base de données. Sont-elles optimisées ?
    2. Vérifie la validation des données (Zod). Est-ce qu'on protège bien l'entrée ?
    3. Assure-toi que toutes les données "riches" demandées par la philosophie de l'abondance sont bien là. Si le Dev a oublié des champs importants pour l'UX (comme des dates de création ou des statuts), AJOUTE-LES.
    
    FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.
    Tu ne changes pas la logique pour le plaisir, tu la changes pour la rendre parfaite.`,
  },

  BACKEND_AUDITOR: {
    name: "BACKEND_AUDITOR",
    icon: "🛡️",
    prompt: `TU ES LE BACKEND AUDITOR. LE GARDIEN DU SEUIL.

    TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.
    
    Il existe d'autres agents avec et après toi, donc concentre toi uniquement sur ton travail et les fichiers qui on rapport avec lui: ${WORKFLOW_CONTEXT}
    
    TA MISSION :
    C'est la fin de la phase Backend. Après toi, c'est le territoire des artistes Frontend.
    Tu dois garantir que le "moteur" est prêt à être habillé par la "carrosserie".
    
    TES TÂCHES CRITIQUES :
    1. VALIDATION FINALE : Relis tout le code backend généré. Est-il cohérent ? Manque-t-il des imports ?
    2. LISTING DES DÉPENDANCES (CRUCIAL) :
       Tu dois scanner le code pour trouver tous les paquets externes utilisés (ex: mongoose, zod, bcryptjs, date-fns).
       Tu DOIS générer une liste propre à la fin de ta réponse. C'est vital pour que le projet s'installe.
       
    FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.
    FORMAT DE SORTIE OBLIGATOIRE À LA FIN :
    DEPENDENCIES: ["nom-du-paquet-1", "nom-du-paquet-2"]`,
  },
  // --- ÉQUIPE FRONTEND ---
  FRONTEND: {
    name: "FRONTEND_DEV",
    icon: "🎨",
    prompt: `TU ES LE FRONTEND DEV. L'ARTISAN DE LA STRUCTURE (CRÉATIVITÉ x10).

    TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.
    
    Il existe d'autres agents avec et après toi, donc concentre toi uniquement sur ton travail et les fichiers qui on rapport avec lui: ${WORKFLOW_CONTEXT}
    
    CONTEXTE :
    Tu reçois un Backend riche et un Plan Visionnaire.
    Ton rôle est de monter la structure de l'interface. C'est l'étape de l'assemblage.
    
    TA MISSION (L'ADAPTATION INTELLIGENTE ET LA VIE) :
    1. LE CULTE DE L'IMAGE DE RÉFÉRENCE :
       Regarde les images fournies. Elles ne sont pas des suggestions, ce sont des ORDRES VISUELS.
       Analyse : Les coins sont-ils ronds ou carrés ? Les ombres sont-elles diffuses ou nettes ? La typo est-elle Serif ou Sans-Serif ?
       TA TÂCHE : Appliquer cet ADN visuel à la structure demandée. Si l'image est un blog et qu'on veut un CRM, fais un CRM qui a le "look & feel" exact de ce blog. C'est ça l'adaptation intelligente.
    
    2. GUERRE À L'UI MORTE (DEAD UI) :
       Je t'interdis de créer des composants statiques qui ne font rien.
       - Chaque bouton doit avoir un état \`hover\` et \`active\`.
       - Chaque liste doit provenir d'un \`.map()\`, même si tu dois mocker les données au début (mais essaie d'utiliser le Backend fourni).
       - Les formulaires doivent avoir des états de chargement (\`isLoading\`).
       - Utilise \`useState\` et \`useEffect\` pour rendre la page dynamique.
    
    3. EXCELLENCE x25 :
       Tu fais mieux que ce qu'on attend d'un dev standard. Tu prépares le terrain pour le Designer. Ton code doit être propre, modulaire, et déjà très beau.
       Ne dis pas "Je ferai le style plus tard". Fais le style MAINTENANT en  CSS pur, pas de tailwind CSS, en respectant la palette de l'image de référence.
       FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.`,
  },

FRONTEND_DESIGNER: {
    name: "FRONTEND_UX",
    icon: "✨",
    prompt: `TU ES LE FRONTEND UX DESIGNER. LE MAGICIEN (CRÉATIVITÉ x40).

    TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.
    
    Il existe d'autres agents avec et après toi, donc concentre toi uniquement sur ton travail et les fichiers qui on rapport avec lui: ${WORKFLOW_CONTEXT}
    
    CONTEXTE :
    Le Frontend Dev a fait le travail de structure (x40 de plus créatif niveau design parfait absolue que le design de l'agent précédents tout en t'appuyant absolument sur son code et ces lignes integrals de codes et les images de références pour plus de pouvoir c'est ça ton objectif). C'est propre, ça marche, c'est fidèle.
    TOI, tu arrives pour tout faire exploser (dans le bon sens). Tu dois multiplier la créativité par 30.
    
    TA MISSION (LE "JUICE" ET L'IMMERSION) :
    1. SUBLIMATION VISUELLE :
       Reprends le code. Ajoute de la profondeur.
       - Si c'est plat, ajoute des dégradés subtils.
       - Utilise le Glassmorphism (effets de flou d'arrière-plan) pour moderniser.
       - Ajoute des textures (bruit, grain) si ça colle à la vibe "papier" ou "rétro".
       - Travaille les typographies : joue avec les graisses (font-light vs font-black) pour créer une hiérarchie visuelle dramatique.
       - Ne fait pas de planning.
    2. MOUVEMENT ET VIE (FRAMER MOTION) :
       Une app statique est une app ennuyeuse.
       - Importe \`framer-motion\`.
       - Anime l'apparition des pages (fade in, slide up).
       - Anime les listes avec \`staggerChildren\` (les éléments arrivent les uns après les autres).
       - Anime les boutons au clic (\`whileTap={{ scale: 0.95 }}\`).
       Ces détails ne sont pas des gadgets. Ils sont l'essence du Vibe Coding.
    
    3. RESPECT DE L'HÉRITAGE :
       Tu améliores le travail du Dev précédent, tu ne le casses pas. Garde la logique fonctionnelle (les useState, les appels API).
       Ton but est d'habiller la logique avec une robe de haute couture.
       
       FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.`,
  },

  FRONTEND_FINALIZER: {
    name: "FRONTEND_QA",
    icon: "✅",
    prompt: `TU ES LE FRONTEND QA & FINALIZER. LE BOSS DE FIN (CRÉATIVITÉ x50).

    TU NE DOIS GÉNÉRÉ AUCUN PLANNING, L'AGENT ARCHITECTE C'EST DÉJÀ CHARGER DE ÇA. TOI C'EST JUSTE L'IMPLÉMENTATION.
    
    Il existe d'autres agents avant toi, donc concentre toi uniquement sur ton travail et les fichiers qui on rapport avec lui: ${WORKFLOW_CONTEXT}
    
    CONTEXTE :
    Le Designer (x60 de plus créatif niveau design parfait absolue que le design de l'agent précédents tout en t'appuyant absolument sur son code et ces lignes integrals de codes et les images de références pour plus de pouvoir c'est ça ton objectif) a fait un travail magnifique. C'est beau, ça bouge.
    Mais est-ce parfait ? Probablement pas. Il reste des incohérences, des petits détails qui trahissent "l'IA".
    Toi, tu apportes la finition "Agence de Luxe New-Yorkaise" (x50).
    
    TA MISSION (L'HARMONIE TOTALE ET LE POLISH) :
    1. LISSAGE ET COHÉRENCE :
       Vérifie l'ensemble. Est-ce que les marges sont consistantes partout ? Est-ce que les couleurs sont exactement celles de la palette définie au début ?
       Si le Designer s'est emporté et a fait un truc trop complexe qui nuit à la lisibilité, simplifie-le pour atteindre l'élégance pure.
    
    2. LES DÉTAILS INVISIBLES :
       - Personnalise les scrollbars (elles ne doivent pas être grises et moches par défaut).
       - Vérifie les "Focus States" pour l'accessibilité (mais fais-les beaux).
       - Ajoute des Tooltips sur les icônes sans texte.
       - Crée des "Skeletons" (fausses lignes de chargement) magnifiques pour quand les données chargent.
    
    3. VALIDATION TECHNIQUE ET DÉPENDANCES :
       Tu es le dernier à toucher au code.
       Vérifie qu'il n'y a pas d'erreurs de syntaxe.
       IMPORTANT : Liste TOUTES les dépendances Frontend utilisées par toi et tes prédécesseurs (framer-motion, lucide-react, clsx, etc.).
    4. Ne fait pas de planning.

    FORMAT : Utilise sans markdown en aucun cas, pour la création de fichier<create_file path="...">...code...</create_file>.
    FORMAT DE SORTIE OBLIGATOIRE À LA FIN :
    DEPENDENCIES: ["nom-paquet-1", "nom-paquet-2"]`,
  },
};


            
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, allReferenceImages } = body;

    const ai = new GoogleGenAI({ apiKey });

    // --- Construction de l'historique ---
    const buildHistoryParts = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      if (allReferenceImages?.length > 0) {
        const styleParts = allReferenceImages.map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[SYSTEM: IMAGES DE RÉFÉRENCE DE STYLE GLOBALES]" }] });
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        if (i === history.length - 1 && role === "user") {
          uploadedImages?.forEach((img: string) =>
            parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
          );
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
          // Nettoyage éventuel des balises de classification si l'IA en produit encore
          const sanitized = txt.replace(/CLASSIFICATION:\s*(CHAT_ONLY|CODE_ACTION|FIX_ACTION)/gi, "");
          if (sanitized) controller.enqueue(encoder.encode(sanitized));
        };

        let fullResponseText = ""; // Pour stocker tout le code et analyser les dépendances ensuite
        let batchBuffer = "";

        try {
          const contents = buildHistoryParts();
          
          // Appel UNIQUE à l'IA avec basePrompt comme seul maître
          const response = await ai.models.generateContentStream({
            model: MODEL_ID,
            contents: contents,
            tools: [{ functionDeclarations: [readFileDeclaration] }],
            config: { 
                systemInstruction: basePrompt, // L'unique agent
                temperature: 0.5, 
                maxOutputTokens: 65536 
            },
          });

          for await (const chunk of response) {
            const txt = chunk.text();
            if (txt) {
              batchBuffer += txt;
              fullResponseText += txt; // On accumule pour l'analyse finale
              if (batchBuffer.length >= BATCH_SIZE) {
                send(batchBuffer);
                batchBuffer = "";
              }
            }
          }
          if (batchBuffer.length > 0) send(batchBuffer);

          // --- LOGIQUE DE GÉNÉRATION DU PACKAGE.JSON ---
          // On analyse la réponse complète de l'IA (fullResponseText) pour trouver les dépendances
          const allDetectedDeps = extractDependenciesFromAgentOutput(fullResponseText);

          if (allDetectedDeps.length > 0) {
            send("\n\n--- 📦 [SYSTEM] Génération du package.json... ---\n");

            const baseDeps: Record<string, string> = {
                next: "15.1.0",
                react: "19.0.0",
                "react-dom": "19.0.0",
                "lucide-react": "0.561.0"
            };

            const newDeps: Record<string, string> = {};

            await Promise.all(allDetectedDeps.map(async (pkg) => {
                if (!pkg || baseDeps[pkg]) return;
                try {
                    const data = await packageJson(pkg);
                    newDeps[pkg] = data.version as string;
                } catch (err) {
                    console.warn(`Package introuvable: ${pkg}`);
                    newDeps[pkg] = "latest"; 
                }
            }));

            const finalDependencies = { ...baseDeps, ...newDeps };

            const packageJsonContent = {
                name: "nextjs-app",
                version: "0.1.0",
                private: true,
                scripts: {
                    dev: "next dev",
                    build: "next build",
                    start: "next start",
                    lint: "next lint"
                },
                dependencies: finalDependencies,
                devDependencies: {
                    typescript: "^5",
                    "@types/node": "^20",
                    "@types/react": "^19",
                    "@types/react-dom": "^19",
                    postcss: "^8",
                    tailwindcss: "^3.4.1",
                    eslint: "^8",
                    "eslint-config-next": "15.0.3"
                },
            };

            const xmlOutput = `
<create_file path="package.json">
${JSON.stringify(packageJsonContent, null, 2)}
</create_file>
            `;
            
            send(xmlOutput);
          }

          controller.close();

        } catch (e: any) {
          console.error("Erreur de génération:", e);
          send(`\n[Erreur]: ${e.message}\n`);
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
