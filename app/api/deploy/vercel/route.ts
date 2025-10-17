// app/api/deploy/vercel/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, files, projectName } = body || {};

    // Vérification basique
    if (!token || !files || !projectName) {
      return NextResponse.json(
        { success: false, error: "Missing parameters: token, files or projectName" },
        { status: 400 }
      );
    }

    // Formatage des fichiers pour l'API Vercel
    const formattedFiles = Object.entries(files).map(([path, data]) => ({
      file: path,
      data,
    }));

    // Création du déploiement sur Vercel
    const vercelRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        files: formattedFiles,
        target: "production",
      }),
    });

    // Essaie de lire la réponse JSON, même si elle est vide
    let data: any = null;
    try {
      data = await vercelRes.json();
    } catch {
      // Si la réponse est vide, on renvoie une erreur contrôlée
      return NextResponse.json(
        { success: false, error: "Vercel API returned an empty response" },
        { status: 502 }
      );
    }

    // Vérification du succès côté Vercel
    if (!vercelRes.ok || !data || data.error) {
      return NextResponse.json(
        {
          success: false,
          error: data?.error?.message || `Vercel API Error (${vercelRes.status})`,
          details: data,
        },
        { status: vercelRes.status || 500 }
      );
    }

    // ✅ Succès
    return NextResponse.json({
      success: true,
      deploymentId: data.id,
      url: `https://${data.url}`,
    });
  } catch (err: any) {
    console.error("🚨 Deploy route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
  
