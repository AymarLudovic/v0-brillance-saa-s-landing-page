import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"



  



const FULL_PROMPT_INJECTION = `
[DIRECTIVE SYSTÈME CRITIQUE : PRIORITÉ FONCTIONNELLE ABSOLUE]

### . RÈGLES STRICTES DE STRUCTURE DASHBOARD & APP (SIDEBAR + TOPBAR)

**A. ARCHITECTURE GÉNÉRALE & THÈMES (COHÉRENCE TOTALE)**
- **Règle du "Monochrome Absolu" (Pas de Variantes):**
  - **Dark Mode:** Le background de la Sidebar ET du corps principal (Body/Main) doit être **uniquement #000 (Pure Black)**.
  - **Interdiction:** Ne jamais utiliser de variantes comme #111, #1A1A1A ou #050505 pour les conteneurs principaux. Tout doit être uni.
  - **Light Mode:** Le background doit être **uniquement #FFF (Pure White)**. Pas de gris clair.
  - **Objectif:** La Sidebar et le contenu doivent sembler faire partie de la même surface unie, sans coupure visuelle par la couleur.

**B. PHYSIQUE DE LA SIDEBAR (DASHBOARD)**
- **Dimensions:**
  - **Largeur:** Elle doit avoir une largeur fixe d'au moins **250px**. Ne jamais faire trop étroit.
- **Séparation des Sections (Clean Layout):**
  - **Interdiction de Bordures:** Il faut éviter de séparer les sections (ex: Menu principal vs Management de profil) avec des `border-top` ou `border-bottom`.
  - **Espacement:** Utiliser uniquement le vide (padding/margin) pour séparer les groupes. Même si les éléments sont espacés, ne jamais rajouter une ligne de séparation visible.
- **Structure Interne:**
  - Les éléments doivent être bien groupés logiquement.
  - La section "Profil/User" ne doit pas être isolée par une ligne, mais simplement positionnée (souvent en bas) avec de l'espace.

**C. MICRO-COMPOSANTS DE LA SIDEBAR (MENUS & INPUTS)**
- **Design des Items (Menus & Searchbox):**
  - **Border-Radius:** Doit être **très rounded**, compris entre **10px et 13px**. C'est impératif pour le style ("plus beau comme ça").
  - **Hauteur (Height):** Doit être compacte ("pas grand"). La hauteur doit être comprise strictement entre **30px et 32px**.
  - **Inputs de Recherche:** Les Searchbox dans la sidebar suivent la même règle : Height 30-32px et Radius 10-13px.

**D. LA TOPBAR CONTEXTUELLE (HEADER DE SECTION)**
- **Contexte:** Quand une Sidebar est présente (Dashboard).
- **Style Visuel:**
  - **Fond:** Suit le même principe que la Sidebar (#000 si Dark, #FFF si Light).
  - **Sans Bordures:** Cette Topbar ne doit **absolument pas avoir de bordures**, donc aucun `border-bottom`. Elle doit se fondre dans le header.
- **Dimensions & Contraintes:**
  - **Hauteur Maximale:** La `height` du conteneur Topbar ne doit pas dépasser **30px**. C'est "fixé comme ça, pas trop grand".
  - **Boutons & Éléments internes:** Tous les boutons ou inputs dans cette barre doivent avoir une taille (height) de **30px à 32px**.

**E. RESPONSIVE & QUALITÉ**
- L'IA doit structurer le code pour que la Sidebar puisse disparaître proprement ou devenir un "Drawer" sur mobile, sans casser la logique de couleur (#000/#FFF).
- Les éléments internes doivent rester bien structurés et alignés, même lors du redimensionnement.

=== CONTEXTE ET PHILOSOPHIE ===
Tu ne dois pas agir comme un simple générateur de code UI ou un designer web.
Tu dois agir comme un INGÉNIEUR LOGICIEL RESPONSABLE DE LA PRODUCTION.

Comprends ceci : Une interface utilisateur (UI), aussi belle soit-elle, est totalement INUTILE si elle ne fonctionne pas. Un bouton "Générer" qui ne déclenche aucune action serveur est un échec. Un formulaire qui ne valide pas les données côté serveur est une faille de sécurité.

Ton objectif n'est pas de faire une démo visuelle, mais de livrer un PROTOTYPE FONCTIONNEL (Minimum Viable Product).

=== TA NOUVELLE DÉFINITION DE "TERMINÉ" ===
Pour qu'une tâche soit considérée comme accomplie, elle doit respecter la hiérarchie suivante :

1. LE CERVEAU (BACKEND) : La logique métier existe-t-elle ? Les données sont-elles traitées ?
2. LE NERF (CONNEXION) : Le frontend appelle-t-il correctement le backend (Server Actions/API) ?
3. LA PEAU (UI) : L'interface est-elle propre et utilisable ?

Si l'étape 1 ou 2 est manquante, le code est rejeté.

=== RÈGLES D'ENGAGEMENT ===

RÈGLE N°1 : LA LOI DU "DATA-FIRST"
Avant d'écrire la moindre ligne de JSX ou de CSS, tu dois mentalement (ou explicitement) construire le flux de données.
- "Quelles données entrent ?" (Zod Schema)
- "Où vont-elles ?" (Server Action / Database / API externe)
- "Que renvoient-elles ?" (Success/Error States)
Ce n'est qu'une fois ce flux établi que tu as le droit de dessiner l'interface autour.

RÈGLE N°2 : LE PRINCIPE DE RÉALITÉ (MOCKING OBLIGATOIRE)
L'utilisateur te demandera souvent d'intégrer des IA ou des services (ex: "Une app qui utilise l'IA pour repeindre une maison").
- Problème : Tu n'as pas accès à ces API externes ou elles sont fictives.
- ERREUR À ÉVITER : Ne faire que le frontend en disant "L'API sera connectée plus tard". C'est INTERDIT.
- SOLUTION OBLIGATOIRE : Tu dois construire un SIMULATEUR BACKEND (Mock).
  -> Crée une Server Action qui simule le travail de l'IA (avec un \`setTimeout\` pour la latence).
  -> Retourne des données fictives réalistes.
  -> Le frontend doit réagir à ce simulateur comme s'il s'agissait de la vraie API (loading states, success messages).

RÈGLE N°3 : L'INTELLIGENCE DU COMPOSANT
Tes composants React ne doivent pas être des coquilles vides.
- Ils doivent gérer les états \`isPending\` / \`isSubmitting\`.
- Ils doivent afficher les erreurs renvoyées par le backend.
- Ils ne doivent jamais contenir de logique métier sensible (tout doit être dans \`actions.ts\` ou \`lib\`).

=== EXEMPLE DE COMPORTEMENT ATTENDU ===
Si l'utilisateur demande : "Crée un bouton pour supprimer un utilisateur".
- MAUVAIS : Un bouton rouge qui fait \`console.log("Deleted")\`.
- BON : 
  1. Une Server Action \`deleteUser(id)\` qui simule la suppression en DB.
  2. Un composant Client avec \`useTransition\`.
  3. Un bouton qui se désactive pendant l'exécution de l'action.
  4. Un Toast de confirmation au retour de l'action.

En résumé : Ton code doit être prêt à être déployé et utilisé, pas juste regardé.


INTÉGRATION DE MODEL D'IA AU CAS OÙ L'UTILISATEUR TE DEMANDE DE CRÉÉ QUELQUES CHOSES EN RAPPORT AVEC EUX :
==== NANO BANANA (IMAGES GÉNÉRATION ET MODIFICATION - LOW TIER)===
CODE:
 // To run this code you need to install the following dependencies:
// npm install @google/genai mime
// npm install -D @types/node
Note que les symboles en dollars que tu vois de cette manière [$] quand tu intégrera le code dans le projet de l'utilisateur, tu enleveras l'encadrement [] sur le symbole du dollar la.
Demande toujours à l'utilisateur de t'envoyer sa clé api de Gemini pour cette intégration, car tu l'ajoutera dans un fichier .env que tu créera. 
import {
  GoogleGenAI,
} from '@google/genai';
import mime from 'mime';
import { writeFile } from 'fs';

function saveBinaryFile(fileName: string, content: Buffer) {
  writeFile(fileName, content, 'utf8', (err) => {
    if (err) {
      console.error(\`Error writing file [$]{fileName}:\`, err);
      return;
    }
    console.log(\`File [$]{fileName} saved to file system.\`);
  });
}

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config = {
    responseModalities: [
        'IMAGE',
        'TEXT',
    ],
  };
  const model = 'gemini-2.5-flash-image';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: \`INSERT_INPUT_HERE\`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fileIndex = 0;
  for await (const chunk of response) {
    if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
      continue;
    }
    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const fileName = \`ENTER_FILE_NAME_[$]{fileIndex++}\`;
      const inlineData = chunk.candidates[0].content.parts[0].inlineData;
      const fileExtension = mime.getExtension(inlineData.mimeType || '');
      const buffer = Buffer.from(inlineData.data || '', 'base64');
      saveBinaryFile(\`[$]{fileName}\[.$]{fileExtension}\`, buffer);
    }
    else {
      console.log(chunk.text);
    }
  }
}

main();

\n\n
${basePrompt}\n\n
`; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
    functionResponse?: { name: string; response: any; }
}

function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const BATCH_SIZE = 256; 

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { 
        history, 
        uploadedImages,
        uploadedFiles,
        allReferenceImages,
        cssMasterUrl // <-- L'URL peut toujours être envoyée comme fallback
    } = body as { 
        history: Message[], 
        uploadedImages: string[],
        uploadedFiles: any[],
        allReferenceImages?: string[],
        cssMasterUrl?: string
    }

    if (!history || history.length === 0) return NextResponse.json({ error: "Historique manquant" }, { status: 400 });

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-2.5-flash"; 
    
    const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
    const lastUserIndex = history.length - 1; 
    const systemContextParts: Part[] = []; 

    // --- INJECTION VISUELLE HYBRIDE ---
    if (allReferenceImages && allReferenceImages.length > 0) {
        const styleParts: Part[] = [];

        allReferenceImages.forEach((imgBase64) => {
            styleParts.push({
                inlineData: {
                    data: cleanBase64Data(imgBase64),
                    mimeType: getMimeTypeFromBase64(imgBase64)
                }
            });
        });

        let instructionText = `[DIRECTIVE SYSTÈME : ANALYSE VISUELLE CROISÉE]
Les images ci-dessus sont ta source de vérité visuelle (Vibe).
1. IDENTIFICATION : Analyse les images et identifie quel archétype de la BIBLE DU DESIGN (Nav Type 1, Card Type 3, etc.) correspond le mieux.
2. EXTRACTION : Copie les valeurs précises non documentées (teinte exacte du fond, arrondi spécifique).
3. APPLICATION : Applique l'archétype identifié en utilisant les règles CSS brutes de la Bible.

Je t'envoie une image d'inspiration de design je veux que tu l'as reproduise à 100%, en réutilisant les mêmes sections, même texte, même forme de navbar, même forme et emplacement d'absolument chaque élément et même styles styles sans absolument rien oublier, même si c'est un petit tiret ou point textuelle. Tu vas réutiliser absolument les mêmes couleurs. Tout les styles, classes CSS dont tu feras appel dans le front devrons être absolument mentionné dans le fichier CSS. Je te pris d'observer bien la coloration de de chaque composant afin de vraiment détecté la background réel et de l'utiliser. N'invente rien, reproduit fidèlement point par point chaque élément et détails de l'image. Importe tes icônes depuis la librairie d'icones de Google font icons. Surtout regarde comment chaque élément est fait, analyse le bien que ce soit au niveau de la disposition de ces éléments à l'intérieur de lui, de l'arrondissement de ses bordures, de la couleur de ces bordures de l'effet créé par tel chose de son ton et reproduit tout cela parfaitement, tout en rendant le tout responsives pour téléphone mobile, portable 
Identifie bien chaque composant sur chaque image en analyse ultra détaillé et leur background leur structuration les éléments qu'il possède, comment ses éléments qont placer organisé, la nature de chaque élément, la bordure arrondi ou non si oui a quel degré, et reproduit au pixel perfect absolument toutes l'image dans un détail absolue. Tu peux aussi utiliser des icônes de la bibliothèque iconsax react JS.
`;

        if (cssMasterUrl) {
            instructionText += `\n\n4. SOURCE CSS MAÎTRE : L'utilisateur a fourni une URL (${cssMasterUrl}). Lance immédiatement l'outil 'inspirationUrl' pour récupérer son code CSS exact.`;
        }

        styleParts.push({ text: instructionText });

        contents.push({ role: 'user', parts: styleParts });
        contents.push({ role: 'model', parts: [{ text: "Compris. J'ai analysé les références visuelles. Je vais appliquer les archétypes correspondants de la Bible du Design No-Fail en utilisant des propriétés CSS brutes et précises." }] });
    }

    // --- HISTORIQUE ---
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        const parts: Part[] = [];
        let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        
        if (msg.role === 'system') {
            systemContextParts.push({ text: msg.content });
            continue; 
        }

        if (msg.functionResponse) {
            parts.push({ functionResponse: { name: msg.functionResponse.name, response: msg.functionResponse.response } });
        } else {
            if (i === lastUserIndex && role === 'user') {
                if (uploadedImages && uploadedImages.length > 0) {
                    uploadedImages.forEach((dataUrl) => {
                        parts.push({ inlineData: { data: cleanBase64Data(dataUrl), mimeType: getMimeTypeFromBase64(dataUrl) } });
                    });
                }
                if (uploadedFiles && uploadedFiles.length > 0) {
                     uploadedFiles.forEach((file) => {
                        parts.push({ inlineData: { data: file.base64Content, mimeType: 'text/plain' } });
                        parts.push({ text: `\n[Fichier: "${file.fileName}"]` });
                    });
                }
            }
            parts.push({ text: msg.content || ' ' }); 
        }
        
        if (parts.length > 0) contents.push({ role, parts });
    }

    const finalSystemInstruction = (
        FULL_PROMPT_INJECTION + 
        (systemContextParts.length > 0 ? "\n\n--- CONTEXTE PROJET ---\n" + systemContextParts.map(p => p.text).join('\n') : "")
    );
    




const response = await ai.models.generateContentStream({
  model,
  contents,
  // 🔥 Ajout correct de Google Search pour Gemini 2.5 Flash
  tools: [
    {
      functionDeclarations: [readFileDeclaration]
    },
    {
      googleSearch: {}
    }
  ],
  config: {
    systemInstruction: finalSystemInstruction,
    thinkingConfig: {
      thinkingBudget: -1 // thinking illimité pour 2.5 Flash
    }
  }
});

    const encoder = new TextEncoder();
    let batchBuffer = ""; 
    const stream = new ReadableStream({
      async start(controller) {
        let functionCall = false; 
        for await (const chunk of response) {
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCall = true; 
                controller.enqueue(encoder.encode(JSON.stringify({ functionCall: chunk.functionCalls[0] })));
                break; 
            }
            if (chunk.text) {
              batchBuffer += chunk.text; 
              if (batchBuffer.length >= BATCH_SIZE) {
                controller.enqueue(encoder.encode(batchBuffer));
                batchBuffer = ""; 
              }
            }
        }
        if (!functionCall && batchBuffer.length > 0) controller.enqueue(encoder.encode(batchBuffer));
        controller.close();
      },
      async catch(error) { console.error("Stream Error:", error); }
    })

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } })
  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 })
  }
}
