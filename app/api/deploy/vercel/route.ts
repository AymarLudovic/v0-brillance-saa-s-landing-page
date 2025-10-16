import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { projectName, token, sandboxId } = await request.json();

    if (!projectName || !token || !sandboxId) {
      return NextResponse.json(
        { success: false, error: "Paramètres manquants (projectName, token, ou sandboxId)" },
        { status: 400 }
      );
    }

    // 1. Récupérer les fichiers du sandbox via la route /api/sandbox
    console.log("[Vercel Deploy] Récupération des fichiers depuis le sandbox:", sandboxId);
    
    const extractResponse = await fetch(`${request.nextUrl.origin}/api/sandbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "getFiles", // 🟢 APPEL DE LA NOUVELLE ACTION CORRIGÉE
        sandboxId: sandboxId,
      }),
    });

    const extractData: { success: boolean; error?: string; files?: Record<string, string> } = await extractResponse.json();

    if (!extractData.success || !extractData.files) {
      const errorMsg = extractData.error || "Réponse non réussie ou fichiers manquants de /api/sandbox";
      console.error("[Vercel Deploy] Échec de la récupération des fichiers:", errorMsg);
      return NextResponse.json(
        { success: false, error: `Failed to process files from sandbox: ${errorMsg}` },
        { status: 500 }
      );
    }

    const files = extractData.files;

    // 2. Créer le déploiement Vercel (API Vercel)
    const deploymentPayload = {
      name: projectName,
      gitSource: {
        type: "github",
        repo: "user-provided-code", 
      },
      files: Object.entries(files).map(([filePath, content]) => ({
        file: filePath,
        data: content,
      })),
    };

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
