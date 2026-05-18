/**
 * Poyne Analytics Tracker v1.2
 * Usage Next.js (recommandé) :
 *   import Script from 'next/script'
 *   <Script src="https://v0vibebeta.vercel.app/poyne.js" data-site-id="YOUR_SITE_ID" strategy="afterInteractive" />
 *
 * HTML classique :
 *   <script src="https://v0vibebeta.vercel.app/poyne.js" data-site-id="YOUR_SITE_ID" defer></script>
 *
 * Options : data-debug="true" pour les logs console.
 */
(function () {
  'use strict';

  // ─── Trouver le script tag ─────────────────────────────────────────────────
  var script =
    document.currentScript ||
    document.querySelector('script[data-site-id]') ||
    document.querySelector('script[src*="poyne"]');

  var siteId = script && script.getAttribute('data-site-id');
  var debug  = script && script.getAttribute('data-debug') === 'true';

  function log()  { if (debug) console.log.apply(console,  ['[Poyne]'].concat(Array.prototype.slice.call(arguments))); }
  function warn() { console.warn.apply(console, ['[Poyne]'].concat(Array.prototype.slice.call(arguments))); }

  if (!siteId) { warn('data-site-id manquant. Tracking désactivé.'); return; }

  var apiBase  = (script.getAttribute('data-api-url') || 'https://v0vibebeta.vercel.app').replace(/\/$/, '');
  var trackUrl   = apiBase + '/api/track';
  var presenceUrl = apiBase + '/api/presence/' + encodeURIComponent(siteId);

  // ─── IDs ───────────────────────────────────────────────────────────────────

  /** sessionId : vide à la fermeture du tab (GDPR safe) */
  var SESSION_KEY = '__pyn_s_' + siteId;
  function getSessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) { id = Math.random().toString(36).slice(2,10) + Date.now().toString(36); sessionStorage.setItem(SESSION_KEY, id); }
      return id;
    } catch(_) { return Math.random().toString(36).slice(2,10); }
  }

  /** visitorId : persiste dans localStorage → permet de détecter les retours */
  var VISITOR_KEY = '__pyn_v_' + siteId;
  /** isNew : false si le visiteur a déjà visité ce site */
  var SEEN_KEY    = '__pyn_seen_' + siteId;
  function getVisitorId() {
    try {
      var vid = localStorage.getItem(VISITOR_KEY);
      if (!vid) { vid = 'v_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); localStorage.setItem(VISITOR_KEY, vid); }
      return vid;
    } catch(_) { return 'v_anon'; }
  }
  function isNewVisitor() {
    try {
      var seen = localStorage.getItem(SEEN_KEY);
      if (!seen) { localStorage.setItem(SEEN_KEY, '1'); return true; }
      return false;
    } catch(_) { return true; }
  }

  var sessionId = getSessionId();
  var visitorId = getVisitorId();
  var isNew     = isNewVisitor();

  log('Init — siteId:', siteId, '| session:', sessionId, '| visitor:', visitorId, '| new:', isNew);

  // ─── POST générique ────────────────────────────────────────────────────────
  function post(url, payload) {
    var body = JSON.stringify(payload);
    if (typeof fetch !== 'undefined') {
      fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:body, keepalive:true })
        .then(function(r){ if(!r.ok) r.text().then(function(t){ warn('API error', r.status, t); }); })
        .catch(function(e){ warn('fetch failed:', e); });
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type','application/json');
      xhr.send(body);
    } catch(_) {}
  }

  // ─── Pageview ──────────────────────────────────────────────────────────────
  function track() {
    log('Pageview →', location.pathname);
    post(trackUrl, {
      siteId:    siteId,
      page:      location.pathname + location.search,
      referrer:  document.referrer || '',
      title:     document.title   || '',
      sessionId: sessionId,
      visitorId: visitorId,
      isNew:     isNew,
      width:     window.innerWidth || 0,
    });
  }

  // ─── Presence heartbeat ────────────────────────────────────────────────────
  // Envoyé toutes les 30 s + à chaque changement de page SPA
  function heartbeat() {
    log('Heartbeat →', location.pathname);
    post(presenceUrl, {
      sessionId: sessionId,
      visitorId: visitorId,
      isNew:     isNew,
      page:      location.pathname + location.search,
      title:     document.title || '',
    });
  }

  var _heartbeatTimer = null;
  var _isVisible = !document.hidden; // true si l'onglet est visible

  function startHeartbeat() {
    if (_heartbeatTimer) clearInterval(_heartbeatTimer);
    if (!_isVisible) return; // ne pas heartbeat si l'onglet est caché
    heartbeat(); // immédiat
    // heartbeat toutes les 15s (fenêtre présence = 45s)
    _heartbeatTimer = setInterval(function() {
      if (_isVisible) heartbeat();
    }, 15000);
  }

  function stopHeartbeat() {
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    // Supprimer la présence immédiatement → disparaît du dashboard live
    try {
      fetch(presenceUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId }),
        keepalive: true,
      });
    } catch(_) {}
  }

  // ─── Pause quand l'onglet passe en arrière-plan ────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      log('Tab caché → pause heartbeat');
      _isVisible = false;
      stopHeartbeat();
    } else {
      log('Tab visible → reprise heartbeat');
      _isVisible = true;
      startHeartbeat();
    }
  });

  // ─── Fermeture de l'onglet ─────────────────────────────────────────────────
  window.addEventListener('beforeunload', function() {
    stopHeartbeat();
  });

  // ─── Navigation SPA ────────────────────────────────────────────────────────
  var lastPath = location.pathname;
  var _pushState = history.pushState.bind(history);
  history.pushState = function(state, title, url) {
    _pushState(state, title, url);
    setTimeout(function() {
      if (location.pathname !== lastPath) { lastPath = location.pathname; track(); startHeartbeat(); }
    }, 0);
  };
  window.addEventListener('popstate', function() {
    setTimeout(function() {
      if (location.pathname !== lastPath) { lastPath = location.pathname; track(); startHeartbeat(); }
    }, 0);
  });

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() { track(); startHeartbeat(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.poyne = { track:track, siteId:siteId, visitorId:visitorId, sessionId:sessionId };
})();
