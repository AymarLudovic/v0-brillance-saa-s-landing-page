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
const DEFAULT_SECTION_NAME = 'style_primary'; // Nom par défaut pour la section de style analysée

// --- Types pour la gestion des données ---
// Chaque 'section' représente désormais un site analysé sous le thème.
interface StyleSection { 
  id: string; // ID unique pour cette analyse (site)
  name: string; // Nom de la section/analyse (ex: 'style_primary')
  css: string;
  html: string;
  url: string; // URL du site analysé
}

interface ThemeStyle {
  id: string; 
  name: string; 
  sections: StyleSection[]; // Contient tous les sites analysés sous ce thème
  baseUrl: string; // Base URL du dernier site analysé (pour l'iFrame, non critique pour la DB)
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

  // --- Gestion du Stockage (LocalForage/IndexedDB) ---

  const loadLibrary = useCallback(async () => {
    try {
      setDbStatus('Chargement...');
      const storedLibrary = await localforage.getItem(DB_KEY) as ThemeStyle[] | null;
      if (storedLibrary) {
        setLibrary(storedLibrary);
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

  // --- 1. Analyse et Ajout de Thème (AVEC ACCUMULATION) ---
  const handleAnalyzeAndSave = async () => {
    if (!url || !themeName) return;
    setLoading(true);
    setAnalysis(null);
    setApiError(null); 

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

      setAnalysis({...data, urlAnalyzed: baseUrl});
      
      const normalizedThemeName = themeName.replace(/\s/g, '_').toLowerCase();

      // 2. Préparation du nouveau site analysé
      const newSiteAnalysis: StyleSection = {
        id: Date.now().toString(),
        name: DEFAULT_SECTION_NAME, 
        css: data.fullCSS,
        html: data.fullHTML,
        url: urlToAnalyze
      };

      // 3. Mise à jour ou Création du Thème
      let themeFound = library.find(t => t.name === normalizedThemeName);
      let newLibrary: ThemeStyle[];
      let updatedTheme: ThemeStyle;

      if (themeFound) {
          // THÈME EXISTANT: Ajout de la nouvelle analyse à la section
          updatedTheme = {
              ...themeFound,
              baseUrl: baseUrl, // Mettre à jour la base URL pour l'iFrame de l'aperçu
              sections: [...themeFound.sections, newSiteAnalysis]
          };
          newLibrary = library.map(t => t.name === normalizedThemeName ? updatedTheme : t);
      } else {
          // NOUVEAU THÈME: Création d'un nouveau groupe
          updatedTheme = {
              id: Date.now().toString(),
              name: normalizedThemeName, 
              baseUrl: baseUrl,
              sections: [newSiteAnalysis],
          };
          newLibrary = [...library, updatedTheme];
      }

      // 4. Sauvegarde
      await saveLibrary(newLibrary); 
      setSelectedTheme(updatedTheme); 
      
    } catch (error: any) {
      setApiError(`[ERREUR RÉSEAU/PARSE] ${error.message}. Vérifiez la console.`);
    } finally {
      setLoading(false);
    }
  };

  // --- 2. Génération de l'iFrame (Visualisation) ---
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
      </head>
      <body>
          ${analysis.fullHTML}
          <script>${analysis.fullJS}</script>
          <style>
            body {
                margin: 0;
                padding: 10px; 
            }
          </style>
      </body>
      </html>
    `;
  }, [analysis]);

  // --- 3. Gestion des Thèmes et Sections (Suppression) ---
  const handleSelectTheme = (themeId: string) => {
    const theme = library.find(t => t.id === themeId);
    setSelectedTheme(theme || null);
    setFileContent('');
    
    if (theme) {
        // Pour l'aperçu, on affiche le dernier site ajouté au thème
        const lastSection = theme.sections[theme.sections.length - 1];
        setAnalysis({
            success: true,
            fullHTML: lastSection?.html || '',
            fullCSS: lastSection?.css || '',
            fullJS: '', 
            urlAnalyzed: theme.baseUrl
        } as AnalysisResult);
        setApiError(null); 
    }
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

  // Suppression d'un site (section) dans le thème
  const handleDeleteSection = async (themeId: string, sectionId: string) => {
    const theme = library.find(t => t.id === themeId);
    if (!theme) return;
    
    const siteUrl = theme.sections.find(sec => sec.id === sectionId)?.url || 'ce site';
    if (!confirm(`Êtes-vous sûr de vouloir supprimer l'analyse de ${siteUrl} de ce groupe ?`)) return;

    const newLibrary = library.map(t => {
      if (t.id === themeId) {
        const updatedSections = t.sections.filter(sec => sec.id !== sectionId);
        return {
          ...t,
          sections: updatedSections,
        };
      }
      return t;
    }).filter(t => t.sections.length > 0); // Supprime le thème s'il est vide

    await saveLibrary(newLibrary); 
    
    // Mise à jour de la sélection et de l'aperçu
    if (selectedTheme && selectedTheme.id === themeId) {
        const updatedTheme = newLibrary.find(t => t.id === themeId);
        setSelectedTheme(updatedTheme || null);
    }
  };


  // --- 4. Génération et Affichage du Fichier Typescript (Format XML/Prompt Corrigé) ---

  const generateTSFileContent = (allThemes: ThemeStyle[]): string => {
    const escapeContent = (content: string) => content.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    
    const themesContent = allThemes.map((theme, themeIndex) => {
        const themeTagName = `theme_site_${themeIndex + 1}`;
        
        // CORRECTION: Les sections deviennent des balises <site_X>
        const sitesContent = theme.sections.map((site, siteIndex) => {
            const siteTagName = `site_${siteIndex + 1}`;
            
            return `
    <${siteTagName} name="${site.name.toUpperCase()}" url="${site.url}">
        <metadata>
            <theme_name>${theme.name}</theme_name>
            <analysis_id>${site.id}</analysis_id>
        </metadata>
        <css>
            ${escapeContent(site.css)}
        </css>
        <html>
            ${escapeContent(site.html)}
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
 * Contient tous les thèmes et sites analysés du IndexedDB, formatés pour être consommés comme un PROMPT STRUCTURÉ.
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
        <h2>1. Analyser un Nouveau Site (Appel API)</h2>
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
          {loading ? 'Analyse en cours...' : 'Lancer l\'Analyse & Sauvegarder'}
        </button>
      </div>

      {/* Visualisation (iFrame) */}
      {analysis && analysis.success && (
        <div style={{ marginBottom: '20px' }}>
          <h2>Rendu de l'Analyse (iFrame - Fidélité HTML/CSS/JS)</h2>
          <iframe
            srcDoc={iframeContent}
            title="Visualisation du contenu analysé"
            style={{ width: '100%', height: '400px', border: '2px solid #333', borderRadius: '8px' }}
          />
        </div>
      )}

      {/* SECTION 2: Gestion et Génération */}
      <div style={{ border: '1px solid #000', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#fff' }}>
        <h2>2. Gestion de la Librairie ({library.length} Groupes de Thèmes)</h2>
        
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
                backgroundColor: theme.id === selectedTheme?.id ? '#e6ffe6' : '#f9f9f9'
              }}
            >
              **{theme.name.toUpperCase()}** ({theme.sections.length} sites/analyses)
              <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteTheme(theme.id); }} 
                style={{ marginLeft: '10px', color: 'red', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
              >
                [Supprimer Groupe]
              </button>
            </div>
          ))}
        </div>

        {/* Détails du Thème Sélectionné */}
        {selectedTheme && (
          <div style={{ borderTop: '2px dashed #ccc', marginTop: '15px', paddingTop: '15px' }}>
            <h3>Détails du Groupe: {selectedTheme.name.toUpperCase()}</h3>
            
            <p>Le groupe contient les analyses suivantes:</p>

            {/* Liste des Sections (Sites) */}
            <ul style={{ listStyleType: 'none', padding: 0 }}>
              {selectedTheme.sections.map((site, index) => (
                <li key={site.id} style={{ margin: '8px 0', padding: '5px', borderBottom: '1px dotted #eee' }}>
                  **Site #{index + 1}**: <code style={{ backgroundColor: '#ffffe0', padding: '2px 4px' }}>{site.url}</code> (CSS: {Math.round(site.css.length / 1024)} KB, HTML: {Math.round(site.html.length / 1024)} KB)
                  <button 
                    onClick={() => handleDeleteSection(selectedTheme.id, site.id)} 
                    style={{ marginLeft: '20px', color: '#ff4d4d', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Supprimer Site
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
          <h2>Aperçu du Fichier TypeScript Complet</h2>
          <pre style={{ backgroundColor: '#2d2d2d', color: '#f8f8f2', padding: '15px', border: '1px solid #ddd', overflowX: 'auto', borderRadius: '5px' }}>
            {fileContent}
          </pre>
        </div>
      )}
    </div>
  );
};

export default StyleLibraryManager;
