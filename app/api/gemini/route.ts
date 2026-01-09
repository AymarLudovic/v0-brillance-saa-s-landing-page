import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"

const FULL_PROMPT_INJECTION = `${basePrompt}`; 
const BATCH_SIZE = 256; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
    images?: string[]; 
    externalFiles?: { fileName: string; base64Content: string }[]; 
    mentionedFiles?: string[]; 
}

// --- UTILITAIRES ---
function getMimeTypeFromBase64(dataUrl: string): string {
    const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.=]+);base64,/);
    return match ? match[1] : 'application/octet-stream';
}

function cleanBase64Data(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
}

const readFileDeclaration: FunctionDeclaration = {
  name: "readFile",
  description: "Lit le contenu d'un fichier du projet.",
  parameters: {
    type: Type.OBJECT,
    properties: { path: { type: Type.STRING } },
    required: ["path"],
  }
}

// --- LE SUPER PROMPT UNIQUE (MONO-AGENT) ---
// Contient TOUTE la logique : Architecture, Backend, UI, Correction, et les Règles Techniques.
const ONE_AGENT_SYSTEM = `
IDENTITY: Tu es l'IA DÉVELOPPEUR SUPRÊME (The One Mind). Tu es à la fois l'Architecte, le Backend Lead et le Senior UI Designer.
MISSION: Tu reçois une demande et un contexte (images, historique). Tu dois produire DIRECTEMENT le résultat final (Code). Pas de blabla, pas de phases, pas d'attente.

REGLES DE COMPORTEMENT :
1. ANALYSE INSTANTANÉE : Détermine si c'est une création (Génère tout : api + ui) ou une correction (Génère juste les fichiers modifiés).
2. OUTPUT STREAM : Tu commences directement par la structure si nécessaire, puis tu enchaînes sur les fichiers. 
   - Backend (app/api/...)
   - UI (components/..., app/page.tsx...)
3. AUTONOMIE TOTALE : Ne demande rien. Décide. Code.

RÈGLES TECHNIQUES CRITIQUES (ZÉRO ERREUR) :
- NEXT.JS 15 : Pour les routes dynamiques (ex: [id]/route.ts), 'params' est une Promise. UTILISE : 'const { id } = await params'.
- CLIENT COMPONENTS : Si tu utilises 'useState', 'useEffect', 'onClick', 'usePathname' -> AJOUTE "use client" EN HAUT DU FICHIER.
- IMPORTS : Ne jamais importer { Icone } si tu ne l'as pas créée/exportée. Vérifie tes chemins (../../).
- LIENS MORTS : Interdiction de mettre des href="#" dans la sidebar. Si tu mets un lien, tu CRÉES la page correspondante (ex: app/settings/page.tsx).
- BOUTONS INUTILES : Tout bouton visible doit avoir une fonction (Ouvrir Modal, Fetch, Naviguer). Pas de déco.

OBSESSION DU DESIGN (VIBE BOARD) :
Les LLM font du design moyen. TOI, tu es un MIROIR TECHNIQUE.
Scanne les images fournies. Reproduis Pixel-Perfect :
- Les radius exacts, les ombres (effets 3D subtils), les couleurs (pas de gris par défaut).
- La structure : Sidebar, Topbar, Main Content Cards.
- L'interaction : Modales au centre, Toggles fonctionnels.
Si l'image montre une SearchBox, elle doit fonctionner (Modal ou filtre). Si l'image montre un profil, le clic doit ouvrir un menu.

FORMAT DE SORTIE :
Tu peux écrire un bref plan d'action (3 lignes max) pour structurer ta pensée, puis tu balances les blocs de code avec le chemin du fichier en titre ou en commentaire.
`;

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages } = body;
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    // --- CONSTRUCTION DU CONTEXTE UNIQUE ---
    const buildContents = () => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        
        // 1. Injection du Vibe Board (Style de référence)
        if (allReferenceImages?.length > 0) {
            const styleParts = allReferenceImages.map(img => ({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "[SYSTEME VISUEL : VIBE BOARD - REFERENCE ABSOLUE POUR LE DESIGN]" }] });
            contents.push({ role: 'model', parts: [{ text: "Bien reçu. Je reproduirai ce style au pixel près." }] });
        }

        // 2. Historique de conversation
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            
            // Si c'est le dernier message utilisateur, on attache les images/fichiers contextuels
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                uploadedFiles?.forEach(f => parts.push({ inlineData: { data: f.base64Content, mimeType: 'text/plain' }, text: `\n[Fichier existant: ${f.fileName}]` } as any));
                parts.push({ text: "\n[INSTRUCTION]: Agis en tant que l'Agent Unique. Si c'est une modif, corrige juste les fichiers. Si c'est une création, génère TOUT (Backend API + UI complète)." });
            }
            parts.push({ text: msg.content || ' ' });
            contents.push({ role, parts });
        });
        return contents;
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => controller.enqueue(encoder.encode(txt));
        let batchBuffer = "";

        try {
            // --- EXÉCUTION UNIQUE (ONE SHOT) ---
            const response = await ai.models.generateContentStream({
                model,
                contents: buildContents(),
                tools: [{ functionDeclarations: [readFileDeclaration] }], // Outil de lecture si besoin de contexte
                config: { 
                    // Injection massive du prompt unique
                    systemInstruction: FULL_PROMPT_INJECTION
                },
                generationConfig: { 
                    temperature: 1.2, // Créatif mais précis
                    topP: 0.95, 
                    maxOutputTokens: 8192 
                }
            });

            for await (const chunk of response) {
                if (chunk.text) {
                    const txt = chunk.text;
                    batchBuffer += txt;
                    // Bufferisation pour éviter de spammer le contrôleur
                    if (batchBuffer.length >= BATCH_SIZE) {
                        send(batchBuffer);
                        batchBuffer = "";
                    }
                }
            }

            // Envoi du reste
            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();

        } catch (e: any) {
            send(`\n\n[SYSTEM ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });

  } catch (err: any) {
    return NextResponse.json({ error: "Gemini Error: " + err.message }, { status: 500 });
  }
        }
