"use client";

import React from "react";

export default function HomePage() {
  return (
    <>
      <style>{`
        *{box-sizing:border-box}
        body{margin:0}
        @font-face { font-family: "Roboto Mono Variable"; font-style: normal; font-display: swap; font-weight: 100 700; src: url("https://lovable.dev/_next/static/media/roboto-mono-latin-wght-normal.0o8nl6nt6t~p2.woff2?dpl=a1-99fb93f113cab4e93d02c76005195") format("woff2-variations"); unicode-range: U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
        @font-face { font-family: "Camera Plain Variable"; src: url("https://lovable.dev/fonts/CameraPlainVariable-c48bd243.woff2") format("woff2"); font-weight: 100 900; font-style: normal; font-display: optional; }
        textarea.input-field { box-shadow: var(--shadow-input-base); outline: var(--border-default) solid var(--border-translucent); outline-offset: calc(-1 * var(--border-default)); transition: outline-color 0.15s; overflow: auto; }
        .fade-in { animation: fadeIn 0.3s ease-in; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .background-v2-enter { animation: bgEnter 1s ease-in forwards; }
        @keyframes bgEnter { from { opacity: 0; } to { opacity: 1; } }
        @keyframes heartbeat { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        .btn-transition { transition: all 0.15s ease-in-out; }
        .fill-background { fill: rgb(28,28,28); }
      `}</style>

      <a
        href="#main-content"
        className="bg-primary text-primary-foreground fixed top-4 left-4 z-[9999] rounded-md px-4 py-2 text-sm font-medium [&:not(:focus)]:sr-only"
        style={{
          color: "rgb(252, 251, 248)",
          fontSize: 14,
          fontWeight: 480,
          lineHeight: "21px",
          textDecoration: "none",
          whiteSpace: "nowrap",
          background: "rgb(28, 28, 28)",
          borderRadius: 6,
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 9999,
          width: 1,
          height: 1,
          margin: -1,
          overflow: "hidden",
          clipPath: "inset(50%)",
        }}
      >
        Skip to main content
      </a>

      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{
          display: "flex",
          minHeight: 0,
          flex: "1 1 0%",
          flexDirection: "column",
        }}
      >
        <div
          className="bg-background relative min-h-screen w-full transition-none"
          style={{
            backgroundColor: "rgb(252, 251, 248)",
            position: "relative",
            minHeight: 800,
          }}
        >
          <div>
            <div aria-hidden="true" className="-mb-px h-px" style={{ height: 1, marginBottom: -1 }} />

            {/* STICKY HEADER */}
            <div
              className="sticky top-0 z-50 flex flex-col transition-[background,box-shadow] duration-300"
              style={{
                display: "flex",
                position: "sticky",
                top: 0,
                zIndex: 50,
                height: 64,
                marginBottom: -64,
                flexDirection: "column",
              }}
            >
              <div style={{ height: 64 }}>
                <div className="hidden h-full lg:block" style={{ height: 64 }}>
                  <div
                    className="container flex h-full items-center justify-between"
                    style={{
                      display: "flex",
                      height: 64,
                      maxWidth: 1280,
                      padding: "0px 80px",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    {/* LEFT: Logo + Nav */}
                    <div
                      className="flex items-center gap-x-14"
                      style={{ display: "flex", alignItems: "center", gap: 56 }}
                    >
                      {/* Logo - text replacement instead of SVG */}
                      <div style={{ position: "relative", width: 105, height: 19 }}>
                        <span className="flex flex-col gap-1.5 mb-px" style={{ display: "flex", flexDirection: "column" }}>
                          <a
                            aria-label="Go to homepage"
                            className="transition-opacity hover:opacity-75"
                            href="https://lovable.dev/home"
                            style={{ display: "flex", alignItems: "center", textDecoration: "none" }}
                          >
                            <span
                              style={{
                                fontFamily: "'Camera Plain Variable', sans-serif",
                                fontWeight: 700,
                                fontSize: 20,
                                color: "rgb(28,28,28)",
                                letterSpacing: "-0.5px",
                              }}
                            >
                              Lovable
                            </span>
                          </a>
                        </span>
                      </div>

                      {/* Nav links */}
                      <nav style={{ position: "relative" }}>
                        <ul
                          aria-orientation="horizontal"
                          className="relative flex items-center gap-x-3.5"
                          style={{ display: "flex", alignItems: "center", gap: 14, listStyle: "none", margin: 0, padding: 0 }}
                        >
                          <li>
                            <button
                              type="button"
                              aria-disabled="false"
                              tabIndex={0}
                              aria-expanded="false"
                              style={{
                                fontSize: 15,
                                display: "flex",
                                padding: "4px 0px 4px 6px",
                                alignItems: "center",
                                gap: 2,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              Solutions
                              <span aria-hidden="true" style={{ color: "rgba(28,28,28,0.7)", width: 16, height: 16 }}>▾</span>
                            </button>
                          </li>
                          <li>
                            <button
                              type="button"
                              aria-disabled="false"
                              tabIndex={0}
                              aria-expanded="false"
                              style={{
                                fontSize: 15,
                                display: "flex",
                                padding: "4px 0px 4px 6px",
                                alignItems: "center",
                                gap: 2,
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              Resources
                              <span aria-hidden="true" style={{ color: "rgba(28,28,28,0.7)", width: 16, height: 16 }}>▾</span>
                            </button>
                          </li>
                          <li>
                            <a
                              className="px-1.5 py-1 text-[15px]/[24px] transition-colors hover:text-foreground/80"
                              href="https://lovable.dev/community"
                              style={{ fontSize: 15, padding: "4px 6px", textDecoration: "none", color: "inherit" }}
                            >
                              Community
                            </a>
                          </li>
                          <li>
                            <a
                              className="px-1.5 py-1 text-[15px]/[24px] transition-colors hover:text-foreground/80"
                              href="https://lovable.dev/pricing"
                              style={{ fontSize: 15, padding: "4px 6px", textDecoration: "none", color: "inherit" }}
                            >
                              Pricing
                            </a>
                          </li>
                          <li>
                            <a
                              className="px-1.5 py-1 text-[15px]/[24px] transition-colors hover:text-foreground/80"
                              href="https://lovable.dev/security"
                              style={{ fontSize: 15, padding: "4px 6px", textDecoration: "none", color: "inherit" }}
                            >
                              Security
                            </a>
                          </li>
                        </ul>
                      </nav>
                    </div>

                    {/* RIGHT: Auth buttons */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        id="login-link"
                        style={{
                          color: "lab(18.8087 -0.101894 0.363511)",
                          fontSize: 14,
                          lineHeight: "21px",
                          whiteSpace: "nowrap",
                          border: "0.666667px solid rgba(0,0,0,0.2)",
                          borderRadius: 8,
                          display: "flex",
                          width: 62,
                          height: 32,
                          padding: "6px 10px",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ padding: "0px 2px" }}>Log in</span>
                      </button>
                      <button
                        type="button"
                        id="signup-link"
                        style={{
                          color: "rgb(252,251,248)",
                          fontSize: 14,
                          lineHeight: "21px",
                          whiteSpace: "nowrap",
                          background: "rgba(0,0,0,0.88)",
                          borderRadius: 8,
                          boxShadow:
                            "rgba(0,0,0,0.08) 0px 1px 0px 0px inset, rgba(0,0,0,0.16) 0px -1px 0px 0px inset, rgb(0,0,0) 0px 0px 0px 1px inset, rgba(255,255,255,0.24) 0px 1px 0px 0px inset, rgba(0,0,0,0.12) 0px 2px 2px -1px",
                          display: "flex",
                          width: 94,
                          height: 32,
                          padding: "6px 10px",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ padding: "0px 2px" }}>Get started</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="isolate overflow-x-clip" style={{ overflowX: "clip" }}>
              <main id="main-content" tabIndex={-1}>
                <div style={{ position: "relative", width: "100%" }}>

                  {/* HERO SECTION */}
                  <section
                    className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden px-6 py-[20vh] pb-[24vh]"
                    style={{
                      display: "flex",
                      position: "relative",
                      height: 800,
                      minHeight: 800,
                      padding: "160px 24px 192px",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {/* Background image */}
                    <div
                      className="pointer-events-none inset-0 w-full overflow-hidden absolute"
                      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}
                    >
                      <div style={{ position: "absolute", inset: 0 }}>
                        <div style={{ position: "absolute", inset: 0, opacity: 0 }}>
                          <div
                            style={{
                              position: "absolute",
                              top: -560,
                              right: -1920,
                              left: 640,
                              width: 2560,
                              height: 2581,
                              transform: "matrix(1, 0, 0, 1, -1280, 0)",
                            }}
                          >
                            <img
                              src="https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down,quality=50/_next/static/media/pulse.0g1p1d3e.twut.webp?dpl=a1-99fb93f113cab4e93d02c76005195"
                              alt=""
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                              loading="eager"
                              fetchPriority="high"
                              decoding="sync"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* New badge */}
                    <div
                      className="flex flex-col items-center"
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 0 }}
                    >
                      <a
                        className="group flex items-center gap-2 rounded-full py-2 ps-2 pe-3 text-sm font-medium shadow-xs backdrop-blur-md transition-all duration-300 hover:shadow-lg mb-6"
                        href="https://lovable.dev/blog/mobile-app"
                        style={{
                          fontSize: 14,
                          fontWeight: 480,
                          lineHeight: "21px",
                          backgroundColor: "rgba(0,0,0,0.05)",
                          borderRadius: "9999px",
                          boxShadow: "rgba(0,0,0,0.05) 0px 1px 2px 0px",
                          display: "flex",
                          padding: "8px 12px 8px 8px",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 24,
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <span
                          style={{
                            color: "rgb(219,234,254)",
                            fontSize: 12,
                            fontWeight: 600,
                            lineHeight: "18px",
                            backgroundColor: "rgb(59,130,246)",
                            borderRadius: "9999px",
                            position: "relative",
                            padding: "4px 8px",
                            overflow: "hidden",
                          }}
                        >
                          <span style={{ position: "relative" }}>New</span>
                        </span>
                        Try the Lovable mobile app
                        <span aria-hidden="true" style={{ width: 16, height: 16 }}>→</span>
                      </a>
                    </div>

                    {/* Hero heading */}
                    <div
                      className="relative mb-4 flex flex-col items-center px-4 text-center md:mb-6"
                      style={{
                        textAlign: "center",
                        display: "flex",
                        position: "relative",
                        marginBottom: 24,
                        padding: "0px 16px",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      <h2
                        className="text-foreground mb-2 flex items-center gap-1 text-3xl leading-none font-semibold sm:text-3xl md:mb-2.5 md:gap-0 md:text-5xl"
                        style={{
                          fontSize: 48,
                          fontWeight: 600,
                          lineHeight: "48px",
                          textAlign: "center",
                          display: "flex",
                          marginBottom: 10,
                          alignItems: "center",
                          gap: 0,
                        }}
                      >
                        <span style={{ paddingTop: 0, letterSpacing: "-1.2px", textAlign: "center" }}>
                          Build something{" "}
                          <span style={{ fontSize: 48, fontWeight: 600, lineHeight: "48px", letterSpacing: "-1.2px" }}>
                            Lovable
                          </span>
                        </span>
                      </h2>
                      <p
                        className="text-foreground/65 mb-6 max-w-[25ch] text-center text-lg leading-tight md:max-w-full md:text-xl"
                        style={{
                          color: "rgba(28,28,28,0.65)",
                          fontSize: 20,
                          lineHeight: "25px",
                          textAlign: "center",
                          marginBottom: 24,
                        }}
                      >
                        Create apps and websites by chatting with AI
                      </p>
                    </div>

                    {/* Chat input */}
                    <div className="w-full max-w-3xl" style={{ width: "100%", maxWidth: 768 }}>
                      <div style={{ position: "relative", width: "100%" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ position: "relative", width: "100%" }}>
                            <div
                              id="chat-input"
                              style={{
                                backgroundColor: "rgb(247, 244, 237)",
                                border: "0.666667px solid white",
                                borderRadius: 28,
                                boxShadow:
                                  "oklab(0 0 0 / 0.08) 0px 0px 0px 1px, rgba(0,0,0,0.1) 0px 20px 25px -5px, rgba(0,0,0,0.1) 0px 8px 10px -6px",
                                display: "flex",
                                width: "100%",
                                minHeight: 145,
                                padding: 12,
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              <div style={{ width: "100%", minWidth: 0 }}>
                                <div style={{ minHeight: 80 }} />
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  type="button"
                                  aria-label="Additional actions"
                                  disabled
                                  style={{
                                    fontSize: 14,
                                    lineHeight: "21px",
                                    backgroundColor: "rgba(255,255,255,0.8)",
                                    borderRadius: "9999px",
                                    display: "flex",
                                    width: 32,
                                    height: 32,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 4,
                                    overflow: "hidden",
                                    opacity: 0.5,
                                    border: "none",
                                    cursor: "not-allowed",
                                  }}
                                >
                                  <span style={{ fontSize: 18 }}>+</span>
                                </button>
                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                                  <button
                                    type="button"
                                    aria-label="Enable plan mode"
                                    disabled
                                    style={{
                                      color: "rgb(28,28,28)",
                                      fontSize: 14,
                                      lineHeight: "21px",
                                      borderRadius: "9999px",
                                      display: "flex",
                                      height: 32,
                                      padding: "6px 10px",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: 2,
                                      opacity: 0.5,
                                      background: "transparent",
                                      border: "none",
                                      cursor: "not-allowed",
                                    }}
                                  >
                                    <span style={{ padding: "0px 2px" }}>Build</span>
                                    <span>▾</span>
                                  </button>
                                  <button
                                    type="submit"
                                    id="chatinput-send-message-button"
                                    disabled
                                    style={{
                                      color: "rgb(252,251,248)",
                                      fontSize: 14,
                                      background: "rgba(0,0,0,0.88)",
                                      borderRadius: "9999px",
                                      display: "flex",
                                      width: 32,
                                      height: 32,
                                      marginLeft: 4,
                                      flexShrink: 0,
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: 4,
                                      opacity: 0.5,
                                      border: "none",
                                      cursor: "not-allowed",
                                    }}
                                  >
                                    ↑
                                    <span
                                      style={{
                                        position: "absolute",
                                        width: 1,
                                        height: 1,
                                        margin: -1,
                                        overflow: "hidden",
                                        clipPath: "inset(50%)",
                                      }}
                                    >
                                      Send message
                                    </span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* CONTAINER SECTION */}
                  <div
                    className="container"
                    style={{ maxWidth: 1280, padding: "0px 80px" }}
                  >
                    {/* TRUSTED BY SECTION */}
                    <section
                      className="mx-auto max-w-5xl py-20"
                      style={{
                        width: "100%",
                        maxWidth: 1024,
                        margin: "0 auto",
                        padding: "80px 0px",
                      }}
                    >
                      <p className="mb-4 text-center text-pretty md:mb-8" style={{ textAlign: "center", marginBottom: 32 }}>
                        Teams from top companies build with Lovable
      </p>
                      <div style={{ display: "flex", width: "100%", justifyContent: "center" }}>
                        <div style={{ width: "100%", overflowX: "clip" }}>
                          <div style={{ display: "flex", width: "100%", alignItems: "center", gap: 80, overflowX: "clip" }}>
                            {/* Brand names as text instead of SVG logos */}
                            {["Zerodisk", "Uber", "HubSpot", "Buildkite"].map((brand) => (
                              <div
                                key={brand}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  height: 32,
                                  color: "rgb(28,28,28)",
                                  fontWeight: 600,
                                  fontSize: 18,
                                  letterSpacing: "-0.3px",
                                  whiteSpace: "nowrap",
                                  opacity: 0.7,
                                }}
                              >
                                {brand}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* FEATURES + TEMPLATES + NUMBERS */}
                    <div
                      className="flex w-full flex-col gap-20 md:gap-40"
                      style={{ display: "flex", flexDirection: "column", gap: 160 }}
                    >

                      {/* MEET LOVABLE SECTION */}
                      <section>
                        <h2
                          className="text-4xl leading-[1.1] font-semibold tracking-tight md:text-5xl mb-10"
                          style={{ fontSize: 48, fontWeight: 600, lineHeight: "52.8px", letterSpacing: "-1.2px", marginBottom: 40 }}
                        >
                          <span
                            className="inline"
                            style={{
                              color: "transparent",
                              background:
                                "linear-gradient(90deg, rgb(28,28,28) 0px, rgb(28,28,28) 33.33%, rgb(130,188,255) 40%, rgb(36,131,255) 45%, rgb(255,102,244) 50%, rgb(255,48,41) 55%, rgb(254,123,2) 60%, transparent 66.67%, transparent)",
                              backgroundSize: "300% 100%",
                              backgroundPosition: "100% 0px",
                              backgroundClip: "text",
                              WebkitBackgroundClip: "text",
                              display: "inline",
                            }}
                          >
                            Meet Lovable
                          </span>
                        </h2>
                        <div
                          className="flex w-full flex-1 flex-col justify-center gap-12 md:flex-row md:items-center"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 48,
                            flexDirection: "row",
                          }}
                        >
                          {/* Video panel */}
                          <div
                            style={{
                              backgroundColor: "rgb(247, 244, 237)",
                              borderRadius: 16,
                              display: "grid",
                              width: 560,
                              height: 328,
                              padding: "24px 0px",
                              alignItems: "center",
                              justifyContent: "center",
                              gridTemplateColumns: "400px",
                              gridTemplateRows: "280px",
                            }}
                          >
                            <div style={{ width: 400, height: 150, gridColumn: 1, gridRow: 1, opacity: 1 }}>
                              <div style={{ position: "relative", width: 400, height: 150 }}>
                                <div style={{ borderRadius: 16, width: 400, height: 150, overflow: "hidden" }}>
                                  <video
                                    muted
                                    playsInline
                                    style={{ width: 400, height: 150, objectFit: "cover" }}
                                    preload="none"
                                    aria-label="Start with an idea"
                                  />
                                </div>
                              </div>
                            </div>
                            <div style={{ width: 400, height: 280, gridColumn: 1, gridRow: 1, opacity: 0, pointerEvents: "none" }}>
                              <div style={{ position: "relative", width: 400, height: 280 }}>
                                <div style={{ borderRadius: 16, width: 400, height: 280, overflow: "hidden" }}>
                                  <video
                                    muted
                                    playsInline
                                    style={{ width: 400, height: 280, objectFit: "cover" }}
                                    preload="none"
                                    aria-label="Watch it come to life"
                                    poster="https://lovable.dev/cdn-cgi/image/width=400,f=auto,fit=scale-down/img/homepage/scene-2-poster.webp"
                                  />
                                </div>
                              </div>
                            </div>
                            <div style={{ width: 400, height: 280, gridColumn: 1, gridRow: 1, opacity: 0, pointerEvents: "none" }}>
                              <div style={{ position: "relative", width: 400, height: 280 }}>
                                <div style={{ borderRadius: 16, width: 400, height: 280, overflow: "hidden" }}>
                                  <video
                                    muted
                                    playsInline
                                    style={{ width: 400, height: 280, objectFit: "cover" }}
                                    preload="none"
                                    aria-label="Refine and ship"
                                    poster="https://lovable.dev/cdn-cgi/image/width=400,f=auto,fit=scale-down/img/homepage/scene-3-poster.webp"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Steps */}
                          <div style={{ width: 512, maxWidth: 512 }}>
                            <div style={{ marginBottom: 32 }}>
                              <button
                                type="button"
                                tabIndex={0}
                                aria-pressed="true"
                                style={{ display: "inline-block", width: 512, cursor: "pointer", textAlign: "left", background: "none", border: "none", padding: 0, marginBottom: 32 }}
                              >
                                <h3 style={{ fontSize: 36, fontWeight: 600, lineHeight: "39.6px", letterSpacing: "-0.9px", marginBottom: 8 }}>
                                  Start with an idea
                                </h3>
                                <p style={{ fontSize: 18, lineHeight: "24.75px" }}>
                                  Describe the app or website you want to create or drop in screenshots and docs
                                </p>
                              </button>
                            </div>
                            <div style={{ marginBottom: 32 }}>
                              <button
                                type="button"
                                tabIndex={0}
                                aria-pressed="false"
                                style={{ display: "inline-block", width: 512, cursor: "pointer", textAlign: "left", opacity: 0.5, background: "none", border: "none", padding: 0, marginBottom: 32 }}
                              >
                                <h3 style={{ fontSize: 36, fontWeight: 600, lineHeight: "39.6px", letterSpacing: "-0.9px", marginBottom: 8 }}>
                                  Watch it come to life
                                </h3>
                                <p style={{ fontSize: 18, lineHeight: "24.75px" }}>
                                  See your vision transform into a working prototype in real-time as AI builds it for you
                                </p>
                              </button>
                            </div>
                            <div>
                              <button
                                type="button"
                                tabIndex={0}
                                aria-pressed="false"
                                style={{ display: "inline-block", width: 512, cursor: "pointer", textAlign: "left", opacity: 0.5, background: "none", border: "none", padding: 0 }}
                              >
                                <h3 style={{ fontSize: 36, fontWeight: 600, lineHeight: "39.6px", letterSpacing: "-0.9px", marginBottom: 8 }}>
                                  Refine and ship
                                </h3>
                                <p style={{ fontSize: 18, lineHeight: "24.75px" }}>
                                  Iterate on your creation with simple feedback and deploy it to the world with one click
                                </p>
                              </button>
                            </div>
                          </div>
                        </div>
                      </section>

                      {/* DISCOVER TEMPLATES SECTION */}
                      <section>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                            justifyContent: "space-between",
                            gap: 16,
                            marginBottom: 40,
                          }}
                        >
                          <div>
                            <h2
                              style={{ fontSize: 48, fontWeight: 600, lineHeight: "52.8px", letterSpacing: "-1.2px", marginBottom: 10 }}
                            >
                              Discover{" "}
                              <span
                                className="inline"
                                style={{
                                  color: "transparent",
                                  background:
                                    "linear-gradient(90deg, rgb(28,28,28) 0px, rgb(28,28,28) 33.33%, rgb(130,188,255) 40%, rgb(36,131,255) 45%, rgb(255,102,244) 50%, rgb(255,48,41) 55%, rgb(254,123,2) 60%, transparent 66.67%, transparent)",
                                  backgroundSize: "300% 100%",
                                  backgroundPosition: "100% 0px",
                                  backgroundClip: "text",
                                  WebkitBackgroundClip: "text",
                                  display: "inline",
                                }}
                              >
                                templates
                              </span>
                            </h2>
                            <p style={{ fontSize: 18, lineHeight: "24.75px" }}>Start your next project with a template</p>
                          </div>
                          <a
                            href="https://lovable.dev/templates"
                            style={{
                              color: "rgb(28,28,28)",
                              fontSize: 14,
                              lineHeight: "21px",
                              textDecoration: "none",
                              whiteSpace: "nowrap",
                              border: "0.666667px solid rgba(0,0,0,0.2)",
                              borderRadius: 8,
                              display: "flex",
                              height: 32,
                              padding: "6px 10px",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                            }}
                          >
                            View all
                          </a>
                        </div>

                        {/* Template grid */}
                        <div
                          style={{
                            display: "grid",
                            width: "100%",
                            gap: 24,
                            gridTemplateColumns: "repeat(4, 1fr)",
                          }}
                        >
                          {[
                            { title: "Personal portfolio", subtitle: "Personal work showcase", href: "https://lovable.dev/templates/websites/portfolio/hobby-photographer", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/hobby-photographer-screenshot.webp" },
                            { title: "Lovable slides", subtitle: "Code-powered presentation builder", href: "https://lovable.dev/templates/apps/saas/lovable-slides", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/lovable-slides-final.webp" },
                            { title: "Architect Portfolio Website Template", subtitle: "Firm website & showcase", href: "https://lovable.dev/templates/websites/portfolio/architect-portfolio-1", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/architect-portfolio-1-screenshot.webp" },
                            { title: "Fashion blog", subtitle: "Minimal, playful design", href: "https://lovable.dev/templates/websites/blog/vesper", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/vesper-screenshot.webp" },
                            { title: "Event Platform Website Template", subtitle: "Find, register, create events", href: "https://lovable.dev/templates/websites/events/event-platform-1", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/event-platform-1-screenshot.webp" },
                            { title: "Personal blog", subtitle: "Muted, intimate design", href: "https://lovable.dev/templates/websites/blog/perspective-lifestyle", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a8b116a9-20b6-43a8-ae91-693ba5a35c3b/id-preview-172571d0--7410f81b-8218-4f2d-bb32-1ba1f84eabb2.lovable.app-1760028648399.png" },
                            { title: "Lifestyle Blog", subtitle: "Sophisticated blog design", href: "https://lovable.dev/templates/websites/blog/lifestyle-blog-3", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/lifestyle-blog-3-screenshot.webp" },
                            { title: "Ecommerce Store Website Template", subtitle: "Premium design for webstore", href: "https://lovable.dev/templates/websites/ecommerce/ecommerce-store-1", img: "https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down/templates/ecommerce-store-1-screenshot.webp" },
                          ].map((tpl) => (
                            <div key={tpl.href} className="fade-in">
                              <article
                                className="group relative flex flex-col"
                                aria-label={tpl.title}
                                style={{ display: "flex", position: "relative", flexDirection: "column" }}
                              >
                                <div style={{ position: "relative", marginBottom: 8, aspectRatio: "16 / 9" }}>
                                  <a
                                    aria-label={tpl.title}
                                    href={tpl.href}
                                    style={{
                                      backgroundColor: "rgb(247, 244, 237)",
                                      borderRadius: 12,
                                      display: "block",
                                      position: "relative",
                                      overflow: "hidden",
                                      aspectRatio: "16 / 9",
                                    }}
                                  >
                                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                                      <img
                                        src={tpl.img}
                                        draggable={false}
                                        alt=""
                                        style={{
                                          border: "0.666667px solid rgb(236, 234, 228)",
                                          borderRadius: 12,
                                          position: "absolute",
                                          inset: 0,
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "cover",
                                          objectPosition: "50% 0%",
                                        }}
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    </div>
                                  </a>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <a
                                    tabIndex={-1}
                                    aria-hidden="true"
                                    href={tpl.href}
                                    style={{ display: "flex", minWidth: 0, flex: "1 1 0%", textDecoration: "none", color: "inherit" }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        minWidth: 0,
                                        flex: "1 1 0%",
                                        alignItems: "center",
                                        gap: 8,
                                        overflow: "hidden",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          minWidth: 0,
                                          flex: "1 1 0%",
                                          flexDirection: "column",
                                          overflow: "hidden",
                                        }}
                                      >
                                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {tpl.title}
                                        </span>
                                        <span
                                          style={{
                                            color: "rgb(95, 95, 93)",
                                            fontSize: 14,
                                            lineHeight: "21px",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                        >
                                          {tpl.subtitle}
                                        </span>
                                      </div>
                                    </div>
                                  </a>
                                </div>
                              </article>
                            </div>
                          ))}
                        </div>
                      </section>

                      {/* LOVABLE IN NUMBERS */}
                      <section>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "flex-end",
                            justifyContent: "space-between",
                            gap: 16,
                            marginBottom: 40,
                          }}
                        >
                          <div>
                            <h2
                              style={{ fontSize: 48, fontWeight: 600, lineHeight: "52.8px", letterSpacing: "-1.2px", marginBottom: 10 }}
                            >
                              Lovable{" "}
                              <span
                                className="inline"
                                style={{
                                  color: "transparent",
                                  background:
                                    "linear-gradient(90deg, rgb(28,28,28) 0px, rgb(28,28,28) 33.33%, rgb(130,188,255) 40%, rgb(36,131,255) 45%, rgb(255,102,244) 50%, rgb(255,48,41) 55%, rgb(254,123,2) 60%, transparent 66.67%, transparent)",
                                  backgroundSize: "300% 100%",
                                  backgroundPosition: "100% 0px",
                                  backgroundClip: "text",
                                  WebkitBackgroundClip: "text",
                                  display: "inline",
                                }}
                              >
                                in numbers
                              </span>
                            </h2>
                            <p style={{ fontSize: 18, lineHeight: "24.75px" }}>
                              Millions of builders are already turning ideas into reality
                            </p>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            width: "100%",
                            gap: 8,
                            gridTemplateColumns: "repeat(3, 1fr)",
                          }}
                        >
                          {[
                            { num: "0M+", label: "projects built on Lovable" },
                            { num: "0K+", label: "projects built per day on Lovable" },
                            { num: "0M", label: "visits per day to Lovable-built applications" },
                          ].map((stat) => (
                            <div
                              key={stat.label}
                              style={{
                                backgroundColor: "rgb(247, 244, 237)",
                                borderRadius: 24,
                                display: "flex",
                                height: 276,
                                padding: "24px 20px",
                                flexDirection: "column",
                                gap: 144,
                              }}
                            >
                              <div style={{ fontSize: 60, fontWeight: 480, lineHeight: "60px" }}>
                                <span>{stat.num.replace(/[MK+]/g, "")}</span>
                                <span>{stat.num.replace(/\d/g, "")}</span>
                              </div>
                              <div style={{ marginTop: "auto" }}>
                                <p>{stat.label}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </main>

              {/* CTA + FOOTER SECTION */}
              <div
                style={{ position: "relative", zIndex: 10, paddingBottom: 80 }}
              >
                <div
                  style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
                >
                  <div style={{ position: "absolute", left: "50%", width: "200vw", minWidth: 2400, transform: "translateX(-50%)", aspectRatio: "1 / 1" }}>
                    <div style={{ position: "absolute", inset: 0, top: "-25%" }}>
                      <img
                        src="https://lovable.dev/cdn-cgi/image/width=3840,f=auto,fit=scale-down,quality=50/img/background/pulse.webp"
                        alt=""
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          objectPosition: "50% 0%",
                          filter: "blur(4px)",
                        }}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  </div>
                </div>

                {/* CTA block */}
                <div
                  style={{
                    maxWidth: 576,
                    margin: "128px auto 176px",
                    padding: "32px 0px 0px",
                    textAlign: "center",
                  }}
                >
                  <h1
                    style={{
                      color: "rgb(95, 95, 93)",
                      fontSize: 20,
                      lineHeight: "30px",
                      textAlign: "center",
                      display: "block",
                      marginBottom: 8,
                      fontWeight: "normal",
                    }}
                  >
                    AI App Builder
                  </h1>
                  <h2
                    style={{
                      fontSize: 60,
                      fontWeight: 600,
                      lineHeight: "66px",
                      letterSpacing: "-1.5px",
                      textAlign: "center",
                      marginBottom: 32,
                    }}
                  >
                    <span
                      className="inline"
                      style={{
                        color: "transparent",
                        background:
                          "linear-gradient(90deg, rgb(28,28,28) 0px, rgb(28,28,28) 33.33%, rgb(130,188,255) 40%, rgb(36,131,255) 45%, rgb(255,102,244) 50%, rgb(255,48,41) 55%, rgb(254,123,2) 60%, transparent 66.67%, transparent)",
                        backgroundSize: "300% 100%",
                        backgroundPosition: "100% 0px",
                        backgroundClip: "text",
                        WebkitBackgroundClip: "text",
                        display: "inline",
                      }}
                    >
                      Ready to build?
                    </span>
                  </h2>

                  {/* Bottom chat input */}
                  <div style={{ width: "100%", maxWidth: 768 }}>
                    <div style={{ position: "relative", width: "100%" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ position: "relative", width: "100%" }}>
                          <div
                            style={{
                              backgroundColor: "rgb(247, 244, 237)",
                              border: "0.666667px solid white",
                              borderRadius: 28,
                              boxShadow:
                                "oklab(0 0 0 / 0.08) 0px 0px 0px 1px, rgba(0,0,0,0.1) 0px 20px 25px -5px, rgba(0,0,0,0.1) 0px 8px 10px -6px",
                              display: "flex",
                              width: "100%",
                              minHeight: 145,
                              padding: 12,
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            <div style={{ width: "100%", minWidth: 0 }}>
                              <div style={{ minHeight: 80 }} />
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                              <button
                                type="button"
                                aria-label="Additional actions"
                                disabled
                                style={{
                                  backgroundColor: "rgba(255,255,255,0.8)",
                                  borderRadius: "9999px",
                                  display: "flex",
                                  width: 32,
                                  height: 32,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  opacity: 0.5,
                                  border: "none",
                                  cursor: "not-allowed",
                                }}
                              >
                                <span style={{ fontSize: 18 }}>+</span>
                              </button>
                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                                <button
                                  type="button"
                                  aria-label="Enable plan mode"
                                  disabled
                                  style={{
                                    color: "rgb(28,28,28)",
                                    fontSize: 14,
                                    borderRadius: "9999px",
                                    display: "flex",
                                    height: 32,
                                    padding: "6px 10px",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 2,
                                    opacity: 0.5,
                                    background: "transparent",
                                    border: "none",
                                    cursor: "not-allowed",
                                  }}
                                >
                                  <span style={{ padding: "0px 2px" }}>Build</span>
                                  <span>▾</span>
                                </button>
                                <button
                                  type="submit"
                                  disabled
                                  style={{
                                    color: "rgb(252,251,248)",
                                    background: "rgba(0,0,0,0.88)",
                                    borderRadius: "9999px",
                                    display: "flex",
                                    width: 32,
                                    height: 32,
                                    marginLeft: 4,
                                    flexShrink: 0,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    opacity: 0.5,
                                    border: "none",
                                    cursor: "not-allowed",
                                  }}
                                >
                                  ↑
                                  <span
                                    style={{
                                      position: "absolute",
                                      width: 1,
                                      height: 1,
                                      margin: -1,
                                      overflow: "hidden",
                                      clipPath: "inset(50%)",
                                    }}
                                  >
                                    Send message
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* FOOTER */}
                <div style={{ maxWidth: "100%", padding: "0px 80px" }}>
                  <footer
                    style={{
                      backgroundColor: "rgb(247, 244, 237)",
                      border: "0.666667px solid rgb(236, 234, 228)",
                      borderRadius: 16,
                      position: "relative",
                      padding: 56,
                    }}
                  >
                    <nav
                      style={{
                        display: "grid",
                        gap: "48px 32px",
                        gridTemplateColumns: "repeat(6, 1fr)",
                        gridTemplateRows: "repeat(2, auto)",
                      }}
                    >
                      {/* Logo cell - text only, no SVG */}
                      <div
                        style={{
                          display: "flex",
                          height: "100%",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          gridColumn: "span 1",
                        }}
                      >
                        <a
                          href="https://lovable.dev/home"
                          style={{ textDecoration: "none", display: "flex", alignItems: "center", width: "fit-content" }}
                        >
                          <span
                            style={{
                              fontFamily: "'Camera Plain Variable', sans-serif",
                              fontWeight: 700,
                              fontSize: 22,
                              color: "rgb(28,28,28)",
                              letterSpacing: "-0.5px",
                            }}
                          >
                            ♥
                          </span>
                        </a>
                      </div>

                      {/* Company */}
                      <FooterColumn
                        title="Company"
                        links={[
                          { label: "Careers", href: "https://lovable.dev/careers" },
                          { label: "Press & media", href: "https://lovable.dev/brand" },
                          { label: "Enterprise", href: "https://lovable.dev/enterprise-landing" },
                          { label: "Security", href: "https://lovable.dev/security" },
                          { label: "Trust center", href: "https://trust.lovable.dev", external: true },
                          { label: "Partnerships", href: "https://lovable.dev/partners" },
                        ]}
                      />

                      {/* Product */}
                      <FooterColumn
                        title="Product"
                        links={[
                          { label: "Pricing", href: "https://lovable.dev/pricing" },
                          { label: "Student discount", href: "https://lovable.dev/students" },
                          { label: "Founders", href: "https://lovable.dev/founders" },
                          { label: "Product Managers", href: "https://lovable.dev/product-managers" },
                          { label: "Designers", href: "https://lovable.dev/designers" },
                          { label: "Marketers", href: "https://lovable.dev/marketers" },
                          { label: "Sales", href: "https://lovable.dev/sales" },
                          { label: "Ops", href: "https://lovable.dev/ops" },
                          { label: "People", href: "https://lovable.dev/people" },
                          { label: "Prototyping", href: "https://lovable.dev/prototypes" },
                          { label: "Internal Tools", href: "https://lovable.dev/tools" },
                          { label: "Connections", href: "https://docs.lovable.dev/integrations/introduction", external: true },
                          { label: "Changelog", href: "https://docs.lovable.dev/changelog", external: true },
                          { label: "Status", href: "https://status.lovable.dev/", external: true },
                        ]}
                      />

                      {/* Resources */}
                      <FooterColumn
                        title="Resources"
                        links={[
                          { label: "Learn", href: "https://docs.lovable.dev/introduction/welcome", external: true },
                          { label: "Templates", href: "https://lovable.dev/templates" },
                          { label: "Guides", href: "https://lovable.dev/guides" },
                          { label: "Connectors", href: "https://lovable.dev/connect" },
                          { label: "Videos", href: "https://lovable.dev/videos" },
                          { label: "Blog", href: "https://lovable.dev/blog" },
                          { label: "Support", href: "https://lovable.dev/support" },
                          { label: "Reviews", href: "https://lovable.dev/reviews" },
                          { label: "FAQs", href: "https://lovable.dev/faq" },
                          { label: "Sitemap", href: "https://lovable.dev/sitemap" },
                        ]}
                      />

                      {/* Legal */}
                      <FooterColumn
                        title="Legal"
                        links={[
                          { label: "Privacy policy", href: "https://lovable.dev/privacy", external: true },
                          { label: "Do not sell or share my personal information", href: "https://lovable.dev/do-not-sell-or-share-my-personal-information" },
                          { label: "Cookie settings", href: "https://lovable.dev/cookie-policy" },
                          { label: "Enterprise terms", href: "https://lovable.dev/legal", external: true },
                          { label: "General terms", href: "https://lovable.dev/terms", external: true },
                          { label: "Desktop app terms", href: "https://lovable.dev/desktop-app-terms", external: true },
                          { label: "Domain registration terms", href: "https://lovable.dev/domain-registration-terms", external: true },
                          { label: "Platform rules", href: "https://rules.lovable.dev/", external: true },
                          { label: "Report abuse", href: "https://lovable.dev/abuse", external: true },
                          { label: "Report security concerns", href: "https://lovable.dev/security-issues", external: true },
                          { label: "DPA", href: "https://lovable.dev/data-processing-agreement", external: true },
                        ]}
                      />

                      {/* Community */}
                      <FooterColumn
                        title="Community"
                        links={[
                          { label: "Become a partner", href: "https://lovable.dev/partners" },
                          { label: "Hire a Lovable expert", href: "https://lovable.dev/experts" },
                          { label: "Affiliates", href: "https://lovable.dev/affiliates" },
                          { label: "Code of conduct", href: "https://lovable.dev/community-code-of-conduct" },
                          { label: "Discord", href: "https://discord.com/invite/lovable-dev", external: true },
                          { label: "Reddit", href: "https://reddit.com/r/lovable", external: true },
                          { label: "X / Twitter", href: "https://twitter.com/Lovable", external: true },
                          { label: "YouTube", href: "https://www.youtube.com/@lovable", external: true },
                          { label: "LinkedIn", href: "https://www.linkedin.com/company/lovable-dev/", external: true },
                        ]}
                      />

                      {/* Language selector */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          gridColumn: "span 1",
                        }}
                      >
                        <button
                          style={{
                            color: "rgb(95, 95, 93)",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                          }}
                          type="button"
                          aria-expanded="false"
                        >
                          🌐
                          <span style={{ color: "rgb(95, 95, 93)", fontSize: 14, lineHeight: "21px" }}>EN</span>
                        </button>
                      </div>
                    </nav>
                  </footer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Footer column component
function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}) {
  return (
    <div style={{ gridRow: "span 2" }}>
      <h3
        style={{
          color: "rgb(95, 95, 93)",
          fontSize: 14,
          lineHeight: "21px",
          fontWeight: "normal",
          marginBottom: 16,
        }}
      >
        {title}
      </h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {links.map((link) => (
          <li key={link.href} style={{ marginBottom: 12 }}>
            <a
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              style={{
                fontSize: 14,
                lineHeight: "21px",
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              {link.label}
              {link.external && (
                <span style={{ opacity: 0, fontSize: 10 }}>↗</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
