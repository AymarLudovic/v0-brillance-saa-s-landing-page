// components/ChatGPTCanvasExplorer.tsx
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
  {
    name: "long_example.ts",
    code: `// Exemple long pour tester le scroll et l'alignement
import { add, factorial } from "./mathUtils";

function heavyComputation(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += i * (i % 7);
  }
  return sum;
}

class Person {
  constructor(public name: string, public age: number) {}

  greet() {
    return "Hello " + this.name;
  }
}

const people: Person[] = [
  new Person("Alice", 30),
  new Person("Bob", 25),
  new Person("Charlie", 35),
];

for (const p of people) {
  console.log(p.greet(), p.age);
}

console.log("factorial(6) =", factorial(6));
console.log("heavyComputation(1000) =", heavyComputation(1000));`,
  },
];

function tokenizeLine(line: string) {
  // RegExp qui capture : strings "..." | keywords | numbers
  const tokenRegex =
    /("(?:(?:\\.)|[^"\\])*")|(\b(?:function|return|if|else|export|import|console|log|const|let|var|class|new|for|of|while|switch|case|break|continue|try|catch|finally|throw)\b)|(\b\d+\b)/g;

  const tokens: { type: "text" | "string" | "keyword" | "number"; text: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tokenRegex.exec(line)) !== null) {
    const idx = m.index;
    if (idx > lastIndex) {
      tokens.push({ type: "text", text: line.slice(lastIndex, idx) });
    }
    if (m[1]) {
      tokens.push({ type: "string", text: m[1] });
    } else if (m[2]) {
      tokens.push({ type: "keyword", text: m[2] });
    } else if (m[3]) {
      tokens.push({ type: "number", text: m[3] });
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ type: "text", text: line.slice(lastIndex) });
  }

  return tokens;
}

export default function ChatGPTCanvasExplorer() {
  const [selectedFile, setSelectedFile] = useState<File>(files[0]);
  const codeRef = useRef<HTMLDivElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);

  // Sync scroll from code container -> line numbers container
  useEffect(() => {
    const codeEl = codeRef.current;
    const lineEl = lineRef.current;
    if (!codeEl || !lineEl) return;

    const onScroll = () => {
      lineEl.scrollTop = codeEl.scrollTop;
    };

    codeEl.addEventListener("scroll", onScroll);
    return () => codeEl.removeEventListener("scroll", onScroll);
  }, [selectedFile]);

  // Reset scroll to top when switching file
  useEffect(() => {
    const codeEl = codeRef.current;
    const lineEl = lineRef.current;
    if (codeEl) codeEl.scrollTop = 0;
    if (lineEl) lineEl.scrollTop = 0;
  }, [selectedFile]);

  const lines = selectedFile.code.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedFile.code);
      // tu peux ajouter un petit toast ici si tu veux
    } catch {
      console.error("Impossible de copier le code");
    }
  };

  return (
    <div className="flex gap-4 p-6">
      {/* Sidebar fichiers */}
      <div className="w-44 bg-gray-100 rounded-xl p-2 flex flex-col gap-2">
        {files.map((file) => (
          <button
            key={file.name}
            className={`text-left px-3 py-2 rounded text-sm hover:bg-gray-200 transition ${
              selectedFile.name === file.name ? "bg-gray-200 font-semibold" : ""
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
            className="text-gray-600 hover:text-black transition text-sm"
            onClick={handleCopy}
          >
            Copier
          </button>
        </div>

        {/* Zone code + numéros */}
        <div className="flex text-sm font-mono" style={{ minHeight: 200 }}>
          {/* Numéros de ligne */}
          <div
            ref={lineRef}
            className="bg-[#eee] text-gray-500 select-none text-right pr-2 overflow-hidden"
            style={{ width: 56 }}
          >
            {lines.map((_, i) => (
              <div key={i} className="px-2 h-[1.5rem] leading-[1.5rem]">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code */}
          <div
            ref={codeRef}
            className="overflow-auto p-4 flex-1"
            // on garde whiteSpace: 'pre' pour préserver indent & espaces
            style={{ whiteSpace: "pre", backgroundColor: "#fafafa" }}
          >
            {lines.map((line, i) => {
              const tokens = tokenizeLine(line);
              return (
                <div key={i} className="h-[1.5rem] leading-[1.5rem]">
                  {/* Le span avec whiteSpace: 'pre' préserve les espaces initiaux */}
                  <span style={{ whiteSpace: "pre" }}>
                    {tokens.map((t, j) => {
                      if (t.type === "keyword") {
                        return (
                          <span key={j} className="text-blue-600 font-semibold">
                            {t.text}
                          </span>
                        );
                      }
                      if (t.type === "string") {
                        return (
                          <span key={j} className="text-green-600">
                            {t.text}
                          </span>
                        );
                      }
                      if (t.type === "number") {
                        return (
                          <span key={j} className="text-purple-600">
                            {t.text}
                          </span>
                        );
                      }
                      // texte brut (espaces inclus)
                      return (
                        <span key={j} className="text-gray-800">
                          {t.text}
                        </span>
                      );
                    })}
                    {/* si la ligne est vide, force un caractère insécable pour garder la hauteur */}
                    {line.length === 0 ? "\u00A0" : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
                   }
    
