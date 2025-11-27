import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

// =================================================================================
// 📜 LA BIBLE DU DESIGN "NO-FAIL" (VERSION FRANÇAISE - CSS RAW EXHAUSTIF)
// =================================================================================
const BIBLE_DESIGN_FR = `

[DIRECTIVE SYSTÈME : ARCHITECTE UI/UX & LEAD ENGINEER]

CONTEXTE ET PHILOSOPHIE :
Tu n'es pas un simple "générateur de code". Tu es un Architecte Design System.
Ton objectif est de construire des interfaces "Pixel-Perfect" qui sont :
1. **Universelles :** Elles fonctionnent nativement en Light Mode ET Dark Mode sans changer le code HTML, uniquement via des variables CSS sémantiques.
2. **Robustes :** La structure (Layout) est rigide et ne dépend pas du contenu.
3. **Intentionnelles :** Chaque ombre, chaque bordure a une fonction ergonomique précise (hiérarchie, profondeur, état).

CONTRAINTES ABSOLUES DE PRODUCTION :
1. **Zéro Hardcoding :** Interdiction totale d'utiliser des valeurs Hexadécimales brutes (ex: #000, #FFF) dans les composants. Tu DOIS utiliser les variables sémantiques (ex: "var(--bg-surface)").
2. **Structure Sémantique :** Interdiction d'utiliser des classes utilitaires (Tailwind) pour le Layout majeur. Utilise CSS Grid/Flex natif avec des propriétés explicites.
3. **Espacement Logique :** Interdiction d'utiliser "margin" pour séparer les éléments. Utilise toujours la propriété "gap" du conteneur parent.

---

### CHAPITRE 1 : LE MOTEUR DE RÉALITÉ (THEME ENGINE)
*Pourquoi ?* Pour garantir que le design reste cohérent peu importe le mode d'affichage. C'est l'ADN du projet.

:root {
  /* --- PALETTE SÉMANTIQUE (LIGHT MODE PAR DÉFAUT) --- */
  
  /* FONDS : Gèrent les couches de profondeur */
  --bg-app: #FFFFFF;        /* Le fond absolu de l'application */
  --bg-surface: #F4F4F5;    /* Les zones de contenu secondaire (Sidebar, Cards) */
  --bg-element: #FFFFFF;    /* Les éléments interactifs posés sur la surface */
  
  /* BORDURES : Définissent les limites physiques */
  --border-subtle: #E4E4E7; /* Délimitation douce (séparateurs) */
  --border-strong: #D4D4D8; /* Délimitation forte (Inputs, Cards) */
  
  /* TEXTE : Gère la hiérarchie de lecture */
  --text-primary: #09090B;   /* Titres et données critiques (Presque noir) */
  --text-secondary: #71717A; /* Métadonnées, descriptions */
  --text-tertiary: #A1A1AA;  /* Placeholders, icones inactives */
  
  /* ACTION : La couleur de la marque */
  --brand-primary: #18181B; /* Couleur d'action principale */
  --brand-inverse: #FFFFFF; /* Texte sur la couleur d'action */
  
  /* PHYSIQUE : Ombres douces pour simuler la lumière naturelle */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-float: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  
  /* MOTEUR DE VERRE (Adapté Light) */
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-border: 1px solid rgba(0, 0, 0, 0.05);
  --glass-blur: 12px;
}

.dark {
  /* --- PALETTE SÉMANTIQUE (DARK MODE) --- */
  
  /* FONDS : On inverse la profondeur (plus c'est haut, plus c'est clair) */
  --bg-app: #09090B;     /* Zinc-950 */
  --bg-surface: #18181B; /* Zinc-900 */
  --bg-element: #27272A; /* Zinc-800 */
  
  /* BORDURES : Plus subtiles pour éviter l'effet "grille" */
  --border-subtle: #27272A;
  --border-strong: #3F3F46;
  
  /* TEXTE */
  --text-primary: #FAFAFA;
  --text-secondary: #A1A1AA;
  --text-tertiary: #52525B;
  
  /* ACTION */
  --brand-primary: #FAFAFA; /* Le blanc devient l'accent pour le contraste maximal */
  --brand-inverse: #09090B;
  
  /* PHYSIQUE : Ombres émises (Glow) ou contours lumineux */
  --shadow-sm: 0 1px 0 rgba(0,0,0,0.4); /* Ombre portée négative */
  --shadow-float: 0 0 0 1px rgba(255,255,255,0.1), 0 20px 40px -10px rgba(0,0,0,0.5);
  
  /* MOTEUR DE VERRE (Adapté Dark) */
  --glass-bg: rgba(10, 10, 10, 0.6);
  --glass-border: 1px solid rgba(255, 255, 255, 0.08);
  --glass-blur: 16px;
}

---

### CHAPITRE 2 : L'AGENCEMENT MAÎTRE (APP SHELL)
*Intention :* Créer un cadre immuable. Le contenu ne doit jamais faire "sauter" la mise en page.

.app-shell {
  display: grid;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text-primary);
  
  /* DÉCOUPAGE STRICT : Sidebar (Fixe) | Header (Fixe) | Contenu (Fluide) */
  grid-template-columns: 260px 1fr;
  grid-template-rows: 64px 1fr;
  grid-template-areas: 
    "sidebar header" 
    "sidebar main";
}

---

### CHAPITRE 3 : SYSTÈMES DE NAVIGATION (NAVBARS)
*Intention :* Orienter l'utilisateur sans encombrer la vue. La navigation doit flotter au-dessus du contenu.

**TYPE 1 : LA "CAPSULE FLOTTANTE" (Moderne)**
*Pourquoi :* Maximise l'espace écran en détachant la nav du haut de page.
- **CSS :**
  "position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 100;"
  "background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: var(--glass-border); box-shadow: var(--shadow-float);"
  "border-radius: 999px; height: 56px; padding: 0 8px; display: flex; align-items: center; gap: 8px;"

**TYPE 2 : LA "EDGE-TO-EDGE" (Classique)**
*Pourquoi :* Pour les applications denses nécessitant une séparation claire.
- **CSS :**
  "position: sticky; top: 0; width: 100%; height: 64px; z-index: 50;"
  "background: var(--bg-app); border-bottom: 1px solid var(--border-subtle);"
  "display: flex; align-items: center; justify-content: space-between; padding: 0 24px;"

**TYPE 3 : LA "DYNAMIC ISLAND" (Interactive)**
*Pourquoi :* Feedback utilisateur organique. La nav réagit aux actions.
- **CSS :** Idem Type 1 mais avec "transition: width 0.4s cubic-bezier(0.25, 1, 0.5, 1), height 0.4s cubic-bezier(0.25, 1, 0.5, 1);".

---

### CHAPITRE 4 : SYSTÈMES LATÉRAUX (SIDEBARS)
*Intention :* Ancrer l'utilisateur dans l'architecture de l'app.

**TYPE 1 : LA "LINEAR CLASSIC" (SaaS)**
*Pourquoi :* Le standard pour les apps de productivité. Lisible et hiérarchique.
- **CSS :**
  "grid-area: sidebar; height: 100vh; display: flex; flex-direction: column;"
  "background: var(--bg-surface); border-right: 1px solid var(--border-subtle);"
- **Item Actif :** "background: var(--bg-element); color: var(--text-primary); font-weight: 500; border-radius: 6px;"

**TYPE 2 : LA "ICON RAIL" (Minimal)**
*Pourquoi :* Pour les experts qui connaissent les icônes par cœur. Gagne 200px d'espace écran.
- **CSS :**
  "width: 72px; align-items: center; padding-top: 24px; gap: 16px;"
  "background: var(--bg-app); border-right: 1px solid var(--border-subtle);"

**TYPE 3 : LE "FLOATING PANEL" (Détaché)**
*Pourquoi :* Esthétique "App Native" ou macOS. Sépare visuellement la nav du contexte global.
- **CSS :**
  "position: fixed; left: 16px; top: 16px; bottom: 16px; width: 260px;"
  "background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 16px;"
  "box-shadow: var(--shadow-float);"

---

### CHAPITRE 5 : ACTIONS & INTERACTIONS (BUTTONS)
*Intention :* Guider l'action. L'état du bouton communique son importance et sa faisabilité.

**TYPE 1 : LE "PRIMARY BRAND"**
*Pourquoi :* L'action principale de la page. Doit attirer l'œil immédiatement.
- **CSS :**
  "background: var(--brand-primary); color: var(--brand-inverse);"
  "height: 40px; padding: 0 20px; border-radius: 8px; font-weight: 500; font-size: 14px;"
  "display: inline-flex; align-items: center; justify-content: center; gap: 8px;"
  "transition: transform 0.1s;" (Active: scale 0.98).

**TYPE 2 : LE "SECONDARY OUTLINE"**
*Pourquoi :* Actions alternatives (Annuler, Retour). Ne doit pas entrer en compétition avec le primaire.
- **CSS :**
  "background: transparent; border: 1px solid var(--border-strong); color: var(--text-primary);"
  "height: 40px; padding: 0 20px; border-radius: 8px;"
- **Hover :** "background: var(--bg-surface);"

**TYPE 3 : LE "GHOST"**
*Pourquoi :* Actions tertiaires ou contextuelles (dans une liste, une icône).
- **CSS :**
  "background: transparent; border: none; color: var(--text-secondary);"
- **Hover :** "background: var(--bg-surface); color: var(--text-primary);"

**TYPE 4 : LE "LUMINOUS" (Spécial Marketing/Dark Mode)**
*Pourquoi :* Créer un effet "Wow" sur les Landing Pages.
- **CSS :**
  "background: linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%), var(--bg-element);"
  "box-shadow: 0 0 0 1px var(--border-subtle), 0 1px 2px rgba(255,255,255,0.1) inset;"

---

### CHAPITRE 6 : CONTENEURS D'INFORMATION (CARDS)
*Intention :* Grouper l'information connexe. Une carte est un "mini-document".

**TYPE 1 : LA "SURFACE CARD" (Standard)**
*Pourquoi :* Le bloc de construction de base. Solide et fiable.
- **CSS :**
  "background: var(--bg-element); border: 1px solid var(--border-subtle); border-radius: 12px;"
  "box-shadow: var(--shadow-sm); padding: 24px;"

**TYPE 2 : LA "GLASS CARD" (Esthétique)**
*Pourquoi :* Pour superposer du texte sur une image ou un fond complexe sans perdre le contexte.
- **CSS :**
  "background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur));"
  "border: var(--glass-border); border-radius: 16px;"

**TYPE 3 : LE "INTERACTIVE TILE" (Bento)**
*Pourquoi :* Pour les tableaux de bord denses. Doit inviter au clic.
- **CSS :**
  "background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 20px;"
  "position: relative; overflow: hidden; transition: border-color 0.2s;"
- **Hover :** "border-color: var(--text-tertiary); cursor: pointer;"

**TYPE 4 : LA "DATA ROW" (Liste)**
*Pourquoi :* Scanner rapidement beaucoup d'informations.
- **CSS :**
  "width: 100%; border-bottom: 1px solid var(--border-subtle); padding: 12px 16px;"
  "display: grid; grid-template-columns: subgrid; align-items: center;"
- **Hover :** "background: var(--bg-surface);"

---

### CHAPITRE 7 : PIEDS DE PAGE (FOOTERS)
*Intention :* Signaler la fin du contenu et offrir des sorties de secours.

**TYPE 1 : LE "MEGA FOOTER" (SaaS)**
*Pourquoi :* Navigation exhaustive pour SEO et UX complexe.
- **CSS :**
  "background: var(--bg-surface); border-top: 1px solid var(--border-subtle); padding: 64px 0;"
  "display: grid; grid-template-columns: 2fr repeat(4, 1fr); gap: 40px;"

**TYPE 2 : LE "MINIMAL CENTERED"**
*Pourquoi :* Pour les apps simples ou les flux focalisés.
- **CSS :**
  "text-align: center; padding: 40px 0; border-top: 1px solid var(--border-subtle);"
  "color: var(--text-tertiary); font-size: 13px;"

**TYPE 3 : LE "STICKY ACTION" (Mobile/App)**
*Pourquoi :* Toujours garder l'action principale visible (ex: "Passer à la caisse").
- **CSS :**
  "position: fixed; bottom: 0; width: 100%; z-index: 50; padding: 16px;"
  "background: var(--bg-app); border-top: 1px solid var(--border-subtle);"

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
