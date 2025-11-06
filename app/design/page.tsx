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
  id: string; // ID unique du thème (timestamp)
  name: string; // Nom donné par l'utilisateur (ex: 'theme_site_light_white')
  sections: StyleSection[];
}

interface AnalysisResult {
  success: boolean;
  fullHTML: string;
  fullCSS: string;
  fullJS: string;
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

    try {
      // Appel à l'API Next.js (assurez-vous que /api/analyse/route.ts est prêt)
      const response = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data: AnalysisResult = await response.json();

      if (data.success) {
        setAnalysis(data);

        // Crée la section "style_primary" avec le HTML/CSS complets
        const newTheme: ThemeStyle = {
          id: Date.now().toString(),
          name: themeName.replace(/\s/g, '_').toLowerCase(), // Nettoyage du nom pour TypeScript
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
        setSelectedTheme(newTheme); // Sélectionne le nouveau thème
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

    // Combinaison sécurisée du HTML, CSS et JS
    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>${analysis.fullCSS}</style>
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
    setFileContent(''); // Masquer l'aperçu du fichier lors du changement de thème
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
    }).filter(theme => theme.sections.length > 0); // Suppression si le thème devient vide

    saveLibrary(newLibrary);
    
    // Mise à jour de la sélection
    if (selectedTheme && selectedTheme.id === themeId) {
        const updatedTheme = newLibrary.find(t => t.id === themeId);
        setSelectedTheme(updatedTheme || null);
    }
  };


  // --- 4. Génération et Affichage du Fichier Typescript ---

  const generateTSFileContent = (theme: ThemeStyle): string => {
    // Échappement des backticks et des barres obliques pour les string templates JS/TS
    const escapeContent = (content: string) => content.replace(/\\/g, '\\\\').replace(/`/g, '\\`');

    const sectionsCode = theme.sections.map(sec => `
// --- Section: ${sec.name.toUpperCase()} ---
export const ${theme.name.toUpperCase()}_${sec.name.toUpperCase()}_CSS = \`${escapeContent(sec.css)}\`
export const ${theme.name.toUpperCase()}_${sec.name.toUpperCase()}_HTML = \`${escapeContent(sec.html)}\`
    `).join('\n');

    return `
/**
 * Fichier de thème généré depuis la librairie de styles.
 * Thème: ${theme.name}
 * ID: ${theme.id}
 * Date de génération: ${new Date().toISOString()}
 */
    ${sectionsCode}
    `;
  };

  const handleShowFile = () => {
    if (selectedTheme) {
      setFileContent(generateTSFileContent(selectedTheme));
    }
  };

  const handleDownloadFile = () => {
    if (selectedTheme) {
      const content = generateTSFileContent(selectedTheme);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedTheme.name}.ts`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

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
              <strong>{theme.name}</strong> ({theme.sections.length} section(s))
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
            
            <p>Ce groupe contient toutes les sections de styles enregistrées pour ce thème.</p>

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
                Show File (`{selectedTheme.name}.ts`)
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
          <h2>Aperçu du Fichier TypeScript (`{selectedTheme?.name}.ts`)</h2>
          <pre style={{ backgroundColor: '#2d2d2d', color: '#f8f8f2', padding: '15px', border: '1px solid #ddd', overflowX: 'auto', borderRadius: '5px' }}>
            {fileContent}
          </pre>
        </div>
      )}
    </div>
  );
};

export default StyleLibraryManager;
