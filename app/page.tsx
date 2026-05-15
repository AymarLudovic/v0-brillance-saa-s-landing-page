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
  getDoc,
  setDoc,
  doc,
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

// Firestore stores only url + faviconUrl (lightweight)
// HTML is fetched on-demand in parallel, cached in memory
type Suggestion = {
  id: string
  url: string
  faviconUrl: string
}

const ADMIN_EMAIL = "ludovicaymar8@gmail.com"

// ── Skills ────────────────────────────────────────────────────────────────────

type SkillType = "ai" | "mechanical" | "connector"

type SubSkill = {
  id: string
  label: string
  description: string
}

type Skill = {
  id: string
  label: string
  icon: string
  description: string
  placeholder: string
  type: SkillType
  domain?: string        // for connector favicon
  subSkills?: SubSkill[] // for connector double dropdown
}

const SKILLS: Skill[] = [
  // ── IA ────────────────────────────────────────────────────────────────────
  {
    id: "websearch",  icon: "🌐", label: "Web Search",  type: "ai",
    description: "Recherche sur le web et résume les résultats en temps réel",
    placeholder: "Que veux-tu rechercher sur le web ?",
  },
  {
    id: "resume",     icon: "✨", label: "Résumé",      type: "ai",
    description: "Résume un texte en quelques lignes",
    placeholder: "Colle ton texte ici…",
  },
  {
    id: "reformuler", icon: "✍️", label: "Reformuler",  type: "ai",
    description: "Reformule un devoir ou une rédaction",
    placeholder: "Colle le texte à reformuler…",
  },
  {
    id: "corriger",   icon: "🔍", label: "Corriger",    type: "ai",
    description: "Corrige les fautes d'orthographe et de grammaire",
    placeholder: "Colle ton texte à corriger…",
  },
  {
    id: "traduire",   icon: "🌍", label: "Traduire",    type: "ai",
    description: "Traduit un texte dans la langue de ton choix",
    placeholder: "Texte à traduire | Langue cible (ex: anglais)…",
  },
  {
    id: "cv",         icon: "📄", label: "Créer CV",    type: "ai",
    description: "Génère un CV professionnel à partir de tes infos",
    placeholder: "Décris ton profil, expériences, compétences…",
  },
  // ── Mécaniques ────────────────────────────────────────────────────────────
  {
    id: "compter",    icon: "🔢", label: "Compter",     type: "mechanical",
    description: "Compte mots, caractères et paragraphes",
    placeholder: "Colle ton texte ici…",
  },
  {
    id: "password",   icon: "🔐", label: "Password",    type: "mechanical",
    description: "Génère un mot de passe fort aléatoire",
    placeholder: "Appuie sur Envoyer pour générer…",
  },
  {
    id: "img2pdf",    icon: "🖼️", label: "Images → PDF", type: "mechanical",
    description: "Convertit une ou plusieurs images en PDF téléchargeable",
    placeholder: "Clique sur Envoyer puis sélectionne tes images…",
  },
  {
    id: "signer",     icon: "✒️", label: "Signer",      type: "mechanical",
    description: "Signe un document ou une facture avec ta signature",
    placeholder: "Clique sur Envoyer pour ouvrir le panneau de signature…",
  },
  // ── Connecteurs ───────────────────────────────────────────────────────────
  {
    id: "notion",     icon: "📝", label: "Notion",      type: "connector",
    description: "Crée des pages et notes dans Notion",
    placeholder: "Décris ce que tu veux créer dans Notion…",
    domain: "notion.so",
    subSkills: [
      { id: "notion-note",  label: "Créer une note",  description: "Crée une page rapide dans ta workspace" },
      { id: "notion-todo",  label: "Créer une tâche", description: "Ajoute une tâche dans ta to-do list" },
      { id: "notion-table", label: "Créer un tableau", description: "Génère un tableau structuré" },
    ],
  },
  {
    id: "drive",      icon: "📁", label: "Google Drive", type: "connector",
    description: "Sauvegarde et gère tes fichiers sur Drive",
    placeholder: "Décris ce que tu veux faire sur Drive…",
    domain: "drive.google.com",
    subSkills: [
      { id: "drive-save",   label: "Sauvegarder un fichier", description: "Envoie un fichier dans ton Drive" },
      { id: "drive-doc",    label: "Créer un Google Doc",    description: "Crée un nouveau document texte" },
      { id: "drive-sheet",  label: "Créer une Sheet",        description: "Crée une nouvelle feuille de calcul" },
    ],
  },
  {
    id: "gmail",      icon: "📧", label: "Gmail",        type: "connector",
    description: "Rédige et envoie des emails via Gmail",
    placeholder: "Décris l'email à envoyer…",
    domain: "gmail.com",
    subSkills: [
      { id: "gmail-draft",  label: "Rédiger un brouillon", description: "Génère un email prêt à envoyer" },
      { id: "gmail-send",   label: "Envoyer un email",     description: "Envoie directement depuis ton compte" },
    ],
  },
  {
    id: "pinterest",  icon: "📌", label: "Pinterest",    type: "connector",
    description: "Publie et organise des pins sur Pinterest",
    placeholder: "Décris ce que tu veux publier…",
    domain: "pinterest.com",
    subSkills: [
      { id: "pin-create",   label: "Créer un pin",          description: "Publie une image sur Pinterest" },
      { id: "pin-board",    label: "Créer un tableau",       description: "Crée un nouveau tableau Pinterest" },
    ],
  },
  {
    id: "trello",     icon: "📋", label: "Trello",       type: "connector",
    description: "Gère tes cartes et projets Trello",
    placeholder: "Décris la carte à créer…",
    domain: "trello.com",
    subSkills: [
      { id: "trello-card",  label: "Créer une carte",   description: "Ajoute une carte dans un tableau" },
      { id: "trello-list",  label: "Créer une liste",   description: "Ajoute une nouvelle liste" },
    ],
  },
  // ── Pro / Monétisables ────────────────────────────────────────────────────
  {
    id: "emaildigest", icon: "📬", label: "Email Digest",    type: "ai",
    description: "Résume tes emails et extrait les actions urgentes du jour",
    placeholder: "Colle tes emails ici (expéditeur, sujet, contenu)…",
  },
  {
    id: "seo",         icon: "📈", label: "SEO Analyser",    type: "ai",
    description: "Rapport SEO complet : score, meta, keywords, top 5 actions",
    placeholder: "Entre une URL à analyser (ex: monsite.com)…",
  },
  {
    id: "postgen",     icon: "🚀", label: "Post LinkedIn/X", type: "ai",
    description: "Génère un post viral LinkedIn ou X à partir de ton projet",
    placeholder: "Décris ton projet | ajoute 'linkedin' ou 'x' pour cibler…",
  },
  {
    id: "codereview",  icon: "🧑‍💻", label: "Code Review",    type: "ai",
    description: "Analyse ton code : bugs, sécurité, performance, refactoring",
    placeholder: "Colle ton code ici (JS, Python, TypeScript, Go…)…",
  },
  {
    id: "invoice",     icon: "🧾", label: "Facture Pro",     type: "ai",
    description: "Génère une facture professionnelle prête à télécharger",
    placeholder: "Client: ACME | Dev web: 1200€ | Design: 800€ | Date: aujourd'hui…",
  },
]

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

  const isAdmin = user?.email === ADMIN_EMAIL

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  // Suggestions from Firestore (url + favicon only, lightweight)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  // HTML previews fetched in background per suggestion id — never blocks main input
  const [suggestionPreviews, setSuggestionPreviews] = useState<Record<string, string>>({})

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

  // Unused SPA states kept to avoid breaking analyzeSite
  const [, setIsSPA] = useState(false)
  const [, setSpaFramework] = useState("")

  // Trial
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null)
  const [trialExpired, setTrialExpired] = useState(false)

  // Prompt framework selector + sign-in modal
  const [promptFw, setPromptFw] = useState<FrameworkKey>("next")
  const [showSignInModal, setShowSignInModal] = useState(false)

  // ── Skills ────────────────────────────────────────────────────────────────
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null)
  const [activeSubSkill, setActiveSubSkill] = useState<SubSkill | null>(null)
  const [showSkillDropdown, setShowSkillDropdown] = useState(false)
  const [showSubSkillDropdown, setShowSubSkillDropdown] = useState(false)
  const [skillSearch, setSkillSearch] = useState("")
  const [skillInput, setSkillInput] = useState("")
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillResult, setSkillResult] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  // img2pdf
  const [pdfImages, setPdfImages] = useState<{ name: string; dataUrl: string }[]>([])
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null)
  // signature
  const [signatureMode, setSignatureMode] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("gemini_api_key") || ""
    return ""
  })
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  // ⚠️ Clé Tavily — ne pas commiter en production, utiliser une variable d'env côté serveur
  const [tavilyApiKey, setTavilyApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("tavily_api_key") || "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"
    return "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"
  })
  const [showTavilyKeyInput, setShowTavilyKeyInput] = useState(false)
  const [tavilyKeyDraft, setTavilyKeyDraft] = useState("")

  // ── Connector status (OAuth via /api/auth — tokens httpOnly côté serveur) ──
  const [connectorStatus, setConnectorStatus] = useState<Record<string, boolean>>({})
  const [showConnectorConfig, setShowConnectorConfig] = useState(false)

  // ── Auth listener ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  // ── Connector status check (Nango) ────────────────────────────────────────
  useEffect(() => {
    if (!user) return
    fetch(`/api/connector?userId=${user.uid}`)
      .then(r => r.json()).then(setConnectorStatus).catch(() => {})
  }, [user])

  useEffect(() => {
    if (!user) { setTrialDaysLeft(null); setTrialExpired(false); return }
    async function checkTrial() {
      try {
        const trialRef = doc(db, `users/${user.uid}/trial/info`)
        const snap = await getDoc(trialRef)
        if (!snap.exists()) {
          // Nouveau utilisateur : créer la période d'essai
          await setDoc(trialRef, { trialStart: serverTimestamp(), email: user.email })
          setTrialDaysLeft(5)
          setTrialExpired(false)
        } else {
          const data = snap.data()
          const start = data.trialStart?.toDate?.() ?? new Date()
          const elapsed = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)
          const left = Math.max(0, Math.ceil(5 - elapsed))
          setTrialDaysLeft(left)
          setTrialExpired(left === 0)
        }
      } catch {}
    }
    checkTrial()
  }, [user])

  // ── Load suggestions + fetch previews in parallel background ─────────────

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(query(collection(db, "suggestions"), orderBy("createdAt", "desc"), limit(12)))
        const loaded = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Suggestion, "id">) }))
        setSuggestions(loaded)

        // Fire all preview fetches in parallel — completely independent from the main input
        // Uses requestIdleCallback if available so it doesn't compete with user interactions
        const run = () => {
          loaded.forEach((s) => {
            const fullUrl = `https://${s.url}`
            fetch("/api/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: fullUrl }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.success && data.fullHTML) {
                  setSuggestionPreviews((prev) => ({ ...prev, [s.id]: data.fullHTML }))
                }
              })
              .catch(() => {}) // silently ignore failures
          })
        }

        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          (window as any).requestIdleCallback(run, { timeout: 5000 })
        } else {
          setTimeout(run, 500)
        }
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

  const handleAnalyzeClick = () => {
    if (!user) { setError("Please sign in to analyse a site."); return }
    if (trialExpired) { setError("Your trial has expired. Subscribe to continue."); return }
    analyzeSite()
  }
  const handleProposalClick = (pUrl: string) => {
    if (!user || trialExpired) return
    setUrl(pUrl); analyzeSite(pUrl)
  }
  const handleSuggestionClick = (s: Suggestion) => {
    const html = suggestionPreviews[s.id]
    setUrl(s.url)
    if (html) {
      // Preview already fetched — use it instantly
      setResult({
        title: s.url, description: "", techGuesses: [], internalLinks: 0, externalLinks: 0,
        images: [], stylesheets: 0, openGraphTags: 0,
        fullHTML: html, fullCSS: "", fullJS: "",
        baseURL: `https://${s.url}`, animationFiles: [], requiredCdnUrls: [],
      })
    } else {
      // Not yet fetched — trigger a fresh analysis
      analyzeSite(s.url)
    }
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

  // Ref sur l'iframe pour accéder au contentDocument (computed styles)
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractedHTML, setExtractedHTML] = useState<string | null>(null)
  const [extractedSize, setExtractedSize] = useState(0)
  const [showExtracted, setShowExtracted] = useState(false)

  // ── Whitelist : uniquement les props visuellement utiles (pas les 300+ computed) ──
  const VISUAL_PROPS = [
    "color","font-family","font-size","font-weight","font-style","font-variant",
    "line-height","letter-spacing","text-align","text-decoration","text-transform",
    "text-shadow","white-space","word-break","vertical-align",
    "background","background-color","background-image","background-size",
    "background-position","background-repeat","background-clip",
    "border","border-top","border-right","border-bottom","border-left",
    "border-radius","border-color","border-width","border-style",
    "box-shadow","outline","outline-color","outline-width","outline-style",
    "display","position","top","right","bottom","left","z-index",
    "width","height","min-width","min-height","max-width","max-height",
    "margin","margin-top","margin-right","margin-bottom","margin-left",
    "padding","padding-top","padding-right","padding-bottom","padding-left",
    "flex","flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis",
    "align-items","align-self","justify-content","justify-self","gap","row-gap","column-gap",
    "grid-template-columns","grid-template-rows","grid-column","grid-row",
    "overflow","overflow-x","overflow-y",
    "opacity","visibility","transform","clip-path","filter",
    "object-fit","object-position","aspect-ratio",
    "list-style-type","table-layout","border-collapse",
  ]

  const extractInlinedHTML = async () => {
    const iframe = previewIframeRef.current
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return
    const doc = iframe.contentDocument
    const win = iframe.contentWindow

    setExtracting(true)
    try {
      const vpH = win.innerHeight || 800
      // Hauteur totale scrollable du document — capture toute la page jusqu'en bas
      const pageH = doc.documentElement.scrollHeight || doc.body.scrollHeight || vpH * 20

      // ── 1. Identifier les éléments visibles dans toute la hauteur scrollable ──
      const allOrig = Array.from(doc.querySelectorAll("*")) as HTMLElement[]
      const visibleSet = new Set<Element>()

      allOrig.forEach((el) => {
        const cs = win.getComputedStyle(el)
        if (cs.display === "none") return
        if (cs.visibility === "hidden") return
        if (parseFloat(cs.opacity) < 0.01) return
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return
        // Positions absolues dans le document (indépendant du scroll courant de l'iframe)
        const scrollY = win.scrollY || win.pageYOffset || 0
        const absTop = rect.top + scrollY
        const absBottom = rect.bottom + scrollY
        if (absBottom < 0 || absTop > pageH) return
        let node: Element | null = el
        while (node && node !== doc.documentElement) {
          visibleSet.add(node)
          node = node.parentElement
        }
        visibleSet.add(doc.documentElement)
        if (doc.body) visibleSet.add(doc.body)
      })

      // ── 2. Styles par défaut du navigateur ────────────────────────────────
      const defaultEl = doc.createElement("span")
      doc.body.appendChild(defaultEl)
      const defaultCS = win.getComputedStyle(defaultEl)
      const defaultMap: Record<string, string> = {}
      VISUAL_PROPS.forEach(p => { defaultMap[p] = defaultCS.getPropertyValue(p) })
      doc.body.removeChild(defaultEl)

      // ── 3. Cloner et traiter chaque élément ───────────────────────────────
      const cloneDoc = document.implementation.createHTMLDocument("")
      cloneDoc.documentElement.innerHTML = doc.documentElement.innerHTML

      const origEls = Array.from(doc.querySelectorAll("*")) as HTMLElement[]
      const cloneEls = Array.from(cloneDoc.querySelectorAll("*")) as HTMLElement[]

      // Supprimer les éléments non-visibles et traiter les visibles
      const toRemove: Element[] = []
      origEls.forEach((orig, i) => {
        const cloneEl = cloneEls[i]
        if (!cloneEl) return

        // Supprimer si non visible
        if (!visibleSet.has(orig)) {
          toRemove.push(cloneEl)
          return
        }

        const tag = orig.tagName.toLowerCase()

        // Supprimer scripts, styles, links
        if (["script","noscript","link","template"].includes(tag)) {
          toRemove.push(cloneEl)
          return
        }
        if (tag === "style") { toRemove.push(cloneEl); return }

        // SVG : supprimer si décoratif et lourd
        if (tag === "svg") {
          const rect = orig.getBoundingClientRect()
          const isHeavy = orig.innerHTML.length > 3000
          const isDecorative = !orig.getAttribute("aria-label") && !orig.getAttribute("role")
          if (isHeavy && isDecorative) {
            // Remplacer par div placeholder de même taille
            const ph = cloneDoc.createElement("div")
            ph.style.cssText = `display:inline-block;width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;`
            cloneEl.replaceWith(ph)
            return
          }
          // SVG léger : nettoyer juste les defs lourds
          cloneEl.querySelectorAll("defs filter, defs mask").forEach(d => d.remove())
          return
        }

        // Supprimer attributs JS et data-*
        Array.from(cloneEl.attributes)
          .filter(a => a.name.startsWith("on") || a.name.startsWith("data-"))
          .forEach(a => cloneEl.removeAttribute(a.name))

        // ── Inline uniquement les props visuelles différentes du défaut ──
        const cs = win.getComputedStyle(orig)
        const inlined: string[] = []
        VISUAL_PROPS.forEach(prop => {
          const val = cs.getPropertyValue(prop)
          if (!val) return
          if (val === defaultMap[prop]) return
          if (val === "initial" || val === "unset" || val === "inherit") return
          if (val === "none" && !["display","visibility","outline"].includes(prop)) return
          inlined.push(`${prop}:${val}`)
        })
        if (inlined.length > 0) cloneEl.setAttribute("style", inlined.join(";"))
      })

      // Supprimer dans l'ordre inverse pour éviter les conflits
      toRemove.reverse().forEach(el => el.parentNode?.removeChild(el))

      // ── 4. Google Fonts uniquement ────────────────────────────────────────
      const googleFonts = Array.from(doc.querySelectorAll("link[href*='fonts.googleapis.com']"))
        .map(l => l.outerHTML).join("\n")

      // ── 4b. CSS globaux : règles ciblant les éléments de base ─────────────
      // Les computed styles inlinés ne capturent pas les règles comme
      // body { font-family: ... }, a { color: ... }, h1 { margin: ... } etc.
      // Le . permet de matcher aussi a.link-page, p.text-xl, h2.title, etc.
      const GLOBAL_SELECTOR_RE = /^(html|body|a|p|h[1-6]|ul|ol|li|aside|nav|header|footer|section|article|main|span|strong|em|button|input|textarea|select|figure|figcaption|blockquote|pre|code|table|thead|tbody|tr|td|th|img|svg|form|label)(\s*[,:{>\[~+.]|$)/i
      let globalCSS = ""
      try {
        Array.from(doc.styleSheets).forEach((sheet) => {
          try {
            Array.from(sheet.cssRules || []).forEach((rule) => {
              // Règle de style classique
              if (rule.type === 1 /* CSSStyleRule */) {
                const sr = rule as CSSStyleRule
                const sel = (sr.selectorText || "").trim()
                if (sel.split(",").some(s => GLOBAL_SELECTOR_RE.test(s.trim()))) {
                  globalCSS += sr.cssText + "\n"
                }
              }
              // @media : chercher règles globales à l'intérieur
              else if (rule.type === 4 /* CSSMediaRule */) {
                const mr = rule as CSSMediaRule
                let inner = ""
                Array.from(mr.cssRules || []).forEach((innerRule) => {
                  if (innerRule.type === 1) {
                    const sr = innerRule as CSSStyleRule
                    const sel = (sr.selectorText || "").trim()
                    if (sel.split(",").some(s => GLOBAL_SELECTOR_RE.test(s.trim()))) {
                      inner += "  " + sr.cssText + "\n"
                    }
                  }
                })
                if (inner) globalCSS += `@media ${mr.conditionText} {\n${inner}}\n`
              }
              // @font-face
              else if (rule.type === 5 /* CSSFontFaceRule */) {
                globalCSS += rule.cssText + "\n"
              }
            })
          } catch {} // cross-origin sheets → SecurityError ignoré
        })
      } catch {}

      // ── 5. Détection Tailwind ─────────────────────────────────────────────
      // Tailwind génère ses styles via CDN/purge, les computed styles ne suffisent pas.
      // On détecte via techGuesses OU via les class names présents dans le DOM.
      const usesTailwind = (result?.techGuesses ?? []).includes("Tailwind") ||
        Array.from(doc.querySelectorAll("[class]")).slice(0, 200).some((el) =>
          /(?:^|\s)(flex|grid|block|inline|hidden|text-\w|bg-\w|p-\d|m-\d|px-\d|py-\d|mx-\d|my-\d|w-\w|h-\w|border|rounded|font-\w|items-\w|justify-\w|gap-\d|space-\w|shadow|opacity-|z-\d)/.test((el as HTMLElement).className)
        )
      const tailwindTag = usesTailwind
        ? '<script src="https://cdn.tailwindcss.com"></script>'
        : ""

      // ── 6. Construire le document final ──────────────────────────────────
      // Nettoyer tout résidu de script qui pourrait s'afficher comme texte brut
      const bodyContent = (cloneDoc.body?.innerHTML || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${tailwindTag}
${googleFonts}
<style>*{box-sizing:border-box}body{margin:0}
${globalCSS}</style>
</head>
<body>${bodyContent}</body>
</html>`

      const sizeKb = Math.round(new Blob([finalHtml]).size / 1024)
      setExtractedHTML(finalHtml)
      setExtractedSize(sizeKb)
      setShowExtracted(true)
      setCopyStatus({ id: "static", message: `✅ ${sizeKb}KB — vérifie la preview` })
      setTimeout(() => setCopyStatus(null), 4000)
    } catch (e) {
      setCopyStatus({ id: "static", message: "Extraction failed ✗" })
      setTimeout(() => setCopyStatus(null), 3000)
    } finally {
      setExtracting(false)
    }
  }

  // ── Build & download the AI prompt using extracted static HTML ──────────────
  const handleDownloadStaticPrompt = async () => {
    const iframe = previewIframeRef.current
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return
    // Run the full extraction first (reuses the same pipeline)
    setExtracting(true)
    try {
      // We call extractInlinedHTML logic inline to get the HTML synchronously
      // then build the prompt from it — the state update (setExtractedHTML) still fires
      await extractInlinedHTML()
      // extractedHTML state will be set after extraction — use a one-shot effect
      // Actually we just trigger and wait: use a Promise wrapper
    } catch {}
    setExtracting(false)
  }

  // Prompt builder — called once extractedHTML is ready after download-prompt click
  const [pendingPromptDownload, setPendingPromptDownload] = useState(false)

  // Watch extractedHTML: if a prompt download is pending, fire it
  useEffect(() => {
    if (!pendingPromptDownload || !extractedHTML || !result) return
    setPendingPromptDownload(false)
    const siteName = result.title || result.baseURL || "this site"
    const fwLabels: Record<FrameworkKey, string> = {
      next: "Next.js (App Router, TypeScript, TSX)",
      remix: "Remix (TypeScript, TSX)",
      astro: "Astro (.astro components)",
      "vite-react": "Vite + React (JSX)",
      sveltekit: "SvelteKit (+page.svelte)",
      "vue-vite": "Vue 3 (Vite, SFC)",
      nuxt: "Nuxt 3 (pages/preview.vue)",
      html: "Plain HTML + CSS + JS (single file)",
    }
    const siteHost = (() => { try { return new URL(result.baseURL || "").hostname } catch { return result.baseURL || "" } })()
    const promptText = `Here is the complete HTML code with inlined CSS styles of the website "${siteName}".

Generate the entire page as a ${fwLabels[promptFw]} component. You will absolutely — without deviating from a single HTML tag, layout block, or listed style — reproduce this page in full without any errors, properly chaining all layouts and sections. Do not change anything: no colors, no text, no spacing, no structure, nothing whatsoever. Every element, every class, every style must be faithfully reproduced exactly as listed below.

IMPORTANT RULES:
- Do NOT generate any inline SVG for logos or icons. Instead, use the Google Favicon API to retrieve logos and favicons from their domain URL. Example: <img src="https://www.google.com/s2/favicons?domain=SITE_DOMAIN&sz=64" alt="logo" /> — replace SITE_DOMAIN with the actual domain of each logo/brand you encounter. For the main site logo use: https://www.google.com/s2/favicons?domain=${siteHost}&sz=64
- For any third-party brand logos found in the HTML (partner logos, customer logos, integration logos, etc.), apply the same Google Favicon API pattern using that brand's domain.
- Keep every other element, layout, color, and text exactly as listed.

\`\`\`html
${extractedHTML}
\`\`\``
    createDownloadLink(promptText, `prompt-${siteName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.txt`, "text/plain")
  }, [pendingPromptDownload, extractedHTML])

  const triggerPromptDownload = async () => {
    if (extractedHTML) {
      // Already extracted — build prompt immediately
      setPendingPromptDownload(true)
    } else {
      // Need to extract first — set flag, then trigger extraction
      setPendingPromptDownload(true)
      await extractInlinedHTML()
    }
  }

  const downloadExtracted = () => {
    if (!extractedHTML) return
    createDownloadLink(extractedHTML, "static-ui.html", "text/html")
  }
  const copyExtracted = () => {
    if (!extractedHTML) return
    copyToClipboard(extractedHTML, "static-copy")
  }

  // ── Skill handlers ─────────────────────────────────────────────────────────

  const selectSkill = (skill: Skill) => {
    setActiveSkill(skill)
    setActiveSubSkill(null)
    setShowSkillDropdown(false)
    setShowSubSkillDropdown(skill.type === "connector")
    setSkillSearch("")
    setSkillInput("")
    setSkillResult(null)
    setSkillError(null)
    setPdfImages([])
    setPdfObjectUrl(null)
    setSignatureMode(false)
    setSignatureDataUrl(null)
  }

  const selectSubSkill = (sub: SubSkill) => {
    setActiveSubSkill(sub)
    setShowSubSkillDropdown(false)
  }

  const clearSkill = () => {
    setActiveSkill(null)
    setActiveSubSkill(null)
    setSkillInput("")
    setSkillResult(null)
    setSkillError(null)
    setShowSkillDropdown(false)
    setShowSubSkillDropdown(false)
    setPdfImages([])
    setPdfObjectUrl(null)
    setSignatureMode(false)
    setSignatureDataUrl(null)
  }

  const handleMainInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (!activeSkill) {
      if (val === "/") {
        setShowSkillDropdown(true)
        setSkillSearch("")
      } else if (val.startsWith("/") && val.length > 1) {
        setShowSkillDropdown(true)
        setSkillSearch(val.slice(1))
      } else {
        setShowSkillDropdown(false)
        setUrl(val)
        if (!user && val.length === 1) setShowSignInModal(true)
      }
    } else {
      setSkillInput(val)
    }
  }

  const saveApiKey = () => {
    localStorage.setItem("gemini_api_key", apiKeyDraft)
    setGeminiApiKey(apiKeyDraft)
    setShowApiKeyInput(false)
  }

  const saveTavilyApiKey = () => {
    localStorage.setItem("tavily_api_key", tavilyKeyDraft)
    setTavilyApiKey(tavilyKeyDraft)
    setShowTavilyKeyInput(false)
  }

  // ── Nango Connect UI ───────────────────────────────────────────────────────
  const connectService = async (provider: string) => {
    if (!user) { setSkillError("❌ Connecte-toi d'abord à ton compte"); return }
    try {
      // 1. Obtenir un session token depuis notre backend
      const res = await fetch("/api/connector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session", provider, userId: user.uid }),
      })
      const { sessionToken, error } = await res.json()
      if (error) throw new Error(error)

      // 2. Ouvrir le Connect UI Nango
      const { default: Nango } = await import("@nangohq/frontend")
      const nango = new Nango()
      const connect = nango.openConnectUI({
        onEvent: (event: { type: string; payload?: { providerConfigKey?: string } }) => {
          if (event.type === "connect") {
            const group = provider === "drive" || provider === "calendar" ? "google" : provider
            setConnectorStatus(prev => ({ ...prev, [group]: true }))
          }
        },
      })
      connect.setSessionToken(sessionToken)
    } catch (err: unknown) {
      setSkillError(`❌ ${err instanceof Error ? err.message : "Erreur Nango"}`)
    }
  }

  // ── MCP connector skill via Nango proxy ────────────────────────────────────
  const runConnectorSkill = async (service: string, subSkillId: string, input: string) => {
    setSkillLoading(true); setSkillResult(null); setSkillError(null)
    try {
      if (!user) throw new Error("Connexion requise")
      if (!connectorStatus[service === "drive" || service === "calendar" ? "google" : service]) {
        throw new Error(`Connecte ton compte ${service} d'abord dans ≡ → Connecteurs`)
      }
      if (!geminiApiKey) throw new Error("Clé Gemini requise")

      const res = await fetch("/api/connector", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", service, intent: input, geminiKey: geminiApiKey, subSkillId, userId: user.uid }),
      })
      const data = await res.json()

      if (res.status === 401) {
        setConnectorStatus(prev => ({ ...prev, [service]: false }))
        throw new Error(`Session ${service} expirée — reconnecte dans ≡ → Connecteurs`)
      }
      if (!res.ok) throw new Error(data.error || `Erreur ${service}`)

      const text = typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2)
      setSkillResult(`✅ **${data.label ?? service}**\n\n${text}`)
    } catch (err: unknown) {
      setSkillError(`❌ ${err instanceof Error ? err.message : "Erreur connecteur"}`)
    } finally { setSkillLoading(false) }
  }

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext("2d"); if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
    setIsDrawing(true)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const canvas = signatureCanvasRef.current; if (!canvas) return
    const ctx = canvas.getContext("2d"); if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.strokeStyle = "#111"
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
  }

  const endDraw = () => {
    setIsDrawing(false)
    const canvas = signatureCanvasRef.current; if (!canvas) return
    setSignatureDataUrl(canvas.toDataURL())
  }

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current; if (!canvas) return
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
    setSignatureDataUrl(null)
  }

  const downloadSignature = () => {
    if (!signatureDataUrl) return
    const a = document.createElement("a")
    a.href = signatureDataUrl; a.download = "signature.png"
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  // ── Images → PDF ──────────────────────────────────────────────────────────
  const handleImagesToPdf = async (files: FileList) => {
    if (!files.length) return
    setSkillLoading(true)
    setSkillError(null)
    setPdfObjectUrl(null)
    try {
      const loaded: { name: string; dataUrl: string }[] = []
      for (const file of Array.from(files)) {
        await new Promise<void>((resolve) => {
          const reader = new FileReader()
          reader.onload = (e) => { loaded.push({ name: file.name, dataUrl: e.target?.result as string }); resolve() }
          reader.readAsDataURL(file)
        })
      }
      setPdfImages(loaded)

      // Use jsPDF via CDN
      const { jsPDF } = await import("jspdf" as any).catch(async () => {
        // fallback: load from CDN
        await new Promise<void>((res) => {
          const s = document.createElement("script")
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
          s.onload = () => res(); document.head.appendChild(s)
        })
        return { jsPDF: (window as any).jspdf.jsPDF }
      })

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const W = 210, H = 297

      for (let i = 0; i < loaded.length; i++) {
        if (i > 0) pdf.addPage()
        const img = new Image()
        img.src = loaded[i].dataUrl
        await new Promise<void>((res) => { img.onload = () => res() })
        const ratio = Math.min(W / img.width, H / img.height)
        const w = img.width * ratio, h = img.height * ratio
        const x = (W - w) / 2, y = (H - h) / 2
        pdf.addImage(loaded[i].dataUrl, "JPEG", x, y, w, h)
      }

      const blob = pdf.output("blob")
      const url = URL.createObjectURL(blob)
      setPdfObjectUrl(url)
      setSkillResult(`✅ PDF généré avec ${loaded.length} image${loaded.length > 1 ? "s" : ""}`)
    } catch {
      setSkillError("❌ Erreur lors de la génération du PDF")
    } finally {
      setSkillLoading(false)
    }
  }

  // ── Mechanical skills ─────────────────────────────────────────────────────
  const runMechanicalSkill = (skill: Skill, input: string): string => {
    if (skill.id === "compter") {
      const words = input.trim() === "" ? 0 : input.trim().split(/\s+/).length
      const chars = input.length
      const charsNoSpace = input.replace(/\s/g, "").length
      const paragraphs = input.trim() === "" ? 0 : input.trim().split(/\n\s*\n/).length
      const sentences = input.trim() === "" ? 0 : input.split(/[.!?]+/).filter(s => s.trim()).length
      return `📊 **Résultats**\n\n• Mots : **${words}**\n• Caractères (avec espaces) : **${chars}**\n• Caractères (sans espaces) : **${charsNoSpace}**\n• Phrases : **${sentences}**\n• Paragraphes : **${paragraphs}**`
    }
    if (skill.id === "password") {
      const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      const lower = "abcdefghijklmnopqrstuvwxyz"
      const digits = "0123456789"
      const special = "!@#$%^&*()-_=+[]{}|;:,.<>?"
      const all = upper + lower + digits + special
      let pwd = ""
      pwd += upper[Math.floor(Math.random() * upper.length)]
      pwd += lower[Math.floor(Math.random() * lower.length)]
      pwd += digits[Math.floor(Math.random() * digits.length)]
      pwd += special[Math.floor(Math.random() * special.length)]
      for (let i = 4; i < 16; i++) pwd += all[Math.floor(Math.random() * all.length)]
      pwd = pwd.split("").sort(() => Math.random() - 0.5).join("")
      return `🔐 **Mot de passe généré**\n\n\`${pwd}\`\n\n✅ 16 caractères · Majuscules · Chiffres · Symboles`
    }
    return ""
  }

  // ── AI skills ─────────────────────────────────────────────────────────────
  const runAiSkill = async (skill: Skill, input: string) => {
    if (!geminiApiKey) {
      setSkillError("⚠️ Clé API Gemini manquante. Configure-la dans le menu ≡ → Gemini API Key.")
      return
    }
    setSkillLoading(true); setSkillResult(null); setSkillError(null)
    try {
      const { GoogleGenAI } = await import("@google/genai")
      const ai = new GoogleGenAI({ apiKey: geminiApiKey })
      const prompts: Record<string, string> = {
        resume:     `Fais un résumé clair et concis en 3-5 phrases maximum :\n\n${input}`,
        reformuler: `Reformule ce texte de manière professionnelle et bien structurée, en conservant le sens original :\n\n${input}`,
        corriger:   `Corrige toutes les fautes d'orthographe et de grammaire dans ce texte. Montre le texte corrigé uniquement, suivi d'une liste des corrections effectuées :\n\n${input}`,
        traduire:   `Traduis le texte suivant. Si une langue cible est mentionnée après "|", utilise-la, sinon traduis en anglais :\n\n${input}`,
        cv:         `Génère un CV professionnel complet et bien structuré en texte, à partir de ces informations :\n\n${input}\n\nInclus : Résumé professionnel, Expériences, Compétences, Formation.`,
        emaildigest: `Tu es un assistant de productivité expert. Analyse ces emails et génère un rapport structuré :\n\n📬 **Résumé par thread**\n(groupe par expéditeur ou sujet, 2 lignes max chacun)\n\n⚡ **Actions urgentes aujourd'hui**\n(liste numérotée des tâches à faire impérativement)\n\n📅 **À traiter plus tard**\n(emails non urgents mais importants)\n\n🗑️ **Peut ignorer**\n(newsletters, notifications automatiques, spam)\n\nEmails à analyser :\n${input}`,
        postgen:    `Tu es un expert en copywriting viral et marketing digital.\n\n${input.toLowerCase().includes("linkedin") ? "Génère un post LinkedIn professionnel : storytelling, valeur ajoutée, 3-5 paragraphes courts, 5 hashtags, CTA final." : (input.toLowerCase().includes(" x ") || input.toLowerCase().includes("twitter") || input.toLowerCase().includes("tweet")) ? "Génère un thread X percutant : accroche < 280 chars, 5 tweets numérotés, 2-3 hashtags, CTA final." : "Génère **2 versions** :\n\n🔵 **LinkedIn** — storytelling, professionnel, 3-5 paragraphes, 5 hashtags\n🐦 **X (Twitter)** — thread de 5 tweets percutants, 2-3 hashtags"}\n\nRègle : accroche forte en 1ère ligne, emojis avec parcimonie, CTA à la fin.\n\nSujet / projet : ${input}`,
        codereview: `Tu es un senior developer avec 10 ans d'expérience. Effectue une code review complète.\n\n🐛 **Bugs et Erreurs**\n(problèmes qui cassent ou pourraient casser le code)\n\n🔒 **Sécurité**\n(injections, XSS, exposition de données, mauvaises pratiques)\n\n⚡ **Performance**\n(boucles inutiles, re-renders, requêtes N+1, optimisations)\n\n🧹 **Qualité et Maintenabilité**\n(nommage, DRY, complexité cyclomatique, découpage)\n\n✅ **Points positifs**\n(ce qui est bien fait)\n\n📝 **Code refactorisé**\n(version améliorée des parties critiques)\n\nCode à analyser :\n${input}`,
        invoice:    `Tu es un assistant de facturation professionnelle. Génère une facture complète et prête à envoyer.\n\nRègles : si des infos manquent, invente des données cohérentes. Applique TVA 20% sauf indication. Numéro format FAC-YYYYMMDD-001. Inclus conditions de paiement 30 jours nets. Calcule sous-total HT, TVA et total TTC.\n\nInformations fournies : ${input}\n\nGénère la facture complète maintenant.`,
      }
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompts[skill.id] || input,
      })
      setSkillResult(response.text ?? "")
    } catch (err: unknown) {
      setSkillError(`❌ Erreur Gemini : ${err instanceof Error ? err.message : "Erreur inconnue"}`)
    } finally {
      setSkillLoading(false)
    }
  }

  // ── Web Search via Tavily ──────────────────────────────────────────────────
  const runWebSearchSkill = async (query: string) => {
    if (!tavilyApiKey) {
      setSkillError("⚠️ Clé API Tavily manquante. Configure-la dans le menu ≡ → Tavily API Key.")
      return
    }
    setSkillLoading(true); setSkillResult(null); setSkillError(null)
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          search_depth: "basic",
          max_results: 6,
          include_answer: true,
          include_raw_content: false,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message || `HTTP ${res.status}`)
      }
      const data = await res.json()

      let output = ""
      if (data.answer) {
        output += `**Réponse directe**\n${data.answer}\n\n`
      }
      if (data.results?.length) {
        output += `**Sources**\n`
        data.results.forEach((r: { title: string; url: string; content?: string }, i: number) => {
          const snippet = r.content ? r.content.slice(0, 180).replace(/\n/g, " ") + "…" : ""
          output += `\n${i + 1}. **${r.title}**\n${r.url}\n${snippet}\n`
        })
      }
      setSkillResult(output || "Aucun résultat trouvé.")
    } catch (err: unknown) {
      setSkillError(`❌ Erreur Tavily : ${err instanceof Error ? err.message : "Erreur inconnue"}`)
    } finally {
      setSkillLoading(false)
    }
  }

  // ── SEO Analyser via Tavily + Gemini ─────────────────────────────────────
  const runSeoSkill = async (inputUrl: string) => {
    if (!tavilyApiKey) {
      setSkillError("⚠️ Clé API Tavily manquante. Configure-la dans ≡ → Tavily API Key.")
      return
    }
    if (!geminiApiKey) {
      setSkillError("⚠️ Clé API Gemini manquante. Configure-la dans ≡ → Gemini API Key.")
      return
    }
    setSkillLoading(true); setSkillResult(null); setSkillError(null)
    try {
      let siteUrl = inputUrl.trim()
      if (!/^https?:\/\//i.test(siteUrl)) siteUrl = "https://" + siteUrl
      const hostname = (() => { try { return new URL(siteUrl).hostname } catch { return siteUrl } })()

      // 1. Tavily — récupérer données & contexte du site
      const tavilyRes = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: `SEO analysis ${hostname} meta description keywords backlinks`,
          search_depth: "advanced",
          max_results: 5,
          include_answer: true,
          include_raw_content: false,
        }),
      })
      if (!tavilyRes.ok) throw new Error(`Tavily HTTP ${tavilyRes.status}`)
      const tavilyData = await tavilyRes.json()
      const tavilyContext = JSON.stringify(tavilyData).slice(0, 4000)

      // 2. Gemini — générer le rapport SEO
      const { GoogleGenAI } = await import("@google/genai")
      const ai = new GoogleGenAI({ apiKey: geminiApiKey })
      const seoPrompt = `Tu es un expert SEO senior. Analyse ce site : ${siteUrl}

Données récupérées (résultats de recherche, snippets, réponse Tavily) :
${tavilyContext}

Génère un rapport SEO complet et actionnable :

📊 **Score SEO estimé : XX/100**
(justifie le score en 1-2 lignes)

🏷️ **Meta & Structure**
• Title tag : qualité, longueur, mots-clés
• Meta description : présente/absente, accroche
• Open Graph / Twitter Card : présent/manquant
• Balises H1-H6 : structure logique ?

🔑 **Mots-clés principaux détectés**
(liste 6-8 mots-clés dominants sur ce domaine)

🔗 **Autorité & Liens**
• Backlinks estimés (fort/moyen/faible)
• Présence de liens internes structurés

📱 **UX & Technique**
• Mobile-friendly : indicateurs
• HTTPS : actif/manquant
• Vitesse perçue et recommandations Core Web Vitals

🎯 **Top 5 actions prioritaires** (classées par impact décroissant)
1. 
2. 
3. 
4. 
5. 

💡 **3 opportunités de contenu** — sujets à cibler pour ce domaine`

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: seoPrompt,
      })
      setSkillResult(response.text ?? "")
    } catch (err: unknown) {
      setSkillError(`❌ Erreur SEO : ${err instanceof Error ? err.message : "Erreur inconnue"}`)
    } finally {
      setSkillLoading(false)
    }
  }

  const runSkill = async () => {
    if (!activeSkill) return
    if (activeSkill.id === "img2pdf") {
      const input = document.createElement("input")
      input.type = "file"; input.accept = "image/*"; input.multiple = true
      input.onchange = (e) => { const files = (e.target as HTMLInputElement).files; if (files) handleImagesToPdf(files) }
      input.click(); return
    }
    if (activeSkill.id === "signer") { setSignatureMode(true); return }
    if (activeSkill.id === "seo") { await runSeoSkill(skillInput); return }
    if (activeSkill.id === "websearch") { await runWebSearchSkill(skillInput); return }
    if (activeSkill.type === "connector") {
      const serviceMap: Record<string, string> = {
        gmail: "gmail", drive: "drive", notion: "notion", trello: "trello",
      }
      const service = serviceMap[activeSkill.id]
      if (service) { await runConnectorSkill(service, activeSubSkill?.id ?? "", skillInput); return }
      setSkillResult(`🔗 **${activeSkill.label}** — intégration MCP à venir.`)
      return
    }
    if (activeSkill.type === "mechanical") {
      const res = runMechanicalSkill(activeSkill, skillInput)
      if (res) setSkillResult(res)
      return
    }
    await runAiSkill(activeSkill, skillInput)
  }

  const copySkillResult = () => { if (skillResult) navigator.clipboard.writeText(skillResult) }

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


        {/* Gemini API Key */}
        <div className="px-4 pb-3 border-b border-[#f0f0f0] flex-shrink-0">
          <button
            onClick={() => { setShowApiKeyInput(v => !v); setApiKeyDraft(geminiApiKey) }}
            className="w-full flex items-center justify-between py-2 text-xs text-gray-500 hover:text-black transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🔑</span>
              <span className="font-medium">Gemini API Key</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${geminiApiKey ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
              {geminiApiKey ? "✓ Configurée" : "Non configurée"}
            </span>
          </button>
          {showApiKeyInput && (
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={apiKeyDraft}
                onChange={e => setApiKeyDraft(e.target.value)}
                placeholder="AIza..."
                className="w-full h-9 rounded-lg border border-[#e5e5e5] px-3 text-xs text-black focus:outline-none focus:border-black"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveApiKey}
                  className="flex-1 h-8 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors font-medium"
                >
                  Sauvegarder
                </button>
                {geminiApiKey && (
                  <button
                    onClick={() => { localStorage.removeItem("gemini_api_key"); setGeminiApiKey(""); setShowApiKeyInput(false) }}
                    className="h-8 px-3 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg transition-colors"
                  >
                    Supprimer
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Clé stockée localement sur ton appareil. Obtiens-la sur{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-black underline">
                  aistudio.google.com
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Tavily API Key */}
        <div className="px-4 pb-3 border-b border-[#f0f0f0] flex-shrink-0">
          <button
            onClick={() => { setShowTavilyKeyInput(v => !v); setTavilyKeyDraft(tavilyApiKey) }}
            className="w-full flex items-center justify-between py-2 text-xs text-gray-500 hover:text-black transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🔍</span>
              <span className="font-medium">Tavily API Key</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${tavilyApiKey ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
              {tavilyApiKey ? "✓ Configurée" : "Non configurée"}
            </span>
          </button>
          {showTavilyKeyInput && (
            <div className="mt-2 space-y-2">
              <input
                type="password"
                value={tavilyKeyDraft}
                onChange={e => setTavilyKeyDraft(e.target.value)}
                placeholder="tvly-..."
                className="w-full h-9 rounded-lg border border-[#e5e5e5] px-3 text-xs text-black focus:outline-none focus:border-black"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { saveTavilyApiKey(); setShowTavilyKeyInput(false) }}
                  className="flex-1 h-8 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors font-medium"
                >
                  Sauvegarder
                </button>
                {tavilyApiKey && (
                  <button
                    onClick={() => { localStorage.removeItem("tavily_api_key"); setTavilyApiKey(""); setShowTavilyKeyInput(false) }}
                    className="h-8 px-3 text-xs text-red-500 hover:text-red-700 border border-red-200 rounded-lg transition-colors"
                  >
                    Supprimer
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Clé pour la recherche web en temps réel. Obtiens-la sur{" "}
                <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-black underline">
                  tavily.com
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Connectors config */}
        <div className="px-4 pb-3 border-b border-[#f0f0f0] flex-shrink-0">
          <button
            onClick={() => setShowConnectorConfig(v => !v)}
            className="w-full flex items-center justify-between py-2 text-xs text-gray-500 hover:text-black transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="text-base">🔗</span>
              <span className="font-medium">Connecteurs</span>
            </span>
            <span className="flex items-center gap-2">
              {Object.values(connectorStatus).some(Boolean) && (
                <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
                  {Object.values(connectorStatus).filter(Boolean).length} actif{Object.values(connectorStatus).filter(Boolean).length > 1 ? "s" : ""}
                </span>
              )}
              <span className="text-[10px] text-gray-400">{showConnectorConfig ? "▲" : "▼"}</span>
            </span>
          </button>

          {showConnectorConfig && (
            <div className="mt-2 space-y-2">

              {/* Google — Gmail + Drive */}
              <div className="rounded-xl border border-[#eee] p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <img src="https://www.google.com/s2/favicons?domain=google.com&sz=24" alt="" className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-black">Google</p>
                    <p className="text-[10px] text-gray-400 truncate">Gmail · Drive · Calendar</p>
                  </div>
                </div>
                {connectorStatus.google ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] px-2 py-1 bg-green-100 text-green-600 rounded-full whitespace-nowrap">✓ Connecté</span>
                    <button onClick={() => connectService("google")} className="text-[10px] text-gray-400 hover:text-black">↺</button>
                  </div>
                ) : (
                  <button onClick={() => connectService("google")} className="flex-shrink-0 text-[11px] px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium whitespace-nowrap">
                    Connecter
                  </button>
                )}
              </div>

              {/* Notion */}
              <div className="rounded-xl border border-[#eee] p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <img src="https://www.google.com/s2/favicons?domain=notion.so&sz=24" alt="" className="w-5 h-5 flex-shrink-0 rounded-sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-black">Notion</p>
                    <p className="text-[10px] text-gray-400 truncate">Pages · Tâches · Bases</p>
                  </div>
                </div>
                {connectorStatus.notion ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] px-2 py-1 bg-green-100 text-green-600 rounded-full whitespace-nowrap">✓ Connecté</span>
                    <button onClick={() => connectService("notion")} className="text-[10px] text-gray-400 hover:text-black">↺</button>
                  </div>
                ) : (
                  <button onClick={() => connectService("notion")} className="flex-shrink-0 text-[11px] px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium whitespace-nowrap">
                    Connecter
                  </button>
                )}
              </div>

              {/* Trello */}
              <div className="rounded-xl border border-[#eee] p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <img src="https://www.google.com/s2/favicons?domain=trello.com&sz=24" alt="" className="w-5 h-5 flex-shrink-0 rounded-sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-black">Trello</p>
                    <p className="text-[10px] text-gray-400 truncate">Cartes · Listes · Boards</p>
                  </div>
                </div>
                {connectorStatus.trello ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] px-2 py-1 bg-green-100 text-green-600 rounded-full whitespace-nowrap">✓ Connecté</span>
                    <button onClick={() => connectService("trello")} className="text-[10px] text-gray-400 hover:text-black">↺</button>
                  </div>
                ) : (
                  <button onClick={() => connectService("trello")} className="flex-shrink-0 text-[11px] px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium whitespace-nowrap">
                    Connecter
                  </button>
                )}
              </div>

              <p className="text-[10px] text-gray-400 pt-1 leading-relaxed">
                Variables requises dans <code className="bg-gray-100 px-1 rounded">.env.local</code> — voir <code className="bg-gray-100 px-1 rounded">.env.example</code>
              </p>
            </div>
          )}
        </div>

        {/* Trial / subscription banner */}
        {user && (
          <div className="p-4 border-t border-[#f0f0f0] flex-shrink-0">
            {trialExpired ? (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center">
                <p className="text-xs font-semibold text-red-700 mb-1">Trial expired</p>
                <p className="text-[11px] text-red-500 mb-2">Subscribe to keep analysing sites.</p>
                <div className="inline-flex items-center gap-1 bg-[#003087] text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg">
                  <span>PayPal</span>
                  <span className="opacity-80">·</span>
                  <span>$1.99 / month</span>
                </div>
                <p className="text-[10px] text-red-400 mt-1.5">Subscription page coming soon</p>
              </div>
            ) : trialDaysLeft !== null ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-amber-700">Free trial</p>
                  <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                    {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left
                  </span>
                </div>
                <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all"
                    style={{ width: `${(trialDaysLeft / 5) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-amber-600">
                  After trial: <span className="font-semibold">$1.99 / month</span> via PayPal
                </p>
              </div>
            ) : null}
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

        <div className={`max-w-4xl mx-auto ${result ? "pb-24" : "pb-36"}`}>

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
          <div className="w-full max-w-[480px] mx-auto mb-4 px-2 relative">

            {/* Sub-skill dropdown (connectors) */}
            {showSubSkillDropdown && activeSkill?.subSkills && (
              <div className="absolute top-full left-2 right-2 mt-2 bg-white rounded-[14px] border border-orange-100 shadow-xl overflow-hidden z-20">
                <div className="px-3 pt-3 pb-1 flex items-center gap-2">
                  {activeSkill.domain && (
                    <img src={`https://www.google.com/s2/favicons?domain=${activeSkill.domain}&sz=16`} alt="" className="w-4 h-4 rounded-sm" />
                  )}
                  <p className="text-[10px] text-orange-400 uppercase tracking-widest font-medium">
                    {activeSkill.label} — Que veux-tu faire ?
                  </p>
                </div>
                {activeSkill.subSkills.map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => selectSubSkill(sub)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-black">{sub.label}</p>
                      <p className="text-xs text-gray-400">{sub.description}</p>
                    </div>
                    <ArrowUp size={14} className="text-orange-400 rotate-90 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Skill dropdown */}
            {showSkillDropdown && (
              <div className="absolute top-full left-2 right-2 mt-2 bg-white rounded-[14px] border border-[#eee] shadow-xl overflow-hidden z-20">
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Skills disponibles</p>
                </div>
                {SKILLS.filter(s =>
                  skillSearch === "" ||
                  s.label.toLowerCase().includes(skillSearch.toLowerCase()) ||
                  s.description.toLowerCase().includes(skillSearch.toLowerCase())
                ).map(skill => (
                  <button
                    key={skill.id}
                    onClick={() => selectSkill(skill)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {skill.type === "connector" && skill.domain ? (
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${skill.domain}&sz=32`}
                        alt={skill.label}
                        className="w-5 h-5 rounded-sm flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                      />
                    ) : (
                      <span className="text-xl flex-shrink-0">{skill.icon}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-black">{skill.label}</p>
                      <p className="text-xs text-gray-400 truncate">{skill.description}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${
                      skill.type === "ai" ? "bg-purple-100 text-purple-600" :
                      skill.type === "connector" ? "bg-orange-100 text-orange-600" :
                      "bg-blue-100 text-blue-600"
                    }`}>
                      {skill.type === "ai" ? "✨ IA" : skill.type === "connector" ? "🔗 Connect" : "⚙️ Auto"}
                    </span>
                  </button>
                ))}
                {SKILLS.filter(s =>
                  skillSearch === "" ||
                  s.label.toLowerCase().includes(skillSearch.toLowerCase()) ||
                  s.description.toLowerCase().includes(skillSearch.toLowerCase())
                ).length === 0 && (
                  <p className="text-xs text-gray-400 px-4 py-3 text-center">Aucun skill trouvé pour &quot;{skillSearch}&quot;</p>
                )}
                <div className="px-4 py-2 border-t border-[#f5f5f5]">
                  <p className="text-[10px] text-gray-300">Tape / puis le nom pour filtrer</p>
                </div>
              </div>
            )}

            <div className={`w-full ring-2 ring-[#eee] rounded-[14px] flex items-start p-1 ${activeSkill ? "min-h-[48px]" : "h-[48px]"}`}>
              <div className={`w-full bg-white ring-2 ring-[#FAFAFA] rounded-[12px] flex items-start px-2 gap-1.5 ${activeSkill ? "py-2 flex-wrap" : "h-full items-center"}`}>

                {/* Globe icon (no active skill) */}
                {!activeSkill && <Globe size={18} className="text-gray-400 flex-shrink-0" />}

                {/* Skill pill */}
                {activeSkill && (
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
                      activeSkill.type === "ai" ? "bg-purple-100 text-purple-700" :
                      activeSkill.type === "connector" ? "bg-orange-100 text-orange-700" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {activeSkill.type === "connector" && activeSkill.domain ? (
                        <img src={`https://www.google.com/s2/favicons?domain=${activeSkill.domain}&sz=16`} alt="" className="w-3.5 h-3.5 rounded-sm" />
                      ) : (
                        <span>{activeSkill.icon}</span>
                      )}
                      {activeSkill.label}
                      <button onClick={clearSkill} className="ml-0.5 hover:opacity-60 transition-opacity text-base leading-none">×</button>
                    </span>
                    {/* Sub-skill pill */}
                    {activeSubSkill && (
                      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-600 border border-orange-200 font-medium">
                        {activeSubSkill.label}
                        <button onClick={() => setActiveSubSkill(null)} className="hover:opacity-60 text-base leading-none">×</button>
                      </span>
                    )}
                  </div>
                )}

                {/* Main input */}
                <input
                  type="text"
                  placeholder={activeSkill ? activeSkill.placeholder : "https://example.com ou tapez /skill"}
                  value={activeSkill ? skillInput : (showSkillDropdown ? "/" + skillSearch : url)}
                  onChange={handleMainInputChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (activeSkill) { runSkill(); return }
                      if (showSkillDropdown) return
                      handleAnalyzeClick()
                    }
                    if (e.key === "Escape") { clearSkill(); setShowSkillDropdown(false) }
                  }}
                  className="flex-1 min-w-0 bg-transparent text-black focus:outline-none placeholder-[#aaa] text-sm py-1"
                />

                {/* Submit button */}
                <button
                  onClick={activeSkill ? runSkill : handleAnalyzeClick}
                  disabled={(activeSkill ? skillLoading : loading) || (!activeSkill && (!user || trialExpired))}
                  className="h-[36px] w-[36px] flex-shrink-0 bg-[#111] rounded-[9px] flex items-center justify-center transition-opacity disabled:opacity-40 disabled:cursor-not-allowed self-start mt-0.5"
                >
                  {(activeSkill ? skillLoading : loading) ? (
                    <div className="bg-white rounded-[4px] w-3.5 h-3.5 animate-pulse" />
                  ) : (
                    <ArrowUp size={17} className="text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Trial expired banner */}
          {!authLoading && user && trialExpired && (
            <p className="text-center text-xs text-red-500 mt-2 mb-4">
              Your trial has expired — subscribe to continue ($1.99/month via PayPal).
            </p>
          )}

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
                {suggestions.map((s) => {
                  const previewHtml = suggestionPreviews[s.id]
                  return (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestionClick(s)}
                    className="group relative h-[180px] sm:h-[220px] rounded-[12px] border border-[#eee] overflow-hidden bg-[#FAFAFA] cursor-pointer hover:shadow-md transition-shadow"
                  >
                    {/* Scaled iframe preview or skeleton */}
                    <div className="w-full h-full overflow-hidden pointer-events-none relative">
                      {previewHtml ? (
                        <iframe
                          srcDoc={previewHtml}
                          sandbox="allow-scripts"
                          className="border-0"
                          style={{
                            position: "absolute", top: 0, left: 0,
                            width: "1280px", height: "900px",
                            // scale dynamique : card ~300px sur desktop, ~(50vw-16px) sur mobile
                            transform: `scale(${typeof window !== "undefined" ? Math.min(0.25, (window.innerWidth / 2 - 20) / 1280) : 0.18})`,
                            transformOrigin: "top left",
                          }}
                          title={s.url}
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#f5f5f5] to-[#ebebeb] animate-pulse flex items-center justify-center">
                          <img src={s.faviconUrl || faviconUrl(s.url)} alt="" className="w-8 h-8 rounded-lg opacity-30" />
                        </div>
                      )}
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
                  )
                })}
              </div>
            </div>
          )}

          {error && <p className="text-red-600 bg-red-50 p-3 rounded-lg text-center mb-6 text-sm">{error}</p>}

          {/* ── Skill Result ── */}
          {(skillResult || skillError || skillLoading || signatureMode || pdfObjectUrl) && activeSkill && (
            <div className="w-full max-w-[480px] mx-auto mb-6 px-2">
              <div className="rounded-[14px] border border-[#eee] overflow-hidden bg-white">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#f5f5f5] bg-[#FAFAFA]">
                  <div className="flex items-center gap-2">
                    {activeSkill.type === "connector" && activeSkill.domain ? (
                      <img src={`https://www.google.com/s2/favicons?domain=${activeSkill.domain}&sz=16`} alt="" className="w-4 h-4 rounded-sm" />
                    ) : (
                      <span className="text-base">{activeSkill.icon}</span>
                    )}
                    <span className="text-sm font-semibold text-black">{activeSkill.label}</span>
                    {activeSubSkill && <span className="text-xs text-gray-400">· {activeSubSkill.label}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {pdfObjectUrl && (
                      <a href={pdfObjectUrl} download="images.pdf"
                        className="flex items-center gap-1.5 text-xs text-white bg-black px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors">
                        <Download size={12} /> Télécharger PDF
                      </a>
                    )}
                    {skillResult && activeSkill?.id === "invoice" && (
                      <button
                        onClick={() => createDownloadLink(skillResult, `facture-${Date.now()}.txt`, "text/plain")}
                        className="flex items-center gap-1.5 text-xs text-white bg-black px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        <Download size={12} /> Télécharger
                      </button>
                    )}
                    {signatureDataUrl && (
                      <button onClick={downloadSignature}
                        className="flex items-center gap-1.5 text-xs text-white bg-black px-3 py-1 rounded-lg hover:bg-gray-800">
                        <Download size={12} /> Sauvegarder
                      </button>
                    )}
                    {skillResult && !signatureMode && !pdfObjectUrl && (
                      <button onClick={copySkillResult}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-black px-2 py-1 rounded-lg hover:bg-gray-100">
                        <Copy size={12} /> Copier
                      </button>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="px-4 py-4">
                  {skillLoading && (
                    <div className="flex items-center gap-3 text-sm text-gray-400">
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-black rounded-full animate-spin flex-shrink-0" />
                      {activeSkill.id === "img2pdf" ? "Génération du PDF…" : activeSkill.id === "seo" ? "Analyse SEO en cours (Tavily + Gemini)…" : activeSkill.id === "emaildigest" ? "Analyse des emails en cours…" : activeSkill.id === "codereview" ? "Code review en cours…" : activeSkill.id === "invoice" ? "Génération de la facture…" : activeSkill.id === "postgen" ? "Création du post en cours…" : "Gemini réfléchit…"}
                    </div>
                  )}
                  {skillError && <p className="text-sm text-red-500">{skillError}</p>}

                  {/* Signature canvas */}
                  {signatureMode && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-400">Dessine ta signature ci-dessous avec la souris ou le doigt</p>
                      <canvas
                        ref={signatureCanvasRef}
                        width={380} height={160}
                        className="w-full border border-[#eee] rounded-xl bg-white cursor-crosshair touch-none"
                        style={{ touchAction: "none" }}
                        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                      />
                      <div className="flex gap-2">
                        <button onClick={clearSignature}
                          className="flex-1 h-9 text-xs border border-[#eee] rounded-lg text-gray-500 hover:bg-gray-50">
                          Effacer
                        </button>
                        <button onClick={downloadSignature} disabled={!signatureDataUrl}
                          className="flex-1 h-9 text-xs bg-black text-white rounded-lg disabled:opacity-40 hover:bg-gray-800 flex items-center justify-center gap-1.5">
                          <Download size={12} /> Télécharger PNG
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PDF preview */}
                  {pdfObjectUrl && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {pdfImages.map((img, i) => (
                          <img key={i} src={img.dataUrl} alt={img.name}
                            className="w-16 h-16 object-cover rounded-lg border border-[#eee]" />
                        ))}
                      </div>
                      <iframe src={pdfObjectUrl} className="w-full h-[320px] rounded-xl border border-[#eee]" title="PDF preview" />
                    </div>
                  )}

                  {/* Text result */}
                  {skillResult && !skillLoading && !signatureMode && !pdfObjectUrl && (
                    <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {skillResult.split(/\*\*(.*?)\*\*/g).map((part, i) =>
                        i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
                      )}
                    </div>
                  )}
                  {skillResult && pdfObjectUrl && (
                    <p className="text-xs text-green-600 mt-2">{skillResult}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── UI Preview ── */}
          {result && (
            <div>
              <h3 className="text-xl font-bold text-black mb-3">UI preview</h3>
              {/* 
                Wrapper maintient le ratio 1280:800 = 8:5.
                L'iframe (1280×800) est scalée pour remplir exactement le wrapper.
                Pas de JS, pas d'espace blanc : le ratio CSS gère tout.
              */}
              <div
                className="w-full rounded-xl border border-gray-200 overflow-hidden bg-white relative"
                style={{ aspectRatio: "1280 / 800" }}
                ref={(wrap) => {
                  if (!wrap) return
                  // Calcul immédiat — évite le flash à scale=1 (espace blanc)
                  const applyScale = () => {
                    const scale = wrap.getBoundingClientRect().width / 1280
                    const iframe = wrap.querySelector("iframe") as HTMLIFrameElement | null
                    if (iframe) iframe.style.transform = `scale(${scale})`
                  }
                  applyScale()
                  const ro = new ResizeObserver(applyScale)
                  ro.observe(wrap)
                }}
              >
                <iframe
                  ref={previewIframeRef}
                  title="UI preview"
                  srcDoc={previewDoc}
                  sandbox="allow-scripts allow-same-origin"
                  style={{
                    position: "absolute",
                    top: 0, left: 0,
                    width: 1280,
                    height: 800,
                    border: "none",
                    transformOrigin: "top left",
                    transform: `scale(${typeof window !== "undefined" ? Math.min(1, (window.innerWidth - 32) / 1280) : 0.35})`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Static iframe — hidden, keeps state for prompt generation */}
          {isAdmin && showExtracted && extractedHTML && (
            <div style={{ display: "none" }} aria-hidden="true">
              <iframe srcDoc={extractedHTML} sandbox="allow-scripts" title="Static HTML (hidden)" style={{ width: 1, height: 1, border: "none" }} />
            </div>
          )}

        </div>
      </div>

      {/* ── Bottom action bar ── */}
      {result && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-[#eee] px-4 py-3 z-30">
          <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto no-scrollbar">

            {/* Framework selector */}
            <select
              value={promptFw}
              onChange={(e) => setPromptFw(e.target.value as FrameworkKey)}
              className="flex-shrink-0 h-[36px] rounded-[10px] border border-[#e5e5e5] bg-white text-sm text-black px-2 focus:outline-none cursor-pointer"
            >
              {Object.entries(frameworkLabel).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            {/* Download Prompt — extracts static HTML then builds the AI prompt */}
            <button
              onClick={triggerPromptDownload}
              disabled={extracting}
              className="flex-shrink-0 flex items-center gap-1.5 h-[36px] px-4 rounded-[10px] border border-[#111] bg-[#111] text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              title="Extracts the full inlined HTML and builds an AI prompt to reproduce this site"
            >
              {extracting ? (
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Download size={14} />
              )}
              <span>{extracting ? "Extracting…" : "Download Prompt"}</span>
            </button>

            {/* Download static HTML — admin only */}
            {isAdmin && (
              <button
                onClick={() => extractedHTML ? downloadExtracted() : extractInlinedHTML().then(downloadExtracted)}
                disabled={extracting}
                className="flex-shrink-0 flex items-center gap-1.5 h-[36px] px-3 rounded-[10px] border border-[#e5e5e5] bg-white text-sm font-medium text-black hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title="[Admin] Download the extracted static HTML file"
              >
                <Download size={14} />
                <span className="hidden sm:inline">HTML</span>
              </button>
            )}

            {copyStatus && (
              <span className={`flex-shrink-0 text-xs px-2 py-1 rounded-md whitespace-nowrap ${
                copyStatus.message.includes("✅") ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"
              }`}>{copyStatus.message}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Sign-in modal (shown when unauthenticated user starts typing) ── */}
      {showSignInModal && !user && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSignInModal(false)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center mx-auto mb-4">
              <Globe size={22} className="text-white" />
            </div>
            <h2 className="text-lg font-bold text-black mb-1">Sign in to analyse</h2>
            <p className="text-sm text-gray-500 mb-5">Create a free account to get 5 days of full access, then $1.99/month.</p>
            <button
              onClick={() => { handleSignIn(); setShowSignInModal(false) }}
              className="w-full flex items-center justify-center gap-2 h-11 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors mb-3"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </button>
            <button onClick={() => setShowSignInModal(false)} className="text-xs text-gray-400 hover:text-black transition-colors">
              Maybe later
            </button>
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
