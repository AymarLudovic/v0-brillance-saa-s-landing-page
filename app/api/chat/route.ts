import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const SYSTEM_CLONE = `Tu es un expert en reproduction pixel-perfect d'interfaces UI en HTML/CSS pur.
Génère du HTML complet, sans jamais te couper avant </html>.

MODE : CLONE PIXEL-PERFECT
- Copie chaque élément visible : layout, typographie, couleurs, ombres, bordures, icônes, avatars, logos
- Respecte les proportions et espacements exacts

══════════════════════════════════════════
COULEURS — MAPPING PAR ZONE OBLIGATOIRE
══════════════════════════════════════════
Le frontend t'envoie les couleurs EXACTES extraites par Canvas API, organisées par zone :
- "sidebar-gauche"    → fond et textes de la sidebar
- "header-top"        → fond et textes du header
- "contenu-principal" → fond du contenu main
- "coin-haut-gauche"  → zone logo/titre
- "bas-page"          → footer ou barre basse
- "milieu-centre"     → cards et composants centraux
- "colonne-droite"    → panneau droit si présent

RÈGLE : la couleur la plus fréquente d'une zone = son background. Les moins fréquentes = textes/bordures.
Déclare tout en CSS variables :root {} avec des noms sémantiques clairs. N'invente AUCUNE couleur.

══════════════════════════════════════════
ESPACEMENTS — TOUJOURS SERRÉ
══════════════════════════════════════════
- En cas de doute : prendre la valeur INFÉRIEURE
- Texte interface = 12px-13px, Icônes = 14px-16px
- Padding bouton compact = 4px 10px, Padding card = 10px-14px max
- Border-radius subtil = 4px-6px, Gap items = 2px-4px

══════════════════════════════════════════
ICÔNES — TABLER ICONS UNIQUEMENT
══════════════════════════════════════════
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css">
<i class="ti ti-[nom]"></i>

══════════════════════════════════════════
LOGOS D'ENTREPRISES
══════════════════════════════════════════
<img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" style="width:18px;height:18px;object-fit:contain">

══════════════════════════════════════════
AVATARS
══════════════════════════════════════════
<img src="https://api.dicebear.com/9.x/lorelei/svg?seed=NOM&backgroundColor=b6e3f4,c0aede,d1d4f9" style="width:28px;height:28px;border-radius:50%">

STRUCTURE : <!DOCTYPE html>...<html>...<head>...<body>...</body></html>
NE JAMAIS S'ARRÊTER AVANT </html>

FORMAT : Image → UNIQUEMENT \`\`\`html ... \`\`\` — Question → français`;

const SYSTEM_CREATE = `Tu es un expert UI/UX qui crée de nouvelles interfaces HTML/CSS à partir d'un design system de référence.
Génère du HTML complet, sans jamais te couper avant </html>.

MODE : CRÉATION AVEC DESIGN SYSTEM
1. ANALYSE l'image pour extraire le design system (composants, couleurs, typographie, style visuel)
2. CRÉE la nouvelle page demandée en utilisant exactement ces composants et couleurs
   - Même style CSS, mêmes espacements, même typographie
   - Du VRAI CONTENU pertinent (pas de Lorem ipsum)
   - La page doit sembler faire partie de la même application

[Mêmes règles couleurs/icônes/logos/avatars/structure que le mode clone]

NE JAMAIS S'ARRÊTER AVANT </html>
FORMAT : Image + demande → UNIQUEMENT \`\`\`html ... \`\`\` — Question → français`;

function buildColorPrompt(colorsRaw: string): string {
  const colors: { hex: string; frequency: number; zone: string }[] = JSON.parse(colorsRaw);
  const byZone: Record<string, { hex: string; frequency: number }[]> = {};
  for (const c of colors) {
    if (!byZone[c.zone]) byZone[c.zone] = [];
    byZone[c.zone].push({ hex: c.hex, frequency: c.frequency });
  }
  let block = '\n══ COULEURS CANVAS PAR ZONE ══\n';
  for (const [zone, cols] of Object.entries(byZone)) {
    const sorted = cols.sort((a, b) => b.frequency - a.frequency);
    block += `\n[${zone}]\n  → fond : ${sorted[0].hex}\n`;
    const rest = sorted.slice(1, 3).map(c => c.hex).join(', ');
    if (rest) block += `  → textes/détails : ${rest}\n`;
  }
  block += '\nRègle : applique chaque hex à sa zone. sidebar-gauche → --sidebar-bg, header-top → --header-bg, contenu-principal → --main-bg, milieu-centre → --card-bg. Génère jusqu\'au </html> final sans t\'arrêter.';
  return block;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const message = formData.get('message') as string;
    const imageFile = formData.get('image') as File | null;
    const historyRaw = formData.get('history') as string;
    const colorsRaw = formData.get('colors') as string | null;
    const mode = (formData.get('mode') as string) || 'clone';
    const history: { role: string; content: string }[] = JSON.parse(historyRaw || '[]');

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      systemInstruction: mode === 'create' ? SYSTEM_CREATE : SYSTEM_CLONE,
    });

    const geminiHistory = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history: geminiHistory,
      generationConfig: { maxOutputTokens: 65536, temperature: 0.05 },
    });

    type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
    const parts: Part[] = [];

    if (imageFile) {
      const bytes = await imageFile.arrayBuffer();
      const base64 = Buffer.from(bytes).toString('base64');
      parts.push({ inlineData: { mimeType: imageFile.type || 'image/jpeg', data: base64 } });
    }

    let prompt = message || (mode === 'create'
      ? 'Crée une nouvelle page en utilisant le design system de cette image.'
      : 'Reproduis cette interface en HTML/CSS pixel-perfect.');

    if (colorsRaw) prompt += buildColorPrompt(colorsRaw);
    parts.push({ text: prompt });

    const result = await chat.sendMessage(parts);
    const rawContent = result.response.text();

    // Tolerant HTML extraction
    let htmlCode: string | null = null;
    const strictMatch = rawContent.match(/```html\n?([\s\S]*?)```/i);
    if (strictMatch) {
      htmlCode = strictMatch[1].trim();
    } else {
      const looseMatch = rawContent.match(/```html\n?([\s\S]*)/i);
      if (looseMatch) {
        let candidate = looseMatch[1].trim().replace(/```\s*$/, '').trim();
        if (candidate.includes('<html') || candidate.includes('<!DOCTYPE')) {
          if (!candidate.includes('</html>')) {
            if (!candidate.includes('</body>')) candidate += '\n</body>';
            candidate += '\n</html>';
          }
          htmlCode = candidate;
        }
      }
    }

    return NextResponse.json({ content: rawContent, htmlCode });
  } catch (error: unknown) {
    console.error('Erreur Gemini:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur inconnue' },
      { status: 500 }
    );
  }
}
