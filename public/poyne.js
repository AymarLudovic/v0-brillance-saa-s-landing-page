/**
 * Poyne Analytics Tracker v1.0
 * Usage: <script src="https://your-domain.com/poyne.js" data-site-id="YOUR_SITE_ID" defer></script>
 * Optional: data-api-url="https://your-domain.com" (if self-hosted on a different domain)
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var siteId = script && script.getAttribute('data-site-id');
  if (!siteId) {
    console.warn('[Poyne] Missing data-site-id attribute on the script tag.');
    return;
  }
  var apiBase = (script.getAttribute('data-api-url') || 'https://v0vibebeta.vercel.app').replace(/\/$/, '');
 var endpoint = apiBase + '/api/track';

  // ─── Anonymous Session ID ──────────────────────────────────────────────────
  // Stored in sessionStorage (cleared when tab closes) — cookieless & GDPR-safe
  var SESSION_KEY = '__pyn_' + siteId;

  function getSessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_) {
      return Math.random().toString(36).slice(2, 10);
    }
  }

  // ─── Track Pageview ────────────────────────────────────────────────────────
  function track() {
    var payload = JSON.stringify({
      siteId:    siteId,
      page:      location.pathname + location.search,
      referrer:  document.referrer || '',
      title:     document.title   || '',
      sessionId: getSessionId(),
      width:     window.innerWidth || 0,
    });

    // sendBeacon is preferred: non-blocking, survives page unload
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
        return;
      } catch (_) { /* fallback below */ }
    }

    // XHR fallback for older browsers
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    } catch (_) { /* silent fail — never break the host site */ }
  }

  // ─── Initial Page Load ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', track);
  } else {
    track();
  }

  // ─── SPA Navigation (React Router, Next.js, Vue Router…) ──────────────────
  var lastPath = location.pathname;

  var _pushState = history.pushState.bind(history);
  history.pushState = function (state, title, url) {
    _pushState(state, title, url);
    setTimeout(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        track();
      }
    }, 0);
  };

  window.addEventListener('popstate', function () {
    setTimeout(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        track();
      }
    }, 0);
  });

  // ─── Public API ────────────────────────────────────────────────────────────
  // window.poyne.track() — call manually for custom events
  window.poyne = { track: track, siteId: siteId };
})();
