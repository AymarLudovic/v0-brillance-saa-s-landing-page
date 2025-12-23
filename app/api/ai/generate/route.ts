import { NextResponse } from "next/server"
import { generatePKG } from "@/lib/agents/pkgAgent"
import { planFromPKG } from "@/lib/agents/plannerAgent"

export async function POST(req: Request) {
  const { idea } = await req.json()
  const apiKey = process.env.GEMINI_API_KEY!

  const pkg = await generatePKG(idea, apiKey)
  const plan = planFromPKG(pkg)

  return NextResponse.json({ pkg, plan })
}
