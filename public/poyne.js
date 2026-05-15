/**
 * Poyne Analytics Tracker v1.1
 * Usage:
 *   <script src="https://v0vibebeta.vercel.app/poyne.js" data-site-id="YOUR_SITE_ID" defer></script>
 *
 * Next.js (recommandé) :
 *   import Script from 'next/script'
 *   <Script src="https://v0vibebeta.vercel.app/poyne.js" data-site-id="YOUR_SITE_ID" strategy="afterInteractive" />
 *
 * Debug : ajouter data-debug="true" pour voir les logs dans la console.
 */
(function () {
  'use strict';

  // ─── Trouver le script tag ─────────────────────────────────────────────────
  // document.currentScript est null avec defer et next/script (injection dynamique).
  // On cherche en priorité par data-site-id, puis par le src.
  var script =
    document.currentScript ||
    document.querySelector('script[data-site-id]') ||
    document.querySelector('script[src*="poyne"]');

  var siteId = script && script.getAttribute('data-site-id');
  var debug  = script && script.getAttribute('data-debug') === 'true';

  function log() {
    if (debug) console.log.apply(console, ['[Poyne]'].concat(Array.prototype.slice.call(arguments)));
  }
  function warn() {
    console.warn.apply(console, ['[Poyne]'].concat(Array.prototype.slice.call(arguments)));
  }

  if (!siteId) {
    warn('data-site-id manquant sur le script tag. Tracking désactivé.');
    return;
  }

  var apiBase  = (script.getAttribute('data-api-url') || 'https://v0vibebeta.vercel.app').replace(/\/$/, '');
  var endpoint = apiBase + '/api/track';

  log('Initialisé — siteId:', siteId, '| endpoint:', endpoint);

  // ─── Session ID (cookieless, GDPR-safe) ────────────────────────────────────
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

  // ─── Envoi du pageview ─────────────────────────────────────────────────────
  function track() {
    var payload = JSON.stringify({
      siteId:    siteId,
      page:      location.pathname + location.search,
      referrer:  document.referrer || '',
      title:     document.title   || '',
      sessionId: getSessionId(),
      width:     window.innerWidth || 0,
    });

    log('Envoi pageview →', location.pathname);

    // fetch (moderne, avec logs d'erreur)
    if (typeof fetch !== 'undefined') {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,   // survit au déchargement de page comme sendBeacon
      })
        .then(function (res) {
          if (res.ok) { log('✓ Pageview enregistré'); }
          else { res.text().then(function (t) { warn('Erreur API', res.status, t); }); }
        })
        .catch(function (err) { warn('Fetch échoué:', err); });
      return;
    }

    // sendBeacon fallback
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
        log('✓ sendBeacon envoyé');
        return;
      } catch (_) { /* fallback xhr */ }
    }

    // XHR fallback pour vieux navigateurs
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    } catch (_) { /* ne jamais casser le site hôte */ }
  }

  // ─── Chargement initial ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', track);
  } else {
    track();
  }

  // ─── Navigation SPA (Next.js, React Router, Vue Router…) ──────────────────
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

  // ─── API publique ──────────────────────────────────────────────────────────
  window.poyne = { track: track, siteId: siteId };
})();
