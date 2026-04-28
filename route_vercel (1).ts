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

    // files peut être { filePath, content }[] (depuis sandbox) ou autre format
    const deployFiles: VercelFile[] = (files as any[]).map((f: any) => {
      const fp = f.filePath || f.file || '';
      const content = f.content ?? f.data ?? '';
      return {
        file: fp.startsWith('/') ? fp.substring(1) : fp,
        data: content,
      };
    }).filter(f => f.file && typeof f.data === 'string')
    // ── Exclure les fichiers Python/backend — incompatibles Vercel serverless ──
    .filter(f => {
      const p = f.file.toLowerCase();
      return !p.startsWith('backend/') &&
             !p.startsWith('venv/') &&
             !p.startsWith('.venv/') &&
             !p.endsWith('.py') &&
             !p.endsWith('.pyc') &&
             !p === 'requirements.txt' &&
             !p.includes('__pycache__') &&
             !p.includes('node_modules/') &&
             !p.includes('.next/') &&
             !p.endsWith('.log') &&
             !p.endsWith('.lock') &&
             f.data.length < 500_000; // skip fichiers trop lourds
    });

    // ── Patcher next.config pour retirer les rewrites FastAPI et la prop target dépréciée ──
    const nextConfigIdx = deployFiles.findIndex(f => f.file.includes('next.config'));
    if (nextConfigIdx >= 0) {
      let cfg = deployFiles[nextConfigIdx].data;
      // Retirer rewrites FastAPI
      cfg = cfg.replace(/async rewrites\s*\(\s*\)[^}]*\{[\s\S]*?return\s*\[[\s\S]*?\][\s\S]*?\}/g, '');
      // Retirer la prop target dépréciée (cause "The target property is no longer supported")
      cfg = cfg.replace(/\btarget\s*:\s*['"][^'"]*['"]\s*,?\s*/g, '');
      // Ajouter ignoreBuildErrors si absent
      if (!cfg.includes('ignoreBuildErrors')) {
        cfg = cfg.replace(
          /const nextConfig[^=]*=\s*\{/,
          'const nextConfig = {\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },'
        );
      }
      deployFiles[nextConfigIdx].data = cfg;
    } else {
      // Injecter un next.config.mjs propre si absent
      deployFiles.push({
        file: 'next.config.mjs',
        data: `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },\n  images: { unoptimized: true },\n};\nexport default nextConfig;`
      });
    }

    // --- INJECTION DES FICHIERS MANQUANTS ---

    // A. next.config.mjs — avec ignoreBuildErrors pour éviter les crashes TypeScript/ESLint
    if (!deployFiles.some(f => f.file.includes('next.config'))) {
        deployFiles.push({
            file: 'next.config.mjs',
            data: `/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    images: { unoptimized: true },
};
export default nextConfig;`
        });
    } else {
        // Patch le next.config existant pour ajouter ignoreBuildErrors s'il n'y est pas
        const idx = deployFiles.findIndex(f => f.file.includes('next.config'));
        if (idx >= 0 && !deployFiles[idx].data.includes('ignoreBuildErrors')) {
            deployFiles[idx].data = deployFiles[idx].data.replace(
                /const nextConfig[^=]+=\s*\{/,
                'const nextConfig = {\n    typescript: { ignoreBuildErrors: true },\n    eslint: { ignoreDuringBuilds: true },'
            );
        }
    }

    // B. package.json — aligné avec les versions du sandbox
    if (!deployFiles.some(f => f.file === 'package.json')) {
        deployFiles.push({
            file: 'package.json',
            data: JSON.stringify({
                name: cleanProjectName,
                version: "0.1.0",
                private: true,
                scripts: { dev: "next dev", build: "next build", start: "next start" },
                dependencies: {
                    "next": "15.1.0",
                    "react": "19.0.0",
                    "react-dom": "19.0.0",
                    "lucide-react": "0.475.0",
                    "clsx": "2.1.1",
                    "tailwind-merge": "2.3.0",
                },
                devDependencies: {
                    "typescript": "^5",
                    "@types/node": "^20",
                    "@types/react": "^19",
                    "@types/react-dom": "^19",
                    "postcss": "^8",
                    "tailwindcss": "^3.4.1",
                    "autoprefixer": "^10.4.19",
                    "eslint": "^8",
                    "eslint-config-next": "15.1.0",
                }
            }, null, 2)
        });
    }

    // C. app/layout.tsx
    const hasLayout = deployFiles.some(f => f.file === 'app/layout.tsx' || f.file.endsWith('/layout.tsx'));
    if (!hasLayout) {
        deployFiles.push({
            file: 'app/layout.tsx',
            data: `import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '${projectName}' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}`
        });
    }

    // D. app/globals.css
    if (!deployFiles.some(f => f.file.includes('globals.css'))) {
        deployFiles.push({
            file: 'app/globals.css',
            data: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\nbody { background: #fff; color: #000; }`
        });
    }

    // E. tailwind.config.ts
    if (!deployFiles.some(f => f.file.includes('tailwind.config'))) {
        deployFiles.push({
            file: 'tailwind.config.ts',
            data: `import type { Config } from 'tailwindcss';\nconst config: Config = {\n  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}','./components/**/*.{js,ts,jsx,tsx,mdx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\nexport default config;`
        });
    }

    // F. postcss.config.js
    if (!deployFiles.some(f => f.file.includes('postcss.config'))) {
        deployFiles.push({
            file: 'postcss.config.js',
            data: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`
        });
    }

    // G. tsconfig.json
    if (!deployFiles.some(f => f.file === 'tsconfig.json')) {
        deployFiles.push({
            file: 'tsconfig.json',
            data: JSON.stringify({
                compilerOptions: {
                    target: "ES2017", lib: ["dom","dom.iterable","esnext"],
                    allowJs: true, skipLibCheck: true, strict: false,
                    noEmit: true, esModuleInterop: true, module: "esnext",
                    moduleResolution: "bundler", resolveJsonModule: true,
                    isolatedModules: true, jsx: "preserve", incremental: true,
                    plugins: [{ name: "next" }], paths: { "@/*": ["./*"] }
                },
                include: ["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],
                exclude: ["node_modules"]
            }, null, 2)
        });
    }

    // H. app/not-found.tsx
    if (!deployFiles.some(f => f.file.includes('not-found'))) {
        deployFiles.push({ file: 'app/not-found.tsx', data: `export default function NotFound() { return <div>404</div>; }` });
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
