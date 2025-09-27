'use client';

import React, { useState, useCallback } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

/**
 * Page Next.js Client Component intégrant Monaco Editor.
 * Personnalise la couleur des mots-clés (rouge-rose) et des imports (vert foncé).
 */
export default function MonacoEditorPage() {
  
  const initialCode = `// ✅ Les mots-clés 'import', 'const', 'interface' sont maintenant rouge-rose.
// ✅ Les identifiants (comme 'useState', 'React') sont vert foncé.

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

  const handleEditorDidMount: OnMount = useCallback((editorInstance, monaco) => {
    
    // --- 1. Désactivation de la vérification TypeScript/JSX (Lignes Rouges) ---
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      noSemanticValidation: true, 
      noSyntaxValidation: true,   
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
    
    // --- 2. Définition des Couleurs Personnalisées (Thème) ---
    monaco.editor.defineTheme('customTheme', {
        base: theme === 'light' ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [
            // 🎯 RÈGLE 1: Mots-clés (import, const, interface, return, etc.)
            { 
                token: 'keyword', 
                foreground: 'C0392B' // Rouge légèrement Rose (similaire à #C0392B)
            },
            // 🎯 RÈGLE 2: Identifiants (Noms des packages importés, fonctions, variables)
            { 
                token: 'identifier', 
                foreground: '006400' // Vert un peu foncé (similaire à #006400 - DarkGreen)
            },
            // Optionnel : Pour garantir que 'const' et 'interface' sont bien pris en compte,
            // bien que 'keyword' devrait suffire.
            { 
                token: 'keyword.tsx', // Pour TypeScript/JSX
                foreground: 'C0392B'
            },
            // Optionnel : Coloration des balises HTML (JSX) en vert aussi
            {
                token: 'tag',
                foreground: '006400' // Balises comme <div>, <button>
            }
        ],
        colors: {
            // Personnalisation de la Sidebar (comme précédemment)
            'editorLineNumber.foreground': '#00000033', // Inactif
            'editorLineNumber.activeForeground': '#000000FF', // Actif
            'editor.lineHighlightBackground': theme === 'light' ? '#00000010' : '#ffffff10',
        },
    });

    // Appliquer le thème personnalisé
    monaco.editor.setTheme('customTheme');

  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'vs-dark' : 'light');
  };

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: theme === 'light' ? '#f0f0f0' : '#1e1e1e', color: theme === 'light' ? '#000' : '#fff' }}>
      
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>Monaco Editor Next.js - Thèmes Personnalisés</h1>
        <p>Les mots-clés sont maintenant en **rouge-rose** et les imports/identifiants en **vert foncé**.</p>
        <button 
          onClick={toggleTheme} 
          style={{ padding: '8px 15px', cursor: 'pointer', backgroundColor: '#007ACC', color: '#fff', border: 'none', borderRadius: '4px' }}
        >
          Basculer Thème
        </button>
      </header>
      
      <div style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden', height: '600px' }}>
        <Editor
          height="100%"
          defaultLanguage="typescript"
          value={code}
          theme='customTheme' // Utiliser le thème personnalisé
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: true },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
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
          
