"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import CodeMirror from "@uiw/react-codemirror"
import { javascript } from "@codemirror/lang-javascript"

import { Github, HardDrive, Plus, Send, ChevronDown, FolderOpen, File, Settings, Database, Rocket } from "lucide-react"

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

interface Artifact {
  id: string
  type: "analysis" | "file-creation" | "file-edit"
  status: "pending" | "processing" | "completed" | "error"
  title: string
  url?: string
  filePath?: string
  progress?: number
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
  const [buildLogs, setBuildLogs] = useState<string[]>([])
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
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [activeBottomTab, setActiveBottomTab] = useState<"build" | "logs" | "tests">("build")

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
  const addBuildLog = (msg: string) => setBuildLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const addArtifact = (artifact: Omit<Artifact, "id">) => {
    const newArtifact = { ...artifact, id: crypto.randomUUID() }
    setArtifacts((prev) => [...prev, newArtifact])
    return newArtifact.id
  }

  const updateArtifact = (id: string, updates: Partial<Artifact>) => {
    setArtifacts((prev) => prev.map((artifact) => (artifact.id === id ? { ...artifact, ...updates } : artifact)))
  }

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
      if (action === "build" || action === "install") {
        addBuildLog(`Running ${action}...`)
      } else {
        addLog(`Running action: ${action}...`)
      }

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
        if (action === "build" || action === "install") {
          addBuildLog(`API ERROR: ${data.error}`)
          if (data.details) addBuildLog(`Details: ${data.details}`)
        } else {
          addLog(`API ERROR: ${data.error}`)
          if (data.details) addLog(`Details: ${data.details}`)
        }
        setLoading(false)
        return
      }

      if (data.sandboxId) setSandboxId(data.sandboxId)
      if (data.url) setPreviewUrl(data.url)

      if (data.action === "install" || data.action === "build") {
        const result: CommandResult = data.result
        if (result) {
          addBuildLog(`Command '${data.action}' completed (Exit Code: ${result.exitCode})`)
          if (result.stdout) {
            addBuildLog("--- STDOUT ---")
            result.stdout.split("\n").forEach((l) => addBuildLog(l))
            addBuildLog("--------------")
          }
          if (result.stderr) {
            addBuildLog("--- STDERR ---")
            result.stderr.split("\n").forEach((l) => addBuildLog(l))
            addBuildLog("--------------")
          }
          if (result.error) addBuildLog(`E2B Command Error: ${result.error}`)
          if (result.exitCode !== 0) addBuildLog(`ERROR: Command '${data.action}' failed.`)
          else addBuildLog(`SUCCESS: Command '${data.action}' completed successfully.`)
        }
      } else if (data.success && action === "addFiles") {
        addLog(`${files.length} files written successfully.`)
        if (currentProject) saveProject()
      } else if (data.success && action === "create") {
        addLog(`Sandbox created with ID: ${data.sandboxId}`)
        if (currentProject && currentProject.files.length > 0) {
          addLog("Writing current project files to the new sandbox...")
          await runAction("addFiles")
        }
      } else if (data.success && action === "start") {
        addLog(`Server started. Preview: ${data.url}`)
      } else if (!data.success) {
        addLog(`ERROR: Action '${action}' failed.`)
      }
    } catch (err: any) {
      if (action === "build" || action === "install") {
        addBuildLog(`CLIENT-SIDE ERROR: ${err.message}`)
      } else {
        addLog(`CLIENT-SIDE ERROR: ${err.message}`)
      }
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

    const fillFilesFromGeminiResponse = (text: string): boolean => {
    console.log("[v0] Raw AI response:", text)

    let jsonString = ""
    const firstBrace = text.indexOf("{")
    const lastBrace = text.lastIndexOf("}")
    const firstBracket = text.indexOf("[")
    const lastBracket = text.lastIndexOf("]")

    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      jsonString = text.substring(firstBrace, lastBrace + 1)
    } else if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonString = text.substring(firstBracket, lastBracket + 1)
    }

    if (!jsonString) {
      addLog(`INFO: No JSON structure found in response. Treating as text.`)
      return false
    }

    try {
      const parsed = JSON.parse(jsonString)

      if (Array.isArray(parsed)) {
        const artifactId = addArtifact({
          type: "file-creation",
          status: "processing",
          title: `Creating ${parsed.length} files...`,
        })

        setTimeout(() => {
          applyAndSetFiles(parsed)
          updateArtifact(artifactId, { status: "completed", title: `Created ${parsed.length} files` })
        }, 1000)
        return true
      } else if (typeof parsed === "object" && parsed !== null && parsed.type === "fileChanges") {
        const artifactId = addArtifact({
          type: "file-edit",
          status: "processing",
          title: `Editing ${parsed.filePath}...`,
          filePath: parsed.filePath,
        })

        setTimeout(() => {
          applyAndSetFiles([parsed])
          updateArtifact(artifactId, { status: "completed", title: `Edited ${parsed.filePath}` })
        }, 800)
        return true
      } else {
        addLog(`❌ JSON parsed but format not recognized.`)
        return false
      }
    } catch (e: any) {
      addLog(`❌ Failed to parse extracted JSON. Error: ${e.message}`)
      return false
    }
            }
        

  const runAutomatedAnalysis = async (urlToAnalyze: string, originalUserPrompt: string) => {
    try {
      const artifactId = addArtifact({
        type: "analysis",
        status: "processing",
        title: `Analyzing ${urlToAnalyze}...`,
        url: urlToAnalyze,
        progress: 0,
      })

      updateArtifact(artifactId, { progress: 25 })
      setAnalysisStatus(`1/4: Analyzing ${urlToAnalyze}...`)
      addLog(`[AUTO-FLOW] Phase 1: Calling analysis API for ${urlToAnalyze}`)

      const analysisRes = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToAnalyze }),
      })
      const analysisData = await analysisRes.json()
      if (!analysisRes.ok) throw new Error(`Analysis API failed: ${analysisData.error}`)

      updateArtifact(artifactId, { progress: 50 })
      addLog("[AUTO-FLOW] ✅ Analysis API call successful.")

      const globalCssVariables = parseRootVariables(analysisData.fullCSS)
      const fontFaces = extractFontFaces(analysisData.fullCSS)

      updateArtifact(artifactId, { progress: 75 })
      setAnalysisStatus(`2/4: Finding relevant components...`)
      const componentsToFind = findPotentialComponents(analysisData.fullHTML)
      const isolatedComponents = []
      addLog(`[AUTO-FLOW] Found ${componentsToFind.length} relevant components to isolate.`)

      for (const comp of componentsToFind) {
        setAnalysisStatus(`3/4: Isolating component: ${comp.tag}...`)
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

      updateArtifact(artifactId, { progress: 100, status: "completed", title: `Analyzed ${urlToAnalyze}` })
      setAnalysisStatus(`4/4: Building final prompt for Gemini...`)
      addLog(`[AUTO-FLOW] Building final rich prompt for Gemini.`)

      const finalPrompt = `User's original request: "${originalUserPrompt}"\n---\nAnalysis data from ${urlToAnalyze}:\nGlobal CSS Variables to use in globals.css:\n\`\`\`css\n:root {\n  ${globalCssVariables.map((v) => `${v.name}: ${v.value};`).join("\n  ")}\n}\n\`\`\`\nFont Faces to use in globals.css:\n\`\`\`css\n${fontFaces}\n\`\`\`\nIsolated Components (HTML with inline styles). Use these as a direct reference for structure and styling:\n${isolatedComponents.map((c) => `// Component: ${c.name}\n\`\`\`html\n${c.html}\n\`\`\``).join("\n\n")}\nBased on all the above information, generate the complete Next.js project files. IMPORTANT: Start with app/page.tsx, then app/layout.tsx, and finally app/globals.css.`

      addLog("[AUTO-FLOW] Sending final prompt to Gemini for code generation.")
      await sendChat(finalPrompt)
    } catch (err: any) {
      addLog(`ERROR during automated analysis: ${err.message}`)
      setAnalysisStatus(`Error during analysis: ${err.message}`)
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

        const cleanedTextForDisplay = text.replace(/```json[\s\S]*?```/g, "").trim();
        setMessages((prev) => {
          const lastMsgIndex = prev.length - 1
          const updatedMessages = [...prev]
          if (updatedMessages[lastMsgIndex]?.role === "assistant") {
            updatedMessages[lastMsgIndex] = { ...updatedMessages[lastMsgIndex], content: cleanedTextForDisplay }
          }
          return updatedMessages
        })
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/)
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

      addLog("Response not an inspiration URL, treating as code or text.")
      const wasJsonHandled = fillFilesFromGeminiResponse(text)

      if (!wasJsonHandled) {
        addLog("✅ Gemini sent a text response.")
        const finalText = text.replace(/```json[\s\S]*?```/g, "").trim();
        setMessages((prev) => {
          const lastMsgIndex = prev.length - 1
          const updatedMessages = [...prev]
          if (updatedMessages[lastMsgIndex]?.role === "assistant") {
            updatedMessages[lastMsgIndex] = { ...updatedMessages[lastMsgIndex], content: finalText }
          }
          return updatedMessages
        });
      } else {
         setMessages((prev) => {
          const lastMsgIndex = prev.length - 1
          const updatedMessages = [...prev]
          if (updatedMessages[lastMsgIndex]?.role === "assistant") {
            updatedMessages[lastMsgIndex] = { ...updatedMessages[lastMsgIndex], content: "J'ai effectué les modifications de code." }
          }
          return updatedMessages
        });
      }
    } catch (err: any) {
      addLog(`CLIENT-SIDE ERROR: ${err.message}`)
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${err.message}` }])
    } finally {
      setLoading(false)
      setAnalysisStatus(null)
    }
    }
             

    

    

          


  const deployToGitHub = async () => {
    const accessToken = prompt("Enter your GitHub access token:")
    if (!accessToken) return

    const repoName = prompt("Enter repository name:", currentProject?.name || "my-project")
    if (!repoName) return

    setLoading(true)
    addLog("Starting GitHub deployment...")

    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.reduce((acc, file) => ({ ...acc, [file.filePath]: file.content }), {}),
          projectName: currentProject?.name || "my-project",
          accessToken,
          repoName,
          sandboxId,
        }),
      })

      const data = await res.json()
      if (data.success) {
        addLog(`✅ Successfully deployed to GitHub: ${data.repoUrl}`)
      } else {
        addLog(`❌ GitHub deployment failed: ${data.error}`)
      }
    } catch (err: any) {
      addLog(`❌ GitHub deployment error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const deployToVercel = async () => {
    const token = prompt("Enter your Vercel access token:")
    if (!token) return

    setLoading(true)
    addLog("Starting Vercel deployment...")

    try {
      const res = await fetch("/api/vercel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.reduce((acc, file) => ({ ...acc, [file.filePath]: file.content }), {}),
          projectName: currentProject?.name || "my-project",
          token,
          sandboxId,
        }),
      })

      const data = await res.json()
      if (data.success) {
        addLog(`✅ Successfully deployed to Vercel: ${data.url}`)
      } else {
        addLog(`❌ Vercel deployment failed: ${data.error}`)
      }
    } catch (err: any) {
      addLog(`❌ Vercel deployment error: ${err.message}`)
    } finally {
      setLoading(false)
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
    <div className="flex h-screen bg-[#0a0a0a] font-sans text-white">
      {/* Left Sidebar - File Explorer & Change History */}
      <div className="w-80 bg-[#0a0a0a] h-full flex flex-col border-r border-[#1f1f1f]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 flex-shrink-0 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#ff5f57] rounded-full"></div>
            <div className="w-3 h-3 bg-[#ffbd2e] rounded-full"></div>
            <div className="w-3 h-3 bg-[#28ca42] rounded-full"></div>
          </div>
          <span className="text-sm text-gray-400">Brillance Studio</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white">
              <Settings className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white">
              <Database className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-white">
              <Rocket className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Project Selector */}
        <div className="px-4 py-3 border-b border-[#1f1f1f]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">{currentProject?.name || "No Project"}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={createNewProject}
              className="h-6 w-6 text-gray-400 hover:text-white"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {projects.length > 0 && (
            <select
              onChange={(e) => loadProject(e.target.value)}
              value={currentProject?.id || ""}
              className="w-full mt-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-gray-300"
            >
              <option value="" disabled>
                Select Project
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Change History Section */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 border-b border-[#1f1f1f]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Change History</span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </div>
          </div>

          {/* Current Change */}
          <div className="px-4 py-3 border-b border-[#1f1f1f]">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <span className="text-sm text-white">Ongoing change</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              {analysisStatus ||
                "Create a real-time chat application that lets you send and receive messages using a streaming API. Use a retro 80s hacker theme."}
            </p>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 mb-3">
              <Button
                onClick={() => runAction("create")}
                disabled={loading}
                size="sm"
                className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs px-3 py-1 h-7"
              >
                Create new chat with streaming API
              </Button>
            </div>

            {/* File List */}
            <div className="space-y-1">
              {files.map((file, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                  <File className="h-3 w-3 text-gray-400" />
                  <span className="text-gray-300">{file.filePath}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Files Section */}
          <div className="flex-1">
            <div className="px-4 py-2 border-b border-[#1f1f1f]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Files</span>
                <FolderOpen className="h-3 w-3 text-gray-400" />
              </div>
            </div>
            <ScrollArea className="flex-1 px-4 py-2">
              <div className="space-y-1">
                {files.map((file, index) => (
                  <button
                    key={index}
                    className={`w-full text-left text-xs p-2 rounded transition-colors flex items-center gap-2 ${
                      activeFile === index ? "bg-[#1a1a1a] text-white" : "hover:bg-[#1a1a1a] text-gray-400"
                    }`}
                    onClick={() => setActiveFile(index)}
                  >
                    <File className="h-3 w-3" />
                    {file.filePath}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Chat Input - Bottom */}
        <div className="p-4 border-t border-[#1f1f1f] bg-[#0a0a0a]">
          {analysisStatus && <p className="text-xs text-gray-400 mb-2 animate-pulse">{analysisStatus}</p>}

          {artifacts.length > 0 && (
            <div className="mb-3 space-y-2">
              {artifacts.slice(-3).map((artifact) => (
                <div key={artifact.id} className="flex items-center gap-2 text-xs bg-[#1a1a1a] rounded p-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      artifact.status === "processing"
                        ? "bg-yellow-500 animate-pulse"
                        : artifact.status === "completed"
                          ? "bg-green-500"
                          : "bg-red-500"
                    }`}
                  ></div>
                  <span className="text-gray-300">{artifact.title}</span>
                  {artifact.progress !== undefined && artifact.status === "processing" && (
                    <div className="ml-auto text-gray-400">{artifact.progress}%</div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <textarea
              placeholder={currentProject ? "What's next?" : "Create a project first..."}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 pr-12 text-sm text-white placeholder:text-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-gray-600 focus:border-gray-600"
              rows={2}
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
              className="absolute right-2 top-2 bg-transparent hover:bg-[#2a2a2a] text-white p-2 h-8 w-8"
              onClick={() => sendChat()}
              disabled={loading || !chatInput || !currentProject}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full flex flex-col bg-[#0a0a0a]">
        {/* Top Navigation */}
        <div className="flex items-center justify-between px-6 h-12 flex-shrink-0 border-b border-[#1f1f1f]">
          {/* Tab Navigation */}
          <div className="flex items-center gap-1">
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="sm"
              className={`text-xs px-3 py-1 h-7 ${
                activeTab === "code"
                  ? "bg-[#1a1a1a] text-white border border-[#2a2a2a]"
                  : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
              }`}
              onClick={() => setActiveTab("code")}
            >
              Code
            </Button>
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="sm"
              className={`text-xs px-3 py-1 h-7 ${
                activeTab === "preview"
                  ? "bg-[#1a1a1a] text-white border border-[#2a2a2a]"
                  : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
              }`}
              onClick={() => setActiveTab("preview")}
            >
              Preview
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-3 py-1 h-7 text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
            >
              Architecture
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-3 py-1 h-7 text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
            >
              Infrastructure
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-3 py-1 h-7 text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
            >
              Service Catalog
            </Button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-white"
              onClick={deployToGitHub}
              disabled={loading || !files.length}
            >
              <Github className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-3 py-1 h-7 text-gray-400 hover:text-white border border-[#2a2a2a]"
            >
              Reset database
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 h-7"
              onClick={deployToVercel}
              disabled={loading || !files.length}
            >
              Deploy
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex">
          {/* Code Editor */}
          <div className="flex-1 flex flex-col">
            {activeTab === "code" ? (
              <div className="flex-1 flex">
                {/* File Tree */}
                <div className="w-64 border-r border-[#1f1f1f] bg-[#0a0a0a]">
                  <div className="p-3 border-b border-[#1f1f1f]">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-300">frontend</span>
                      <ChevronDown className="h-3 w-3 text-gray-400 ml-auto" />
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1">
                      {files.map((file, index) => (
                        <button
                          key={index}
                          className={`w-full text-left text-xs p-2 rounded flex items-center gap-2 ${
                            activeFile === index
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "text-gray-400 hover:text-white hover:bg-[#1a1a1a]"
                          }`}
                          onClick={() => setActiveFile(index)}
                        >
                          <File className="h-3 w-3" />
                          {file.filePath.split("/").pop()}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Code Editor */}
                <div className="flex-1 bg-[#0a0a0a]">
                  <div className="h-8 border-b border-[#1f1f1f] flex items-center px-4">
                    <span className="text-xs text-gray-400">{files[activeFile]?.filePath || "No file selected"}</span>
                  </div>
                  <CodeMirror
                    value={files[activeFile]?.content || ""}
                    height="calc(100% - 32px)"
                    theme="dark"
                    extensions={[javascript({ jsx: true, typescript: true })]}
                    onChange={updateFile}
                    className="h-full"
                  />
                </div>
              </div>
            ) : (
              /* Preview */
              <div className="flex-1 bg-[#0a0a0a] p-4">
                <div className="h-full bg-white rounded-lg border border-[#2a2a2a] overflow-hidden">
                  {previewUrl ? (
                    <iframe
                      ref={iframeRef}
                      src={previewUrl}
                      className="w-full h-full border-0"
                      title="Sandbox Preview"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400">
                      <p>Create a sandbox and start the server to see preview</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Panel - BUILD/LOGS/TESTS */}
        <div className="h-64 border-t border-[#1f1f1f] bg-[#0a0a0a] flex flex-col">
          {/* Tab Bar */}
          <div className="flex items-center justify-between px-4 h-10 border-b border-[#1f1f1f]">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs px-3 py-1 h-6 ${
                  activeBottomTab === "build"
                    ? "text-white bg-[#1a1a1a] border border-[#2a2a2a]"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => setActiveBottomTab("build")}
              >
                BUILD
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs px-3 py-1 h-6 ${
                  activeBottomTab === "logs"
                    ? "text-white bg-[#1a1a1a] border border-[#2a2a2a]"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => setActiveBottomTab("logs")}
              >
                LOGS
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`text-xs px-3 py-1 h-6 ${
                  activeBottomTab === "tests"
                    ? "text-white bg-[#1a1a1a] border border-[#2a2a2a]"
                    : "text-gray-400 hover:text-white"
                }`}
                onClick={() => setActiveBottomTab("tests")}
              >
                TESTS
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-xs text-gray-400">Backend</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-xs text-gray-400">Frontend</span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-4">
            {activeBottomTab === "build" && (
              <>
                {buildLogs.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm">No build messages</div>
                ) : (
                  <ScrollArea className="h-32 bg-[#1a1a1a] rounded border border-[#2a2a2a] p-3">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap">{buildLogs.join("\n")}</pre>
                  </ScrollArea>
                )}
              </>
            )}

            {activeBottomTab === "logs" && (
              <>
                {logs.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm">No log messages</div>
                ) : (
                  <ScrollArea className="h-32 bg-[#1a1a1a] rounded border border-[#2a2a2a] p-3">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap">{logs.join("\n")}</pre>
                  </ScrollArea>
                )}
              </>
            )}

            {activeBottomTab === "tests" && <div className="text-center text-gray-400 text-sm">No test results</div>}

            {/* Action Buttons */}
            <div className="flex items-center gap-2 mt-4">
              <Button
                onClick={() => runAction("create")}
                disabled={loading}
                size="sm"
                className="bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white text-xs px-3 py-1 h-7 border border-[#2a2a2a]"
              >
                Create
              </Button>
              <Button
                onClick={() => runAction("install")}
                disabled={loading || !sandboxId}
                size="sm"
                className="bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white text-xs px-3 py-1 h-7 border border-[#2a2a2a]"
              >
                Install
              </Button>
              <Button
                onClick={() => runAction("build")}
                disabled={loading || !sandboxId}
                size="sm"
                className="bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white text-xs px-3 py-1 h-7 border border-[#2a2a2a]"
              >
                Build
              </Button>
              <Button
                onClick={() => runAction("start")}
                disabled={loading || !sandboxId}
                size="sm"
                className="bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white text-xs px-3 py-1 h-7 border border-[#2a2a2a]"
              >
                Start
              </Button>
              <Button
                onClick={() => runAction("addFiles")}
                disabled={loading || !sandboxId}
                size="sm"
                className="bg-[#1a1a1a] hover:bg-[#2a2a2a] text-white text-xs px-3 py-1 h-7 border border-[#2a2a2a]"
              >
                <HardDrive className="h-3 w-3 mr-1" />
                Save to Sandbox
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
