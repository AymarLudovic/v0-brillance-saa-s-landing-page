"use client";

import React, { useState } from "react";

type File = {
  name: string;
  code: string;
};

const files: File[] = [
  {
    name: "hello.ts",
    code: `function hello(name: string) {
  if (!name) {
    return "Hello World";
  }
  return "Hello " + name;
}

console.log(hello("World"));`,
  },
  {
    name: "mathUtils.ts",
    code: `export function add(a: number, b: number) {
  return a + b;
}

export function multiply(a: number, b: number) {
  return a * b;
}

export function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}`,
  },
  {
    name: "app.ts",
    code: `import { hello } from "./hello";
import { add, multiply } from "./mathUtils";

console.log(hello("User"));
console.log("2 + 3 =", add(2,3));
console.log("4 * 5 =", multiply(4,5));`,
  },
];

export default function ChatGPTCanvasExplorer() {
  const [selectedFile, setSelectedFile] = useState<File>(files[0]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedFile.code);
    } catch {
      console.error("Impossible de copier le code");
    }
  };

  const lines = selectedFile.code.split("\n");

  return (
    <div className="flex gap-4 p-6">
      {/* Sidebar fichiers */}
      <div className="w-40 bg-gray-100 rounded-xl p-2 flex flex-col gap-2">
        {files.map((file) => (
          <button
            key={file.name}
            className={`text-left px-3 py-2 rounded hover:bg-gray-200 transition ${
              selectedFile.name === file.name ? "bg-gray-200 font-bold" : ""
            }`}
            onClick={() => setSelectedFile(file)}
          >
            {file.name}
          </button>
        ))}
      </div>

      {/* Canvas code */}
      <div className="flex-1 rounded-xl border border-gray-300 bg-[#fafafa] shadow-md overflow-hidden">
        {/* Barre du haut */}
        <div className="flex justify-between items-center bg-[#f5f5f5] px-3 py-2 text-xs text-gray-600 font-mono border-b border-gray-300">
          <span>{selectedFile.name}</span>
          <button
            className="text-gray-600 hover:text-black transition"
            onClick={handleCopy}
          >
            Copier
          </button>
        </div>

        {/* Zone de code */}
        <div className="flex font-mono text-sm overflow-x-auto">
          <div style={{ display: "table", width: "100%" }}>
            {lines.map((line, i) => (
              <div key={i} style={{ display: "table-row" }}>
                {/* Numéro de ligne */}
                <span
                  style={{
                    display: "table-cell",
                    width: "2em",
                    paddingRight: "0.5em",
                    textAlign: "right",
                    backgroundColor: "#eee",
                    userSelect: "none",
                  }}
                >
                  {i + 1}
                </span>
                {/* Contenu du code */}
                <span
                  style={{
                    display: "table-cell",
                    whiteSpace: "pre",
                    backgroundColor: "#fafafa",
                    paddingLeft: "0.5em",
                  }}
                >
                  {line || "\u00A0"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
        }
                    
