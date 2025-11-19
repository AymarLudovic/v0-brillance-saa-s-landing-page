import { NextResponse } from 'next/server';

// Type défini par Vercel pour l'upload de fichiers
interface VercelFile {
  file: string;
  data: string;
}

export async function POST(req: Request) {
  try {
    const { projectName, token, files } = await req.json();

    if (!projectName || !token || !files) {
      return NextResponse.json({ error: 'Données manquantes (nom, token ou fichiers)' }, { status: 400 });
    }

    // 1. Transformation des fichiers pour l'API Vercel
    // L'API Vercel attend un tableau d'objets { file: 'path', data: 'content' }
    const deployFiles: VercelFile[] = files.map((f: any) => ({
      file: f.filePath, // ex: "app/page.tsx"
      data: f.content
    }));

    // Ajout indispensable de vercel.json pour forcer la config (optionnel mais recommandé)
    deployFiles.push({
        file: 'vercel.json',
        data: JSON.stringify({
            framework: "nextjs",
            buildCommand: "npm run build", // ou bun run build
            installCommand: "npm install"  // ou bun install
        })
    });

    // 2. Création du déploiement via l'API Vercel
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-'), // Slugify le nom
        files: deployFiles,
        projectSettings: {
          framework: 'nextjs',
        },
        target: 'production', // Déploie directement en prod
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Vercel Error:", data);
      return NextResponse.json({ success: false, error: data.error?.message || 'Erreur Vercel inconnue' }, { status: 500 });
    }

    // Succès : on renvoie l'ID du déploiement et l'URL
    return NextResponse.json({ 
        success: true, 
        deploymentId: data.id,
        url: data.url 
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
                               }
