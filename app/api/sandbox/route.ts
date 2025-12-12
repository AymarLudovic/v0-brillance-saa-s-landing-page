// app/api/sandbox/route.ts
import { NextResponse } from "next/server";
import * as e2b from "@e2b/code-interpreter";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { action, sandboxId: bodySandboxId, plan } = body || {};
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "E2B_API_KEY manquant" }, { status: 500 });
  }

  try {
    switch (action) {
      case "create": {
        const sandbox = await e2b.Sandbox.create({ apiKey });

        // écrire un Next.js minimal
        await sandbox.files.write(
          "/home/user/package.json",
          JSON.stringify(
            {
              name: "nextjs-app",
              private: true,
              scripts: {
                dev: "next dev -p 3000 -H 0.0.0.0",
                build: "next build",
                start: "next start -p 3000 -H 0.0.0.0",
              },
              dependencies: {
                next: "14.2.3",
                react: "18.2.0",
                "react-dom": "18.2.0",
              },
            },
            null,
            2
          )
        );

        await sandbox.files.write(
          "/home/user/app/layout.tsx",
          `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`.trim()
        );

        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `
"use client";
export default function Page() {
  return <h1>🚀 Hello depuis Next.js dans E2B</h1>;
}
`.trim()
        );

        return NextResponse.json({ sandboxId: sandbox.sandboxId });
      }

      case "applyPlan": {
        // si aucun ID fourni, on crée un nouveau sandbox
        let sid: string | null = bodySandboxId || null;
        let sandbox: e2b.Sandbox;

        if (!sid) {
          sandbox = await e2b.Sandbox.create({ apiKey });
          sid = sandbox.sandboxId;
        } else {
          sandbox = await e2b.Sandbox.connect(sid, { apiKey });
        }

        // supprimer les fichiers marqués
        if (Array.isArray(plan?.delete)) {
          for (const p of plan.delete) {
            try {
              await sandbox.files.delete(`/home/user/${p}`);
            } catch {
              // ignorer si absent
            }
          }
        }

        // écrire tous les fichiers du plan
        if (plan?.files) {
          for (const [path, content] of Object.entries(plan.files)) {
            await sandbox.files.write(`/home/user/${path}`, String(content));
          }
        }

        // on ne lance pas install/build/start ici (ta page s'en charge)
        return NextResponse.json({ success: true, sandboxId: sid });
      }

      case "install": {
        const sid = bodySandboxId;
        if (!sid) throw new Error("sandboxId manquant");
        const sandbox = await e2b.Sandbox.connect(sid, { apiKey });
        const { stdout, stderr } = await sandbox.commands.run(
          "npm install --no-audit --loglevel warn",
          { cwd: "/home/user" }
        );
        return NextResponse.json({ success: true, logs: stdout + stderr });
      }

      case "build": {
        const sid = bodySandboxId;
        if (!sid) throw new Error("sandboxId manquant");
        const sandbox = await e2b.Sandbox.connect(sid, { apiKey });
        const { stdout, stderr } = await sandbox.commands.run("npm run build", {
          cwd: "/home/user",
        });
        return NextResponse.json({ success: true, logs: stdout + stderr });
      }

      case "start": {
        const sid = bodySandboxId;
        if (!sid) throw new Error("sandboxId manquant");
        const sandbox = await e2b.Sandbox.connect(sid, { apiKey });

        // démarrage async
        sandbox.commands.start("npm run start", { cwd: "/home/user" });
        const url = `https://${sandbox.getHost(3000)}`;
        return NextResponse.json({ success: true, url });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
          }
        
