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
 * Tente d'extraire les règles CSS pertinentes pour le PROMPT de l'IA.
 * Cette fonction est optimisée pour la lisibilité par l'IA et non pour un rendu 100% fidèle seul.
 * Le rendu 100% fidèle utilise analysis.fullCSS.
 */
const extractRelevantCss = (fullCSS: string, element: HTMLElement, domDepth: number): string => {
    const selectors = new Set<string>();
    
    // Collecte des sélecteurs de l'élément sélectionné et de ses DESCENDANTS
    const collectSelectors = (el: HTMLElement, maxDepth: number) => {
        if (el.className) {
            el.className.split(/\s+/).forEach(cls => selectors.add('.' + cls.trim()));
        }
        if (el.id) {
            selectors.add('#' + el.id.trim());
        }
        selectors.add(el.tagName.toLowerCase());

        // Limiter la collecte des descendants pour ne pas surcharger (si on veut le strict minimum)
        if (maxDepth > 0) {
            Array.from(el.children).forEach(child => {
                if (child instanceof HTMLElement) {
                    collectSelectors(child, maxDepth - 1);
                }
            });
        }
    };
    
    collectSelectors(element, 3); // Collecter les sélecteurs jusqu'à 3 niveaux de profondeur dans l'élément isolé.
    
    // Collecte des sélecteurs des PARENTS (jusqu'à la profondeur DOM)
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

    // Construction d'une expression régulière plus simple pour la recherche
    const selectorRegex = new RegExp(
        Array.from(selectors)
             // Échapper les caractères spéciaux utilisés en Regex
            .map(s => s.replace(/([.*+?^=!:${}()|[\]/\\])/g, '\\$1')) 
             // Regrouper les sélecteurs pour une seule recherche efficace
            .join('|'), 
        'g'
    );
    
    // Recherche agressive : trouver les blocs de règles
    const aggressiveRuleRegex = new RegExp(`([^}]+)({[^}]*})`, 'gs');
    let relevantCss = '';
    let match;
    
    while ((match = aggressiveRuleRegex.exec(fullCSS)) !== null) {
        const selectorsPart = match[1]; 
        
        // Tester si la partie sélecteurs contient un de nos sélecteurs.
        if (selectorRegex.test(selectorsPart)) {
            relevantCss += match[0] + '\n';
        }
    }

    // Assurer l'inclusion des styles de base critiques pour l'autonomie
    return `
/* Style de Réinitialisation minimal pour l'autonomie du composant */
html, body {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: inherit; 
    font-size: 100%;
    line-height: 1.5;
}
* { box-sizing: border-box; }
/* FIN du Style de Réinitialisation */

${relevantCss}`;
};

/**
 * Récupère le HTML de l'élément sélectionné entouré par ses parents jusqu'à la profondeur spécifiée.
 * Inclut l'attribut 'style' pour garantir la fidélité des styles en ligne.
 */
const getSurroundingDom = (element: HTMLElement, depth: number): string => {
    let current = element;
    let wrapper = element.outerHTML; // Commence avec le HTML de l'élément

    // Fonction pour générer la balise ouvrante d'un élément
    const buildOpeningTag = (el: HTMLElement): string => {
        const tagName = el.tagName.toLowerCase();
        
        // Filtrer les attributs inutiles/dynamiques et récupérer les attributs de base
        const attributes = Array.from(el.attributes)
            .filter(attr => !attr.name.startsWith('data-') && attr.name !== 'style') 
            .map(attr => `${attr.name}="${attr.value}"`)
            .join(' ');
            
        // 🛑 CLÉ 1: Inclure l'attribut 'style' si présent pour conserver les styles en ligne (inlining partiel)
        const styleAttr = el.getAttribute('style') ? ` style="${el.getAttribute('style')}"` : '';
        
        // 🛑 CLÉ 2: Inclure l'attribut 'class' manuellement pour s'assurer qu'il est toujours là.
        const classAttr = el.className ? ` class="${el.className}"` : '';
            
        // Construire la balise d'ouverture
        return `<${tagName} ${attributes}${classAttr}${styleAttr}>`;
    };

    // Le premier élément (l'élément isolé lui-même) doit conserver ses styles
    const originalOuterHTML = element.outerHTML;
    const openingTag = buildOpeningTag(element);
    
    // Remplacer l'ancienne balise ouvrante par la balise nettoyée et stylée
    wrapper = originalOuterHTML.replace(
        new RegExp(`^<${element.tagName.toLowerCase()}[^>]*?>`), 
        openingTag
    );
    
    // Traitement des parents
    let currentWrapperElement = element.parentElement;
    for (let i = 0; i < depth; i++) {
        if (!currentWrapperElement || currentWrapperElement.tagName.toLowerCase() === 'body') {
            break;
        }
        
        const parentOpeningTag = buildOpeningTag(currentWrapperElement);
        const parentClosingTag = `</${currentWrapperElement.tagName.toLowerCase()}>`;
        
        // Envelopper le contenu
        wrapper = `${parentOpeningTag}${wrapper}${parentClosingTag}`;
        currentWrapperElement = currentWrapperElement.parentElement;
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
// --- Nouveaux États pour l'interaction IA ---
const [aiGenerationResult, setAiGenerationResult] = useState(''); // Le HTML/CSS généré par l'IA
const [isAiLoading, setIsAiLoading] = useState(false);
const [aiError, setAiError] = useState<string | null>(null);
const [componentToGenerate, setComponentToGenerate] = useState('Navbar'); // Type de composant demandé

// --- États pour le Sandbox E2B ---
const [sandboxId, setSandboxId] = useState<string | null>(null);
const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
const [sandboxStatus, setSandboxStatus] = useState<'IDLE' | 'CREATING' | 'INSTALLING' | 'BUILDING' | 'RUNNING' | 'ERROR'>('IDLE');
const [sandboxLogs, setSandboxLogs] = useState<string[]>([]);
const [e2bError, setE2bError] = useState<string | null>(null);

// --- États pour le Chat IA ---
// NOTE: Utilisez 'any' pour le type Content si vous n'avez pas l'import
const [chatHistory, setChatHistory] = useState<any[]>([]); 
const [chatInput, setChatInput] = useState('');
const [isChatLoading, setIsChatLoading] = useState(false);

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
  

                            // Recalcule l'isolation dès que la profondeur du DOM change
  useEffect(() => {
    if (currentDetection && analysis) {
        // L'updateIsolationComponent génère toujours le CSS FILTRÉ pour le PROMPT de l'IA.
        updateIsolatedComponent(currentDetection, domDepth, analysis.fullHTML, analysis.fullCSS);
    }
  }, [domDepth, currentDetection, analysis, updateIsolatedComponent]); // <-- NOUVELLE DÉPENDANCE: 'analysis'


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
  // --- IFrame ISOLÉ (Visualisation du composant sélectionné) ---
const isolatedIframeContent = useMemo(() => { 
    if (!isComponentIsolated || !analysis) return '';

    // 🛑 CLÉ: Utiliser le CSS COMPLET de l'analyse pour une fidélité visuelle de 100%
    const fullCssForRendering = analysis.fullCSS; 
    // 🛑 CLÉ: Utiliser l'URL analysée comme base pour les chemins relatifs
    const baseHref = analysis.urlAnalyzed;

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${baseHref}"> 
          <style>
            ${fullCssForRendering}
          </style>
          <style>
            /* Vous pouvez ajuster ou supprimer ces styles pour une fidélité maximale */
            body { 
                margin: 0; 
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
}, [isolatedHtml, isComponentIsolated, analysis]);


// --- NOUVEAU: IFrame VÉRIFICATION AUTONOME (Utilise uniquement le CSS Filtré pour l'IA) ---
// --- IFrame VÉRIFICATION AUTONOME (CSS Inlining Auto-Exécutant) ---
const standaloneIframeContent = useMemo(() => {
    if (!isComponentIsolated || !analysis) return '';

    // CLÉ: On utilise le CSS COMPLET pour que le moteur de rendu puisse calculer les styles
    const fullCssForCalculation = analysis.fullCSS; 
    const baseHref = analysis.urlAnalyzed;
    const rootId = currentDetection?.id || 'isolated-root';

    // Script pour inliner les styles calculés
    const inliningScript = `
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          const rootElement = document.querySelector('[data-auto-inlining-id="${rootId}"]');
          if (!rootElement) {
              console.error('Élément racine non trouvé pour l\'inlining.');
              return;
          }

          function inlineComputedStyles(element) {
              if (!element || element.nodeType !== 1) return;

              const computedStyle = window.getComputedStyle(element);
              const styleProps = {};
              
              // Liste des propriétés que vous voulez absolument conserver
              const relevantProps = [
                  'color', 'backgroundColor', 'border', 'padding', 'margin', 
                  'width', 'height', 'fontSize', 'fontWeight', 'textAlign', 
                  'display', 'position', 'top', 'left', 'right', 'bottom', 
                  'lineHeight', 'fontFamily', 'boxShadow', 'textDecoration',
                  'flexDirection', 'justifyContent', 'alignItems', 'gap' 
              ];
              
              const currentInlineStyle = element.getAttribute('style') || '';
              let newInlineStyle = currentInlineStyle;

              relevantProps.forEach(prop => {
                  const value = computedStyle.getPropertyValue(prop);
                  if (value && value !== 'initial' && value !== 'unset' && !currentInlineStyle.includes(prop)) {
                      // Convertir en kebab-case
                      const cssProp = prop.replace(/([A-Z])/g, (g) => \`-\${g[0].toLowerCase()}\`);
                      newInlineStyle += \`\${cssProp}: \${value}; \`;
                  }
              });
              
              // Appliquer les nouveaux styles. 
              element.setAttribute('style', newInlineStyle.trim());
              
              // Optionnel: Retirer les classes pour le test ultime de l'autonomie du style.
              // element.removeAttribute('class'); // Décommenter si vous voulez voir la défaillance des styles non inlinés

              // Récursivement pour les enfants
              Array.from(element.children).forEach(inlineComputedStyles);
          }

          inlineComputedStyles(rootElement);

          // Signal que l'inlining est terminé. L'utilisateur doit copier le outerHTML ici.
          console.log("INLINING TERMINÉ. Copiez le outerHTML de l'élément.");
          rootElement.style.outline = '3px solid green'; // Marqueur visuel de fin
        });
      </script>
    `;
    
    // Ajout d'un attribut pour que le script puisse trouver l'élément racine
    const taggedHtml = isolatedHtml.replace(
        new RegExp(`^<([a-z]+)`, 'i'), 
        (match, tag) => `<${tag} data-auto-inlining-id="${rootId}"`
    );


    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${baseHref}"> 
          <style>
            ${fullCssForCalculation}
          </style>
          <style>
            body { margin: 0; padding: 10px; border: 2px dashed red; min-height: 90vh; }
          </style>
      </head>
      <body>
          ${taggedHtml}
          ${inliningScript}
      </body>
      </html>
    `;
}, [isolatedHtml, isComponentIsolated, analysis, currentDetection]);


// --- Fonction: Gère l'appel à la route API Next.js ---
const handleGenerateWithAI = async () => {
    // Vérification: l'utilisateur doit avoir isolé un composant
    if (!isolatedHtml || !isolatedCss) {
        setAiError("Veuillez d'abord isoler un composant pour fournir une référence de style.");
        return;
    }
    
    setIsAiLoading(true);
    setAiError(null);
    setAiGenerationResult('');

    // --- 1. Construction du PROMPT Structuré (Apprentissage) ---
    const learningHtml = isolatedHtml;
    const learningCss = isolatedCss; 
    
    const structuredInput = `
Vous êtes un expert en UI/UX. Analysez les composants ci-dessous pour leur qualité esthétique et structurelle.
Utilisez ce code comme RÉFÉRENCE ABSOLUE de design pour les classes et les styles (CSS filtré).

<PERFECT_COMPONENT_EXAMPLE>
  <HTML_SNIPPET>
    ${learningHtml}
  </HTML_SNIPPET>
  <CSS_SNIPPET>
    ${learningCss}
  </CSS_SNIPPET>
</PERFECT_COMPONENT_EXAMPLE>

// --- 2. Instruction de Génération ---
En vous basant uniquement sur les classes et le style de la RÉFÉRENCE fournie,
générez un composant ${componentToGenerate} en HTML et CSS (dans une balise <style>). 
Le code doit être parfaitement structuré (utilisez des balises sémantiques: <nav>, <aside>, etc.).
Votre réponse doit être UNIQUEMENT le code HTML/CSS complet, prêt à être affiché dans un <body>. Ne pas inclure de balise <html>, <head> ou <body>.
`;
    
    const API_ENDPOINT = '/api/generate-component';

    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: structuredInput }), // Envoi du prompt
        });

        if (!response.ok) {
            throw new Error(`Erreur API: ${response.statusText}`);
        }

        const data = await response.json(); 
        
        // Stockage du code généré brut
        setAiGenerationResult(data.generatedCode || '');
        
    } catch (e: any) {
        setAiError(e.message || "Une erreur est survenue lors de l'appel à l'IA.");
    } finally {
        setIsAiLoading(false);
    }
};

// --- Fonction: Prépare le contenu pour le QUATRIÈME Iframe ---
const aiIframeContent = useMemo(() => {
    if (!aiGenerationResult) return '';

    return `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
                margin: 0; 
                padding: 20px; 
                min-height: 90vh;
                border: 3px solid purple; /* Bordure Violette pour la Génération IA */
            }
          </style>
      </head>
      <body>
          ${aiGenerationResult}
      </body>
      </html>
    `;
}, [aiGenerationResult]);

  // --- 3. Gestion des Thèmes et Sections (Sauvegarde et Suppression) ---


// Fichier: app/library/page.tsx

const SANDBOX_API_ENDPOINT = '/api/sandbox';
const CHAT_API_ENDPOINT = '/api/chat';

const addLog = (message: string) => {
    setSandboxLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
};

// --- Fonction Générique d'Action Sandbox (modifiée pour la gestion d'erreur) ---
const callSandboxAction = async (action: string, body: any = {}) => {
    setE2bError(null);
    try {
        const response = await fetch(SANDBOX_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, sandboxId, ...body }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            // 🛑 Gère le cas où l'erreur est dans stderr (install/build)
            throw new Error(result.error || result.details || result.stderr || `Erreur lors de l'action ${action}.`);
        }
        return result;
    } catch (e: any) {
        addLog(`ERREUR E2B: Action ${action} failed: ${e.message}`);
        setE2bError(e.message);
        setSandboxStatus('ERROR');
        throw e;
    }
};

// --- Fonction de Création (Écriture du Full CSS) ---
const handleCreateSandbox = async () => {
    // analysis est l'objet qui contient fullCSS et detections après l'analyse
    if (!analysis?.fullCSS) { 
        setE2bError("Veuillez analyser un site pour obtenir le Full CSS avant de créer la Sandbox.");
        return;
    }
    setSandboxStatus('CREATING');
    addLog('Démarrage de la création de la Sandbox Next.js...');
    try {
        const result = await callSandboxAction('create');
        setSandboxId(result.sandboxId);
        addLog(`✅ Sandbox créée: ${result.sandboxId}.`);
        
        // 🛑 Écriture du Full CSS dans globals.css via 'addFile' (votre route existante)
        addLog('Écriture du Full CSS dans app/globals.css...');
        await callSandboxAction('addFile', { 
            filePath: 'app/globals.css', 
            content: analysis.fullCSS // Le Full CSS complet
         });
        addLog('✅ Full CSS écrit dans app/globals.css.');
        
        setSandboxStatus('IDLE');
    } catch (e) {
        // Erreur gérée
    }
};

// --- Logique d'Extraction de Fichiers (Clé pour la communication IA <-> Sandbox) ---
const extractFilesFromResponse = (text: string): { filePath: string, content: string }[] => {
    // Regex pour capturer les blocs de code Markdown et le chemin d'accès explicite (// Path:)
    const fileRegex = /```(?:tsx|jsx|ts|js|css|json|html|bash|plaintext)\n([\s\S]*?)\n```\s*(\/\/\s*Path:\s*(.*?)\s*)?/g;
    let match;
    const files: { filePath: string, content: string }[] = [];

    while ((match = fileRegex.exec(text)) !== null) {
        const fileContent = match[1].trim();
        const rawPath = match[3]; 
        
        if (rawPath) {
            const cleanPath = rawPath.trim().startsWith('src/') ? rawPath.trim().substring(4) : rawPath.trim();
            files.push({ filePath: cleanPath, content: fileContent });
        } else {
            addLog('⚠️ Fichier généré sans chemin explicite. Ignoré.');
        }
    }
    return files;
};


// --- Fonction de Chat et Génération (Cœur du système) ---
const handleSendMessage = async (message: string, isCorrection = false) => {
    if ((!message && !isCorrection) || isChatLoading) return;
    
    const userMessage = { role: "user", parts: [{ text: message }] };
    if (!isCorrection) setChatInput(''); 
    setChatHistory(prev => [...prev, userMessage]); 
    
    setIsChatLoading(true);

    // 🛑 Construction du prompt INITIAL (Correction du Problème Landing Page/Application)
    let initialContext = '';
    if (chatHistory.length === 0 && !isCorrection && analysis?.detections) {
        // Injection de TOUS les composants pour le contexte de style
        const allDetectionsPrompt = analysis.detections
            .map(d => `<component_ref name="${d.name}" class_example="${d.classes.split(' ').slice(0, 3).join(' ')}" />`)
            .join('\n');
            
        initialContext = `
        CONTEXTE GLOBAL ET RÉFÉRENCE DE STYLE: L'intégralité du CSS du site est dans app/globals.css.
        Voici la liste de TOUS les composants du site analysé. Inspirez-vous de leur STYLE (couleurs, polices) pour créer une VRAIE PAGE D'APPLICATION avec une SÉMANTIQUE CORRECTE (Sidebar, Layouts, Dashboard).
        <ALL_COMPONENT_REFERENCES>
          ${allDetectionsPrompt}
        </ALL_COMPONENT_REFERENCES>
        
        INSTRUCTION: ${message}
        `;
    }

    const finalMessage = initialContext ? initialContext : message;

    try {
        const response = await fetch(CHAT_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                history: chatHistory, 
                currentMessage: finalMessage 
            }),
        });

        if (!response.ok) {
            throw new Error(`Erreur API: ${response.statusText}`);
        }

        const data = await response.json();
        const generatedResponse = data.generatedResponse || '';

        const aiResponse = { role: "model", parts: [{ text: generatedResponse }] };
        setChatHistory(prev => [...prev, aiResponse]);
        
        const filesToCreate = extractFilesFromResponse(generatedResponse);
        
        if (filesToCreate.length > 0) {
            if (sandboxId) {
                addLog(`L'IA a généré ${filesToCreate.length} fichiers. Écriture dans la Sandbox...`);
                // Utilisation de la nouvelle action writeFiles
                await callSandboxAction('writeFiles', { files: filesToCreate });
                addLog('✅ Fichiers écrits. Vous pouvez maintenant Installer/Build/Démarrer.');
            } else {
                addLog('⚠️ Fichiers générés, mais aucune Sandbox active pour l\'écriture.');
            }
        }
        
    } catch (e: any) {
        setE2bError(e.message || "Erreur inconnue lors du chat IA.");
    } finally {
        setIsChatLoading(false);
    }
};

// --- Les autres fonctions E2B (handleInstall, handleBuild, handleStart)
// Elles appellent callSandboxAction et utilisent handleSendMessage en cas d'erreur
const handleInstall = async () => {
    if (!sandboxId) return;
    setSandboxStatus('INSTALLING');
    addLog('Lancement de npm install...');
    try {
        const result = await callSandboxAction('install');
        if (result.success) {
            addLog('✅ Installation terminée.');
            setSandboxStatus('IDLE');
        } else {
            addLog(`❌ Installation ÉCHOUÉE. Envoi du log d'erreur à l'IA...`);
            // Correction basée sur stderr
            handleSendMessage(`Corrige les erreurs d'installation npm/dépendances dans package.json basées sur ce log:\n${result.stderr}`, true);
        }
    } catch (e) {}
};

const handleBuild = async () => {
    if (!sandboxId) return;
    setSandboxStatus('BUILDING');
    addLog('Lancement de npm run build...');
    try {
        const result = await callSandboxAction('build');
        if (result.success) {
            addLog('✅ Build terminé avec succès.');
            setSandboxStatus('IDLE');
        } else {
            addLog(`❌ Build ÉCHOUÉ. Envoi du log d'erreur à l'IA...`);
            // Correction basée sur stderr
            handleSendMessage(`Corrige les erreurs de code/build (dans app/page.tsx ou autres) basées sur ce log:\n${result.stderr}`, true);
        }
    } catch (e) {}
};

const handleStart = async () => {
    if (!sandboxId) return;
    setSandboxStatus('RUNNING');
    addLog('Démarrage de l\'application (npm run start)...');
    try {
        const result = await callSandboxAction('start');
        setSandboxUrl(result.url);
        addLog(`✅ Application démarrée. URL: ${result.url}`);
        setSandboxStatus('RUNNING');
    } catch (e) {}
};
  
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
                    <h3>Rendu Fidèle (CSS Complet)</h3>
                    <iframe
                        srcDoc={isolatedIframeContent}
                        title="Visualisation du composant isolé fidèle"
                        style={{ width: '100%', height: '300px', border: '1px solid #00AA00', borderRadius: '4px' }}
                    />
                </div>
                
                {/* 🛑 NOUVEL Iframe de VÉRIFICATION AUTONOME */}
                <div style={{ flex: 1 }}>
                    <h3>Rendu AUTONOME (CSS Filtré pour IA)</h3>
                    <iframe
                        srcDoc={standaloneIframeContent}
                        title="Visualisation autonome du composant isolé"
                        style={{ width: '100%', height: '300px', border: '2px solid red', borderRadius: '4px' }}
                    />
                </div>
            </div>

            <div style={{ flex: 2, marginTop: '20px' }}>
                <h3>Code Source pour l'IA (Complet et Non Tronqué)</h3>
                <p>
                    **HTML/DOM:** {isolatedHtml.length} chars, 
                    **CSS extrait:** {isolatedCss.length} chars. **Ce code source est celui qui est envoyé à l'IA.**
                </p>
                <textarea 
                    // 🛑 Affichage du code source COMPLET, sans les "..."
                    value={`HTML snippet (depth ${domDepth}):\n${isolatedHtml}\n\nCSS snippet:\n${isolatedCss}`} 
                    readOnly
                    style={{ width: '100%', height: '180px', resize: 'none', backgroundColor: '#f4f4f4', padding: '10px', fontSize: '12px' }}
                    title="HTML et CSS isolé"
                />
            </div>
            
            {/* Le reste de la Section 3... */}
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


        <hr style={{ margin: '40px 0' }} />



<hr style={{ margin: '40px 0' }} />

{/* Section 4: Chat IA, Génération Next.js & Sandbox */}
<div style={{ padding: '20px', border: '1px solid #6A1B9A', borderRadius: '8px', backgroundColor: '#faf5ff' }}>
    <h2>🤖 Chat IA & Sandbox Next.js (E2B)</h2>
    <p>
        **Objectif :** Générer des pages d'application (Settings, Dashboard) qui utilisent le style de la Landing Page.
        **Flux :** 1. Créer Sandbox & Écrire CSS &gt; 2. Chat &gt; 3. Installer &gt; 4. Build &gt; 5. Démarrer
    </p>

    {/* Contrôles de la Sandbox */}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '20px', padding: '15px', border: '1px dashed #A55EEA', borderRadius: '4px' }}>
        <h3 style={{ width: '100%', margin: '0 0 10px 0' }}>⚙️ Opérations Sandbox E2B</h3>
        
        {/* Boutons d'Action */}
        <button 
            onClick={sandboxId ? () => addLog(`Sandbox ID: ${sandboxId}`) : handleCreateSandbox} 
            disabled={sandboxStatus !== 'IDLE' && !sandboxId || !analysis}
            style={{ padding: '8px 15px', backgroundColor: sandboxId ? '#00AA00' : '#6A1B9A', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
            {sandboxStatus === 'CREATING' ? 'Création...' : (sandboxId ? `Sandbox: ${sandboxId.substring(0, 8)}...` : '1. Créer Sandbox & Écrire CSS')}
        </button>
        <button 
            onClick={handleInstall} 
            disabled={!sandboxId || sandboxStatus !== 'IDLE'}
            style={{ padding: '8px 15px', backgroundColor: sandboxStatus === 'INSTALLING' ? '#FFCC00' : '#3399FF', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
            {sandboxStatus === 'INSTALLING' ? 'Installation...' : 'npm install'}
        </button>
        <button 
            onClick={handleBuild} 
            disabled={!sandboxId || sandboxStatus !== 'IDLE'}
            style={{ padding: '8px 15px', backgroundColor: sandboxStatus === 'BUILDING' ? '#FFCC00' : '#3399FF', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
            {sandboxStatus === 'BUILDING' ? 'Build...' : 'npm run build'}
        </button>
        <button 
            onClick={handleStart} 
            disabled={!sandboxId || sandboxStatus !== 'IDLE'}
            style={{ padding: '8px 15px', backgroundColor: sandboxStatus === 'RUNNING' ? '#00AA00' : '#FF5733', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
            {sandboxStatus === 'RUNNING' ? 'Running...' : 'npm run start'}
        </button>

        <p style={{ margin: '5px 0 0 0', fontWeight: 'bold' }}>Statut: {sandboxStatus}</p>
        {e2bError && <p style={{ color: 'red', width: '100%' }}>Erreur E2B: {e2bError}</p>}
    </div>
    
    {/* Console des Logs */}
    <h3 style={{ marginTop: '20px' }}>Logs E2B (Sortie Console & Erreurs)</h3>
    <textarea 
        value={sandboxLogs.join('\n')} 
        readOnly
        style={{ width: '100%', height: '100px', resize: 'none', backgroundColor: '#333', color: '#00FF00', padding: '10px', fontSize: '12px', fontFamily: 'monospace' }}
        title="Logs Sandbox"
    />

    {/* Interface de Chat */}
    <h3 style={{ marginTop: '20px' }}>Chat avec l'IA (Historique Conservé)</h3>
    <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '10px', border: '1px solid #ddd', backgroundColor: 'white', marginBottom: '10px' }}>
        {chatHistory.map((msg, index) => (
            <div key={index} style={{ marginBottom: '10px', padding: '5px', borderRadius: '4px', backgroundColor: msg.role === 'user' ? '#e6f7ff' : '#f5f5f5', borderLeft: `3px solid ${msg.role === 'user' ? '#007bff' : '#6A1B9A'}` }}>
                <strong>{msg.role === 'user' ? 'Vous' : 'IA (Gemini)'}:</strong>
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: '5px 0' }}>{msg.parts.map(p => p.text).join('')}</pre>
            </div>
        ))}
        {isChatLoading && <p>🧠 L'IA réfléchit...</p>}
    </div>
    
    <div style={{ display: 'flex', gap: '10px' }}>
        <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && chatInput) handleSendMessage(chatInput); }}
            placeholder="Ex: Crée une page Settings avec une Sidebar"
            disabled={isChatLoading}
            style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
        />
        <button 
            onClick={() => handleSendMessage(chatInput)} 
            disabled={isChatLoading || !chatInput}
            style={{ padding: '10px 15px', backgroundColor: '#6A1B9A', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
        >
            Envoyer
        </button>
    </div>
</div>

{/* Iframe du Sandbox Next.js */}
{sandboxUrl && (
    <div style={{ marginTop: '20px' }}>
        <h3>🚀 Rendu de l'Application Next.js (via Sandbox)</h3>
        <iframe
            src={sandboxUrl}
            title="Next.js Sandbox Application"
            style={{ width: '100%', height: '600px', border: '3px solid #6A1B9A', borderRadius: '4px' }}
        />
        <p style={{ marginTop: '5px' }}>URL Sandbox: <a href={sandboxUrl} target="_blank" rel="noopener noreferrer">{sandboxUrl}</a></p>
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
            
