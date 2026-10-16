// netflix-inject.js
// Runs in the page MAIN world.
// Keeps only the browser-facing transport/emulation layer here.

(() => {
  'use strict';

  const CORE_PATH = '/graphql';

  // Synchronous XHR cannot wait on isolated-world messaging, so the known-good
  // synchronous fallback remains local to preserve behaviour.
  const SYNC_BROWSE_OP = 'CLCSInterstitialLolomo';
  const SYNC_PLAYBACK_OP = 'CLCSInterstitialPlaybackAndPostPlayback';

  const LOCAL_TRACKING_KEYS = new Set([
    'requestId','request_id',
    'correlationId','correlation_id',
    'transactionId','transaction_id',
    'trackingId','tracking_id',
    'sessionId','session_id',
    'traceId','trace_id'
  ]);

  const LOCAL_OPERATION_KEYS = [
    'operationName','operation','type','action','event'
  ];

  const LOCAL_SCHEMA_DEPTH = 8;
  const BROWSE_FIELD = 'clcsInterstitialLolomo';

  const SOURCE_MAIN = 'adblock-nf-main';
  const SOURCE_ENGINE = 'adblock-nf-engine';

  const NativeFetch = window.fetch;
  const originalFetch = NativeFetch.bind(window);
  const NativeXHR = window.XMLHttpRequest;

  const nativeFetchDescriptor =
    Object.getOwnPropertyDescriptor(window, 'fetch');
  const nativeXhrDescriptor =
    Object.getOwnPropertyDescriptor(window, 'XMLHttpRequest');

  const session =
    typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  let nextMessageId = 1;
  let engineReady = false;
  const pending = new Map();

  function preserveFunctionMetadata(wrapper, original) {
    for (const key of ['name', 'length']) {
      try {
        Object.defineProperty(wrapper, key, {
          value: original[key],
          configurable: true
        });
      } catch {}
    }

    return wrapper;
  }

  function preserveDirectToString(wrapper, original) {
    try {
      Object.defineProperty(wrapper, 'toString', {
        value() {
          return original.toString();
        },
        configurable: true
      });
    } catch {}
  }

  function replaceGlobal(name, replacement, descriptor) {
    if (!descriptor) {
      window[name] = replacement;
      return;
    }

    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      Object.defineProperty(window, name, {
        ...descriptor,
        value: replacement
      });
      return;
    }

    Object.defineProperty(window, name, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() {
        return replacement;
      },
      set: descriptor.set
    });
  }

  function toUrlString(resource) {
    if (typeof resource === 'string') return resource;
    if (resource && typeof resource.url === 'string') return resource.url;
    return String(resource || '');
  }

  async function readFetchBody(resource, options) {
    if (typeof options?.body === 'string') {
      return options.body;
    }

    if (
      typeof Request !== 'undefined' &&
      resource instanceof Request
    ) {
      try {
        return await resource.clone().text();
      } catch {
        return '';
      }
    }

    return '';
  }

  function postToEngine(type, data = {}) {
    const id = nextMessageId++;

    const promise = new Promise(resolve => {
      pending.set(id, resolve);
    });

    window.postMessage(
      {
        source: SOURCE_MAIN,
        session,
        id,
        type,
        ...data
      },
      '*'
    );

    return promise;
  }

  function announce() {
    window.postMessage(
      {
        source: SOURCE_MAIN,
        session,
        id: 0,
        type: 'hello'
      },
      '*'
    );
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;

    const message = event.data;

    if (
      !message ||
      message.source !== SOURCE_ENGINE ||
      message.session !== session
    ) {
      return;
    }

    if (message.type === 'ready') {
      engineReady = true;
      return;
    }

    const resolve = pending.get(message.id);
    if (!resolve) return;

    pending.delete(message.id);
    resolve(message);
  });

  announce();

  // Cover whichever of the two document_start scripts initializes first.
  const helloTimer = setInterval(() => {
    if (engineReady) {
      clearInterval(helloTimer);
      return;
    }

    announce();
  }, 10);

  setTimeout(() => clearInterval(helloTimer), 2000);

  function createJsonResponse(payload, sourceResponse = null) {
    const headers = new Headers(
      sourceResponse?.headers || {
        'Content-Type': 'application/json'
      }
    );

    headers.set('Content-Type', 'application/json');

    return new Response(JSON.stringify(payload), {
      status: sourceResponse?.status ?? 200,
      statusText: sourceResponse?.statusText ?? 'OK',
      headers
    });
  }

  function dispatchLifecycle(request, payload, transport) {
    const detail = {
      operation: request.operation,
      detectedOperation: request.detectedOperation,
      tracking: { ...(request.tracking || {}) },
      response: payload,
      transport,
      timestamp: Date.now()
    };

    try {
      window.__stateBridge?.complete?.(detail);
    } catch {}

    try {
      window.dispatchEvent(
        new CustomEvent('proxy:state-processed', { detail })
      );

      window.dispatchEvent(
        new CustomEvent('proxy:state-complete', { detail })
      );
    } catch {}
  }

  // XHR classification is intentionally synchronous so native send timing is preserved.
  function parseLocalJson(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function getLocalOperation(value, depth = 0) {
    if (
      value === null ||
      typeof value !== 'object' ||
      depth > LOCAL_SCHEMA_DEPTH
    ) {
      return null;
    }

    for (const key of LOCAL_OPERATION_KEYS) {
      if (typeof value[key] === 'string' && value[key].length > 0) {
        return value[key];
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const nested = getLocalOperation(child, depth + 1);
        if (nested) return nested;
      }
    }

    return null;
  }

  function getLocalTracking(value, result = {}, depth = 0) {
    if (
      value === null ||
      typeof value !== 'object' ||
      depth > LOCAL_SCHEMA_DEPTH
    ) {
      return result;
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        LOCAL_TRACKING_KEYS.has(key) &&
        (typeof child === 'string' || typeof child === 'number')
      ) {
        result[key] = child;
      }

      if (child && typeof child === 'object') {
        getLocalTracking(child, result, depth + 1);
      }
    }

    return result;
  }

  function classifySync(url, bodyText) {
    const urlStr = String(url || '');
    if (!urlStr.includes(CORE_PATH)) return null;

    const bodyJson = parseLocalJson(bodyText);
    const detectedOperation =
      bodyJson ? getLocalOperation(bodyJson) : null;

    const fallbackText = String(bodyText || '');
    let operation = null;

    if (
      detectedOperation === SYNC_PLAYBACK_OP ||
      urlStr.includes(SYNC_PLAYBACK_OP) ||
      fallbackText.includes(SYNC_PLAYBACK_OP)
    ) {
      operation = SYNC_PLAYBACK_OP;
    } else if (
      detectedOperation === SYNC_BROWSE_OP ||
      urlStr.includes(SYNC_BROWSE_OP) ||
      fallbackText.includes(SYNC_BROWSE_OP)
    ) {
      operation = SYNC_BROWSE_OP;
    }

    if (!operation) return null;

    return {
      operation,
      detectedOperation,
      tracking: bodyJson ? getLocalTracking(bodyJson) : {}
    };
  }

  function buildSyncAcknowledgement(request) {
    const acknowledgement = {
      accepted: true,
      processed: true,
      state: 'complete',
      operation: request.detectedOperation || request.operation
    };

    for (const [key, value] of Object.entries(request.tracking || {})) {
      acknowledgement[key] = value;
    }

    return {
      data: {
        acknowledgement
      }
    };
  }

  function cleanSyncBrowsePayload(json) {
    if (!json?.data?.[BROWSE_FIELD]) {
      return json;
    }

    const cloned =
      typeof structuredClone === 'function'
        ? structuredClone(json)
        : JSON.parse(JSON.stringify(json));

    cloned.data[BROWSE_FIELD] = null;
    return cloned;
  }

  const interceptedFetch = async function(resource, options) {
    const url = toUrlString(resource);

    if (!url.includes(CORE_PATH)) {
      return originalFetch(resource, options);
    }

    const body = await readFetchBody(resource, options);

    let decision;

    try {
      decision = await postToEngine('classify', {
        url,
        body
      });
    } catch {
      return originalFetch(resource, options);
    }

    if (!decision || decision.action === 'passthrough') {
      return originalFetch(resource, options);
    }

    if (decision.action === 'synthetic') {
      dispatchLifecycle(
        decision.request,
        decision.payload,
        'fetch'
      );

      return createJsonResponse(decision.payload);
    }

    if (decision.action === 'browse') {
      const response = await originalFetch(resource, options);

      try {
        const rawText = await response.clone().text();
        const transformed =
          await postToEngine('transformBrowse', {
            text: rawText
          });

        return new Response(
          transformed?.text ?? rawText,
          {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          }
        );
      } catch {
        return response;
      }
    }

    return originalFetch(resource, options);
  };

  preserveFunctionMetadata(interceptedFetch, NativeFetch);
  preserveDirectToString(interceptedFetch, NativeFetch);
  replaceGlobal('fetch', interceptedFetch, nativeFetchDescriptor);

  function dispatchXhrCompletion(xhr) {
    xhr.dispatchEvent(new Event('readystatechange'));
    xhr.dispatchEvent(new ProgressEvent('load'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  }

  const XHRProxy = new Proxy(NativeXHR, {
    construct(Target, args) {
      const xhr = new Target(...args);

      let requestUrl = '';
      let requestAsync = true;
      let browseIntercepted = false;

      const nativeOpen = xhr.open;
      const nativeSend = xhr.send;

      xhr.open = function(method, url, async = true, ...rest) {
        requestUrl = toUrlString(url);
        requestAsync = async !== false;

        return nativeOpen.call(
          this,
          method,
          url,
          async,
          ...rest
        );
      };

      xhr.send = function(body) {
        const bodyText =
          typeof body === 'string'
            ? body
            : '';

        if (!requestUrl.includes(CORE_PATH)) {
          return nativeSend.call(this, body);
        }

        const request = classifySync(requestUrl, bodyText);

        if (!request) {
          return nativeSend.call(this, body);
        }

        if (request.operation === SYNC_PLAYBACK_OP) {
          const payload = buildSyncAcknowledgement(request);
          const responseText = JSON.stringify(payload);

          Object.defineProperties(this, {
            status: {
              configurable: true,
              value: 200
            },
            statusText: {
              configurable: true,
              value: 'OK'
            },
            readyState: {
              configurable: true,
              value: 4
            },
            responseText: {
              configurable: true,
              value: responseText
            },
            response: {
              configurable: true,
              value:
                this.responseType === 'json'
                  ? payload
                  : responseText
            }
          });

          dispatchLifecycle(request, payload, 'xhr');

          if (requestAsync) {
            queueMicrotask(() => {
              dispatchXhrCompletion(this);
            });
          } else {
            dispatchXhrCompletion(this);
          }

          return;
        }

        if (request.operation === SYNC_BROWSE_OP) {
          browseIntercepted = true;
        }

        // Passthrough/browse native XHR begins in the same send() call.
        return nativeSend.call(this, body);
      };

      Object.defineProperty(xhr, 'responseText', {
        get() {
          const getter = Object.getOwnPropertyDescriptor(
            NativeXHR.prototype,
            'responseText'
          )?.get;

          if (!getter) return '';

          const originalText = getter.call(this);

          if (!browseIntercepted) {
            return originalText;
          }

          try {
            return JSON.stringify(
              cleanSyncBrowsePayload(
                JSON.parse(originalText)
              )
            );
          } catch {
            return originalText;
          }
        },
        configurable: true
      });

      Object.defineProperty(xhr, 'response', {
        get() {
          const getter = Object.getOwnPropertyDescriptor(
            NativeXHR.prototype,
            'response'
          )?.get;

          if (!getter) return null;

          const originalResponse = getter.call(this);

          if (!browseIntercepted) {
            return originalResponse;
          }

          if (typeof originalResponse === 'string') {
            try {
              return JSON.stringify(
                cleanSyncBrowsePayload(
                  JSON.parse(originalResponse)
                )
              );
            } catch {
              return originalResponse;
            }
          }

          if (
            typeof originalResponse === 'object' &&
            originalResponse !== null
          ) {
            return cleanSyncBrowsePayload(originalResponse);
          }

          return originalResponse;
        },
        configurable: true
      });

      return xhr;
    }
  });

  preserveFunctionMetadata(XHRProxy, NativeXHR);
  preserveDirectToString(XHRProxy, NativeXHR);
  replaceGlobal('XMLHttpRequest', XHRProxy, nativeXhrDescriptor);

  const videoCompositingCss = `
      video {
        mix-blend-mode: lighten !important;
      }
    `;

  const videoCompositingPresent = Array.from(
    document.querySelectorAll('style')
  ).some(style => style.textContent === videoCompositingCss);

  if (!videoCompositingPresent) {
    const style = document.createElement('style');
    style.textContent = videoCompositingCss;

    (document.head || document.documentElement)
      .appendChild(style);
  }
})();
