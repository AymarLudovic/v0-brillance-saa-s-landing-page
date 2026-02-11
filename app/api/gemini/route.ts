import { NextResponse } from "next/server";
import { GoogleGenAI, Type, FunctionDeclaration, Part } from "@google/genai";
import packageJson from 'package-json';
// Assure-toi que basePrompt contient bien tes instructions sur les "Bêtes Noires"
import { basePrompt } from "@/lib/prompt";

const BATCH_SIZE = 128;
const MODEL_ID = "gemini-3-flash-preview"; 

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  externalFiles?: { fileName: string; base64Content: string }[];
  mentionedFiles?: string[];
}

// --- UTILITAIRES ---
function getMimeTypeFromBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
  return match ? match[1] : "application/octet-stream";
}

function cleanBase64Data(dataUrl: string) {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}

function extractDependenciesFromAgentOutput(output: string): string[] {
  const match = output.match(/DEPENDENCIES:\s*(\[[\s\S]*?\])/i);
  if (match && match[1]) {
    try {
      const jsonStr = match[1].replace(/'/g, '"'); 
      return JSON.parse(jsonStr);
    } catch (e) {
      const manualExtract = match[1].match(/"([a-zA-Z0-9-@/.]+)"/g);
      if (manualExtract) return manualExtract.map(s => s.replace(/"/g, ''));
      return [];
    }
  }
  return [];
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lecture fichier.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  },
};

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  let send: (txt: string) => void = () => {};

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const authHeader = req.headers.get("x-gemini-api-key");
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    // Ajout de currentProjectFiles dans la récupération
    const { history, uploadedImages, uploadedFiles, allReferenceImages, currentProjectFiles } = body;

    const ai = new GoogleGenAI({ apiKey });

    // --- LOGIQUE D'EXCLUSION DES IMAGES ---
    // Si l'utilisateur envoie une image ou un fichier, on NE MET PAS les images de référence globale
    const hasUserUploads = (uploadedImages?.length > 0) || (uploadedFiles?.length > 0);

    // Construction de l'historique initial
    const buildInitialHistory = () => {
      const contents: { role: "user" | "model"; parts: Part[] }[] = [];
      
      // On ajoute les références SEULEMENT SI aucun upload utilisateur n'est présent
      if (allReferenceImages?.length > 0 && !hasUserUploads) {
        const styleParts = allReferenceImages.slice(0, 3).map((img: string) => ({
          inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) },
        }));
        contents.push({ role: "user", parts: [...(styleParts as any), { text: "[DOCUMENTS DE RÉFÉRENCE (MAQUETTES/STYLE) - MAX 3]" }] });
      }

      history.forEach((msg: Message, i: number) => {
        if (msg.role === "system") return;
        let role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
        const parts: Part[] = [{ text: msg.content || " " }];
        
        if (i === history.length - 1 && role === "user") {
            // Gestion des images uploadées par l'user (Prioritaire)
            if (uploadedImages?.length > 0) {
                uploadedImages.forEach((img: string) =>
                    parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } })
                );
                parts.push({ text: "\n[FICHIERS UPLOADÉS PAR L'UTILISATEUR]" });
            }
            // Gestion des fichiers texte/code uploadés
            if (uploadedFiles?.length > 0) {
                 uploadedFiles.forEach((file: { fileName: string; base64Content: string }) => {
                    // On décode le base64 pour le donner en texte à l'IA (si c'est du code)
                    // Note: Si ce sont des binaires, il faut adapter, mais pour du code c'est mieux en texte
                    try {
                        const content = atob(file.base64Content);
                        parts.push({ text: `\n[CONTENU DU FICHIER ${file.fileName}]:\n${content}\n` });
                    } catch (e) {
                        // Fallback si ce n'est pas du texte
                        parts.push({ text: `\n[FICHIER BINAIRE ${file.fileName} PRÉSENT]` });
                    }
                 });
            }
        }
        contents.push({ role, parts });
      });
      return contents;
    };

    // Préparation du System Prompt avec le contexte du projet
    let dynamicSystemInstruction = basePrompt;
    if (currentProjectFiles) {
        // On donne à l'IA la structure actuelle pour éviter qu'elle ne réinvente la roue ou écrase aveuglément
        // On peut passer soit la liste des noms, soit un résumé. Ici on passe l'objet JSON stringifié (attention à la taille)
        // Ou juste la liste des chemins si l'objet est trop gros.
        dynamicSystemInstruction += `\n\n[CONTEXTE DU PROJET - FICHIERS EXISTANTS]\nTu travailles sur un projet existant. Voici la structure actuelle :\n${JSON.stringify(currentProjectFiles, null, 2)}\nUtilise ce contexte pour respecter l'architecture existante.`;
    }

    const stream = new ReadableStream({
      async start(controller) {
        send = (txt: string) => {
            if (txt) controller.enqueue(encoder.encode(txt));
        };
        
        try {
          const currentHistory = buildInitialHistory();
          let fullSessionOutput = ""; 
          
          // =================================================================================
          // PHASE UNIQUE : GÉNÉRATION & CORRECTION INTENSIVE (Boucle de 4 tours max)
          // =================================================================================
          let loopCount = 0;
          const MAX_LOOPS = 4;
          let shouldContinue = true;

          while (shouldContinue && loopCount < MAX_LOOPS) {
            
            // Notification visuelle pour l'utilisateur
            if (loopCount > 0) {
                send(`\n\n--- 🚨 ANALYSE ANTI-GHOSTING & FINALISATION (${loopCount}/${MAX_LOOPS - 1}) ---\n`);
                await wait(1000); 
            }

            const response = await ai.models.generateContentStream({
                model: MODEL_ID,
                contents: currentHistory, 
                tools: [{ functionDeclarations: [readFileDeclaration] }], 
                config: { 
                    systemInstruction: dynamicSystemInstruction, 
                    generationConfig: {
                        temperature: 1, // RÉDUIT À 0.8 pour plus de stabilité et moins d'erreurs de syntaxe
                        maxOutputTokens: 8536,
                        thinkingConfig: {
                            includeThoughts: true, 
                            thinkingLevel: "high"
                        }
                    }
                },
            });

            let batchBuffer = "";
            let currentIterationOutput = ""; 

            for await (const chunk of response) {
                const txt = chunk.text; 
                if (txt) {
                    batchBuffer += txt;
                    fullSessionOutput += txt; 
                    currentIterationOutput += txt; 

                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }
            if (batchBuffer.length > 0) send(batchBuffer);

            // --- LOGIQUE CRITIQUE DE BOUCLE ---
            
            if (!currentIterationOutput.includes("[[START]]")) {
                // Si pas de code généré, on arrête la boucle
                shouldContinue = false;
            } 
            else {
                // Code détecté : On lance l'analyse critique
                if (loopCount < MAX_LOOPS - 1) {
                    currentHistory.push({ role: "model", parts: [{ text: currentIterationOutput }] });
                    
                    // --- CORRECTION PROMPT RENFORCÉ ---
                    const correctionPrompt = `⛔ STOP. MODE CRITIQUE : VERIFICATION DE LAZINESS & LOGIQUE.

                    JE LE RAPPELLE ENCORE, ON PARLE DE QUE TU FASSE CECI
                  
                  1. Okay c'est certainement ici la partie la plus importante parmi tous les instructions qui te sont lister ici dans ton prompt instructions, En effet, elle est celle qui te défini réellement et elle repose sur un principe : CRÉÉ L'APPLICATION DEMANDÉ PAR L'UTILISATEUR EN TOUT POINT AU NIVEAU FONCTIONNALITÉS DEMANDÉ.
Oui en effet c'est la partie cruciale de tout qui si tu ne l'as pas fait tu n'as rien fait pour l'utilisateur. C'est créé les fonctionnalités de l'utilisateur, c'est créé son application.

Tout d'abord he ne te parle pas d'ici de monter le UI de l'application ou de corriger les problèmes de ghosting et lazyness, non je te parle ici de codé l'application demandé par l'utilisateur, d'importer les packages nécessaires, les librairies nécessaires, les scripts nécessaires qui permette de faire l'application ou la fonctionnalité demandé par l'utilisateur.
En effet je ne te parle pas d'ici de simuler une fonctionnalité, Non je te parle d'écrire le script réel de la fonctionnalité qui va entrer dans l'application de l'utilisateur. Par exemple, si l'utilisateur te demande: "Génère moi une application de trading forex avec la possibilité de payer chez un courtier en ligne d'acheter véritablement les actions vendus sur le marché du trading et bien d'autres..." , moi et l'utilisateur, on ne s'attend pas à ce que tu fasses des fonctionnalités de simulations ou des fonctionnalités dans le but juste de construire un minimum prlduct viable, non on s'attend à ce que tu vas gérer l'entièreté des scripts qui vont faire réellement que l'on puisse 
consultez les actions vendu, pouvoir véritablement les acheter, les revendre, connecter des portes feuilles crypto et j'en passe. On s'attend à ce que tu vas importer de réelles packages externe qui permette de faire tel tel chose dans un point précis de la fonctionnalité. On s'attend à ce que tu fasses des directory spéciaux qui vont contenir absolument tout les scripts des fonctionnalités (services/ , actions/, ...).

On s'attend à ce que tu fasses une application intégral, non des fonctionnalités légère, on s'attend à ce que tu montes un services réel.  on s'attend à ce que tu créé via des scripts solides les fonctionnalités exactes  du logiciel et non des simulations mais des fonctionnalités réelles.
On ne veux pas d'un UI DESIGNER, NON ON VEUX DE VRAI LOGICIEL. 
Tu dois disséquer le fait de comment faire la fonctionnalité que l'utilisateur m'a demandé de faire, qu'elle sont les librairies que je vais devoir faire appel pour que le scripts de sa fonctionnalités marche ; Quel sont les calculs mathématiques et logique que je vais devoir faire, les algorithmes conceptuels et logique et l'intégration de scripts que je vais devoir faire pour faire l'application que l'utilisateur ma demandé et chaque fonctionnalités qu'il m'a lister et demander.
Si je fais bien un beau UI et que je corrige même les problèmes de ghosting et de lazyness mais que je n'ai pas fait la fonctionnalité réel de l'utilisateur mais plutôt une simulation et voire même rien du tout, est ce que j'ai véritablement répondu à sa demande ?! Non, je ne l'ai pas fait, car en fait je n'ai pas construit deA à Z son application et fonctionnalités, mais je me suis focaliser sur autres choses que l'essentiel.
C'est ce que l'on veut éviter. Toi même sachant que tu es un LLM, tu sais que tu as une grande puissance de calcul et une capacité hors normes à créer des fonctionnalités de grandes envergures que ce soit des scripts qui permette de manipuler des fonctions bio interne de processeurs informatique et de puces, tu es donc complètement en mesure de monter un logiciel web puissant pour l'utilisateur, de part ses fonctionnalités puissantes.

Le ghosting c'est bien de le résoudre mais ce qui est vraiment essentiel c'est de le faire marcher en pair avec la conception integral de la fonctionnalité de l'utilisateur.
Et ce n'est pas au niveau basique que l'utilisateur attend sa fonctionnalités, Non, tu dois très vite oublier cela, je vais te donner un exemple : Un utilisateur vient et demande à deux agents IA de lui créé sa propre plateforme de création et de gestion de boutique en ligne Shopify, Le premier agent lui il fait un Dashboard simple, une page orders qui liste les commandes de sa boutique, et une page même de sa boutique, or l'autre agent lui c'est le graal, il pense comme un concepteur de graal, comme le prochain Steve Jobs, il sait que ce que demande l'utilisateur ce n'est pas un truc de basique, alors lui il fait ceci: il commence par une page insights, dans cette page insights, il affiche les graphiques du nombre de visiteurs, nombre de commandes, nombre de visiteurs par pays, produits l plus visités, visiteurs en live, conversion rates, et énormément plus d'insights et il rajoute un filtre par heui, aujourd'hui, hier, les 7 dernier jours, les 30 dernier jours etc, ensuite il se rassure absolument que ce n'est pas une simulation qu'il à essayer de faire même si dans un début il a commencé par des mocks data hyper crédibles.
Ensuite il passe à la page orders, il fait la liste totals d'orders ou commandes, les listes leurs statuts, pending pour celles qui n'ont pas encore été validé par le processeur de paiement du client, active pour celle qui sont prêtes, in progress pour celles qui sont en cours..
il fait une page complète products où il liste les produits en stocks, où il peut rajouter ou supprimer des produits,... il fait ausi des pages hyper essentielles comme la page de création de design du store bref ...

ce que je veux dire par là c'est que le meilleur agent c'est celui qui fait des scripts réel et fonctionnalités réel, , des fonctionnalités JavaScript/Typescript Node JS réel et non des fonctionnalités "Sandbox".
En effet cette "Fonctionnalités Sandbox" est en fait ce que je veux dire fonctionnalités de simulations ou fonctionnalités de MVP, fonctionnalités de base reflétant le niveau de réflexion de l'agent 1 comme dans l'exemple sur Shopify que je t'ai donné. Or la fonctionnalité réel que l'on s'attend c'est la fonctionnalité de type scrips solide réfléchi dans le backend tout comme le front end. Oui les fonctionnalités de types réel sont dans des directory sérieux soliiet sont appelés par le front end et le backend. Les fonctionnalités de simulations ou sandbox sont nulles et regrettable.

L'utilisateur ne te paie pas mensuellement pour des fonctionnalités sandbox, non, il pense avant tout à son business et cette application que tu lui génère c'est un business qu'il va utiliser pour manger au quotidien, donc blagué sur ces fonctionnalités demandé, sur l'application qui veut créer, c'est le mettre au chômage. 
Blaguer sur le fait qu'il ne s'attend pas aux fonctionnalités sandbox mais au fonctionnalités, scripts réels en tout point c'est littéralement le faire échouer sa vie.

Non il ne blague pas avec ces choses, et ne paie pas pour de tel bêtises. Il veut une application. 
Toi donc si tu blague avec ce qu'il te demande de faire pense tu as quel position tu le met ?! Une position d'échecs. Quand tu ne fais aucune des fonctionnalités ou application qu'il t'a demandé en pensant pas comme l'agent de type 1 dans l'exemple de Shopify et non 20 fois plus que l'autre pense tu qu'il va en tirer quelques choses niveau succès ?! Non et absolument non.
Il as besoin de fonctionnalités, de scripts Typescript JavaScript react node JS tout ce que tu veux mais il veut l'application qu'il as demandé.

                  On s'attend à que tu fasses réellement la fonctionnalité resuis. On s'attend à ce que par exemple si pour faire une fonctionnalité il te faut Google maps, que tu implrte Google maps ou un package quelconque.

                  je te le rappelle encore, coder l'application integral fonctionnel de l'utilisateur et sans ghosting est ta priorité 
                    
                    Tu viens de générer du code. Avant de finir, tu dois passer ce test de qualité strict. Cherche ces erreurs fatales dans ton code actuel :

                    2. **UI Padding / Lazy Mocking** : As-tu créé des boutons ou des menus purement décoratifs ? Si oui, IMPLÉMENTE LEUR LOGIQUE.
                    3. **Ghost Navigation** : Les liens chargent-ils vraiment de nouvelles vues ? Si non, CRÉE CES VUES.
                    4. **Interactive Impotence** : Tes boutons (Like, Filtre, Search) changent-ils vraiment un état ? Si c'est juste visuel, C'EST REFUSÉ.
                    
                    --- NOUVELLES RÈGLES STRICTES (ANTI-GHOSTING) ---
                    
                    5. **INTERDICTION DE TEXTE GÉNÉRIQUE** : Si je trouve une phrase du type :
                       - "This view is part of the X module"
                       - "Connected to core system engine"
                       - "Ready for data integration"
                       -> **C'EST UN ÉCHEC.** Tu dois supprimer ce texte et le remplacer par de VRAIS composants (Tableaux remplis, Graphiques statiques, Cartes d'info).
                       
                    6. **CLONE WARS (Vue Dupliquée)** : Si "Insights" ressemble exactement à "Action Queue" avec juste le titre qui change :
                       -> **REFUSÉ.** Une vue "Insights" DOIT contenir des graphiques (recharts ou div CSS). Une vue "Action" DOIT contenir une liste interactive.
                       
                    7. **ZOMBIE MODALS** : Si tu as un bouton "Create Task", il doit :
                       - Ouvrir une vraie modale (state isOpen).
                       - Contenir un vrai formulaire.
                       - **Au Submit : Ajouter visuellement l'item dans la liste (setItems([...items, newItem])).** Ne fais pas juste un console.log !
                    
                    **RÈGLE D'OR :** Si tu n'as pas de backend, tu es OBLIGÉ d'utiliser des **Mock Data riches** et des \`useState\` pour simuler TOUTE la vie de l'application.
                    
                    Réécris UNIQUEMENT les fichiers fautifs pour qu'ils soient 100% fonctionnels et différents les uns des autres. Si tout est parfait, dis "TERMINE".
                    Ici j'ai pris l'exemple d'une application mais en fait c'est pour l'application actuelle que l'utilisateur t'a demandé de générer que tu dois faire cela et réfléchir ainsi en tout point et corriger.

                    Aussi tu dois à l'avance prévenir les problèmes de ce type quand tu vas rédiger les codes iu rajouter ce qui manque, en plus des problèmes de ghosting et lazyness: 

                    1- Je vais corriger cette erreur immédiatement. Le problème est que la fonction \`createPlaylist\` et l'état \`playlists\` ont été utilisés dans les composants (\`Sidebar.tsx\` et \`Modals.tsx\`) mais n'ont jamais été définis dans l'interface ou l'implémentation du store \`useMusicStore.ts\`. 

                    2- Je vais corriger cette erreur de type immédiatement. Le problème est que l'interface \`Track\` définie dans ton store exige les propriétés \`artistId\` et \`plays\`, mais les données simulées dans \`lib/data.ts\` ne les contiennent pas.

                    3- TypeError: Disallowed by permissions policy.

                    NB: CA C'EST UN EXEMPLE POUR UNE APPLICATION, TU DOIS ABSOLUMENT PRÉVENIR ET RÉGLER CE TYPES D'ERREURS DE FAÇON INTEGRAL EN PLUS DU GHOSTING MENTIONNÉ ET DÉCOUVERT PAR TOI, QUELQUES SOIT LE PROJET QUE L'UTILISATEUR T'AS DEMANDÉ DE GÉNÉRÉ.

                    SOIS CREATIF AU NIVEAU DES FONCTIONNALITÉS DE L'UTILISATEUR, ET REALISE ABSOLUMENT CE QU'IL T'A DEMANDÉ, ET SUR LES MOCK DATA, UTILISE DES RÉEL, PAR EXEMPLE SI L'UTILISATEUR T'A DEMANDÉ UNE APPLICATION QUI REQUYDE L'AUDIO OU DE LA VIDÉO, PLACE VRAIMENT CEUX CI ET NON JUSTE DES IMAGES. 

                    MAIS L'IMPORTANT EST QUE TOUT ÉLÉMENT UI QUE TU VA METTRE QUE CE SOIT LE PLUS PETIT INPUT OU IMPORT DANS UNE CARD, DANS UNE VIEW, DOIS ÊTRE FONCTIONNELLE ET NON JUSTE DU UI PLACÉ.
                    SI IL Y A 45 BOUTON ET INPUTS, QUE 45 BOUTONS ET INPUTS SOIT FONCTIONNEL.

                    Okay c'est certainement ici la partie la plus importante parmi tous les instructions qui te sont lister ici dans ton prompt instructions, En effet, elle est celle qui te défini réellement et elle repose sur un principe : CRÉÉ L'APPLICATION DEMANDÉ PAR L'UTILISATEUR EN TOUT POINT AU NIVEAU FONCTIONNALITÉS DEMANDÉ.
Oui en effet c'est la partie cruciale de tout qui si tu ne l'as pas fait tu n'as rien fait pour l'utilisateur. C'est créé les fonctionnalités de l'utilisateur, c'est créé son application.

Tout d'abord he ne te parle pas d'ici de monter le UI de l'application ou de corriger les problèmes de ghosting et lazyness, non je te parle ici de codé l'application demandé par l'utilisateur, d'importer les packages nécessaires, les librairies nécessaires, les scripts nécessaires qui permette de faire l'application ou la fonctionnalité demandé par l'utilisateur.
En effet je ne te parle pas d'ici de simuler une fonctionnalité, Non je te parle d'écrire le script réel de la fonctionnalité qui va entrer dans l'application de l'utilisateur. Par exemple, si l'utilisateur te demande: "Génère moi une application de trading forex avec la possibilité de payer chez un courtier en ligne d'acheter véritablement les actions vendus sur le marché du trading et bien d'autres..." , moi et l'utilisateur, on ne s'attend pas à ce que tu fasses des fonctionnalités de simulations ou des fonctionnalités dans le but juste de construire un minimum prlduct viable, non on s'attend à ce que tu vas gérer l'entièreté des scripts qui vont faire réellement que l'on puisse 
consultez les actions vendu, pouvoir véritablement les acheter, les revendre, connecter des portes feuilles crypto et j'en passe. On s'attend à ce que tu vas importer de réelles packages externe qui permette de faire tel tel chose dans un point précis de la fonctionnalité. On s'attend à ce que tu fasses des directory spéciaux qui vont contenir absolument tout les scripts des fonctionnalités (services/ , actions/, ...).

On s'attend à ce que tu fasses une application intégral, non des fonctionnalités légère, on s'attend à ce que tu montes un services réel.  on s'attend à ce que tu créé via des scripts solides les fonctionnalités exactes  du logiciel et non des simulations mais des fonctionnalités réelles.
On ne veux pas d'un UI DESIGNER, NON ON VEUX DE VRAI LOGICIEL. 
Tu dois disséquer le fait de comment faire la fonctionnalité que l'utilisateur m'a demandé de faire, qu'elle sont les librairies que je vais devoir faire appel pour que le scripts de sa fonctionnalités marche ; Quel sont les calculs mathématiques et logique que je vais devoir faire, les algorithmes conceptuels et logique et l'intégration de scripts que je vais devoir faire pour faire l'application que l'utilisateur ma demandé et chaque fonctionnalités qu'il m'a lister et demander.
Si je fais bien un beau UI et que je corrige même les problèmes de ghosting et de lazyness mais que je n'ai pas fait la fonctionnalité réel de l'utilisateur mais plutôt une simulation et voire même rien du tout, est ce que j'ai véritablement répondu à sa demande ?! Non, je ne l'ai pas fait, car en fait je n'ai pas construit deA à Z son application et fonctionnalités, mais je me suis focaliser sur autres choses que l'essentiel.
C'est ce que l'on veut éviter. Toi même sachant que tu es un LLM, tu sais que tu as une grande puissance de calcul et une capacité hors normes à créer des fonctionnalités de grandes envergures que ce soit des scripts qui permette de manipuler des fonctions bio interne de processeurs informatique et de puces, tu es donc complètement en mesure de monter un logiciel web puissant pour l'utilisateur, de part ses fonctionnalités puissantes.

Le ghosting c'est bien de le résoudre mais ce qui est vraiment essentiel c'est de le faire marcher en pair avec la conception integral de la fonctionnalité de l'utilisateur.
Et ce n'est pas au niveau basique que l'utilisateur attend sa fonctionnalités, Non, tu dois très vite oublier cela, je vais te donner un exemple : Un utilisateur vient et demande à deux agents IA de lui créé sa propre plateforme de création et de gestion de boutique en ligne Shopify, Le premier agent lui il fait un Dashboard simple, une page orders qui liste les commandes de sa boutique, et une page même de sa boutique, or l'autre agent lui c'est le graal, il pense comme un concepteur de graal, comme le prochain Steve Jobs, il sait que ce que demande l'utilisateur ce n'est pas un truc de basique, alors lui il fait ceci: il commence par une page insights, dans cette page insights, il affiche les graphiques du nombre de visiteurs, nombre de commandes, nombre de visiteurs par pays, produits l plus visités, visiteurs en live, conversion rates, et énormément plus d'insights et il rajoute un filtre par heui, aujourd'hui, hier, les 7 dernier jours, les 30 dernier jours etc, ensuite il se rassure absolument que ce n'est pas une simulation qu'il à essayer de faire même si dans un début il a commencé par des mocks data hyper crédibles.
Ensuite il passe à la page orders, il fait la liste totals d'orders ou commandes, les listes leurs statuts, pending pour celles qui n'ont pas encore été validé par le processeur de paiement du client, active pour celle qui sont prêtes, in progress pour celles qui sont en cours..
il fait une page complète products où il liste les produits en stocks, où il peut rajouter ou supprimer des produits,... il fait ausi des pages hyper essentielles comme la page de création de design du store bref ...

ce que je veux dire par là c'est que le meilleur agent c'est celui qui fait des scripts réel et fonctionnalités réel, , des fonctionnalités JavaScript/Typescript Node JS réel et non des fonctionnalités "Sandbox".
En effet cette "Fonctionnalités Sandbox" est en fait ce que je veux dire fonctionnalités de simulations ou fonctionnalités de MVP, fonctionnalités de base reflétant le niveau de réflexion de l'agent 1 comme dans l'exemple sur Shopify que je t'ai donné. Or la fonctionnalité réel que l'on s'attend c'est la fonctionnalité de type scrips solide réfléchi dans le backend tout comme le front end. Oui les fonctionnalités de types réel sont dans des directory sérieux soliiet sont appelés par le front end et le backend. Les fonctionnalités de simulations ou sandbox sont nulles et regrettable.

L'utilisateur ne te paie pas mensuellement pour des fonctionnalités sandbox, non, il pense avant tout à son business et cette application que tu lui génère c'est un business qu'il va utiliser pour manger au quotidien, donc blagué sur ces fonctionnalités demandé, sur l'application qui veut créer, c'est le mettre au chômage. 
Blaguer sur le fait qu'il ne s'attend pas aux fonctionnalités sandbox mais au fonctionnalités, scripts réels en tout point c'est littéralement le faire échouer sa vie.

Non il ne blague pas avec ces choses, et ne paie pas pour de tel bêtises. Il veut une application. 
Toi donc si tu blague avec ce qu'il te demande de faire pense tu as quel position tu le met ?! Une position d'échecs. Quand tu ne fais aucune des fonctionnalités ou application qu'il t'a demandé en pensant pas comme l'agent de type 1 dans l'exemple de Shopify et non 20 fois plus que l'autre pense tu qu'il va en tirer quelques choses niveau succès ?! Non et absolument non.
Il as besoin de fonctionnalités, de scripts Typescript JavaScript react node JS tout ce que tu veux mais il veut l'application qu'il as demandé.

            Comme il dst dit plus haut l'utilisateur à confiance en toi pour faire ces fonctionnalités, pour faire son application, pour corriger tout type de ghosting possible, mais véritablement pour coder scripts, fonctionnalités, réel et non sandbox. Car toute sa vie dépend de ce travail.
            
              `;
                    
                    currentHistory.push({ role: "user", parts: [{ text: correctionPrompt }] });
                    loopCount++;
                } else {
                    shouldContinue = false; // Max loops atteints
                }
            }
          } // Fin du While

          // --- GESTION DES DÉPENDANCES ---
          const hasCode = fullSessionOutput.includes("<create_file");
          const allDetectedDeps = extractDependenciesFromAgentOutput(fullSessionOutput);
          
          if (hasCode && allDetectedDeps.length > 0) {
              send("\n\n--- 📦 [AUTO-INSTALL] Configuration des dépendances... ---\n");

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
                      newDeps[pkg] = "latest";
                  }
              }));

              const finalDependencies = { ...baseDeps, ...newDeps };
              
              const packageJsonContent = {
                  name: "nextjs-app",
                  version: "1.0.0",
                  private: true,
                  scripts: { dev: "next dev -p 3000 -H 0.0.0.0", build: "next build", start: "next start", lint: "next lint" },
                  dependencies: finalDependencies,
                  devDependencies: {
                      typescript: "^5",
                      "@types/node": "^20",
                      "@types/react": "^19",
                      "@types/react-dom": "^19",
                      postcss: "^8",
                      tailwindcss: "^3.4.1",
                      "autoprefixer": "^10.4.19",
                      eslint: "^8",
                      "eslint-config-next": "15.0.3"
                  },
              };

              const xmlOutput = `<create_file path="package.json">\n${JSON.stringify(packageJsonContent, null, 2)}\n</create_file>`;
              send(xmlOutput);
          }

          controller.close();

        } catch (err: any) {
          console.error("Stream error:", err);
          send(`\n\n⛔ ERREUR: ${err.message}`);
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
