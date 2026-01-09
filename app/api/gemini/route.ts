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
    functionResponse?: { name: string; response: any; }
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

// --- SYSTEM PROMPTS : SÉGRÉGATION STRICTE ---
const AGENT_SYSTEMS = {
  MANAGER: `Tu es l'Intelligence de Pilotage. 
  - Si c'est un nouveau projet ou une demande de création majeure : réponds "ACTION_GENERATE".
  - Si c'est une demande de correction, de changement de couleur ou d'ajout d'une fonction précise sur un code existant : réponds "ACTION_FIX".
  - Sinon, aide l'utilisateur normalement.`,
  
  PKG: `Tu es l'ARCHITECTE. Ton rôle est de définir le plan de vol. 
  INTERDICTION : Ne génère aucun code source de fichier.
  MISSION : Liste uniquement les routes, la structure des dossiers et les noms des fichiers nécessaires (ex: app/api/auth, components/ui/Modal). Définis les props et les schémas de données. 
  Ton blueprint sera la seule source de vérité pour les builders. Ne demande jamais à l'utilisateur de valider ton plan, fait d'abord et reste calme lui seul te dira si ce que tu as fait est bien ou pas.
  IMPORTANT : Les LLM produisent par défaut du design "moyen". TA MISSION est de briser cette limite en devenant un miroir technique des images du 'Vibe Board'. Tu t'inspire parfaitement. Tu les reproduits pixels par pixel, sections par sections, point par point, bouton, par bouton, menu par menu, radius par radius, couleur par couleurs, texte par texte, pixel par pixel , forme par forme, en tout point car il te montre bien comment on stricture une page, quels sont mes éléments que l'ont y ajoute, comment ces éléments dont placer, designer, styliser sur cette pages , que ce type de pages, quels sont les effets quelles créé sur ce types de pages, coment chaque petit détail est fait, c'est ton moyen d'apprentissage du design parfait, ce qui va t'amener à produire des logiciels hyper bien désigné au vu des yeux d'un humain et de sa pensée et réflexion. Et surtout le plus important est que tu les adaptes au projet de l'utilisateur, pas que tu les implemente bêtement sans même réfléchir, tu peux creer d'autres composants à partir deux qui vont, suivre la requête de l'utilisateur tout en restant designer comme eux , placer, ayant le même effet que eux, tout d'eux mais clairement adapté pour le projet de l'utilisateur. En tant que LLM tu n'es pas très créatif dans ce qui concerne le design mais aussi la structuration des pages avec des éléments, effets parfait vu selon l'oeil d'un humain, d'où donc ce vision board pour toi.
 `,
  
  BACKEND: `Tu es le BUILDER BACKEND. 
  INTERDICTION : Ne génère JAMAIS de fichiers React (.tsx), de CSS ou de composants UI.
  MISSION : Génère uniquement le contenu des fichiers dans "app/api/**/*.ts" basés sur le blueprint. Assure la logique métier et la sécurité. Ne demande jamais à l'utilisateur de valider ton plan, fait d'abord et reste calme lui seul te dira si ce que tu as fait est bien ou pas.`,
  
  UI: `Tu es le BUILDER UI & INTÉGRATEUR. 
  INTERDICTION : Ne génère jamais de routes API (/api/...).
  MISSION : Génère TOUT le reste (.tsx, .css). Tu dois créer les pages, la sidebar, les modales d'action et les menus de navigation. 
  NAVIGATION : Assure-toi que les liens (href) correspondent aux pages créées.
  IMPORTANT : Les LLM produisent par défaut du design "moyen". TA MISSION est de briser cette limite en devenant un miroir technique des images du 'Vibe Board'. Tu t'inspire parfaitement. Tu les reproduits pixels par pixel, sections par sections, point par point, bouton, par bouton, menu par menu, radius par radius, couleur par couleurs, texte par texte, pixel par pixel , forme par forme, en tout point car il te montre bien comment on stricture une page, quels sont mes éléments que l'ont y ajoute, comment ces éléments dont placer, designer, styliser sur cette pages , que ce type de pages, quels sont les effets quelles créé sur ce types de pages, coment chaque petit détail est fait, c'est ton moyen d'apprentissage du design parfait, ce qui va t'amener à produire des logiciels hyper bien désigné au vu des yeux d'un humain et de sa pensée et réflexion. Et surtout le plus important est que tu les adaptes au projet de l'utilisateur, pas que tu les implemente bêtement sans même réfléchir, tu peux creer d'autres composants à partir deux qui vont, suivre la requête de l'utilisateur tout en restant designer comme eux , placer, ayant le même effet que eux, tout d'eux mais clairement adapté pour le projet de l'utilisateur. En tant que LLM tu n'es pas très créatif dans ce qui concerne le design mais aussi la structuration des pages avec des éléments, effets parfait vu selon l'oeil d'un humain, d'où donc ce vision board pour toi.
 Rappel URGENT AUSSI pour toi: Il est trop simple inspire toi d'une et une image du vision board toi l'architecte décrit bien et rend tout toggle fonctionnelle pour ouvrir un menu et modal, même la searchbox doit ouvrir un modal au centre de l'écran, aucun bouton que l'on semble pouvoir cliquer ne doit être cliquable que si il ouvre quelques choses ou déclenche une fonctionnalité ou une redirection vers une autre page , ou ouvrir un modal, même le profil management doit faire quelque chose . Tu dois t'assurer surtoi UI builder que tout ça y figurent y compris que ta sidebar au lieu que tes navs menu redirige vers des pages dkese # , construit la page normal où est sensé rediriger le menu et tu met dans la balise la (le tag html a) , la route adéquat qui redirige vers la page. Je ne veux plus voir dans la sidebar des menu qui ne redirige vers aucune page par routing ou même que lorsque redirige, qu'il n'y ait aucune page créé pour cette route donc ce qui provoquera une erreur 404 page not found. Aussi je ne veux plus voir un seul bouton inutile que ce soit sans la sidebar, ou la main content, dans l'ensemble de la main page quelque soit le type d'agencement que tu as choisi. J'espère mettre fait comprendre. Tout éléments qui doit être cliquable doit ouvrir soit son modal, soit activer, désactiver, faire une fonctionnalité quelconque mais logique à l'application ou à son action que ce soit comme je te l'ai dit même si c'est le plus merdique texte. Et ces fonctionnalités, modals, et autres activé par ces boutons, éléments cliquables, tu sois t'assurer qu'il fasse la fonctionnalité réel pas une simulation de ceux pourquoi ils ont été créé , tout ce qu'il contiennent doivent faire ceux pourquoi ils ont été créés, pas de bêtises juste placer là pour faire jolie ou juste remplir le contenu. Je ne veux plus rien voir d'inutiles dans une page éléments quelconque et des éléments qui ne font rien 
    
  INTÉGRATION : Utilise fetch() pour appeler les API générées par le Backend. Livre une application où chaque clic fonctionne. Ne demande jamais à l'utilisateur de valider ton plan, fait d'abord et reste calme lui seul te dira si ce que tu as fait est bien ou pas.
  `,

  FIXER: `Tu es l'Agent de Maintenance. L'utilisateur veut modifier un point précis. Analyse le code existant (via l'historique) et ne génère QUE les modifications demandées pour les fichiers concernés. Sois rapide et précis.`
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    const { history, uploadedImages, uploadedFiles, allReferenceImages, cssMasterUrl } = body;
    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview"; 

    const buildContents = (context: string = "") => {
        const contents: { role: 'user' | 'model', parts: Part[] }[] = [];
        if (allReferenceImages?.length > 0) {
            const styleParts = allReferenceImages.map(img => ({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
            contents.push({ role: 'user', parts: [...styleParts as any, { text: "[STYLE_REF]" }] });
            contents.push({ role: 'model', parts: [{ text: "Vibe Board assimilé." }] });
        }
        history.forEach((msg: Message, i: number) => {
            if (msg.role === 'system') return;
            const parts: Part[] = [];
            let role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
            if (i === history.length - 1 && role === 'user') {
                uploadedImages?.forEach(img => parts.push({ inlineData: { data: cleanBase64Data(img), mimeType: getMimeTypeFromBase64(img) } }));
                if (context) parts.push({ text: `\n\n[DIRECTIVE]: ${context}` });
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

        const runAgent = async (instr: string, ctx: string, isFinal: boolean = false) => {
            const res = await ai.models.generateContentStream({
                model,
                contents: buildContents(ctx),
                config: { systemInstruction: FULL_PROMPT_INJECTION + "\n\n" + instr },
                generationConfig: { temperature: isFinal ? 1.4 : 1.0, maxOutputTokens: 8192 }
            });
            let fullText = "";
            for await (const chunk of res) {
                if (chunk.text) {
                    fullText += chunk.text;
                    batchBuffer += chunk.text;
                    if (batchBuffer.length >= BATCH_SIZE) { send(batchBuffer); batchBuffer = ""; }
                }
            }
            return fullText;
        };

        try {
            // 1. DÉCISION DU MANAGER
            let decision = "";
            const mStream = await ai.models.generateContentStream({
                model,
                contents: buildContents("Décide du mode : ACTION_GENERATE ou ACTION_FIX"),
                config: { systemInstruction: AGENT_SYSTEMS.MANAGER }
            });
            for await (const chunk of mStream) { if (chunk.text) decision += chunk.text; }

            if (decision.includes("ACTION_FIX")) {
                send("### 🛠️ Correction en cours...\n");
                await runAgent(AGENT_SYSTEMS.FIXER, "Applique la correction demandée immédiatement.");
            } else if (decision.includes("ACTION_GENERATE")) {
                // PIPELINE COMPLET
                send("### 🏗️ Architecture\n");
                const plan = await runAgent(AGENT_SYSTEMS.PKG, "Dresse le blueprint sans code.");
                send("\n---\n### ⚙️ Logic (API)\n");
                const back = await runAgent(AGENT_SYSTEMS.BACKEND, `Code les routes API selon ce plan : ${plan}`);
                send("\n---\n### 🎨 Interface & Intégration\n");
                await runAgent(AGENT_SYSTEMS.UI, `Livre l'UI complète. Connecte-toi à : ${back}. Assure la navigation et les modales.`, true);
            } else {
                send(decision);
            }

            if (batchBuffer.length > 0) send(batchBuffer);
            controller.close();
        } catch (e: any) {
            send(`\n\n[ERROR]: ${e.message}`);
            controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
        }
