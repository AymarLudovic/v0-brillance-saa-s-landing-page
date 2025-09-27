"use client";

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 🎨 Thème personnalisé façon GitHub
const githubDiffTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#ffffff",
      color: "#24292e",
      fontFamily: "Mozilla Headline, SFMono-Regular, Menlo, monospace",
      fontSize: "14px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "#24292e",
    },
    ".cm-gutters": {
      backgroundColor: "#fafafa", // 🔹 Fond des numéros de ligne
      color: "#6e7781",
      border: "none",
      padding: "0 12px", // 🔹 padding horizontal
      minWidth: "60px",  // 🔹 largeur minimum de la zone
    },
    ".cm-line": {
      padding: "0 10px",
    },
    // ✅ Ajout (fond vert)
    ".cm-line.cm-diff-add": {
      backgroundColor: "#e6ffed",
    },
    // ❌ Suppression (fond rouge)
    ".cm-line.cm-diff-del": {
      backgroundColor: "#ffeef0",
    },
  },
  { dark: false }
);

// 🎨 Coloration syntaxique améliorée
const githubHighlightStyle = HighlightStyle.define([
  // Mots-clés (function, import, export, return…)
  { tag: t.keyword, color: "#d73a49", fontWeight: "bold" },

  // Variables et propriétés
  { tag: [t.name, t.propertyName], color: "#6f42c1" },

  // Fonctions
  { tag: [t.function(t.variableName)], color: "#005cc5", fontWeight: "bold" },

  // Chaînes de caractères
  { tag: [t.string, t.regexp], color: "#032f62" },

  // Nombres, booléens
  { tag: [t.number, t.bool], color: "#005cc5" },

  // Commentaires
  { tag: [t.comment], color: "#6a737d", fontStyle: "italic" },

  // Mots spéciaux type `this`, `super`
  { tag: [t.self, t.null], color: "#e36209", fontWeight: "bold" },

  // Types (TS/Flow)
  { tag: [t.typeName, t.className], color: "#22863a", fontWeight: "bold" },
]);

export default function TestPage() {
  const [code, setCode] = useState<string>(
    `import React from "react";

export function hello(name: string) {
  if (!name) {
    return "Hello World";
  }
  return "Hello " + name;
}`
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <CodeMirror
        value={code}
        height="100%"
        theme={githubDiffTheme}
        extensions={[
          javascript({ jsx: true, typescript: true }),
          syntaxHighlighting(githubHighlightStyle),
        ]}
        onChange={(value) => setCode(value)}
        style={{ height: "100%", fontFamily: "Mozilla Headline" }}
      />
    </div>
  );
   }
    
