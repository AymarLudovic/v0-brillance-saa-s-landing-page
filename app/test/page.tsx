'use client';

import React, { useState, useCallback } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Extension } from '@codemirror/state';

/**
 * Page Next.js Client Component intégrant Monaco Editor.
 * Personnalisation très spécifique de la coloration syntaxique (Mots-clés, Identifiants, JSX).
 */
export default function MonacoEditorPage() {
  
  const initialCode = `// ✅ Coloration personnalisée activée !

// Les mots-clés 'import', 'from' sont en ROUGE.
// 'React', 'useState' sont en NOIR.
// La chaîne de package 'react' est en VERT.
import React, { useState } from 'react';
import { calculateSum } from './utils'; // 'calculateSum', './utils' en NOIR et VERT

// 'interface', 'const' sont en ROUGE.
interface UserProps {
  id: number; // Le type 'number' est noir par défaut (identifiant)
  name: string; 
}

const ProfileComponent = ({ name, id }: UserProps) => {
  const [count, setCount] = useState(0);

  return (
    // TOUT le JSX/HTML (balises et attributs) est en NOIR.
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
  // Maintenons le thème clair car le noir sur noir pour le JSX serait illisible.
  const [theme, setTheme] = useState<'light' | 'vs-dark'>('light'); 

  const handleEditorDidMount: OnMount = useCallback((editorInstance, monaco) => {
    
    // --- 1. Désactivation de la vérification TypeScript/JSX ---
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      noSemanticValidation: true, 
      noSyntaxValidation: true,   
      jsx: monaco.languages.typescript.JsxEmit.React,
    });
    
    // --- 2. Définition des Couleurs Spécifiques (Thème) ---
    // Rouge vif (pour les mots-clés)
    const ROUGE = 'FF0000'; 
    // Noir (pour les identifiants et le JSX)
    const NOIR = '000000'; 
    // Vert (pour les chaînes de caractères de packages)
    const VERT = '008000'; 

    monaco.editor.defineTheme('customTheme', {
        base: theme === 'light' ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [
            // 🎯 RÈGLE 1: Mots-clés (import, const, from, interface, return, export) -> ROUGE
            { 
                token: 'keyword', 
                foreground: ROUGE 
            },
            // Le jeton 'keyword.flow' couvre parfois 'from'.
            { 
                token: 'keyword.flow', 
                foreground: ROUGE 
            },

            // 🎯 RÈGLE 2: Chaînes de caractères (Chemin des imports ex: 'react', './utils') -> VERT
            { 
                token: 'string', 
                foreground: VERT 
            },
            
            // 🎯 RÈGLE 3: Identifiants (React, useState, calculateSum, UserProps, MyComponent) -> NOIR
            // 'identifier' est le jeton le plus générique. Nous le définissons en NOIR.
            // Il sera écrasé par les jetons plus spécifiques (comme 'keyword').
            { 
                token: 'identifier', 
                foreground: NOIR 
            },

            // 🎯 RÈGLE 4: JSX/HTML (Balises et Attributs) -> NOIR
            // Nous ciblons les jetons de balises et leurs attributs pour les rendre noirs.
            { 
                token: 'tag', 
                foreground: NOIR // Balises comme <div>, <button>
            },
            { 
                token: 'tag.html', 
                foreground: NOIR 
            },
            { 
                token: 'attribute.name', 
                foreground: NOIR // Attributs comme 'className', 'onClick'
            },
            
            // 🎯 RÈGLE 5: Les crochets/parenthèses/virgules peuvent être ajustés, mais le NOIR par défaut est souvent suffisant.
        ],
        colors: {
            // Sidebar (Lignes Noires avec Opacité, comme demandé)
            'editorLineNumber.foreground': '#00000033', // Inactif
            'editorLineNumber.activeForeground': '#000000FF', // Actif
            // Ajustement du fond pour que le texte NOIR soit visible si l'utilisateur change de thème.
            'editor.background': theme === 'light' ? '#FFFFFF' : '#1E1E1E',
            'editor.foreground': NOIR, // S'assurer que le texte par défaut est noir
        },
    });

    // Appliquer le thème personnalisé
    monaco.editor.setTheme('customTheme');

  }, [theme]);

  const toggleTheme = () => {
    // Si l'utilisateur bascule, le thème sera redéfini dans handleEditorDidMount
    setTheme(prev => prev === 'light' ? 'vs-dark' : 'light');
  };
  
  const handleEditorChange: OnChange = useCallback((value) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, []);

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: theme === 'light' ? '#f0f0f0' : '#1e1e1e', color: theme === 'light' ? '#000' : '#fff' }}>
      
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>Monaco Editor Next.js - Thèmes Ultra-Personnalisés</h1>
        <p>Les règles de coloration spécifiques sont appliquées (mots-clés en **Rouge**, identifiants/JSX en **Noir**, chaînes en **Vert**).</p>
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
          theme='customTheme'
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
        <pre>{code}</pre>
      </div>
    </div>
  );
        }
        
