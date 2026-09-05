(function () {
  'use strict';

  const BROWSE_OP = 'CLCSInterstitialLolomo';
  const PLAYBACK_OP = 'CLCSInterstitialPlaybackAndPostPlayback';
  const CORE_PATH = '/graphql';

  /**
   * Broadened Scan Engine: Captures target operations across all variations
   * of Netflix endpoints (web.prod, api-global, or relative path targets).
   */
  function parseGraphQLRequest(url, options) {
    const urlStr = String(url || '');
    
    // Safely parse the outgoing request body if present
    let bodyStr = '';
    if (options && typeof options.body === 'string') {
      bodyStr = options.body;
    }

    // Verify if this is an active GraphQL data stream channel
    if (!urlStr.includes(CORE_PATH)) return null;
    
    // Evaluate vectors simultaneously to ensure no operations slip past
    if (urlStr.includes(PLAYBACK_OP) || bodyStr.includes(PLAYBACK_OP)) return PLAYBACK_OP;
    if (urlStr.includes(BROWSE_OP) || bodyStr.includes(BROWSE_OP)) return BROWSE_OP;
    
    return null;
  }

  function cleanPayload(json) {
    if (json?.data?.clcsInterstitialLolomo) {
      console.log('[adblock] Intercepted browse layer banner check. Neutralising...');
      json.data.clcsInterstitialLolomo = null;
    }
    return json;
  }

  // ── UNIFIED FETCH ROUTER ─────────────────────────────────────────────────
  const originalFetch = window.fetch;

  window.fetch = async function (resource, options) {
    const matchedOp = parseGraphQLRequest(resource, options);

    if (!matchedOp) {
      return originalFetch.apply(this, arguments);
    }

    // Rule 1: Playback Wall Encountered -> Deliver clean blank object to avoid stalling the player
    if (matchedOp === PLAYBACK_OP) {
      console.log('[adblock] Playback handshake matched. Delivering clean envelope data.');
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Rule 2: Browse Wall Encountered -> Clone response securely and clear visual node layout trees
    if (matchedOp === BROWSE_OP) {
      try {
        const response = await originalFetch.apply(this, arguments);
        const clonedResponse = response.clone(); 
        const rawText = await clonedResponse.text();
        const modifiedJson = cleanPayload(JSON.parse(rawText));

        return new Response(JSON.stringify(modifiedJson), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (err) {
        console.error('[adblock] Fetch safety stream parser fallback activated:', err);
        return originalFetch.apply(this, arguments); 
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // ── UNIFIED XHR PROXY CONSTRUCTOR ────────────────────────────────────────
  window.XMLHttpRequest = new Proxy(window.XMLHttpRequest, {
    construct(target, args) {
      const xhr = new target(...args);
      let requestUrl = '';
      let isIntercepted = false;

      xhr.open = new Proxy(xhr.open, {
        apply(openTarget, thisArg, openArgs) {
          requestUrl = typeof openArgs[1] === 'string' ? openArgs[1] : openArgs[1]?.href || '';
          return openTarget.apply(thisArg, openArgs);
        }
      });

      xhr.send = new Proxy(xhr.send, {
        apply(sendTarget, thisArg, sendArgs) {
          const body = sendArgs[0];
          const matchedOp = parseGraphQLRequest(requestUrl, { body });

          if (matchedOp === PLAYBACK_OP) {
            console.log('[adblock] Playback handshake matched on XHR pipeline.');
            Object.defineProperty(thisArg, 'status', { value: 200, configurable: true });
            Object.defineProperty(thisArg, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(thisArg, 'responseText', { value: JSON.stringify({ data: {} }), configurable: true });
            Object.defineProperty(thisArg, 'response', { value: { data: {} }, configurable: true });
            
            setTimeout(() => {
              thisArg.dispatchEvent(new Event('readystatechange'));
              thisArg.dispatchEvent(new Event('load'));
              thisArg.dispatchEvent(new Event('loadend'));
            }, 0);
            return;
          }

          if (matchedOp === BROWSE_OP) {
            isIntercepted = true;
          }

          return sendTarget.apply(thisArg, sendArgs);
        }
      });

      // Intercept and patch read descriptors securely on data accessor calls
      Object.defineProperty(xhr, 'responseText', {
        get() {
          const originalText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get.call(this);
          if (isIntercepted) {
            try {
              return JSON.stringify(cleanPayload(JSON.parse(originalText)));
            } catch (e) { return originalText; }
          }
          return originalText;
        },
        configurable: true
      });

      Object.defineProperty(xhr, 'response', {
        get() {
          const originalResponse = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get.call(this);
          if (isIntercepted) {
            if (typeof originalResponse === 'string') {
              try { return JSON.stringify(cleanPayload(JSON.parse(originalResponse))); } catch(e) {}
            } else if (typeof originalResponse === 'object' && originalResponse !== null) {
              return cleanPayload(originalResponse);
            }
          }
          return originalResponse;
        },
        configurable: true
      });

      return xhr;
    }
  });

  console.log('[adblock] Consolidated structural proxy framework successfully deployed.');
})();
