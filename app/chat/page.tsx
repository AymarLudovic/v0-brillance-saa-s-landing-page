"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Paperclip, Edit3, MessageSquare, Plus, Settings, Play, RotateCcw } from "lucide-react"

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp?: Date
}

interface Project {
  id: string
  name: string
  messages: Message[]
  files: { filePath: string; content: string }[]
  createdAt: Date
}

interface Artifact {
  id: string
  title: string
  status: "processing" | "completed" | "error"
  progress?: number
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI coding assistant. I can help you build apps, websites, and more. What would you like to create today?",
      timestamp: new Date(),
    },
  ])
  const [chatInput, setChatInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [files, setFiles] = useState<{ filePath: string; content: string }[]>([])
  const [sandboxId, setSandboxId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const chatScrollRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    try {
      const savedProjects = localStorage.getItem("lovable-projects")
      if (savedProjects) {
        const parsedProjects = JSON.parse(savedProjects)
        setProjects(parsedProjects)
        if (parsedProjects.length > 0) {
          setCurrentProject(parsedProjects[0])
          setMessages(parsedProjects[0].messages || [])
          setFiles(parsedProjects[0].files || [])
        }
      }
    } catch (error) {
      console.error("Failed to load projects:", error)
    }
  }, [])

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  const createNewProject = () => {
    const newProject: Project = {
      id: Date.now().toString(),
      name: `Project ${projects.length + 1}`,
      messages: [
        {
          role: "assistant",
          content: "Hi! I'm your AI coding assistant. What would you like to build?",
          timestamp: new Date(),
        },
      ],
      files: [],
      createdAt: new Date(),
    }

    const updatedProjects = [newProject, ...projects]
    setProjects(updatedProjects)
    setCurrentProject(newProject)
    setMessages(newProject.messages)
    setFiles([])

    localStorage.setItem("lovable-projects", JSON.stringify(updatedProjects))
    addLog(`New project "${newProject.name}" created`)
  }

  const selectProject = (project: Project) => {
    setCurrentProject(project)
    setMessages(project.messages)
    setFiles(project.files || [])
    addLog(`Switched to project "${project.name}"`)
  }

  const sendMessage = async () => {
    if (!chatInput.trim() || loading) return

    const userMessage: Message = {
      role: "user",
      content: chatInput.trim(),
      timestamp: new Date(),
    }

    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setChatInput("")
    setLoading(true)

    addLog("Sending message to AI...")

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput.trim() }),
      })

      if (!response.ok || !response.body) {
        throw new Error("Failed to get AI response")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let aiResponse = ""

      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        aiResponse += chunk

        setMessages((prev) => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1].content = aiResponse
          return newMessages
        })
      }

      if (currentProject) {
        const finalMessages = [...updatedMessages, { role: "assistant", content: aiResponse, timestamp: new Date() }]
        const updatedProject = { ...currentProject, messages: finalMessages }
        const updatedProjects = projects.map((p) => (p.id === currentProject.id ? updatedProject : p))
        setProjects(updatedProjects)
        localStorage.setItem("lovable-projects", JSON.stringify(updatedProjects))
      }

      addLog("AI response received")
    } catch (error) {
      console.error("Chat error:", error)
      addLog(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const runSandbox = async () => {
    if (!files.length) {
      addLog("No files to run")
      return
    }

    setLoading(true)
    addLog("Starting sandbox...")

    try {
      const createResponse = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      })

      const createData = await createResponse.json()
      if (!createData.success) {
        throw new Error(createData.error || "Failed to create sandbox")
      }

      setSandboxId(createData.sandboxId)
      addLog(`Sandbox created: ${createData.sandboxId}`)

      const filesResponse = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addFiles",
          sandboxId: createData.sandboxId,
          files: files,
        }),
      })

      const filesData = await filesResponse.json()
      if (!filesData.success) {
        throw new Error(filesData.error || "Failed to add files")
      }

      addLog("Files added to sandbox")

      const installResponse = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          sandboxId: createData.sandboxId,
        }),
      })

      const installData = await installResponse.json()
      addLog(`Install ${installData.success ? "completed" : "failed"}`)

      const startResponse = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          sandboxId: createData.sandboxId,
        }),
      })

      const startData = await startResponse.json()
      if (startData.success && startData.url) {
        setPreviewUrl(startData.url)
        addLog(`Application started: ${startData.url}`)
      }
    } catch (error) {
      console.error("Sandbox error:", error)
      addLog(`Sandbox error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-white font-sans">
      <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-semibold text-gray-900">Brillance AI</h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={createNewProject}
              className="h-8 w-8 text-gray-500 hover:text-gray-700"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Button onClick={createNewProject} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Chat
          </Button>
        </div>

        {/* Project List */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => selectProject(project)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  currentProject?.id === project.id ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-100"
                }`}
              >
                <div className="font-medium text-gray-900 text-sm mb-1">{project.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {project.messages[project.messages.length - 1]?.content.slice(0, 60)}...
                </div>
                <div className="text-xs text-gray-400 mt-1">{project.createdAt.toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Settings */}
        <div className="p-4 border-t border-gray-200">
          <Button variant="ghost" className="w-full justify-start text-gray-600">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-6" ref={chatScrollRef}>
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  {message.timestamp && (
                    <div className={`text-xs mt-2 ${message.role === "user" ? "text-blue-100" : "text-gray-500"}`}>
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-gray-200 p-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end space-x-3">
              <Button variant="ghost" size="icon" className="h-10 w-10 text-gray-500 hover:text-gray-700">
                <Paperclip className="h-5 w-5" />
              </Button>

              <div className="flex-1 relative">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder="Ask Brillance to make anything..."
                  className="w-full resize-none border border-gray-300 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={1}
                  style={{ minHeight: "48px", maxHeight: "120px" }}
                />

                <Button
                  onClick={sendMessage}
                  disabled={!chatInput.trim() || loading}
                  size="icon"
                  className="absolute right-2 top-2 h-8 w-8 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>

              <Button variant="ghost" size="icon" className="h-10 w-10 text-gray-500 hover:text-gray-700">
                <Edit3 className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-96 bg-gray-50 border-l border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Preview</h2>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={runSandbox}
                disabled={loading || !files.length}
                className="h-8 w-8 text-gray-500 hover:text-gray-700"
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-gray-700">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 flex flex-col">
          {previewUrl ? (
            <iframe ref={iframeRef} src={previewUrl} className="flex-1 w-full border-0" title="Preview" />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-sm">No preview available</p>
                <p className="text-xs text-gray-400 mt-1">Start a conversation to see your app</p>
              </div>
            </div>
          )}
        </div>

        {/* Logs */}
        {logs.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-900 text-green-400 font-mono text-xs">
            <ScrollArea className="h-32 p-3">
              {logs.map((log, index) => (
                <div key={index} className="mb-1">
                  {log}
                </div>
              ))}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  )
}
