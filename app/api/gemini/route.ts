import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"
// @ts-ignore
import packageJson from 'package-json';

const STACK_INFO = "STACK: Next.js (App Router), React, TypeScript. INTERDICTION de Tailwind CSS. Utilise uniquement du CSS NATIF (.css).";

const FULL_PROMPT_INJECTION = `
 DIRECTIVE ABSOLUE —  NO-FAIL
 ${STACK_INFO}
 
 ARCHITECTURE :
 
 SORTIE OBLIGATOIRE — FORMAT STRICT XML :
 <create_file path="app/page.tsx">
 CODE TSX COMPLET
 </create_file>
 
 <create_file path="app/globals.css">
 CSS COMPLET
 </create_file>

 pas de tailwind CSS et pas de chemin de fichier commençant par src/

 INTERDICTION TOTALE : Markdown, explications, commentaires hors code, et texte de politesse. Produis UNIQUEMENT le XML.
`; 

interface Message { 
    role: "user" | "assistant" | "system"; 
    content: string; 
}

// Utilitaire pour récupérer la version exacte via package-json
async function getPackageVersion(pkgName: string): Promise<string> {
    try {
        const metadata = await packageJson(pkgName.toLowerCase());
        return `^${metadata.version}`;
    } catch (e) {
        return "latest";
    }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    // Récupération de l'historique et des médias uploadés
    const { history, uploadedFiles, uploadedImages } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const lastUserPrompt = history[history.length - 1].content;
    const conversationContext = history.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    // Conversion des médias en format Base64 compatible Gemini (Parts)
    const mediaParts: Part[] = [];
    
    if (uploadedFiles && Array.isArray(uploadedFiles)) {
        uploadedFiles.forEach((file: any) => {
            if (file.data && file.mimeType) {
                mediaParts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
            }
        });
    }

    if (uploadedImages && Array.isArray(uploadedImages)) {
        uploadedImages.forEach((img: any) => {
            if (img.data && img.mimeType) {
                mediaParts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
            }
        });
    }

    const encoder = new TextEncoder();
    const createdFiles = new Set<string>();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (txt: string) => {
            const match = txt.match(/<create_file path="([^"]+)">/);
            if (match && createdFiles.has(match[1])) return; 
            if (match) createdFiles.add(match[1]);
            controller.enqueue(encoder.encode(txt));
        };

        try {
          const genModel = ai.getGenerativeModel({ model });

          // --- AGENT 1: MANAGER (Chef d'orchestre) ---
          const managerRes = await genModel.generateContent([
            { text: `CONTEXTE PRÉCÉDENT: ${conversationContext}\n\nREQUÊTE ACTUELLE: ${lastUserPrompt}` },
            ...mediaParts 
          ], { 
            systemInstruction: `Tu es le Manager des projets. Analyse l'intention :
            1. Discussion/Salutation : Réponds amicalement et ajoute '[MODE: CHAT]'.
            2. Modification : Réponds brièvement et ajoute '[MODE: FAST]'.
            3. Création : Planifie et ajoute '[MODE: FULL]'.
            PAS DE TAILWIND CSS. Tu décides si on appelle les agents techniques.` 
          });
          
          const managerDecision = managerRes.response.text();
          const isChatMode = managerDecision.includes("[MODE: CHAT]");
          const isFastMode = managerDecision.includes("[MODE: FAST]");
          
          const cleanResponse = managerDecision.replace(/\[MODE: (CHAT|FAST|FULL)\]/g, "").trim();
          send(`[MANAGER]: ${cleanResponse}\n\n`);

          if (isChatMode) {
            controller.close();
            return;
          }

          let fullCode = "";
          let blueprint = "Utiliser l'existant";

          if (!isFastMode && managerDecision.includes("[MODE: FULL]")) {
            // --- AGENT 2: PKG ---
            send("→ 🏗️ Analyse structurelle profonde...\n");
            const pkgRes = await genModel.generateContent([
                { text: `Historique: ${conversationContext}\nPrompt: ${lastUserPrompt}` },
                ...mediaParts
            ], { systemInstruction: `Agent PKG. ${STACK_INFO} Liste les composants techniques.` });
            blueprint = pkgRes.response.text();

            // --- AGENT 3: BACKEND BUILDER ---
            send("→ ⚙️ Génération de la logique métier...\n");
            const backendRes = await genModel.generateContent([
                { text: `Prompt: ${lastUserPrompt}\nBlueprint: ${blueprint}` }
            ], { systemInstruction: `Agent Backend. XML UNIQUEMENT sous cette forme sans markdown : <create_file path="nomdufichier">code_sans_markdown</create_file>. Pas de src/. Ne touche pas au UI.` });
            fullCode = backendRes.response.text();
            send(`${fullCode}\n`);
          }

          // --- AGENT 4: UI BUILDER ---
          if (isFastMode || managerDecision.includes("[MODE: FULL]")) {
            send(isFastMode ? "→ ⚡ Modification rapide du code...\n" : "→ 🎨 Finalisation du design...\n");
            const uiStream = await genModel.generateContentStream([
                { text: `HISTORIQUE: ${conversationContext}\nLOGIQUE: ${fullCode}\nACTION: ${lastUserPrompt}` },
                ...mediaParts
            ], { systemInstruction: FULL_PROMPT_INJECTION });

            for await (const chunk of uiStream.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                fullCode += chunkText;
                send(chunkText);
              }
            }

            // --- AGENT 6: SCANNER DE DÉPENDANCES ---
            send("→ 📦 Analyse des dépendances NPM...\n");
            const scannerRes = await genModel.generateContent([
                { text: `Identifie les packages tiers importés dans ce code :\n${fullCode}` }
            ], { systemInstruction: `Réponds UNIQUEMENT par une liste JSON simple : ["pkg1", "pkg2"]. Si rien, réponds [].` });
            
            let packagesToInstall: string[] = [];
            try {
                const scannerText = scannerRes.response.text();
                packagesToInstall = JSON.parse(scannerText.match(/\[.*\]/s)?.[0] || "[]");
            } catch (e) { packagesToInstall = []; }

            if (packagesToInstall.length > 0) {
                // Recherche des versions via package-json
                const dependencies: Record<string, string> = { "next": "latest", "react": "latest", "react-dom": "latest" };
                for (const pkg of packagesToInstall) {
                    dependencies[pkg] = await getPackageVersion(pkg);
                }

                const packageJsonContent = JSON.stringify({
                    name: "project-40-app", version: "0.1.0", private: true,
                    scripts: { "dev": "next dev", "build": "next build", "start": "next start" },
                    dependencies: dependencies
                }, null, 2);

                const packageXml = `<create_file path="package.json">\n${packageJsonContent}\n</create_file>\n`;
                send(packageXml);
                fullCode += packageXml;
            }

            // --- AGENT 5: VERIFICATOR ---
            send("\n→ 🔍 Validation...\n");
            const validatorRes = await genModel.generateContent([
              { text: `Code final à vérifier:\n${fullCode}` }
            ], { systemInstruction: "Réponds 'CONFIRME' si le code respecte le XML et la stack, sinon liste les erreurs." });
            const validationReport = validatorRes.response.text();

            if (!validationReport.includes("CONFIRME")) {
              send("→ 🛠️ Correction automatique...\n");
              const fixerRes = await genModel.generateContentStream([
                { text: `Corrige ces erreurs: ${validationReport} dans ce code: ${fullCode}` }
              ], { systemInstruction: FULL_PROMPT_INJECTION });
              for await (const chunk of fixerRes.stream) {
                const text = chunk.text();
                if (text) send(text);
              }
            }
          }

          send("\n✅ Opération terminée.");
          controller.close();

        } catch (error: any) {
          send("\nERREUR: " + error.message);
          controller.close();
        }
      }
    });

    return new Response(stream, { 
        headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" } 
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Server Error: " + err.message }, { status: 500 })
  }
                               }
