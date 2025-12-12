import { NextResponse } from "next/server";
import { CodeInterpreter } from "@e2b/code-interpreter";

export const runtime = "nodejs"; // important pour e2b

export async function POST(req: Request) {
  const { template } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("Starting sandbox...\n"));

        const sandbox = await CodeInterpreter.create({
          apiKey: process.env.E2B_API_KEY!,
          onStdout: (output) =>
            controller.enqueue(encoder.encode("[LOG] " + output + "\n")),
          onStderr: (error) =>
            controller.enqueue(encoder.encode("[ERR] " + error + "\n")),
        });

        controller.enqueue(encoder.encode("Sandbox created.\n"));

        // Create Next.js project
        controller.enqueue(encoder.encode("Creating Next.js app...\n"));
        await sandbox.run(`
          npx create-next-app@latest next-app --ts --eslint --app --no-tailwind --src-dir=false --import-alias="@/*"
        `);

        controller.enqueue(encoder.encode("Writing template...\n"));

        // Write custom page.tsx
        await sandbox.files.write("/workspace/next-app/app/page.tsx", template);

        controller.enqueue(encoder.encode("Installing dependencies...\n"));
        await sandbox.run(`cd next-app && npm install`);

        controller.enqueue(encoder.encode("Starting dev server...\n"));

        // Run dev server in background
        sandbox.run(`cd next-app && npm run dev`);

        controller.enqueue(
          encoder.encode("Server running. You can now open the URL.\n")
        );

        // Get public URL (E2B exposes port automatically)
        const url = sandbox.getUrl(3000);
        controller.enqueue(encoder.encode(`URL: ${url}\n`));

        controller.close();
      } catch (err: any) {
        controller.enqueue(encoder.encode("ERROR: " + err.message));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
      }
                         
