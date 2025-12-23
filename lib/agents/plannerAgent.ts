import { PKG } from "../types"



export function planFromPKG(pkg: PKG) {
  const pages = pkg?.pages ? Object.keys(pkg.pages) : []
  const features = pkg?.features
    ? Object.keys(pkg.features).filter(f => pkg.features[f]?.real)
    : []
  const interactions = pkg?.interactions
    ? Object.entries(pkg.interactions)
    : []

  return { pages, features, interactions }
}
