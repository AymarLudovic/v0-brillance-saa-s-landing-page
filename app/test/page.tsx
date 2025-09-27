"use client";

import React from "react";

type Props = {
  code?: string;
  lang?: string;
};

const defaultCode = `function hello(name: string) {
  if (!name) {
    return "Hello World";
  }
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
  );
                }
