import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

const ok  = (id: unknown, result: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result });

const err = (id: unknown, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

const text = (str: string) => ({ content: [{ type: "text", text: str }] });

// ── Tools definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "count_characters",
    description: "Counts total characters, without spaces, and space count.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to analyze" },
      },
      required: ["text"],
    },
  },
  {
    name: "count_words",
    description: "Counts the number of words in a text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to count words in" },
      },
      required: ["text"],
    },
  },
  {
    name: "character_frequency",
    description: "Returns a sorted frequency map of each character (case-insensitive).",
    inputSchema: {
      type: "object",
      properties: {
        text:         { type: "string",  description: "Text to analyze" },
        ignoreSpaces: { type: "boolean", description: "Ignore spaces (default true)" },
      },
      required: ["text"],
    },
  },
  {
    name: "word_frequency",
    description: "Returns the top N most frequent words.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to analyze" },
        topN: { type: "number", description: "How many top words to return (default 10)" },
      },
      required: ["text"],
    },
  },
  {
    name: "detect_language",
    description: "Guesses the language of a text using common stop words.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to detect language for" },
      },
      required: ["text"],
    },
  },
  {
    name: "reverse_text",
    description: "Reverses text character by character or word by word.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to reverse" },
        mode: { type: "string", description: "characters or words", enum: ["characters", "words"] },
      },
      required: ["text"],
    },
  },
  {
    name: "text_stats",
    description: "Full analysis: chars, words, sentences, paragraphs, reading time.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to fully analyze" },
      },
      required: ["text"],
    },
  },
  {
    name: "convert_case",
    description: "Converts text to upper, lower, title, camelCase, snake_case, kebab-case, or sentence case.",
    inputSchema: {
      type: "object",
      properties: {
        text:       { type: "string", description: "Text to convert" },
        targetCase: {
          type: "string",
          description: "Target case format",
          enum: ["upper", "lower", "title", "camel", "snake", "kebab", "sentence"],
        },
      },
      required: ["text", "targetCase"],
    },
  },
  {
    name: "check_palindrome",
    description: "Checks if a word or phrase is a palindrome.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to check" },
      },
      required: ["text"],
    },
  },
  {
    name: "extract_emails_and_urls",
    description: "Extracts all email addresses and URLs found in the text.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to scan" },
      },
      required: ["text"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────

function callTool(name: string, args: Record<string, unknown>) {
  const t = String(args.text ?? "");

  switch (name) {

    case "count_characters":
      return text(JSON.stringify({
        total:        t.length,
        withoutSpaces: t.replace(/\s/g, "").length,
        spaces:       t.length - t.replace(/\s/g, "").length,
      }));

    case "count_words":
      return text(JSON.stringify({
        wordCount: t.trim().split(/\s+/).filter(Boolean).length,
      }));

    case "character_frequency": {
      const ignore = args.ignoreSpaces !== false;
      const src = ignore ? t.replace(/\s/g, "") : t;
      const freq: Record<string, number> = {};
      for (const c of src.toLowerCase()) freq[c] = (freq[c] ?? 0) + 1;
      const sorted = Object.fromEntries(
        Object.entries(freq).sort((a, b) => b[1] - a[1])
      );
      return text(JSON.stringify(sorted));
    }

    case "word_frequency": {
      const topN = Number(args.topN ?? 10);
      const words = t.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).filter(Boolean);
      const freq: Record<string, number> = {};
      for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
      const top = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word, count]) => ({ word, count }));
      return text(JSON.stringify(top));
    }

    case "detect_language": {
      const lower = t.toLowerCase();
      const stops: Record<string, string[]> = {
        French:     ["le","la","les","de","du","est","une","et","en","que","il","je","tu","nous","vous"],
        English:    ["the","is","are","and","of","to","in","it","that","a","you","he","she","we","they"],
        Spanish:    ["el","la","los","de","es","en","que","una","con","por","se","un","su","al","del"],
        German:     ["der","die","das","ist","und","ein","eine","von","mit","zu","im","ich","sie","wir"],
        Portuguese: ["o","a","os","de","em","que","um","uma","com","para","ao","na","no","por","se"],
      };
      const ws = lower.split(/\s+/);
      const scores = Object.fromEntries(
        Object.entries(stops).map(([lang, sw]) => [lang, ws.filter(w => sw.includes(w)).length])
      );
      const [lang, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
      return text(JSON.stringify({
        detectedLanguage: lang,
        confidence: score > 2 ? "medium" : score > 0 ? "low" : "unknown",
        scores,
      }));
    }

    case "reverse_text": {
      const mode = String(args.mode ?? "characters");
      return text(
        mode === "words"
          ? t.split(/\s+/).reverse().join(" ")
          : t.split("").reverse().join("")
      );
    }

    case "text_stats": {
      const words     = t.trim().split(/\s+/).filter(Boolean);
      const sentences = t.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      const paragraphs = t.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
      const unique    = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, ""))).size;
      const avgLen    = words.length > 0
        ? +(words.reduce((s, w) => s + w.replace(/[^a-zA-Z]/g, "").length, 0) / words.length).toFixed(2)
        : 0;
      const readingSec = Math.ceil((words.length / 200) * 60);
      return text(JSON.stringify({
        characters:  { total: t.length, withoutSpaces: t.replace(/\s/g, "").length },
        words:       { total: words.length, unique },
        sentences,
        paragraphs,
        avgWordLength: avgLen,
        readingTime: `~${Math.ceil(readingSec / 60)} min (${readingSec}s)`,
      }));
    }

    case "convert_case": {
      const target = String(args.targetCase ?? "lower");
      const map: Record<string, string> = {
        upper:    t.toUpperCase(),
        lower:    t.toLowerCase(),
        title:    t.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
        camel:    t.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase()),
        snake:    t.replace(/\s+/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(),
        kebab:    t.replace(/\s+/g, "-").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
        sentence: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(),
      };
      return text(map[target] ?? t);
    }

    case "check_palindrome": {
      const clean = t.toLowerCase().replace(/[^a-z0-9]/g, "");
      return text(JSON.stringify({
        isPalindrome: clean === clean.split("").reverse().join(""),
        cleanedInput: clean,
      }));
    }

    case "extract_emails_and_urls": {
      const emails = t.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
      const urls   = t.match(/https?:\/\/[^\s/$.?#].[^\s]*/g) ?? [];
      return text(JSON.stringify({ emails, urls, totalFound: emails.length + urls.length }));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };

  try {
    body = await req.json();
  } catch {
    return err(0, -32700, "Parse error: invalid JSON");
  }

  const { id, method, params = {} } = body;

  switch (method) {

    case "initialize":
      return ok(id, {
        protocolVersion: "2024-11-05",
        capabilities:    { tools: { listChanged: false } },
        serverInfo:      { name: "text-tools", version: "1.0.0" },
      });

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok(id, callTool(name, args));
      } catch (e: unknown) {
        return err(id, -32000, e instanceof Error ? e.message : String(e));
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
                                            }
      
