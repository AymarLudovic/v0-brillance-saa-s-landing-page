'use client';

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

// Assurez-vous d'avoir installé: 
// npm install @uiw/react-codemirror @codemirror/lang-javascript

/**
 * Page Next.js Client Component intégrant CodeMirror.
 * Utilise la syntaxe 'export default function' comme demandé.
 */
export default function CodeMirrorEditorPage() {
  
  // Le code initial (ici du TypeScript)
  const initialCode = `// Page Next.js Client Component avec Thème Eclipse ☀️
// Fonction exportée par défaut comme requis par la configuration.

import { useState } from 'react';

type User = {
  id: number;
  name: string;
};

// Hook personnalisé pour simuler le chargement de données
function useUser(id: number): User {
  const [user, setUser] = useState({ id, name: "Loading..." });
  
  // Dans un vrai scénario, on ferait un useEffect pour fetcher les données.
  setTimeout(() => {
    setUser({ id, name: "Alexandre Dumas" });
  }, 1000);

  return user;
}

// Le composant principal est exporté directement.
function MyEditorComponent() {
  const user = useUser(1);
  return (
    <div>
      <p>Utilisateur: {user.name}</p>
    </div>
  );
}
`;

  const [code, setCode] = useState<string>(initialCode);

  // Fonction de rappel pour mettre à jour l'état du code
  const onChange = useCallback((value: string) => {
    // console.log('Nouveau code:', value);
    setCode(value);
  }, []);

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: '#f0f0f0' }}>
      <h1>CodeMirror Next.js (TypeScript) avec Thème Eclipse</h1>
      
      {/* Composant CodeMirror */}
      <CodeMirror
        value={code}
        height="500px"
        // 🎯 Application du thème Eclipse
        theme="eclipse" 
        extensions={[javascript({ jsx: true, typescript: true })]}
        onChange={onChange}
        // Configuration de base CodeMirror 6
        basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: true,
            highlightActiveLineGutter: true,
        }}
        style={{ border: '1px solid #ccc', borderRadius: '4px' }}
      />
      
      <div style={{ marginTop: '20px' }}>
        <h2>Code Actuel:</h2>
        <pre style={{ 
          backgroundColor: '#fff', 
          padding: '10px', 
          borderRadius: '4px', 
          border: '1px solid #ddd',
          whiteSpace: 'pre-wrap'
        }}>
          {code}
        </pre>
      </div>
    </div>
  );
}
