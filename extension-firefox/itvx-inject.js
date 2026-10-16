(function() {
  'use strict';

  const CURRENT_HOST = location.hostname.toLowerCase();
  const IS_ITV = CURRENT_HOST === 'itv.com' || CURRENT_HOST.endsWith('.itv.com');
  const IS_CHANNEL4 = CURRENT_HOST === 'channel4.com' || CURRENT_HOST.endsWith('.channel4.com');

  let started = false;

  function startStreamingProtection() {
    if (started) return;
    started = true;

    console.log('[adblock/streaming] injector active:', CURRENT_HOST,
      IS_ITV ? '(ITV/ITVX)' : IS_CHANNEL4 ? '(Channel 4)' : '(other)');

    // ── ITVX ad detection neutraliser ─────────────────────────────────────
    const _fetch = window.fetch;
    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (url.includes('ad-ops-ingest-itv-ds-prd') || url.includes('cloudfunctions.net/ad-ops')) {
        return _fetch.apply(this, args).catch(() => {
          return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
      }
      return _fetch.apply(this, args);
    };

    function neutralise(obj) {
      if (!obj || typeof obj !== 'object') return false;
      if ('adBlockingDetectionModel' in obj) {
        const m = obj.adBlockingDetectionModel;
        if (m && typeof m === 'object') {
          m.assessAdBlocking = async () => false;
          m.emitAdBlockingStatus = () => {};
          m.adBlockingDetected = false;
          m.enabled = false;
          return true;
        }
      }
      return false;
    }

    const namespaces = ['N', 'B', 'Z', 'app', 'ITV', 'itv', '__APP__'];
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      namespaces.forEach(ns => {
        if (window[ns] && neutralise(window[ns])) clearInterval(interval);
      });
      neutralise(window);
      if (attempts > 200) clearInterval(interval);
    }, 50);

    // ── Pop-under / redirect blocker ───────────────────────────────────────
    const BLOCKED_DOMAINS = [
      'hai8g.com',
      'trafficjunky',
      'exoclick',
      'popads',
      'popcash',
      'adsterra',
      'propellerads',
      'hilltopads',
      'clickadu',
      'juicyads',
      'adsrvr.org',
    ];

    function isBlocked(url) {
      if (!url) return false;
      const s = String(url).toLowerCase();
      return BLOCKED_DOMAINS.some(d => s.includes(d));
    }

    const _open = window.open;
    window.open = function(url) {
      if (isBlocked(url)) {
        console.log('[adblock] Blocked popup:', url);
        return null;
      }
      return _open.apply(this, arguments);
    };

    document.addEventListener('click', function(e) {
      const a = e.target.closest('a[href]');
      if (!a) return;
      if (isBlocked(a.href)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.log('[adblock] Blocked redirect:', a.href);
      }
    }, true);

    try {
      const _assign = location.assign.bind(location);
      const _replace = location.replace.bind(location);
      Object.defineProperty(location, 'assign', {
        value: function(url) {
          if (isBlocked(url)) return;
          return _assign(url);
        },
        configurable: true
      });
      Object.defineProperty(location, 'replace', {
        value: function(url) {
          if (isBlocked(url)) return;
          return _replace(url);
        },
        configurable: true
      });
    } catch (e) {}
  }

  function readGate() {
    const value = document.documentElement?.dataset?.adblockStreamingEnabled;
    if (value === '1') {
      startStreamingProtection();
      return true;
    }
    if (value === '0') {
      console.log('[adblock/streaming] disabled by settings or whitelist:', CURRENT_HOST);
      return true;
    }
    return false;
  }

  // The isolated content script publishes the setting/whitelist state.
  document.addEventListener('adblock-streaming-config', (event) => {
    if (event.detail?.enabled) {
      startStreamingProtection();
    }
  });

  if (!readGate()) {
    const gateTimer = setInterval(() => {
      if (readGate()) clearInterval(gateTimer);
    }, 10);

    setTimeout(() => clearInterval(gateTimer), 2000);
  }
})();
