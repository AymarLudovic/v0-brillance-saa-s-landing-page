"use client"

import { useState, useRef, useCallback } from "react"

interface AnalyzeResult {
  success: boolean
  html: string
  stats: {
    cssLinks: number
    scripts: number
    inlineStyles: number
    inlineScripts: number
  }
}

type DeviceMode = "desktop" | "tablet" | "mobile"

const DEVICE_SIZES: Record<DeviceMode, { width: string; label: string }> = {
  desktop: { width: "100%", label: "Desktop" },
  tablet: { width: "768px", label: "Tablette" },
  mobile: { width: "375px", label: "Mobile" },
}

export default function Home() {
  const [url, setUrl] = useState("")
  const [cookies, setCookies] = useState("")
  const [showCookies, setShowCookies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop")
  const [loadingStep, setLoadingStep] = useState("")
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prevBlobUrl = useRef<string | null>(null)

  const handleAnalyze = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError("")
    setResult(null)
    setLoadingStep("Récupération de la page...")

    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current)
      prevBlobUrl.current = null
    }
    setBlobUrl(null)

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), cookies: cookies.trim() }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Erreur inconnue")
      }

      setLoadingStep("Rendu en cours...")
      setResult(data)

      // Créer le blob directement depuis le HTML retourné
      // Le navigateur charge lui-même CSS/JS/polices depuis les URLs absolues
      // C'est bien plus fiable que d'essayer d'inliner tout côté serveur
      const blob = new Blob([data.html], { type: "text/html; charset=utf-8" })
      const newBlobUrl = URL.createObjectURL(blob)
      prevBlobUrl.current = newBlobUrl
      setBlobUrl(newBlobUrl)
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue")
    } finally {
      setLoading(false)
      setLoadingStep("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAnalyze()
  }

  const handleDownload = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.html], { type: "text/html; charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "clone.html"
    a.click()
  }, [result])

  const handleCopySource = useCallback(() => {
    if (!result) return
    navigator.clipboard.writeText(result.html)
  }, [result])

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <span className="brand-icon">⚡</span>
          <h1 className="brand-title">PixelClone</h1>
          <span className="brand-badge">v3</span>
        </div>
        <p className="brand-subtitle">Reproduit n'importe quelle page web pixel perfect</p>
      </header>

      {/* ── Search Bar ── */}
      <div className="search-section">
        <div className="search-bar">
          <span className="search-icon">🌐</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://example.com"
            className="search-input"
            disabled={loading}
          />
          <button onClick={handleAnalyze} disabled={loading || !url.trim()} className="search-btn">
            {loading ? (
              <><span className="spinner" /> Analyse...</>
            ) : (
              <><span>🔍</span> Cloner</>
            )}
          </button>
        </div>

        {loading && loadingStep && (
          <div className="loading-status">
            <span className="dot-pulse" />
            {loadingStep}
          </div>
        )}
        {error && (
          <div className="error-banner">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* ── Cookies toggle ── */}
        <div className="cookies-section">
          <button className="cookies-toggle" onClick={() => setShowCookies(v => !v)} type="button">
            🔐 Page protégée / authentification {showCookies ? "▲" : "▼"}
          </button>
          {showCookies && (
            <div className="cookies-box">
              <p className="cookies-hint">
                <strong>Option 1 — Bookmarklet :</strong> Glisse ce bouton dans ta barre de favoris, clique-le sur la page à cloner.
              </p>
              <a
                className="bookmarklet-btn"
                href={`javascript:(function(){var c=document.cookie;if(!c){alert('Aucun cookie accessible.');}else{navigator.clipboard.writeText(c).then(function(){alert('Cookies copiés !');});}})();`}
                onClick={e => e.preventDefault()}
                draggable
              >
                🍪 CopyCookies → PixelClone
              </a>
              <p className="cookies-hint" style={{marginTop: "8px"}}>
                <strong>Option 2 :</strong> DevTools → Network → Request Headers → <code>Cookie</code>
              </p>
              <textarea
                className="cookies-input"
                value={cookies}
                onChange={e => setCookies(e.target.value)}
                placeholder="session_id=abc123; auth_token=xyz..."
                rows={3}
                disabled={loading}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Stats & Controls ── */}
      {result && blobUrl && (
        <div className="controls-bar">
          <div className="stats-row">
            <span className="stat-chip css">
              🎨 {result.stats.cssLinks} CSS + {result.stats.inlineStyles} inline
            </span>
            <span className="stat-chip js">
              ⚙️ {result.stats.scripts} scripts + {result.stats.inlineScripts} inline
            </span>
          </div>
          <div className="actions-row">
            <div className="device-switcher">
              {(Object.keys(DEVICE_SIZES) as DeviceMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDeviceMode(mode)}
                  className={`device-btn ${deviceMode === mode ? "active" : ""}`}
                >
                  {mode === "desktop" ? "🖥️" : mode === "tablet" ? "📱" : "📲"}{" "}
                  {DEVICE_SIZES[mode].label}
                </button>
              ))}
            </div>
            <button onClick={handleDownload} className="action-btn download-btn">⬇️ Télécharger HTML</button>
            <button onClick={handleCopySource} className="action-btn copy-btn">📋 Copier source</button>
          </div>
        </div>
      )}

      {/* ── Iframe Preview ── */}
      {blobUrl && (
        <div className="preview-wrapper">
          <div className="iframe-shell" style={{ maxWidth: DEVICE_SIZES[deviceMode].width }}>
            <div className="iframe-bar">
              <div className="dots"><span /><span /><span /></div>
              <span className="iframe-url">{url}</span>
            </div>
            <iframe
              ref={iframeRef}
              src={blobUrl}
              className="preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Pixel Clone Preview"
            />
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!blobUrl && !loading && (
        <div className="empty-state">
          <div className="empty-icon">🖼️</div>
          <p>Entrez une URL et cliquez sur <strong>Cloner</strong> pour voir le rendu ici</p>
          <ul className="tips-list">
            <li>✅ CSS & polices chargés nativement par le navigateur</li>
            <li>✅ JavaScript préservé et opérationnel</li>
            <li>✅ URLs relatives converties en absolues</li>
            <li>✅ Téléchargeable en fichier HTML autonome</li>
          </ul>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e2e8f0; min-height: 100vh; }

        .app-container { display: flex; flex-direction: column; min-height: 100vh; padding: 24px; gap: 20px; max-width: 1400px; margin: 0 auto; }

        .header { text-align: center; padding: 16px 0 8px; }
        .header-brand { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .brand-icon { font-size: 32px; }
        .brand-title { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .brand-badge { background: #7c3aed; color: white; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 99px; margin-top: 4px; }
        .brand-subtitle { color: #64748b; font-size: 14px; margin-top: 6px; }

        .search-section { display: flex; flex-direction: column; gap: 10px; }
        .search-bar { display: flex; align-items: center; background: #1e1e2e; border: 1px solid #334155; border-radius: 14px; padding: 6px 6px 6px 16px; gap: 10px; transition: border-color .2s; }
        .search-bar:focus-within { border-color: #7c3aed; }
        .search-icon { font-size: 18px; }
        .search-input { flex: 1; background: transparent; border: none; outline: none; color: #e2e8f0; font-size: 15px; }
        .search-input::placeholder { color: #475569; }
        .search-btn { display: flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; border: none; border-radius: 10px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s; white-space: nowrap; }
        .search-btn:hover:not(:disabled) { opacity: .85; }
        .search-btn:disabled { opacity: .5; cursor: not-allowed; }
        .spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: spin .6s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading-status { display: flex; align-items: center; gap: 8px; color: #a78bfa; font-size: 13px; padding-left: 4px; }
        .dot-pulse { width: 8px; height: 8px; background: #7c3aed; border-radius: 50%; animation: pulse 1.2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
        .error-banner { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: #fca5a5; border-radius: 10px; padding: 10px 14px; font-size: 13px; display: flex; gap: 8px; }

        .cookies-section { display: flex; flex-direction: column; gap: 8px; }
        .cookies-toggle { background: none; border: 1px dashed #334155; color: #64748b; border-radius: 8px; padding: 7px 14px; font-size: 12px; cursor: pointer; text-align: left; transition: all .2s; }
        .cookies-toggle:hover { border-color: #7c3aed; color: #a78bfa; }
        .cookies-box { background: #1e1e2e; border: 1px solid #334155; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .cookies-hint { font-size: 11px; color: #64748b; line-height: 1.5; }
        .cookies-hint code { background: #0a0a0f; padding: 1px 5px; border-radius: 4px; color: #a78bfa; font-size: 10px; }
        .bookmarklet-btn { display: inline-block; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; font-size: 12px; font-weight: 700; padding: 8px 14px; border-radius: 8px; text-decoration: none; cursor: grab; width: fit-content; border: 2px dashed rgba(255,255,255,.3); }
        .cookies-input { background: #0a0a0f; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 11px; font-family: monospace; padding: 8px; resize: vertical; width: 100%; outline: none; }
        .cookies-input:focus { border-color: #7c3aed; }

        .controls-bar { background: #1e1e2e; border: 1px solid #334155; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
        .stats-row { display: flex; gap: 10px; flex-wrap: wrap; }
        .stat-chip { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 12px; border-radius: 99px; }
        .stat-chip.css { background: rgba(96,165,250,.1); color: #93c5fd; border: 1px solid rgba(96,165,250,.2); }
        .stat-chip.js { background: rgba(251,191,36,.1); color: #fcd34d; border: 1px solid rgba(251,191,36,.2); }
        .actions-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .device-switcher { display: flex; background: #0a0a0f; border: 1px solid #334155; border-radius: 10px; overflow: hidden; }
        .device-btn { background: transparent; border: none; color: #64748b; padding: 7px 14px; font-size: 12px; cursor: pointer; transition: all .2s; white-space: nowrap; }
        .device-btn.active { background: #7c3aed; color: white; }
        .device-btn:hover:not(.active) { color: #e2e8f0; }
        .action-btn { border: none; border-radius: 8px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity .2s; }
        .download-btn { background: rgba(34,197,94,.15); color: #86efac; border: 1px solid rgba(34,197,94,.2); }
        .copy-btn { background: rgba(148,163,184,.1); color: #94a3b8; border: 1px solid rgba(148,163,184,.15); }
        .action-btn:hover { opacity: .8; }

        .preview-wrapper { flex: 1; display: flex; justify-content: center; min-height: 500px; }
        .iframe-shell { width: 100%; border: 1px solid #334155; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; background: #1e1e2e; transition: max-width .3s ease; }
        .iframe-bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #161622; border-bottom: 1px solid #334155; }
        .dots { display: flex; gap: 6px; }
        .dots span { width: 10px; height: 10px; border-radius: 50%; }
        .dots span:nth-child(1) { background: #ef4444; }
        .dots span:nth-child(2) { background: #f59e0b; }
        .dots span:nth-child(3) { background: #22c55e; }
        .iframe-url { font-size: 12px; color: #64748b; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .preview-iframe { flex: 1; border: none; width: 100%; min-height: 600px; background: white; }

        .empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center; color: #475569; padding: 60px 20px; }
        .empty-icon { font-size: 64px; }
        .empty-state p { font-size: 16px; }
        .tips-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
        .tips-list li { font-size: 14px; color: #334155; }
      `}</style>
    </div>
  )
  }
