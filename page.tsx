"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Globe, ArrowUp, Copy, Download } from 'lucide-react'
import { motion, useReducedMotion } from "framer-motion"
import { Bodoni_Moda } from 'next/font/google'

// ── Inline UI components (no external shadcn needed) ──────────────────────────

const Button = ({ children, onClick, disabled, variant = "default", className = "" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "default"|"ghost"|"outline"|"secondary"; className?: string
}) => {
  const base = "inline-flex items-center justify-center text-sm font-medium rounded-md transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2"
  const variants: Record<string, string> = {
    default: "bg-black text-white hover:bg-gray-800",
    ghost: "bg-transparent hover:bg-gray-100 text-black",
    outline: "border border-gray-300 bg-white hover:bg-gray-50 text-black",
    secondary: "bg-gray-100 text-black hover:bg-gray-200",
  }
  return <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>{children}</button>
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

const Avatar = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`relative flex shrink-0 overflow-hidden rounded-full ${className}`}>{children}</div>
)
const AvatarFallback = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full w-full items-center justify-center rounded-full bg-gray-200 text-xs font-medium">{children}</div>
)

const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false)
  return <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
    {React.Children.map(children, (child: any) => child?.type?.displayName === "Trigger"
      ? React.cloneElement(child, { onClick: () => setOpen(o => !o) })
      : child?.type?.displayName === "Content"
        ? open ? React.cloneElement(child, { onClose: () => setOpen(false) }) : null
        : child
    )}
  </div>
}
const DropdownMenuTrigger = ({ children, asChild, onClick }: { children: React.ReactNode; asChild?: boolean; onClick?: () => void }) => {
  const child = children as React.ReactElement<any>
  return React.cloneElement(child, { onClick })
}
DropdownMenuTrigger.displayName = "Trigger"
const DropdownMenuContent = ({ children, align = "end", onClose }: { children: React.ReactNode; align?: string; onClose?: () => void }) => (
  <div className={`absolute ${align === "end" ? "right-0" : "left-0"} top-full mt-1 z-50 min-w-[8rem] bg-white rounded-lg shadow-lg border border-gray-200 py-1`} onClick={onClose}>
    {children}
  </div>
)
DropdownMenuContent.displayName = "Content"
const DropdownMenuItem = ({ children, onClick, className = "" }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
  <div onClick={onClick} className={`flex items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer ${className}`}>{children}</div>
)

const bodoni = Bodoni_Moda({ subsets: ["latin"], display: "swap" })

type AnimationFile = {
  url: string
  content: string
  type: "css" | "js"
  isAnimation: boolean
  library?: string
  confidence: number
}

type Result = {
  title: string
  description: string
  techGuesses: string[]
  internalLinks: number
  externalLinks: number
  images: string[]
  stylesheets: number
  openGraphTags: number
  fullHTML: string
  fullCSS: string
  fullJS: string
  baseURL: string
  animationFiles: AnimationFile[]
  requiredCdnUrls: string[]
}

const ResultItem = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex justify-between items-center py-4 border-b border-gray-800/50">
    <p className="text-gray-400">{label}</p>
    <p className="text-[#e4e4e4] text-right font-medium truncate pl-4">{value}</p>
  </div>
)

// Circular rotating text
function CircularText({ size = 140 }: { size?: number }) {
  const prefersReduced = useReducedMotion()
  const radius = size / 2 - 8
  const text = " STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO • STUDIO •"
  return (
    <div className="mx-auto mb-6 flex items-center justify-center">
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="text-black"
        aria-hidden="true"
        animate={prefersReduced ? undefined : { rotate: 360 }}
        transition={prefersReduced ? undefined : { repeat: Number.POSITIVE_INFINITY, duration: 14, ease: "linear" }}
        style={{ willChange: "transform" }}
      >
        <defs>
          <path
            id="circlePath"
            d={`M ${size / 2},${size / 2} m -${radius},0 a ${radius},${radius} 0 1,1 ${radius * 2},0 a ${radius},${radius} 0 1,1 -${radius * 2},0`}
          />
        </defs>
        <text fill="currentColor" fontSize="12" letterSpacing="2" className={`${bodoni.className} tracking-widest`}>
          <textPath href="#circlePath">{text}</textPath>
        </text>
      </motion.svg>
    </div>
  )
}

// Logo marquee
function LogoMarquee() {
  const prefersReduced = useReducedMotion()
  const logos = [
    "/images/logos/windsurf-text.svg",
    "/images/logos/v0.svg",
    "/images/logos/trae-text.svg",
    "/images/logos/replit-text.svg",
    "/images/logos/cursor-text.svg",
  ]
  const repeated = [...logos, ...logos, ...logos]
  return (
    <div className="relative my-10">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent" />
      <div className="overflow-hidden">
        <motion.div
          className="flex gap-10 items-center"
          animate={prefersReduced ? undefined : { x: ["0%", "-50%"] }}
          transition={prefersReduced ? undefined : { duration: 30, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          style={{ willChange: "transform" }}
        >
          {[...repeated, ...repeated].map((src, idx) => (
            <img
              key={`${src}-${idx}`}
              src={src || "/placeholder.svg"}
              alt="logo"
              className="h-6 sm:h-8 object-contain"
            />
          ))}
        </motion.div>
      </div>
    </div>
  )
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

export default function SiteInspector() {

  // Auth/subscription removed - always open access











  // UI and analyzer state
  const [url, setUrl] = useState("")
  const [result, setResult] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<{ id: string; message: string } | null>(null)

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false)
  const [selectedFramework, setSelectedFramework] = useState<FrameworkKey>("next")
  const [generatedFilename, setGeneratedFilename] = useState<string>("")
  const [generatedCode, setGeneratedCode] = useState<string>("")
  const [showCodePreview, setShowCodePreview] = useState<boolean>(false)

  // Demo urls and cards
  const proposalUrls = ["cosmos.so", "stripe.com", "linear.app"]
  const proposalUrlImages: Record<string, string> = {
    "cosmos.so":
      "https://fra.cloud.appwrite.io/v1/storage/buckets/68968fe8001266b9f411/files/68969cd6000b7adb25e0/view?project=68802a5d00297352e520&mode=admin",
    "stripe.com":
      "https://fra.cloud.appwrite.io/v1/storage/buckets/68968fe8001266b9f411/files/68969d45000bcf13ad68/view?project=68802a5d00297352e520&mode=admin",
    "linear.app":
      "https://fra.cloud.appwrite.io/v1/storage/buckets/68968fe8001266b9f411/files/68969d55000989225796/view?project=68802a5d00297352e520&mode=admin",
  }

  const createDownloadLink = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus({ id, message: "Copied! ✅" })
      setTimeout(() => setCopyStatus(null), 2000)
    } catch {
      setCopyStatus({ id, message: "Copy Failed ⌐" })
      setTimeout(() => setCopyStatus(null), 2000)
    }
  }

  const getLibraryCDN = (library: string): string[] => {
    const cdnMap: { [key: string]: string[] } = {
      GSAP: [
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/TextPlugin.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/MotionPathPlugin.min.js",
      ],
      "Three.js": [
        "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/dat-gui/0.7.9/dat.gui.min.js",
      ],
      Lottie: ["https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"],
      AOS: [
        "https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.js",
        "https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.css",
      ],
      "Anime.js": ["https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"],
      "Locomotive Scroll": [
        "https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.js",
        "https://cdn.jsdelivr.net/npm/locomotive-scroll@4.1.4/dist/locomotive-scroll.min.css",
      ],
      "Barba.js": ["https://cdnjs.cloudflare.com/ajax/libs/barba.js/1.0.0/barba.min.js"],
      ScrollMagic: [
        "https://cdnjs.cloudflare.com/ajax/libs/ScrollMagic/2.0.8/ScrollMagic.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/ScrollMagic/2.0.8/plugins/animation.gsap.min.js",
      ],
      "Velocity.js": ["https://cdnjs.cloudflare.com/ajax/libs/velocity/2.0.6/velocity.min.js"],
      Swiper: [
        "https://cdn.jsdelivr.net/npm/swiper@8/swiper-bundle.min.js",
        "https://cdn.jsdelivr.net/npm/swiper@8/swiper-bundle.min.css",
      ],
      Particles: ["https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js"],
    }
    return cdnMap[library] || []
  }

  const detectAnimationLibrary = (
    url: string,
    content: string,
  ): { isAnimation: boolean; library?: string; confidence: number } => {
    const urlLower = url.toLowerCase()
    const contentLower = content.toLowerCase()

    const blacklist = [
      "googletagmanager",
      "google-analytics",
      "gtag",
      "facebook.net",
      "doubleclick",
      "adsystem",
      "googlesyndication",
      "hotjar",
      "intercom",
      "zendesk",
      "crisp.chat",
      "tawk.to",
    ]
    if (blacklist.some((item) => urlLower.includes(item))) {
      return { isAnimation: false, confidence: 0 }
    }

    const libraries = [
      {
        name: "GSAP",
        patterns: [
          { pattern: /gsap\.registerPlugin|gsap\.timeline|gsap\.to|gsap\.from/gi, weight: 95 },
          { pattern: /greensock|tweenmax|tweenlite|timelinemax/gi, weight: 90 },
          { pattern: /scrolltrigger|motionpath|drawsvg/gi, weight: 85 },
          { pattern: /gsap/gi, weight: 70 },
        ],
      },
      {
        name: "Three.js",
        patterns: [
          { pattern: /new THREE\.|THREE\.Scene|THREE\.WebGLRenderer/gi, weight: 95 },
          { pattern: /PerspectiveCamera|BufferGeometry|MeshBasicMaterial/gi, weight: 90 },
          { pattern: /three\.js|three\.min\.js/gi, weight: 85 },
          { pattern: /webgl|canvas.*3d/gi, weight: 60 },
        ],
      },
      {
        name: "Lottie",
        patterns: [
          { pattern: /lottie\.loadAnimation|bodymovin/gi, weight: 95 },
          { pattern: /lottie-web|lottie\.js/gi, weight: 85 },
          { pattern: /lottie/gi, weight: 70 },
        ],
      },
      {
        name: "AOS",
        patterns: [
          { pattern: /AOS\.init|data-aos/gi, weight: 95 },
          { pattern: /aos\.js/gi, weight: 85 },
        ],
      },
      {
        name: "Anime.js",
        patterns: [
          { pattern: /anime\(\{|anime\.timeline/gi, weight: 95 },
          { pattern: /anime\.js/gi, weight: 85 },
        ],
      },
      {
        name: "Locomotive Scroll",
        patterns: [
          { pattern: /new LocomotiveScroll|data-scroll/gi, weight: 95 },
          { pattern: /locomotive-scroll/gi, weight: 85 },
        ],
      },
      {
        name: "Framer Motion",
        patterns: [{ pattern: /framer-motion|motion\.|useAnimation|AnimatePresence/gi, weight: 95 }],
      },
    ]

    let bestMatch = { library: "", confidence: 0 }
    for (const lib of libraries) {
      let totalScore = 0
      let matchCount = 0
      for (const { pattern, weight } of lib.patterns) {
        const matches = (urlLower + " " + contentLower).match(pattern)
        if (matches) {
          totalScore += weight * matches.length
          matchCount++
        }
      }
      if (matchCount > 0) {
        const confidence = Math.min(100, totalScore / matchCount)
        if (confidence > bestMatch.confidence) bestMatch = { library: lib.name, confidence }
      }
    }

    if (bestMatch.confidence === 0) {
      const genericPatterns = [
        /@keyframes|animation:|transform:|transition:/gi,
        /requestAnimationFrame|setInterval.*animation/gi,
        /\.animate\(|\.transition\(/gi,
        /transform.*translate|rotate|scale/gi,
        /opacity.*transition|visibility.*transition/gi,
        /cubic-bezier|ease-in|ease-out/gi,
      ]
      let genericScore = 0
      for (const pattern of genericPatterns) {
        const matches = contentLower.match(pattern)
        if (matches) genericScore += matches.length * 10
      }
      if (genericScore > 20) return { isAnimation: true, confidence: Math.min(50, genericScore) }
    }

    return {
      isAnimation: bestMatch.confidence > 60,
      library: bestMatch.library || undefined,
      confidence: bestMatch.confidence,
    }
  }

  const analyzeSite = async (urlToAnalyze = url) => {
    if (!urlToAnalyze) return
    setLoading(true)
    setError(null)
    setResult(null)
    setCopyStatus(null)

    try {
      let fullUrl = urlToAnalyze
      if (!/^https?:\/\//i.test(fullUrl)) fullUrl = "https://" + fullUrl

      // ── Appel à l'API server-side (fiable, pas de CORS, pas de proxy) ──
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Analyse échouée côté serveur")
      }

      const { fullHTML, fullCSS, fullJS } = data
      const baseURL = new URL(fullUrl).origin

      // ── Extraire les métadonnées depuis le HTML retourné ──────────────────
      const parser = new DOMParser()
      const doc = parser.parseFromString(fullHTML, "text/html")

      const title = doc.querySelector("title")?.textContent ||
        doc.querySelector("h1")?.textContent || new URL(fullUrl).hostname

      const description =
        doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
        doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        "Not found"

      const links = Array.from(doc.querySelectorAll("a[href]")).map((el) => el.getAttribute("href") || "")
      const internalLinks = links.filter((href) => {
        try { return new URL(href, baseURL).hostname === new URL(fullUrl).hostname }
        catch { return false }
      }).length
      const externalLinks = links.length - internalLinks

      const imageSrcs: string[] = Array.from(doc.querySelectorAll("img"))
        .map((img) => {
          const src = img.getAttribute("src")
          if (!src) return null
          try { return new URL(src, baseURL).href } catch { return null }
        })
        .filter((s): s is string => !!s)

      const ogTags = doc.querySelectorAll('meta[property^="og:"]').length

      // ── Détection des technologies depuis le code récupéré ────────────────
      const allCode = [fullJS, fullCSS, fullHTML].join(" ")
      const techGuesses: string[] = []
      const techPatterns: Record<string, RegExp> = {
        React: /react|jsx|createelement/gi,
        Vue: /vue\.js|v-if|v-for|\{\{.*\}\}/gi,
        Angular: /angular|ng-|@component/gi,
        jQuery: /jquery|\$\(/gi,
        GSAP: /gsap|greensock|tweenmax|tweenlite/gi,
        "Framer Motion": /framer-motion|motion\./gi,
        Lottie: /lottie|bodymovin/gi,
        "Three.js": /three\.js|webgl/gi,
        Bootstrap: /bootstrap/gi,
        Tailwind: /tailwind/gi,
        AOS: /aos\.js|data-aos/gi,
        "Locomotive Scroll": /locomotive-scroll/gi,
        "Barba.js": /barba\.js/gi,
        Swiper: /swiper/gi,
        Particles: /particles/gi,
      }
      Object.entries(techPatterns).forEach(([tech, pattern]) => {
        if (pattern.test(allCode)) techGuesses.push(tech)
      })

      // ── Détection fichiers d'animation pour les CDN ───────────────────────
      const animationFiles: AnimationFile[] = []
      const detectedLibraries = [...new Set(techGuesses)]
      const allCdnUrls: string[] = []
      detectedLibraries.forEach((lib) => { allCdnUrls.push(...getLibraryCDN(lib)) })

      setResult({
        title,
        description,
        techGuesses,
        internalLinks,
        externalLinks,
        images: imageSrcs,
        stylesheets: data.stats?.cssFilesCount ?? 0,
        openGraphTags: ogTags,
        fullHTML,
        fullCSS,
        fullJS,
        baseURL,
        animationFiles,
        requiredCdnUrls: allCdnUrls,
      })
    } catch (err) {
      setError(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeClick = async () => {
    await analyzeSite()
  }

  const handleProposalClick = async (proposalUrl: string) => {
    setUrl(proposalUrl)
    await analyzeSite(proposalUrl)
  }

  const escTpl = (s: string | undefined | null): string => {
    if (!s || typeof s !== "string") return ""
    return s.replace(/`/g, "\\\\`").replace(/\\$\\{/g, "\\\\${")
  }

  const gen = (fw: FrameworkKey) => {
    if (!result) return { filename: "", code: "" }
    const HTML = escTpl(result.fullHTML)
    const CSS = escTpl(result.fullCSS)
    const JS = escTpl(result.fullJS)
    switch (fw) {
      case "next":
        return {
          filename: "app/preview/page.tsx",
          code: `"use client"
import { useEffect } from "react"

export default function Page() {
  useEffect(() => {
    const style = document.createElement("style")
    style.id = "extracted-styles"
    style.textContent = \`${CSS}\`
    document.head.appendChild(style)

    const script = document.createElement("script")
    script.id = "extracted-scripts"
    script.innerHTML = \`${JS}\`
    document.body.appendChild(script)

    return () => { try { style.remove(); script.remove(); } catch {} }
  }, [])

  return <main dangerouslySetInnerHTML={{ __html: \`${HTML}\` }} />
}
`,
        }
      case "remix":
        return {
          filename: "app/routes/preview.tsx",
          code: `import { useEffect } from "react"
export default function Preview() {
  useEffect(() => {
    const style = document.createElement("style"); style.id="extracted-styles"; style.textContent=\`${CSS}\`; document.head.appendChild(style);
    const script = document.createElement("script"); script.id="extracted-scripts"; script.innerHTML=\`${JS}\`; document.body.appendChild(script);
    return () => { try { style.remove(); script.remove(); } catch {} }
  }, [])
  return <div dangerouslySetInnerHTML={{ __html: \`${HTML}\` }} />
}
`,
        }
      case "astro":
        return {
          filename: "src/pages/preview.astro",
          code: `---
---
<style is:global>
${result.fullCSS}
</style>
${result.fullHTML}
<script is:inline>
${result.fullJS}
</script>
`,
        }
      case "vite-react":
        return {
          filename: "src/App.jsx",
          code: `import { useEffect } from "react"
export default function App() {
  useEffect(() => {
    const style = document.createElement("style"); style.id="extracted-styles"; style.textContent=\`${CSS}\`; document.head.appendChild(style)
    const script = document.createElement("script"); script.id="extracted-scripts"; script.innerHTML=\`${JS}\`; document.body.appendChild(script)
    return () => { try { style.remove(); script.remove(); } catch {} }
  }, [])
  return <div dangerouslySetInnerHTML={{ __html: \`${HTML}\` }} />
}
`,
        }
      case "sveltekit":
        return {
          filename: "src/routes/preview/+page.svelte",
          code: `<script>
  import { onMount } from "svelte";
  onMount(() => {
    const style = document.createElement("style"); style.id="extracted-styles"; style.textContent=\`${CSS}\`; document.head.appendChild(style);
    const script = document.createElement("script"); script.id="extracted-scripts"; script.innerHTML=\`${JS}\`; document.body.appendChild(script);
    return () => { try { style.remove(); script.remove(); } catch {} };
  });
</script>
<div>{@html \`${HTML}\`}</div>
`,
        }
      case "vue-vite":
        return {
          filename: "src/App.vue",
          code: `<script setup>
import { onMounted } from "vue";
onMounted(() => {
  const style = document.createElement("style"); style.id="extracted-styles"; style.textContent=\`${CSS}\`; document.head.appendChild(style);
  const script = document.createElement("script"); script.id="extracted-scripts"; script.innerHTML=\`${JS}\`; document.body.appendChild(script);
  return () => { try { style.remove(); script.remove(); } catch {} };
});
</script>
<template><div v-html="\`${HTML}\`"></div></template>
`,
        }
      case "nuxt":
        return {
          filename: "pages/preview.vue",
          code: `<script setup>
import { onMounted } from "vue";
onMounted(() => {
  const style = document.createElement("style"); style.id="extracted-styles"; style.textContent=\`${CSS}\`; document.head.appendChild(style);
  const script = document.createElement("script"); script.id="extracted-scripts"; script.innerHTML=\`${JS}\`; document.body.appendChild(script);
  return () => { try { style.remove(); script.remove(); } catch {} };
});
</script>
<template><div v-html="\`${HTML}\`"></div></template>
`,
        }
      case "html":
        return {
          filename: "index.html",
          code: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Combined Export</title><style>
${result.fullCSS}
</style></head><body>
${result.fullHTML}
<script>
${result.fullJS}
</script></body></html>`,
        }
      default:
        return { filename: "", code: "" }
    }
  }

  useEffect(() => {
    if (!result) return
    try {
      const { filename, code } = gen(selectedFramework)
      setGeneratedFilename(filename || "")
      setGeneratedCode(code || "")
    } catch (e) {
      console.error("gen() failed:", e)
      setGeneratedFilename("")
      setGeneratedCode("")
    }
  }, [selectedFramework, result])

  const buildJsxPrompt = (): string => {
    if (!result) return ""
    const { filename, code } = gen("vite-react")
    const libs =
      result.requiredCdnUrls && result.requiredCdnUrls.length
        ? `Detected external libraries (CDN):\n${result.requiredCdnUrls.join("\n")}\n\n`
        : ""
    return `You are given a complete, ready-to-use React JSX implementation. Use it EXACTLY as provided, with no changes or omissions. Only make surgical fixes if the compiler throws an error on specific lines while building; do not refactor, do not change structure or styling, and do not add or remove features.

Project file to create: ${filename}

${libs}Complete source code (paste as-is):
\`\`\`jsx
${code}
\`\`\`

Important:
- Do NOT extract or separate HTML/CSS/JS. The code is already fully integrated in JSX.
- Do NOT rewrite into a different framework.
- If you encounter a compile/runtime error, fix only the minimal lines needed without changing the overall code.`
  }

  const handleCopyPrompt = () => {
    if (!result) return
    const prompt = buildJsxPrompt()
    if (!prompt) return
    copyToClipboard(prompt, "prompt")
  }

  const handleDownloadPrompt = () => {
    if (!result) return
    const prompt = buildJsxPrompt()
    if (!prompt) return
    createDownloadLink(prompt, "prompt-react-jsx.txt", "text/plain")
  }

  const createOptimizedPreview = () => {
    if (!result) return ""
    const safe = (s: unknown): string => (typeof s === "string" ? s : "")
    const escapeForScript = (s: string) => safe(s).replace(/<\/script>/gi, "<\\/script>")
    const escapeForStyle = (s: string) => safe(s).replace(/<\/style>/gi, "<\\/style>")

    const cdnTags = (result.requiredCdnUrls ?? [])
      .map((url) =>
        url.endsWith(".css")
          ? `    <link rel="stylesheet" href="${url}" crossorigin="anonymous">`
          : `    <script src="${url}" crossorigin="anonymous"></script>`,
      )
      .join("\n")

    const animationCSSRaw = (result.animationFiles ?? [])
      .filter((f) => f.type === "css")
      .map((f) => f.content)
      .join("\n\n")
    const animationJSRaw = (result.animationFiles ?? [])
      .filter((f) => f.type === "js")
      .map((f) => f.content)
      .join("\n\n")

    const animationInitScriptRaw = `async function initializeAnimations(){await new Promise(r=>setTimeout(r,2000));if(typeof gsap!=='undefined'){try{gsap.set("*",{clearProps:"all"});const E=document.querySelectorAll('h1,h2,h3,.hero,.title,[class*="fade"],[class*="slide"],[class*="animate"]');if(E.length>0){gsap.from(E,{opacity:0,y:50,duration:1,stagger:0.1,ease:"power2.out"})}if(typeof ScrollTrigger!=='undefined'){gsap.registerPlugin(ScrollTrigger);gsap.utils.toArray('[data-scroll], .scroll-trigger').forEach(el=>{gsap.from(el,{opacity:0,y:100,duration:1,scrollTrigger:{trigger:el,start:"top 80%",end:"bottom 20%",toggleActions:"play none none reverse"}})})}}catch(e){}}if(typeof THREE!=='undefined'){const canvas=document.querySelector('canvas')||document.querySelector('#three-canvas');if(canvas){try{const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(75,canvas.clientWidth/canvas.clientHeight,0.1,1000);const renderer=new THREE.WebGLRenderer({canvas:canvas,alpha:true});renderer.setSize(canvas.clientWidth,canvas.clientHeight);const geometry=new THREE.BufferGeometry();const vertices=[];for(let i=0;i<1000;i++){vertices.push((Math.random()-0.5)*2000,(Math.random()-0.5)*2000,(Math.random()-0.5)*2000)}geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const material=new THREE.PointsMaterial({color:0xffffff,size:2});const particles=new THREE.Points(geometry,material);scene.add(particles);camera.position.z=1000;function animate(){requestAnimationFrame(animate);particles.rotation.x+=0.001;particles.rotation.y+=0.001;renderer.render(scene,camera)}animate()}catch(e){}}}if(typeof AOS!=='undefined'){try{AOS.init({duration:1000,once:false,mirror:true,offset:100})}catch(e){}}if(typeof lottie!=='undefined'){try{document.querySelectorAll('[data-lottie], .lottie, [data-animation-path]').forEach(el=>{const path=el.dataset.lottie||el.dataset.animationPath;if(path){lottie.loadAnimation({container:el,renderer:'svg',loop:true,autoplay:true,path})}})}catch(e){}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeAnimations)}else{initializeAnimations()}`
    const safeAnimationCSS = escapeForStyle(animationCSSRaw)
    const safeFullCSS = escapeForStyle(result.fullCSS)
    const safeAnimationJS = escapeForScript(animationJSRaw)
    const safeInitScript = escapeForScript(animationInitScriptRaw)
    const safeFullJS = escapeForScript(result.fullJS)

    const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <base href="${result.baseURL}">
  <title>UI preview</title>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${cdnTags}
  <style id="animation-styles">
${safeAnimationCSS}
  </style>
  <style id="regular-styles">
${safeFullCSS}
  </style>
</head>
<body>
${result.fullHTML}
<script>${safeInitScript}</script>
<script>${safeAnimationJS}</script>
<script>${safeFullJS}</script>
</body></html>`
    return previewHtml
  }

  const HeaderAction = () => null

  const inputPlaceholder = "https://example.com"
  const onInputFocus = () => {}

  // Memoized pour éviter de recalculer 2-3MB de CSS/JS à chaque render
  const previewDoc = useMemo(() => {
    if (!result) return ""
    try {
      return createOptimizedPreview()
    } catch (e) {
      console.error("createOptimizedPreview failed:", e)
      return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;color:red">
        <h2>Aperçu indisponible</h2><p>${e instanceof Error ? e.message : String(e)}</p>
      </body></html>`
    }
  }, [result])


  return (
    <div className="min-h-screen bg-white overflow-hidden p-4 sm:p-8">
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-12">
        <svg
          className="h-[20px] w-[20px]"
          width="36"
          height="36"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
          fill="#111"
        >
          <rect x="0" y="0" width="32" height="32" rx="10" />
        </svg>
        <HeaderAction />
      </header>

      <div className="max-w-4xl mx-auto p-6 sm:p-10 pb-20">
        <div className="text-center mb-10">
          <CircularText size={140} />
          <h1 className={`${bodoni.className} text-5xl sm:text-7xl md:text-8xl leading-[1.05] text-black mb-4`}>
            Clone your favorite website design.
          </h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto">
            Paste a URL, launch the process, and instantly get a pixel-perfect replica of any website&apos;s design.
          </p>

        </div>

        <div className="h-[45px] w-[90%] sm:w-[400px] ring-5 ring-[#eee] rounded-[12px] flex items-center p-1 mx-auto mb-4">
          <div className="h-full w-full bg-[#fff] ring-4 ring-[#FAFAFA] rounded-[12px] flex items-center p-1 ">
            <div className="p-2">
              <Globe size={20} className="text-black" />
            </div>
            <input
              type="text"
              placeholder={inputPlaceholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={onInputFocus}
              className={`flex-grow h-full bg-transparent text-black focus:outline-none focus:ring-0 placeholder-[#888] text-sm ${
                ""
              }`}
              readOnly={false}
            />
            <button
              onClick={handleAnalyzeClick}
              disabled={loading}
              className="h-[35px] w-[35px] bg-[#111] rounded-[8px] flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed mr-1"
            >
              {loading ? (
                <div className="bg-white rounded-[6px] w-4 h-4 animate-pulse" />
              ) : (
                <ArrowUp size={20} className="text-white" />
              )}
            </button>
          </div>
        </div>

        {/* Try chips */}
        {!loading && !result && (
          <div className="flex justify-center items-center gap-3 flex-wrap mb-6">
            <span className="text-sm text-gray-500">Try:</span>
            {proposalUrls.map((pUrl) => (
              <button
                key={pUrl}
                onClick={() => handleProposalClick(pUrl)}
                className="h-[30px] w-auto bg-[#FAFAFA] rounded-[12px] flex items-center px-2 transition-transform hover:scale-105"
              >
                <img
                  src={
                    proposalUrlImages[pUrl] ||
                    " /placeholder.svg?height=16&width=16&query=proposal%20preview%20thumbnail"
                   || "/placeholder.svg"}
                  alt={`${pUrl} preview`}
                  className="h-4 w-4 rounded-[4px] mr-2 object-cover"
                />
                <Globe size={14} className="text-black mr-2" />
                <p className="text-sm text-gray-700">{pUrl}</p>
                <ArrowUp size={16} className="text-black ml-2" />
              </button>
            ))}
          </div>
        )}

        {/* RESTORED: Proposal cards grid */}
        {!loading && !result && (
          <div className="flex justify-center">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-12">
              {proposalUrls.map((pUrl) => (
                <div
                  key={pUrl}
                  onClick={() => handleProposalClick(pUrl)}
                  className="h-[300px] w-[300px] flex items-center border border-[#eee] rounded-[10px] relative cursor-pointer overflow-hidden bg-white"
                >
                  <img
                    className="h-full w-full object-contain"
                    src={
                      proposalUrlImages[pUrl] || "/placeholder.svg?height=300&width=300&query=site%20image%20preview"
                    }
                    alt={`${pUrl} site image`}
                  />
                  <div className="absolute bottom-1 left-1 z-[1]">
                    <button className="w-auto backdrop-blur-3xl rounded-[12px] flex items-center px-2 transition-transform hover:scale-105 bg-white/70">
                      <p className="text-[10px] text-black font-semibold">{pUrl}</p>
                      <ArrowUp size={16} className="text-black ml-2" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && !result && <LogoMarquee />}

        {error && <p className="text-red-600 bg-red-50 p-3 rounded-lg text-center mb-6">{error}</p>}

        {result && (
          <div className="space-y-12">
            <div>
              <h3 className="text-2xl font-bold text-black mb-4">UI preview</h3>
              <iframe
                title="UI preview"
                className="w-full border border-gray-200 rounded-xl bg-white" style={{ height: "70vh", minHeight: "400px" }}
                srcDoc={previewDoc}
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="fixed bottom-0 left-0 right-0 p-4 flex justify-center">
          <div className="flex items-center gap-3">
            <div className="h-[40px] w-auto flex items-center rounded-[14px] bg-white shadow-md border border-[#e5e5e5]">
              <Button
                onClick={handleCopyPrompt}
                variant="ghost"
                className="h-[38px] rounded-[12px] text-sm font-medium px-4"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy JSX prompt
              </Button>
            </div>
            <div className="h-[40px] w-auto flex items-center rounded-[14px] bg-white shadow-md border border-[#e5e5e5]">
              <Button
                onClick={handleDownloadPrompt}
                variant="ghost"
                className="h-[38px] rounded-[12px] text-sm font-medium px-4"
              >
                <Download className="mr-2 h-4 w-4" />
                Download prompt
              </Button>
            </div>
            <div className="h-[40px] w-auto flex items-center rounded-[14px] bg-white shadow-md border border-[#e5e5e5]">
              <Button
                onClick={() => setShowExportModal(true)}
                variant="ghost"
                className="h-[38px] rounded-[12px] text-sm font-medium px-4"
              >
                <Download className="mr-2 h-4 w-4" />
                Download code
              </Button>
            </div>
            {copyStatus?.id === "prompt" && (
              <span className="text-sm text-green-600 bg-green-50 px-3 py-1 rounded-md">{copyStatus.message}</span>
            )}
          </div>
        </div>
      )}

      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Export code</DialogTitle>
            <DialogDescription>
              Select a framework and preview the single-file export. Then download or copy it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="framework">Framework</Label>
                <select
                  id="framework"
                  className="w-full h-10 rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={selectedFramework}
                  onChange={(e) => setSelectedFramework(e.target.value as FrameworkKey)}
                >
                  {Object.entries(frameworkLabel).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="inline-flex items-center justify-between w-full">
                  <span>View code</span>
                  <Switch checked={showCodePreview} onCheckedChange={setShowCodePreview} />
                </Label>
                <input
                  readOnly
                  value={generatedFilename}
                  className="w-full h-10 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs"
                />
              </div>
            </div>
            {showCodePreview && (
              <div className="rounded-lg border bg-[#0b0c10] border-gray-800 overflow-hidden">
                <div className="px-3 py-2 text-xs text-gray-300 bg-[#0f1117] border-b border-gray-800 flex justify-between">
                  <span>{generatedFilename}</span>
                  <span className="text-gray-500">readonly preview</span>
                </div>
                <pre className="max-h-[420px] overflow-auto text-xs leading-5 p-4 text-gray-100">
                  <code>{generatedCode}</code>
                </pre>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => copyToClipboard(generatedCode, "export-code")}
              disabled={!generatedCode}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy code
            </Button>
            <Button
              onClick={() => {
                if (!generatedCode || !generatedFilename) return
                const mime = generatedFilename.endsWith(".html")
                  ? "text/html"
                  : generatedFilename.endsWith(".astro")
                    ? "text/plain"
                    : "text/plain"
                const flat = generatedFilename.replaceAll("/", "_")
                createDownloadLink(generatedCode, flat, mime)
              }}
              disabled={!generatedCode}
            >
              <Download className="mr-2 h-4 w-4" />
              Download file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
