import { NextResponse } from "next/server"
import { generatePKG } from "@/lib/agents/pkgAgent"
import { planFromPKG } from "@/lib/agents/plannerAgent"
import { generateUI } from "@/lib/agents/uiAgent"
import { generateBackend } from "@/lib/agents/backendAgent"

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
    log("step", "API /ai/generate called")
    const body = await req.json()
    const { idea } = body
    const apiKey = process.env.GEMINI_API_KEY

    if (!apiKey) throw new Error("GEMINI_API_KEY missing")

    // 1. GENERATE PKG
    log("step", "Running PKG agent")
    const pkgResult = await generatePKG(idea, apiKey)
    
    // Sécurité pour extraire le bon objet PKG
    const actualPkg = (pkgResult as any).pkg?.pkg || (pkgResult as any).pkg || pkgResult
    
    if (!actualPkg.pages) {
      console.error("Structure PKG invalide:", pkgResult)
      throw new Error("Le PKG généré est incomplet (pas de pages trouvées)")
    }

    log("step", "Running Planner agent")
    const plan = planFromPKG(actualPkg)

    // 2. GENERATE UI PAGES
    const pages = Object.keys(actualPkg.pages)
    log("step", `Generating UI for ${pages.length} pages...`)

    for (const pageName of pages) {
      log("info", `Generating UI for: ${pageName}`)
      
      try {
        const result = await generateUI(pageName, actualPkg, apiKey)
        
        // VÉRIFICATION CRUCIALE : Le stream existe-t-il ?
        if (!result || !result.stream) {
          throw new Error(`No stream returned for page ${pageName}`)
        }

        let pageCode = ""
        for await (const chunk of result.stream) {
          const chunkText = chunk.text()
          pageCode += chunkText
        }
        
        generatedFiles.push({ 
          path: `app/${pageName}/page.tsx`, 
          content: pageCode 
        })
      } catch (uiErr: any) {
        log("error", `Failed UI for ${pageName}: ${uiErr.message}`)
      }
    }

    // 3. GENERATE BACKEND
    log("step", "Generating Backend logic...")
    try {
      const beResult = await generateBackend(actualPkg, apiKey)
      if (beResult && beResult.stream) {
        let backendCode = ""
        for await (const chunk of beResult.stream) {
          backendCode += chunk.text()
        }
        generatedFiles.push({ path: `lib/backend.ts`, content: backendCode })
      }
    } catch (beErr: any) {
      log("error", `Backend generation failed: ${beErr.message}`)
    }

    log("step", "Generation pipeline completed")

    return NextResponse.json({
      pkg: actualPkg,
      files: generatedFiles,
      logs,
    })

  } catch (err: any) {
    log("error", err?.message || "Unknown server error")
    return NextResponse.json({ error: err?.message, logs }, { status: 500 })
  }
  }
