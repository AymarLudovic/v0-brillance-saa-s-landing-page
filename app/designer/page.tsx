"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Globe, ArrowUp, Copy, Download, LogOut, Menu, X } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Bodoni_Moda } from "next/font/google"
import { auth, db, googleProvider } from "@/lib/firebase"
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from "firebase/auth"
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  orderBy,
  query,
  limit,
} from "firebase/firestore"

// ── Inline UI components ──────────────────────────────────────────────────────

const Button = ({
  children, onClick, disabled, variant = "default", className = "",
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "default" | "ghost" | "outline" | "secondary"; className?: string;
}) => {
  const base = "inline-flex items-center justify-center text-sm font-medium rounded-md transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2"
  const variants: Record<string, string> = {
    default: "bg-black text-white hover:bg-gray-800",
    ghost: "bg-transparent hover:bg-gray-100 text-black",
    outline: "border border-gray-300 bg-white hover:bg-gray-50 text-black",
    secondary: "bg-gray-100 text-black hover:bg-gray-200",
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

const Label = ({ children, htmlFor, className = "" }: { children: React.ReactNode; htmlFor?: string; className?: string }) => (
  <label htmlFor={htmlFor} className={`text-sm font-medium text-gray-700 ${className}`}>{children}</label>
)

const Switch = ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => (
  <button
    role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? "bg-black" : "bg-gray-300"}`}
  >
    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-1"}`} />
  </button>
)

const Dialog = ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4">{children}</div>
    </div>
  )
}
const DialogContent = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`p-6 ${className}`}>{children}</div>
)
const DialogHeader = ({ children }: { children: React.ReactNode }) => <div className="mb-4">{children}</div>
const DialogTitle = ({ children }: { children: React.ReactNode }) => <h2 className="text-lg font-semibold text-black">{children}</h2>
const DialogDescription = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-500 mt-1">{children}</p>
const DialogFooter = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex justify-end gap-2 mt-4 ${className}`}>{children}</div>
)

const bodoni = Bodoni_Moda({ subsets: ["latin"], display: "swap" })

// ── Types ─────────────────────────────────────────────────────────────────────

type AnimationFile = { url: string; content: string; type: "css" | "js"; isAnimation: boolean; library?: string; confidence: number }

type Result = {
  title: string; description: string; techGuesses: string[]
  internalLinks: number; externalLinks: number; images: string[]
  stylesheets: number; openGraphTags: number
  fullHTML: string; fullCSS: string; fullJS: string
  baseURL: string; animationFiles: AnimationFile[]; requiredCdnUrls: string[]
}

type Suggestion = {
  id: string; url: string; faviconUrl: string
  html: string; css: string; js: string
}

type FrameworkKey = "next" | "remix" | "astro" | "vite-react" | "sveltekit" | "vue-vite" | "nuxt" | "html"

const frameworkLabel: Record<FrameworkKey, string> = {
  next: "Next.js (App Router, TSX)",
  remix: "Remix (TSX)",
  astro: "Astro (.astro)",
  "vite-react": "Vite (React, JSX)",
  sveltekit: "SvelteKit (+page.svelte)",
  "vue-vite": "Vue (Vite, SFC)",
  nuxt: "Nuxt (pages/preview.vue)",
  html: "HTML + CSS + JS (combined)",
}

// ── Circular text ─────────────────────────────────────────────────────────────

function CircularText({ size = 140 }: { size?: number }) {
  const prefersReduced = useReducedMotion()
  const radius = size / 2 - 8
  const text = " STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO •"
  return (
    <div className="mx-auto mb-6 flex items-center justify-center">
      <motion.svg
        width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        className="text-black" aria-hidden="true"
        animate={prefersReduced ? undefined : { rotate: 360 }}
        transition={prefersReduced ? undefined : { repeat: Infinity, duration: 14, ease: "linear" }}
        style={{ willChange: "transform" }}
      >
        <defs>
          <path id="circlePath" d={`M ${size/2},${size/2} m -${radius},0 a ${radius},${radius} 0 1,1 ${radius*2},0 a ${radius},${radius} 0 1,1 -${radius*2},0`} />
        </defs>
        <text fill="currentColor" fontSize="12" letterSpacing="2" className={`${bodoni.className} tracking-widest`}>
          <textPath href="#circlePath">{text}</textPath>
        </text>
      </motion.svg>
    </div>
  )
}

// ── Google favicon helper ─────────────────────────────────────────────────────

function faviconUrl(domain: string) {
  const clean = domain.replace(/^https?:\/\//, "").split("/")[0]
  return `https://www.google.com/s2/favicons?domain=${clean}&sz=32`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SiteInspector() {
  // Auth
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  // Suggestions from Firestore
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  // Analyzer
  const [url, setUrl] = useState("")
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<{ id: string; message: string } | null>(null)

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey>("next")
  const [generatedFilename, setGeneratedFilename] = useState("")
  const [generatedCode, setGeneratedCode] = useState("")
  const [showCodePreview, setShowCodePreview] = useState(false)

  // Desktop iframe scale
  const iframeWrapRef = useRef<HTMLDivElement>(null)
  const [iframeScale, setIframeScale] = useState(1)

  // Unused SPA states kept to avoid breaking analyzeSite
  const [, setIsSPA] = useState(false)
  const [, setSpaFramework] = useState("")

  // ── Auth listener ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  // ── Load suggestions from Firestore ───────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, "suggestions"), orderBy("createdAt", "desc"), limit(12)))
        setSuggestions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Suggestion, "id">) })))
      } catch {}
    }
    load()
  }, [])

  // ── Load user history from Firestore ──────────────────────────────────────

  useEffect(() => {
    if (!user) { setHistory([]); return }
    async function loadHistory() {
      try {
        const snap = await getDocs(
          query(collection(db, `users/${user.uid}/analyses`), orderBy("analyzedAt", "desc"), limit(30))
        )
        setHistory(snap.docs.map((d) => (d.data() as any).url || ""))
      } catch {}
    }
    loadHistory()
  }, [user])

  // ── Save analysis to Firestore when result arrives ─────────────────────────

  useEffect(() => {
    if (!result || !user || !url) return
    const clean = url.replace(/^https?:\/\//, "")
    addDoc(collection(db, `users/${user.uid}/analyses`), {
      url: clean,
      analyzedAt: serverTimestamp(),
    }).catch(() => {})
    setHistory((prev) => [clean, ...prev.filter((u) => u !== clean)].slice(0, 30))
  }, [result])

  // ── Desktop iframe scale ───────────────────────────────────────────────────

  useEffect(() => {
    if (!iframeWrapRef.current) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      setIframeScale(Math.min(1, w / 1280))
    })
    obs.observe(iframeWrapRef.current)
    return () => obs.disconnect()
  }, [result])

  // ── Auth actions ───────────────────────────────────────────────────────────

  const handleSignIn = async () => {
    try { await signInWithPopup(auth, googleProvider) } catch {}
  }
  const handleSignOut = async () => {
    await signOut(auth)
    setSidebarOpen(false)
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  const createDownloadLink = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(href)
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus({ id, message: "Copied! ✅" })
    } catch {
      setCopyStatus({ id, message: "Failed ✗" })
    }
    setTimeout(() => setCopyStatus(null), 2000)
  }

  const getLibraryCDN = (library: string): string[] => {
    const cdnMap: Record<string, string[]> = {
      GSAP: ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js", "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"],
      "Three.js": ["https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"],
      Lottie: ["https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"],
      AOS: ["https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.js", "https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.css"],
      "Anime.js": ["https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"],
      Swiper: ["https://cdn.jsdelivr.net/npm/swiper@8/swiper-bundle.min.js", "https://cdn.jsdelivr.net/npm/swiper@8/swiper-bundle.min.css"],
    }
    return cdnMap[library] || []
  }

  // ── Analyze ────────────────────────────────────────────────────────────────

  const analyzeSite = async (urlToAnalyze = url) => {
    if (!urlToAnalyze) return
    setLoading(true); setError(null); setResult(null)
    setCopyStatus(null); setIsSPA(false); setSpaFramework("")
    try {
      let fullUrl = urlToAnalyze
      if (!/^https?:\/\//i.test(fullUrl)) fullUrl = "https://" + fullUrl

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || "Analyse échouée")
      if (data.isSPA) { setIsSPA(true); setSpaFramework(data.framework || "") }

      const { fullHTML, fullCSS, fullJS } = data
      const baseURL = new URL(fullUrl).origin
      const parser = new DOMParser()
      const doc = parser.parseFromString(fullHTML, "text/html")
      const title = doc.querySelector("title")?.textContent || new URL(fullUrl).hostname
      const description = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "Not found"
      const links = Array.from(doc.querySelectorAll("a[href]")).map((el) => el.getAttribute("href") || "")
      const internalLinks = links.filter((href) => { try { return new URL(href, baseURL).hostname === new URL(fullUrl).hostname } catch { return false } }).length
      const externalLinks = links.length - internalLinks
      const imageSrcs: string[] = Array.from(doc.querySelectorAll("img")).map((img) => { const src = img.getAttribute("src"); if (!src) return null; try { return new URL(src, baseURL).href } catch { return null } }).filter((s): s is string => !!s)
      const ogTags = doc.querySelectorAll('meta[property^="og:"]').length
      const allCode = [fullJS, fullCSS, fullHTML].join(" ")
      const techGuesses: string[] = []
      const techPatterns: Record<string, RegExp> = {
        React: /react|jsx|createelement/gi, Vue: /vue\.js|v-if|v-for/gi,
        jQuery: /jquery|\$\(/gi, GSAP: /gsap|greensock|tweenmax/gi,
        "Three.js": /three\.js|webgl/gi, Bootstrap: /bootstrap/gi,
        Tailwind: /tailwind/gi, AOS: /aos\.js|data-aos/gi, Swiper: /swiper/gi,
      }
      Object.entries(techPatterns).forEach(([tech, pattern]) => { if (pattern.test(allCode)) techGuesses.push(tech) })
      const allCdnUrls: string[] = []
      ;[...new Set(techGuesses)].forEach((lib) => allCdnUrls.push(...getLibraryCDN(lib)))

      setResult({ title, description, techGuesses, internalLinks, externalLinks, images: imageSrcs, stylesheets: data.stats?.cssFilesCount ?? 0, openGraphTags: ogTags, fullHTML, fullCSS, fullJS, baseURL, animationFiles: [], requiredCdnUrls: allCdnUrls })
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeClick = () => analyzeSite()
  const handleProposalClick = (pUrl: string) => { setUrl(pUrl); analyzeSite(pUrl) }
  const handleSuggestionClick = (s: Suggestion) => {
    setUrl(s.url)
    setResult({
      title: s.url, description: "", techGuesses: [], internalLinks: 0, externalLinks: 0,
      images: [], stylesheets: 0, openGraphTags: 0,
      fullHTML: s.html, fullCSS: s.css, fullJS: s.js,
      baseURL: `https://${s.url}`, animationFiles: [], requiredCdnUrls: [],
    })
  }

  // ── Code generation ────────────────────────────────────────────────────────

  const escTpl = (s: string | undefined | null): string => {
    if (!s || typeof s !== "string") return ""
    return s.replace(/`/g, "\\\\`").replace(/\\$\\{/g, "\\\\${")
  }

  const gen = (fw: FrameworkKey) => {
    if (!result) return { filename: "", code: "" }
    const HTML = escTpl(result.fullHTML); const CSS = escTpl(result.fullCSS); const JS = escTpl(result.fullJS)
    switch (fw) {
      case "next": return { filename: "app/preview/page.tsx", code: `"use client"\nimport { useEffect } from "react"\nexport default function Page() {\n  useEffect(() => {\n    const style = document.createElement("style"); style.textContent = \`${CSS}\`; document.head.appendChild(style)\n    const script = document.createElement("script"); script.innerHTML = \`${JS}\`; document.body.appendChild(script)\n    return () => { try { style.remove(); script.remove() } catch {} }\n  }, [])\n  return <main dangerouslySetInnerHTML={{ __html: \`${HTML}\` }} />\n}` }
      case "html": return { filename: "index.html", code: `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><style>\n${result.fullCSS}\n</style></head><body>\n${result.fullHTML}\n<script>\n${result.fullJS}\n</script></body></html>` }
      default: return { filename: "app/preview/page.tsx", code: `"use client"\nimport { useEffect } from "react"\nexport default function Page() {\n  useEffect(() => {\n    const style = document.createElement("style"); style.textContent = \`${CSS}\`; document.head.appendChild(style)\n    const script = document.createElement("script"); script.innerHTML = \`${JS}\`; document.body.appendChild(script)\n    return () => { try { style.remove(); script.remove() } catch {} }\n  }, [])\n  return <main dangerouslySetInnerHTML={{ __html: \`${HTML}\` }} />\n}` }
    }
  }

  useEffect(() => {
    if (!result) return
    try { const { filename, code } = gen(selectedFramework); setGeneratedFilename(filename); setGeneratedCode(code) }
    catch { setGeneratedFilename(""); setGeneratedCode("") }
  }, [selectedFramework, result])

  const buildJsxPrompt = () => {
    if (!result) return ""
    const { filename, code } = gen("vite-react")
    return `You are given a complete React JSX implementation. Use it EXACTLY as provided.\n\nFile: ${filename}\n\n\`\`\`jsx\n${code}\n\`\`\``
  }

  const handleCopyPrompt = () => { const p = buildJsxPrompt(); if (p) copyToClipboard(p, "prompt") }
  const handleDownloadPrompt = () => { const p = buildJsxPrompt(); if (p) createDownloadLink(p, "prompt.txt", "text/plain") }

  const previewDoc = useMemo(() => {
    if (!result) return ""
    try { return result.fullHTML } catch { return "" }
  }, [result])

  // ── Format URL for sidebar ─────────────────────────────────────────────────
  const formatUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "")

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white overflow-x-hidden">

      {/* ── Sidebar overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
        </div>
      )}

      {/* ── Sidebar panel ── */}
      <aside className={`fixed top-0 left-0 h-full w-[280px] bg-white border-r border-[#f0f0f0] z-50 flex flex-col transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#f0f0f0]">
          <span className={`${bodoni.className} text-lg text-black`}>Menu</span>
          <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-600" />
          </button>
        </div>

        {/* Auth section */}
        <div className="p-4 border-b border-[#f0f0f0]">
          {authLoading ? (
            <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-3">
              {user.photoURL ? (
                <img src={user.photoURL} alt="avatar" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-black flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {user.displayName?.[0] || user.email?.[0] || "U"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-black truncate">{user.displayName || "User"}</p>
                <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-black flex items-center gap-1 mt-0.5">
                  <LogOut size={10} /> Sign out
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="w-full flex items-center justify-center gap-2 h-10 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
          )}
        </div>

        {/* History */}
        {user && (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Recent analyses</p>
            {history.length === 0 ? (
              <p className="text-xs text-gray-300 italic">No analyses yet</p>
            ) : (
              <div className="space-y-1">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => { setUrl(h); setSidebarOpen(false); analyzeSite(h) }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
                  >
                    <img src={faviconUrl(h)} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                    <span className="text-sm text-gray-700 truncate group-hover:text-black">{formatUrl(h)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin link */}
        {user?.email === "ludovicaymar8@gmail.com" && (
          <div className="p-4 border-t border-[#f0f0f0]">
            <a href="/admin" className="flex items-center gap-2 text-sm text-gray-500 hover:text-black transition-colors">
              <span>⚙</span> Admin panel
            </a>
          </div>
        )}
      </aside>

      {/* ── Page ── */}
      <div className="p-4 sm:p-8">

        {/* Header */}
        <header className="max-w-4xl mx-auto flex justify-between items-center mb-12">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-gray-100 transition-colors"
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt="avatar" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <Menu size={20} className="text-black" />
            )}
          </button>
          <svg className="h-[20px] w-[20px]" width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="#111">
            <rect x="0" y="0" width="32" height="32" rx="10" />
          </svg>
          <div className="w-7" />
        </header>

        <div className="max-w-4xl mx-auto pb-36">

          {/* Hero */}
          <div className="text-center mb-10">
            <CircularText size={120} />
            <h1 className={`${bodoni.className} text-4xl sm:text-6xl md:text-8xl leading-[1.05] text-black mb-4`}>
              Clone your favorite website design.
            </h1>
            <p className="text-base sm:text-lg text-gray-600 max-w-xl mx-auto">
              Paste a URL, launch the process, and instantly get a pixel-perfect replica of any website&apos;s design.
            </p>
          </div>

          {/* Input */}
          <div className="w-full max-w-[480px] mx-auto mb-4 px-2">
            <div className="h-[48px] w-full ring-2 ring-[#eee] rounded-[14px] flex items-center p-1">
              <div className="h-full w-full bg-white ring-2 ring-[#FAFAFA] rounded-[12px] flex items-center px-2 gap-1">
                <Globe size={18} className="text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyzeClick()}
                  className="flex-1 min-w-0 h-full bg-transparent text-black focus:outline-none placeholder-[#aaa] text-sm"
                />
                <button
                  onClick={handleAnalyzeClick}
                  disabled={loading}
                  className="h-[36px] w-[36px] flex-shrink-0 bg-[#111] rounded-[9px] flex items-center justify-center transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="bg-white rounded-[4px] w-3.5 h-3.5 animate-pulse" />
                  ) : (
                    <ArrowUp size={17} className="text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Suggestion chips (Try:) */}
          {!loading && !result && suggestions.length > 0 && (
            <div className="flex justify-center items-center gap-2 flex-wrap mb-8 px-2">
              <span className="text-sm text-gray-400">Try:</span>
              {suggestions.slice(0, 5).map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSuggestionClick(s)}
                  className="h-[30px] w-auto bg-[#FAFAFA] border border-[#eee] rounded-full flex items-center px-3 gap-1.5 transition-transform hover:scale-105 text-sm text-gray-700"
                >
                  <img
                    src={s.faviconUrl || faviconUrl(s.url)}
                    alt=""
                    className="w-4 h-4 rounded-sm flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                  />
                  {formatUrl(s.url)}
                </button>
              ))}
            </div>
          )}

          {/* Suggestion cards from Firebase (desktop preview thumbnails) */}
          {!loading && !result && suggestions.length > 0 && (
            <div className="flex justify-center mb-10 px-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-2xl">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestionClick(s)}
                    className="group relative h-[180px] sm:h-[220px] rounded-[12px] border border-[#eee] overflow-hidden bg-[#FAFAFA] cursor-pointer hover:shadow-md transition-shadow"
                  >
                    {/* Scaled iframe preview */}
                    <div className="w-full h-full overflow-hidden pointer-events-none">
                      <iframe
                        srcDoc={s.html}
                        sandbox="allow-scripts"
                        className="absolute top-0 left-0 border-0"
                        style={{ width: "1280px", height: "900px", transform: "scale(0.23)", transformOrigin: "top left" }}
                        title={s.url}
                      />
                    </div>
                    {/* Label */}
                    <div className="absolute bottom-2 left-2 right-2">
                      <div className="backdrop-blur-md bg-white/80 rounded-[8px] flex items-center gap-1.5 px-2 py-1">
                        <img src={s.faviconUrl || faviconUrl(s.url)} alt="" className="w-3.5 h-3.5 rounded-sm flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                        <span className="text-[11px] font-semibold text-black truncate">{formatUrl(s.url)}</span>
                        <ArrowUp size={12} className="text-black ml-auto flex-shrink-0" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-red-600 bg-red-50 p-3 rounded-lg text-center mb-6 text-sm">{error}</p>}

          {/* ── UI Preview ── */}
          {result && (
            <div>
              <h3 className="text-xl font-bold text-black mb-3">UI preview</h3>
              {/* Desktop iframe scaled to fit mobile */}
              <div
                ref={iframeWrapRef}
                className="w-full rounded-xl border border-gray-200 overflow-hidden bg-white"
                style={{ height: `${Math.round(800 * iframeScale)}px`, minHeight: 280, position: "relative" }}
              >
                <iframe
                  title="UI preview"
                  srcDoc={previewDoc}
                  sandbox="allow-scripts allow-same-origin"
                  style={{
                    width: 1280,
                    height: 800,
                    border: "none",
                    transform: `scale(${iframeScale})`,
                    transformOrigin: "top left",
                    display: "block",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom action bar (responsive) ── */}
      {result && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-[#eee] px-4 py-3 z-30">
          <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              onClick={handleCopyPrompt}
              className="flex-shrink-0 flex items-center gap-1.5 h-[36px] px-3 rounded-[10px] border border-[#e5e5e5] bg-white text-sm font-medium text-black hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <Copy size={14} />
              <span className="hidden sm:inline">Copy JSX prompt</span>
              <span className="sm:hidden">Copy</span>
            </button>
            <button
              onClick={handleDownloadPrompt}
              className="flex-shrink-0 flex items-center gap-1.5 h-[36px] px-3 rounded-[10px] border border-[#e5e5e5] bg-white text-sm font-medium text-black hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Download prompt</span>
              <span className="sm:hidden">Prompt</span>
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="flex-shrink-0 flex items-center gap-1.5 h-[36px] px-3 rounded-[10px] border border-[#e5e5e5] bg-white text-sm font-medium text-black hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Download code</span>
              <span className="sm:hidden">Code</span>
            </button>
            {copyStatus?.id === "prompt" && (
              <span className="flex-shrink-0 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-md">{copyStatus.message}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Export code</DialogTitle>
            <DialogDescription>Select a framework and download the file.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="framework">Framework</Label>
                <select id="framework" className="w-full h-10 rounded-md border border-gray-200 bg-white px-3 text-sm" value={selectedFramework} onChange={(e) => setSelectedFramework(e.target.value as FrameworkKey)}>
                  {Object.entries(frameworkLabel).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="inline-flex items-center justify-between w-full">
                  <span>View code</span>
                  <Switch checked={showCodePreview} onCheckedChange={setShowCodePreview} />
                </Label>
                <input readOnly value={generatedFilename} className="w-full h-10 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs" />
              </div>
            </div>
            {showCodePreview && (
              <div className="rounded-lg border bg-[#0b0c10] border-gray-800 overflow-hidden">
                <div className="px-3 py-2 text-xs text-gray-300 bg-[#0f1117] border-b border-gray-800 flex justify-between">
                  <span>{generatedFilename}</span><span className="text-gray-500">readonly</span>
                </div>
                <pre className="max-h-[420px] overflow-auto text-xs leading-5 p-4 text-gray-100"><code>{generatedCode}</code></pre>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => copyToClipboard(generatedCode, "export-code")} disabled={!generatedCode}>
              <Copy className="mr-2 h-4 w-4" />Copy code
            </Button>
            <Button onClick={() => { if (generatedCode && generatedFilename) createDownloadLink(generatedCode, generatedFilename.replaceAll("/", "_"), "text/plain") }} disabled={!generatedCode}>
              <Download className="mr-2 h-4 w-4" />Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
