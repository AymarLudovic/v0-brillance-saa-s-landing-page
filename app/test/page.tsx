'use client';

import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
// 💡 Correction : Importez l'objet de thème directement
import { eclipse } from '@uiw/codemirror-theme-eclipse'; 

/**
 * Page Next.js Client Component intégrant CodeMirror.
 */
export default function CodeMirrorEditorPage() {
  
  const initialCode = `// Maintenant, le thème Eclipse est importé directement comme un objet.
// Cela résout les problèmes de dépendance côté client.

import React from 'react';

function calculateSum(a: number, b: number): number {
  return a + b;
}

console.log(calculateSum(10, 32)); 
`;

  const [code, setCode] = useState<string>(initialCode);

  const onChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  return (
    <div style={{ padding: '20px', minHeight: '100vh', backgroundColor: '#f0f0f0' }}>
      <h1>CodeMirror Next.js (TypeScript) avec Thème Eclipse (Corrigé)</h1>
      
      {/* Composant CodeMirror */}
      <CodeMirror
        value={code}
        height="500px"
        // 🎯 Utilisation de l'OBJET de thème importé (méthode stable CodeMirror 6)
        theme={eclipse} 
        extensions={[javascript({ jsx: true, typescript: true })]}
        onChange={onChange}
        basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            autocompletion: true,
        }}
        style={{ border: '1px solid #ccc', borderRadius: '4px' }}
      />
      
      <div style={{ marginTop: '20px' }}>
        <h2>Code Actuel:</h2>
        <pre>{code}</pre>
      </div>
    </div>
  );
        }
        
