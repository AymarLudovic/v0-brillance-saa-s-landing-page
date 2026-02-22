import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProjectFile, StreamEvent, SearchResult } from '../../../lib/types';
import { getLanguage } from '../../../lib/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM = `Tu es un développeur expert qui crée des applications web complètes Next.js 15 / TypeScript / Tailwind CSS.
Tu travailles comme un vrai agent de développement : tu cherches sur le web, tu crées des fichiers, tu fais du vrai code.

RÈGLES ABSOLUES :
- Tout le code que tu génères est du VRAI code TypeScript/React fonctionnel, pas de placeholder
- Utilise Tailwind CSS pour le style (déjà configuré dans le projet)
- Les icônes : utilise lucide-react (déjà disponible)
- Composants : "use client" si hooks/interactions, sinon server component
- Imports : utilise les vrais imports npm (ex: import { useState } from 'react')
- Tous les fichiers créés vont dans le répertoire app/ ou components/
- Pour modifier un fichier existant : retourne le contenu COMPLET du fichier, pas juste les changements

FORMAT DE SORTIE STRICT :
Utilise ce format exact pour chaque fichier, sans dévier :

===FILE:chemin/vers/fichier.tsx===
DESCRIPTION:Ce que fait ce fichier
---CONTENT---
[contenu complet du fichier]
---END---

Pour ton message final à l'utilisateur :
===MESSAGE===
[ta réponse en français, naturelle, expliquant ce que tu as fait]
===END===

Ne mets RIEN en dehors de ces balises. Pas de markdown, pas d'explication avant les balises.`;

// ─── Dependency detection via npm registry ─────────────────────────────────

const BUILTIN_PACKAGES = new Set([
  'react', 'react-dom', 'next', 'typescript', '@types/node', '@types/react',
  '@types/react-dom', 'tailwindcss', 'postcss', 'autoprefixer', 'lucide-react',
  'iconsax-reactjs', 'iconoir-react',
]);

async function detectDeps(files: ProjectFile[]): Promise<Record<string, string>> {
  const found = new Set<string>();
  const importRe = /from\s+['"]([^'"./][^'"]*)['"]/g;
  for (const f of files) {
    for (const [, pkg] of f.content.matchAll(importRe)) {
      const name = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
      if (!BUILTIN_PACKAGES.has(name)) found.add(name);
    }
  }
  const versions: Record<string, string> = {};
  await Promise.all([...found].map(async pkg => {
    try {
      const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) { const d = await r.json(); versions[pkg] = `^${d.version}`; }
      else versions[pkg] = 'latest';
    } catch { versions[pkg] = 'latest'; }
  }));
  return versions;
}

// ─── Tavily search ────────────────────────────────────────────────────────────

async function tavilySearch(query: string, baseUrl: string): Promise<SearchResult[]> {
  try {
    const r = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const d = await r.json();
    return d.results ?? [];
  } catch { return []; }
}

// ─── HTML Cloner (calls our existing /api/chat) ──────────────────────────────

async function cloneHtml(imageBase64: string, mimeType: string, baseUrl: string): Promise<string | null> {
  const fd = new FormData();
  fd.append('message', 'Reproduis cette interface en HTML/CSS pixel-perfect.');
  fd.append('history', '[]');
  fd.append('mode', 'clone');
  const blob = await fetch(`data:${mimeType};base64,${imageBase64}`).then(r => r.blob());
  fd.append('image', blob, 'image.jpg');
  const r = await fetch(`${baseUrl}/api/chat`, { method: 'POST', body: fd });
  const d = await r.json();
  return d.htmlCode ?? null;
}

// ─── Stream parser ────────────────────────────────────────────────────────────

interface ParsedFile { path: string; description: string; content: string }

function parseOutput(text: string): { files: ParsedFile[]; message: string } {
  const files: ParsedFile[] = [];
  const fileRe = /===FILE:([^\n=]+)===\nDESCRIPTION:([^\n]*)\n---CONTENT---\n([\s\S]*?)---END---/g;
  for (const [, path, description, content] of text.matchAll(fileRe)) {
    files.push({ path: path.trim(), description: description.trim(), content: content.trim() });
  }
  const msgMatch = text.match(/===MESSAGE===\n([\s\S]*?)===END===/);
  const message = msgMatch ? msgMatch[1].trim() : '';
  return { files, message };
}

// ─── Main POST handler ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const emit = async (ev: StreamEvent) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
  };

  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const run = async () => {
    try {
      const formData = await req.formData();
      const message = formData.get('message') as string;
      const historyRaw = formData.get('history') as string;
      const filesRaw = formData.get('files') as string;
      const sandboxId = formData.get('sandboxId') as string | null;
      const imageFiles = formData.getAll('images') as File[];
      const docFiles = formData.getAll('documents') as File[];

      const history: { role: string; content: string }[] = JSON.parse(historyRaw || '[]');
      const projectFiles: ProjectFile[] = JSON.parse(filesRaw || '[]');

      await emit({ type: 'thinking', content: 'Analyse de votre demande...' });

      // ── HTML Clone if image attached ─────────────────────────────────────
      let clonedHtml: string | null = null;
      if (imageFiles.length > 0) {
        const cloneId = 'clone-1';
        await emit({ type: 'html_clone_start', id: cloneId });
        const firstImg = imageFiles[0];
        const bytes = await firstImg.arrayBuffer();
        const b64 = Buffer.from(bytes).toString('base64');
        clonedHtml = await cloneHtml(b64, firstImg.type || 'image/jpeg', baseUrl);
        await emit({ type: 'html_clone_done', id: cloneId, path: 'app/page.tsx' });
      }

      // ── Planning call — quick, decide if web search needed ───────────────
      const planModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
      const planPrompt = `L'utilisateur demande : "${message}"
Réponds en JSON uniquement (pas de markdown) : {"needsSearch": boolean, "queries": ["q1","q2"]}
needsSearch = true si des informations récentes, docs techniques, prix, actualités sont nécessaires.`;

      let needsSearch = false;
      let searchQueries: string[] = [];
      try {
        const planRes = await planModel.generateContent({ contents: [{ role: 'user', parts: [{ text: planPrompt }] }] });
        const planText = planRes.response.text().replace(/```json|```/g, '').trim();
        const plan = JSON.parse(planText);
        needsSearch = plan.needsSearch ?? false;
        searchQueries = plan.queries ?? [];
      } catch { /* skip planning if fails */ }

      // ── Web searches ─────────────────────────────────────────────────────
      const searchResults: { query: string; results: SearchResult[] }[] = [];
      if (needsSearch && searchQueries.length > 0) {
        await Promise.all(searchQueries.map(async (query, i) => {
          const id = `search-${i}`;
          await emit({ type: 'search_start', id, query });
          const results = await tavilySearch(query, baseUrl);
          searchResults.push({ query, results });
          await emit({ type: 'search_done', id, results });
        }));
      }

      // ── Build generation prompt ─────────────────────────────────────────
      let prompt = `DEMANDE UTILISATEUR : ${message}\n\n`;

      if (clonedHtml) {
        prompt += `UI GÉNÉRÉE (HTML/CSS pixel-perfect depuis l'image) :\nConvertis ce HTML en composant Next.js React TypeScript fonctionnel.\nConserve TOUS les styles (inline styles, couleurs, spacings, fonts) IDENTIQUES.\nNe change pas le design. Ajoute uniquement les imports React nécessaires.\n\n\`\`\`html\n${clonedHtml}\n\`\`\`\n\n`;
      }

      if (searchResults.length > 0) {
        prompt += `RÉSULTATS DE RECHERCHE WEB :\n`;
        for (const { query, results } of searchResults) {
          prompt += `\nRecherche: "${query}"\n`;
          results.forEach((r, i) => { prompt += `${i + 1}. ${r.title} (${r.url})\n${r.snippet}\n`; });
        }
        prompt += '\n';
      }

      if (projectFiles.length > 0) {
        prompt += `FICHIERS EXISTANTS DU PROJET :\n`;
        for (const f of projectFiles) {
          prompt += `\n[${f.path}]\n\`\`\`\n${f.content}\n\`\`\`\n`;
        }
        prompt += '\n';
      }

      if (history.length > 0) {
        prompt += `HISTORIQUE RÉCENT :\n`;
        history.slice(-6).forEach(m => { prompt += `${m.role === 'user' ? 'USER' : 'AI'}: ${m.content.slice(0, 400)}\n`; });
        prompt += '\n';
      }

      if (sandboxId) {
        prompt += `SANDBOX ID: ${sandboxId} (le projet tourne sur E2B)\n\n`;
      }

      // ── Documents ────────────────────────────────────────────────────────
      type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
      const parts: GeminiPart[] = [{ text: prompt }];
      for (const doc of docFiles.slice(0, 3)) {
        const bytes = await doc.arrayBuffer();
        parts.push({ inlineData: { mimeType: doc.type || 'application/pdf', data: Buffer.from(bytes).toString('base64') } });
      }
      for (const img of imageFiles.slice(0, 5)) {
        const bytes = await img.arrayBuffer();
        parts.push({ inlineData: { mimeType: img.type || 'image/jpeg', data: Buffer.from(bytes).toString('base64') } });
      }

      // ── Generation call ─────────────────────────────────────────────────
      const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        systemInstruction: SYSTEM,
      });

      await emit({ type: 'thinking', content: 'Génération du code...' });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: 65536, temperature: 0.1 },
      });

      const rawOutput = result.response.text();
      const { files, message: aiMessage } = parseOutput(rawOutput);

      // ── Emit file events ──────────────────────────────────────────────────
      const newFiles: ProjectFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const id = `file-${i}`;
        await emit({ type: 'file_start', id, path: f.path, description: f.description });
        await new Promise(r => setTimeout(r, 80)); // small pause for UI
        const language = getLanguage(f.path);
        newFiles.push({ path: f.path, content: f.content, language });
        await emit({ type: 'file_done', id, path: f.path, content: f.content });
      }

      // ── Dependency detection ─────────────────────────────────────────────
      if (newFiles.length > 0) {
        const deps = await detectDeps(newFiles);
        if (Object.keys(deps).length > 0) {
          await emit({ type: 'deps_detected', id: 'deps-1', packages: deps });
        }
      }

      await emit({ type: 'message', content: aiMessage || 'Voici le code généré.' });
      await emit({ type: 'done' });
    } catch (err: unknown) {
      await emit({ type: 'error', message: err instanceof Error ? err.message : 'Erreur inconnue' });
      await emit({ type: 'done' });
    } finally {
      await writer.close();
    }
  };

  run();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
  }
