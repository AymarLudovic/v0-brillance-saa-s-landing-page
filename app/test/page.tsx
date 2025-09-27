'use client';

import React, { useState, useCallback } from 'react';
import Editor, { OnChange, OnMount } from '@monaco-editor/react';

/**
 * Page Next.js Client Component intégrant Monaco Editor.
 * Utilise le thème clair par défaut ('light') ou le thème sombre ('vs-dark').
 */
export default function MonacoEditorPage() {
  
  // Code TypeScript / JSX de démonstration
  const initialCode = `// ✅ Monaco Editor : Colore parfaitement le TypeScript et le JSX par défaut.

import React, { useState } from 'react';

// Le type 'interface' et les types TypeScript sont nativement reconnus.
interface UserProps {
  id: number;
  name: string; 
}

const ProfileComponent = ({ name, id }: UserProps) => {
  const [count, setCount] = useState(0); // L'importation useState est colorée

  return (
    // Les balises JSX (div, button) sont correctement highlightées
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
  const [theme, setTheme] = useState<'light' | 'vs-dark'>('light'); // Thème clair par défaut

  // Fonction appelée à chaque modification de l'éditeur
  const handleEditorChange: OnChange = useCallback((value, event) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, []);

  // Fonction pour basculer le thème (optionnel)
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
          defaultLanguage="typescript" // Langage par défaut
          value={code}
          theme={theme} // Thème dynamique
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: true },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            // ... autres options Monaco Editor
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
  
