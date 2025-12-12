import { NextResponse } from "next/server"
import * as e2b from "@e2b/code-interpreter"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch((e) => {
      console.error("[v0] Failed to parse request JSON:", e)
      throw new Error("Invalid JSON in request body")
    })

    const { action, sandboxId: bodySandboxId, plan } = body || {}

    const apiKey = process.env.E2B_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "E2B_API_KEY manquant" }, { status: 500 })
    }

    console.log("[v0] Sandbox API called with action:", action)

    switch (action) {
      case "create": {
        console.log("[v0] Creating new sandbox...")
        const sandbox = await e2b.Sandbox.betaCreate({
          apiKey,
          timeoutMs: 900000, // 15 minutes
          autoPause: true, // Enable auto-pause to preserve sandbox state
        })

        // Create default Next.js structure
        const defaultPackageJson = {
          name: "nextjs-app",
          private: true,
          scripts: {
            dev: "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next start -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next: "14.2.3",
            react: "18.2.0",
            "react-dom": "18.2.0",
          },
        }

        await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPackageJson, null, 2))

        await sandbox.files.write(
          "/home/user/app/layout.tsx",
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`.trim(),
        )

        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
export default function Page() {
  return <h1>🚀 Hello depuis Next.js dans E2B</h1>;
}`.trim(),
        )

        console.log("[v0] Default Next.js structure created")
        return NextResponse.json({ sandboxId: sandbox.sandboxId })
      }

      case "applyPlan": {
        console.log("[v0] Applying plan to sandbox...")
        console.log("[v0] Plan received:", JSON.stringify(plan, null, 2))

        let sid: string | null = bodySandboxId || null
        let sandbox: e2b.Sandbox

        if (!sid) {
          console.log("[v0] No sandbox ID provided, creating new sandbox...")
          sandbox = await e2b.Sandbox.betaCreate({
            apiKey,
            timeoutMs: 900000, // 15 minutes
            autoPause: true,
          })
          sid = sandbox.sandboxId
        } else {
          console.log("[v0] Connecting to existing sandbox:", sid)
          sandbox = await e2b.Sandbox.connect(sid, {
            apiKey,
            timeoutMs: 900000, // 15 minutes
          })
          await sandbox.setTimeout(900000)
        }

        const hasCustomDeps = plan?.dependencies && Object.keys(plan.dependencies).length > 0
        const hasCustomDevDeps = plan?.devDependencies && Object.keys(plan.devDependencies).length > 0

        const packageJson = {
          name: "nextjs-app",
          private: true,
          scripts: {
            dev: "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next start -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next: "14.2.3",
            react: "18.2.0",
            "react-dom": "18.2.0",
            ...(hasCustomDeps ? plan.dependencies : {}),
          },
          ...(hasCustomDevDeps && { devDependencies: plan.devDependencies }),
        }

        console.log("[v0] Writing package.json:", JSON.stringify(packageJson, null, 2))
        await sandbox.files.write("/home/user/package.json", JSON.stringify(packageJson, null, 2))

        const globalsCss = `@import 'tailwindcss';

@theme inline {
  --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* Analyzed CSS from website */
${
  plan?.analyzedCss
    ? plan.analyzedCss
        .replace(/\/\*[\s\S]*?\*\//g, "") // Remove comments
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim()
    : ""
}
`
        console.log("[v0] Writing globals.css with Tailwind variables and cleaned analyzed CSS")
        await sandbox.files.write("/home/user/app/globals.css", globalsCss)

        if (!plan?.files?.["app/layout.tsx"]) {
          console.log("[v0] Writing default layout.tsx")
          await sandbox.files.write(
            "/home/user/app/layout.tsx",
            `import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`.trim(),
          )
        }

        if (Array.isArray(plan?.delete)) {
          for (const p of plan.delete) {
            try {
              console.log("[v0] Deleting file:", p)
              await sandbox.files.delete(`/home/user/${p}`)
            } catch (e) {
              console.log("[v0] Could not delete file:", p, e)
            }
          }
        }

        if (plan?.analyzedHtml && !plan?.files?.["app/page.tsx"]) {
          console.log("[v0] Converting analyzed HTML to JSX for page.tsx")

          try {
            // Clean and convert HTML to JSX with better error handling
            let jsxContent = plan.analyzedHtml
              .replace(/<!--[\s\S]*?-->/g, "") // Remove comments
              .replace(/<script[\s\S]*?<\/script>/gi, "") // Remove script tags
              .replace(/<style[\s\S]*?<\/style>/gi, "") // Remove style tags
              .replace(/class=/g, "className=")
              .replace(/for=/g, "htmlFor=")
              .replace(/tabindex=/g, "tabIndex=")
              .replace(/readonly=/g, "readOnly=")
              .replace(/maxlength=/g, "maxLength=")
              .replace(/minlength=/g, "minLength=")
              .replace(/contenteditable=/g, "contentEditable=")
              .replace(/spellcheck=/g, "spellCheck=")
              .replace(/autocomplete=/g, "autoComplete=")
              .replace(/autofocus=/g, "autoFocus=")
              .replace(/autoplay=/g, "autoPlay=")
              .replace(/crossorigin=/g, "crossOrigin=")
              .replace(/datetime=/g, "dateTime=")
              .replace(/formaction=/g, "formAction=")
              .replace(/formenctype=/g, "formEncType=")
              .replace(/formmethod=/g, "formMethod=")
              .replace(/formnovalidate=/g, "formNoValidate=")
              .replace(/formtarget=/g, "formTarget=")
              .replace(/frameborder=/g, "frameBorder=")
              .replace(/marginheight=/g, "marginHeight=")
              .replace(/marginwidth=/g, "marginWidth=")
              .replace(/novalidate=/g, "noValidate=")
              .replace(/rowspan=/g, "rowSpan=")
              .replace(/colspan=/g, "colSpan=")
              .replace(/usemap=/g, "useMap=")
              .replace(/itemscope=/g, "itemScope=")
              .replace(/itemtype=/g, "itemType=")
              .replace(/itemprop=/g, "itemProp=")

            // Convert style attributes to JSX format
            jsxContent = jsxContent.replace(/style="([^"]*)"/g, (match, styles) => {
              try {
                const styleObj = styles
                  .split(";")
                  .filter((s) => s.trim())
                  .map((s) => {
                    const [prop, value] = s.split(":").map((p) => p.trim())
                    if (!prop || !value) return null
                    const camelProp = prop.replace(/-([a-z])/g, (g) => g[1].toUpperCase())
                    return `${camelProp}: "${value.replace(/"/g, '\\"')}"`
                  })
                  .filter(Boolean)
                  .join(", ")
                return styleObj ? `style={{${styleObj}}}` : ""
              } catch (e) {
                console.log("[v0] Error converting style attribute:", e)
                return ""
              }
            })

            // Ensure JSX content is wrapped properly
            if (!jsxContent.trim().startsWith("<")) {
              jsxContent = `<div>${jsxContent}</div>`
            }

            // Create complete React component with safer JavaScript handling
            const safeJs = plan?.analyzedJs
              ? plan.analyzedJs
                  .replace(/document\./g, "// document.")
                  .replace(/window\./g, "// window.")
                  .replace(/console\.log/g, "// console.log")
                  .trim()
              : "// No JavaScript found"

            const pageContent = `"use client";
import { useEffect } from 'react';

export default function Page() {
  useEffect(() => {
    // Analyzed JavaScript from website (commented for safety)
    try {
      ${safeJs}
    } catch (error) {
      console.log('JavaScript execution error:', error);
    }
  }, []);

  return (
    <div>
      ${jsxContent}
    </div>
  );
}`.trim()

            console.log("[v0] Writing converted JSX to page.tsx")
            console.log("[v0] JSX content preview:", jsxContent.substring(0, 200) + "...")
            await sandbox.files.write("/home/user/app/page.tsx", pageContent)
          } catch (conversionError) {
            console.error("[v0] Error converting HTML to JSX:", conversionError)
            // Fallback to simple page
            const fallbackContent = `"use client";

export default function Page() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Website Clone</h1>
      <p>HTML conversion failed, using fallback content.</p>
    </div>
  );
}`.trim()

            console.log("[v0] Using fallback page.tsx due to conversion error")
            await sandbox.files.write("/home/user/app/page.tsx", fallbackContent)
          }
        }

        if (plan?.files) {
          console.log("[v0] Writing AI-generated files...")
          for (const [path, content] of Object.entries(plan.files)) {
            console.log("[v0] Writing file:", path)
            await sandbox.files.write(`/home/user/${path}`, String(content))
          }
          console.log("[v0] All AI files written successfully")
        }

        return NextResponse.json({
          success: true,
          sandboxId: sid,
          message: "Plan applied successfully",
          filesWritten: plan?.files ? Object.keys(plan.files).length : 0,
        })
      }

      case "install": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Installing dependencies for sandbox:", sid)
        const sandbox = await e2b.Sandbox.connect(sid, {
          apiKey,
          timeoutMs: 900000, // Extended timeout for install
        })

        await sandbox.setTimeout(900000)

        const { stdout, stderr } = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
          cwd: "/home/user",
          timeoutMs: 600000, // Increased to 10 minutes for npm install
        })

        console.log("[v0] Install completed")
        return NextResponse.json({ success: true, logs: stdout + stderr })
      }

      

                                  
  
case "start": {
  const sid = bodySandboxId
  if (!sid) throw new Error("sandboxId manquant")

  console.log("[v0] Starting server for sandbox:", sid)
  const sandbox = await e2b.Sandbox.connect(sid, { apiKey, timeoutMs: 900000 })
  await sandbox.setTimeout(900000)

  sandbox.commands.start("npm run dev", { cwd: "/home/user" })

  const url = `https://${sandbox.getHost(3000)}`
  console.log("[v0] Dev server started at:", url)

  return NextResponse.json({ success: true, url })
                            }
        


        

      
              



      case "getFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Extracting files from sandbox:", sid)

        try {
          let sandbox: e2b.Sandbox
          try {
            sandbox = await e2b.Sandbox.connect(sid, {
              apiKey,
              timeoutMs: 900000,
            })
          } catch (connectError: any) {
            console.log("[v0] Failed to connect to sandbox, it may be paused or expired:", connectError.message)
            throw new Error(`Sandbox ${sid} is no longer available. It may have expired or been paused.`)
          }

          await sandbox.setTimeout(900000)

          const { stdout: fileList } = await sandbox.commands.run(
            "find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.*'",
            {
              cwd: "/home/user",
            },
          )

          const files: Record<string, string> = {}
          const filePaths = fileList
            .trim()
            .split("\n")
            .filter((path) => path && path !== ".")

          console.log("[v0] Found", filePaths.length, "files to extract")

          for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i]
            try {
              const cleanPath = filePath.replace(/^\.\//, "")
              const content = await sandbox.files.read(`/home/user/${cleanPath}`, { format: "text" })

              if (cleanPath === "package.json" || cleanPath.endsWith(".json")) {
                try {
                  const parsed = JSON.parse(content)
                  files[cleanPath] = JSON.stringify(parsed, null, 2)
                  console.log(`[v0] Validated and formatted JSON file: ${cleanPath}`)
                } catch (jsonError) {
                  console.error(`[v0] Invalid JSON in ${cleanPath}:`, jsonError)
                  if (cleanPath === "package.json") {
                    const defaultPackageJson = {
                      name: "nextjs-app",
                      private: true,
                      scripts: {
                        dev: "next dev -p 3000 -H 0.0.0.0",
                        build: "next build",
                        start: "next start -p 3000 -H 0.0.0.0",
                      },
                      dependencies: {
                        next: "14.2.3",
                        react: "18.2.0",
                        "react-dom": "18.2.0",
                      },
                    }
                    files[cleanPath] = JSON.stringify(defaultPackageJson, null, 2)
                    console.log(`[v0] Used fallback package.json due to corruption`)
                  } else {
                    files[cleanPath] = content
                  }
                }
              } else {
                files[cleanPath] = typeof content === "string" ? content : String(content)
              }

              console.log(`[v0] Extracted file ${i + 1}/${filePaths.length}:`, cleanPath)
            } catch (error) {
              console.log("[v0] Could not read file:", filePath, error)
            }
          }

          console.log("[v0] Successfully extracted", Object.keys(files).length, "files")
          console.log("[v0] Keeping sandbox alive for potential reuse")

          return NextResponse.json({
            success: true,
            files,
            fileCount: Object.keys(files).length,
          })
        } catch (error: any) {
          console.error("[v0] Error extracting files:", error)
          return NextResponse.json(
            {
              success: false,
              error: "Failed to extract files from sandbox",
              details: error.message,
              sandboxId: sid,
            },
            { status: 500 },
          )
        }
      }

      case "processFiles": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Processing files for deployment from sandbox:", sid)

        try {
          // First extract files using existing logic
          const extractResponse = await fetch(`${req.url}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "getFiles", sandboxId: sid }),
          })

          const extractResult = await extractResponse.json()

          if (!extractResult.success) {
            throw new Error(`Failed to extract files: ${extractResult.error}`)
          }

          const rawFiles = extractResult.files
          const processedFiles: Record<string, { content: string; encoding: string }> = {}

          for (const [filePath, content] of Object.entries(rawFiles)) {
            const fileContent = content as string

            if (typeof fileContent !== "string") {
              console.error(`[v0] File ${filePath} has invalid content type:`, typeof fileContent)
              continue
            }

            if (filePath === "package.json") {
              try {
                JSON.parse(fileContent)
                console.log(`[v0] package.json is valid JSON`)
              } catch (e) {
                console.error(`[v0] package.json is invalid JSON, content:`, fileContent.substring(0, 100))
                throw new Error(`package.json contains invalid JSON: ${e}`)
              }
            }

            processedFiles[filePath] = {
              content: Buffer.from(fileContent, "utf8").toString("base64"),
              encoding: "base64",
            }

            console.log(
              `[v0] Processed file: ${filePath} (${fileContent.length} chars -> ${processedFiles[filePath].content.length} base64 chars)`,
            )
          }

          console.log("[v0] Successfully processed", Object.keys(processedFiles).length, "files for deployment")

          return NextResponse.json({
            success: true,
            files: processedFiles,
            fileCount: Object.keys(processedFiles).length,
          })
        } catch (error: any) {
          console.error("[v0] Error processing files:", error)
          return NextResponse.json(
            {
              success: false,
              error: "Failed to process files for deployment",
              details: error.message,
              sandboxId: sid,
            },
            { status: 500 },
          )
        }
      }

      case "checkStatus": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Checking sandbox status:", sid)

        try {
          const sandbox = await e2b.Sandbox.connect(sid, {
            apiKey,
            timeoutMs: 30000, // Short timeout for status check
          })

          return NextResponse.json({
            success: true,
            status: "active",
            sandboxId: sid,
          })
        } catch (error: any) {
          console.log("[v0] Sandbox status check failed:", error.message)
          return NextResponse.json({
            success: false,
            status: "inactive",
            error: error.message,
            sandboxId: sid,
          })
        }
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[v0] Sandbox API error:", e)
    return NextResponse.json(
      {
        error: e.message || "Une erreur inconnue s'est produite",
        details: e.toString(),
      },
      { status: 500 },
    )
  }
}
