'use client';

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
// 1. L'extension qui active le support Typescript et JSX
import { javascript } from '@codemirror/lang-javascript';
// 2. L'objet du thème Eclipse (qui contient le style de coloration)
import { eclipse } from '@uiw/codemirror-theme-eclipse'; 
import { Extension } from '@codemirror/state';

/**
 * Page Next.js Client Component intégrant CodeMirror avec le thème Eclipse.
 */
export default function CodeMirrorEditorPage() {
  
  const initialCode = `// ✅ Le "compilateur" TypeScript/JSX est activé via l'extension 'javascript'.
// Le style de coloration est chargé via le thème 'eclipse' dans les extensions.

import React, { useState } from 'react';

// Le mot-clé 'interface' devrait être coloré
interface UserProps {
  name: string; // Le type 'string' devrait être coloré
}

const ProfileComponent = ({ name }: UserProps) => {
  const [count, setCount] = useState(0);

  return (
    // Les balises JSX (div, button) devraient être colorées
    <div className="profile-card"> 
      <h1>Hello, {name}</h1>
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
  const onChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  // Configuration de l'extension pour TypeScript et JSX
  const jsTsxExtension: Extension = javascript({ 
    jsx: true,        // Active le support JSX
    typescript: true  // Active le support TypeScript
  });

  // 🚀 Combinaison des extensions de langage et de thème
  const extensions: Extension[] = [
    jsTsxExtension,
    eclipse // Inclusion du thème comme extension
  ];

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: '#f0f0f0' }}>
      
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>CodeMirror Next.js (TypeScript) avec Thème Eclipse</h1>
      </header>
      
      <CodeMirror
        value={code}
        height="600px"
        // ❌ NE PAS UTILISER la prop 'theme' ici pour éviter les conflits
        // theme={eclipse} 
        
        // 🎯 Passer TOUTES les configurations (langue, thème, highlighting) via 'extensions'
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: true,
            highlightActiveLineGutter: true,
        }}
        style={{ borderRadius: '6px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}
      />
      
      <div style={{ marginTop: '30px' }}>
        <h2>Code Actuel</h2>
        <pre>{code}</pre>
      </div>
    </div>
  );
}
