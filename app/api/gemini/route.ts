import { NextResponse } from "next/server"
import { GoogleGenAI, Part, FunctionDeclaration, Type } from "@google/genai"
import { basePrompt } from "@/lib/prompt"
// @ts-ignore - On suppose que le package est installé ou sera géré dans l'environnement
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

// Fonction utilitaire pour récupérer la version exacte via package-json
async function getPackageVersion(pkgName: string): Promise<string> {
    try {
        const metadata = await packageJson(pkgName.toLowerCase());
        return `^${metadata.version}`;
    } catch (e) {
        return "latest"; // Fallback si le package n'est pas trouvé
    }
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-gemini-api-key');
    const apiKey = authHeader && authHeader !== "null" ? authHeader : process.env.GEMINI_API_KEY;

    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const body = await req.json();
    // Ajout de uploadFiles extrait du body
    const { history } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-3-flash-preview"; 
    
    const lastUserPrompt = history[history.length - 1].content;
    // On inclut les fichiers uploadés dans le contexte textuel
    const filesContext = uploadFiles ? `\nFICHIERS UPLOADÉS: ${JSON.stringify(uploadFiles)}` : "";
    const conversationContext = history.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n") + filesContext;

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
          // --- AGENT 1: MANAGER ---
          const managerRes = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: `CONTEXTE PRÉCÉDENT: ${conversationContext}\n\nREQUÊTE ACTUELLE: ${lastUserPrompt}` }] }],
            config: { systemInstruction: `Tu es le Manager des projets. Analyse l'intention de l'utilisateur :
            1. Si c'est une simple discussion : Réponds amicalement et ajoute '[MODE: CHAT]'.
            2. Si c'est une modification : Réponds brièvement et ajoute '[MODE: FAST]'.
            3. Si c'est une création : Planifie et ajoute '[MODE: FULL]'.
            PAS DE TAILWIND CSS. Tu décides si on appelle les agents techniques.` }
          });
          
          const managerDecision = managerRes.candidates[0].content.parts[0].text;
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
            const pkgRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: `Historique: ${conversationContext}\nPrompt: ${lastUserPrompt}` }] }],
                config: { systemInstruction: `Agent PKG. ${STACK_INFO} Liste les composants techniques.` }
            });
            blueprint = pkgRes.candidates[0].content.parts[0].text;

            // --- AGENT 3: BACKEND BUILDER ---
            send("→ ⚙️ Génération de la logique métier...\n");
            const backendRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: `Prompt: ${lastUserPrompt}\nBlueprint: ${blueprint}` }] }],
                config: { systemInstruction: `Agent Backend. XML UNIQUEMENT : <create_file path="app/api/...">code</create_file>. Pas de src/, pas de UI.` }
            });
            fullCode = backendRes.candidates[0].content.parts[0].text;
            send(`${fullCode}\n`);
          }

          // --- AGENT 4: UI BUILDER ---
          if (isFastMode || managerDecision.includes("[MODE: FULL]")) {
            send(isFastMode ? "→ ⚡ Modification rapide du code...\n" : "→ 🎨 Finalisation du design...\n");
            const uiStream = await ai.models.generateContentStream({
              model,
              contents: [
                  { role: 'user', parts: [{ text: `HISTORIQUE COMPLET: ${conversationContext}\nLOGIQUE: ${fullCode}\nACTION: ${lastUserPrompt}` }] }
              ],
              config: { systemInstruction: FULL_PROMPT_INJECTION }
            });

            for await (const chunk of uiStream) {
              if (chunk.text) {
                fullCode += chunk.text;
                send(chunk.text);
              }
            }

            // --- NOUVEAU : AGENT 6 (SCANNER DE DÉPENDANCES) ---
            send("→ 📦 Analyse des dépendances NPM...\n");
            const scannerRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text: `Code généré:\n${fullCode}` }] }],
                config: { systemInstruction: `Tu es l'Agent Scanner. Identifie tous les packages npm tiers importés dans le code (ex: lucide-react, date-fns). 
                Réponds UNIQUEMENT par une liste JSON simple : ["pkg1", "pkg2"]. Si rien, réponds [].` }
            });
            
            let packagesToInstall: string[] = [];
            try {
                const scannerText = scannerRes.candidates[0].content.parts[0].text;
                packagesToInstall = JSON.parse(scannerText.match(/\[.*\]/s)?.[0] || "[]");
            } catch (e) {
                packagesToInstall = [];
            }

            if (packagesToInstall.length > 0) {
                // --- PROCESSUS package-json (RECHERCHE VERSIONS) ---
                const dependencies: Record<string, string> = {
                    "next": "latest",
                    "react": "latest",
                    "react-dom": "latest"
                };

                for (const pkg of packagesToInstall) {
                    dependencies[pkg] = await getPackageVersion(pkg);
                }

                // --- AGENT 7: PACKAGE GENERATOR (CRÉATION DU package.json via XML) ---
                const packageJsonContent = JSON.stringify({
                    name: "project-40-app",
                    version: "0.1.0",
                    private: true,
                    scripts: { "dev": "next dev", "build": "next build", "start": "next start" },
                    dependencies: dependencies
                }, null, 2);

                const packageXml = `<create_file path="package.json">\n${packageJsonContent}\n</create_file>\n`;
                send(packageXml);
                fullCode += packageXml;
            }

            // --- AGENT 5: VERIFICATOR ---
            send("\n→ 🔍 Validation...\n");
            const validatorRes = await ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts: [{ text: `Code final à vérifier:\n${fullCode}` }] }],
              config: { systemInstruction: "Réponds 'CONFIRME' si le code respecte le XML et la stack, sinon liste les erreurs." }
            });
            const validationReport = validatorRes.candidates[0].content.parts[0].text;

            if (!validationReport.includes("CONFIRME")) {
              send("→ 🛠️ Correction automatique...\n");
              const fixerRes = await ai.models.generateContentStream({
                model,
                contents: [{ role: 'user', parts: [{ text: `Corrige ces erreurs: ${validationReport} dans ce code: ${fullCode}` }] }],
                config: { systemInstruction: FULL_PROMPT_INJECTION }
              });
              for await (const chunk of fixerRes) {
                if (chunk.text) send(chunk.text);
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
