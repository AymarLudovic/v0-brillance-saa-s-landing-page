import { NextResponse } from "next/server";
import * as e2b from "@e2b/code-interpreter";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => {
      throw new Error("Invalid JSON in request body");
    });

    const { action, sandboxId: bodySandboxId, plan } = body || {};
    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "E2B_API_KEY manquant" }, { status: 500 });
    }

    switch (action) {
      case "create": {
        const sandbox = await e2b.Sandbox.betaCreate({
          apiKey,
          timeoutMs: 900_000,
          autoPause: true,
        });

        // Fichiers Next.js par défaut pour le sandbox
        const defaultPackageJson = {
          name: "nextjs-app",
          private: true,
          scripts: {
            dev: "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next dev -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next: "14.2.16",
            react: "18.2.0",
            "react-dom": "18.2.0",
            "iconsax-reactjs": "0.0.8"
          },
        };
        await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPackageJson, null, 2));

        await sandbox.files.write("/home/user/tsconfig.json", JSON.stringify({
          compilerOptions: {
            target: "esnext",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: false,
            forceConsistentCasingInFileNames: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "node",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
          exclude: ["node_modules"],
        }, null, 2));

        // Layout
        await sandbox.files.write(
          "/home/user/app/layout.tsx",
          `import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`
        );

        // Page
        await sandbox.files.write("/home/user/app/page.tsx", `"use client";
export default function Page() {
  return (
    <div style={{ textAlign: "center", padding: "50px" }}>
      <h1>Next.js 14 + E2B Sandbox</h1>
      <p>Sandbox is running!</p>
    </div>
  );
}`);

        // AJOUT DU FICHIER globals.css ICI
        await sandbox.files.write(
          "/home/user/app/globals.css",
          `
body {
  font-family: sans-serif;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  background-color: #f4f4f4;
  color: #333;
}

h1 {
  color: #0070f3;
}

div {
  line-height: 1.5;
}
`
        );


        console.log(`Sandbox créé: ${sandbox.sandboxId}`);
        return NextResponse.json({ success: true, sandboxId: sandbox.sandboxId });
      }

      case "addFile": {
        if (!bodySandboxId || !body.filePath || !body.content)
          throw new Error("Paramètres manquants (sandboxId, filePath, content)");

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 900_000 });
        await sandbox.files.write(`/home/user/${body.filePath}`, body.content);
        console.log(`Fichier ${body.filePath} écrit dans le sandbox ${bodySandboxId}`);
        return NextResponse.json({ success: true, message: `File ${body.filePath} written` });
      }

      case "addFiles": {
        if (!bodySandboxId || !body.files || !Array.isArray(body.files)) {
          throw new Error("Paramètres manquants (sandboxId ou files[])");
        }

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 900_000 });

        for (const f of body.files) {
          if (!f.filePath || !f.content) continue;
          await sandbox.files.write(`/home/user/${f.filePath}`, f.content);
          console.log(`Fichier ${f.filePath} écrit dans le sandbox ${bodySandboxId}`);
        }

        return NextResponse.json({ success: true, message: `${body.files.length} files written` });
      }
        
      case "install":
      case "build": {
        if (!bodySandboxId) throw new Error("sandboxId manquant");
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 900_000 });
        await sandbox.setTimeout(900_000);

        let commandResult: e2b.CommandResult = {
          stdout: "",
          stderr: "",
          exitCode: -1,
        };
        let commandSuccess = false;

        try {
          if (action === "install") {
            commandResult = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
              cwd: "/home/user",
              timeoutMs: 600_000,
            });
          } else { // action === "build"
            commandResult = await sandbox.commands.run("npm run build", { cwd: "/home/user", timeoutMs: 300_000 });
          }
          commandSuccess = commandResult.exitCode === 0;
        } catch (e: any) {
          if (e instanceof e2b.CommandExitError) {
            commandResult = {
              stdout: e.stdout || "",
              stderr: e.stderr || e.message || "",
              exitCode: e.exitCode,
              error: e.message,
            };
            console.warn(`E2B CommandExitError capturée pour l'action '${action}':`, e);
          } else {
            console.error(`Erreur inattendue lors de l'exécution de la commande E2B pour l'action '${action}':`, e);
            commandResult.error = e.message || "Erreur inconnue lors de l'exécution de la commande";
            commandResult.stderr += `\nUnexpected API error: ${e.message || e.toString()}`;
          }
          commandSuccess = false;
        }
        
        console.log(`Commande '${action}' exécutée dans le sandbox ${bodySandboxId}. Résultat complet:`, commandResult);

        return NextResponse.json({ success: commandSuccess, action, result: commandResult });
      }

      case "start": {
        if (!bodySandboxId) throw new Error("sandboxId manquant");
        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 900_000 });
        await sandbox.setTimeout(900_000);

        const process = await sandbox.commands.start("npm run start", { cwd: "/home/user" });
        const url = `https://${sandbox.getHost(3000)}`;

        console.log(`Commande 'start' lancée dans le sandbox ${bodySandboxId}. URL: ${url}, Process ID: ${process.processID}`);
        
        return NextResponse.json({ success: true, action, url, processId: process.processID });
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
    }
  } catch (e: any) {
    console.error("Erreur dans l'API route /api/sandbox:", e);
    return NextResponse.json({ error: e.message || "Erreur inconnue", details: e.toString() }, { status: 500 });
  }
            }
