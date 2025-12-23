export interface PKG {
  pages: Record<string, {
    exists: boolean
    type: "public" | "auth" | "private"
    states?: string[]
  }>
  features: Record<string, {
    real: boolean
    requiresBackend: boolean
  }>
  interactions: Record<string, {
    calls: string
  }>
  constraints: {
    dead_links: number
    fake_data: boolean
    ui_without_logic: boolean
  }
}
