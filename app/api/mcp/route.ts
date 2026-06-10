
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

// ─── Factory : un serveur MCP neuf par requête (stateless) ───────────────────

function buildServer(): McpServer {
  const server = new McpServer({ name: "text-tools", version: "1.0.0" });

  // 1. Compter les caractères
  server.tool(
    "count_characters",
    "Counts total characters, characters without spaces, and space count.",
    { text: z.string().describe("Text to analyze") },
    async ({ text }) => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          total: text.length,
          withoutSpaces: text.replace(/\s/g, "").length,
          spaces: text.length - text.replace(/\s/g, "").length,
        }),
      }],
    })
  );

  // 2. Compter les mots
  server.tool(
    "count_words",
    "Counts the number of words in a text.",
    { text: z.string().describe("Text to count words in") },
    async ({ text }) => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          wordCount: text.trim().split(/\s+/).filter(Boolean).length,
        }),
      }],
    })
  );

  // 3. Fréquence des caractères
  server.tool(
    "character_frequency",
    "Returns a sorted frequency map of each character (case-insensitive).",
    {
      text: z.string().describe("Text to analyze"),
      ignoreSpaces: z.boolean().optional().default(true),
    },
    async ({ text, ignoreSpaces }) => {
      const src = ignoreSpaces ? text.replace(/\s/g, "") : text;
      const freq: Record<string, number> = {};
      for (const c of src.toLowerCase()) freq[c] = (freq[c] ?? 0) + 1;
      const sorted = Object.fromEntries(
        Object.entries(freq).sort((a, b) => b[1] - a[1])
      );
      return { content: [{ type: "text", text: JSON.stringify(sorted) }] };
    }
  );

  // 4. Top N mots les plus fréquents
  server.tool(
    "word_frequency",
    "Returns the top N most frequent words.",
    {
      text: z.string().describe("Text to analyze"),
      topN: z.number().int().min(1).max(100).optional().default(10),
    },
    async ({ text, topN }) => {
      const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).filter(Boolean);
      const freq: Record<string, number> = {};
      for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
      const top = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word, count]) => ({ word, count }));
      return { content: [{ type: "text", text: JSON.stringify(top) }] };
    }
  );

  // 5. Détection de langue (heuristique stop-words)
  server.tool(
    "detect_language",
    "Guesses the language of a text using common stop words (heuristic, not ML).",
    { text: z.string().min(5).describe("Text to detect language for") },
    async ({ text }) => {
      const lower = text.toLowerCase();
      const stops: Record<string, string[]> = {
        French:     ["le","la","les","de","du","est","une","et","en","que","il","je","tu","nous","vous"],
        English:    ["the","is","are","and","of","to","in","it","that","a","you","he","she","we","they"],
        Spanish:    ["el","la","los","de","es","en","que","una","con","por","se","un","su","al","del"],
        German:     ["der","die","das","ist","und","ein","eine","von","mit","zu","im","ich","sie","wir"],
        Portuguese: ["o","a","os","de","em","que","um","uma","com","para","ao","na","no","por","se"],
      };
      const words = lower.split(/\s+/);
      const scores = Object.fromEntries(
        Object.entries(stops).map(([lang, sw]) => [lang, words.filter(w => sw.includes(w)).length])
      );
      const [lang, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            detectedLanguage: lang,
            confidence: score > 2 ? "medium" : score > 0 ? "low" : "unknown",
            scores,
          }),
        }],
      };
    }
  );

  // 6. Inverser le texte
  server.tool(
    "reverse_text",
    "Reverses text character by character, or word by word.",
    {
      text: z.string().describe("Text to reverse"),
      mode: z.enum(["characters", "words"]).optional().default("characters"),
    },
    async ({ text, mode }) => ({
      content: [{
        type: "text",
        text: mode === "words"
          ? text.split(/\s+/).reverse().join(" ")
          : text.split("").reverse().join(""),
      }],
    })
  );

  // 7. Rapport complet
  server.tool(
    "text_stats",
    "Full analysis: chars, words, sentences, paragraphs, unique words, reading time.",
    { text: z.string().min(1).describe("Text to fully analyze") },
    async ({ text }) => {
      const words = text.trim().split(/\s+/).filter(Boolean);
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
      const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, ""))).size;
      const avgWordLen = words.length > 0
        ? +(words.reduce((s, w) => s + w.replace(/[^a-zA-Z]/g, "").length, 0) / words.length).toFixed(2)
        : 0;
      const readingSec = Math.ceil((words.length / 200) * 60);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            characters: { total: text.length, withoutSpaces: text.replace(/\s/g, "").length },
            words: { total: words.length, unique: uniqueWords },
            sentences,
            paragraphs,
            avgWordLength: avgWordLen,
            readingTime: `~${Math.ceil(readingSec / 60)} min (${readingSec}s)`,
          }),
        }],
      };
    }
  );

  // 8. Conversion de casse
  server.tool(
    "convert_case",
    "Converts text to upper, lower, title, camelCase, snake_case, kebab-case, or sentence case.",
    {
      text: z.string().describe("Text to convert"),
      targetCase: z.enum(["upper","lower","title","camel","snake","kebab","sentence"]),
    },
    async ({ text, targetCase }) => {
      const results: Record<string, string> = {
        upper:    text.toUpperCase(),
        lower:    text.toLowerCase(),
        title:    text.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        camel:    text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()),
        snake:    text.replace(/\s+/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
        kebab:    text.replace(/\s+/g, "-").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
        sentence: text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
      };
      return { content: [{ type: "text", text: results[targetCase] }] };
    }
  );

  // 9. Vérifier palindrome
  server.tool(
    "check_palindrome",
    "Checks if a word or phrase is a palindrome (ignores punctuation and spaces).",
    { text: z.string().describe("Text to check") },
    async ({ text }) => {
      const clean = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isPalindrome = clean === clean.split("").reverse().join("");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ isPalindrome, cleanedInput: clean }),
        }],
      };
    }
  );

  // 10. Extraire emails et URLs
  server.tool(
    "extract_emails_and_urls",
    "Extracts all email addresses and URLs found in the text.",
    { text: z.string().describe("Text to scan") },
    async ({ text }) => {
      const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
      const urls   = text.match(/https?:\/\/[^\s/$.?#].[^\s]*/g) ?? [];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ emails, urls, totalFound: emails.length + urls.length }),
        }],
      };
    }
  );

  return server;
}

// ─── Handler Next.js App Router ─────────────────────────────────────────────

async function handle(req: NextRequest): Promise<NextResponse> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — parfait pour Vercel serverless
  });

  await server.connect(transport);

  const res = await transport.handleRequest(req);

  return res as unknown as NextResponse;
}

export const GET  = handle;
export const POST = handle;
export const DELETE = handle;

// Empêche Next.js de mettre en cache les réponses MCP
export const dynamic = "force-dynamic";
