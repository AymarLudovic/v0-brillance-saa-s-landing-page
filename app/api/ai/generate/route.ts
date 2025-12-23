import { NextResponse } from "next/server"
import { generatePKG } from "@/lib/agents/pkgAgent"
import { planFromPKG } from "@/lib/agents/plannerAgent"
import { generateUI } from "@/lib/agents/uiAgent" // Importation nécessaire
import { generateBackend } from "@/lib/agents/backendAgent" // Importation nécessaire

type LogType = "step" | "info" | "error"
type Log = { type: LogType; message: string }

export async function POST(req: Request) {
  const logs: Log[] = []
  const generatedFiles: { path: string; content: string }[] = []

  const log = (type: LogType, message: string) => {
    console.log(`[${type.toUpperCase()}]`, message)
    logs.push({ type, message })
  }

  try {
    const body = await req.json()
    const { idea } = body
    const apiKey = process.env.GEMINI_API_KEY!

    log("step", "Running PKG agent")
    const fullPkgResponse = await generatePKG(idea, apiKey)
    
    // Attention : d'après tes logs, les données sont dans fullPkgResponse.pkg.pkg
    const actualPkg = (fullPkgResponse as any).pkg?.pkg || (fullPkgResponse as any).pkg || fullPkgResponse

    log("step", "Running Planner agent")
    const plan = planFromPKG(actualPkg)

    // --- NOUVEAU : GÉNÉRATION DE L'UI ---
    const pages = Object.keys(actualPkg.pages || {})
    log("step", `Generating UI for ${pages.length} pages...`)

    for (const pageName of pages) {
      log("info", `Generating UI for page: ${pageName}`)
      const stream = await generateUI(pageName, actualPkg, apiKey)
      
      let pageCode = ""
      for await (const chunk of stream.stream) {
        pageCode += chunk.text()
      }
      generatedFiles.push({ path: `app/${pageName}/page.tsx`, content: pageCode })
    }

    // --- NOUVEAU : GÉNÉRATION DU BACKEND ---
    log("step", "Generating Backend logic...")
    const beStream = await generateBackend(actualPkg, apiKey)
    let backendCode = ""
    for await (const chunk of beStream.stream) {
      backendCode += chunk.text()
    }
    generatedFiles.push({ path: `lib/backend.ts`, content: backendCode })

    log("step", "Generation pipeline completed successfully")

    return NextResponse.json({
      pkg: actualPkg,
      files: generatedFiles, // On renvoie les fichiers générés !
      logs,
    })

  } catch (err: any) {
    log("error", err?.message || "Unknown server error")
    return NextResponse.json({ error: err?.message, logs }, { status: 500 })
  }
      }
