// netflix-engine.js
// Runs in the extension isolated world.
// Owns request classification and response transformation logic.

(() => {
  'use strict';

  const BROWSE_OP = 'CLCSInterstitialLolomo';
  const PLAYBACK_OP = 'CLCSInterstitialPlaybackAndPostPlayback';
  const CORE_PATH = '/graphql';

  const TRACKING_KEYS = new Set([
    'requestId',
    'request_id',
    'correlationId',
    'correlation_id',
    'transactionId',
    'transaction_id',
    'trackingId',
    'tracking_id',
    'sessionId',
    'session_id',
    'traceId',
    'trace_id'
  ]);

  const OPERATION_KEYS = [
    'operationName',
    'operation',
    'type',
    'action',
    'event'
  ];

  const MAX_SCHEMA_DEPTH = 8;
  const BROWSE_FIELD = 'clcsInterstitialLolomo';
  const SOURCE_MAIN = 'adblock-nf-main';
  const SOURCE_ENGINE = 'adblock-nf-engine';

  function tryParseJson(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function getOperationFromObject(value, depth = 0) {
    if (
      value === null ||
      typeof value !== 'object' ||
      depth > MAX_SCHEMA_DEPTH
    ) {
      return null;
    }

    for (const key of OPERATION_KEYS) {
      if (typeof value[key] === 'string' && value[key].length > 0) {
        return value[key];
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        const nested = getOperationFromObject(child, depth + 1);
        if (nested) return nested;
      }
    }

    return null;
  }

  function findTrackingFields(value, result = {}, depth = 0) {
    if (
      value === null ||
      typeof value !== 'object' ||
      depth > MAX_SCHEMA_DEPTH
    ) {
      return result;
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        TRACKING_KEYS.has(key) &&
        (typeof child === 'string' || typeof child === 'number')
      ) {
        result[key] = child;
      }

      if (child && typeof child === 'object') {
        findTrackingFields(child, result, depth + 1);
      }
    }

    return result;
  }

  function classifyRequest(url, bodyText) {
    const urlStr = String(url || '');
    if (!urlStr.includes(CORE_PATH)) return null;

    const bodyJson = tryParseJson(bodyText);
    const detectedOperation =
      bodyJson ? getOperationFromObject(bodyJson) : null;

    const fallbackText = bodyText || '';
    let operation = null;

    if (
      detectedOperation === PLAYBACK_OP ||
      urlStr.includes(PLAYBACK_OP) ||
      fallbackText.includes(PLAYBACK_OP)
    ) {
      operation = PLAYBACK_OP;
    } else if (
      detectedOperation === BROWSE_OP ||
      urlStr.includes(BROWSE_OP) ||
      fallbackText.includes(BROWSE_OP)
    ) {
      operation = BROWSE_OP;
    }

    if (!operation) return null;

    return {
      operation,
      detectedOperation,
      tracking: bodyJson ? findTrackingFields(bodyJson) : {}
    };
  }

  function buildAcknowledgement(request) {
    const acknowledgement = {
      accepted: true,
      processed: true,
      state: 'complete',
      operation: request.detectedOperation || request.operation
    };

    for (const [key, value] of Object.entries(request.tracking)) {
      acknowledgement[key] = value;
    }

    return {
      data: {
        acknowledgement
      }
    };
  }

  function transformBrowseText(rawText) {
    const json = JSON.parse(rawText);

    if (!json?.data?.[BROWSE_FIELD]) {
      return rawText;
    }

    const cloned =
      typeof structuredClone === 'function'
        ? structuredClone(json)
        : JSON.parse(JSON.stringify(json));

    cloned.data[BROWSE_FIELD] = null;
    return JSON.stringify(cloned);
  }

  function reply(event, message, payload) {
    window.postMessage(
      {
        source: SOURCE_ENGINE,
        session: message.session,
        id: message.id,
        ...payload
      },
      '*'
    );
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;

    const message = event.data;
    if (!message || message.source !== SOURCE_MAIN) return;

    if (message.type === 'hello') {
      reply(event, message, { type: 'ready' });
      return;
    }

    if (message.type === 'classify') {
      try {
        const request = classifyRequest(message.url, message.body);

        if (!request) {
          reply(event, message, {
            type: 'decision',
            action: 'passthrough'
          });
          return;
        }

        if (request.operation === PLAYBACK_OP) {
          reply(event, message, {
            type: 'decision',
            action: 'synthetic',
            request,
            payload: buildAcknowledgement(request)
          });
          return;
        }

        reply(event, message, {
          type: 'decision',
          action: 'browse',
          request
        });
      } catch {
        reply(event, message, {
          type: 'decision',
          action: 'passthrough'
        });
      }

      return;
    }

    if (message.type === 'transformBrowse') {
      try {
        reply(event, message, {
          type: 'transformResult',
          text: transformBrowseText(message.text)
        });
      } catch {
        reply(event, message, {
          type: 'transformResult',
          text: message.text
        });
      }
    }
  });
})();
