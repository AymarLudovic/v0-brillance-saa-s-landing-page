import { type NextRequest, NextResponse } from "next/server"
import { Buffer } from "buffer" // Assurez-vous d'avoir node:buffer ou un polyfill si vous n'êtes pas dans un environnement Node strict

export async function POST(request: NextRequest) {
  try {
    // 1. Extraction des données de la requête
    const { files, projectName, token, sandboxId } = await request.json()

    console.log("[v0] Starting Vercel deployment for project:", projectName)
    console.log("[v0] Sandbox ID:", sandboxId)

    let deployFiles = files
    
    // 2. Logique d'extraction des fichiers si non fournis (via l'API sandbox existante)
    if (sandboxId && (!files || Object.keys(files).length === 0)) {
      console.log("[v0] No files provided, extracting and processing from sandbox:", sandboxId)

      // NOTE: Assurez-vous que votre route /api/sandbox existe et traite les fichiers correctement
      const extractResponse = await fetch(`${request.nextUrl.origin}/api/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "processFiles",
          sandboxId: sandboxId,
        }),
      })

      const extractData = await extractResponse.json()

      if (!extractData.success) {
        throw new Error(`Failed to process files from sandbox: ${extractData.error}`)
      }

      deployFiles = extractData.files
      console.log("[v0] Processed", extractData.fileCount, "files from sandbox")
    }

    console.log("[v0] Files to deploy:", Object.keys(deployFiles || {}))

    // 3. Vérifications préliminaires
    if (!deployFiles || Object.keys(deployFiles).length === 0) {
      throw new Error("No files available for deployment")
    }

    if (!token) {
      throw new Error("Vercel access token is required")
    }

    const requiredFiles = ["package.json"]
    const missingFiles = requiredFiles.filter((file) => !deployFiles[file])
    if (missingFiles.length > 0) {
      console.warn("[v0] Missing required files:", missingFiles)
    }
    
    // 4. Lancement du déploiement Vercel
    const deploymentResponse = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        files: Object.entries(deployFiles).map(([path, fileData]) => {
          let fileContent: string

          if (typeof fileData === "object" && fileData !== null && "content" in fileData) {
            const processedFile = fileData as { content: string; encoding: string }
            // Utilise le contenu brut directement, en décodant le base64 si nécessaire
            if (processedFile.encoding === "base64") {
              fileContent = Buffer.from(processedFile.content, "base64").toString("utf8")
            } else {
              fileContent = processedFile.content
            }
          } else {
            // Contenu de fichier direct (string)
            fileContent = fileData as string
          }

          // Validation et fallback pour package.json
          if (path === "package.json") {
            try {
              JSON.parse(fileContent)
            } catch (e) {
              console.error("[v0] Invalid package.json detected, using fallback")
              fileContent = JSON.stringify(
                {
                  name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                  version: "1.0.0",
                  private: true,
                  scripts: {
                    dev: "next dev",
                    build: "next build",
                    start: "next start",
                    lint: "next lint",
                  },
                  dependencies: {
                    next: "14.0.0",
                    react: "^18",
                    "react-dom": "^18",
                  },
                  devDependencies: {
                    "@types/node": "^20",
                    "@types/react": "^18",
                    "@types/react-dom": "^18",
                    eslint: "^8",
                    "eslint-config-next": "14.0.0",
                    typescript: "^5",
                  },
                },
                null,
                2,
              )
            }
          }

          return {
            file: path,
            data: fileContent, // Le contenu doit être le contenu brut décodé
          }
        }),
        projectSettings: {
          framework: "nextjs",
        },
      }),
    })

    const deploymentData = await deploymentResponse.json()
    // console.log("[v0] Vercel API response:", deploymentData) // Retiré pour éviter l'encombrement des logs

    // 5. Gestion des erreurs de l'API Vercel
    if (!deploymentResponse.ok) {
      const errorMessage = deploymentData.error?.message || deploymentData.message || "Unknown Vercel API error"
      console.error("[v0] Vercel deployment failed:", errorMessage)
      throw new Error(`Vercel API Error: ${errorMessage}`)
    }

    // 6. Vérification des données de retour
    if (!deploymentData.url || !deploymentData.id) {
      console.error("[v0] Missing URL or ID in deployment response:", deploymentData)
      throw new Error("Deployment completed but required data was missing (URL or ID)")
    }

    console.log("[v0] Deployment successful, returning ID:", deploymentData.id)

    // 7. Retour de succès (avec l'ID du déploiement pour le suivi)
    return NextResponse.json({
      success: true,
      url: `https://${deploymentData.url}`,
      deploymentId: deploymentData.id, // <-- C'EST LA CLÉ POUR LE FRONTEND
      projectId: deploymentData.projectId,
      filesDeployed: Object.keys(deployFiles).length,
    })
  } catch (error: any) {
    console.error("[v0] Deployment error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Deployment failed",
        details: error.toString(),
      },
      { status: 400 },
    )
  }
        }
