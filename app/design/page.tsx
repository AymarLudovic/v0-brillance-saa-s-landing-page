// Placez ce code dans votre répertoire d'application Next.js, par exemple: app/library/page.tsx

"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import localforage from 'localforage'; 

// Configuration de LocalForage (IndexedDB)
localforage.config({
    name: 'StyleDesignLibrary',
    storeName: 'themes_and_styles',
    description: 'Style library for AI designer themes'
});

const DB_KEY = 'styleLibrary'; 
const DEFAULT_SECTION_NAME = 'style_component'; // Nom par défaut pour la section de style analysée

// --- Types pour la gestion des données ---
interface StyleSection { 
  id: string; // ID unique pour cette analyse (site)
  name: string; // Nom de la section/analyse (ex: 'header_nav')
  css: string; // Le CSS isolé
  html: string; // Le HTML isolé
  url: string; // URL du site d'origine
}

interface ThemeStyle {
  id: string; 
  name: string; 
  sections: StyleSection[]; 
  baseUrl: string; 
}

interface AnalysisResult {
  success: boolean;
  fullHTML: string;
  fullCSS: string;
  fullJS: string;
  urlAnalyzed: string;
  error?: string;
  details?: string;
}

// --- Fonctions d'Utilité d'Isolation CSS/HTML (Simplifié) ---

/**
 * Tente d'extraire les règles CSS pertinentes basées sur les classes/IDs de l'élément.
 * C'est une extraction heuristique : elle cherche les blocs qui contiennent les sélecteurs.
 */
const extractRelevantCss = (fullCSS: string, element: HTMLElement): string => {
    const selectors = new Set<string>();
    
    // 1. Collecte récursive des sélecteurs (classe, ID, tag) de l'élément et de ses descendants
    const collectSelectors = (el: HTMLElement) => {
        if (el.className) {
            el.className.split(/\s+/).forEach(cls => selectors.add('.' + cls.trim()));
        }
        if (el.id) {
            selectors.add('#' + el.id.trim());
        }
        selectors.add(el.tagName.toLowerCase());

        Array.from(el.children).forEach(child => {
            if (child instanceof HTMLElement) {
                collectSelectors(child);
            }
        });
    };
    collectSelectors(element);

    if (selectors.size === 0) return '';

    // 2. Création d'une RegExp pour matcher les règles
    // On échappe les caractères spéciaux pour l'utilisation dans la RegExp
    const safeSelectors = Array.from(selectors)
        .filter(s => s.length > 1) // Ignore les tags trop génériques comme 'body'
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    
    // Si aucun sélecteur n'a été collecté (ex: simple div sans classe), on s'arrête.
    if (!safeSelectors) return '';

    // Regex pour capturer tout bloc de règle CSS contenant un de nos sélecteurs.
    // (?:[^{]*?) permet de capturer les media queries et autres préfixes.
    const aggressiveRuleRegex = new RegExp(`([^}]+)({[^}]*})`, 'gs');
    
    let relevantCss = '';
    let match;
    
    while ((match = aggressiveRuleRegex.exec(fullCSS)) !== null) {
        const selectorsPart = match[1]; // Ex: .container > p
        const ruleBlock = match[0];    // Ex: .container > p { color: red; }
        
        let shouldInclude = false;
        // Vérifie si un de nos sélecteurs est inclus dans la partie sélecteurs de la règle
        selectors.forEach(selector => {
            if (selectorsPart.includes(selector)) {
                shouldInclude = true;
            }
        });

        if (shouldInclude) {
            relevantCss += ruleBlock + '\n';
        }
    }

    // Ajout d'une base minimale (utile pour le rendu isolé)
    return `
html, body {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: inherit;
    font-size: 100%;
}
${relevantCss}`;
};


// Composant principal de la librairie de styles
const StyleLibraryManager: React.FC = () => {
  const [url, setUrl] = useState('');
  const [themeName, setThemeName] = useState('new_theme');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [library, setLibrary] = useState<ThemeStyle[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<ThemeStyle | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [apiError, setApiError] = useState<string | null>(null); 
  const [dbStatus, setDbStatus] = useState<string>('Initialisation du stockage...');
  
  // --- NOUVEAUX ÉTATS POUR L'ISOLATION ---
  const [isolatedHtml, setIsolatedHtml] = useState('');
  const [isolatedCss, setIsolatedCss] = useState('');
  const [isolatedName, setIsolatedName] = useState(DEFAULT_SECTION_NAME);
  const [isComponentIsolated, setIsComponentIsolated] = useState(false);


  // --- Gestion du Stockage (LocalForage/IndexedDB) ---

  const loadLibrary = useCallback(async () => {
    try {
      setDbStatus('Chargement...');
      const storedLibrary = await localforage.getItem(DB_KEY) as ThemeStyle[] | null;
      if (storedLibrary) {
        setLibrary(storedLibrary);
        // Tente de sélectionner le dernier thème pour une meilleure UX
        setSelectedTheme(storedLibrary[storedLibrary.length - 1] || null);
        setDbStatus(`Librairie chargée. ${storedLibrary.length} thèmes trouvés.`);
      } else {
        setLibrary([]);
        setDbStatus('Aucun thème trouvé. Démarrage de la librairie.');
      }
    } catch (e: any) {
      setDbStatus(`Erreur de chargement de la base de données: ${e.message}`);
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);


  const saveLibrary = useCallback(async (newLibrary: ThemeStyle[]) => {
    setLibrary(newLibrary);
    setApiError(null); 

    try {
      setDbStatus('Sauvegarde en cours...');
      await localforage.setItem(DB_KEY, newLibrary);
      setDbStatus(`Sauvegarde réussie de ${newLibrary.length} thèmes.`);
    } catch (e: any) {
      const errorMsg = e.message || e.name || 'Erreur inconnue lors de la sauvegarde.';
      setApiError(`[ERREUR DE SAUVEGARDE DB] Impossible de sauvegarder la librairie. Détails: ${errorMsg}`);
      setDbStatus(`Échec de la sauvegarde.`);
    }
  }, []);

  // --- 1. Analyse (Charge l'état d'analyse, ne sauvegarde plus le full site) ---
  const handleAnalyzeAndSave = async () => {
    if (!url || !themeName) return;
    setLoading(true);
    setAnalysis(null);
    setApiError(null); 
    setIsComponentIsolated(false); // Réinitialiser l'isolation
    setIsolatedHtml('');
    setIsolatedCss('');

    let urlToAnalyze = url;
    if (!/^https?:\/\//i.test(urlToAnalyze)) {
        urlToAnalyze = "https://" + urlToAnalyze;
    }
    
    let baseUrl: string;
    try {
      baseUrl = new URL(urlToAnalyze).origin + '/';
    } catch {
      setApiError("URL non valide.");
      setLoading(false);
      return;
    }

    try {
      // 1. Appel à l'API Next.js
      const response = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToAnalyze }),
      });

      const data: AnalysisResult = await response.json();
      
      if (!response.ok || !data.success) {
        const errorMessage = data.error || `Erreur HTTP: ${response.status} ${response.statusText}`;
        const errorDetails = data.details || "Aucun détail d'erreur fourni.";
        setApiError(`[API ÉCHOUÉE] ${errorMessage} | Détails: ${errorDetails}`);
        setAnalysis(null);
        return; 
      }

      // 2. Met à jour l'état d'analyse
      const newAnalysis: AnalysisResult = {...data, urlAnalyzed: baseUrl};
      setAnalysis(newAnalysis);

      const normalizedThemeName = themeName.replace(/\s/g, '_').toLowerCase();

      // 3. Crée le thème s'il n'existe pas, ou le sélectionne
      let themeFound = library.find(t => t.name === normalizedThemeName);
      if (!themeFound) {
          themeFound = {
              id: Date.now().toString(),
              name: normalizedThemeName, 
              baseUrl: baseUrl,
              sections: [], // Commence vide, on sauvera les composants isolés plus tard
          };
          const newLibrary = [...library, themeFound];
          await saveLibrary(newLibrary);
      }
      setSelectedTheme(themeFound);
      
    } catch (error: any) {
      setApiError(`[ERREUR RÉSEAU/PARSE] ${error.message}. Vérifiez la console.`);
    } finally {
      setLoading(false);
    }
  };

  // --- IFrame Interactivité et Isolation ---

  const handleIframeLoad = (iframe: HTMLIFrameElement | null) => {
    if (!iframe || !iframe.contentDocument || !analysis || !analysis.success) return;

    const doc = iframe.contentDocument;
    const body = doc.body;

    // Réinitialisation du curseur pour l'interaction
    body.style.cursor = 'crosshair';

    // Fonction de surlignement à la souris
    const handleMouseOver = (e: MouseEvent) => {
        if (!(e.target instanceof HTMLElement) || e.target === body || e.target === doc.documentElement) return;
        e.stopPropagation();

        doc.querySelectorAll('[data-highlighted]').forEach(el => {
            (el as HTMLElement).style.outline = 'none';
            (el as HTMLElement).removeAttribute('data-highlighted');
        });

        (e.target as HTMLElement).style.outline = '3px solid #FF9800';
        (e.target as HTMLElement).setAttribute('data-highlighted', 'true');
    };

    // Fonction de clic pour isoler le composant
    const handleClick = (e: MouseEvent) => {
        if (!(e.target instanceof HTMLElement) || e.target === body || e.target === doc.documentElement) return;
        e.preventDefault();
        e.stopPropagation();
        
        const selectedElement = e.target as HTMLElement;

        // 1. Isolation du HTML
        const html = selectedElement.outerHTML;
        
        // 2. Isolation du CSS (utilisation de la fonction utilitaire)
        const css = extractRelevantCss(analysis.fullCSS, selectedElement);
            
        // 3. Mise à jour des états
        setIsolatedHtml(html);
        setIsolatedCss(css);
        
        // Crée un nom descriptif
        const descriptiveName = selectedElement.tagName.toLowerCase() + 
            (selectedElement.id ? `#${selectedElement.id}` : 
             (selectedElement.className ? `.${selectedElement.className.split(/\s+/)[0]}` : ''));
        setIsolatedName(descriptiveName);
        setIsComponentIsolated(true);
        setApiError(null); 
    };

    // Attache les écouteurs d'événements
    body.addEventListener('mouseover', handleMouseOver);
    body.addEventListener('click', handleClick);
    
    // Nettoyage au déchargement (via le retour du useEffect ou un useRef, ici on se base sur la prochaine charge)
    // C'est un simple `onLoad`, donc les listeners sont attachés à chaque fois.
    // L'important est que l'isolation fonctionne.
  };


  // --- 2. Génération de l'iFrame COMPLET (Visualisation de l'analyse) ---
  const iframeContent = useMemo(() => {
    if (!analysis || !analysis.success) return '';

    const baseHref = analysis.urlAnalyzed;

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${baseHref}"> 
          <style>${analysis.fullCSS}</style>
          <style>
            /* Disable user selection/interaction feedback */
            * { user-select: none; }
            /* Hide scrollbars for cleaner preview */
            ::-webkit-scrollbar { display: none; }
          </style>
      </head>
      <body>
          ${analysis.fullHTML}
          <script>${analysis.fullJS}</script>
          <style>
            body {
                margin: 0;
                padding: 0;
            }
          </style>
      </body>
      </html>
    `;
  }, [analysis]);

  // --- IFrame ISOLÉ (Visualisation du composant sélectionné) ---
  const isolatedIframeContent = useMemo(() => {
    if (!isComponentIsolated) return '';

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            ${isolatedCss}
          </style>
          <style>
            body { 
                margin: 10px; 
                padding: 10px; 
                border: 1px dashed blue; 
                min-height: 90vh;
            }
          </style>
      </head>
      <body>
          ${isolatedHtml}
      </body>
      </html>
    `;
  }, [isolatedHtml, isolatedCss, isComponentIsolated]);


  // --- 3. Gestion des Thèmes et Sections (Sauvegarde et Suppression) ---
  
  // NOUVELLE FONCTION: Sauvegarde le composant isolé
  const handleSaveIsolatedComponent = async () => {
    if (!isolatedHtml || !isolatedCss || !selectedTheme || !analysis) {
        setApiError("Veuillez sélectionner un élément et un groupe de thème avant de sauvegarder.");
        return;
    }

    setLoading(true);
    setApiError(null);

    const newSiteAnalysis: StyleSection = {
        id: Date.now().toString(),
        name: isolatedName.replace(/[^\w\d]/g, '_').toLowerCase().substring(0, 40), // Nettoyage du nom
        css: isolatedCss, // Le CSS isolé, pertinent
        html: isolatedHtml, // Le composant HTML isolé
        url: analysis.urlAnalyzed // URL du site d'origine
    };

    const newLibrary = library.map(t => {
        if (t.id === selectedTheme.id) {
            return {
                ...t,
                sections: [...t.sections, newSiteAnalysis]
            };
        }
        return t;
    });

    await saveLibrary(newLibrary);
    
    // Met à jour la sélection pour l'affichage (important si le thème n'était pas encore dans le state Library)
    const updatedTheme = newLibrary.find(t => t.id === selectedTheme.id);
    setSelectedTheme(updatedTheme || null);
    
    // Efface l'état d'isolation pour repartir sur une nouvelle sélection
    setIsComponentIsolated(false);
    setIsolatedHtml('');
    setIsolatedCss('');
    setLoading(false);
  };


  const handleSelectTheme = (themeId: string) => {
    const theme = library.find(t => t.id === themeId);
    setSelectedTheme(theme || null);
    setFileContent('');
    // Réinitialise l'aperçu complet si on change de thème (pour éviter la confusion)
    setAnalysis(null); 
    setApiError(null); 
  };

  const handleDeleteTheme = async (themeId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce groupe de thème complet ?')) return;

    const newLibrary = library.filter(t => t.id !== themeId);
    await saveLibrary(newLibrary); 
    if (selectedTheme?.id === themeId) {
      setSelectedTheme(null);
      setAnalysis(null);
    }
  };

  const handleDeleteSection = async (themeId: string, sectionId: string) => {
    const theme = library.find(t => t.id === themeId);
    if (!theme) return;
    
    const componentName = theme.sections.find(sec => sec.id === sectionId)?.name || 'ce composant';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le composant "${componentName}" de ce groupe ?`)) return;

    const newLibrary = library.map(t => {
      if (t.id === themeId) {
        const updatedSections = t.sections.filter(sec => sec.id !== sectionId);
        return {
          ...t,
          sections: updatedSections,
        };
      }
      return t;
    }).filter(t => t.sections.length > 0); 

    await saveLibrary(newLibrary); 
    
    if (selectedTheme && selectedTheme.id === themeId) {
        const updatedTheme = newLibrary.find(t => t.id === themeId);
        setSelectedTheme(updatedTheme || null);
    }
  };


  // --- 4. Génération et Affichage du Fichier Typescript (Nettoyage SVG maintenu) ---

  const generateTSFileContent = (allThemes: ThemeStyle[]): string => {
    
    // 🛑 Fonction pour l'échappement et le nettoyage des SVG/Path/G
    const escapeAndCleanContentForAI = (content: string) => {
        let cleanedContent = content;

        // 1. Remplacer les balises <svg>...</svg> (y compris leur contenu) par [logo]
        cleanedContent = cleanedContent.replace(/<svg\b[^>]*>.*?<\/svg>/gs, '[logo]');

        // 2. Remplacer les balises <path>...</path> et <g>...</g> par [logo]
        cleanedContent = cleanedContent.replace(/<path\b[^>]*>.*?<\/path>/gs, '[logo]');
        cleanedContent = cleanedContent.replace(/<g\b[^>]*>.*?<\/g>/gs, '[logo]');
        
        // 3. Échappement final
        return cleanedContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    };
    
    const themesContent = allThemes.map((theme, themeIndex) => {
        const themeTagName = `theme_site_${themeIndex + 1}`;
        
        const sitesContent = theme.sections.map((site, siteIndex) => {
            const siteTagName = `site_${siteIndex + 1}`;
            
            // 🛑 Nettoyage appliqué uniquement au contenu exporté pour l'IA
            const cleanedHtml = escapeAndCleanContentForAI(site.html);
            const cleanedCss = escapeAndCleanContentForAI(site.css);

            return `
    <${siteTagName} name="${site.name.toUpperCase()}" url="${site.url}">
        <metadata>
            <theme_name>${theme.name}</theme_name>
            <component_name>${site.name}</component_name>
            <analysis_id>${site.id}</analysis_id>
        </metadata>
        <css>
            ${cleanedCss}
        </css>
        <html>
            ${cleanedHtml}
        </html>
    </${siteTagName}>`;
        }).join('\n');

        return `
<${themeTagName} name="${theme.name.toUpperCase()}">
${sitesContent}
</${themeTagName}>`;
    }).join('\n\n');

    return `
/**
 * Fichier de librairie de styles généré pour l'IA.
 * Contient tous les thèmes et composants isolés du IndexedDB, formatés pour être consommés comme un PROMPT STRUCTURÉ.
 * Les éléments SVG/Path/G ont été remplacés par [logo] pour réduire la taille du prompt.
 */
export const DESIGN_STYLE_LIBRARY_PROMPT = \`
${themesContent}
\`;
`;
  };

  const handleShowFile = () => {
    setFileContent(generateTSFileContent(library));
  };

  const handleDownloadFile = () => {
    const content = generateTSFileContent(library);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `design_library_${Date.now()}.ts`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- Rendu du composant ---
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1200px', margin: 'auto' }}>
      <h1>📚 Style Analyzer & Library Manager (IndexedDB)</h1>
      <p>Statut DB: <code style={{ backgroundColor: '#ccffcc', padding: '3px 6px', borderRadius: '4px' }}>{dbStatus}</code></p>
      
      {/* AFFICHAGE DES ERREURS DE L'API */}
      {apiError && (
        <div style={{ 
          padding: '15px', 
          marginBottom: '20px', 
          borderRadius: '8px', 
          backgroundColor: '#ffe6e6', 
          border: '2px solid red',
          fontWeight: 'bold',
          whiteSpace: 'pre-wrap'
        }}>
          ❌ ERREUR API/RÉSEAU:
          <pre style={{ margin: '5px 0 0 0', backgroundColor: '#fdd', padding: '10px', borderRadius: '4px', fontSize: '14px' }}>
            {apiError}
          </pre>
        </div>
      )}

      {/* SECTION 1: Analyse et Stockage */}
      <div style={{ border: '1px solid #0070f3', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#f0f8ff' }}>
        <h2>1. Lancer l'Analyse d'un Site</h2>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Entrez l'URL du site (ex: google.com)"
          style={{ width: '45%', padding: '10px', marginRight: '10px', border: '1px solid #ccc' }}
        />
        <input
          type="text"
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
          placeholder="Nom du Groupe de Thème (ex: theme_light_v1)"
          style={{ width: '30%', padding: '10px', marginRight: '10px', border: '1px solid #ccc' }}
        />
        <button 
          onClick={handleAnalyzeAndSave} 
          disabled={loading || !url || !themeName}
          style={{ padding: '10px 15px', backgroundColor: '#0070f3', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
          {loading ? 'Analyse en cours...' : 'Lancer l\'Analyse (Préparation à l\'Isolation)'}
        </button>
        <p style={{ marginTop: '10px', fontSize: '14px', color: '#555' }}>L'analyse crée ou sélectionne le Groupe de Thème, puis vous permet d'isoler des composants ci-dessous.</p>
      </div>

      {/* SECTION 2: Visualisation du Site Cliquable */}
      {analysis && analysis.success && (
        <div style={{ marginBottom: '20px', border: '1px solid #333', padding: '15px', borderRadius: '8px' }}>
          <h2>2. Site Analysé (Outil d'Inspection)</h2>
          <p>Utilisez la souris pour **pointer** (surlignement) et **cliquer** (isolation) un composant dans l'iframe. 🖱️</p>
          <iframe
            // La propriété onLoad permet de lancer le script d'inspection une fois le srcDoc chargé
            onLoad={(e) => handleIframeLoad(e.currentTarget)} 
            srcDoc={iframeContent}
            title="Visualisation du contenu analysé (cliquable)"
            style={{ width: '100%', height: '400px', border: '2px solid #333', borderRadius: '8px' }}
          />
        </div>
      )}
      
      {/* SECTION 3: Composant Isolé */}
      {isComponentIsolated && (
        <div style={{ border: '2px solid #00AA00', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#e6ffe6' }}>
            <h2>3. Composant Isolé Sélectionné ({isolatedName})</h2>
            
            <div style={{ display: 'flex', gap: '20px' }}>
                <div style={{ flex: 1 }}>
                    <h3>Rendu Isolé (CSS extrait)</h3>
                    <iframe
                        srcDoc={isolatedIframeContent}
                        title="Visualisation du composant isolé"
                        style={{ width: '100%', height: '300px', border: '1px solid #00AA00', borderRadius: '4px' }}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <h3>Code Source pour l'IA (Aperçu Nettoyé)</h3>
                    <p>
                        **HTML:** {isolatedHtml.length} chars, 
                        **CSS extrait:** {isolatedCss.length} chars
                    </p>
                    <textarea 
                        value={`HTML snippet: ${isolatedHtml.substring(0, 300)}...\n\nCSS snippet: ${isolatedCss.substring(0, 300)}...`} 
                        readOnly
                        style={{ width: '100%', height: '150px', resize: 'none', backgroundColor: '#f4f4f4', padding: '10px', fontSize: '12px' }}
                        title="HTML et CSS isolé"
                    />
                </div>
            </div>

            <input
                type="text"
                value={isolatedName}
                onChange={(e) => setIsolatedName(e.target.value)}
                placeholder="Nom du composant à sauvegarder (ex: header_nav)"
                style={{ width: '300px', padding: '8px', marginRight: '10px', border: '1px solid #ccc', marginTop: '10px' }}
            />
            {selectedTheme ? (
                 <button 
                    onClick={handleSaveIsolatedComponent} 
                    disabled={loading || !isolatedHtml}
                    style={{ padding: '10px 15px', backgroundColor: '#00AA00', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginTop: '10px' }}
                >
                    {loading ? 'Sauvegarde...' : `Sauvegarder le Composant dans ${selectedTheme.name.toUpperCase()}`}
                </button>
            ) : (
                <p style={{ color: 'red', marginTop: '10px' }}>Veuillez sélectionner ou créer un Groupe de Thème (section 1) pour sauvegarder ce composant.</p>
            )}
            
        </div>
      )}


      {/* SECTION 4: Gestion de la Librairie */}
      <div style={{ border: '1px solid #000', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#fff' }}>
        <h2>4. Gestion de la Librairie ({library.length} Groupes de Thèmes)</h2>
        
        {/* Liste des Thèmes */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
          {library.map(theme => (
            <div 
              key={theme.id} 
              onClick={() => handleSelectTheme(theme.id)}
              style={{ 
                padding: '10px 15px', 
                border: theme.id === selectedTheme?.id ? '2px solid green' : '1px solid #ddd', 
                borderRadius: '20px',
                cursor: 'pointer',
                backgroundColor: theme.id === selectedTheme?.id ? '#e6ffe6' : '#f9f9f9',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <span style={{ fontWeight: 'bold' }}>{theme.name.toUpperCase()}</span> ({theme.sections.length} composants)
              <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteTheme(theme.id); }} 
                style={{ marginLeft: '10px', color: 'red', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
              >
                [X]
              </button>
            </div>
          ))}
        </div>

        {/* Détails du Thème Sélectionné */}
        {selectedTheme && (
          <div style={{ borderTop: '2px dashed #ccc', marginTop: '15px', paddingTop: '15px' }}>
            <h3>Détails du Groupe: {selectedTheme.name.toUpperCase()}</h3>
            
            <p>Ce groupe contient les composants isolés suivants, tous provenant de l'URL de base: <code style={{ backgroundColor: '#ffffe0', padding: '2px 4px' }}>{selectedTheme.baseUrl}</code></p>

            {/* Liste des Sections (Composants) */}
            <ul style={{ listStyleType: 'none', padding: 0 }}>
              {selectedTheme.sections.map((site, index) => (
                <li key={site.id} style={{ margin: '8px 0', padding: '5px', borderBottom: '1px dotted #eee' }}>
                  **Composant #{index + 1}**: <code style={{ backgroundColor: '#e6f7ff', padding: '2px 4px' }}>{site.name.toUpperCase()}</code> (HTML: {Math.round(site.html.length / 1024)} KB, CSS: {Math.round(site.css.length / 1024)} KB)
                  <button 
                    onClick={() => handleDeleteSection(selectedTheme.id, site.id)} 
                    style={{ marginLeft: '20px', color: '#ff4d4d', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>

            <div style={{ marginTop: '20px' }}>
              <button onClick={handleShowFile} style={{ marginRight: '10px', padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                Show File (DESIGN_STYLE_LIBRARY_PROMPT.ts)
              </button>
              <button onClick={handleDownloadFile} style={{ padding: '10px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                Télécharger le fichier .ts
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Aperçu du Fichier .ts */}
      {fileContent && (
        <div style={{ marginTop: '20px' }}>
          <h2>Aperçu du Fichier TypeScript Complet pour l'IA</h2>
          <pre style={{ backgroundColor: '#2d2d2d', color: '#f8f8f2', padding: '15px', border: '1px solid #ddd', overflowX: 'auto', borderRadius: '5px' }}>
            {fileContent}
          </pre>
        </div>
      )}
    </div>
  );
};

export default StyleLibraryManager;
        
