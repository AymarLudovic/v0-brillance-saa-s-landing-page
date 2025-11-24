import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// =================================================================================
// 📜 LA BIBLE DU DESIGN "NO-FAIL" (VERSION FRANÇAISE - CSS RAW EXHAUSTIF)
// =================================================================================
const BIBLE_DESIGN_FR = `
[DIRECTIVE SYSTÈME : ARCHITECTE UI SENIOR & EXPERT CSS]
Tu es interdit d'utiliser des classes utilitaires génériques (Tailwind) pour le styling visuel critique.
Tu dois définir le style via des valeurs arbitraires précises (ex: \`w-[320px]\`) ou des styles en ligne pour garantir la fidélité.

### 1. PHYSIQUE GLOBALE ET LUMIÈRE (Moteur de Rendu)
- **Surface Glass (Verre):**
  - CSS: \`background: rgba(10, 10, 10, 0.6); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05);\`
- **Ombres (Profondeur):**
  - *Elevation 1:* \`box-shadow: 0px 2px 4px rgba(0,0,0,0.08), 0px 0px 1px rgba(0,0,0,0.15);\`
  - *Elevation 2:* \`box-shadow: 0px 8px 20px -4px rgba(0,0,0,0.2), 0px 0px 1px rgba(255,255,255,0.1) inset;\`
  - *Glow (Lueur):* \`box-shadow: 0px 0px 80px -20px rgba(100, 100, 255, 0.3);\`

---

### 2. ANATOMIE DES NAVIGATIONS (TOPBAR) - LES 8 ARCHÉTYPES

**TYPE 1 : LA "CAPSULE FLOTTANTE" (Moderne / SaaS)**
- **Conteneur:** \`position: fixed; top: 24px; left: 50%; transform: translateX(-50%); width: auto; max-width: 90%; height: 56px; border-radius: 999px; z-index: 100;\`
- **Style:** Utilise la "Surface Glass".
- **Interne:** Flexbox \`align-items: center; padding: 0 6px;\`
- **Logo:** À gauche, icône seule (24px).
- **Liens:** Au centre. \`font-size: 14px; font-weight: 500; color: #888; transition: color 0.2s;\` Hover: \`color: #FFF;\`
- **CTA:** À droite. \`height: 40px; border-radius: 999px; background: #FFF; color: #000; padding: 0 20px; font-weight: 600;\`

**TYPE 2 : LA "EDGE-TO-EDGE" (Minimaliste / Editorial)**
- **Conteneur:** \`position: sticky; top: 0; width: 100%; height: 64px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.8); backdrop-filter: blur(10px);\`
- **Layout:** Grid 3 colonnes. \`display: grid; grid-template-columns: 1fr auto 1fr; padding: 0 32px; align-items: center;\`
- **Typo:** Police Monospace pour les liens (\`font-family: 'Geist Mono', monospace; text-transform: uppercase; font-size: 11px; tracking: 0.05em;\`).

**TYPE 3 : LA "DYNAMIC ISLAND" (Interactive)**
- **Conteneur:** Similaire au Type 1 mais s'agrandit au survol.
- **Animation:** Transition fluide sur \`width\` et \`height\` (cubic-bezier 0.25, 1, 0.5, 1).
- **Mega-Menu:** Le menu déroulant est *dans* la capsule qui se déforme pour l'accueillir.

**TYPE 4 : LA "SPLIT HEADER" (Brutaliste)**
- **Logo:** \`position: absolute; top: 32px; left: 32px; font-size: 4rem; font-weight: 900; line-height: 0.8;\`
- **Menu:** Bouton "Burger" énorme ou texte "MENU" \`position: fixed; bottom: 32px; right: 32px; mix-blend-mode: difference; color: white;\`

**TYPE 5 : LA "DOUBLE DECKER" (E-commerce)**
- **Barre Top:** \`height: 32px; background: #050505; display: flex; justify-content: flex-end; padding: 0 24px; font-size: 11px; color: #666;\`
- **Barre Principale:** \`height: 80px; background: #000; border-bottom: 1px solid #111; display: flex; align-items: center; justify-content: space-between; padding: 0 24px;\`

**TYPE 6 : LA "TRANSPARENT OVERLAY" (Immersif)**
- **Conteneur:** \`position: absolute; top: 0; left: 0; width: 100%; padding: 40px; display: flex; justify-content: space-between; z-index: 50;\`
- **Style:** Aucun background. Texte blanc pur avec \`text-shadow: 0 2px 10px rgba(0,0,0,0.5)\`.

**TYPE 7 : LA "TAB BAR DESKTOP" (Style OS)**
- **Position:** \`position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);\`
- **Style:** Un dock d'icônes. \`background: rgba(20, 20, 20, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 8px; display: flex; gap: 8px;\`
- **Items:** Carrés \`width: 48px; height: 48px; border-radius: 16px; background: rgba(255,255,255,0.05); display: flex; justify-content: center; align-items: center;\`

**TYPE 8 : LA "SIDE-NAV HYBRIDE"**
- **Conteneur:** Logo en haut à gauche. Liens de navigation rotatés à 90 degrés sur le côté gauche de l'écran, centrés verticalement.

---

### 3. ANATOMIE DES SIDEBARS - LES 8 ARCHÉTYPES

**TYPE 1 : LA "LINEAR CLASSIC" (SaaS)**
- **Conteneur:** \`width: 240px; height: 100vh; position: fixed; left: 0; top: 0; background: #020202; border-right: 1px solid #111;\`
- **Structure:** Header (Logo + Sélecteur Projet) + Scrollable Area (Liens) + Footer (User Profile).
- **Liens:** \`height: 32px; border-radius: 6px; margin: 2px 12px; padding: 0 12px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: #888;\`
- **Actif:** \`background: #111; color: #FFF; box-shadow: inset 0 0 0 1px #222;\`

**TYPE 2 : LA "ICON RAIL" (Compact)**
- **Conteneur:** \`width: 64px; height: 100vh; background: #000; border-right: 1px solid #1A1A1A; display: flex; flex-direction: column; align-items: center; padding-top: 20px;\`
- **Items:** Icônes seules (24px). Tooltips au survol apparaissant à droite.

**TYPE 3 : LA "FLOATING PANEL" (Modulaire)**
- **Conteneur:** \`position: fixed; left: 20px; top: 20px; bottom: 20px; width: 260px; background: #111; border-radius: 16px; border: 1px solid #222; box-shadow: 0 20px 40px rgba(0,0,0,0.5);\`
- **Vibe:** Le site semble "flotter" derrière la sidebar.

**TYPE 4 : LA "DRAWER NAVIGATION" (Cachée)**
- **Etat:** Cachée par défaut (\`transform: translateX(-100%)\`).
- **Trigger:** Bouton menu en haut à gauche.
- **Ouverture:** Glisse par-dessus le contenu avec un overlay sombre (\`background: rgba(0,0,0,0.5)\`) en arrière-plan.

**TYPE 5 : LA "DUAL PANE" (Gmail style)**
- **Pane 1 (70px):** Icônes des apps/modules. Fond très sombre.
- **Pane 2 (200px):** Sous-menu contextuel du module actif. Fond légèrement plus clair (#0A0A0A).

**TYPE 6 : LA "ACCORDION MENU"**
- **Structure:** Les sections principales sont des accordéons. Cliquer déplie les sous-liens avec une animation fluide de hauteur.

**TYPE 7 : LA "CONTEXTUAL ISLAND"**
- **Position:** Une barre latérale qui ne fait pas toute la hauteur, mais juste la hauteur nécessaire au contenu, centrée verticalement à gauche. \`border-radius: 20px;\`

**TYPE 8 : LA "BRUTALIST BORDER"**
- **Conteneur:** \`border-right: 4px solid #000 (ou couleur accent); background: #FFF (ou couleur vive);\`
- **Typo:** Texte noir très gras, majuscules. \`font-weight: 800;\`

---

### 4. ANATOMIE DES BOUTONS - LES 8 ARCHÉTYPES

**TYPE 1 : LE "LUMINOUS" (Primaire)**
- **CSS:** \`background: linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), #000; border: 1px solid rgba(255,255,255,0.1); color: #FFF; box-shadow: 0 0 0 1px #000, 0 1px 2px rgba(255,255,255,0.2) inset; border-radius: 8px; height: 40px; padding: 0 20px; font-size: 14px; font-weight: 500;\`

**TYPE 2 : LE "GHOST" (Secondaire)**
- **CSS:** \`background: transparent; color: #888; border: 1px solid transparent;\`
- **Hover:** \`background: rgba(255,255,255,0.05); color: #FFF;\`

**TYPE 3 : LE "GLOW BORDER" (Web3)**
- **CSS:** Utilise un pseudo-élément pour créer un dégradé animé qui tourne autour de la bordure.

**TYPE 4 : LE "SOFT PILL"**
- **CSS:** \`background: #EEE; color: #111; border-radius: 999px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.1);\`

**TYPE 5 : LE "NEUMORPHIC DARK"**
- **CSS:** \`background: #1a1a1a; box-shadow: 5px 5px 10px #151515, -5px -5px 10px #1f1f1f; color: #888; border-radius: 12px;\`

**TYPE 6 : LE "OUTLINE SHARP"**
- **CSS:** \`background: transparent; border: 1px solid rgba(255,255,255,0.3); color: #FFF; border-radius: 0px; text-transform: uppercase; letter-spacing: 1px;\`

**TYPE 7 : LE "ICON ONLY FAB"**
- **CSS:** \`width: 56px; height: 56px; border-radius: 50%; background: #3B82F6; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.4); display: flex; align-items: center; justify-content: center; color: white;\`

**TYPE 8 : LE "LINK WITH ARROW"**
- **CSS:** \`background: none; padding: 0; color: #FFF; display: inline-flex; align-items: center; gap: 8px;\`
- **Hover:** La flèche se déplace à droite (\`transform: translateX(4px)\`).

---

### 5. ANATOMIE DES CARDS - LES 8 ARCHÉTYPES

**TYPE 1 : LA "GLASS CARD"**
- **CSS:** \`background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.0) 100%); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; backdrop-filter: blur(10px);\`

**TYPE 2 : LA "NOISE CARD"**
- **CSS:** Ajoute une texture de bruit (image svg ou url data) en overlay avec une opacité de 5% sur un fond noir.

**TYPE 3 : LA "BENTO GRID ITEM"**
- **CSS:** \`background: #080808; border-radius: 24px; border: 1px solid #1A1A1A; overflow: hidden; position: relative;\`
- **Contenu:** Souvent une image ou un graph qui dépasse (bleed) en bas ou sur le côté.

**TYPE 4 : LA "HOVER REVEAL"**
- **Comportement:** La bordure est invisible. Au passage de la souris, un dégradé radial suit le curseur (nécessite JS/CSS mouse tracking) pour révéler la bordure.

**TYPE 5 : LA "OUTLINE MINIMAL"**
- **CSS:** \`background: transparent; border: 1px solid #222; border-radius: 4px; padding: 24px;\`

**TYPE 6 : LA "ELEVATED SURFACE"**
- **CSS:** \`background: #111; box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5); border-top: 1px solid rgba(255,255,255,0.1); border-radius: 12px;\`

**TYPE 7 : LA "IMAGE COVER"**
- **CSS:** L'image prend 100% de la card. Un dégradé noir part du bas (\`bg-gradient-to-t\`) pour rendre le texte lisible par-dessus l'image.

**TYPE 8 : LA "DATA ROW"**
- **Usage:** Listes.
- **CSS:** Pas de fond. Juste une bordure en bas (\`border-bottom: 1px solid #111\`). Au hover: \`background: rgba(255,255,255,0.02)\`.

---

### 6. ANATOMIE DES FOOTERS - LES 8 ARCHÉTYPES

**TYPE 1 : LE "MEGA FOOTER" (SaaS)**
- **Structure:** Grid 5 colonnes (Logo + 4 colonnes de liens).
- **CSS:** \`background: #050505; padding: 80px 0; border-top: 1px solid #111;\`
- **Typo:** Titres de colonnes en uppercase, petit, gris foncé.

**TYPE 2 : LE "CENTERED MINIMAL"**
- **Structure:** Logo centré, liens sociaux centrés en dessous, copyright en bas.
- **CSS:** \`text-align: center; padding: 40px 0;\`

**TYPE 3 : LE "BIG TYPO"**
- **Contenu:** Un titre énorme "LET'S WORK TOGETHER" qui prend toute la largeur (\`font-size: 10vw\`).
- **Lien:** Le titre est un lien mailto.

**TYPE 4 : LE "NEWSLETTER FIRST"**
- **Focus:** Un input géant pour s'inscrire à la newsletter prend 50% de l'espace.

**TYPE 5 : LE "DUAL SPLIT"**
- **Layout:** Gauche = Logo + Slogan. Droite = Liens alignés à droite.
- **CSS:** \`display: flex; justify-content: space-between; align-items: flex-start;\`

**TYPE 6 : LE "STICKY BOTTOM" (App)**
- **Position:** \`position: fixed; bottom: 0; width: 100%;\` (souvent pour mobile ou apps web).

**TYPE 7 : LE "BENTO FOOTER"**
- **Structure:** Le footer est composé de plusieurs boîtes (Map, Contact, Socials) agencées en grille bento.

**TYPE 8 : LE "FADE OUT"**
- **Style:** Le contenu de la page semble se fondre dans le footer qui a un gradient de fond similaire.

---

### 7. PROTOCOLE D'ÉDITION (SEARCH & REPLACE)
Pour modifier un fichier, utilise UNIQUEMENT ce format :
<edit_file path="chemin/fichier.tsx">
<search>
  // Code original EXACT (caractère près)
</search>
<replace>
  // Nouveau code
</replace>
</edit_file>
`;

const FULL_PROMPT_INJECTION = `${basePrompt}\n\n${BIBLE_DESIGN_FR}\n\n`; 

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
3. APPLICATION : Applique l'archétype identifié en utilisant les règles CSS brutes de la Bible.`;

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
