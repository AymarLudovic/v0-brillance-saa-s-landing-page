import { NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"
import { generatePKG } from "@/lib/agents/pkgAgent"
import { planFromPKG } from "@/lib/agents/plannerAgent"
import { generateUI } from "@/lib/agents/uiAgent"
import { generateBackend } from "@/lib/agents/backendAgent"

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Clé API manquante" }, { status: 401 });

    const { idea } = await req.json();
    if (!idea) return NextResponse.json({ error: "Idée manquante" }, { status: 400 });

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) => controller.enqueue(encoder.encode(text));

        try {
          // 1. ÉTAPE PKG (Architecte)
          send(" [STEP] Running PKG Agent...\n");
          const pkgResponse = await generatePKG(idea, apiKey);
          const pkg = (pkgResponse as any).pkg?.pkg || (pkgResponse as any).pkg || pkgResponse;
          
          send(` [INFO] Architecture planned for ${Object.keys(pkg.pages || {}).length} pages.\n\n`);

          // 2. ÉTAPE UI (Maçons) - On boucle sur chaque page
          const pages = Object.keys(pkg.pages || {});
          for (const pageName of pages) {
            send(`\n [STEP] Generating UI for: ${pageName}...\n`);
            const uiStream = await generateUI(pageName, pkg, apiKey);
            
            // On pipe le stream de l'agent UI directement dans notre flux principal
            for await (const chunk of uiStream.stream) {
              if (chunk.text) {
                send(chunk.text());
              }
            }
          }

          // 3. ÉTAPE BACKEND (Électricien)
          send(`\n\n [STEP] Generating Backend Logic...\n`);
          const beStream = await generateBackend(pkg, apiKey);
          
          for await (const chunk of beStream.stream) {
            if (chunk.text) {
              send(chunk.text());
            }
          }

          send("\n\n [SUCCESS] Full application generation completed.");
          controller.close();

        } catch (err: any) {
          send(`\n [ERROR] Pipeline failed: ${err.message}`);
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked"
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Server Error: " + err.message }, { status: 500 });
  }
        }
