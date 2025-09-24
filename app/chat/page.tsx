"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import CodeMirror from "@uiw/react-codemirror"
import { javascript } from "@codemirror/lang-javascript"
import { xcodeLight } from "@uiw/codemirror-theme-xcode"

import {
  Copy,
  Zap,
  Github,
  ChevronsUpDown,
  HardDrive,
  ArrowRight,
  RefreshCw,
  Code,
  Eye,
  ExternalLink,
  Plus,
  Save,
  AtSign,
  ArrowUp
} from "lucide-react"

// --- INTERFACES ET TYPES (SIMPLIFIÉS) ---
interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}
interface Message {
  role: "user" | "assistant" | "system"
  content: string
}
interface Project {
  id: string
  name: string
  createdAt: string
  files: { filePath: string; content: string }[]
  messages: Message[]
}

// --- LOGIQUE D'ANALYSE (Fonctions pures) ---
const parseRootVariables = (css: string): { name: string; value: string }[] => {
  const variables: { name: string; value: string }[] = []
  const globalBlocksMatch = css.match(/:root\s*{[^}]*}|html\s*{[^}]*}|body\s*{[^}]*}/g)
  if (!globalBlocksMatch) return variables
  const globalContent = globalBlocksMatch.join("\n")
  const variableRegex = /(--[\w-]+)\s*:\s*([^;]+);/g
  let match
  while ((match = variableRegex.exec(globalContent)) !== null) {
    variables.push({ name: match[1].trim(), value: match[2].trim() })
  }
  return variables
}
const extractFontFaces = (css: string): string => {
  const fontFaceRegex = /@font-face\s*{[^}]*}/g
  const matches = css.match(fontFaceRegex)
  return matches ? matches.join("\n\n") : ""
}
const findPotentialComponents = (html: string): { tag: string; selector: string }[] => {
  if (typeof window === "undefined") return []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const components: { tag: string; selector: string }[] = []
  const tagsToFind = ["header", "nav", "footer", "section", "button"]
  tagsToFind.forEach((tag) => {
    if (doc.querySelector(tag)) components.push({ tag, selector: tag })
  })
  const cards: { tag: string; selector: string }[] = []
  doc.querySelectorAll("div").forEach((div, index) => {
    if (div.querySelector("img") && div.querySelector("h1, h2, h3, p")) {
      const uniqueSelector = `[data-gemini-card-id="${index}"]`
      div.setAttribute("data-gemini-card-id", `${index}`)
      cards.push({ tag: `Card (div)`, selector: uniqueSelector })
    }
  })
  if (cards.length > 0) {
    components.push(...cards.slice(0, 5))
  }
  return components
}
const cloneWithComputedStyles = (element: Element): HTMLElement => {
  const clone = element.cloneNode(false) as HTMLElement
  const computedStyle = window.getComputedStyle(element)
  const stylePropertiesToCopy = [
    "display",
    "flex-direction",
    "align-items",
    "justify-content",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "margin",
    "padding",
    "border",
    "border-radius",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "text-align",
    "text-decoration",
    "box-shadow",
    "opacity",
    "transform",
    "transition",
    "overflow",
  ]
  let styleString = ""
  for (const prop of stylePropertiesToCopy) {
    const value = computedStyle.getPropertyValue(prop)
    if (value) styleString += `${prop}: ${value}; `
  }
  clone.setAttribute("style", styleString)
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) clone.appendChild(cloneWithComputedStyles(child as Element))
    else if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode())
  })
  return clone
}

const applyChanges = (originalContent: string, changes: any[]): string => {
  if (!originalContent && changes.some((c) => c.action !== "insertAfter")) return ""
  const lines = originalContent ? originalContent.split("\n") : []

  const deletions = changes.filter((c) => c.action === "delete").sort((a, b) => b.startLine - a.startLine)
  const insertions = changes.filter((c) => c.action === "insertAfter").sort((a, b) => b.lineNumber - a.lineNumber)
  const replacements = changes.filter((c) => c.action === "replace")

  deletions.forEach((change) => {
    const startLineIndex = change.startLine - 1
    const endLineIndex = change.endLine - 1
    if (startLineIndex >= 0 && endLineIndex >= startLineIndex && endLineIndex < lines.length) {
      lines.splice(startLineIndex, endLineIndex - startLineIndex + 1)
    }
  })

  insertions.forEach((change) => {
    const lineIndex = change.lineNumber - 1
    if (lineIndex >= -1 && lineIndex < lines.length) {
      // Allow inserting at the beginning if lineNumber is 0
      lines.splice(lineIndex + 1, 0, change.contentToInsert)
    }
  })

  replacements.forEach((change) => {
    const lineIndex = change.lineNumber - 1
    if (lineIndex >= 0 && lineIndex < lines.length) {
      lines[lineIndex] = change.newContent
    }
  })

  return lines.join("\n")
}

// --- COMPOSANT PRINCIPAL ---
export default function SandboxPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [files, setFiles] = useState<{ filePath: string; content: string }[]>([])
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Hello! Let's build something." }])
  const [chatInput, setChatInput] = useState("")
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview")
  const [activeFile, setActiveFile] = useState(0)
  const [logsHeight, setLogsHeight] = useState(25)
  const [iframeRoute, setIframeRoute] = useState("/")
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const chatScrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem("studio-projects")
      if (savedProjects) {
        setProjects(JSON.parse(savedProjects))
      }
    } catch (error) {
      console.error("Failed to load projects from localStorage", error)
    }
  }, [])

  useEffect(() => {
    if (chatScrollAreaRef.current) {
      chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [messages])

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const saveProjectsToLocalStorage = (updatedProjects: Project[]) => {
    try {
      localStorage.setItem("studio-projects", JSON.stringify(updatedProjects))
    } catch (error) {
      addLog("Error saving projects to localStorage.")
    }
  }

  const createNewProject = () => {
    const projectName = prompt("Enter project name:", `Project ${projects.length + 1}`)
    if (!projectName) return
    const newProject: Project = {
      id: crypto.randomUUID(),
      name: projectName,
      createdAt: new Date().toISOString(),
      files: [],
      messages: [{ role: "assistant", content: `Project "${projectName}" is ready. What should we build?` }],
    }
    const updatedProjects = [...projects, newProject]
    setProjects(updatedProjects)
    saveProjectsToLocalStorage(updatedProjects)
    loadProject(newProject.id)
    addLog(`Project "${projectName}" created.`)
  }

  const saveProject = () => {
    if (!currentProject) {
      addLog("Cannot save: No active project.")
      return
    }
    const updatedProject: Project = {
      ...currentProject,
      files: files,
      messages: messages,
    }
    const updatedProjects = projects.map((p) => (p.id === currentProject.id ? updatedProject : p))

    setProjects(updatedProjects)
    setCurrentProject(updatedProject)
    saveProjectsToLocalStorage(updatedProjects)
    addLog(`Project "${currentProject.name}" saved.`)
  }

  const loadProject = (projectId: string) => {
    const projectToLoad = projects.find((p) => p.id === projectId)
    if (!projectToLoad) return

    setSandboxId(null)
    setPreviewUrl(null)
    addLog("Sandbox reset for new project.")
    setCurrentProject(projectToLoad)
    setFiles(projectToLoad.files)
    setMessages(projectToLoad.messages)
    setActiveFile(0)

    addLog(`Project "${projectToLoad.name}" loaded.`)
  }

  const updateFile = (value: string, viewUpdate: any) => {
    if (viewUpdate.docChanged) {
      setFiles((prev) => {
        const updated = [...prev]
        if (updated[activeFile]) {
          updated[activeFile] = { ...updated[activeFile], content: value }
        }
        return updated
      })
    }
  }

  const runAction = async (action: "create" | "install" | "build" | "start" | "addFiles") => {
    setLoading(true)
    try {
      addLog(`Running action: ${action}...`)
      const body: any = { action, sandboxId: sandboxId || undefined }

      if (action === "addFiles") {
        if (!files.length || files.some((f) => !f.filePath)) {
          addLog("ERROR: Missing file path for one or more files.")
          setLoading(false)
          return
        }
        body.files = files
      }

      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.error) {
        addLog(`API ERROR: ${data.error}`)
        if (data.details) addLog(`Details: ${data.details}`)
        setLoading(false)
        return
      }

      if (data.logs) data.logs.split("\n").forEach((l: string) => addLog(l))
      if (data.sandboxId) setSandboxId(data.sandboxId)
      if (data.url) setPreviewUrl(data.url)

      if (data.action === "install" || data.action === "build") {
        const result: CommandResult = data.result
        if (result) {
          addLog(`Commande '${data.action}' terminée (Code: ${result.exitCode})`)
          if (result.stdout) {
            addLog("--- STDOUT ---")
            result.stdout.split("\n").forEach((l) => addLog(l))
            addLog("--------------")
          }
          if (result.stderr) {
            addLog("--- STDERR ---")
            result.stderr.split("\n").forEach((l) => addLog(l))
            addLog("--------------")
          }
          if (result.error) addLog(`E2B Command Error: ${result.error}`)
          if (result.exitCode !== 0) addLog(`ERROR: Commande '${data.action}' échouée.`)
          else addLog(`SUCCESS: Commande '${data.action}' réussie.`)
        }
      } else if (data.success && action === "addFiles") {
        addLog(`${files.length} files written successfully.`)
        if (currentProject) saveProject()
      } else if (data.success && action === "create") {
        addLog(`Sandbox créé avec l'ID: ${data.sandboxId}`)
        if (currentProject && currentProject.files.length > 0) {
          addLog("Writing current project files to the new sandbox...")
          await runAction("addFiles")
        }
      } else if (data.success && action === "start") {
        addLog(`Serveur démarré. Aperçu: ${data.url}`)
      } else if (!data.success) {
        addLog(`ERROR: Action '${action}' échouée.`)
      }
    } catch (err: any) {
      addLog(`CLIENT-SIDE ERROR: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const applyAndSetFiles = (responses: any[]) => {
    const newFiles = [...files]
    let filesUpdated = false

    responses.forEach((res) => {
      if (res.type === "fileChanges" && res.filePath && res.changes) {
        const fileIndex = newFiles.findIndex((f) => f.filePath === res.filePath)
        if (fileIndex !== -1) {
          const originalContent = newFiles[fileIndex].content
          newFiles[fileIndex].content = applyChanges(originalContent, res.changes)
          filesUpdated = true
          addLog(`Applied ${res.changes.length} changes to ${res.filePath}`)
        } else {
          addLog(`Warning: AI tried to change a non-existent file: ${res.filePath}`)
        }
      } else if (res.filePath && typeof res.content === "string") {
        const fileIndex = newFiles.findIndex((f) => f.filePath === res.filePath)
        if (fileIndex !== -1) {
          newFiles[fileIndex].content = res.content
        } else {
          newFiles.push({ filePath: res.filePath, content: res.content })
        }
        filesUpdated = true
      }
    })

    if (filesUpdated) {
      setFiles(newFiles)
      addLog(`✅ Project files updated based on AI proposal.`)
      setActiveTab("code")
      if (currentProject) saveProject()
    } else {
      addLog(`❌ AI response did not contain valid file creations or changes.`)
    }
  }

  const fillFilesFromGeminiResponse = (text: string) => {
    // --- Ligne de débogage ---
    // Affiche la réponse exacte de l'IA dans la console de votre navigateur (accessible avec F12)
    console.log("Texte brut reçu par fillFilesFromGeminiResponse:", text)

    let jsonString = ""
    // On cherche les délimiteurs d'un objet JSON `{...}`
    const firstBrace = text.indexOf("{")
    const lastBrace = text.lastIndexOf("}")

    // On cherche les délimiteurs d'un tableau JSON `[...]`
    const firstBracket = text.indexOf("[")
    const lastBracket = text.lastIndexOf("]")

    // On décide quelle structure extraire en priorité
    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      // Si on trouve un objet, et qu'il apparaît avant un éventuel tableau, on le choisit.
      jsonString = text.substring(firstBrace, lastBrace + 1)
    } else if (firstBracket !== -1 && lastBracket > firstBracket) {
      // Sinon, on choisit le tableau.
      jsonString = text.substring(firstBracket, lastBracket + 1)
    }

    if (!jsonString) {
      addLog(`❌ N'a trouvé aucune structure JSON ({...} ou [...]) dans la réponse.`)
      return
    }

    try {
      const parsed = JSON.parse(jsonString)

      if (Array.isArray(parsed)) {
        // Cas 1: C'est un tableau (pour la création de fichiers)
        applyAndSetFiles(parsed)
      } else if (typeof parsed === "object" && parsed !== null && parsed.type === "fileChanges") {
        // Cas 2: C'est un objet unique pour la modification d'un fichier
        applyAndSetFiles([parsed]) // On l'encapsule dans un tableau pour la fonction suivante
      } else {
        addLog(`❌ Le JSON a été parsé mais son format n'est pas reconnu.`)
      }
    } catch (e: any) {
      addLog(`❌ Échec du parsage du JSON extrait. Erreur: ${e.message}`)
      addLog(`--- Chaîne qui a échoué ---`)
      addLog(jsonString)
      addLog(`--------------------------`)
    }
  }

  const runAutomatedAnalysis = async (urlToAnalyze: string, originalUserPrompt: string) => {
    try {
      setAnalysisStatus(`1/4: Analyse de ${urlToAnalyze}...`)
      addLog(`[AUTO-FLOW] Phase 1: Calling analysis API for ${urlToAnalyze}`)
      const analysisRes = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      })
      const analysisData = await analysisRes.json()
      if (!analysisRes.ok) throw new Error(`Analysis API failed: ${analysisData.error}`)
      addLog("[AUTO-FLOW] ✅ Analysis API call successful.")

      const globalCssVariables = parseRootVariables(analysisData.fullCSS)
      const fontFaces = extractFontFaces(analysisData.fullCSS)

      setAnalysisStatus(`2/4: Recherche des composants pertinents...`)
      const componentsToFind = findPotentialComponents(analysisData.fullHTML)
      const isolatedComponents = []
      addLog(`[AUTO-FLOW] Found ${componentsToFind.length} relevant components to isolate.`)

      for (const comp of componentsToFind) {
        setAnalysisStatus(`3/4: Isolation du composant: ${comp.tag}...`)
        addLog(`[AUTO-FLOW] Isolating component: ${comp.tag} (${comp.selector})`)

        const hiddenIframe = document.createElement("iframe")
        hiddenIframe.style.display = "none"
        document.body.appendChild(hiddenIframe)

        const isolatedHtml = await new Promise<string>((resolve, reject) => {
          hiddenIframe.onload = () => {
            const iframeDoc = hiddenIframe.contentDocument
            if (!iframeDoc) return reject(new Error("Could not access hidden iframe document."))
            const element = iframeDoc.querySelector(comp.selector)
            if (element) resolve(cloneWithComputedStyles(element).outerHTML)
            else resolve("")
            document.body.removeChild(hiddenIframe)
          }
          hiddenIframe.srcdoc = `<!DOCTYPE html><html><head><base href="${analysisData.baseURL}"><style>${analysisData.fullCSS}</style></head><body>${analysisData.fullHTML}</body></html>`
        })

        if (isolatedHtml) {
          isolatedComponents.push({ name: comp.tag, html: isolatedHtml })
          addLog(`[AUTO-FLOW] ✅ Component ${comp.tag} isolated successfully.`)
        }
      }

      setAnalysisStatus(`4/4: Construction du prompt final pour Gemini...`)
      addLog(`[AUTO-FLOW] Building final rich prompt for Gemini.`)
      const finalPrompt = `User's original request: "${originalUserPrompt}"\n---\nAnalysis data from ${urlToAnalyze}:\nGlobal CSS Variables to use in globals.css:\n\`\`\`css\n:root {\n  ${globalCssVariables.map((v) => `${v.name}: ${v.value};`).join("\n  ")}\n}\n\`\`\`\nFont Faces to use in globals.css:\n\`\`\`css\n${fontFaces}\n\`\`\`\nIsolated Components (HTML with inline styles). Use these as a direct reference for structure and styling:\n${isolatedComponents.map((c) => `// Component: ${c.name}\n\`\`\`html\n${c.html}\n\`\`\``).join("\n\n")}\nBased on all the above information, generate the complete Next.js project files. IMPORTANT: Start with app/page.tsx, then app/layout.tsx, and finally app/globals.css.`
      addLog("[AUTO-FLOW] Sending final prompt to Gemini for code generation.")
      await sendChat(finalPrompt)
    } catch (err: any) {
      addLog(`ERROR during automated analysis: ${err.message}`)
      setAnalysisStatus(`Erreur durant l'analyse: ${err.message}`)
    }
  }

  const sendChat = async (promptOverride?: string) => {
    const userPrompt = promptOverride || chatInput
    if (!userPrompt) return
    if (!currentProject && !promptOverride) {
      addLog("Please create or load a project before starting a conversation.")
      return
    }

    setLoading(true)
    let currentMessages = messages
    if (!promptOverride) {
      const newUserMessage = { role: "user", content: userPrompt }
      currentMessages = [...messages, newUserMessage]
      setMessages(currentMessages)
      setChatInput("")
    }

    let finalPrompt = ""
    if (!promptOverride) {
      const history = currentMessages.map((msg) => `${msg.role}: ${msg.content}`).join("\n")
      const fileContext = files
        .map((f) => {
          const numberedContent = f.content
            .split("\n")
            .map((line, i) => `${i + 1}: ${line}`)
            .join("\n")
          return `// FilePath: ${f.filePath}\n\`\`\`\n${numberedContent}\n\`\`\``
        })
        .join("\n\n")

      finalPrompt = `CONTEXT:\nCurrent Files:\n${fileContext}\n---\nConversation History:\n${history}\n---\nNEW USER REQUEST:\n${userPrompt}`
    } else {
      finalPrompt = userPrompt
    }

    addLog(`Sending prompt to Gemini...`)

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: finalPrompt }),
      })
      if (!res.ok || !res.body) throw new Error(`Gemini API request failed`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ""

      setMessages((prev) => [...prev, { role: "assistant", content: "" }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const lastMsgIndex = prev.length - 1
          const updatedMessages = [...prev]
          if (updatedMessages[lastMsgIndex]?.role === "assistant") {
            updatedMessages[lastMsgIndex] = { ...updatedMessages[lastMsgIndex], content: text }
          }
          return updatedMessages
        })
      }

      const jsonMatch = text.match(/{[\s\S]*}/)
      if (jsonMatch) {
        try {
          const parsedJson = JSON.parse(jsonMatch[0])
          if (parsedJson.type === "inspirationUrl" && parsedJson.url) {
            addLog(`✅ Gemini suggests inspiration URL: ${parsedJson.url}`)
            await runAutomatedAnalysis(parsedJson.url, userPrompt)
            return
          }
        } catch (e) {}
      }

      addLog("Response not an inspiration URL, treating as code.")
      fillFilesFromGeminiResponse(text)
    } catch (err: any) {
      addLog(`CLIENT-SIDE ERROR: ${err.message}`)
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
      setAnalysisStatus(null)
    }
  }

  const copyLogs = () => navigator.clipboard.writeText(logs.join("\n"))

  const handleNavigate = () => {
    if (iframeRef.current && previewUrl) {
      const targetUrl = new URL(previewUrl)
      const route = iframeRoute.startsWith("/") ? iframeRoute : `/${iframeRoute}`
      targetUrl.pathname = route
      iframeRef.current.src = targetUrl.toString()
      addLog(`Navigating iframe to: ${targetUrl.toString()}`)
    }
  }

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
      addLog("Reloading iframe...")
    }
  }

  return (
    <div className="flex h-screen bg-[#F7F5F3] font-sans text-[#37322F]">
      <div className="w-[40%] bg-[#F7F5F3] h-full flex flex-col border-r border-[rgba(55,50,47,0.12)]">
        <div className="flex items-center justify-between px-6 h-16 flex-shrink-0 border-b border-[rgba(55,50,47,0.12)]">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-xl text-[#37322F] font-sans">Brillance Studio</span>
          </div>
          <div className="flex items-center">
            <select
              onChange={(e) => loadProject(e.target.value)}
              value={currentProject?.id || ""}
              className="text-sm bg-transparent border-none focus:ring-0 font-medium max-w-[150px] text-[#37322F]"
            >
              <option value="" disabled>
                Select a Project
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon"
              onClick={createNewProject}
              className="h-8 w-8 text-[#37322F] hover:bg-[rgba(55,50,47,0.08)]"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={saveProject}
              disabled={!currentProject || loading}
              size="sm"
              variant="ghost"
              className="text-[#37322F] hover:bg-[rgba(55,50,47,0.08)]"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Project
            </Button>
          </div>
        </div>

        <div className="flex-grow relative">
          <ScrollArea className="absolute inset-0 p-6" viewportRef={chatScrollAreaRef}>
            <div className="space-y-6 pb-4">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex flex-col items-start gap-3 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-3">
                      <div className="h-6 w-6 bg-[#37322F] rounded-full flex items-center justify-center">
                        <svg
  className="h-[18px] w-[18px]"
  version="1.1"
  viewBox="0 0 256 256"
  xmlSpace="preserve"
  xmlns="http://www.w3.org/2000/svg"
  xmlnsXlink="http://www.w3.org/1999/xlink">
  <g
    style={{
      fill: "none",
      fillRule: "nonzero",
      opacity: "1",
      stroke: "none",
      strokeDasharray: "none",
      strokeLinecap: "butt",
      strokeLinejoin: "miter",
      strokeMiterlimit: "10",
      strokeWidth: "0",
    }}
    transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
    <linearGradient
      gradientUnits="userSpaceOnUse"
      id="SVGID_1"
      x1="60.0525"
      x2="34.8444"
      y1="33.3396"
      y2="52.867">
      <stop
        offset="0%"
        style={{
          stopColor: "rgb(145,104,192)",
          stopOpacity: "1",
        }}
      />
      <stop
        offset="34.300000000000004%"
        style={{
          stopColor: "rgb(86,132,209)",
          stopOpacity: "1",
        }}
      />
      <stop
        offset="67.2%"
        style={{
          stopColor: "rgb(27,161,227)",
          stopOpacity: "1",
        }}
      />
    </linearGradient>
    <path
      d="M 90 45.09 C 65.838 46.573 46.573 65.838 45.09 90 h -0.18 C 43.43 65.837 24.163 46.57 0 45.09 v -0.18 C 24.163 43.43 43.43 24.163 44.91 0 h 0.18 C 46.573 24.162 65.838 43.427 90 44.91 V 45.09 z"
      strokeLinecap="round"
      style={{
        fill: "url(#SVGID_1)",
        fillRule: "nonzero",
        opacity: "1",
        stroke: "none",
        strokeDasharray: "none",
        strokeLinecap: "butt",
        strokeLinejoin: "miter",
        strokeMiterlimit: "10",
        strokeWidth: "1",
      }}
      transform=" matrix(1 0 0 1 0 0) "
    />
  </g>
</svg>
                      </div>
                      <span className="text-sm font-medium text-[#37322F]"></span>
                    </div>
                  )}
                  <div
                    className={`p-2 rounded-xl max-w-xl   ${
                      msg.role === "user"
                        ? "bg-[#37322F] text-white self-end border-[#37322F]"
                        : "bg-none text-[#37322F] self-start"
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{msg.content}</pre>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="p-6 h-[300px] border-[rgba(55,50,47,0.12)]  flex-shrink-0">
          {analysisStatus && <p className="text-sm text-[rgba(55,50,47,0.60)] mb-3 animate-pulse">{analysisStatus}</p>}
          <div className="relative">
            <div className="absolute flex flex-col -top-5 rounded-t-[10px] bg-transparent border-b border-[rgba(55,50,47,0.12)] h-[60px] w-full">
              <div className="w-full p-1 h-[50%] p-[2px] flex items-center gap-1">bonjour</div>
              <div className="w-full p-1 h-[50%] border-t border-[rgba(55,50,47,0.12)] p-[2px] flex items-center gap-1">
                <div className="w-[25px] p-1 h-[25px] border border-black rounded-[12px] flex items-center justify-center">
                  <Plus size={18} />
                </div>
                <div className="w-auto p-1 h-[25px] border border-black rounded-[12px] flex items-center justify-center">
                  <AtSign size={18} />
                  <p>Mention</p>
                </div>
              </div>
            </div>
            <textarea
              placeholder={currentProject ? "Describe what to build..." : "Please create or select a project first."}
              className="w-full border border-[rgba(55,50,47,0.12)] p-4 pr-28 rounded-xl resize-none text-sm bg-[#F7F5F3] text-[#37322F] placeholder:text-[rgba(55,50,47,0.60)] focus:outline-none focus:ring-2 focus:ring-[rgba(55,50,47,0.12)] focus:border-transparent"
              rows={3}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  sendChat()
                }
              }}
              disabled={!currentProject || loading}
            />
            <Button
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white rounded-lg px-6"
              onClick={() => sendChat()}
              disabled={loading || !chatInput || !currentProject}
            >
              <Zap className="h-4 w-4 mr-2" /> Send
            </Button>
          </div>
        </div>
      </div>

      <div className="w-[60%] h-full flex flex-col bg-white">
        <div className="flex items-center justify-between p-4 flex-shrink-0 h-16 border-b border-[rgba(55,50,47,0.12)]">
          <div className="bg-[#F7F5F3] rounded-xl h-10 flex items-center p-1 border border-[rgba(55,50,47,0.12)]">
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 rounded-lg ${activeTab === "preview" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("preview")}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="icon"
              className={`h-8 w-8 rounded-lg ${activeTab === "code" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("code")}
            >
              <Code className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-center gap-2 border border-[rgba(55,50,47,0.12)] rounded-xl p-1 w-[280px] bg-[#F7F5F3]">
            <input
              type="text"
              value={iframeRoute}
              onChange={(e) => setIframeRoute(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNavigate()
              }}
              className="flex-grow bg-transparent outline-none px-3 text-sm text-[#37322F] placeholder:text-[rgba(55,50,47,0.60)]"
              placeholder="/route"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
              onClick={handleNavigate}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
              onClick={handleReload}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 flex-shrink-0 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
              disabled={!previewUrl}
              onClick={() => window.open(previewUrl, "_blank")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4">
              <button
                className="flex items-center justify-center rounded-xl border border-[rgba(55,50,47,0.12)] bg-white p-2 hover:bg-[#F7F5F3] transition-colors h-10 w-10"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5 text-[#37322F]" />
              </button>
              <button className="rounded-full text-white flex items-center justify-center transition hover:brightness-90 h-10 px-6 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)]">
                Deploy
              </button>
            </div>
          </div>
        </div>

        <div className="w-full h-[calc(100%-64px)] bg-[#F7F5F3] flex flex-col">
          {activeTab === "preview" ? (
            <div className="flex-grow flex flex-col overflow-hidden w-full h-full">
              <div className="flex-grow bg-white border border-[rgba(55,50,47,0.12)] m-4 rounded-xl overflow-hidden">
                {previewUrl ? (
                  <iframe ref={iframeRef} src={previewUrl} className="w-full h-full border-0" title="Sandbox Preview" />
                ) : (
                  <div className="flex items-center justify-center h-full text-[rgba(55,50,47,0.60)]">
                    <p>Create a sandbox and start the server.</p>
                  </div>
                )}
              </div>

              <div
                className="flex-shrink-0 border-t border-[rgba(55,50,47,0.12)] w-full bg-white"
                style={{ height: `${logsHeight}%` }}
              >
                <div className="flex items-center justify-between p-4 h-12 bg-[#F7F5F3] border-b border-[rgba(55,50,47,0.12)]">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => runAction("create")}
                      disabled={loading}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Create
                    </Button>
                    <Button
                      onClick={() => runAction("install")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Install
                    </Button>
                    <Button
                      onClick={() => runAction("build")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Build
                    </Button>
                    <Button
                      onClick={() => runAction("start")}
                      disabled={loading || !sandboxId}
                      variant="outline"
                      size="sm"
                      className="border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-white"
                    >
                      Start
                    </Button>
                  </div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium px-2 text-[#37322F]">Logs</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
                      onClick={() => setLogsHeight((h) => (h === 25 ? 75 : 25))}
                    >
                      <ChevronsUpDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"
                      onClick={copyLogs}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <ScrollArea className="w-full bg-[#1e1e1e] text-[#d4d4d4]" style={{ height: "calc(100% - 48px)" }}>
                  <pre className="text-xs font-mono whitespace-pre-wrap p-4">{logs.join("\n")}</pre>
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-row overflow-hidden w-full h-full">
              <div className="w-1/3 h-full border-r border-[rgba(55,50,47,0.12)] bg-white">
                <div className="p-4 border-b border-[rgba(55,50,47,0.12)] flex justify-between items-center h-14">
                  <h3 className="text-sm font-medium px-2 text-[#37322F]">Files</h3>
                  <Button
                    onClick={() => runAction("addFiles")}
                    disabled={loading || !sandboxId}
                    size="sm"
                    className="bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white rounded-lg"
                  >
                    <HardDrive className="h-4 w-4 mr-2" />
                    Save to Sandbox
                  </Button>
                </div>
                <ScrollArea className="h-[calc(100%-57px)] p-4">
                  <ul className="space-y-1">
                    {files.map((file, index) => (
                      <li key={index}>
                        <button
                          className={`w-full text-left text-sm p-3 rounded-lg transition-colors ${
                            activeFile === index
                              ? "bg-[#F7F5F3] text-[#37322F] border border-[rgba(55,50,47,0.12)]"
                              : "hover:bg-[#F7F5F3] text-[rgba(55,50,47,0.80)]"
                          }`}
                          onClick={() => setActiveFile(index)}
                        >
                          {file.filePath}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full border-[rgba(55,50,47,0.12)] text-[#37322F] hover:bg-[#F7F5F3] bg-transparent"
                    onClick={() => setFiles((prev) => [...prev, { filePath: "new/file.tsx", content: "" }])}
                  >
                    + New File
                  </Button>
                </ScrollArea>
              </div>

              <div className="w-2/3 h-full bg-white">
                <CodeMirror
                  value={files[activeFile]?.content || ""}
                  height="100%"
                  theme={xcodeLight}
                  extensions={[javascript({ jsx: true, typescript: true })]}
                  onChange={updateFile}
                  style={{ height: "100%" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
