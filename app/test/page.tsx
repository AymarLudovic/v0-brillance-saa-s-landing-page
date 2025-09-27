"use client";

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 🎨 Thème personnalisé façon GitHub/Xcode
const githubDiffTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#ffffff",
      color: "#24292e",
      fontFamily: "Mozilla Headline, SFMono-Regular, Menlo, monospace",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "#24292e",
    },
    ".cm-gutters": {
      backgroundColor: "#f6f8fa",
      color: "#6e7781",
      border: "none",
    },
    ".cm-line": {
      padding: "0 6px",
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

// 🎨 Coloration syntaxique style GitHub
const githubHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#d73a49", fontWeight: "bold" },
  { tag: [t.name, t.deleted, t.character, t.propertyName], color: "#6f42c1" },
  { tag: [t.function(t.variableName)], color: "#005cc5" },
  { tag: [t.string, t.regexp], color: "#032f62" },
  { tag: [t.number, t.bool], color: "#005cc5" },
  { tag: [t.comment], color: "#6a737d", fontStyle: "italic" },
]);

export default function TestPage() {
  const [code, setCode] = useState<string>(
    `// Exemple : ajout et suppression
function hello(name: string) {
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
