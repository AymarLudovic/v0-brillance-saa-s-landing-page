'use client';

import React, { useEffect, useState } from "react";
import { getHighlighter } from "shiki";

type Props = {
  code: string;
  lang?: string;
};

export default function ChatGPTCanvasCodeWithLines({
  code,
  lang = "typescript",
}: Props) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    getHighlighter({
      theme: "github-dark",
      langs: ["javascript", "typescript", "tsx", "css", "html"],
    }).then((highlighter) => {
      const highlighted = highlighter.codeToHtml(code, { lang });
      // Extraire le contenu de chaque ligne de <span> généré par Shiki
      const container = document.createElement("div");
      container.innerHTML = highlighted;
      const codeLines = Array.from(container.querySelectorAll("pre code span"))
        .map((span) => span.outerHTML);
      setLines(codeLines);
    });
  }, [code, lang]);

  return (
    <div className="rounded-xl border border-gray-800 bg-[#1e1e1e] shadow-md overflow-hidden">
      <div className="flex justify-between items-center bg-[#2d2d2d] px-3 py-2 text-xs text-gray-400 font-mono">
        <span>{lang}</span>
        <button
          className="text-gray-400 hover:text-white transition"
          onClick={() => navigator.clipboard.writeText(code)}
        >
          Copier
        </button>
      </div>
      <div className="flex font-mono text-sm overflow-x-auto">
        {/* Numéros de ligne */}
        <div className="bg-[#2d2d2d] text-gray-500 text-right pr-3 select-none">
          {lines.map((_, i) => (
            <div key={i} className="px-2">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Contenu du code */}
        <pre className="p-4">
          <code>
            {lines.map((line, i) => (
              <div
                key={i}
                dangerouslySetInnerHTML={{ __html: line }}
              />
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

