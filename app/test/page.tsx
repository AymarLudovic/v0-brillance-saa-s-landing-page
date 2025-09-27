"use client";

import React from "react";

type Props = {
  code?: string;
  lang?: string;
};

export default function ChatGPTCanvasSimple({ code = "", lang = "text" }: Props) {
  const lines = code.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      console.error("Impossible de copier le code");
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-[#1e1e1e] shadow-md overflow-hidden">
      {/* Barre du haut */}
      <div className="flex justify-between items-center bg-[#2d2d2d] px-3 py-2 text-xs text-gray-400 font-mono">
        <span>{lang}</span>
        <button
          className="text-gray-400 hover:text-white transition"
          onClick={handleCopy}
        >
          Copier
        </button>
      </div>

      {/* Zone de code */}
      <div className="flex font-mono text-sm overflow-x-auto">
        {/* Numéros de ligne */}
        <div className="bg-[#2d2d2d] text-gray-500 text-right pr-3 select-none leading-6">
          {lines.map((_, i) => (
            <div key={i} className="px-2">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Contenu du code */}
        <pre className="p-4 leading-6">
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
