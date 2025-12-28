import { NextResponse } from "next/server";
import { GoogleGenAI, Part } from "@google/genai";
import { basePrompt } from "@/lib/prompt";
// @ts-ignore
import packageJson from 'package-json';

const FULL_PROMPT_INJECTION = `${basePrompt}`; 

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
    const { 
        history, 
        uploadedImages, 
        vibeComponents  
    } = body;

    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = "gemini-2.5-flash"; 
    
    let componentsContext = "";
    
    if (vibeComponents && vibeComponents.length > 0) {
        componentsContext += "\n\n--- BIBLIOTHÈQUE DE COMPOSANTS DE RÉFÉRENCE ---\n";
        componentsContext += "Utilise ces blocs de code comme source de vérité pour le style et la structure.\n";
        
        vibeComponents.forEach((comp: any, index: number) => {
            componentsContext += `\n[COMPOSANT #${index + 1} - TYPE: ${comp.type}]\n`;
            componentsContext += `\`\`\`html\n${comp.ai_code || comp.ai_hybrid || comp.html_inlined}\n\`\`\`\n`;
        });
        
        componentsContext += "\n--- FIN DE LA BIBLIOTHÈQUE ---\n";
    }

    const lastMessage = history[history.length - 1];
    const userPromptParts: Part[] = [];

    if (uploadedImages && uploadedImages.length > 0) {
        uploadedImages.forEach((base64: string) => {
            userPromptParts.push({ 
                inlineData: { 
                    data: base64.split(',')[1], 
                    mimeType: "image/png" 
                } 
            });
        });
        userPromptParts.push({ text: "Analyse cette image. C'est la mise en page cible." });
    }

    if (componentsContext) {
        userPromptParts.push({ text: componentsContext });
        userPromptParts.push({ text: "Instructions : Reproduis la mise en page cible (image ci-dessus) en assemblant les COMPOSANTS DE RÉFÉRENCE fournis ci-dessus. Ne crée pas de style from scratch si un composant correspondant existe." });
    }

    userPromptParts.push({ text: lastMessage.content });

    const finalSystemInstruction = FULL_PROMPT_INJECTION;

    const response = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts: userPromptParts }], 
        config: { 
            systemInstruction: finalSystemInstruction,
            temperature: 0.2 
        }
    });

    const encoder = new TextEncoder();
    let fullGeneratedCode = ""; 

    const stream = new ReadableStream({
        async start(controller) {
            // --- 1. STREAMING DU CODE UI/BACKEND ---
            for await (const chunk of response) {
                if (chunk.text) {
                    const txt = chunk.text;
                    fullGeneratedCode += txt;
                    controller.enqueue(encoder.encode(txt));
                }
            }

            // --- 2. AGENT PACKAGE (DÉCLENCHÉ APRÈS LE CODE) ---
            try {
                const scannerRes = await ai.models.generateContent({
                    model,
                    contents: [{ 
                        role: 'user', 
                        parts: [{ text: `Liste uniquement les packages npm tiers (ex: lucide-react, framer-motion) importés dans ce code. Réponds strictement sous forme de tableau JSON : ["pkg1", "pkg2"]. Si aucun, réponds [].\n\nCODE:\n${fullGeneratedCode}` }] 
                    }]
                });

                const scannerText = scannerRes.candidates[0].content.parts[0].text;
                const match = scannerText.match(/\[.*\]/s);
                const packagesToInstall: string[] = match ? JSON.parse(match[0]) : [];

                if (packagesToInstall.length > 0 || fullGeneratedCode.includes('import')) {
                    // --- DÉPENDANCES DE PRODUCTION ---
                    const deps: Record<string, string> = {
                        "next": "latest",
                        "react": "latest",
                        "react-dom": "latest"
                    };
                    for (const pkg of packagesToInstall) {
                        deps[pkg] = await getPackageVersion(pkg);
                    }

                    // --- DÉPENDANCES DE DÉVELOPPEMENT (TS + Types) ---
                    const devDepsList = ["typescript", "@types/node", "@types/react", "@types/react-dom"];
                    const devDeps: Record<string, string> = {};
                    for (const d of devDepsList) {
                        devDeps[d] = await getPackageVersion(d);
                    }

                    const packageJsonContent = JSON.stringify({
                        name: "project-app",
                        version: "0.1.0",
                        private: true,
                        scripts: { 
                            "dev": "next dev -H 0.0.0.0", 
                            "build": "next build", 
                            "start": "next start" 
                        },
                        dependencies: deps,
                        devDependencies: devDeps // Ajout de la section devDependencies
                    }, null, 2);

                    const packageXml = `\n<create_file path="package.json">\n${packageJsonContent}\n</create_file>\n`;
                    controller.enqueue(encoder.encode(packageXml));
                }
            } catch (pkgError) {
                console.error("Erreur Agent Package:", pkgError);
            }

            controller.close();
        }
    });

    return new Response(stream, { headers: { "Content-Type": "text/plain" } });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
      }
