"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { ChevronLeft, ChevronRight, Copy, Check, X } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

type SkillCategory = "vibe-coder" | "ops" | "productivity" | "utils"

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

// ── New executors (from OpenClaw use-cases) ──────────────────────────────────

function genCron(input: string): string {
  const s = input.trim().toLowerCase()
  const presets: [string, string, string][] = [
    ["every minute",       "* * * * *",        "Every minute"],
    ["every 5 min",        "*/5 * * * *",      "Every 5 minutes"],
    ["every 15 min",       "*/15 * * * *",     "Every 15 minutes"],
    ["every 30 min",       "*/30 * * * *",     "Every 30 minutes"],
    ["every hour",         "0 * * * *",        "At minute :00 of every hour"],
    ["midnight",           "0 0 * * *",        "Every day at midnight (00:00)"],
    ["noon",               "0 12 * * *",       "Every day at noon (12:00)"],
    ["morning",            "0 8 * * *",        "Every day at 8:00 AM"],
    ["evening",            "0 18 * * *",       "Every day at 6:00 PM"],
    ["daily",              "0 9 * * *",        "Every day at 9:00 AM"],
    ["every day",          "0 9 * * *",        "Every day at 9:00 AM"],
    ["weekday",            "0 9 * * 1-5",      "Mon–Fri at 9:00 AM"],
    ["every monday",       "0 9 * * 1",        "Every Monday at 9:00 AM"],
    ["weekly",             "0 9 * * 1",        "Every Monday at 9:00 AM"],
    ["monthly",            "0 9 1 * *",        "1st of every month at 9:00 AM"],
    ["every sunday",       "0 9 * * 0",        "Every Sunday at 9:00 AM"],
  ]
  // Already a cron? explain it
  const parts = s.trim().split(/\s+/)
  if (parts.length === 5 && parts.every(p => /^[\d\*\/\-,]+$/.test(p))) {
    const [min, hr, dom, mon, dow] = parts
    const minStr = min === "*" ? "every min" : min.startsWith("*/") ? `every ${min.slice(2)} min` : `at :${min.padStart(2,"0")}`
    const hrStr  = hr  === "*" ? "every hour" : `at ${hr.padStart(2,"0")}:00`
    const dayStr = dow === "*" ? "every day" : dow.includes("-") ? `${dow} (range)` : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][+dow] ?? `day ${dow}`
    return `// Explanation\nSchedule: ${minStr}, ${hrStr}, ${dayStr}\n\n// Node.js (node-cron)\ncron.schedule('${parts.join(" ")}', () => {\n  // your job here\n});\n\n// GitHub Actions\non:\n  schedule:\n    - cron: '${parts.join(" ")}'\n\n// Vercel / Railway Cron\n${parts.join(" ")}`
  }
  for (const [key, expr, desc] of presets) {
    if (s.includes(key)) {
      return `// Cron expression\n${expr}\n\n// Meaning: ${desc}\n\n// Node.js (node-cron)\ncron.schedule('${expr}', () => {\n  // your job here\n});\n\n// GitHub Actions\non:\n  schedule:\n    - cron: '${expr}'\n\n// Vercel cron.json\n{\n  "crons": [{ "path": "/api/job", "schedule": "${expr}" }]\n}`
    }
  }
  const timeMatch = s.match(/(\d{1,2})[h:](\d{2})?/)
  if (timeMatch) {
    const h = timeMatch[1], m = timeMatch[2] ?? "00"
    const expr = `${parseInt(m)} ${parseInt(h)} * * *`
    return `// Cron expression\n${expr}\n\n// Meaning: Every day at ${h.padStart(2,"0")}:${m}\n\n// Node.js (node-cron)\ncron.schedule('${expr}', () => {\n  // your job here\n});`
  }
  return `// Common cron patterns\n\n* * * * *       → every minute\n*/5 * * * *     → every 5 minutes\n0 * * * *       → every hour (at :00)\n0 9 * * *       → daily at 9:00 AM\n0 9 * * 1-5     → weekdays at 9:00 AM\n0 9 * * 1       → every Monday at 9:00 AM\n0 0 1 * *       → 1st of every month\n\n// Try: "every 5 min", "daily", "every monday", "8h30", or paste a cron string`
}

function genDockerfile(stack: string): string {
  const s = stack.trim().toLowerCase()
  const files: Record<string, string> = {
    node: `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]`,
    next: `FROM node:20-alpine AS base\n\nFROM base AS deps\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\n\nFROM base AS builder\nWORKDIR /app\nCOPY --from=deps /app/node_modules ./node_modules\nCOPY . .\nRUN npm run build\n\nFROM base AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY --from=builder /app/public ./public\nCOPY --from=builder /app/.next/standalone ./\nCOPY --from=builder /app/.next/static ./.next/static\nEXPOSE 3000\nCMD ["node", "server.js"]`,
    python: `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`,
    fastapi: `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]`,
    go: `FROM golang:1.22-alpine AS builder\nWORKDIR /app\nCOPY go.* ./\nRUN go mod download\nCOPY . .\nRUN go build -o main .\n\nFROM alpine:latest\nWORKDIR /root/\nCOPY --from=builder /app/main .\nEXPOSE 8080\nCMD ["./main"]`,
    rust: `FROM rust:1.77-slim AS builder\nWORKDIR /app\nCOPY Cargo.* ./\nRUN cargo fetch\nCOPY . .\nRUN cargo build --release\n\nFROM debian:bookworm-slim\nCOPY --from=builder /app/target/release/app /usr/local/bin/app\nEXPOSE 8080\nCMD ["app"]`,
    bun: `FROM oven/bun:1 AS base\nWORKDIR /app\nCOPY package.json bun.lockb ./\nRUN bun install --frozen-lockfile\nCOPY . .\nEXPOSE 3000\nCMD ["bun", "run", "start"]`,
  }
  for (const [key, dockerfile] of Object.entries(files)) {
    if (s.includes(key)) return `# Dockerfile – ${key}\n\n${dockerfile}\n\n# .dockerignore (also add this):\nnode_modules\n.next\n.env*\ndist\n*.log`
  }
  return `# Enter a stack: node, next, python, fastapi, go, rust, bun\n\n# Basic template:\nFROM <base-image>\nWORKDIR /app\nCOPY . .\nRUN <install deps>\nEXPOSE <port>\nCMD ["<start command>"]`
}

function genCommit(input: string): string {
  const s = input.trim()
  if (!s) return `// Conventional Commits format:\n<type>(<scope>): <description>\n\n// Types:\nfeat     → new feature\nfix      → bug fix\ndocs     → documentation\nstyle    → formatting\nrefactor → code restructure (no fix/feat)\ntest     → adding tests\nchore    → maintenance\nperf     → performance\nci       → CI/CD changes\nbuild    → build system\nrevert   → reverts a commit\n\n// Examples:\nfeat(auth): add Google OAuth login\nfix(api): handle null response from payment gateway\nchore(deps): bump next from 14.1 to 15.0\ndocs(readme): add deployment instructions`
  const types = ["feat","fix","docs","style","refactor","test","chore","perf","ci","build","revert"]
  const lower = s.toLowerCase()
  let type = "chore"
  if (/add|new|creat|implement|introduc/.test(lower)) type = "feat"
  else if (/fix|bug|resolv|correct|patch|repair/.test(lower)) type = "fix"
  else if (/refactor|rewrit|restructur|clean|reorgani/.test(lower)) type = "refactor"
  else if (/test|spec|coverage/.test(lower)) type = "test"
  else if (/doc|readme|comment|jsdoc/.test(lower)) type = "docs"
  else if (/style|format|lint|prettier/.test(lower)) type = "style"
  else if (/perf|speed|optim|fast|cach/.test(lower)) type = "perf"
  else if (/ci|github action|pipeline|deploy|workflow/.test(lower)) type = "ci"
  else if (/bump|upgrade|depend|packag/.test(lower)) type = "chore"
  // Extract potential scope
  const scopeMatch = s.match(/(?:in|for|on)\s+(\w+)/i)
  const scope = scopeMatch ? `(${scopeMatch[1].toLowerCase()})` : ""
  // Shorten description to <72 chars
  const desc = s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "")
  const short = desc.length > 60 ? desc.slice(0, 57) + "..." : desc
  return `${type}${scope}: ${short}\n\n// Variants:\n${types.slice(0,4).map(t => `${t}${scope}: ${short}`).join("\n")}\n\n// With body:\n${type}${scope}: ${short}\n\nBrief explanation of why this change was made.\nRefs #<issue-number>`
}

function genGHIssue(input: string): string {
  const s = input.trim()
  const isBug = /bug|error|crash|fail|broken|wrong|not work/i.test(s)
  if (isBug || s.toLowerCase().startsWith("bug")) {
    return `## 🐛 Bug Report\n\n### Description\n${s || "Clear, one-line summary of the bug"}\n\n### Steps to Reproduce\n1. Go to '...'\n2. Click on '...'\n3. Scroll down to '...'\n4. See error\n\n### Expected Behavior\nWhat you expected to happen.\n\n### Actual Behavior\nWhat actually happened.\n\n### Environment\n- OS: [e.g. macOS 14, Ubuntu 22.04]\n- Browser/Runtime: [e.g. Chrome 124, Node 20.x]\n- Version: [e.g. v1.2.3]\n\n### Screenshots / Logs\n\`\`\`\npaste logs here\n\`\`\`\n\n### Additional Context\nAnything else relevant.`
  }
  return `## ✨ Feature Request\n\n### Summary\n${s || "One-line summary of the feature"}\n\n### Problem\nDescribe the problem this feature solves.\n\n### Proposed Solution\nDescribe the solution you'd like.\n\n### Alternatives Considered\nAny alternative solutions or features you've considered.\n\n### Acceptance Criteria\n- [ ] Criterion 1\n- [ ] Criterion 2\n- [ ] Criterion 3\n\n### Additional Context\nScreenshots, mockups, or references.`
}

function genPRDesc(input: string): string {
  const s = input.trim() || "your changes"
  return `## Summary\n${s}\n\n## Changes\n- \n- \n- \n\n## Type of Change\n- [ ] 🐛 Bug fix (non-breaking)\n- [ ] ✨ New feature (non-breaking)\n- [ ] 💥 Breaking change\n- [ ] 📝 Documentation\n- [ ] ♻️ Refactor\n\n## Testing\n- [ ] Unit tests pass (\`npm test\`)\n- [ ] Manual testing done\n- [ ] No regressions found\n\n## Screenshots\n<!-- Before / After if UI changes -->\n\n## Checklist\n- [ ] Self-reviewed the code\n- [ ] No console.logs left\n- [ ] Types are correct (no \`any\`)\n- [ ] PR title follows conventional commits\n\nCloses #`
}

function genExcalidraw(input: string): string {
  const s = input.trim() || "Start → Process → End"
  const nodes = s.split(/→|->|,/).map(n => n.trim()).filter(Boolean)
  const elements: any[] = []
  nodes.forEach((label, i) => {
    const x = 80 + i * 200
    elements.push({ type: "rectangle", id: `box${i}`, x, y: 200, width: 140, height: 60, strokeColor: "#1e1e2e", backgroundColor: "#cdd6f4", fillStyle: "solid", roundness: { type: 3 }, text: label })
    if (i < nodes.length - 1) {
      elements.push({ type: "arrow", id: `arr${i}`, x: x + 140, y: 230, width: 60, height: 0, strokeColor: "#1e1e2e", points: [[0,0],[60,0]] })
    }
  })
  return `// Excalidraw JSON — paste at excalidraw.com > Open > Paste\n\n${JSON.stringify({ type: "excalidraw", version: 2, source: "skills", elements, appState: { gridSize: null, viewBackgroundColor: "#ffffff" } }, null, 2)}`
}

function genDeployCheck(stack: string): string {
  const s = stack.trim().toLowerCase()
  const base = [
    "[ ] All tests passing (npm test / pytest / cargo test)",
    "[ ] Environment variables set in target env",
    "[ ] No secrets committed to Git",
    "[ ] Database migrations run (if applicable)",
    "[ ] Health check endpoint returns 200",
    "[ ] Error monitoring configured (Sentry / Datadog)",
    "[ ] Rollback plan ready",
  ]
  const extras: Record<string, string[]> = {
    next:   ["[ ] next build passes with 0 errors","[ ] Image domains whitelisted in next.config","[ ] ISR / revalidation TTLs set correctly"],
    vercel: ["[ ] Preview deployment verified","[ ] Edge config updated","[ ] Analytics enabled"],
    docker: ["[ ] Image tagged with version (not just latest)","[ ] docker-compose.prod.yml reviewed","[ ] Health check in Dockerfile"],
    railway:["[ ] Railway env vars synced","[ ] Custom domain DNS propagated","[ ] Volume mounts correct"],
    aws:    ["[ ] IAM roles least-privilege","[ ] S3 bucket policy reviewed","[ ] CloudFront cache invalidated"],
  }
  const extra: string[] = []
  Object.entries(extras).forEach(([key, vals]) => { if (s.includes(key)) extra.push(...vals) })
  const all = [...base, ...(extra.length ? ["\n// Stack-specific:", ...extra] : [])]
  return `# Deploy Checklist${s ? ` — ${s}` : ""}\n\n${all.join("\n")}\n\n// Post-deploy:\n[ ] Monitor error rate for 15 min\n[ ] Notify team / update status page`
}

function genEnvTemplate(stack: string): string {
  const s = stack.trim().toLowerCase()
  const templates: Record<string, string[]> = {
    next:     ["NEXT_PUBLIC_APP_URL=http://localhost:3000","NEXTAUTH_URL=http://localhost:3000","NEXTAUTH_SECRET=","DATABASE_URL=","NEXT_PUBLIC_ANALYTICS_ID="],
    node:     ["NODE_ENV=development","PORT=3000","DATABASE_URL=","JWT_SECRET=","API_KEY="],
    supabase: ["SUPABASE_URL=","SUPABASE_ANON_KEY=","SUPABASE_SERVICE_ROLE_KEY="],
    firebase: ["FIREBASE_API_KEY=","FIREBASE_AUTH_DOMAIN=","FIREBASE_PROJECT_ID=","FIREBASE_STORAGE_BUCKET=","FIREBASE_MESSAGING_SENDER_ID=","FIREBASE_APP_ID="],
    stripe:   ["STRIPE_SECRET_KEY=sk_test_","STRIPE_PUBLISHABLE_KEY=pk_test_","STRIPE_WEBHOOK_SECRET=whsec_"],
    openai:   ["OPENAI_API_KEY=sk-","OPENAI_MODEL=gpt-4o","OPENAI_MAX_TOKENS=4096"],
    resend:   ["RESEND_API_KEY=re_","RESEND_FROM=noreply@yourdomain.com"],
    redis:    ["REDIS_URL=redis://localhost:6379","REDIS_PASSWORD="],
    aws:      ["AWS_ACCESS_KEY_ID=","AWS_SECRET_ACCESS_KEY=","AWS_REGION=us-east-1","AWS_S3_BUCKET="],
    cloudinary:["CLOUDINARY_CLOUD_NAME=","CLOUDINARY_API_KEY=","CLOUDINARY_API_SECRET="],
  }
  const lines: string[] = ["# .env — DO NOT COMMIT\n"]
  let matched = false
  Object.entries(templates).forEach(([key, vars]) => {
    if (s.includes(key)) { lines.push(`# ${key.toUpperCase()}`); lines.push(...vars); lines.push(""); matched = true }
  })
  if (!matched) {
    lines.push("# App"); lines.push("NODE_ENV=development"); lines.push("PORT=3000"); lines.push("APP_URL=http://localhost:3000"); lines.push("")
    lines.push("# Database"); lines.push("DATABASE_URL="); lines.push("")
    lines.push("# Auth"); lines.push("JWT_SECRET="); lines.push("SESSION_SECRET="); lines.push("")
    lines.push("# External APIs"); lines.push("API_KEY=")
  }
  return lines.join("\n")
}

function genStandup(input: string): string {
  const today = new Date().toLocaleDateString("en-US", { weekday:"long", month:"short", day:"numeric" })
  const lines = input.trim().split("\n").filter(Boolean)
  const yesterday = lines.slice(0, Math.ceil(lines.length / 2)).map(l => `  ✅ ${l}`).join("\n") || "  ✅ "
  const today_ = lines.slice(Math.ceil(lines.length / 2)).map(l => `  🔨 ${l}`).join("\n") || "  🔨 "
  return `# Standup — ${today}\n\n## Yesterday\n${yesterday}\n\n## Today\n${today_}\n\n## Blockers\n  ⛔ None\n\n---\n// Paste into Slack, Discord, or Telegram\n// Format: Yesterday → Today → Blockers`
}

function genInvoice(input: string): string {
  const today = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })
  const invoiceNum = `INV-${Date.now().toString().slice(-6)}`
  const lines = input.trim().split("\n").filter(Boolean)
  const items: { label: string; amount: number }[] = []
  let client = "Client Name"
  lines.forEach(l => {
    const priceMatch = l.match(/([\d\s,]+)([€$£]|EUR|USD|GBP)/)
    const priceMatch2 = l.match(/([€$£]|EUR|USD|GBP)\s*([\d\s,]+)/)
    const clientMatch = l.match(/^client[:\s]+(.+)/i)
    if (clientMatch) { client = clientMatch[1].trim(); return }
    if (priceMatch) {
      const amount = parseFloat(priceMatch[1].replace(/[\s,]/g, ""))
      const label = l.replace(priceMatch[0], "").trim().replace(/:.*$/, "").trim()
      items.push({ label: label || "Service", amount })
    } else if (priceMatch2) {
      const amount = parseFloat(priceMatch2[2].replace(/[\s,]/g, ""))
      const label = l.replace(priceMatch2[0], "").trim().replace(/:.*$/, "").trim()
      items.push({ label: label || "Service", amount })
    } else if (l.trim() && !l.startsWith("#")) {
      items.push({ label: l.trim(), amount: 0 })
    }
  })
  if (items.length === 0) items.push({ label: "Professional services", amount: 0 })
  const total = items.reduce((s, i) => s + i.amount, 0)
  const currency = input.includes("$") ? "$" : input.includes("£") ? "£" : "€"
  const pad = (s: string, n: number) => s.padEnd(n)
  const itemLines = items.map(i => `  ${pad(i.label, 38)} ${i.amount ? `${currency}${i.amount.toLocaleString()}` : "—"}`).join("\n")
  return `┌─────────────────────────────────────────┐\n│              INVOICE                    │\n│  ${pad(invoiceNum, 39)}│\n└─────────────────────────────────────────┘\n\nDate     : ${today}\nBill to  : ${client}\nFrom     : Your Name / Company\n\n──────────────────────────────────────────\n  Item                                    Amount\n──────────────────────────────────────────\n${itemLines}\n──────────────────────────────────────────\n  TOTAL${" ".repeat(34)} ${currency}${total.toLocaleString()}\n──────────────────────────────────────────\n\nPayment due: 30 days\nBank / IBAN / PayPal: <add your details>\n\nThank you for your business! 🙏`
}

function genMealPlan(input: string): string {
  const s = input.trim().toLowerCase()
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
  const people = s.match(/(\d+)\s*(?:people|person|adults?|kids?|family)/)?.[1] ?? "—"
  const isVeg = /veg|vegetar|vegan|plant/i.test(s)
  const ideas = isVeg
    ? ["Lentil soup + bread","Veggie stir-fry + rice","Pasta primavera","Chickpea curry + naan","Buddha bowl","Veggie tacos","Homemade pizza"]
    : ["Grilled chicken + salad","Salmon + roasted veg","Pasta bolognese","Stir-fry + rice","Tacos","Roast chicken","Homemade burgers"]
  const weeks = days.map((d, i) => `${d.padEnd(10)}: 🍽  ${ideas[i]}`).join("\n")
  return `# Weekly Meal Plan${people !== "—" ? ` — ${people} people` : ""}${isVeg ? " (vegetarian)" : ""}\n\n${weeks}\n\n──────────────────────────────\n## Shopping List (auto-generated)\n\n🥦 Produce: fill in per meal\n🥩 Proteins: fill in per meal\n🥫 Pantry: olive oil, salt, pasta, rice, canned tomatoes\n🧄 Aromatics: onions, garlic, ginger\n\n// Tip: edit days, then use the Shopping skill to sort by aisle`
}

function sortShopping(input: string): string {
  const categories: Record<string, RegExp> = {
    "🥦 Produce":        /lettuc|spinach|tomato|onion|garlic|carrot|potato|celery|cucumber|pepper|zucchini|broccoli|kale|apple|banana|lemon|avocado|herb|ginger|mushroom|salad|fruit|veg/i,
    "🥩 Meat & Fish":    /chicken|beef|pork|lamb|salmon|tuna|shrimp|bacon|steak|mince|sausage|turkey|cod|tilapia|fish/i,
    "🥛 Dairy & Eggs":   /milk|cheese|butter|cream|yogur|egg|mozzarella|parmesan|cheddar|feta|cream cheese/i,
    "🍞 Bakery":         /bread|baguette|bagel|croissant|pita|tortilla|wrap|roll|bun/i,
    "🥫 Canned & Dry":   /pasta|rice|lentil|chickpea|bean|can|canned|tomato sauce|broth|stock|flour|sugar|oat|quinoa|couscous/i,
    "🧴 Sauces & Oils":  /oil|sauce|vinegar|ketchup|mustard|mayo|soy sauce|hot sauce|pesto|tahini|salsa/i,
    "🧂 Spices":         /salt|pepper|cumin|paprika|turmeric|cinnamon|oregano|thyme|basil|curry|chili|garlic powder|onion powder/i,
    "🧃 Drinks":         /water|juice|wine|beer|coffee|tea|soda|milk/i,
    "🧊 Frozen":         /frozen|ice cream|peas|edamame/i,
    "🧼 Household":      /soap|detergent|tissue|toilet|cleaning|sponge|bag|foil|wrap/i,
  }
  const items = input.split(/\n|,/).map(i => i.trim()).filter(Boolean)
  const sorted: Record<string, string[]> = {}
  const uncategorized: string[] = []
  items.forEach(item => {
    let placed = false
    for (const [cat, re] of Object.entries(categories)) {
      if (re.test(item)) { sorted[cat] = [...(sorted[cat] ?? []), item]; placed = true; break }
    }
    if (!placed) uncategorized.push(item)
  })
  const lines: string[] = [`# 🛒 Shopping List (${items.length} items)\n`]
  Object.entries(sorted).forEach(([cat, list]) => {
    lines.push(`${cat}`); list.forEach(i => lines.push(`  □ ${i}`)); lines.push("")
  })
  if (uncategorized.length) { lines.push("📦 Other"); uncategorized.forEach(i => lines.push(`  □ ${i}`)) }
  return lines.join("\n")
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
  // ── Ops (deploy, Docker, cron, CI — from OpenClaw testimonials) ──────────
  {
    id: "cron",        icon: "⏰", label: "Cron",            category: "ops",
    description: "Generate or explain cron expressions for any scheduler",
    inputLabel: "Schedule or cron string", placeholder: "every 5 min  /  daily at 9am  /  0 9 * * 1-5",
    execute: genCron,
  },
  {
    id: "dockerfile",  icon: "🐳", label: "Dockerfile",      category: "ops",
    description: "Generate a production Dockerfile for your stack",
    inputLabel: "Stack", placeholder: "next  /  node  /  python  /  go  /  rust  /  bun",
    execute: genDockerfile,
  },
  {
    id: "deploy-check",icon: "🚀", label: "Deploy Checklist",category: "ops",
    description: "Pre-flight checklist before pushing to production",
    inputLabel: "Stack / platform", placeholder: "next  /  vercel  /  docker  /  railway  /  aws",
    execute: genDeployCheck,
  },
  {
    id: "env-gen",     icon: "🔐", label: ".env Template",   category: "ops",
    description: "Generate a .env file for any stack or third-party service",
    inputLabel: "Stack / services", placeholder: "next supabase stripe openai  /  firebase resend redis",
    execute: genEnvTemplate,
  },
  // ── Productivity (standup, invoice, meal plan — from OpenClaw testimonials)
  {
    id: "commit",      icon: "📝", label: "Commit Message",  category: "productivity",
    description: "Auto-generate a conventional commit message from your description",
    inputLabel: "What did you change?", placeholder: "Add Google OAuth login to the auth page",
    execute: genCommit,
  },
  {
    id: "gh-issue",    icon: "🐛", label: "GitHub Issue",    category: "productivity",
    description: "Generate a bug report or feature request template",
    inputLabel: "Issue summary", placeholder: "Login crashes on mobile Safari  /  Add dark mode toggle",
    execute: genGHIssue,
  },
  {
    id: "pr-desc",     icon: "🔀", label: "PR Description",  category: "productivity",
    description: "Structured pull request description, ready to paste in GitHub",
    inputLabel: "What does this PR do?", placeholder: "Refactor auth module to use JWT, remove session cookies",
    execute: genPRDesc,
  },
  {
    id: "standup",     icon: "☀️", label: "Daily Standup",   category: "productivity",
    description: "Format your standup for Slack, Discord or Telegram in seconds",
    inputLabel: "Yesterday · Today (one item per line)", placeholder: "Fixed login bug\nCompleted API auth\nStart dashboard today\nWrite tests",
    execute: genStandup,
  },
  {
    id: "invoice",     icon: "🧾", label: "Invoice",         category: "productivity",
    description: "Generate a clean text invoice from your line items",
    inputLabel: "Client + line items", placeholder: "Client: ACME Corp\nDev web: 1200€\nDesign: 800€\nMaintenance: 300€",
    execute: genInvoice,
  },
  {
    id: "meal-plan",   icon: "🍽️", label: "Meal Plan",       category: "productivity",
    description: "Generate a weekly meal plan + shopping list template",
    inputLabel: "Preferences / number of people", placeholder: "4 people, vegetarian  /  family of 3, no fish",
    execute: genMealPlan,
  },
  {
    id: "shopping",    icon: "🛒", label: "Shopping List",   category: "productivity",
    description: "Sort a shopping list by aisle category automatically",
    inputLabel: "Items (one per line or comma-separated)", placeholder: "chicken, broccoli, pasta, cheese\nmilk, garlic, olive oil, bread",
    execute: sortShopping,
  },
  {
    id: "excalidraw",  icon: "📐", label: "Excalidraw",      category: "productivity",
    description: "Generate an Excalidraw diagram JSON from a flow — paste at excalidraw.com",
    inputLabel: "Flow (nodes separated by →)", placeholder: "User Login → Validate Token → Load Dashboard → Show Profile",
    execute: genExcalidraw,
  },
]

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  "vibe-coder":   "Vibe Coder",
  "ops":          "Ops & DevOps",
  "productivity": "Productivity",
  "utils":        "Utils",
}

const CATEGORY_ORDER: SkillCategory[] = ["vibe-coder", "ops", "productivity", "utils"]

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

  const grouped = (["vibe-coder", "ops", "productivity", "utils"] as SkillCategory[]).map(cat => ({
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
