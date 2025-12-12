import { NextResponse } from "next/server";
import { Sandbox } from "@e2b/sdk";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { template } = await req.json();

  // STREAMING SETUP
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  function send(text: string) {
    writer.write(`LOG: ${text}\n`);
    console.log("[BACKEND]", text);
  }

  async function finish(url?: string) {
    if (url) writer.write(`URL: ${url}\n`);
    await writer.close();
  }

  (async () => {
    try {
      send("Initialisation de E2B Sandbox...");

      const sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY!,
        template: "base",           // template Linux Node
      });

      send(`Sandbox créée : ${sandbox.id}`);

      // -------------------------------
      // GÉNÉRATION DU PROJET NEXT.JS
      // -------------------------------
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-app-"));
      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      fs.writeFileSync(path.join(appDir, "page.tsx"), template, "utf-8");

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "next-app-e2b",
            private: true,
            scripts: {
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

      send("Upload du projet dans la sandbox...");

      await sandbox.files.uploadDirectory(tempDir, "/workspace/app");

      // -------------------------------
      // INSTALLATION
      // -------------------------------
      send("Installation des dépendances...");

      await sandbox.commands.run("cd /workspace/app && npm install", {
        onStdout(data) {
          send(data.toString());
        },
        onStderr(data) {
          send(data.toString());
        },
      });

      // -------------------------------
      // BUILD
      // -------------------------------
      send("Build du projet Next.js...");

      await sandbox.commands.run("cd /workspace/app && npm run build", {
        onStdout(data) {
          send(data.toString());
        },
        onStderr(data) {
          send(data.toString());
        },
      });

      // -------------------------------
      // START NEXT.JS (processus async)
      // -------------------------------
      send("Démarrage du serveur Next.js...");
      
      sandbox.commands.run("cd /workspace/app && npm run start", {
        onStdout(data) {
          send(data.toString());
        },
        onStderr(data) {
          send(data.toString());
        },
        background: true, // laisser tourner le serveur Next.js
      });

      // -------------------------------
      // EXPOSE PORT
      // -------------------------------
      send("Exposition du port 3000...");

      const publicUrl = await sandbox.ports.expose(3000);

      send("Application démarrée !");
      finish(publicUrl);
    } catch (e: any) {
      send("❌ ERREUR : " + e.message);
      finish();
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
  }
            
