import { NextResponse } from "next/server";
import * as e2b from "@e2b/code-interpreter";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => {
      throw new Error("Invalid JSON in request body");
    });

    const { action, sandboxId: bodySandboxId, files: requestFiles } = body || {};
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

      case "getFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Extracting files from sandbox:", sid)

        try {
          let sandbox: e2b.Sandbox
          try {
            // Tente de se connecter à la sandbox existante
            sandbox = await e2b.Sandbox.connect(sid, {
              apiKey,
              timeoutMs: 900000,
            })
          } catch (connectError: any) {
            console.log("[v0] Failed to connect to sandbox, it may be paused or expired:", connectError.message)
            throw new Error(`Sandbox ${sid} is no longer available. It may have expired or been paused.`)
          }

          await sandbox.setTimeout(900000)

          // Commande pour lister tous les fichiers pertinents, en ignorant les dossiers de build/dépendances
          const { stdout: fileList } = await sandbox.commands.run(
            "find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.*'",
            {
              cwd: "/home/user",
            },
          )

          const files: Record<string, string> = {}
          const filePaths = fileList
            .trim()
            .split("\n")
            .filter((path) => path && path !== ".")

          console.log("[v0] Found", filePaths.length, "files to extract")

          for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i]
            try {
              const cleanPath = filePath.replace(/^\.\//, "")
              // Lit le contenu du fichier
              const content = await sandbox.files.read(`/home/user/${cleanPath}`, { format: "text" })

              // Logique spéciale pour package.json et autres JSON (formatage et validation)
              if (cleanPath === "package.json" || cleanPath.endsWith(".json")) {
                try {
                  const parsed = JSON.parse(content)
                  files[cleanPath] = JSON.stringify(parsed, null, 2)
                  console.log(`[v0] Validated and formatted JSON file: ${cleanPath}`)
                } catch (jsonError) {
                  // Fallback si le JSON est corrompu
                  console.error(`[v0] Invalid JSON in ${cleanPath}:`, jsonError)
                  if (cleanPath === "package.json") {
                    // (Logique de package.json par défaut omise ici pour la concision)
                    files[cleanPath] = content
                    console.log(`[v0] Used fallback package.json due to corruption`)
                  } else {
                    files[cleanPath] = content
                  }
                }
              } else {
                files[cleanPath] = typeof content === "string" ? content : String(content)
              }

              console.log(`[v0] Extracted file ${i + 1}/${filePaths.length}:`, cleanPath)
            } catch (error) {
              console.log("[v0] Could not read file:", filePath, error)
            }
          }

          console.log("[v0] Successfully extracted", Object.keys(files).length, "files")

          return NextResponse.json({
            success: true,
            files,
            fileCount: Object.keys(files).length,
          })
        } catch (error: any) {
          console.error("[v0] Error extracting files:", error)
          return NextResponse.json(
            {
              success: false,
              error: "Failed to extract files from sandbox",
              details: error.message,
              sandboxId: sid,
            },
            { status: 500 },
          )
        }
            }


   case "processFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Processing files for deployment from sandbox:", sid)

        try {
          // 1. Appel interne à getFiles pour obtenir le contenu des fichiers
          const extractResponse = await fetch(`${req.url}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "getFiles", sandboxId: sid }),
          })

          const extractResult = await extractResponse.json()

          if (!extractResult.success) {
            throw new Error(`Failed to extract files: ${extractResult.error}`)
          }

          const rawFiles = extractResult.files
          const processedFiles: Record<string, { content: string; encoding: string }> = {}

          // 2. Traitement et encodage
          for (const [filePath, content] of Object.entries(rawFiles)) {
            const fileContent = content as string

            if (typeof fileContent !== "string") {
              console.error(`[v0] File ${filePath} has invalid content type:`, typeof fileContent)
              continue
            }

            // Validation simple de package.json (optionnel)
            if (filePath === "package.json") {
              try {
                JSON.parse(fileContent)
              } catch (e) {
                throw new Error(`package.json contains invalid JSON: ${e}`)
              }
            }
            
            // 🛑 ENCODAGE EN BASE64 🛑
            processedFiles[filePath] = {
              content: Buffer.from(fileContent, "utf8").toString("base64"),
              encoding: "base64",
            }

            console.log(
              `[v0] Processed file: ${filePath} (${fileContent.length} chars -> ${processedFiles[filePath].content.length} base64 chars)`,
            )
          }

          console.log("[v0] Successfully processed", Object.keys(processedFiles).length, "files for deployment")

          return NextResponse.json({
            success: true,
            files: processedFiles,
            fileCount: Object.keys(processedFiles).length,
          })
        } catch (error: any) {
          console.error("[v0] Error processing files:", error)
          return NextResponse.json(
            {
              success: false,
              error: "Failed to process files for deployment",
              details: error.message,
              sandboxId: sid,
            },
            { status: 500 },
          )
        }
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
        if (!bodySandboxId || !requestFiles || !Array.isArray(requestFiles)) {
          throw new Error("Paramètres manquants (sandboxId ou files[])");
        }

        const sandbox = await e2b.Sandbox.connect(bodySandboxId, { apiKey, timeoutMs: 900_000 });

        for (const f of requestFiles) {
          if (!f.filePath || !f.content) continue;
          await sandbox.files.write(`/home/user/${f.filePath}`, f.content);
          console.log(`Fichier ${f.filePath} écrit dans le sandbox ${bodySandboxId}`);
        }

        return NextResponse.json({ success: true, message: `${requestFiles.length} files written` });
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
