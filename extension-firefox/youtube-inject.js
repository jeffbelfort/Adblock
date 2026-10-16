// youtube-inject.js
// Runs in YouTube's MAIN world at document_start.
// Removes known ad-scheduling fields from YouTube player responses before
// the player consumes them. content.js keeps the existing skip/16x fallback.

(() => {
  'use strict';

  let enabled = true;

  const AD_FIELDS = [
    'adPlacements',
    'playerAds',
    'adSlots',
  ];

  function updateEnabledFromDocument() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    const value = root.dataset.adblockYoutubeEnabled;

    if (value === '0') {
      enabled = false;
    } else if (value === '1') {
      enabled = true;
    }
  }

  document.addEventListener(
    'adblock-youtube-config',
    (event) => {
      if (
        event.detail &&
        typeof event.detail.enabled === 'boolean'
      ) {
        enabled = event.detail.enabled;
      }
    }
  );

  updateEnabledFromDocument();

  function isPlayerResponseURL(url) {
    if (!url) {
      return false;
    }

    try {
      const parsed =
        new URL(String(url), location.href);

      return (
        parsed.hostname.endsWith('youtube.com') &&
        parsed.pathname.includes('/youtubei/v1/player')
      );
    } catch {
      return false;
    }
  }

  function stripAdFields(value) {
    if (
      !enabled ||
      !value ||
      typeof value !== 'object'
    ) {
      return value;
    }

    for (const field of AD_FIELDS) {
      if (
        Object.prototype.hasOwnProperty.call(
          value,
          field
        )
      ) {
        delete value[field];
      }
    }

    // Some wrappers contain the actual player response as a nested object.
    if (
      value.playerResponse &&
      typeof value.playerResponse === 'object'
    ) {
      stripAdFields(value.playerResponse);
    }

    return value;
  }

  function stripAdFieldsFromText(text) {
    if (
      !enabled ||
      typeof text !== 'string' ||
      !(
        text.includes('"adPlacements"') ||
        text.includes('"playerAds"') ||
        text.includes('"adSlots"')
      )
    ) {
      return text;
    }

    try {
      const parsed = JSON.parse(text);
      stripAdFields(parsed);
      return JSON.stringify(parsed);
    } catch {
      return text;
    }
  }

  // Catch the initial player response embedded by the page before player
  // initialisation.
  try {
    let initialPlayerResponse =
      stripAdFields(window.ytInitialPlayerResponse);

    Object.defineProperty(
      window,
      'ytInitialPlayerResponse',
      {
        configurable: true,
        enumerable: true,

        get() {
          return initialPlayerResponse;
        },

        set(value) {
          initialPlayerResponse =
            stripAdFields(value);
        },
      }
    );
  } catch {
    // If YouTube has made the property non-configurable, leave it alone.
  }

  // Catch subsequent /youtubei/v1/player responses without replacing fetch()
  // itself. Keeping the hook on Response preserves the response's URL/status/
  // headers and limits modification to YouTube player-response payloads.
  const nativeResponseJSON =
    Response.prototype.json;

  const nativeResponseText =
    Response.prototype.text;

  Response.prototype.json =
    async function (...args) {
      const value =
        await nativeResponseJSON.apply(
          this,
          args
        );

      if (
        enabled &&
        isPlayerResponseURL(this.url)
      ) {
        return stripAdFields(value);
      }

      return value;
    };

  Response.prototype.text =
    async function (...args) {
      const text =
        await nativeResponseText.apply(
          this,
          args
        );

      if (
        enabled &&
        isPlayerResponseURL(this.url)
      ) {
        return stripAdFieldsFromText(text);
      }

      return text;
    };

  console.log(
    '[adblock] YouTube player-response scriptlet active'
  );
})();
