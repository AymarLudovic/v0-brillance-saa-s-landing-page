"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Globe, ArrowUp, Trash2, Save, LogOut, Plus } from "lucide-react"
import { Bodoni_Moda } from "next/font/google"
import { auth, db, googleProvider } from "@/lib/firebase"
import { onAuthStateChanged, signInWithPopup, signOut, User } from "firebase/auth"
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  serverTimestamp, orderBy, query,
} from "firebase/firestore"

const bodoni = Bodoni_Moda({ subsets: ["latin"], display: "swap" })

const ADMIN_EMAIL = "ludovicaymar8@gmail.com"

function faviconUrl(domain: string) {
  const clean = domain.replace(/^https?:\/\//, "").split("/")[0]
  return `https://www.google.com/s2/favicons?domain=${clean}&sz=32`
}

type Suggestion = { id: string; url: string; faviconUrl: string; html: string; css: string; js: string; createdAt?: any }

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Analyzer
  const [url, setUrl] = useState("")
  const [result, setResult] = useState<{ html: string; css: string; js: string; baseURL: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  // Desktop iframe scale
  const iframeWrapRef = useRef<HTMLDivElement>(null)
  const [iframeScale, setIframeScale] = useState(1)

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false) })
    return unsub
  }, [])

  const handleSignIn = async () => { try { await signInWithPopup(auth, googleProvider) } catch {} }
  const handleSignOut = async () => { await signOut(auth) }

  // ── Load suggestions ──────────────────────────────────────────────────────

  const loadSuggestions = async () => {
    try {
      const snap = await getDocs(query(collection(db, "suggestions"), orderBy("createdAt", "desc")))
      setSuggestions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Suggestion, "id">) })))
    } catch {}
  }

  useEffect(() => { loadSuggestions() }, [])

  // ── Desktop iframe scale ──────────────────────────────────────────────────

  useEffect(() => {
    if (!iframeWrapRef.current || !result) return
    const obs = new ResizeObserver((entries) => {
      setIframeScale(Math.min(1, entries[0].contentRect.width / 1280))
    })
    obs.observe(iframeWrapRef.current)
    return () => obs.disconnect()
  }, [result])

  // ── Analyze ───────────────────────────────────────────────────────────────

  const analyze = async () => {
    if (!url) return
    setLoading(true); setError(null); setResult(null)
    try {
      let fullUrl = url
      if (!/^https?:\/\//i.test(fullUrl)) fullUrl = "https://" + fullUrl
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || "Failed")
      setResult({ html: data.fullHTML, css: data.fullCSS, js: data.fullJS, baseURL: new URL(fullUrl).origin })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Save to Firebase ──────────────────────────────────────────────────────

  const saveSuggestion = async () => {
    if (!result || !url) return
    setSaving(true); setSaveStatus(null)
    try {
      const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "")
      const fav = faviconUrl(clean)
      await addDoc(collection(db, "suggestions"), {
        url: clean,
        faviconUrl: fav,
        html: result.html,
        css: result.css,
        js: result.js,
        createdAt: serverTimestamp(),
      })
      setSaveStatus("Saved! ✅")
      loadSuggestions()
    } catch (e) {
      setSaveStatus("Error saving ✗")
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }

  // ── Delete suggestion ─────────────────────────────────────────────────────

  const deleteSuggestion = async (id: string) => {
    if (!confirm("Delete this suggestion?")) return
    try {
      await deleteDoc(doc(db, "suggestions", id))
      setSuggestions((prev) => prev.filter((s) => s.id !== id))
    } catch {}
  }

  const previewDoc = useMemo(() => result?.html || "", [result])

  // ── Not authenticated ─────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 p-8">
        <div className={`${bodoni.className} text-4xl text-black`}>Admin</div>
        <p className="text-gray-500 text-sm text-center max-w-sm">
          {user ? `Access restricted. Signed in as ${user.email}` : "Sign in with the admin account to access this page."}
        </p>
        {user ? (
          <button onClick={handleSignOut} className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800">
            <LogOut size={16} /> Sign out
          </button>
        ) : (
          <button onClick={handleSignIn} className="flex items-center gap-2 px-6 py-3 bg-black text-white rounded-xl text-sm font-medium hover:bg-gray-800">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        )}
        <a href="/" className="text-sm text-gray-400 hover:text-black">← Back to app</a>
      </div>
    )
  }

  // ── Admin UI ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#FAFAFA]">

      {/* Header */}
      <header className="bg-white border-b border-[#eee] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm text-gray-400 hover:text-black">←</a>
          <span className={`${bodoni.className} text-xl text-black`}>Admin Panel</span>
        </div>
        <div className="flex items-center gap-3">
          {user.photoURL && <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />}
          <button onClick={handleSignOut} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-8">

        {/* ── Analyzer section ── */}
        <div className="bg-white rounded-2xl border border-[#eee] p-6">
          <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
            <Globe size={18} /> Analyze a site
          </h2>

          {/* Input */}
          <div className="flex gap-2 mb-4">
            <div className="flex-1 flex items-center gap-2 h-11 rounded-xl border border-[#eee] bg-[#FAFAFA] px-3">
              <Globe size={16} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="https://example.com"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
              />
            </div>
            <button
              onClick={analyze}
              disabled={loading}
              className="flex items-center gap-2 h-11 px-5 bg-black text-white rounded-xl text-sm font-medium disabled:opacity-60 hover:bg-gray-800 transition-colors"
            >
              {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <ArrowUp size={16} />}
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {error && <p className="text-red-600 bg-red-50 rounded-lg p-3 text-sm mb-4">{error}</p>}

          {/* Preview */}
          {result && (
            <>
              <div
                ref={iframeWrapRef}
                className="w-full rounded-xl border border-gray-200 overflow-hidden bg-white mb-4"
                style={{ height: `${Math.round(800 * iframeScale)}px`, minHeight: 280, position: "relative" }}
              >
                <iframe
                  title="Preview"
                  srcDoc={previewDoc}
                  sandbox="allow-scripts allow-same-origin"
                  style={{ width: 1280, height: 800, border: "none", transform: `scale(${iframeScale})`, transformOrigin: "top left", display: "block" }}
                />
              </div>

              {/* Save button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={saveSuggestion}
                  disabled={saving}
                  className="flex items-center gap-2 h-10 px-5 bg-black text-white rounded-xl text-sm font-medium disabled:opacity-60 hover:bg-gray-800 transition-colors"
                >
                  <Save size={15} />
                  {saving ? "Saving…" : "Save as suggestion card"}
                </button>
                {saveStatus && (
                  <span className={`text-sm px-3 py-1 rounded-lg ${saveStatus.includes("✅") ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"}`}>
                    {saveStatus}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Suggestion cards ── */}
        <div className="bg-white rounded-2xl border border-[#eee] p-6">
          <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
            <Plus size={18} /> Suggestion cards ({suggestions.length})
          </h2>

          {suggestions.length === 0 ? (
            <p className="text-gray-400 text-sm italic">No suggestions yet. Analyze a site and save it.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestions.map((s) => (
                <div key={s.id} className="relative group rounded-xl border border-[#eee] overflow-hidden bg-[#FAFAFA]">
                  {/* Scaled preview */}
                  <div className="w-full h-[160px] overflow-hidden pointer-events-none relative">
                    <iframe
                      srcDoc={s.html}
                      sandbox="allow-scripts"
                      className="absolute top-0 left-0 border-0"
                      style={{ width: "1280px", height: "900px", transform: "scale(0.2)", transformOrigin: "top left" }}
                      title={s.url}
                    />
                  </div>
                  {/* Info bar */}
                  <div className="flex items-center gap-2 px-3 py-2 border-t border-[#eee] bg-white">
                    <img src={s.faviconUrl || faviconUrl(s.url)} alt="" className="w-4 h-4 rounded-sm flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                    <span className="text-sm text-black font-medium flex-1 truncate">{s.url}</span>
                    <button
                      onClick={() => deleteSuggestion(s.id)}
                      className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
