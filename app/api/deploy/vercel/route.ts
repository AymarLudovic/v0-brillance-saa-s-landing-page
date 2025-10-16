import { NextResponse } from "next/server";

// Définir le type pour les fichiers du projet
type FileMap = { [key: string]: string };

export async function POST(request: Request) {
  try {
    const { 
      projectName, 
      token, 
      sandboxId, // Conservé pour le contexte si nécessaire, mais non utilisé pour la logique de fichier
      files 
    }: {
        projectName: string;
        token: string;
        sandboxId: string;
        files: FileMap; // Les fichiers sont maintenant attendus ici
    } = await request.json();

    if (!projectName || !token || !files || Object.keys(files).length === 0) {
      return NextResponse.json(
        { success: false, error: "Paramètres manquants (projectName, token, ou fichiers du projet)" },
        { status: 400 }
      );
    }

    // 🛑 L'appel à l'API /api/sandbox/route.ts est retiré.
    // Les fichiers sont directement dans la variable `files`.

    // 1. Créer le payload pour le déploiement Vercel
    const deploymentPayload = {
      name: projectName,
      gitSource: {
        type: "github",
        repo: "user-provided-code", // Ceci permet le déploiement de code non lié à un repo Git
      },
      // Transformer la map de fichiers en tableau au format Vercel
      files: Object.entries(files).map(([filePath, content]) => ({
        file: filePath, // e.g., "app/page.tsx"
        data: content,
      })),
      // Assurer un environnement compatible pour Next.js (si nécessaire)
      environment: [
        { key: "NODE_VERSION", value: "18" }
      ]
    };

    console.log("[Vercel Deploy] Début du déploiement avec les fichiers du client.");

    // 2. Appel à l'API Vercel
    const vercelResponse = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deploymentPayload),
    });

    const vercelData = await vercelResponse.json();

    if (!vercelResponse.ok) {
      console.error("[Vercel Deploy] Erreur API Vercel:", vercelData);
      return NextResponse.json(
        {
          success: false,
          error: vercelData.error?.message || "Erreur inconnue lors du déploiement Vercel.",
          details: vercelData.error?.code 
        },
        { status: vercelResponse.status }
      );
    }

    // 3. Succès
    console.log("[Vercel Deploy] Déploiement lancé:", vercelData.url);
    return NextResponse.json({
      success: true,
      deploymentId: vercelData.id,
      url: `https://${vercelData.url}`,
    });
  } catch (error: any) {
    console.error("[Vercel Deploy] Erreur critique:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Erreur interne du serveur lors du déploiement." },
      { status: 500 }
    );
  }
      }
