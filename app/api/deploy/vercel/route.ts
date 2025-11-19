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

    // 1. Préparation des fichiers
    const deployFiles: VercelFile[] = files.map((f: any) => ({
      file: f.filePath,
      data: f.content
    }));

    // --- AUTO-RÉPARATION : Vérification des fichiers critiques ---
    
    // A. Vérifier package.json
    const hasPackageJson = deployFiles.some(f => f.file === 'package.json');
    if (!hasPackageJson) {
        deployFiles.push({
            file: 'package.json',
            data: JSON.stringify({
                name: projectName.toLowerCase().replace(/\s+/g, '-'),
                version: "0.1.0",
                private: true,
                scripts: {
                    "dev": "next dev",
                    "build": "next build",
                    "start": "next start",
                    "lint": "next lint"
                },
                dependencies: {
                    "react": "^18",
                    "react-dom": "^18",
                    "next": "14.2.16", // Version stable récente
                    "lucide-react": "^0.454.0",
                    "framer-motion": "^11.11.11",
                    "clsx": "^2.1.1",
                    "tailwind-merge": "^2.5.4"
                },
                devDependencies: {
                    "typescript": "^5",
                    "@types/node": "^20",
                    "@types/react": "^18",
                    "@types/react-dom": "^18",
                    "postcss": "^8",
                    "tailwindcss": "^3.4.1",
                    "eslint": "^8",
                    "eslint-config-next": "15.0.2"
                }
            }, null, 2)
        });
    }

    // B. Vérifier next.config.mjs (ou .js)
    const hasNextConfig = deployFiles.some(f => f.file.includes('next.config'));
    if (!hasNextConfig) {
        deployFiles.push({
            file: 'next.config.mjs',
            data: `/** @type {import('next').NextConfig} */
const nextConfig = {
    eslint: { ignoreDuringBuilds: true },
    typescript: { ignoreBuildErrors: true },
    images: { unoptimized: true }
};
export default nextConfig;`
        });
    }

    // 2. Création du déploiement sur Vercel
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-'),
        files: deployFiles,
        projectSettings: {
          framework: 'nextjs',
        },
        target: 'production',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Vercel API Error:", data);
      // On renvoie l'erreur précise de Vercel (ex: FILE_LIMIT_EXCEEDED)
      return NextResponse.json({ success: false, error: data.error?.code || data.error?.message || 'Erreur création déploiement' }, { status: 500 });
    }

    return NextResponse.json({ 
        success: true, 
        deploymentId: data.id,
        url: data.url 
    });

  } catch (error: any) {
    console.error("Server Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
                  }
