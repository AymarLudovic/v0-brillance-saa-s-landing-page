'use client';

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
// 💡 C'est la seule extension essentielle pour la coloration TypeScript/JSX
import { javascript } from '@codemirror/lang-javascript'; 
// Importation du thème spécifique non nécessaire pour cette version de base

/**
 * Page Next.js Client Component intégrant CodeMirror de base.
 * Utilise le thème clair par défaut de CodeMirror.
 */
export default function BasicCodeMirrorPage() {
  
  const initialCode = `// CodeMirror de base - Next.js (TypeScript)
// La coloration syntaxique des imports, types et JSX devrait fonctionner.

import React, { useState } from 'react';

// Le type 'interface' devrait être coloré
interface MyData {
  value: number; 
}

const MyBaseComponent = ({ value }: MyData) => {
  const [count, setCount] = useState(value);

  return (
    // Les balises JSX (div) devraient être colorées
    <div className="wrapper"> 
      <p>Current count: {count}</p>
    </div>
  );
};

export default MyBaseComponent;
`;

  const [code, setCode] = useState<string>(initialCode);

  const onChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  // Définition de l'extension JavaScript/TypeScript/JSX
  const jsTsxExtension = javascript({ 
    jsx: true,        
    typescript: true  
  });

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: '#f0f0f0' }}>
      
      <header style={{ marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        <h1>CodeMirror de Base (Thème Clair par Défaut)</h1>
        <p>Coloration syntaxique garantie via `lang-javascript`.</p>
      </header>
      
      <CodeMirror
        value={code}
        height="600px"
        // 🎯 En retirant la prop 'theme', on utilise le thème de base, 
        // qui fonctionne de manière très fiable pour la coloration.
        
        // 🚀 Seule l'extension de langage est nécessaire pour la coloration
        extensions={[jsTsxExtension]} 
        onChange={onChange}
        // Le basicSetup fournit numérotation des lignes, folding, etc.
        basicSetup={true} 
        style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}
      />
      
      <div style={{ marginTop: '30px' }}>
        <h2>Code Actuel</h2>
        <pre>{code}</pre>
      </div>
    </div>
  );
                      }
        
