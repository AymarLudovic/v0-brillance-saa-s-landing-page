import { NextResponse } from "next/server";
import { Daytona } from "@daytonaio/sdk";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { template } = await req.json();

  // Streaming response pour envoyer les logs en direct
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
      send("Initialisation de Daytona...");
      const daytona = new Daytona({
        apiKey: process.env.DAYTONA_API_KEY!,
      });

      send("Création de la sandbox...");
      const sandbox = await daytona.create({
        language: "typescript",
        public: true,
      });

      send("Génération du projet temporaire...");
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-app-"));
      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      fs.writeFileSync(path.join(appDir, "page.tsx"), template, "utf-8");

      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "next-app-daytona",
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

      send("Upload du projet dans Daytona...");
      await sandbox.fs.uploadDir(tempDir, "/home/daytona/app");

      const wd = "/home/daytona/app";

      send("Installation des dépendances...");
      await sandbox.process.executeCommand("npm install", wd, (log) =>
        send(log)
      );

      send("Build de Next.js...");
      await sandbox.process.executeCommand("npm run build", wd, (log) =>
        send(log)
      );

      send("Démarrage du serveur Next.js...");
      await sandbox.process.executeCommand(
        "npm run start",
        wd,
        (log) => send(log),
        0,
        { async: true }
      );

      send("Récupération de l'URL publique...");
      const preview = await sandbox.getPreviewUrl(3000);

      send("Application disponible !");
      finish(preview.url);
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
        
