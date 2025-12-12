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

        // ---------------------------
        // 1️⃣ Créer les fichiers Next.js directement
        // ---------------------------
        send("📝 Writing Next.js template...");

        // package.json
        await sbx.files.write(
          "/workspace/next-app/package.json",
          JSON.stringify(
            {
              name: "next-app-e2b",
              private: true,
              scripts: {
                dev: "next dev -p 3000",
                build: "next build",
                start: "next start -p 3000",
              },
              dependencies: {
                next: "15.0.0",
                react: "18.3.1",
                "react-dom": "18.3.1",
              },
            },
            null,
            2
          )
        );

        // app/page.tsx
        await sbx.files.write("/workspace/next-app/app/page.tsx", template);

        // optionnel : app/layout.tsx minimal
        await sbx.files.write(
          "/workspace/next-app/app/layout.tsx",
          `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
          `
        );

        send("📥 Installing dependencies...");
        await sbx.commands.run(`cd /workspace/next-app && npm install`, {
          onStdout: (d) => send("[NPM] " + d),
          onStderr: (d) => send("[NPM ERR] " + d),
        });

        send("▶ Starting dev server...");
        sbx.commands.run(`cd /workspace/next-app && npm run dev`, {
          background: true,
          onStdout: (d) => send("[DEV] " + d),
          onStderr: (d) => send("[DEV ERR] " + d),
        });

        // récupérer l’URL publique
        const url = sbx.getHost(3000);
        send("🌍 URL: " + url);
        send("🎉 Next.js app ready!");

        controller.close();
      } catch (err: any) {
        controller.enqueue(encoder.encode("❌ ERROR: " + err.message));
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
                
