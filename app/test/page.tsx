"use client";

import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { githubLight } from "@uiw/codemirror-theme-github";

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
        theme={githubLight}  // ✅ thème GitHub officiel
        extensions={[
          javascript({ jsx: true, typescript: true }),
        ]}
        onChange={(value) => setCode(value)}
        style={{ height: "100%", fontFamily: "Mozilla Headline, monospace" }}
      />
    </div>
  );
}
