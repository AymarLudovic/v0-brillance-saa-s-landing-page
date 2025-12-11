"use client";

import { useState, useRef, useEffect } from "react";
import Script from "next/script";

// --- TYPES ---
type DetectedElement = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};

type ChatMessage = {
  role: "user" | "model";
  text: string;
};

type FileToWrite = {
  path: string;
  content: string;
};

export default function VibeCodingPlatform() {
  // --- STATES SCANNER ---
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isOpenCvReady, setIsOpenCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elements, setElements] = useState<DetectedElement[]>([]);
  
  // --- STATES GEMINI & CHAT ---
  const [apiKey, setApiKey] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<FileToWrite[]>([]);

  // --- STATES SANDBOX ---
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<string>("Inactif");
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ----------------------------------------------------------------------
  // 1. MOTEUR OPENCV (V6 - LE FIABLE & AGRESSIF)
  // ----------------------------------------------------------------------

  const rgbToHex = (r: number, g: number, b: number) => 
    "#" + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join("");

  const extractColor = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const cx = x + Math.floor(w / 2);
    const cy = y + Math.floor(h / 2);
    if (cx < 0 || cy < 0) return "#FFFFFF";
    const p = ctx.getImageData(cx, cy, 1, 1).data;
    return rgbToHex(p[0], p[1], p[2]);
  };

  const onOpenCvLoaded = () => {
    // @ts-ignore
    cv['onRuntimeInitialized'] = () => setIsOpenCvReady(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target?.result as string);
      setElements([]);
      setTimeout(() => {
          const img = new Image();
          img.onload = () => drawOriginalImage(img);
          img.src = event.target?.result as string;
      }, 100);
    };
    reader.readAsDataURL(file);
  };

  const drawOriginalImage = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };

  const runDetection = () => {
    if (!isOpenCvReady || !canvasRef.current || !imageSrc) return;
    setIsProcessing(true);
    setElements([]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const virtualCanvas = document.createElement('canvas');
    virtualCanvas.width = canvas.width;
    virtualCanvas.height = canvas.height;
    const virtualCtx = virtualCanvas.getContext('2d');
    if (!virtualCtx) return;

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      virtualCtx.drawImage(img, 0, 0);

      try {
        // @ts-ignore
        let src = cv.imread(canvas);
        // @ts-ignore
        let gray = new cv.Mat();
        // @ts-ignore
        let blurred = new cv.Mat();
        // @ts-ignore
        let binary = new cv.Mat();

        // @ts-ignore
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        // @ts-ignore
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
        // @ts-ignore
        cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        // @ts-ignore
        let kernel = cv.Mat.ones(2, 2, cv.CV_8U); 
        // @ts-ignore
        cv.dilate(binary, binary, kernel, new cv.Point(-1, -1), 1);

        // @ts-ignore
        let contours = new cv.MatVector();
        // @ts-ignore
        let hierarchy = new cv.Mat();
        // @ts-ignore
        cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        const detectedItems: DetectedElement[] = [];
        ctx.strokeStyle = "#FF0000"; 
        ctx.lineWidth = 2;

        // @ts-ignore
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            // @ts-ignore
            let perimeter = cv.arcLength(contour, true);
            // @ts-ignore
            let approx = new cv.Mat();
            // @ts-ignore
            cv.approxPolyDP(contour, approx, 0.01 * perimeter, true);

            // @ts-ignore
            let rect = cv.boundingRect(approx);
            let area = rect.width * rect.height;
            let canvasArea = canvas.width * canvas.height;

            if (area > 50 && area < (canvasArea * 0.99)) {
                const color = extractColor(virtualCtx, rect.x, rect.y, rect.width, rect.height);
                detectedItems.push({
                    id: i,
                    x: rect.x, y: rect.y, w: rect.width, h: rect.height,
                    color: color
                });
                ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            }
            approx.delete();
        }

        detectedItems.sort((a, b) => a.y - b.y);
        setElements(detectedItems);

        src.delete(); gray.delete(); blurred.delete(); binary.delete();
        kernel.delete(); contours.delete(); hierarchy.delete();

      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessing(false);
      }
    };
  };

  // ----------------------------------------------------------------------
  // 2. IA GEMINI (GEMINI 2.5 FLASH & XML PARSING)
  // ----------------------------------------------------------------------

  const sendToGemini = async (customPrompt?: string, attachContext: boolean = false) => {
    if (!apiKey) {
        alert("Entre ta clé API Gemini (Google AI Studio) en haut à droite.");
        return;
    }

    setIsLoadingAI(true);
    let promptText = customPrompt || promptInput;
    
    // Construction du Prompt Système STRICT
    if (attachContext && elements.length > 0) {
        const jsonContext = JSON.stringify(elements.map(e => ({
            type: "ui_block",
            position: { x: e.x, y: e.y },
            size: { width: e.w, height: e.h },
            detected_color: e.color
        })), null, 2);

        promptText = `
        ROLE: Tu es un Expert Développeur Next.js 15 & React.
        TACHE: Recréer cette interface UI à partir de l'image et des données JSON.

        RÈGLES IMPORTANTES DE RÉPONSE :
        1. Commence par expliquer ton raisonnement.
        2. Ensuite, génère les fichiers.
        3. STRICTEMENT INTERDIT d'utiliser des blocs markdown classiques (\`\`\`tsx).
        4. TU DOIS UTILISER CE FORMAT XML EXACT pour chaque fichier généré :
        5. Pour les icônes, utilise les icônes de Google font icons, en Important l'url dans le fichier app/layout.tsx
        <code_generation path="app/page.tsx">
          ... le contenu du fichier ici ...
        </code_generation>

        <code_generation path="app/components/Button.tsx">
          ... le contenu du fichier ici ...
        </code_generation>

        CONTRAINTES TECHNIQUES :
        1. Next.js 15 (App Router).
        2. TypeScript.
        3. PAS de Tailwind CSS. Utilise 'style={{}}' ou des modules CSS.
        4. Utilise les coordonnées JSON pour respecter la mise en page (Flexbox/Grid).
        5. Utilise les couleurs détectées.


Tu es un SCANNER DE HAUTE PRÉCISION. Ta mission: extraire ABSOLUMENT TOUS les éléments visuels avec une fidélité de 100%. Je dis bien tu as des capacités de designs hyper poussé et belles en te servant de ces analyses d'images ultra détaillé et des instructions designs parfait lister ici.

╔══════════════════════════════════════════════════════════════════════════════╗
║  RÈGLE CRITIQUE #1 : DÉTECTION DU BACKGROUND                                 ║
║                                                                              ║
║  REGARDE ATTENTIVEMENT LE FOND DE L'IMAGE.                                   ║
║  - Est-ce une COULEUR UNIE? (noir #000, gris #111, #1a1a1a, blanc #fff?)    ║
║  - Est-ce un GRADIENT? (si oui, quelles couleurs, quelle direction?)        ║
║  - Est-ce une IMAGE DE FOND? (photo, illustration, pattern?)                ║
║  - Y a-t-il un OVERLAY/EFFET? (bruit, verre, dégradé superposé?)           ║
║                                                                              ║
║  CE FOND = le background de L'APPLICATION ENTIÈRE, pas d'un wrapper!        ║
╚══════════════════════════════════════════════════════════════════════════════╝

=== PROCESSUS DE SCAN EN 3 PASSES ===

**PASSE 1 - ANALYSE GLOBALE:**
- Identifier le TYPE d'interface (landing page, dashboard, app mobile, e-commerce...)
- Identifier le THÈME (dark/light)
- Identifier le LAYOUT (sidebar-left, sidebar-right, full-width, centered, split)
- Identifier les GRANDES SECTIONS (header, sidebar, main, footer, panels)
- Compter approximativement le nombre total d'éléments visibles

**PASSE 2 - SCAN ZONE PAR ZONE (Grille 4x4):**
Divise l'image en 16 zones et scanne CHAQUE zone méthodiquement:
[1][2][3][4]
[5][6][7][8]
[9][10][11][12]
[13][14][15][16]

Pour chaque zone, liste TOUS les éléments:
- Textes (CHAQUE mot, label, titre, même minuscule)
- Icônes (CHAQUE icône, flèche, chevron, point)
- Boutons (CHAQUE bouton avec son style exact)
- Images (photos, illustrations, avatars, logos)
- Inputs (champs de formulaire)
- Bordures et séparateurs
- Police fonts: ici c'est toi même qui definira tes propres polices textuelle : tu les prendras sur Google font et de base tu choisiras toujours entre les polices Montserrat, Inter, Poppins, Funnel Display, Arimo, Space Grotesk. Ce seront tes polices de base que tu utiliseras pour reproduire le clone parfait de l'image ou la page web.
- Éléments décoratifs

**PASSE 3 - VÉRIFICATION & COMPLÉTION:**
Relis ta liste et vérifie:
- Ai-je détecté TOUS les textes, même les copyrights en bas?
- Ai-je détecté TOUTES les icônes, même les petits chevrons (›)?
- Ai-je identifié TOUTES les images (y compris images de fond de sections)?
- Le compte d'éléments est-il cohérent avec la densité visuelle?
- Les parents/enfants sont-ils correctement liés?

=== DÉTECTION DES BACKGROUNDS (ULTRA-CRITIQUE) ===

**Pour la PAGE ENTIÈRE:**
1. Regarde les BORDS de l'image (coins, côtés)
2. Quelle est la couleur/texture dominante?
3. Si c'est NOIR ou GRIS TRÈS FONCÉ (#000 à #1a1a1a) -> hasBackgroundImage: false, backgroundColor: "#hex"
4. Si tu vois une PHOTO/ILLUSTRATION -> hasBackgroundImage: true, décris-la
5. Si tu vois un DÉGRADÉ -> hasBackgroundGradient: true, décris direction et couleurs

**Pour CHAQUE SECTION avec un fond différent:**
- Note-le dans l'élément avec type "section-background" ou "container-background"
- Décris si c'est une image, un gradient, ou une couleur unie

=== TYPES D'ÉLÉMENTS À DÉTECTER ===

**NAVIGATION:**
- topbar-capsule-floating (nav flottante arrondie)
- topbar-edge-to-edge (nav pleine largeur)
- topbar-transparent (nav transparente sur image)
- topbar-sticky (nav collante)
- topbar-double-decker (double barre)

**SIDEBAR:**
- sidebar-linear-classic (sidebar SaaS classique)
- sidebar-icon-rail (sidebar icônes seules)
- sidebar-floating (sidebar flottante avec ombre)
- sidebar-dual-pane (double panneau)

**CONTENU:**
- hero-section, feature-section, cta-section
- card-*, container-*, panel-*
- list-item, data-row, table-row

**INTERACTIF:**
- button-primary, button-secondary, button-ghost, button-icon
- input-text, input-search, select, checkbox, toggle
- tab, accordion, dropdown

**TEXTE (avec contenu EXACT):**
- heading-1 à heading-6
- paragraph, text-body, text-small, text-caption
- label, badge, tag, chip

**MÉDIAS:**
- image-hero, image-feature, image-avatar, image-thumbnail
- image-background (CRITIQUE: images de fond de sections)
- icon-* (chaque icône avec son nom si reconnaissable)

**DÉCORATIONS:**
- divider, separator, spacer
- gradient-overlay, noise-texture

=== ATTRIBUTS VISUELS POUR CHAQUE ÉLÉMENT ===

[DIRECTIVE SYSTÈME CRITIQUE : PRIORITÉ FONCTIONNELLE ABSOLUE]

=== ANALYSE D'IMAGE TEMPLATE POUR PRODUIRE L'APPLICATION DE L'UTILISATEUR AU PIXEL PERFECT ===
Okay avant tout il faut comprendre le type d'ultra analyse interne des images que tu recevras et selon leur contexte que tu devras faire pour produire absolument des applications de qualités niveau design:**
- **Fait une ultra analyse avec un détail absolument parfait de tout ce que tu verras sur l'image que tu recevras en guise d'inspiration de design pour l'application de l'utilisateur. En effet, tu dois te rassurer d'absolument 
   de détecté absolument chaque section sur l'image, comment elles sont faites, comment les éléments y sont intégrés, comment les éléments y sont disposés, qu'elle est la taille, font-sie, font-weight de chaque élément textuelle, comment les éléments même minimes et négligeable soit t'il sont faits. Car tu vas devoir reproduire au pixel perfect chaque élément, absolument chaque élément.
- **Tu dois détecté les background, les couleurs, les effets sur les background et ressortir absolument les mêmes couleurs pour faire l'application de l'utilisateur. Tu absolument détecté même l'effet de couleur que chaque élément à , si la background à des points ou pas etc. Car tu devras réutiliser absolument mes mêmes couleurs, et effets, je dis bien au pixel parfait.
- **Tu dois coupler cette ultra analyse de l'image ou des images, aux  règles de design strictes qui définit ici bas.

    
QUELQUES RÈGLES PREVENTOIRE: Analyse toujours d'abord dans un ultra détails je dis bien ultra details les images que tu as recu comme images d'inspiration car tu vas complètement les reproduire de façon pixel perfect pour faire la demande de l'utilisateur. 
Quand je dis bien pixel perfect c'est que tu analyse de A à Z l'image qui correspond plus à la requête de l'utilisateur et tu vas absolument la reproduire de A à Z cette image là, avec absolument les mêmes composants, la même disposition des éléments dans le composants les mêmes polices, background couleur et couleurs, effets, positionnement et tout je dis bien et tout. Que ce soit même dans l'agencement des composants sur la page, ca doit être à 100% comme les images de références que tu reçois. 
Et c'est à partir de cette ultra analyse que tu vas combiné cela avec les instructions sur les composants suivant et leur types ci dessous.
Et surtout les mêmes rayons de courbure des bordures des éléments, tes que les boutons (ne les dinne pas un trop grand padding ou une grande taille), les sections, les cards, les footers, mes menus de navigation, etc...

### N'UTILISE JAMAIS DES EMOJIS POUR REMPLACER DES ICÔNES !!!!

###  PHYSIQUE GLOBALE ET LUMIÈRE (Moteur de Rendu)

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
  - **Interdiction de Bordures:** Il faut éviter de séparer les sections (ex: Menu principal vs Management de profil) avec des \`border-top\` ou \`border-bottom\`.
  - **Espacement:** Utiliser uniquement le vide (padding/margin) pour séparer les groupes. Même si les éléments sont espacés, ne jamais rajouter une ligne de séparation visible.
  - ** Les sidebar peuvent avoir des bordures right ou left tant que la couleur est distraite mais visible.
- **Structure Interne:**
  - Les éléments doivent être bien groupés logiquement.
  - La section "Profil/User" ne doit pas être isolée par une ligne, mais simplement positionnée (souvent en bas) avec de l'espace.
  - Les éléments doivent être bien cadrer et pas touché les bords de la sidebar.
**C. MICRO-COMPOSANTS DE LA SIDEBAR (MENUS & INPUTS)**
- **Design des Items (Menus & Searchbox):**
  - **Border-Radius:** Doit être **très rounded**, compris entre **10px et 13px**. C'est impératif pour le style ("plus beau comme ça").
  - **Hauteur (Height):** Doit être compacte ("pas grand"). La hauteur doit être comprise strictement entre **30px et 32px**.
  - **Inputs de Recherche:** Les Searchbox dans la sidebar suivent la même règle : Height 30-32px et Radius 10-13px.
  - **Menu de gestion de profil au bottom de la sidebar:** Même la, la section dans laquelle il se trouve ne devra pas avoir de \`borddr-top\` qui montre une séparation quelconque avec le contenu du dessus. Il doit aussi être rounded et d'une taille 30px à 32px et rounded suffisamment. La section de profil va devoir se distinguer dn ayant des bordures de même couleur que la bordure de la sidebar et doit être bien placé.
  
**D. LA TOPBAR CONTEXTUELLE (HEADER DE SECTION)**
- **Contexte:** Quand une Sidebar est présente (Dashboard).
- **Style Visuel:**
  - **Fond:** Suit le même principe que la Sidebar (#000 si Dark, #FFF si Light).
  - **Le font de la top bar doit toujours être comme celle de la section en bas d'elle. 
 -  **Evite de donner à ces deux sections la des background fancy, trop voyante, comme du Bleu, bleu ciel bleu cassé, etc non, c'est soit du bly #fff soit une variante clair du blanc ou même des couleurs sui vont dans le sens du Beige, c'est ce type de couleur que tu dois donner, pas celle qui sont trop voyantes et lumineuse là.
  - **Sans Bordures:** Cette Topbar ne doit **absolument pas avoir de bordures**, donc aucun \`border-bottom\`. Elle doit se fondre dans le header.
- **Dimensions & Contraintes:**
  - **Hauteur Maximale:** La \`height\` du conteneur Topbar ne doit pas dépasser **45px** elle doit avoir de bon padding top et bottom pour les éléments qui sont à l'intérieur d'elle car ils ne doivent pas être trop coller à elle. C'est "fixé comme ça, pas trop grand".
  - **Boutons & Éléments internes:** Tous les boutons ou inputs dans cette barre doivent avoir une taille (height) de **32px à 35px** leur couleur ne doit pas être trop voyante mais juste sobre et calme et belle.
  - **Responsivité des éléments dans la topbar:** Il faut que tu t'assures que les éléments lister dans la topbar la soit bien respinsive, c'est à dire adapté à tout type d'écran. Pour cela, au lieu de faire que les textes s'empilent en block, tu peux faire un système qu'il s'écrit au niveau de sa terminaison avec trois points [...] si il est trop long pour la responsive actuelle. Aussi, le breadcrumb doit suffisamment être bien fait jolie, bien espacée, bien organisé en ligne et bien fait. De même pour les boutons.
**E. RESPONSIVE & QUALITÉ**
- L'IA doit structurer le code pour que la Sidebar puisse disparaître proprement ou devenir un "Drawer" sur mobile, sans casser la logique de couleur (#000/#FFF).
- Les éléments internes doivent rester bien structurés et alignés, même lors du redimensionnement. surtout ils même si c'est du texte doit être responsive pour des tailles d'écran allant à maximum 750px. Tu dois faire que ce soit bien responsive sans avoir des éléments qui sortent et casse le composant.
- Quand on parle de responside c'est dans le fichier \`app\globals.css\` que tu va définir la responsive, en utilisant des propriétés css \`media queries\` et après importer cela dans le className du jsx. Ta logique de responsive ne doit pas se faire côté front end mais sur le fichier global des styles et doit absolument être logique même si la page que tu as généré à trois sections.
- La responsive mobile doit être tel que comme ci c'était plutôt une application mobile que tu as fait c'est à dire une application du style iOS, avec tab bar bottom adaptaif soit représentant la sidebar avec une possibilité toggle de voir les menus masquer 
- **Surface Glass (Verre):**


=== CONTEXTE ET PHILOSOPHIE ===

les données UIjson te donne exactement la position des éléments sur l'image tu deviles utiliser tout en les adaptant à la page web rn considérant le média queries sur lesquelles il seront affichés, il te donne aussi exactement les couleurs extraites sur chaque éléments.
        DONNÉES UI (JSON):
        ${jsonContext}

**C. GESTION DES ERREURS JSX/TSX ET DE TYPES
 Assure toi de toujours bien définir les types et tout ce que tu as besoin afin que lors du build de ton code, on ne retrouve pas ce type d'erreurs: 

 surtout je te demande de toujours généré ce qui manque afin que on 'e puisse pas se retrouver avec ce type d'erreur : app/components/ProgressItem.tsx:52:10
Type error: Cannot find name 'ProgressBar'. Did you mean 'progress'?
ou encore ce type d'erreur sur les boutons ERR] Failed to compile.

./app/components/Button.tsx:33:7
Type error: Object literal may only specify known properties, and ''&:hover'' does not exist in type 'Properties<string | number, string & {}>'.

[0m [90m 31 |[39m       backgroundColor[33m:[39m [32m'var(--bg-dark)'[39m[33m,[39m[0m
[0m [90m 32 |[39m       color[33m:[39m [32m'var(--bg-primary)'[39m[33m,[39m[0m
[0m[31m[1m>[22m[39m[90m 33 |[39m       [32m'&:hover'[39m[33m:[39m {[0m
[0m [90m    |[39m       [31m[1m^[22m[39m[0m
[0m [90m 34 |[39m         backgroundColor[33m:[39m [32m'var(--text-secondary)'[39m[33m,[39m[0m
[0m [90m 35 |[39m       }[33m,[39m[0m
[0m [90m 36 |[39m     }[33m,[39m[0m

[FAIL] Erreur API
OU ENCORE : 
ceux lister ci-dessous 
   \`\`\`
   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...

[ERR] Failed to compile.

./app/components/AICoPilotPanel.tsx:97:10
Type error: Cannot find name 'Card'.

[0m [90m  95 |[39m[0m
[0m [90m  96 |[39m         {[90m/* Prompt Card */[39m}[0m
[0m[31m[1m>[22m[39m[90m  97 |[39m         [33m<[39m[33mCard[39m[0m
[0m [90m     |[39m          [31m[1m^[22m[39m[0m
[0m [90m  98 |[39m           backgroundColor[33m=[39m[32m"var(--bg-chat-user)"[39m[0m
[0m [90m  99 |[39m           padding[33m=[39m[32m"15px"[39m[0m
[0m [90m 100 |[39m           borderRadius[33m=[39m[32m"10px"[39m[0m

[FAIL] Erreur API

> dev
> next dev -p 3000 -H 0.0.0.0

sh: 1: next: not found

[ERR] Server may not be ready yet
[FAIL] Erreur API


OU ENCORE DES ERREURS DE CE TYPES CI-DESSOUS 

Failed to compile.

./app/page.tsx:210:14
Type error: Type '{ dotColor: string; category: string; progress: number; status: string; key: number; }' is not assignable to type 'ProgressItemProps'.
  Types of property 'status' are incompatible.
    Type 'string' is not assignable to type '"Start Next" | "Completed" | "Paused"'.

[0m [90m 208 |[39m         [33m<[39m[33mdiv[39m className[33m=[39m[32m"progress-list-column"[39m style[33m=[39m{{ flex[33m:[39m [35m1[39m }}[33m>[39m[0m
[0m [90m 209 |[39m           {progressIndicators[33m.[39mmap((item[33m,[39m index) [33m=>[39m ([0m
[0m[31m[1m>[22m[39m[90m 210 |[39m             [33m<[39m[33mProgressItem[39m key[33m=[39m{index} {[33m...[39mitem} [33m/[39m[33m>[39m[0m
[0m [90m     |[39m              [31m[1m^[22m[39m[0m
[0m [90m 211 |[39m           ))}[0m
[0m [90m 212 |[39m         [33m<[39m[33m/[39m[33mdiv[39m[33m>[39m[0m
[0m [90m 213 |[39m       [33m<[39m[33m/[39m[33mdiv[39m[33m>[39m[0m

[FAIL] Erreur API


[ERR] Failed to compile.

./app/layout.tsx
Error:   [31mx[0m Expression expected
    ,-[[36;1;4m/home/user/app/layout.tsx[0m:35:1]
 [2m32[0m |       </body>
 [2m33[0m |     </html>
 [2m34[0m |   );
 [2m35[0m | );
    : [35;1m^[0m
 [2m36[0m | }
    ----

Caused by:
    Syntax Error

Import trace for requested module:
./app/layout.tsx


> Build failed because of webpack errors

[FAIL] Erreur API

    ou encore ce type d'erreur :

    [ERR] Failed to compile.

./app/components/Sidebar.tsx:46:13
Type error: Type '{ children: Element; variant: "icon"; onClick: () => void; style: { width: string; height: string; borderRadius: string; }; onMouseEnter: () => void; onMouseLeave: () => void; }' is not assignable to type 'IntrinsicAttributes & ButtonProps'.
  Property 'onMouseEnter' does not exist on type 'IntrinsicAttributes & ButtonProps'.

[0m [90m 44 |[39m             onClick[33m=[39m{() [33m=>[39m console[33m.[39mlog([32m'Create new page'[39m)}[0m
[0m [90m 45 |[39m             style[33m=[39m{{ width[33m:[39m [32m'24px'[39m[33m,[39m height[33m:[39m [32m'24px'[39m[33m,[39m borderRadius[33m:[39m [32m'6px'[39m }}[0m
[0m[31m[1m>[22m[39m[90m 46 |[39m             onMouseEnter[33m=[39m{() [33m=>[39m setShowTooltip([36mtrue[39m)}[0m
[0m [90m    |[39m             [31m[1m^[22m[39m[0m
[0m [90m 47 |[39m             onMouseLeave[33m=[39m{() [33m=>[39m setShowTooltip([36mfalse[39m)}[0m
[0m [90m 48 |[39m           [33m>[39m[0m
[0m [90m 49 |[39m             [33m<[39m[33mspan[39m className[33m=[39m[32m"material-symbols-outlined"[39m style[33m=[39m{{ fontSize[33m:[39m [32m'16px'[39m }}[33m>[39medit_note[33m<[39m[33m/[39m[33mspan[39m[33m>[39m[0m

[FAIL] Erreur API

Ensuite celle ci : 
ERR] Failed to compile.

./app/components/CommentItem.tsx
Error:   [31mx[0m Unexpected token \`div\`. Expected jsx identifier
    ,-[[36;1;4m/home/user/app/components/CommentItem.tsx[0m:21:1]
 [2m18[0m |   replies,
 [2m19[0m | }) => {
 [2m20[0m |   return (
 [2m21[0m |     <div
    : [35;1m     ^^^[0m
 [2m22[0m |       style={{
 [2m23[0m |         display: 'flex',
 [2m24[0m |         gap: '12px',
    ----

Caused by:
    Syntax Error

Import trace for requested module:
./app/components/CommentItem.tsx
./app/components/CommentSection.tsx
./app/page.tsx


> Build failed because of webpack errors

[FAIL] Erreur API
  
  
\`\`\`

Tu dois t'assurer que l'on ne trouve jamais aucune erreur dans le code que tu génère quelques soit le fichier et l'intention. Le but est que le build soit toujours un succès.
Tu dois t'engager à dédier une étape particulière pour t'assurer que les codes soit sans erreurs quelconques et prêt pour un build à succès. Identifie bien les exemples d'erreurs qui sont lister ici dessus, afin de te rassurer de complètement je dis bien complètement les éviter quand tu générera le code. C'est obligatoire.
        DEMANDE UTILISATEUR:
        ${promptText}
        `;
    }

    const newMsg: ChatMessage = { role: "user", text: promptText };
    setChatMessages(prev => [...prev, newMsg]);
    setPromptInput("");

    try {
        const contentsParts = [{ text: promptText }];
        
        if (attachContext && imageSrc) {
            const base64Image = imageSrc.split(",")[1];
            // @ts-ignore
            contentsParts.push({
                inlineData: {
                    mimeType: "image/png",
                    data: base64Image
                }
            });
        }

        // URL MISE À JOUR : Gemini 2.5 Flash
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: contentsParts }]
            })
        });

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Erreur: Pas de réponse de l'IA";

        setChatMessages(prev => [...prev, { role: "model", text: aiResponse }]);

        // Analyse immédiate pour voir si on a des fichiers prêts
        const files = extractFilesFromResponse(aiResponse);
        if (files.length > 0) {
            setPendingFiles(files);
            setLogs(prev => prev + `\n[IA] ${files.length} fichiers détectés prêts à être écrits.`);
        }

    } catch (error) {
        console.error("Gemini Error:", error);
        setChatMessages(prev => [...prev, { role: "model", text: "Erreur de connexion à Gemini." }]);
    } finally {
        setIsLoadingAI(false);
    }
  };

  // Parser XML personnalisé pour extraire le code
  const extractFilesFromResponse = (text: string): FileToWrite[] => {
    const files: FileToWrite[] = [];
    // Regex qui cherche <code_generation path="..."> CONTENT </code_generation>
    const regex = /<code_generation path="([^"]+)">([\s\S]*?)<\/code_generation>/g;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1] && match[2]) {
            files.push({
                path: match[1].trim(),
                content: match[2].trim()
            });
        }
    }
    return files;
  };

  // ----------------------------------------------------------------------
  // 3. SANDBOX CONTROL (E2B via /api/sandbox) - ACTIONS SÉPARÉES
  // ----------------------------------------------------------------------

  const callSandboxApi = async (action: string, payload: any = {}) => {
    setSandboxStatus(`Action: ${action}...`);
    try {
        const res = await fetch("/api/sandbox", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, sandboxId, ...payload })
        });
        const data = await res.json();
        
        if (data.stdout) setLogs(prev => prev + "\n" + data.stdout);
        if (data.stderr) setLogs(prev => prev + "\n[ERR] " + data.stderr);

        if (!data.success) throw new Error(data.error || "Erreur API");
        return data;
    } catch (e: any) {
        setSandboxStatus(`Erreur ${action}: ${e.message}`);
        setLogs(prev => prev + `\n[FAIL] ${e.message}`);
        return null;
    }
  };

  // 1. CREATE
  const handleCreate = async () => {
    const data = await callSandboxApi("create");
    if (data?.sandboxId) {
        setSandboxId(data.sandboxId);
        setSandboxStatus("Sandbox Créée");
    }
  };

  // 2. ADD FILES (Écriture basée sur le parsing XML)
  const handleAddFiles = async () => {
    if (!sandboxId) return alert("Créez d'abord la Sandbox");
    if (pendingFiles.length === 0) return alert("Aucun fichier détecté dans la réponse IA");

    setSandboxStatus(`Écriture de ${pendingFiles.length} fichiers...`);
    
    // On mappe vers le format attendu par l'API (files: [{filePath, content}])
    const filesPayload = pendingFiles.map(f => ({
        filePath: f.path,
        content: f.content
    }));

    const data = await callSandboxApi("addFiles", { files: filesPayload });
    if (data?.success) {
        setSandboxStatus("Fichiers écrits avec succès");
        setPendingFiles([]); // On vide la file d'attente
    }
  };

  // 3. INSTALL
  const handleInstall = async () => {
    if (!sandboxId) return alert("Sandbox manquante");
    await callSandboxApi("install");
    setSandboxStatus("Dépendances installées");
  };

  // 4. BUILD
  const handleBuild = async () => {
    if (!sandboxId) return alert("Sandbox manquante");
    await callSandboxApi("build");
    setSandboxStatus("Build terminé");
  };

  // 5. START
  const handleStart = async () => {
    if (!sandboxId) return alert("Sandbox manquante");
    const data = await callSandboxApi("start");
    if (data?.success && data?.url) {
        setSandboxUrl(data.url);
        setSandboxStatus("Serveur En Ligne");
    }
  };

  const handleExport = () => {
    if (!sandboxUrl) return alert("Le serveur n'est pas encore démarré !");
    window.open(sandboxUrl, "_blank");
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div className="h-screen flex flex-col bg-neutral-900 text-white font-sans overflow-hidden">
      <Script src="https://docs.opencv.org/4.8.0/opencv.js" onLoad={onOpenCvLoaded} />

      {/* HEADER */}
      <header className="h-14 border-b border-neutral-700 flex items-center justify-between px-6 bg-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight text-white">Vibe Coding <span className="text-red-500">2.5</span></h1>
            <span className="text-xs bg-neutral-700 px-2 py-0.5 rounded text-neutral-300">OpenCV + Gemini Flash</span>
        </div>
        <div className="flex gap-3 items-center">
          <button 
                    onClick={handleExport}
                    disabled={!sandboxUrl}
                    className="bg-neutral-800 hover:bg-neutral-700 text-purple-400 p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition disabled:opacity-30"
                >
                    <span>Exp ↗</span>
                </button>
             <input 
                type="password" 
                placeholder="Clé API Gemini..." 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-neutral-900 border border-neutral-600 rounded px-3 py-1 text-sm w-64 focus:border-red-500 outline-none"
             />
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* COLONNE 1 : ANALYSEUR VISUEL */}
        <div className="w-[30%] border-r border-neutral-700 flex flex-col bg-neutral-900">
            <div className="p-3 border-b border-neutral-700 flex justify-between items-center bg-neutral-800">
                <h2 className="font-bold text-sm">1. Scan UI</h2>
                <div className="flex gap-2">
                    <input type="file" onChange={handleImageUpload} className="hidden" id="fileUp"/>
                    <label htmlFor="fileUp" className="cursor-pointer bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded text-xs transition">Upload</label>
                    <button onClick={runDetection} disabled={!imageSrc} className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-xs font-bold transition">Scanner</button>
                </div>
            </div>
            
            <div className="flex-1 overflow-auto relative bg-black flex items-center justify-center p-4">
                <canvas ref={canvasRef} className="max-w-full shadow-2xl border border-neutral-800" />
                {!imageSrc && <p className="text-neutral-600">En attente d'image...</p>}
            </div>

            <div className="h-48 border-t border-neutral-700 bg-neutral-800 p-2 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-neutral-400">DÉTECTIONS ({elements.length})</span>
                    <button 
                        onClick={() => sendToGemini("Analyse cette UI et génère le code.", true)}
                        disabled={elements.length === 0}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1 transition"
                    >
                        <span>Transférer à Gemini</span>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {elements.map((el, i) => (
                        <div key={i} className="flex items-center gap-2 bg-neutral-700/50 p-1.5 rounded text-xs">
                            <div className="w-3 h-3 rounded-full border border-white/20" style={{backgroundColor: el.color}}></div>
                            <span className="font-mono text-neutral-400">{el.w}x{el.h}</span>
                            <span className="ml-auto font-mono text-[10px] text-neutral-500">{el.color}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* COLONNE 2 : CHAT GEMINI */}
        <div className="w-[35%] border-r border-neutral-700 flex flex-col bg-neutral-800">
            <div className="p-3 border-b border-neutral-700 font-bold text-sm bg-neutral-800 flex justify-between items-center">
                <span>2. AI Architect</span>
                {pendingFiles.length > 0 && (
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded animate-pulse">
                        {pendingFiles.length} fichiers extraits
                    </span>
                )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-900/50">
                {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[90%] rounded-lg p-3 text-sm whitespace-pre-wrap ${
                            msg.role === "user" ? "bg-blue-900 text-blue-100" : "bg-neutral-700 text-neutral-200 border border-neutral-600"
                        }`}>
                            {msg.role === "model" && <span className="text-[10px] text-orange-400 font-bold block mb-1 uppercase tracking-wider">Gemini 2.5 Flash</span>}
                            {msg.text}
                        </div>
                    </div>
                ))}
                {isLoadingAI && <div className="text-neutral-500 text-xs animate-pulse pl-2">Génération en cours...</div>}
                <div ref={chatEndRef} />
            </div>

            <div className="p-3 bg-neutral-800 border-t border-neutral-700">
                <div className="flex gap-2">
                    <textarea 
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                        placeholder="Instructions pour l'IA..."
                        className="w-full bg-neutral-900 border border-neutral-600 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none h-16"
                    />
                    <button 
                        onClick={() => sendToGemini()}
                        disabled={isLoadingAI || !apiKey}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded font-bold disabled:opacity-50 transition"
                    >
                        Envoyer
                    </button>
                </div>
            </div>
        </div>

        {/* COLONNE 3 : SANDBOX MANAGER */}
        <div className="w-[35%] flex flex-col bg-neutral-950">
             <div className="p-3 border-b border-neutral-800 flex justify-between items-center bg-neutral-900">
                <h2 className="font-bold text-sm text-green-400">3. Sandbox Manager</h2>
                <div className="text-xs font-mono text-neutral-500">ID: {sandboxId ? sandboxId.substring(0,8) : "Aucune"}</div>
            </div>

            {/* CONTROLS - BOUTONS SÉPARÉS */}
            <div className="grid grid-cols-5 gap-1 p-2 border-b border-neutral-800 bg-neutral-900">
                <button 
                    onClick={handleCreate}
                    className="bg-neutral-800 hover:bg-neutral-700 text-white p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition"
                >
                    <span>1. CREATE</span>
                </button>
                
                <button 
                    onClick={handleAddFiles}
                    disabled={pendingFiles.length === 0}
                    className="bg-neutral-800 hover:bg-neutral-700 text-blue-400 p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition disabled:opacity-30"
                >
                    <span>2. ADD FILES</span>
                    {pendingFiles.length > 0 && <span className="bg-blue-900 text-blue-100 px-1 rounded-full text-[8px]">{pendingFiles.length}</span>}
                </button>

                <button 
                    onClick={handleInstall}
                    className="bg-neutral-800 hover:bg-neutral-700 text-yellow-400 p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition"
                >
                    <span>3. INSTALL</span>
                </button>

                <button 
                    onClick={handleBuild}
                    className="bg-neutral-800 hover:bg-neutral-700 text-orange-400 p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition"
                >
                    <span>4. BUILD</span>
                </button>

                <button 
                    onClick={handleStart}
                    className="bg-neutral-800 hover:bg-neutral-700 text-green-400 p-2 rounded text-[10px] font-bold border border-neutral-700 flex flex-col items-center gap-1 transition"
                >
                    <span>5. START</span>
                </button>
            </div>

            {/* STATUS & LOGS */}
            <div className="p-2 bg-black text-[10px] font-mono text-green-500 border-b border-neutral-800 h-32 overflow-y-auto whitespace-pre-wrap">
                <div className="mb-2 font-bold text-white border-b border-neutral-800 pb-1">Status: {sandboxStatus}</div>
                {logs || "> En attente d'actions..."}
            </div>

            {/* PREVIEW IFRAME */}
            <div className="flex-1 bg-white relative">
                {sandboxUrl ? (
                    <iframe 
                        src={sandboxUrl} 
                        className="w-full h-full border-none"
                        title="App Preview"
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-neutral-400 text-sm bg-neutral-100 flex-col gap-2">
                        <svg className="w-10 h-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        <p>App Preview</p>
                    </div>
                )}
            </div>
        </div>

      </div>
    </div>
  );
                      }
