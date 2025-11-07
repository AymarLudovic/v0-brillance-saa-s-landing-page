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
const DEFAULT_SECTION_NAME = 'style_component';

// --- Types pour la gestion des données ---
interface StyleSection { 
  id: string; 
  name: string; 
  css: string; 
  html: string; // Contient le HTML isolé + son DOM parent
  url: string; 
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

interface DetectedElement {
    id: string; // ID unique interne
    tagName: string;
    selector: string; // Ex: 'header#main-nav'
    htmlSnippet: string;
    fullOuterHTML: string; // Le HTML complet de l'élément sélectionné
}

// Définition des tags structuraux à détecter automatiquement
const STRUCTURAL_TAGS = ['header', 'nav', 'main', 'aside', 'footer', 'section', 'article', 'h1', 'h2', 'a', 'button', 'input', 'form', 'figure'];

// --- Fonctions d'Utilité d'Isolation CSS/HTML (Réutilisées) ---

/**
 * Tente d'extraire les règles CSS pertinentes.
 */
const extractRelevantCss = (fullCSS: string, element: HTMLElement, domDepth: number): string => {
    const selectors = new Set<string>();
    
    // Collecte des sélecteurs de l'élément sélectionné et de ses descendants
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
    
    // Collecte des sélecteurs des parents jusqu'à la profondeur spécifiée
    let current = element.parentElement;
    let depth = 0;
    while(current && depth < domDepth && current.tagName.toLowerCase() !== 'body') {
        if (current.className) {
             current.className.split(/\s+/).forEach(cls => selectors.add('.' + cls.trim()));
        }
        if (current.id) {
            selectors.add('#' + current.id.trim());
        }
        selectors.add(current.tagName.toLowerCase());
        current = current.parentElement;
        depth++;
    }

    if (selectors.size === 0) return '';

    const safeSelectors = Array.from(selectors)
        .filter(s => s.length > 1) 
        .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    
    if (!safeSelectors) return '';

    const aggressiveRuleRegex = new RegExp(`([^}]+)({[^}]*})`, 'gs');
    let relevantCss = '';
    let match;
    
    while ((match = aggressiveRuleRegex.exec(fullCSS)) !== null) {
        const selectorsPart = match[1]; 
        const ruleBlock = match[0];    
        
        let shouldInclude = false;
        selectors.forEach(selector => {
            if (selectorsPart.includes(selector)) {
                shouldInclude = true;
            }
        });

        if (shouldInclude) {
            relevantCss += ruleBlock + '\n';
        }
    }

    return `
html, body {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: inherit;
    font-size: 100%;
    line-height: 1.5;
}
${relevantCss}`;
};


/**
 * Récupère le HTML de l'élément sélectionné entouré par ses parents jusqu'à la profondeur spécifiée.
 */
const getSurroundingDom = (element: HTMLElement, depth: number): string => {
    let current = element;
    let wrapper = element.outerHTML;
    
    for (let i = 0; i < depth; i++) {
        if (!current.parentElement || current.parentElement.tagName.toLowerCase() === 'body') {
            break;
        }
        const parent = current.parentElement;
        // Filtrer les attributs inutiles
        const attributes = Array.from(parent.attributes)
            .filter(attr => !attr.name.startsWith('data-') && attr.name !== 'style' && attr.name !== 'class') 
            .map(attr => `${attr.name}="${attr.value}"`)
            .join(' ');
            
        // Inclure la classe du parent est critique pour le style, on le fait manuellement
        const classAttr = parent.className ? ` class="${parent.className}"` : '';
            
        wrapper = `<${parent.tagName.toLowerCase()} ${attributes}${classAttr}>${wrapper}</${parent.tagName.toLowerCase()}>`;
        current = parent;
    }

    return wrapper;
};


/**
 * Analyse le HTML brut pour détecter les éléments structuraux.
 */
const parseHTMLForStructuralElements = (htmlString: string): DetectedElement[] => {
    if (typeof DOMParser === 'undefined') return [];

    const parser = new DOMParser();
    // Utiliser 'text/html' pour un parsing standard
    const doc = parser.parseFromString(htmlString, 'text/html');
    const detected: DetectedElement[] = [];
    let uniqueIndex = 0;

    STRUCTURAL_TAGS.forEach((tag) => {
        const elements = doc.querySelectorAll(tag);
        elements.forEach((el) => {
            const elementId = el.id ? `#${el.id}` : (el.className ? `.${el.className.split(/\s+/)[0]}` : '');
            
            detected.push({
                id: (uniqueIndex++).toString(),
                tagName: tag,
                selector: tag + elementId,
                htmlSnippet: el.outerHTML.substring(0, 100).replace(/\n/g, ' ') + '...',
                fullOuterHTML: el.outerHTML,
            });
        });
    });
    
    // Ajout des divs/figures significatifs
    const genericElements = doc.querySelectorAll('div[id], div[class], figure[id], figure[class]');
    genericElements.forEach((el) => {
        const elementId = el.id ? `#${el.id}` : (el.className ? `.${el.className.split(/\s+/)[0]}` : '');
        
        detected.push({
            id: (uniqueIndex++).toString(),
            tagName: el.tagName.toLowerCase(),
            selector: el.tagName.toLowerCase() + elementId,
            htmlSnippet: el.outerHTML.substring(0, 100).replace(/\n/g, ' ') + '...',
            fullOuterHTML: el.outerHTML,
        });
    });

    return detected;
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
  
  // --- NOUVEAUX ÉTATS POUR L'ISOLATION PROGRAMMATIQUE ---
  const [detectedElements, setDetectedElements] = useState<DetectedElement[]>([]);
  const [isolatedHtml, setIsolatedHtml] = useState('');
  const [isolatedCss, setIsolatedCss] = useState('');
  const [isolatedName, setIsolatedName] = useState(DEFAULT_SECTION_NAME);
  const [isComponentIsolated, setIsComponentIsolated] = useState(false);
  const [domDepth, setDomDepth] = useState(0); 
  // Nous stockons l'objet DetectedElement pour la logique d'isolation
  const [currentDetection, setCurrentDetection] = useState<DetectedElement | null>(null); 


  // --- Gestion du Stockage (LocalForage/IndexedDB) ---
  const loadLibrary = useCallback(async () => { /* ... loadLibrary function remains the same ... */ 
    try {
      setDbStatus('Chargement...');
      const storedLibrary = await localforage.getItem(DB_KEY) as ThemeStyle[] | null;
      if (storedLibrary) {
        setLibrary(storedLibrary);
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


  const saveLibrary = useCallback(async (newLibrary: ThemeStyle[]) => { /* ... saveLibrary function remains the same ... */
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

  // --- 1. Analyse (Charge l'état d'analyse ET dÉtecte les Éléments) ---
  const handleAnalyzeAndSave = async () => {
    if (!url || !themeName) return;
    setLoading(true);
    setAnalysis(null);
    setDetectedElements([]);
    setApiError(null); 
    setIsComponentIsolated(false); 
    setIsolatedHtml('');
    setIsolatedCss('');
    setCurrentDetection(null);

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

      const newAnalysis: AnalysisResult = {...data, urlAnalyzed: baseUrl};
      setAnalysis(newAnalysis);

      // 🛑 NOUVEAU: Détection des éléments structuraux
      const detected = parseHTMLForStructuralElements(data.fullHTML);
      setDetectedElements(detected);

      const normalizedThemeName = themeName.replace(/\s/g, '_').toLowerCase();
      let themeFound = library.find(t => t.name === normalizedThemeName);
      if (!themeFound) {
          themeFound = {
              id: Date.now().toString(),
              name: normalizedThemeName, 
              baseUrl: baseUrl,
              sections: [], 
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


  // --- Logique d'Isolation Programmatique (Déclenchée par bouton) ---

  const findElementByOuterHTML = (fullHTML: string, elementOuterHTML: string): HTMLElement | null => {
    // Utiliser DOMParser pour créer un DOM virtuel
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHTML, 'text/html');
    
    // Trouver tous les éléments pour la recherche
    const allElements = doc.body.querySelectorAll('*');
    
    // Chercher l'élément exact basé sur le outerHTML (peut être sensible aux espaces)
    for (let i = 0; i < allElements.length; i++) {
        if (allElements[i].outerHTML === elementOuterHTML) {
            return allElements[i] as HTMLElement;
        }
    }
    // Tentative moins stricte (juste pour s'assurer qu'on trouve quelque chose)
    for (let i = 0; i < allElements.length; i++) {
        if (allElements[i].outerHTML.includes(elementOuterHTML.substring(0, 50))) {
             return allElements[i] as HTMLElement;
        }
    }
    
    return null;
  };


  const updateIsolatedComponent = useCallback((detection: DetectedElement, depth: number, fullHTML: string, fullCSS: string) => {
    
    // 1. Reconstruire l'élément à partir de la chaîne de l'analyse complète
    const elementToIsolate = findElementByOuterHTML(fullHTML, detection.fullOuterHTML);

    if (!elementToIsolate) {
        setApiError(`[ERREUR ISOLEMENT] Impossible de retrouver l'élément ${detection.selector} dans le DOM.`);
        setIsComponentIsolated(false);
        return;
    }
    
    // 2. Isolation du HTML avec DOM Parent
    const htmlWithDom = getSurroundingDom(elementToIsolate, depth);
    
    // 3. Isolation du CSS
    const css = extractRelevantCss(fullCSS, elementToIsolate, depth);
        
    // 4. Mise à jour des états
    setIsolatedHtml(htmlWithDom);
    setIsolatedCss(css);
    setIsolatedName(detection.selector.replace(/[.#]/g, '_').toLowerCase().substring(0, 40));
    setIsComponentIsolated(true);
    setApiError(null); 

    // On stocke la détection actuelle pour la sauvegarde
    setCurrentDetection(detection);

  }, []);


  const handleIsolateProgrammatically = (detection: DetectedElement) => {
    if (!analysis) return;
    // Déclenche la mise à jour de l'isolation avec la profondeur actuelle
    updateIsolatedComponent(detection, domDepth, analysis.fullHTML, analysis.fullCSS);
  };
  
  // Recalcule l'isolation dès que la profondeur du DOM change
  useEffect(() => {
    if (currentDetection && analysis) {
        updateIsolatedComponent(currentDetection, domDepth, analysis.fullHTML, analysis.fullCSS);
    }
  }, [domDepth, currentDetection, analysis, updateIsolatedComponent]);


  // --- IFrame COMPlET (Affichage de l'analyse, n'est plus cliquable pour la sélection) ---
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
            /* Désactiver toute interaction pour éviter les bugs de sélection */
            * { pointer-events: none; }
          </style>
      </head>
      <body>
          ${analysis.fullHTML}
          <script>${analysis.fullJS}</script>
          <style>
            body { margin: 0; padding: 0; }
          </style>
      </body>
      </html>
    `;
  }, [analysis]);

  // --- IFrame ISOLÉ (Visualisation du composant sélectionné) ---
  const isolatedIframeContent = useMemo(() => { /* ... isolatedIframeContent function remains the same ... */
    if (!isComponentIsolated) return '';

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-width, initial-scale=1.0">
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
    if (!isolatedHtml || !isolatedCss || !selectedTheme || !analysis || !currentDetection) {
        setApiError("Veuillez sélectionner un élément et un groupe de thème avant de sauvegarder.");
        return;
    }

    setLoading(true);
    setApiError(null);

    const newSiteAnalysis: StyleSection = {
        id: Date.now().toString(),
        name: isolatedName, 
        css: isolatedCss, 
        html: isolatedHtml, 
        url: analysis.urlAnalyzed 
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
    
    const updatedTheme = newLibrary.find(t => t.id === selectedTheme.id);
    setSelectedTheme(updatedTheme || null);
    
    setIsComponentIsolated(false);
    setIsolatedHtml('');
    setIsolatedCss('');
    setCurrentDetection(null);
    setDomDepth(0);
    setLoading(false);
  };

  const handleSelectTheme = (themeId: string) => { /* ... handleSelectTheme function remains the same ... */
    const theme = library.find(t => t.id === themeId);
    setSelectedTheme(theme || null);
    setFileContent('');
    setAnalysis(null); 
    setApiError(null); 
  };
  
  const handleDeleteTheme = async (themeId: string) => { /* ... handleDeleteTheme function remains the same ... */
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce groupe de thème complet ?')) return;

    const newLibrary = library.filter(t => t.id !== themeId);
    await saveLibrary(newLibrary); 
    if (selectedTheme?.id === themeId) {
      setSelectedTheme(null);
      setAnalysis(null);
    }
  };

  const handleDeleteSection = async (themeId: string, sectionId: string) => { /* ... handleDeleteSection function remains the same ... */
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


  // --- 4. Génération et Affichage du Fichier Typescript (Mise à jour pour les composants isolés) ---

  const generateTSFileContent = (allThemes: ThemeStyle[]): string => {
    
    const escapeAndCleanContentForAI = (content: string) => {
        let cleanedContent = content;
        cleanedContent = cleanedContent.replace(/<svg\b[^>]*>.*?<\/svg>/gs, '[logo]');
        cleanedContent = cleanedContent.replace(/<path\b[^>]*>.*?<\/path>/gs, '[logo]');
        cleanedContent = cleanedContent.replace(/<g\b[^>]*>.*?<\/g>/gs, '[logo]');
        return cleanedContent.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    };
    
    const themesContent = allThemes.map((theme, themeIndex) => {
        const themeTagName = `theme_component_group_${themeIndex + 1}`;
        
        const componentsContent = theme.sections.map((site, componentIndex) => {
            const componentTagName = `component_${componentIndex + 1}`;
            
            const cleanedHtml = escapeAndCleanContentForAI(site.html);
            const cleanedCss = escapeAndCleanContentForAI(site.css);

            return `
    <${componentTagName} name="${site.name.toUpperCase()}" url_source="${site.url}">
        <metadata>
            <theme_name>${theme.name}</theme_name>
            <component_name>${site.name}</component_name>
            <isolation_id>${site.id}</isolation_id>
        </metadata>
        <css_style_isolation>
            ${cleanedCss}
        </css_style_isolation>
        <html_structure>
            ${cleanedHtml}
        </html_structure>
    </${componentTagName}>`;
        }).join('\n'); // <-- Fin du map des composants (sections)

        return `
<${themeTagName} name="${theme.name.toUpperCase()}">
${componentsContent}
</${themeTagName}>`;
    }).join('\n\n'); // <-- Fin du map des thèmes

    return `
/**
 * Fichier de librairie de styles généré pour l'IA.
 * Contient tous les thèmes et composants isolés du IndexedDB, formatés pour être consommés comme un PROMPT STRUCTURÉ.
 * Les éléments SVG/Path/G ont été remplacés par [logo] pour réduire la taille du prompt.
 * Ces composants incluent la structure DOM parente (jusqu'à la profondeur définie par l'utilisateur) pour un meilleur style contextuel.
 */
export const DESIGN_STYLE_LIBRARY_PROMPT = \`
${themesContent}
\`;
`;
  }; // <-- Fin de la fonction generateTSFileContent

  const handleShowFile = () => { setFileContent(generateTSFileContent(library)); };
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

      {/* SECTION 1: Analyse et Préparation */}
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
          {loading ? 'Analyse en cours...' : 'Lancer l\'Analyse & Détection des Composants'}
        </button>
      </div>

      {/* SECTION 2: Visualisation et Détection Automatique */}
      {analysis && analysis.success && (
        <div style={{ marginBottom: '20px', border: '1px solid #333', padding: '15px', borderRadius: '8px', display: 'flex', gap: '20px' }}>
          
          <div style={{ flex: 1, minWidth: '400px' }}>
             <h2>2.1. Site Analysé (Aperçu Statique)</h2>
            <iframe
              srcDoc={iframeContent}
              title="Visualisation du contenu analysé (statique)"
              // L'onload est maintenant retiré car l'iframe n'est plus interactif pour la sélection
              style={{ width: '100%', height: '400px', border: '2px solid #333', borderRadius: '8px' }}
            />
          </div>

          <div style={{ flex: 1 }}>
            <h2>2.2. Composants Détectés ({detectedElements.length})</h2>
            <p style={{ marginBottom: '10px', fontSize: '14px', color: '#555' }}>
                Cliquez sur **"Isoler & Prévisualiser"** pour charger le composant dans l'aperçu dynamique ci-dessous.
            </p>
            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px', borderRadius: '4px' }}>
                {detectedElements.length > 0 ? (
                    detectedElements.map((detection) => (
                        <div 
                            key={detection.id}
                            style={{ 
                                padding: '8px', 
                                borderBottom: '1px dotted #ccc', 
                                marginBottom: '5px', 
                                backgroundColor: currentDetection?.id === detection.id ? '#fff3e0' : 'transparent'
                            }}
                        >
                            <div style={{ fontWeight: 'bold' }}>
                                Tag: &lt;{detection.tagName}&gt; | Sélecteur: {detection.selector}
                            </div>
                            <code style={{ fontSize: '11px', color: '#777' }}>{detection.htmlSnippet}</code>
                            <button
                                onClick={() => handleIsolateProgrammatically(detection)}
                                style={{ 
                                    float: 'right', 
                                    padding: '5px 10px', 
                                    backgroundColor: '#0070f3', 
                                    color: 'white', 
                                    border: 'none', 
                                    borderRadius: '3px', 
                                    cursor: 'pointer' 
                                }}
                            >
                                Isoler & Prévisualiser
                            </button>
                            <div style={{ clear: 'both' }}></div>
                        </div>
                    ))
                ) : (
                    <p>Aucun élément structural ou identifié n'a été trouvé.</p>
                )}
            </div>
          </div>
        </div>
      )}
      
      {/* SECTION 3: Composant Isolé et Contrôle du DOM */}
      {isComponentIsolated && analysis && (
        <div style={{ border: '2px solid #00AA00', padding: '15px', marginBottom: '20px', borderRadius: '8px', backgroundColor: '#e6ffe6' }}>
            <h2>3. Composant Isolé Sélectionné ({isolatedName})</h2>
            
            <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                <label style={{ fontWeight: 'bold' }}>
                    Niveaux DOM Parents à Inclure (Contextualisation Style):
                </label>
                <input
                    type="number"
                    min="0"
                    max="5"
                    value={domDepth}
                    onChange={(e) => setDomDepth(Math.max(0, Math.min(5, parseInt(e.target.value) || 0)))}
                    style={{ width: '60px', padding: '8px', border: '1px solid #00AA00', textAlign: 'center' }}
                />
                <span style={{ fontSize: '14px', color: '#555' }}>({domDepth} niveaux de div/éléments parents sont inclus.)</span>
            </div>
            
            <div style={{ display: 'flex', gap: '20px' }}>
                <div style={{ flex: 1 }}>
                    <h3>Rendu Isolé (Aperçu)</h3>
                    <iframe
                        srcDoc={isolatedIframeContent}
                        title="Visualisation du composant isolé"
                        style={{ width: '100%', height: '300px', border: '1px solid #00AA00', borderRadius: '4px' }}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <h3>Code Source pour l'IA (Aperçu Nettoyé)</h3>
                    <p>
                        **HTML/DOM:** {isolatedHtml.length} chars, 
                        **CSS extrait:** {isolatedCss.length} chars
                    </p>
                    <textarea 
                        value={`HTML snippet (depth ${domDepth}):\n${isolatedHtml.substring(0, 500)}...\n\nCSS snippet:\n${isolatedCss.substring(0, 500)}...`} 
                        readOnly
                        style={{ width: '100%', height: '150px', resize: 'none', backgroundColor: '#f4f4f4', padding: '10px', fontSize: '12px' }}
                        title="HTML et CSS isolé"
                    />
                </div>
            </div>

            <input
                type="text"
                value={isolatedName}
                onChange={(e) => setIsolatedName(e.target.value.replace(/[^\w\d]/g, '_').toLowerCase().substring(0, 40))}
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
                  **Composant #{index + 1}**: <code style={{ backgroundColor: '#e6f7ff', padding: '2px 4px' }}>{site.name.toUpperCase()}</code> (HTML/DOM: {Math.round(site.html.length / 1024)} KB, CSS: {Math.round(site.css.length / 1024)} KB)
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
            
