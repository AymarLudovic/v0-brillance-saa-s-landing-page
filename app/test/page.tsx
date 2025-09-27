"use client";

import React, { useState, useRef, useEffect } from "react";

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
  const codeRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedFile.code);
    } catch {
      console.error("Impossible de copier le code");
    }
  };

  // Synchronisation scroll vertical
  useEffect(() => {
    const codeEl = codeRef.current;
    const lineEl = lineRef.current;
    if (!codeEl || !lineEl) return;

    const syncScroll = () => {
      lineEl.scrollTop = codeEl.scrollTop;
    };
    codeEl.addEventListener("scroll", syncScroll);
    return () => codeEl.removeEventListener("scroll", syncScroll);
  }, [selectedFile]);

  const lines = selectedFile.code.split("\n");

  // Simple highlight CSS
  const highlight = (line: string) => {
    return line
      .replace(
        /\b(function|return|if|else|export|import|console|log)\b/g,
        '<span class="text-blue-600 font-semibold">$1</span>'
      )
      .replace(/(".*?")/g, '<span class="text-green-600">$1</span>')
      .replace(/(\d+)/g, '<span class="text-purple-600">$1</span>');
  };

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

        {/* Zone code et numéros */}
        <div className="flex text-sm font-mono">
          {/* Numéros de ligne */}
          <div
            ref={lineRef}
            className="bg-[#eee] text-gray-500 select-none text-right pr-2 leading-6 overflow-hidden"
          >
            {lines.map((_, i) => (
              <div key={i} className="px-2">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code */}
          <div
            ref={codeRef}
            className="overflow-auto p-4 leading-6"
            style={{ whiteSpace: "pre" }}
          >
            {lines.map((line, i) => (
              <div
                key={i}
                dangerouslySetInnerHTML={{ __html: highlight(line) || "\u00A0" }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
               }
            
