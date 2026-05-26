"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight, Copy, Check, X } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

type SkillCategory = "vibe-coder" | "utils"

type Skill = {
  id: string
  label: string
  icon: string
  description: string
  category: SkillCategory
  inputLabel: string
  placeholder: string
  execute: (input: string) => string
}

// ── Skill executors (pure JS — no AI, no network) ─────────────────────────────

function genGitignore(stack: string): string {
  const s = stack.toLowerCase()
  const rules: Record<string, string[]> = {
    node:   ["node_modules/", "dist/", "build/", ".env", ".env.local", "*.log", "npm-debug.log*", ".npm"],
    python: ["__pycache__/", "*.pyc", "*.pyo", ".env", "venv/", ".venv/", "*.egg-info/", "dist/", ".pytest_cache/"],
    next:   ["node_modules/", ".next/", "out/", ".env", ".env*.local", "*.log"],
    react:  ["node_modules/", "build/", "dist/", ".env", ".env.local", "*.log"],
    vite:   ["node_modules/", "dist/", ".env", ".env*.local", "*.log"],
    rust:   ["target/", "Cargo.lock", "*.rs.bk"],
    go:     ["*.exe", "*.exe~", "*.dll", "*.so", "*.dylib", "vendor/"],
    java:   ["*.class", "*.jar", "*.war", "target/", ".gradle/", "build/"],
    swift:  [".build/", "*.xcworkspace", "*.xcuserdata", "DerivedData/"],
    docker: [".docker/", "*.env"],
    mac:    [".DS_Store", "*.DS_Store", ".AppleDouble", ".LSOverride"],
    linux:  ["*~", ".fuse_hidden*", ".Trash-*"],
    win:    ["Thumbs.db", "ehthumbs.db", "Desktop.ini", "$RECYCLE.BIN/"],
    vscode: [".vscode/*", "!.vscode/settings.json", "!.vscode/tasks.json", "!.vscode/extensions.json"],
    idea:   [".idea/", "*.iml", "*.iws"],
  }
  const lines = new Set<string>()
  // OS defaults
  rules.mac.forEach(r => lines.add(r))
  rules.linux.forEach(r => lines.add(r))
  rules.win.forEach(r => lines.add(r))
  // Match stack keywords
  Object.entries(rules).forEach(([key, vals]) => {
    if (["mac","linux","win"].includes(key)) return
    if (s.includes(key)) vals.forEach(r => lines.add(r))
  })
  // Default to node if nothing matched
  if (lines.size === 3) rules.node.forEach(r => lines.add(r))
  return "# Generated .gitignore\n\n" + [...lines].join("\n")
}

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw.trim()), null, 2)
  } catch (e: any) {
    return `// Error: ${e.message}\n\n${raw}`
  }
}

function base64Codec(input: string): string {
  const s = input.trim()
  // Try decode first if it looks like base64
  const b64re = /^[A-Za-z0-9+/]*={0,2}$/
  if (b64re.test(s.replace(/\s/g, "")) && s.length % 4 === 0 && s.length > 0) {
    try {
      const decoded = atob(s.replace(/\s/g, ""))
      return `// Decoded (base64 → text):\n${decoded}\n\n// Re-encoded:\n${btoa(decoded)}`
    } catch {}
  }
  const encoded = btoa(unescape(encodeURIComponent(s)))
  return `// Encoded (text → base64):\n${encoded}\n\n// Decoded back:\n${s}`
}

function decodeJWT(token: string): string {
  const t = token.trim().replace(/^Bearer\s+/i, "")
  const parts = t.split(".")
  if (parts.length !== 3) return "// Not a valid JWT (expected 3 parts separated by '.')"
  const decode = (p: string) => {
    try {
      return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")))
    } catch { return null }
  }
  const header  = decode(parts[0])
  const payload = decode(parts[1])
  if (!header || !payload) return "// Could not decode — invalid base64 in JWT"
  const exp = payload.exp ? new Date(payload.exp * 1000).toUTCString() : null
  const iat = payload.iat ? new Date(payload.iat * 1000).toUTCString() : null
  return `// ── Header ──────────────────────\n${JSON.stringify(header, null, 2)}\n\n// ── Payload ─────────────────────\n${JSON.stringify(payload, null, 2)}${exp ? `\n\n// Expires : ${exp}` : ""}${iat ? `\n// Issued  : ${iat}` : ""}\n\n// ── Signature ───────────────────\n${parts[2]}`
}

function convertColor(input: string): string {
  const s = input.trim().toLowerCase()
  // HEX → RGB + HSL
  const hexMatch = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hexMatch) {
    let h = hexMatch[1]
    if (h.length === 3) h = h.split("").map(c => c + c).join("")
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const { hue, sat, lig } = rgbToHsl(r, g, b)
    return `HEX  → #${h.toUpperCase()}\nRGB  → rgb(${r}, ${g}, ${b})\nHSL  → hsl(${hue}, ${sat}%, ${lig}%)\nRGBA → rgba(${r}, ${g}, ${b}, 1)\nTailwind-like: [#${h.toUpperCase()}]`
  }
  // RGB → HEX + HSL
  const rgbMatch = s.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    const r = +rgbMatch[1], g = +rgbMatch[2], b = +rgbMatch[3]
    const hex = [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()
    const { hue, sat, lig } = rgbToHsl(r, g, b)
    return `RGB  → rgb(${r}, ${g}, ${b})\nHEX  → #${hex}\nHSL  → hsl(${hue}, ${sat}%, ${lig}%)\nTailwind-like: [#${hex}]`
  }
  return "// Enter a HEX (#ff6b35) or RGB (rgb(255, 107, 53)) value"
}

function rgbToHsl(r: number, g: number, b: number) {
  const nr = r / 255, ng = g / 255, nb = b / 255
  const max = Math.max(nr, ng, nb), min = Math.min(nr, ng, nb)
  let hue = 0, sat = 0
  const lig = Math.round((max + min) / 2 * 100)
  if (max !== min) {
    const d = max - min
    sat = Math.round((lig > 50 ? d / (2 - max - min) : d / (max + min)) * 100)
    switch (max) {
      case nr: hue = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6; break
      case ng: hue = ((nb - nr) / d + 2) / 6; break
      case nb: hue = ((nr - ng) / d + 4) / 6; break
    }
    hue = Math.round(hue * 360)
  }
  return { hue, sat, lig }
}

function genUUID(n: string): string {
  const count = Math.min(Math.max(parseInt(n) || 1, 1), 20)
  const uuids = Array.from({ length: count }, () => crypto.randomUUID())
  return `// ${count} UUID${count > 1 ? "s" : ""} (v4)\n\n` + uuids.join("\n")
}

function convertTimestamp(input: string): string {
  const s = input.trim()
  // If it's a number, treat as unix
  if (/^\d+$/.test(s)) {
    const ts = parseInt(s)
    const ms = ts > 1e10 ? ts : ts * 1000
    const d = new Date(ms)
    return `Unix  → ${ts}\nUTC   → ${d.toUTCString()}\nISO   → ${d.toISOString()}\nLocal → ${d.toLocaleString()}\nDate  → ${d.toDateString()}`
  }
  // Try to parse as date string
  const d = new Date(s || Date.now())
  if (isNaN(d.getTime())) return `// Could not parse: "${s}"\n// Try: 1716900000  or  2025-05-26T12:00:00Z`
  return `Unix  → ${Math.floor(d.getTime() / 1000)}\nUnix ms → ${d.getTime()}\nUTC   → ${d.toUTCString()}\nISO   → ${d.toISOString()}\nLocal → ${d.toLocaleString()}`
}

function encodeURL(input: string): string {
  const s = input.trim()
  if (!s) return "// Paste a URL or a string to encode/decode"
  try {
    const decoded = decodeURIComponent(s)
    if (decoded !== s) {
      return `// Decoded:\n${decoded}\n\n// Re-encoded:\n${encodeURIComponent(decoded)}`
    }
  } catch {}
  return `// Encoded:\n${encodeURIComponent(s)}\n\n// Full URL safe:\n${s.replace(/[^a-zA-Z0-9\-_.~:/?#[\]@!$&'()*+,;=%]/g, c => encodeURIComponent(c))}`
}

function countText(input: string): string {
  if (!input.trim()) return "// Paste text to analyse"
  const chars = input.length
  const words = input.trim() ? input.trim().split(/\s+/).length : 0
  const lines = input.split("\n").length
  const sentences = (input.match(/[.!?]+/g) || []).length
  const paragraphs = input.split(/\n\n+/).filter(p => p.trim()).length
  const avgWord = words ? (chars / words).toFixed(1) : "0"
  const readMin = Math.ceil(words / 200)
  return `Characters  → ${chars.toLocaleString()}\nWords       → ${words.toLocaleString()}\nLines       → ${lines.toLocaleString()}\nSentences   → ${sentences.toLocaleString()}\nParagraphs  → ${paragraphs.toLocaleString()}\n\nAvg word length → ${avgWord} chars\nReading time    → ~${readMin} min (200 wpm)`
}

// ── Skills registry ───────────────────────────────────────────────────────────

const SKILLS: Skill[] = [
  {
    id: "gitignore",   icon: "🚫", label: ".gitignore",      category: "vibe-coder",
    description: "Generate a .gitignore for any stack",
    inputLabel: "Stack", placeholder: "next, node, python, docker, vscode…",
    execute: genGitignore,
  },
  {
    id: "json",        icon: "{ }", label: "Format JSON",    category: "vibe-coder",
    description: "Validate and pretty-print any JSON",
    inputLabel: "JSON", placeholder: '{"key":"value","list":[1,2,3]}',
    execute: formatJSON,
  },
  {
    id: "base64",      icon: "64", label: "Base64",          category: "vibe-coder",
    description: "Encode text to base64 or decode a base64 string",
    inputLabel: "Text or base64", placeholder: "Hello, world!  or  SGVsbG8sIHdvcmxkIQ==",
    execute: base64Codec,
  },
  {
    id: "jwt",         icon: "🔑", label: "JWT Decode",      category: "vibe-coder",
    description: "Inspect any JWT token — header, payload & expiry",
    inputLabel: "JWT token", placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
    execute: decodeJWT,
  },
  {
    id: "color",       icon: "🎨", label: "Color Convert",   category: "vibe-coder",
    description: "Convert HEX ↔ RGB ↔ HSL in one shot",
    inputLabel: "Color", placeholder: "#ff6b35  or  rgb(255, 107, 53)",
    execute: convertColor,
  },
  {
    id: "uuid",        icon: "⚡", label: "UUID",            category: "vibe-coder",
    description: "Generate one or more UUID v4s instantly",
    inputLabel: "How many?", placeholder: "1  (max 20)",
    execute: genUUID,
  },
  {
    id: "timestamp",   icon: "🕐", label: "Timestamp",       category: "vibe-coder",
    description: "Convert unix timestamps ↔ human dates",
    inputLabel: "Timestamp or date", placeholder: "1716900000  or  2025-05-28T12:00:00Z",
    execute: convertTimestamp,
  },
  {
    id: "url",         icon: "🔗", label: "URL Encode",      category: "vibe-coder",
    description: "Encode or decode URL components",
    inputLabel: "URL or string", placeholder: "hello world / my path?q=test&lang=fr",
    execute: encodeURL,
  },
  {
    id: "wordcount",   icon: "📊", label: "Word Count",      category: "utils",
    description: "Count chars, words, lines, sentences & reading time",
    inputLabel: "Text", placeholder: "Paste your text here…",
    execute: countText,
  },
]

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  "vibe-coder": "Vibe Coder",
  "utils":       "Utils",
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [input, setInput]             = useState("")
  const [skillSearch, setSkillSearch] = useState("")
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [result, setResult]           = useState<string | null>(null)
  const [copied, setCopied]           = useState(false)

  const inputRef     = useRef<HTMLInputElement>(null)
  const dropdownRef  = useRef<HTMLDivElement>(null)
  const skillInputRef = useRef<HTMLTextAreaElement>(null)

  // Filter skills
  const filtered = SKILLS.filter(s =>
    !skillSearch ||
    s.label.toLowerCase().includes(skillSearch.toLowerCase()) ||
    s.description.toLowerCase().includes(skillSearch.toLowerCase()) ||
    s.category.includes(skillSearch.toLowerCase())
  )

  const grouped = (["vibe-coder", "utils"] as SkillCategory[]).map(cat => ({
    cat,
    skills: filtered.filter(s => s.category === cat),
  })).filter(g => g.skills.length > 0)

  // Handle main input
  const handleMainInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val === "/" || (val.endsWith("/") && !activeSkill)) {
      setSkillSearch("")
      setShowDropdown(true)
      setInput("")
    } else if (showDropdown) {
      setSkillSearch(val)
      setInput(val)
    } else {
      setInput(val)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setShowDropdown(false); setSkillSearch("") }
    if (e.key === "/" && !activeSkill && input === "") {
      e.preventDefault()
      setSkillSearch(""); setShowDropdown(true)
    }
  }

  const selectSkill = (skill: Skill) => {
    setActiveSkill(skill)
    setShowDropdown(false)
    setSkillSearch("")
    setInput("")
    setResult(null)
    setTimeout(() => skillInputRef.current?.focus(), 50)
  }

  const clearSkill = () => {
    setActiveSkill(null)
    setResult(null)
    setInput("")
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const runSkill = () => {
    if (!activeSkill || !input.trim()) return
    setResult(activeSkill.execute(input))
  }

  const handleSkillKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runSkill() }
  }

  const copyResult = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div className="min-h-screen bg-white flex flex-col items-center px-4 pt-24 pb-16">

      {/* ── Header ── */}
      <div className="mb-12 text-center">
        <p className="text-[11px] tracking-[0.2em] uppercase text-gray-400 mb-3 font-medium">Skills</p>
        <h1 className="text-[2rem] font-semibold text-gray-900 tracking-tight leading-none">
          What do you want to build?
        </h1>
        <p className="mt-3 text-sm text-gray-400">
          Type <kbd className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-mono">/</kbd> to open a skill
        </p>
      </div>

      {/* ── Input zone ── */}
      <div className="w-full max-w-2xl relative" ref={dropdownRef}>

        {/* Pill input (Image 1 style) */}
        <div className={`flex items-center gap-2 bg-[#f2f2f2] rounded-full px-5 h-14 transition-shadow ${showDropdown ? "ring-2 ring-black/10" : ""}`}>

          {/* Left: main input */}
          <input
            ref={inputRef}
            value={showDropdown ? skillSearch : input}
            onChange={handleMainInput}
            onKeyDown={handleKeyDown}
            placeholder={activeSkill ? activeSkill.placeholder : "Type / to open a skill…"}
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none"
            autoComplete="off"
          />

          {/* Right: skill pill (Image 1 right side) */}
          {activeSkill ? (
            <div className="flex items-center gap-1 bg-white rounded-full px-3 h-8 shadow-sm border border-gray-200 flex-shrink-0">
              <span className="text-sm font-semibold text-gray-800">{activeSkill.label}</span>
              <button onClick={clearSkill} className="ml-1 text-gray-400 hover:text-gray-700 transition-colors">
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowDropdown(true); setSkillSearch(""); inputRef.current?.focus() }}
              className="flex items-center gap-1 bg-white rounded-full px-3 h-8 shadow-sm border border-gray-200 flex-shrink-0 hover:border-gray-300 transition-colors"
            >
              <span className="text-sm font-medium text-gray-500">Skill</span>
              <ChevronLeft size={12} className="text-gray-400" />
              <ChevronRight size={12} className="text-gray-400" />
            </button>
          )}
        </div>

        {/* ── Dropdown (Image 2 style — white) ── */}
        {showDropdown && (
          <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50">
            <div className="p-2 max-h-[420px] overflow-y-auto">
              {grouped.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No skill found for "{skillSearch}"</p>
              ) : grouped.map(({ cat, skills }) => (
                <div key={cat}>
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 px-3 pt-3 pb-1">
                    {CATEGORY_LABELS[cat]}
                  </p>
                  {skills.map(skill => (
                    <button
                      key={skill.id}
                      onClick={() => selectSkill(skill)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                    >
                      {/* Icon — same pattern as Image 2 colored app icons */}
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-lg group-hover:bg-gray-200 transition-colors font-mono">
                        {skill.icon.length <= 2 && !skill.icon.match(/\p{Emoji}/u)
                          ? <span className="text-[11px] font-bold text-gray-600">{skill.icon}</span>
                          : <span>{skill.icon}</span>
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{skill.label}</p>
                        <p className="text-xs text-gray-500 truncate">{skill.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Active skill input + run ── */}
      {activeSkill && (
        <div className="w-full max-w-2xl mt-4 space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
              <span className="text-xs font-medium text-gray-500">{activeSkill.inputLabel}</span>
              <span className="text-[10px] text-gray-400">⌘ + Enter to run</span>
            </div>
            <textarea
              ref={skillInputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setResult(null) }}
              onKeyDown={handleSkillKey}
              placeholder={activeSkill.placeholder}
              rows={4}
              className="w-full px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 outline-none resize-none font-mono"
            />
          </div>

          <button
            onClick={runSkill}
            disabled={!input.trim()}
            className="w-full h-11 rounded-full bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Run {activeSkill.label}
          </button>
        </div>
      )}

      {/* ── Result ── */}
      {result !== null && (
        <div className="w-full max-w-2xl mt-3 rounded-2xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
            <span className="text-xs font-medium text-gray-500">Output</span>
            <button
              onClick={copyResult}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-black transition-colors"
            >
              {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="px-4 py-4 text-sm text-gray-800 font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed bg-white">
            {result}
          </pre>
        </div>
      )}

      {/* ── Empty state — skill suggestions ── */}
      {!activeSkill && !showDropdown && (
        <div className="w-full max-w-2xl mt-10">
          <p className="text-xs text-gray-400 mb-4 text-center tracking-wide uppercase font-medium">Quick pick</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {SKILLS.slice(0, 8).map(skill => (
              <button
                key={skill.id}
                onClick={() => selectSkill(skill)}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all text-center group"
              >
                <span className="text-2xl">{skill.icon.length <= 2 && !skill.icon.match(/\p{Emoji}/u) ? "⚙️" : skill.icon}</span>
                <span className="text-xs font-medium text-gray-700 group-hover:text-gray-900 transition-colors leading-tight">{skill.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
