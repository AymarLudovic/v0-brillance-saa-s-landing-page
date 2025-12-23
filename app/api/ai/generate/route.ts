import { NextResponse } from "next/server"
import { generatePKG } from "@/lib/agents/pkgAgent"
import { planFromPKG } from "@/lib/agents/plannerAgent"

type LogType = "step" | "info" | "error"

type Log = {
  type: LogType
  message: string
}

export async function POST(req: Request) {
  const logs: Log[] = []

  const log = (type: LogType, message: string) => {
    console.log(`[${type.toUpperCase()}]`, message)
    logs.push({ type, message })
  }

  try {
    log("step", "API /ai/generate called")

    const body = await req.json()
    log("info", "Request body parsed")

    const { idea } = body

    if (!idea) {
      throw new Error("Missing idea in request body")
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing")
    }

    log("step", "Running PKG agent")
    const pkg = await generatePKG(idea, apiKey)

    log("step", "Running Planner agent")
    const plan = planFromPKG(pkg)

    log("step", "Generation pipeline completed")

    return NextResponse.json({
      pkg,
      plan,
      logs,
    })

  } catch (err: any) {
    log("error", err?.message || "Unknown server error")

    return NextResponse.json(
      {
        error: err?.message || "Unknown error",
        logs,
      },
      { status: 500 }
    )
  }
  }
      
