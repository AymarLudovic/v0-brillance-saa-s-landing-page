// Placez ce code dans votre répertoire d'application Next.js, par exemple: app/library/page.tsx

"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- Types pour la gestion des données ---
interface StyleSection {
  name: string;
  css: string;
  html: string;
}

interface ThemeStyle {
  id: string; 
  name: string; 
  sections: StyleSection[];
  baseUrl: string; // Ajout pour la correction de l'iFrame
}

interface AnalysisResult {
  success: boolean;
  fullHTML: string;
  fullCSS: string;
  fullJS: string;
  urlAnalyzed: string; // Ajout de l'URL pour la base href
  error?: string;
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

  // --- Gestion du LocalStorage ---
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const storedLibrary = localStorage.getItem('styleLibrary');
        if (storedLibrary) {
          setLibrary(JSON.parse(storedLibrary));
        }
      }
    } catch (e) {
      console.error("Impossible de charger la librairie du localStorage", e);
    }
  }, []);

  const saveLibrary = useCallback((newLibrary: ThemeStyle[]) => {
    setLibrary(newLibrary);
    if (typeof window !== 'undefined') {
        localStorage.setItem('styleLibrary', JSON.stringify(newLibrary));
    }
  }, []);

  // --- 1. Analyse et Ajout de Thème ---
  const handleAnalyzeAndSave = async () => {
    if (!url || !themeName) return;
    setLoading(true);
    setAnalysis(null);

    let urlToAnalyze = url;
    if (!/^https?:\/\//i.test(urlToAnalyze)) {
        urlToAnalyze = "https://" + urlToAnalyze;
    }
    const baseUrl = new URL(urlToAnalyze).origin + '/';

    try {
      // Appel à l'API Next.js
      const response = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToAnalyze }),
      });

      const data: AnalysisResult = await response.json();

      if (data.success) {
        setAnalysis({...data, urlAnalyzed: baseUrl});

        // Crée la section "style_primary" avec le HTML/CSS complets
        const newTheme: ThemeStyle = {
          id: Date.now().toString(),
          name: themeName.replace(/\s/g, '_').toLowerCase(), 
          baseUrl: baseUrl, // Sauvegarde la base URL
          sections: [
            {
              name: 'style_primary',
              css: data.fullCSS,
              html: data.fullHTML,
            },
          ],
        };

        const newLibrary = [...library, newTheme];
        saveLibrary(newLibrary);
        setSelectedTheme(newTheme); 
      } else {
        alert(`Erreur d'analyse: ${data.error || "Réponse non réussie de l'API"}`);
      }
    } catch (error) {
      console.error('Analyse échouée', error);
      alert("Erreur lors de l'appel API. Vérifiez la console.");
    } finally {
      setLoading(false);
    }
  };

  // --- 2. Génération de l'iFrame (Visualisation) ---
  const iframeContent = useMemo(() => {
    if (!analysis || !analysis.success) return '';

    // Utilisation de la base URL pour corriger les liens 404
    const baseHref = analysis.urlAnalyzed;

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${baseHref}"> <style>${analysis.fullCSS}</style>
      </head>
      <body>
          ${analysis.fullHTML}
          <script>${analysis.fullJS}</script>
          <style>
            /* Correction de style pour l'iFrame */
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
    // Mise à jour de l'analyse pour l'iFrame si le thème sélectionné a été analysé
    if (theme) {
        setAnalysis({
            success: true,
            fullHTML: theme.sections[0]?.html || '',
            fullCSS: theme.sections[0]?.css || '',
            fullJS: '', // Le JS n'est pas stocké par section/thème mais il faut fournir un fallback
            urlAnalyzed: theme.baseUrl
        } as AnalysisResult);
    }
  };

  const handleDeleteTheme = (themeId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce groupe de thème complet ?')) return;

    const newLibrary = library.filter(t => t.id !== themeId);
    saveLibrary(newLibrary);
    if (selectedTheme?.id === themeId) {
      setSelectedTheme(null);
      setAnalysis(null);
    }
  };

  const handleDeleteSection = (themeId: string, sectionName: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer la section "${sectionName}" de ce groupe ?`)) return;

    const newLibrary = library.map(theme => {
      if (theme.id === themeId) {
        const updatedSections = theme.sections.filter(sec => sec.name !== sectionName);
        return {
          ...theme,
          sections: updatedSections,
        };
      }
      return theme;
    }).filter(theme => theme.sections.length > 0); 

    saveLibrary(newLibrary);
    
    if (selectedTheme && selectedTheme.id === themeId) {
        const updatedTheme = newLibrary.find(t => t.id === themeId);
        setSelectedTheme(updatedTheme || null);
    }
  };


  // --- 4. Génération et Affichage du Fichier Typescript (Nouveau Format) ---

  const generateTSFileContent = (allThemes: ThemeStyle[]): string => {
    // Échappement des backticks et des barres obliques pour les string templates JS/TS
    const escapeContent = (content: string) => content.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    
    // Structure le contenu de tous les thèmes dans le format XML souhaité
    const themesContent = allThemes.map((theme, themeIndex) => {
        const themeTagName = `theme_site_${themeIndex + 1}`;
        
        const sectionsContent = theme.sections.map((sec, secIndex) => {
            const sectionTagName = `style_${secIndex + 1}`;
            
            return `
    <${sectionTagName} name="${sec.name.toUpperCase()}">
        <metadata>
            <theme_name>${theme.name}</theme_name>
            <base_url>${theme.baseUrl}</base_url>
        </metadata>
        <css>
            ${escapeContent(sec.css)}
        </css>
        <html>
            ${escapeContent(sec.html)}
        </html>
    </${sectionTagName}>`;
        }).join('\n');

        return `
<${themeTagName} name="${theme.name.toUpperCase()}">
${sectionsContent}
</${themeTagName}>`;
    }).join('\n\n');

    // Le prompt entier est encapsulé dans une seule constante
    return `
/**
 * Fichier de librairie de styles généré pour l'IA.
 * Contient tous les thèmes et sections du Local Storage, formatés pour être consommés comme un PROMPT STRUCTURÉ.
 */
export const DESIGN_STYLE_LIBRARY_PROMPT = \`
${themesContent}
\`;
`;
  };

  const handleShowFile = () => {
    // Afficher l'ensemble de la librairie, pas seulement le thème sélectionné
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

  // Rendu du composant (inchangé)
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1200px', margin: 'auto' }}>
      <h1>📚 Style Analyzer & Library Manager</h1>
      <p>Créez une librairie de styles réutilisables pour votre IA en stockant les analyses dans le **Local Storage**.</p>
      
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
      {analysis && !analysis.success && (
         <div style={{ padding: '10px', backgroundColor: '#fdd', border: '1px solid red', marginBottom: '15px' }}>
            Erreur lors de l'analyse: {analysis.error}
         </div>
      )}

      {/* SECTION 2: Gestion et Génération */}
      <div style={{ border: '1px solid #000', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#fff' }}>
        <h2>2. Gestion de la Librairie ({library.length} Groupes)</h2>
        
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
              **{theme.name.toUpperCase()}** ({theme.sections.length} section(s))
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
            
            <p>Base URL utilisée: <code style={{ backgroundColor: '#ffffe0', padding: '2px 4px' }}>{selectedTheme.baseUrl}</code> (pour résolution des assets)</p>

            {/* Liste des Sections (Styles) */}
            <ul style={{ listStyleType: 'none', padding: 0 }}>
              {selectedTheme.sections.map(section => (
                <li key={section.name} style={{ margin: '8px 0', padding: '5px', borderBottom: '1px dotted #eee' }}>
                  **Section:** <code style={{ backgroundColor: '#ffffe0', padding: '2px 4px' }}>{section.name}</code> (CSS: {Math.round(section.css.length / 1024)} KB, HTML: {Math.round(section.html.length / 1024)} KB)
                  <button 
                    onClick={() => handleDeleteSection(selectedTheme.id, section.name)} 
                    style={{ marginLeft: '20px', color: '#ff4d4d', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Supprimer Section
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
