import { NextResponse } from "next/server";
import { Daytona } from "@daytonaio/sdk";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs"; // important pour Daytona SDK

export async function POST(req: Request) {
  const { template } = await req.json();

  // 1) Initialiser Daytona
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY!,
  });

  // 2) Créer la sandbox
  const sandbox = await daytona.create({
    language: "typescript",
    public: true,
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "next-app-"));
  const appDir = path.join(tempDir, "app");

  // -- Générer la structure Next.js app router --
  fs.mkdirSync(appDir, { recursive: true });

  fs.writeFileSync(
    path.join(appDir, "page.tsx"),
    template,
    "utf-8"
  );

  fs.writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify(
      {
        name: "next-app-daytona",
        version: "1.0.0",
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

  // 3) Upload du projet dans la sandbox
  await sandbox.fs.uploadDir(tempDir, "/home/daytona/app");

  const wd = "/home/daytona/app";

  // 4) Installer les dépendances
  await sandbox.process.executeCommand("npm install", wd);

  // 5) Build Next.js
  await sandbox.process.executeCommand("npm run build", wd);

  // 6) Lancer le serveur Next.js (async)
  await sandbox.process.executeCommand(
    "npm run start",
    wd,
    undefined,
    0,
    { async: true }
  );

  // 7) Récupérer l’URL publique
  const preview = await sandbox.getPreviewUrl(3000);

  return NextResponse.json({ url: preview.url });
    }
  
