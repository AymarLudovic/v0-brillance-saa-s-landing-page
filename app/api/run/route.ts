import { NextResponse } from "next/server";
import { Sandbox } from "e2b";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { template } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(msg: string) {
        controller.enqueue(encoder.encode(msg + "\n"));
      }

      try {
        send("🚀 Creating E2B sandbox...");

        const sbx = await Sandbox.create({
          id: "nodejs",
          apiKey: process.env.E2B_API_KEY!,
        });

        send("✔ Sandbox ready.");
        send("📦 Creating Next.js project...");

        // 1. Create Next.js app
        await sbx.commands.run(
          `npx create-next-app@latest next-app --ts --eslint --app --no-tailwind --src-dir=false --import-alias="@/*"`,
          {
            onStdout: (d) => send("[STDOUT] " + d),
            onStderr: (d) => send("[ERROR] " + d),
          }
        );

        // 2. Write template in app/page.tsx
        send("📝 Writing template...");
        await sbx.files.write(
          "/workspace/next-app/app/page.tsx",
          template
        );

        // 3. Install deps
        send("📥 Installing dependencies...");
        await sbx.commands.run(`cd next-app && npm install`, {
          onStdout: (d) => send("[NPM] " + d),
          onStderr: (d) => send("[NPM ERR] " + d),
        });

        // 4. Start dev server in background
        send("▶ Starting dev server...");
        sbx.commands.run(`cd next-app && npm run dev`, {
          background: true,
          onStdout: (d) => send("[DEV] " + d),
          onStderr: (d) => send("[DEV ERR] " + d),
        });

        // 5. Get public URL
        const url = sbx.getHost(3000);
        send("🌍 URL: " + url);

        send("🎉 Build finished!");

        controller.close();
      } catch (error: any) {
        controller.enqueue(encoder.encode("FATAL ERROR: " + error.message));
        controller.close();
        return;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
        }
            
