import { NextResponse } from 'next/server';

interface VercelFile {
  file: string;
  data: string;
}

export async function POST(req: Request) {
  try {
    const { projectName, token, files } = await req.json();

    if (!projectName || !token || !files) {
      return NextResponse.json({ error: 'Données manquantes' }, { status: 400 });
    }

    const cleanProjectName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // =================================================================================
    // ÉTAPE 1 : GESTION DU PROJET (Inspiré de ton code fonctionnel)
    // On doit s'assurer que le projet existe sur Vercel pour avoir son ID et forcer le framework Next.js
    // =================================================================================
    
    let projectId = '';
    
    // 1.A. On essaie de récupérer le projet existant
    // Note: On utilise /v9/projects avec le nom pour voir s'il existe
    const getProjectRes = await fetch(`https://api.vercel.com/v9/projects/${cleanProjectName}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    if (getProjectRes.ok) {
        const projectData = await getProjectRes.json();
        projectId = projectData.id;
    } else {
        // 1.B. S'il n'existe pas, on le CRÉE explicitement avec le framework Next.js
        console.log("Projet introuvable, création en cours...");
        // ... à l'intérieur de la condition !getProjectRes.ok
const createProjectRes = await fetch('https://api.vercel.com/v13/projects', {
    method: 'POST',
    headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        name: cleanProjectName,
        framework: 'nextjs',
        // On retire gitRepository: null ici
    }),
});

        if (!createProjectRes.ok) {
            const err = await createProjectRes.json();
            throw new Error(`Impossible de créer le projet : ${err.error?.message}`);
        }

        const newProject = await createProjectRes.json();
        projectId = newProject.id;
    }

    // =================================================================================
    // ÉTAPE 2 : PRÉPARATION DES FICHIERS & AUTO-RÉPARATION
    // =================================================================================

    const deployFiles: VercelFile[] = files.map((f: any) => ({
      // On retire le slash initial s'il existe (ex: /app/page.tsx -> app/page.tsx)
      file: f.filePath.startsWith('/') ? f.filePath.substring(1) : f.filePath,
      data: f.content
    }));

    // --- INJECTION DES FICHIERS MANQUANTS (Pour éviter le crash du build) ---

    // A. package.json
    if (!deployFiles.some(f => f.file === 'package.json')) {
        deployFiles.push({
            file: 'package.json',
            data: JSON.stringify({
                name: cleanProjectName,
                version: "0.1.0",
                scripts: {
                    "dev": "next dev",
                    "build": "next build",
                    "start": "next start"
                },
                dependencies: {
                    "react": "^18",
                    "react-dom": "^18",
                    "next": "14.2.3",
                    "lucide-react": "latest",
                    "clsx": "latest",
                    "tailwind-merge": "latest",
                    "framer-motion": "latest"
                },
                devDependencies: {
                    "typescript": "^5",
                    "@types/node": "^20",
                    "@types/react": "^18",
                    "@types/react-dom": "^18",
                    "postcss": "^8",
                    "tailwindcss": "^3.4.1",
                    "eslint": "^8",
                    "eslint-config-next": "14.2.3"
                }
            }, null, 2)
        });
    }

    // B. next.config.mjs
    if (!deployFiles.some(f => f.file.includes('next.config'))) {
        deployFiles.push({
            file: 'next.config.mjs',
            data: `/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    images: { unoptimized: true }
};
export default nextConfig;`
        });
    }

    // C. app/layout.tsx (Obligatoire pour Next.js App Router)
    const hasLayout = deployFiles.some(f => f.file.includes('app/layout') || f.file === 'app/layout.tsx');
    if (!hasLayout) {
        deployFiles.push({
            file: 'app/layout.tsx',
            data: `import React from 'react';
import './globals.css';
export const metadata = { title: '${projectName}' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`
        });
    }

    // D. app/globals.css
    if (!deployFiles.some(f => f.file.includes('globals.css'))) {
         deployFiles.push({
            file: 'app/globals.css',
            data: `@tailwind base; @tailwind components; @tailwind utilities; body { background: #fff; color: #000; }`
         });
    }

    // =================================================================================
    // ÉTAPE 3 : CRÉATION DU DÉPLOIEMENT DANS LE PROJET CIBLÉ
    // =================================================================================

    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanProjectName,
        project: projectId, // <--- C'est la clé ! On lie le déploiement au projet configuré
        target: 'production',
        files: deployFiles,
        projectSettings: {
          framework: 'nextjs', // On force encore pour être sûr
        }
      }),
    });

    const data = await deployResponse.json();

    if (!deployResponse.ok) {
      console.error("Vercel Error:", data);
      return NextResponse.json({ success: false, error: data.error?.message || 'Erreur déploiement Vercel' }, { status: 500 });
    }

    return NextResponse.json({ 
        success: true, 
        deploymentId: data.id,
        url: data.url,
        projectId: projectId
    });

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
                                                                            }
