import { PKG } from "../types"

export function validateAgainstPKG(
  pkg: PKG,
  generatedFiles: string[]
) {
  const errors: string[] = []

  Object.keys(pkg.pages).forEach(page => {
    if (!generatedFiles.includes(page)) {
      errors.push(`Missing page: ${page}`)
    }
  })

  if (pkg.constraints.dead_links !== 0) {
    errors.push("Dead links detected")
  }

  return errors
}
  
