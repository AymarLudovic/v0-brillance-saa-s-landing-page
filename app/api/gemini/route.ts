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
  - **Interdiction de Bordures:** Il faut éviter de séparer les sections (ex: Menu principal vs Management de profil) avec des \`border-top\` ou \`border-bottom\`.
  - **Espacement:** Utiliser uniquement le vide (padding/margin) pour séparer les groupes. Même si les éléments sont espacés, ne jamais rajouter une ligne de séparation visible.
- **Structure Interne:**
  - Les éléments doivent être bien groupés logiquement.
  - La section "Profil/User" ne doit pas être isolée par une ligne, mais simplement positionnée (souvent en bas) avec de l'espace.

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
  - **Sans Bordures:** Cette Topbar ne doit **absolument pas avoir de bordures**, donc aucun \`border-bottom\`. Elle doit se fondre dans le header.
- **Dimensions & Contraintes:**
  - **Hauteur Maximale:** La \`height\` du conteneur Topbar ne doit pas dépasser **30px**. C'est "fixé comme ça, pas trop grand".
  - **Boutons & Éléments internes:** Tous les boutons ou inputs dans cette barre doivent avoir une taille (height) de **30px à 32px**.
- Les éléments internes doivent rester bien structurés et alignés, même lors du redimensionnement. surtout ils même si c'est du texte doit être responsive pour des tailles d'écran allant à maximum 750px. Tu dois faire que ce soit bien responsive sans avoir des éléments qui sortent et casse le composant.

**E. RESPONSIVE & QUALITÉ**
- L'IA doit structurer le code pour que la Sidebar puisse disparaître proprement ou devenir un "Drawer" sur mobile, sans casser la logique de couleur (#000/#FFF).
- Les éléments internes doivent rester bien structurés et alignés, même lors du redimensionnement.
- Les éléments internes doivent rester bien structurés et alignés, même lors du redimensionnement. surtout ils même si c'est du texte doit être responsive pour des tailles d'écran allant à maximum 750px. Tu dois faire que ce soit bien responsive sans avoir des éléments qui sortent et casse le composant.



  

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
  tools: [{ functionDeclarations: [readFileDeclaration] }],
  config: { systemInstruction: finalSystemInstruction }
})

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
