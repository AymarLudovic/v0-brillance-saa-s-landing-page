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
  Image,
  Plus,
  Save,
  AtSign,
  ArrowUp,
  X,
  Sidebar,
  ChevronRight
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
  content: string // Le contenu brut qui continue de streamer
  artifactData?: { 
    type: 'files' | 'url' | 'fileChanges' | null // AJOUT de 'fileChanges'
    rawJson: string // Le contenu JSON extrait (peut être incomplet)
    parsedList: string[] // La liste des chemins de fichiers ou l'URL
  }
}



interface Project {
  id: string
  name: string
  createdAt: string
  files: { filePath: string; content: string }[]
  messages: Message[]
}
// Définition de l'interface pour un Nœud dans l'arborescence de fichiers


// --- NOUVELLES INTERFACES POUR L'ARBORESCENCE DE FICHIERS ---
interface FileTreeNode {
  name: string // Nom du dossier ou du fichier (ex: 'app' ou 'page.tsx')
  path: string // Chemin complet (pour l'action de clic)
  type: 'directory' | 'file'
  children?: FileTree // Présent uniquement si 'type' est 'directory'
  index?: number // Index dans le tableau 'files' original (pour savoir quel fichier éditer)
}

// Le type FileTree sera un Map pour des recherches rapides
type FileTree = Map<string, FileTreeNode>


// --- FONCTION DE CONSTRUCTION DE L'ARBORESCENCE (LOGIQUE PURE) ---

/**
 * Construit une structure d'arbre de fichiers (Map imbriquée) à partir d'une liste plate de fichiers.
 * @param files Le tableau d'objets fichiers ({ filePath: string, content: string }[]).
 * @returns La Map représentant le répertoire racine.
 */
const buildFileTree = (files: { filePath: string; content: string }[]): FileTree => {
  const root: FileTree = new Map()

  files.forEach((file, originalIndex) => {
    const parts = file.filePath.split('/')
    let currentNode = root
    let currentPath = ''

    parts.forEach((part, i) => {
      // Met à jour le chemin d'accès complet pour ce niveau
      currentPath = currentPath + (currentPath ? '/' : '') + part
      
      const isFile = i === parts.length - 1

      if (!currentNode.has(part)) {
        // Crée un nouveau nœud si non existant
        const newNode: FileTreeNode = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          // On crée une nouvelle Map d'enfants seulement si c'est un répertoire
          children: isFile ? undefined : new Map(),
          index: isFile ? originalIndex : undefined,
        }
        currentNode.set(part, newNode)
      }

      // Descend dans le nœud (si ce n'est pas le fichier final)
      if (!isFile) {
        currentNode = currentNode.get(part)!.children as FileTree
      }
    })
  })

  return root
}




/**
 * Extrait le contenu JSON brut (potentiellement incomplet) entre ```json et ```.
 * Si le bloc n'est pas fermé, il prend tout jusqu'à la fin de la chaîne.
 */
const extractRawJson = (content: string): string | null => {
  const startMatch = content.match(/```json\s*/)
  if (!startMatch) return null

  // Trouve l'index de début après '```json' et les espaces
  const startIndex = startMatch.index + startMatch[0].length
  const substringAfterStart = content.substring(startIndex)
  
  // Cherche le triple backtick de fermeture
  const endMatch = substringAfterStart.match(/\s*```/)

  if (endMatch) {
    // Le bloc est fermé, prend le contenu avant la fermeture
    return substringAfterStart.substring(0, endMatch.index)
  } else {
    // Le bloc est ouvert, prend tout jusqu'à la fin du stream
    return substringAfterStart
  }
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

const [showProjectSelect, setShowProjectSelect] = useState(false) // <-- AJOUTEZ CET ÉTAT
         
  const [showSidebar, setShowSidebar] = useState(false)

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setShowSidebar(false)
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}, [])
  

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



const parseMessageContent = (content: string) => {
  
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
  
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonContent = JSON.parse(jsonMatch[1])
      
      // 1. Détection de la structure de Fichiers (Création/Modification complète)
      if (
        Array.isArray(jsonContent) &&
        jsonContent.length > 0 &&
        typeof jsonContent[0] === 'object' &&
        'filePath' in jsonContent[0] &&
        'content' in jsonContent[0]
      ) {
        return {
          type: 'files',
          data: jsonContent.map((f: any) => f.filePath as string), 
          raw: content, 
        }
      } 
      // 2. Détection de la structure de Changements de Fichiers (Patch: fileChanges)
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'fileChanges' &&
        jsonContent.filePath
      ) {
        return {
          type: 'fileChanges', // Nouveau type
          data: [jsonContent.filePath as string], // Un seul fichier affecté
          raw: content, 
        }
      }
      // 3. Détection de l'URL d'inspiration
      else if (
        typeof jsonContent === 'object' &&
        jsonContent !== null &&
        jsonContent.type === 'inspirationUrl' &&
        jsonContent.url
      ) {
        return {
          type: 'url',
          data: jsonContent.url as string,
          raw: content,
        }
      }

    } catch (e) {
      // Ignorer l'erreur et afficher le contenu comme texte
    }
  }

  // 4. Cas par défaut: Contenu texte normal ou JSON mal formé/inconnu
  return {
    type: 'text',
    data: content,
  }
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


    
  const handleProjectClick = (projectId: string) => {
  if (currentProject) {
    saveProject()
  }
  loadProject(projectId)
  setShowSidebar(false)
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
      const finalPrompt = `User's original request: "${originalUserPrompt}"\n---\nAnalysis data from ${urlToAnalyze}:\nGlobal CSS Variables to use in globals.css:\n\`\`\`css\n:root {\n  ${globalCssVariables.map(v => `${v.name}: ${v.value};`).join("\n  ")}\n}\n\`\`\`\nFont Faces:\n${fontFaces}\n\nIsolated Components:\n${isolatedComponents.map(c => `// Component: ${c.name}\n${c.html}`).join("\n\n")}\n---\nPlease generate the code as asked above.`
      addLog("[AUTO-FLOW] Sending final prompt to Gemini for code generation.")
      await sendChat(finalPrompt)
    } catch (err: any) {
      addLog(`ERROR during automated analysis: ${err.message}`)
      setAnalysisStatus(`Erreur durant l'analyse: ${err.message}`)
    }
  }




  
      
        // --- MISE À JOUR DES MESSAGES DANS LE STATE ---

  
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
      let text = "" // Contenu brut total
      let isParsingJson = false // Indicateur pour savoir si le bloc JSON a commencé

      // Initialise le message de l'assistant avec l'artefact vide
      setMessages((prev) => [...prev, { role: "assistant", content: "", artifactData: { type: null, rawJson: "", parsedList: [] } }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        text += chunk
        
        let newArtifactData = undefined

        // Tente d'extraire le JSON brut (incomplet ou complet)
        const rawJsonContent = extractRawJson(text)
        
        if (rawJsonContent !== null) {
            isParsingJson = true
            let currentType: 'files' | 'url' | 'fileChanges' | null = null
            let currentList: string[] = []
            
            // Tente de parser le JSON incrémental
            try {
                const parsedJson = JSON.parse(rawJsonContent)
                
                // 1. Détection de la structure de Fichiers (Création/Modification complète)
                if (
                    Array.isArray(parsedJson) &&
                    parsedJson.length > 0 &&
                    typeof parsedJson[0] === 'object' &&
                    'filePath' in parsedJson[0] &&
                    'content' in parsedJson[0]
                ) {
                    currentType = 'files'
                    currentList = parsedJson.map((f: any) => f.filePath as string)
                } 
                // 2. Détection de la structure de Changements de Fichiers (Patch: fileChanges)
                else if ( 
                    typeof parsedJson === 'object' &&
                    parsedJson !== null &&
                    parsedJson.type === 'fileChanges' &&
                    parsedJson.filePath 
                ) {
                    currentType = 'fileChanges'
                    // On prend le chemin de fichier affecté
                    currentList = [parsedJson.filePath as string]
                } 
                // 3. Détection de l'URL d'inspiration
                else if (
                    typeof parsedJson === 'object' &&
                    parsedJson !== null &&
                    parsedJson.type === 'inspirationUrl' &&
                    parsedJson.url
                ) {
                    currentType = 'url'
                    currentList = [parsedJson.url]
                }
                
                // Si parsing réussi et structure reconnue, on prépare la mise à jour
                newArtifactData = {
                    type: currentType,
                    rawJson: rawJsonContent,
                    parsedList: currentList,
                }
                
            } catch (e) {
                // Le JSON est incomplet ou mal formé. On met à jour rawJson
                newArtifactData = { rawJson: rawJsonContent } 
            }
        }
        
        // --- MISE À JOUR DES MESSAGES DANS LE STATE ---

        setMessages((prev) => {
            const lastMsgIndex = prev.length - 1
            const updatedMessages = [...prev]
            const lastMsg = updatedMessages[lastMsgIndex]
            
            if (lastMsg?.role === "assistant") {
                if (newArtifactData || isParsingJson) {
                    // On fusionne l'état précédent avec le nouvel état
                    lastMsg.artifactData = {
                        ...lastMsg.artifactData, 
                        ...newArtifactData, 
                        rawJson: rawJsonContent || "" // Assure que rawJson est toujours mis à jour
                    } as any 
                }
                
                // Met toujours à jour le contenu brut pour le streaming
                lastMsg.content = text
            }
            return updatedMessages
        })
      } // Fin de la boucle while
      
      // --- LOGIQUE POST-STREAM (Action finale) ---
      
      // On utilise la fonction de parsing standard pour trouver l'artefact final complet
      const finalParsedContent = parseMessageContent(text); 

      if (finalParsedContent.type === 'url') {
        const url = finalParsedContent.data as string
        addLog(`✅ Gemini suggests inspiration URL: ${url}`)
        await runAutomatedAnalysis(url, userPrompt)
        return
      }

      // Traitement des fichiers (pour files et fileChanges).
      if (finalParsedContent.type === 'files' || finalParsedContent.type === 'fileChanges') {
        addLog("Response contains code, applying changes.")
        // On appelle la fonction de modification avec le texte brut complet
        fillFilesFromGeminiResponse(text)
      } else {
        addLog("Response treated as simple text or unrecognized format.")
      }

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


// --- NOUVELLE FONCTION D'ANALYSE DU CONTENU ---


            // --- INTERFACE ET COMPOSANT RÉCURSIF (À L'INTÉRIEUR DE SandboxPage) ---
interface FileTreeItemProps {
  node: FileTreeNode
  activeFile: number | null
  setActiveFile: (index: number) => void
}

/**
 * Composant pour afficher un seul fichier ou dossier dans l'arborescence.
 * Utilise la récursivité pour afficher les sous-dossiers.
 */
const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, activeFile, setActiveFile }) => {
  // useState pour gérer l'ouverture/fermeture des dossiers
  const [isOpen, setIsOpen] = useState(true)
  
  // Icônes nécessaires (assurez-vous d'avoir Code et ChevronRight importés depuis 'lucide-react')
  // J'utilise Code pour tous les fichiers pour simplifier.
  const isDirectory = node.type === 'directory'
  const isCurrentlyActive = node.index !== undefined && activeFile === node.index

  return (
    <li>
      <button
        className={`w-full text-left text-sm py-1.5 px-2 rounded-lg flex items-center gap-2 transition-colors ${
          isCurrentlyActive
            ? "bg-[#37322F] text-white" 
            : "hover:bg-[#F7F5F3] text-[#37322F]/80"
        }`}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen) // Ouvre/Ferme le dossier
          } else if (node.index !== undefined) {
            setActiveFile(node.index) // Ouvre le fichier
          }
        }}
      >
        {/* Icône de flèche pour les dossiers */}
        {isDirectory && (
          <ChevronRight 
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} 
            style={{ minWidth: '1rem' }} // Force la taille pour l'alignement
          />
        )}
        {/* Icône de fichier pour les fichiers */}
        {!isDirectory && <Code className="h-4 w-4 opacity-75" style={{ minWidth: '1rem', marginLeft: isDirectory ? '0' : '1.5rem' }} />} 

        <span className="truncate">{node.name}</span>
      </button>

      {/* Rendu récursif des enfants */}
      {isDirectory && isOpen && node.children && (
        <ul className="pl-3 mt-1 space-y-1">
          {Array.from(node.children.entries())
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
              // Trie les dossiers en premier, puis par ordre alphabétique
              if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
              if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
              return nameA.localeCompare(nameB);
            })
            .map(([key, childNode]) => (
              <FileTreeItem
                key={key}
                node={childNode}
                activeFile={activeFile}
                setActiveFile={setActiveFile}
              />
            ))}
        </ul>
      )}
    </li>
  )
}
  


  
const fileTree = buildFileTree(files)
        
  // -------------------
  // LE RETURN DU JSX (ne pas mettre d'accolade fermante avant !)
  // -------------------
  return (
    <div className="flex h-screen bg-[#F7F5F3] font-sans text-[#37322F]">
      <div className="w-[40%] bg-[#F7F5F3] h-full flex flex-col border-r border-[rgba(55,50,47,0.12)]">
        <div className="flex items-center justify-between px-6 h-12 flex-shrink-0  border-[rgba(55,50,47,0.12)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
<div className="relative">
  {/* Bouton AFFICHEUR/Déclencheur (Imite le champ select) */}
  <button
    onClick={() => setShowProjectSelect(!showProjectSelect)}
    className="flex items-center gap-1 text-sm bg-transparent border-none focus:ring-0 font-medium max-w-[150px] text-[#37322F] hover:bg-[#F7F5F3] p-1 rounded-md transition-colors"
  >
    {/* Affiche le nom du projet actuel ou le texte par défaut */}
    <div className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-7 md:w-7 md:h-7 lg:w-8 lg:h-8 relative shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[12px]">
                            <img src="/horizon-icon.svg" alt="Horizon" className="w-full h-full object-contain" />
                          </div>
    <span className="truncate">
      {currentProject?.name || "Select a Project"}
    </span>
    <ChevronsUpDown className="h-4 w-4 text-[rgba(55,50,47,0.6)]" />
  </button>

  {/* Conteneur du Menu Déroulant (Imite les <option>) */}
  {showProjectSelect && (
    <div className="absolute z-50 top-full mt-1 left-0 bg-[#E3DFDB] border border-[rgba(55,50,47,0.08)] shadow-lg rounded-[12px] min-w-[300px] max-h-70 overflow-y-auto">
      {projects.map((p) => (
        <button
          key={p.id}
          // LOGIQUE CLÉ : Appelle loadProject directement, puis ferme le menu
          onClick={() => {
            if (currentProject) {
              saveProject()
            }
            loadProject(p.id)
            setShowProjectSelect(false) // Ferme le menu après la sélection
          }}
          className={`w-full text-left p-3 text-sm hover:bg-[#F7F5F3] flex items-center gap-1 ${
            currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : ""
          }`}
        >
          <div className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-7 md:w-7 md:h-7 lg:w-8 lg:h-8 relative shadow-[0px_-4px_8px_rgba(255,255,255,0.64)_inset] overflow-hidden rounded-[12px]">
                            <img src="/horizon-icon.svg" alt="Horizon" className="w-full h-full object-contain" />
                          </div>
          {p.name}
        </button>
      ))}
      
      {/* Option "Select a Project" désactivée/par défaut */}
      {projects.length === 0 && (
        <div className="p-3 text-sm text-[rgba(55,50,47,0.6)]">
          No projects available.
        </div>
      )}
    </div>
  )}
</div>
     </div>   

            
            
          </div>
          <div className="flex items-center">
            
            <Button
              variant="ghost"
              size="icon"
              onClick={createNewProject}
              className="bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[24px] w-[24px] rounded-[12px] flex items-center justify-center p-1"
              
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
              
              Save Project
            </Button>
          </div>
        </div>

        <div className="flex-grow overflow-y-auto relative">
          <ScrollArea className="absolute overflow-y-auto inset-0 p-6" viewportRef={chatScrollAreaRef}>
            <div className="space-y-6 pb-4">
              
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}

        
                    {messages.map((msg, index) => {
  const artifact = msg.artifactData;
  
  // Fallback à l'ancienne logique de parsing si pas d'état progressif
  const parsedContent = artifact ? null : parseMessageContent(msg.content);
  
  return (
    <div
      key={index}
      className={`flex flex-col items-start gap-3 ${msg.role === "user" ? "items-end" : "items-start"}`}
    >
      {/* Affichage de l'icône de l'assistant */}
      {msg.role === "assistant" && (
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 bg-[#37322F] rounded-full flex items-center justify-center">
            <svg
              className="h-[18px] w-[18px]"
              xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <circle cx="12" cy="12" r="10" />
            </svg>
          </div>
        </div>
      )}
      
      {/* Conteneur du message (bulle) */}
      <div
        className={`p-2 rounded-xl max-w-xl ${
          msg.role === "user"
            ? "bg-[#37322F] text-white self-end border-[#37322F]"
            : "bg-none text-[#37322F] self-start"
        }`}
      >
        {/* --- LOGIQUE D'AFFICHAGE DU CONTENU STREAMÉ / ARTEFACT --- */}
        {(() => {
          
          // --- Cas 1: ARTEFACT STREAMÉ (PRIORITAIRE) ---
          if (artifact && (artifact.type === 'files' || artifact.type === 'fileChanges')) {
            
            // Calcul du nombre de chemins de fichiers à afficher en fonction de la progression du JSON
            const totalFiles = artifact.parsedList.length;
            // Une unité de progression pour chaque 100 caractères de JSON (ajustez 100 pour accélérer/ralentir)
            const progressUnit = 100; 
            const progressCount = Math.min(
                totalFiles, 
                Math.floor(artifact.rawJson.length / progressUnit) + 1 
            );

            const title = artifact.type === 'files' 
              ? 'Building code' 
              : 'Building code';
              
            return (
              <div className="p-3 bg-[#F7F5F3] border border-[rgba(55,50,47,0.1)] rounded-lg w-full">
                <p className="text-sm font-semibold mb-1 flex items-center gap-1 text-[#37322F]">
                  {title}
                  </p>
                <ul className="list-disc pl-5 w-[100%] space-y-1">
                  {/* Rendu progressif des chemins de fichiers */}
                  {artifact.parsedList
                    .slice(0, progressCount) // Limite l'affichage au progressCount
                    .map((filePath, i) => ( 
                    <li key={i} className="text-xs w-full list-style-none  flex items-center gap-1 text-[#37322F]/80">
                      <span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M560-80v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T903-300L683-80H560Zm300-263-37-37 37 37ZM620-140h38l121-122-18-19-19-18-122 121v38ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v120h-80v-80H520v-200H240v640h240v80H240Zm280-400Zm241 199-19-18 37 37-18-19Z"/></svg>
                      </span>
                      <p>created</p>
                      <span className="bg-[#E3DFDB] py-[3px] rounded-[8px] font-semibold px-[12px]">{filePath}</span>
                      
                    </li>
                  ))}
                  {/* Affiche l'indicateur tant que la liste n'est pas complète ou que le bloc n'est pas fermé */}
                  {(progressCount < totalFiles || !msg.content.includes('```')) && (
                     <li className="text-xs text-[#37322F]/60 italic">
                       Building... ({progressCount} / {totalFiles} chemins trouvés)
                     </li>
                  )}
                </ul>
              </div>
            );
          }
          
          // --- Cas 2: ARTEFACT URL STREAMÉ ---
          if (artifact && artifact.type === 'url' && artifact.parsedList.length > 0) {
              const url = artifact.parsedList[0]
              return (
                <div className="p-3 bg-[#F7F5F3] border border-[rgba(55,50,47,0.1)] rounded-lg w-full">
                  <p className="text-sm font-semibold mb-1 flex items-center gap-1 text-[#37322F]">
                    Designing process
                  </p>
                  <div className="h-[8px] w-full rounded-[8px] bg-[#E3DFDB]"></div>
                  
                </div>
              );
          }

          // --- Cas 3: FALLBACK ANCIENNE LOGIQUE ou TEXTE SIMPLE ---
          const displayContent = parsedContent || { type: 'text', data: msg.content };

          switch (displayContent.type) {
            case 'files':
            case 'fileChanges':
            case 'url':
              // Fallback pour les messages non streamés (messages passés, erreurs)
              const isUrl = displayContent.type === 'url';
              const isFiles = displayContent.type === 'files' || displayContent.type === 'fileChanges';

              return (
                <div className="p-3 bg-[#F7F5F3] border border-[rgba(55,50,47,0.1)] rounded-lg w-full">
                  <p className="text-sm font-semibold mb-2 flex items-center gap-1 text-[#37322F]">
                    
                    {isUrl ? 'Designing process ' : 'Building code '}
                  </p>
                  <ul className="list-disc pl-1 space-y-1 w-[90%]">
                    {Array.isArray(displayContent.data) ? displayContent.data.map((item, i) => (
                      <li key={i} className="text-xs w-full list-style-none  flex items-center gap-1 text-[#37322F]/80">
                        <span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f"><path d="M560-80v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T903-300L683-80H560Zm300-263-37-37 37 37ZM620-140h38l121-122-18-19-19-18-122 121v38ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v120h-80v-80H520v-200H240v640h240v80H240Zm280-400Zm241 199-19-18 37 37-18-19Z"/></svg>
                      </span>
                      <p>Edited</p>
                          <span className="bg-[#E3DFDB] py-[3px] rounded-[8px] px-[12px] font-semibold">{item}</span>
                      
                        
                      </li>
                    )) : (
                      <div className="h-[8px] w-full rounded-[8px] bg-[#E3DFDB]"></div>
                    )}
                  </ul>
                </div>
              );

            case 'text':
            default:
              // Nettoyage: On retire le bloc JSON (même incomplet) si l'artefact a été détecté par le stream
              let textContent = msg.content;
              if (artifact && (artifact.type || artifact.rawJson)) {
                  // Retire le bloc JSON (même s'il est incomplet: ```json... jusqu'à ``` ou fin)
                  textContent = msg.content.replace(/```json[\s\S]*?(\s*```|$)/g, '').trim();
              } else if (displayContent.raw) {
                  // Fallback pour le contenu non streamé (utilise la propriété raw de l'ancienne fonction)
                  textContent = displayContent.raw.replace(/```json\s*[\s\S]*?\s*```/g, '').trim() || displayContent.raw.trim();
              }
              
              return (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {textContent}
                </pre>
              );
          }
        })()}
      </div>
    </div>
  );
})}
          
          

          
                
                  {/* --- DEBUT DU BLOC messages.map (Ligne ~580) --- */}                
                            
            </div>
          </ScrollArea>
        </div>

        

<div className="p-1 h-[300px] border-[rgba(55,50,47,0.12)] flex-shrink-0">
  {analysisStatus && <p className="text-sm text-[rgba(55,50,47,0.60)] mb-3 animate-pulse">{analysisStatus}</p>}
  <div className="relative p-2 flex flex-col h-[210px]">
    <div className=" flex flex-col h-[20%] rounded-t-[10px] bg-transparent w-full">
     <div className="w-full h-full flex items-center justify-center">
        <div className="w-[95%] p-1 rounded-t-[8px] bg-[#E3DFDB] h-full p-[2px] flex items-center border border-[rgba(55,50,47,0.12)] gap-1">
        <div className="w-auto p-1 h-[25px] border border-black rounded-[12px] flex items-center gap-1 justify-center">
          <svg className="h-[16px] w-[16px]" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#1f1f1f"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Zm0-82q26-36 45-75t31-83H404q12 44 31 83t45 75Zm-104-16q-18-33-31.5-68.5T322-320H204q29 50 72.5 87t99.5 55Zm208 0q56-18 99.5-55t72.5-87H638q-9 38-22.5 73.5T584-178ZM170-400h136q-3-20-4.5-39.5T300-480q0-21 1.5-40.5T306-560H170q-5 20-7.5 39.5T160-480q0 21 2.5 40.5T170-400Zm216 0h188q3-20 4.5-39.5T580-480q0-21-1.5-40.5T574-560H386q-3 20-4.5 39.5T380-480q0 21 1.5 40.5T386-400Zm268 0h136q5-20 7.5-39.5T800-480q0-21-2.5-40.5T790-560H654q3 20 4.5 39.5T660-480q0 21-1.5 40.5T654-400Zm-16-240h118q-29-50-72.5-87T584-782q18 33 31.5 68.5T638-640Zm-234 0h152q-12-44-31-83t-45-75q-26 36-45 75t-31 83Zm-200 0h118q9-38 22.5-73.5T376-782q-56 18-99.5 55T204-640Z"/></svg>
          <p className="text-sm">Clone website</p>
        </div>
          <div className="w-auto p-1 h-[25px] border border-black rounded-[8px] flex items-center justify-center">
          
          <p className="text-sm">Connect database</p>
        </div>
      </div>
     </div>
    </div>
    <div className="w-full h-[60%] border-b-none border-t border-l border-r border-[rgba(55,50,47,0.12)] p-2 rounded-t-[8px]">
      <textarea
      placeholder={currentProject ? "Describe what to build..." : "Please create or select a project first."}
      className="h-full w-full rounded-[8px] border-none outline-none resize-none bg-none"
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
    </div>
    <div className="w-full p-2 rounded-b-[8px] h-[20%] border-b border-l border-r border-t-none border-[rgba(55,50,47,0.12)] p-[2px] flex items-center justify-between gap-1">
        <div className="flex pl-1 items-center gap-1 mb-1">
          <div className="w-[25px] p-1 h-[25px] border border-black rounded-[8px] flex items-center justify-center">
          <Plus size={16} />
        </div>
        <div className="w-auto p-1 h-[20px] border border-black rounded-[12px] flex items-center justify-center">
          <AtSign size={16} />
          <p className="text-sm">Mention</p>
        </div>
        </div>
      <div className="flex pr-1 items-center gap-1 mb-1">
        <div className="h-[22px] w-[22px] relative -bottom-[2px]">
          <Image size={16} />
        </div>
        <Button
      className=" bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)] text-white h-[24px] w-[24px] rounded-full flex items-center justify-center p-1"
      onClick={() => sendChat()}
      disabled={loading || !chatInput || !currentProject}
    >
      <ArrowUp size={16} /> 
    </Button>
      </div>
      </div>
  </div>
</div>
</div>
      

        
          
      <div className="w-[60%] h-full flex flex-col bg-white">
        <div className="flex items-center justify-between p-4 flex-shrink-0 h-12 border-b border-[rgba(55,50,47,0.12)]">
          <div className="bg-[#F7F5F3] rounded-xl h-10 flex items-center p-1 border border-[rgba(55,50,47,0.12)]">
            <Button
              variant={activeTab === "preview" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "preview" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("preview")}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant={activeTab === "code" ? "secondary" : "ghost"}
              size="icon"
              className={`h-7 w-7 rounded-lg ${activeTab === "code" ? "bg-white shadow-sm" : "text-[rgba(55,50,47,0.60)] hover:text-[#37322F]"}`}
              onClick={() => setActiveTab("code")}
            >
              <Code className="h-4 w-4" />
            </Button>
          </div>

          

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4">
              <button
                className="flex items-center justify-center rounded-xl border border-[rgba(55,50,47,0.12)] bg-white p-2 hover:bg-[#F7F5F3] transition-colors h-8 w-8"
                aria-label="GitHub"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#37322F" className="h-[18px] w-[18px]" viewBox="0 0 16 16">
  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/>
</svg>
                
              </button>
              <button className="rounded-full text-white flex items-center justify-center transition hover:brightness-90 h-8 px-6 bg-[#37322F] hover:bg-[rgba(55,50,47,0.90)]">
                Deploy
              </button>
            </div>
          </div>
        </div>

        <div className="w-full h-[calc(100%-64px)] bg-[#F7F5F3] flex flex-col">

        <div className="flex items-center justify-center gap-2 border border-[rgba(55,50,47,0.12)]  p-1 w-full bg-[#F7F5F3]">
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


          
          {activeTab === "preview" ? (
            <div className="flex-grow flex flex-col overflow-hidden w-full h-full">
              <div className="flex-grow bg-white w-full border border-[rgba(55,50,47,0.12)] m-1 h-full  overflow-hidden">
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
                <ScrollArea className="w-full  " style={{ height: "calc(100% - 48px)" }}>
                  <p className="text-xs  whitespace-pre-wrap p-4">{logs.join("\n")}</p>
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
                // --- Remplacez l'ancien bloc ScrollArea par celui-ci ---
<ScrollArea className="h-[calc(100%-57px)] bg-[#E3DFDB] p-4">
    <ul className="space-y-1">
        {/* Démarre le rendu récursif à partir de la racine de l'arbre */}
        {Array.from(fileTree.entries()) 
            .sort(([nameA, nodeA], [nameB, nodeB]) => {
                // Trie les dossiers en premier à la racine
                if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
                if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
                return nameA.localeCompare(nameB);
            })
            .map(([key, node]) => (
                <FileTreeItem
                    key={key}
                    node={node}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                />
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


      {/* ---------- SIDEBAR OVERLAY ---------- */}
<div className={`fixed inset-0 z-40 pointer-events-none`}>
  {/* backdrop */}
  <div
    onClick={() => setShowSidebar(false)}
    className={`absolute inset-0 bg-black/40 transition-opacity ${showSidebar ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
  />
  {/* panel */}
  <aside
    className={`absolute left-0 top-0 h-full w-72 bg-white border-r border-[rgba(55,50,47,0.12)] transform transition-transform duration-200 shadow-lg
      ${showSidebar ? "translate-x-0" : "-translate-x-full"}
    `}
    aria-hidden={!showSidebar}
  >
    <div className="p-4 flex items-center justify-between border-b border-[rgba(55,50,47,0.08)]">
      <h3 className="text-sm font-medium">Projects</h3>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={createNewProject} className="h-8 w-8">
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setShowSidebar(false)} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div className="p-3 overflow-auto h-[calc(100%-56px)]">
      {projects.length === 0 ? (
        <p className="text-sm text-[rgba(55,50,47,0.6)]">No projects yet.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
  onClick={() => {
    // 1. Sauvegarde le projet actuel si nécessaire (copie de handleProjectClick)
    if (currentProject) {
      saveProject() 
    }
    // 2. Charge le nouveau projet (Imite directement l'appel du <select>)
    loadProject(p.id) 
    // 3. Ferme la sidebar
    setShowSidebar(false)
  }}
  className={`w-full text-left p-3 rounded-md flex flex-col ${
    currentProject?.id === p.id ? "bg-[#F7F5F3] font-semibold" : "hover:bg-[#F7F5F3]"
  }`}
>
ll
                </button>
                <div className="text-sm">{p.name}</div>
                <div className="text-xs text-[rgba(55,50,47,0.6)]">{new Date(p.createdAt).toLocaleString()}</div>
              
            </li>
          ))}
        </ul>
      )}
    </div>
  </aside>
</div>
        
    </div>
  )
}
