'use client';

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
// Importation de l'objet de thème pour une intégration stable
import { eclipse } from '@uiw/codemirror-theme-eclipse'; 
// Importations de '@codemirror/language' non utilisées dans cette version simple,
// mais conservées en commentaire pour référence future
// import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';

/**
 * Page Next.js Client Component intégrant CodeMirror avec le thème Eclipse.
 * Cette fonction exportée par défaut sert de page dans l'App Router de Next.js.
 */
export default function CodeMirrorEditorPage() {
  
  // Code TypeScript / JSX de démonstration
  const initialCode = `// Code TypeScript / JSX coloré par CodeMirror avec le thème Eclipse
// Si la coloration des imports/types est insuffisante, la limitation vient du thème 'eclipse' lui-même.

import React, { useState } from 'react';
import { calculateSum } from './utils'; 

// Définition d'une interface TypeScript
interface MyProps {
  name: string;
}

const MyComponent = ({ name }: MyProps) => {
  const [count, setCount] = useState(0);

  return (
    // Les balises JSX doivent être colorées (par exemple, 'div', 'button')
    <div className="container"> 
      <h1>Hello, {name}</h1>
      <button 
        onClick={() => setCount(count + 1)} // Attributs JSX
        aria-label="Increment counter"
      >
        Count: {count} {/* Contenu du composant */}
      </button>
    </div>
  );
};

export default MyComponent;
`;

  const [code, setCode] = useState<string>(initialCode);

  // Fonction de rappel pour mettre à jour l'état du code
  const onChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  // 1. Définition de l'extension JavaScript/TypeScript/JSX
  const jsTsxExtension = javascript({ 
    jsx: true,        // Activer le support JSX
    typescript: true  // Activer le support TypeScript
  });

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: '#f0f0f0' }}>
      
      {/* --- Section Tête de Page --- */}
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>CodeMirror Next.js (TypeScript) avec Thème Eclipse</h1>
        <p>Éditeur de code intégré en tant que **Client Component**.</p>
      </header>
      
      {/* --- Composant CodeMirror --- */}
      <CodeMirror
        value={code}
        height="500px"
        // 🎯 Utilisation de l'objet de thème importé
        theme={eclipse} 
        // 🚀 Ajout de l'extension complète pour JS/TS/JSX
        extensions={[jsTsxExtension]}
        onChange={onChange}
        basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: true,
            highlightActiveLineGutter: true,
        }}
        style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}
      />
      
      {/* --- Section Affichage du Code --- */}
      <div style={{ marginTop: '30px' }}>
        <h2>Code Actuel (Affiché depuis l'État React)</h2>
        <pre style={{ 
          backgroundColor: '#fff', 
          padding: '15px', 
          borderRadius: '4px', 
          border: '1px solid #ddd',
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: '0.9em'
        }}>
          {code}
        </pre>
      </div>
    </div>
  );
    }
    
