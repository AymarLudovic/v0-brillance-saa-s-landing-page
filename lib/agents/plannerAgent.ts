import { PKG } from "../types"

export function planFromPKG(pkg: PKG) {
  return {
    pages: Object.keys(pkg.pages),
    features: Object.keys(pkg.features).filter(
      f => pkg.features[f].real
    ),
    interactions: Object.entries(pkg.interactions)
  }
}
