"use client";

import React from "react";

type Props = {
  code?: string;
  lang?: string;
};

const defaultCode = `function hello(name: string) {
  return "Hello " + name;
}

console.log(hello("World"));`;

export default function ChatGPTCanvasSimple({ code = defaultCode, lang = "typescript" }: Props) {
  const lines = code.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      console.error("Impossible de copier le code");
    }
  };

  return (
    <div className="rounded-xl border border-gray-300 bg-[#fafafa] shadow-md overflow-hidden">
      {/* Barre du haut */}
      <div className="flex justify-between items-center bg-[#f5f5f5] px-3 py-2 text-xs text-gray-600 font-mono border-b border-gray-300">
        <span>{lang}</span>
        <button
          className="text-gray-600 hover:text-black transition"
          onClick={handleCopy}
        >
          Copier
        </button>
      </div>

      {/* Zone de code */}
      <div className="flex font-mono text-sm overflow-x-auto">
        {/* Numéros de ligne */}
        <div className="bg-[#eee] text-gray-500 text-right pr-3 select-none leading-6">
          {lines.map((_, i) => (
            <div key={i} className="px-2">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Contenu du code */}
        <pre className="p-4 leading-6 bg-[#fafafa]">
          <code>
            {lines.map((line, i) => (
              <div key={i}>{line || "\u00A0"}</div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
      }
            
