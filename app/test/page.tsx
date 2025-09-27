'use client';

import React, { useState, useCallback } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor'; // Importation du type Monaco pour une meilleure typage

/**
 * Page Next.js Client Component intégrant Monaco Editor.
 * Désactive la vérification TypeScript/JSX et personnalise la sidebar.
 */
export default function MonacoEditorPage() {
  
  const initialCode = `// ✅ La vérification de type (les lignes rouges sous import) est désactivée.
// ✅ La sidebar des numéros de ligne est stylisée.

import React, { useState } from 'react';

interface UserProps {
  id: number;
  name: string; 
}

const ProfileComponent = ({ name, id }: UserProps) => {
  const [count, setCount] = useState(0);

  return (
    <div className="profile-card"> 
      <h1>Profil ID: {id}</h1>
      <button 
        onClick={() => setCount(count + 1)}
      >
        Count: {count}
      </button>
    </div>
  );
};

export default ProfileComponent;
`;

  const [code, setCode] = useState<string>(initialCode);
  const [theme, setTheme] = useState<'light' | 'vs-dark'>('light');

  const handleEditorChange: OnChange = useCallback((value) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, []);

  // 💡 Fonction appelée lorsque l'éditeur est monté
  const handleEditorDidMount: OnMount = useCallback((editorInstance, monaco) => {
    
    // --- 1. Désactivation de la vérification TypeScript/JSX (Lignes Rouges) ---
    // Cette configuration dit à Monaco de ne pas vérifier les erreurs pour JS/TSX.
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      // Désactive l'émission de la vérification des types
      noSemanticValidation: true, 
      // Désactive l'émission de la vérification de la syntaxe (par exemple, balises JSX mal formées)
      noSyntaxValidation: true,   
      // Permet l'utilisation du JSX
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
    
    // --- 2. Personnalisation des Numéros de Ligne et de la Sidebar ---
    // Nous utilisons un style CSS personnalisé (via le thème) pour atteindre la couleur noire (#000000)
    // et gérer l'opacité.
    monaco.editor.defineTheme('customTheme', {
        base: theme === 'light' ? 'vs' : 'vs-dark', // Hérite du thème de base actuel
        inherit: true,
        rules: [],
        colors: {
            // Couleur des numéros de ligne inactifs (faible opacité)
            'editorLineNumber.foreground': '#00000033', // #000000 avec opacité 20%
            // Couleur des numéros de ligne actifs (pleine opacité)
            'editorLineNumber.activeForeground': '#000000FF', 
            
            // Couleur de la ligne de code active (pour le contraste)
            'editor.lineHighlightBackground': theme === 'light' ? '#00000010' : '#ffffff10', // Faible opacité pour la ligne active
        },
    });

    // Appliquer le thème personnalisé
    monaco.editor.setTheme('customTheme');

  }, [theme]); // Le thème est une dépendance, on remonte l'instance quand le thème change.

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'vs-dark' : 'light');
  };

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: theme === 'light' ? '#f0f0f0' : '#1e1e1e', color: theme === 'light' ? '#000' : '#fff' }}>
      
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>Monaco Editor Next.js (TypeScript)</h1>
        <p>Thème actuel : <strong>{theme === 'light' ? 'Clair (Light)' : 'Sombre (VS-Dark)'}</strong></p>
        <button 
          onClick={toggleTheme} 
          style={{ padding: '8px 15px', cursor: 'pointer', backgroundColor: '#007ACC', color: '#fff', border: 'none', borderRadius: '4px' }}
        >
          Basculer Thème
        </button>
      </header>
      
      {/* --- Composant Monaco Editor --- */}
      <div style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden', height: '600px' }}>
        <Editor
          height="100%"
          defaultLanguage="typescript"
          value={code}
          theme='customTheme' // Utiliser le thème personnalisé défini ci-dessus
          onChange={handleEditorChange}
          onMount={handleEditorDidMount} // Appeler la fonction lors du montage pour les configurations
          options={{
            minimap: { enabled: true },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            // Permet de s'assurer qu'il y a assez d'espace pour la numérotation des lignes
            lineNumbersMinChars: 3, 
          }}
        />
      </div>
      
      <div style={{ marginTop: '30px' }}>
        <h2>Code Actuel</h2>
        <pre style={{ 
          backgroundColor: theme === 'light' ? '#fff' : '#333', 
          color: theme === 'light' ? '#000' : '#ddd',
          padding: '15px', 
          borderRadius: '4px', 
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace'
        }}>
          {code}
        </pre>
      </div>
    </div>
  );
      }
          
